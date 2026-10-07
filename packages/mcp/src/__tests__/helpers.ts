import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ToolListChangedNotificationSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { vi } from "vitest";
import { saveCredentials } from "../../../sdk/src/credentials";
import { createServer, type CreateServerOptions } from "../index";

// The SDK's fake ouicu (fetch) and fake CLI, shared with its tests.
export {
  FAKE_CLI,
  fakeApi,
  freshHome,
  json,
  recorded,
} from "../../../sdk/src/__tests__/helpers";
import { FAKE_CLI } from "../../../sdk/src/__tests__/helpers";

export const API = "http://ouicu.test";

/** As if `ouicu login` had run on this computer. */
export function loggedIn(apiKey = "ocu_saved") {
  saveCredentials({ apiKey, email: "mads@example.com", api: API });
}

/** A folder of its own. */
export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ouicu-mcp-"));
}

/** The server, with a client talking to it over MCP in memory. */
export async function connect(options: CreateServerOptions = {}) {
  const server = createServer({
    api: API,
    bin: FAKE_CLI,
    openBrowser: async () => false,
    ...options,
  });
  const client = new Client({ name: "ouicu-test", version: "1.0.0" });
  const listChanged = vi.fn();
  client.setNotificationHandler(ToolListChangedNotificationSchema, listChanged);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({
      name,
      arguments: args,
    })) as CallToolResult;
    const text = result.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("\n");
    return { ...result, text };
  };
  const tools = async () =>
    (await client.listTools()).tools.map((t) => t.name).sort();
  const close = async () => {
    await client.close();
    await server.close();
  };
  return { server, client, call, tools, listChanged, close };
}
