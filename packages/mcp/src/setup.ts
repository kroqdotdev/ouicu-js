import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_API,
  Ouicu,
  OuicuError,
  clientName,
  readCredentials,
} from "@ouicu/sdk";
import { openBrowser } from "./browser";

/*
 * `npx @ouicu/mcp setup <tool>`: logs in when this computer has no
 * working key, then tells the tool how to start this server. The key
 * stays in the credentials file the CLI shares (the server reads it
 * there) and never goes into a tool's settings.
 */

export const TOOLS = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "vscode",
  "codex",
  "windsurf",
] as const;
export type Tool = (typeof TOOLS)[number];

const NAME = "ouicu";
const PACKAGE = "@ouicu/mcp";

export interface Where {
  home: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

/** How a tool is told about the server: its own command, or its settings file. */
export type Registration =
  | {
      kind: "command";
      command: string;
      /** Run first, its failure passed over: takes out an older entry. */
      before: string[];
      args: string[];
      /** What to run by hand when the command is missing. */
      manual: string;
      after: string;
    }
  | {
      kind: "file";
      path: string;
      /** VS Code calls the list "servers"; the others "mcpServers". */
      key: "mcpServers" | "servers";
      entry: Record<string, unknown>;
      after: string;
    };

/** OUICU_API for a server other than ouicu.com, so the server talks to the same one. */
function apiEnv(api: string): Record<string, string> | undefined {
  return api === DEFAULT_API ? undefined : { OUICU_API: api };
}

/** The folder desktop apps keep their settings in (Claude, VS Code). */
function appSettings(where: Where): string {
  if (where.platform === "darwin")
    return join(where.home, "Library", "Application Support");
  if (where.platform === "win32")
    return where.env.APPDATA || join(where.home, "AppData", "Roaming");
  const xdg = where.env.XDG_CONFIG_HOME;
  return xdg && xdg.startsWith("/") ? xdg : join(where.home, ".config");
}

export function registrationFor(
  tool: Tool,
  api: string,
  where: Where,
): Registration {
  const env = apiEnv(api);
  const run = ["npx", "-y", PACKAGE];
  const entry = { command: "npx", args: ["-y", PACKAGE], ...(env && { env }) };
  switch (tool) {
    case "claude-code": {
      const envArgs = env ? ["-e", `OUICU_API=${env.OUICU_API}`] : [];
      const args = [
        "mcp",
        "add",
        "-s",
        "user",
        "--transport",
        "stdio",
        NAME,
        ...envArgs,
        "--",
        ...run,
      ];
      return {
        kind: "command",
        command: "claude",
        before: ["mcp", "remove", "-s", "user", NAME],
        args,
        manual: `claude ${args.join(" ")}`,
        after:
          "Added to Claude Code for every project. Start a new session to use it.",
      };
    }
    case "codex": {
      const envArgs = env ? ["--env", `OUICU_API=${env.OUICU_API}`] : [];
      const args = ["mcp", "add", NAME, ...envArgs, "--", ...run];
      const toml = [
        `[mcp_servers.${NAME}]`,
        `command = "npx"`,
        `args = ["-y", "${PACKAGE}"]`,
        ...(env ? [`env = { OUICU_API = "${env.OUICU_API}" }`] : []),
      ].join("\n");
      return {
        kind: "command",
        command: "codex",
        before: ["mcp", "remove", NAME],
        args,
        manual: `codex ${args.join(" ")}\n\nor add this to ~/.codex/config.toml:\n\n${toml}`,
        after: "Added to Codex. Start a new session to use it.",
      };
    }
    case "claude-desktop":
      return {
        kind: "file",
        path: join(appSettings(where), "Claude", "claude_desktop_config.json"),
        key: "mcpServers",
        entry,
        after: "Quit and open Claude Desktop again to use it.",
      };
    case "cursor":
      return {
        kind: "file",
        path: join(where.home, ".cursor", "mcp.json"),
        key: "mcpServers",
        entry,
        after: "Added for every project. Reload Cursor's window to use it.",
      };
    case "vscode":
      return {
        kind: "file",
        path: join(appSettings(where), "Code", "User", "mcp.json"),
        key: "servers",
        entry: { type: "stdio", ...entry },
        after: "Added for every folder. Reload VS Code's window to use it.",
      };
    case "windsurf":
      return {
        kind: "file",
        path: join(where.home, ".codeium", "windsurf", "mcp_config.json"),
        key: "mcpServers",
        entry,
        after: "Restart Windsurf to use it.",
      };
  }
}

/** A settings file that is not plain JSON (comments, say), left as it was. */
export class UnreadableConfig extends Error {}

/**
 * Adds the ouicu entry to an MCP settings file, keeping everything else
 * in it. A file that is not plain JSON (comments, trailing commas) is not
 * touched at all: it throws, and setup says what to add by hand.
 */
export function mergeConfig(
  path: string,
  key: "mcpServers" | "servers",
  entry: Record<string, unknown>,
): void {
  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new UnreadableConfig(path);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new UnreadableConfig(path);
    config = parsed as Record<string, unknown>;
  }
  const list = config[key];
  config[key] = {
    ...(list && typeof list === "object" && !Array.isArray(list) ? list : {}),
    [NAME]: entry,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

export interface SetupDeps {
  log: (line: string) => void;
  /** Runs a command, throwing when it fails or is missing. */
  run: (command: string, args: string[], quiet: boolean) => void;
  openBrowser: (url: string) => Promise<boolean>;
  where: Where;
}

const defaults: SetupDeps = {
  log: (line) => console.log(line),
  run: (command, args, quiet) => {
    execFileSync(command, args, { stdio: quiet ? "ignore" : "inherit" });
  },
  openBrowser,
  where: { home: homedir(), platform: process.platform, env: process.env },
};

export const USAGE = `Set up the ouicu MCP server for a coding tool:

  npx ${PACKAGE} setup <tool> [--no-browser]

Tools: ${TOOLS.join(", ")}

It logs you in to ouicu first when this computer is not (the key is saved
where the ouicu CLI keeps it), then adds the server to the tool. The key is
never written into the tool's settings.`;

/** `setup <tool>`: answers the exit code. */
export async function runSetup(
  args: string[],
  deps: SetupDeps = defaults,
): Promise<number> {
  const { log } = deps;
  const tool = args.find((a) => !a.startsWith("-"));
  if (!tool || !(TOOLS as readonly string[]).includes(tool)) {
    if (tool) log(`There is no tool called "${tool}".\n`);
    log(USAGE);
    return tool ? 1 : 0;
  }
  const browser = !args.includes("--no-browser");
  const api = (deps.where.env.OUICU_API || DEFAULT_API).replace(/\/+$/, "");

  try {
    await logIn(api, browser, deps);
  } catch (err) {
    log(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const registration = registrationFor(tool as Tool, api, deps.where);
  if (registration.kind === "file") {
    try {
      mergeConfig(registration.path, registration.key, registration.entry);
    } catch (err) {
      if (!(err instanceof UnreadableConfig)) throw err;
      log(
        `${registration.path} is not plain JSON (it has comments, say), so it was left as it is. Add this under "${registration.key}" yourself:`,
      );
      log(JSON.stringify({ [NAME]: registration.entry }, null, 2));
      return 1;
    }
    log(`Added ouicu to ${registration.path}.`);
    log(registration.after);
    return 0;
  }
  try {
    deps.run(registration.command, registration.before, true);
  } catch {
    // Nothing to take out, or no such command, which comes up next.
  }
  try {
    deps.run(registration.command, registration.args, false);
  } catch {
    log(
      `\nCould not run \`${registration.command}\`. Add the server by hand:\n\n  ${registration.manual}`,
    );
    return 1;
  }
  log(registration.after);
  return 0;
}

const no = async () => false;

/** Makes sure this computer has a key that works, logging in when not. */
async function logIn(api: string, browser: boolean, deps: SetupDeps) {
  const { log } = deps;
  let saved = null;
  try {
    saved = readCredentials();
  } catch {
    // A damaged file is replaced by logging in.
  }
  if (saved && saved.api === api) {
    try {
      const me = await new Ouicu({ api, apiKey: saved.apiKey }).whoami();
      log(`Logged in to ouicu as ${me.email}.`);
      return;
    } catch (err) {
      if (!(err instanceof OuicuError && err.status === 401)) {
        log(
          `Could not check the saved key (${err instanceof Error ? err.message : err}). Going on with it.`,
        );
        return;
      }
      log("The saved key does not work any more. Logging in again.");
    }
  }
  const done = await new Ouicu({ api }).login({
    client: `${clientName()}, MCP`,
    onCode: (code) => {
      log(`Your code is ${code.userCode}`);
      log(`Approve it at ${code.verificationUrl}`);
      void (browser ? deps.openBrowser(code.verificationUrl) : no()).then(
        (opened) => {
          if (opened) log("(opened in your browser)");
          log("\nWaiting for approval...");
        },
      );
    },
  });
  log(`Logged in as ${done.email}. The key is in ${done.path}.\n`);
}
