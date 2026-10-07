import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connect, fakeApi, freshHome, json, loggedIn } from "./helpers";

let session: Awaited<ReturnType<typeof connect>> | undefined;

beforeEach(() => {
  freshHome();
});
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe("over MCP", () => {
  it("introduces itself and says what ouicu is for", async () => {
    loggedIn();
    session = await connect();
    expect(session.client.getServerVersion()?.name).toBe("ouicu");
    expect(session.client.getInstructions()).toMatch(
      /Links are public: anyone who has one can open it unless it has a password, or is only for invited people/,
    );
    expect(session.client.getServerCapabilities()?.tools?.listChanged).toBe(
      true,
    );
  });

  it("lists each tool with a description and the input it takes", async () => {
    loggedIn();
    session = await connect();
    const { tools } = await session.client.listTools();
    for (const tool of tools) {
      expect(tool.description?.length, tool.name).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe("object");
    }
    const share = tools.find((t) => t.name === "ouicu_share_port");
    expect(share?.inputSchema.required).toEqual(["port"]);
    expect(Object.keys(share?.inputSchema.properties ?? {}).sort()).toEqual([
      "allow",
      "name",
      "password",
      "port",
    ]);
    // An agent reads that a list of people is Pro's, and how they get in.
    const allow = share?.inputSchema.properties?.allow as {
      type: string;
      description: string;
    };
    expect(allow.type).toBe("array");
    expect(allow.description).toMatch(/^Pro only: only these people/);
    expect(allow.description).toContain("gets a sign-in link by email");
    expect(share?.description).toContain("With `allow` (Pro)");
    const remove = tools.find((t) => t.name === "ouicu_delete_site");
    expect(remove?.annotations?.destructiveHint).toBe(true);
    const usage = tools.find((t) => t.name === "ouicu_usage");
    expect(usage?.annotations?.readOnlyHint).toBe(true);
  });

  it("answers a call with words and the same thing as structured content", async () => {
    loggedIn();
    const usage = {
      plan: "pro",
      month: "2026-10",
      bytes: 0,
      requests: 0,
      allowanceBytes: 150 * 1024 ** 3,
      resetsAt: "2026-11-01T00:00:00.000Z",
      over: false,
    };
    fakeApi({ "GET /api/usage": json(usage) });
    session = await connect();
    const result = await session.client.callTool({ name: "ouicu_usage" });
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Pro plan, 2026-10: 0 B of 150 GB used (0%), 0 requests.\nIt resets 2026-11-01 00:00 UTC.",
      },
    ]);
    expect(result.structuredContent).toEqual(usage);
  });

  it("refuses input that does not fit a tool before running it", async () => {
    loggedIn();
    const api = fakeApi({});
    session = await connect();
    const result = await session.client.callTool({
      name: "ouicu_share_port",
      arguments: { port: 70000 },
    });
    expect(result.isError).toBe(true);
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
