import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { freshHome } from "./helpers";

/*
 * The command an agent runs (`npx -y @ouicu/mcp`), as a process: MCP over
 * its stdin and stdout, and gone, with any shares it started, once the
 * agent closes its stdin.
 */

const BIN = fileURLToPath(new URL("../../bin/mcp.ts", import.meta.url));

beforeEach(() => {
  freshHome();
});

function run(args: string[] = []) {
  const child = spawn(process.execPath, ["--import", "tsx", BIN, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const output = { out: "", err: "" };
  child.stderr.on("data", (d) => (output.err += d));
  const answers: Record<string, unknown>[] = [];
  const waiting: (() => void)[] = [];
  lines.on("line", (line) => {
    output.out += `${line}\n`;
    if (line.startsWith("{")) answers.push(JSON.parse(line));
    waiting.splice(0).forEach((wake) => wake());
  });
  const exited = new Promise<number | null>((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );
  /** Sends a request and waits for the answer with its id. */
  const ask = async (id: number, method: string, params = {}) => {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    for (;;) {
      const found = answers.find((a) => a.id === id);
      if (found) return found as { result: Record<string, unknown> };
      await new Promise<void>((wake) => waiting.push(wake));
    }
  };
  const tell = (method: string) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  return { child, ask, tell, exited, output };
}

describe("the ouicu-mcp command", () => {
  it("speaks MCP on stdin and stdout, and ends when its stdin closes", async () => {
    const { child, ask, tell, exited } = run();
    const hello = await ask(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ouicu-test", version: "1.0.0" },
    });
    expect(hello.result.serverInfo).toMatchObject({ name: "ouicu" });
    tell("notifications/initialized");
    // No key on this computer: logging in is all it offers.
    const listed = await ask(2, "tools/list");
    expect(
      (listed.result.tools as { name: string }[]).map((t) => t.name),
    ).toEqual(["ouicu_login"]);

    child.stdin.end();
    expect(await exited).toBe(0);
  }, 30_000);

  it("says its version, and what is not a command", async () => {
    const version = run(["--version"]);
    expect(await version.exited).toBe(0);
    // From source; the build stamps in package.json's.
    expect(version.output.out.trim()).toBe("0.0.0-dev");

    const wrong = run(["sertup"]);
    expect(await wrong.exited).toBe(1);
    expect(wrong.output.err).toContain(
      'There is no command "sertup". Try --help.',
    );
  }, 30_000);
});
