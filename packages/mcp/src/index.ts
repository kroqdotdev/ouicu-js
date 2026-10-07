import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Ouicu } from "@ouicu/sdk";
import { openBrowser } from "./browser";
import { LocalShares, Session } from "./tools";

declare const PKG_VERSION: string | undefined;

/** This package's version. */
export const VERSION =
  typeof PKG_VERSION !== "undefined" ? PKG_VERSION : "0.0.0-dev";

export interface CreateServerOptions {
  /** An API key (ocu_...). Without one: OUICU_API_KEY, then the key `ouicu login` saved. */
  apiKey?: string;
  /** The ouicu site: OUICU_API, or https://ouicu.com. */
  api?: string;
  /** The tunnel shares connect to: OUICU_TUNNEL, or the CLI's own. */
  tunnel?: string;
  /** The ouicu CLI shares run: OUICU_BIN, or `ouicu` on the PATH. */
  bin?: string;
  /** Opens the login's approval page; the system's browser unless replaced. */
  openBrowser?: (url: string) => Promise<boolean>;
}

const INSTRUCTIONS = `ouicu turns what is being built into a link to send to someone. ouicu_share_port shares a running dev server at https://<name>.ouicu.app while this MCP server runs; ouicu_deploy puts a built static site up at a link that keeps working. Links are public: anyone who has one can open it unless it has a password, or is only for invited people (ouicu_share_port's allow, on Pro), who sign in with a link ouicu emails them. Give the person the link the tool answers with. ouicu_recent_requests tells whether someone has opened it.`;

/**
 * An MCP server with ouicu's tools. Without a key it has only
 * ouicu_login, and the rest arrive once the person approves the login.
 * Shares it started stop when it closes.
 *
 * @example
 * ```ts
 * import { createServer } from "@ouicu/mcp";
 * import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
 *
 * await createServer().connect(new StdioServerTransport());
 * ```
 */
export function createServer(options: CreateServerOptions = {}): McpServer {
  const ouicu = new Ouicu({
    apiKey: options.apiKey,
    api: options.api,
    tunnel: options.tunnel,
    bin: options.bin,
  });
  const server = new McpServer(
    { name: "ouicu", version: VERSION },
    {
      instructions: INSTRUCTIONS,
      capabilities: { tools: { listChanged: true } },
    },
  );
  const shares = new LocalShares();
  server.server.onclose = () => void shares.stopAll();
  new Session(server, ouicu, shares, {
    openBrowser: options.openBrowser ?? openBrowser,
    keyGiven: Boolean(options.apiKey || process.env.OUICU_API_KEY?.trim()),
  }).start();
  return server;
}
