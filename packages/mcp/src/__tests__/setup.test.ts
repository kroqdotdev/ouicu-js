import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { credentialsPath } from "../../../sdk/src/credentials";
import {
  mergeConfig,
  UnreadableConfig,
  registrationFor,
  runSetup,
  TOOLS,
  type SetupDeps,
  type Where,
} from "../setup";
import { API, fakeApi, freshHome, json, loggedIn, tempDir } from "./helpers";

let home: string;
beforeEach(() => {
  home = freshHome();
});

const linux = (env = {}): Where => ({
  home: "/home/mads",
  platform: "linux",
  env,
});

describe("how each tool is told", () => {
  it("never puts a key in a tool's settings", () => {
    for (const tool of TOOLS) {
      const text = JSON.stringify(
        registrationFor(tool, "https://ouicu.com", linux()),
      );
      expect(text, tool).not.toMatch(/ocu_|API_KEY/);
      expect(text, tool).toContain("@ouicu/mcp");
    }
  });

  it("adds it to Claude Code for every project with `claude mcp add`", () => {
    const r = registrationFor("claude-code", "https://ouicu.com", linux());
    expect(r).toMatchObject({
      kind: "command",
      command: "claude",
      before: ["mcp", "remove", "-s", "user", "ouicu"],
      args: [
        "mcp",
        "add",
        "-s",
        "user",
        "--transport",
        "stdio",
        "ouicu",
        "--",
        "npx",
        "-y",
        "@ouicu/mcp",
      ],
      manual:
        "claude mcp add -s user --transport stdio ouicu -- npx -y @ouicu/mcp",
    });
  });

  it("tells the server which ouicu to use when it is not ouicu.com", () => {
    const claude = registrationFor(
      "claude-code",
      "http://localhost:3232",
      linux(),
    );
    expect(claude.kind === "command" && claude.args).toEqual([
      "mcp",
      "add",
      "-s",
      "user",
      "--transport",
      "stdio",
      "ouicu",
      "-e",
      "OUICU_API=http://localhost:3232",
      "--",
      "npx",
      "-y",
      "@ouicu/mcp",
    ]);
    const cursor = registrationFor("cursor", "http://localhost:3232", linux());
    expect(cursor.kind === "file" && cursor.entry).toEqual({
      command: "npx",
      args: ["-y", "@ouicu/mcp"],
      env: { OUICU_API: "http://localhost:3232" },
    });
  });

  it("adds it to Codex with `codex mcp add`, or config.toml by hand", () => {
    const r = registrationFor("codex", "https://ouicu.com", linux());
    expect(r.kind === "command" && r.args).toEqual([
      "mcp",
      "add",
      "ouicu",
      "--",
      "npx",
      "-y",
      "@ouicu/mcp",
    ]);
    expect(r.kind === "command" && r.manual).toContain(
      '[mcp_servers.ouicu]\ncommand = "npx"\nargs = ["-y", "@ouicu/mcp"]',
    );
  });

  it("writes the settings file each app reads, where it reads it", () => {
    const path = (tool: (typeof TOOLS)[number], where: Where) => {
      const r = registrationFor(tool, "https://ouicu.com", where);
      return r.kind === "file" ? [r.path, r.key] : null;
    };
    const mac: Where = { home: "/Users/mads", platform: "darwin", env: {} };
    const windows: Where = {
      home: "C:\\Users\\mads",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\mads\\AppData\\Roaming" },
    };
    expect(path("claude-desktop", linux())).toEqual([
      "/home/mads/.config/Claude/claude_desktop_config.json",
      "mcpServers",
    ]);
    expect(path("claude-desktop", mac)).toEqual([
      "/Users/mads/Library/Application Support/Claude/claude_desktop_config.json",
      "mcpServers",
    ]);
    expect(path("claude-desktop", windows)?.[0]).toMatch(
      /^C:\\Users\\mads\\AppData\\Roaming.Claude.claude_desktop_config\.json$/,
    );
    expect(path("cursor", linux())).toEqual([
      "/home/mads/.cursor/mcp.json",
      "mcpServers",
    ]);
    expect(path("vscode", linux({ XDG_CONFIG_HOME: "/x" }))).toEqual([
      "/x/Code/User/mcp.json",
      "servers",
    ]);
    expect(path("vscode", mac)?.[0]).toBe(
      "/Users/mads/Library/Application Support/Code/User/mcp.json",
    );
    expect(path("windsurf", linux())).toEqual([
      "/home/mads/.codeium/windsurf/mcp_config.json",
      "mcpServers",
    ]);
    const vscode = registrationFor("vscode", "https://ouicu.com", linux());
    expect(vscode.kind === "file" && vscode.entry).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@ouicu/mcp"],
    });
  });
});

describe("settings files", () => {
  const entry = { command: "npx", args: ["-y", "@ouicu/mcp"] };

  it("are made, folders and all, when there is none", () => {
    const path = join(tempDir(), "deep", "mcp.json");
    mergeConfig(path, "mcpServers", entry);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      mcpServers: { ouicu: entry },
    });
  });

  it("keep the other servers and settings, and replace an older ouicu", () => {
    const path = join(tempDir(), "mcp.json");
    writeFileSync(
      path,
      JSON.stringify({
        theme: "dark",
        servers: {
          github: { command: "gh-mcp" },
          ouicu: { command: "old" },
        },
      }),
    );
    mergeConfig(path, "servers", { type: "stdio", ...entry });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      theme: "dark",
      servers: {
        github: { command: "gh-mcp" },
        ouicu: { type: "stdio", ...entry },
      },
    });
  });

  it("leave a file that is not plain JSON exactly as it was", () => {
    const path = join(tempDir(), "mcp.json");
    const before =
      '{ // my servers\n  "mcpServers": { "github": { "command": "gh" } } }';
    writeFileSync(path, before);
    expect(() => mergeConfig(path, "mcpServers", entry)).toThrow(
      UnreadableConfig,
    );
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

describe("setup", () => {
  function deps(over: Partial<SetupDeps> = {}) {
    const lines: string[] = [];
    const runs: string[][] = [];
    const d: SetupDeps = {
      log: (line) => lines.push(line),
      run: (command, args) => {
        runs.push([command, ...args]);
      },
      openBrowser: async () => true,
      where: { home, platform: "linux", env: { OUICU_API: API } },
      ...over,
    };
    return { d, lines, runs, out: () => lines.join("\n") };
  }

  const whoami = json({
    email: "mads@example.com",
    name: "Mads",
    plan: { key: "free", name: "Free", source: "default" },
    key: { name: "laptop", prefix: "ocu_ab12" },
  });

  it("registers right away when this computer is logged in", async () => {
    loggedIn();
    const api = fakeApi({ "GET /api/cli/whoami": whoami });
    const { d, runs, out } = deps();
    expect(await runSetup(["claude-code"], d)).toBe(0);
    expect(api.seen.map((s) => s.url)).toEqual(["/api/cli/whoami"]);
    expect(runs).toEqual([
      ["claude", "mcp", "remove", "-s", "user", "ouicu"],
      [
        "claude",
        "mcp",
        "add",
        "-s",
        "user",
        "--transport",
        "stdio",
        "ouicu",
        "-e",
        `OUICU_API=${API}`,
        "--",
        "npx",
        "-y",
        "@ouicu/mcp",
      ],
    ]);
    expect(out()).toContain("Logged in to ouicu as mads@example.com.");
  });

  it("logs in through the browser first when there is no key, and saves it for the CLI too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      fakeApi({
        "POST /api/cli/login": json({
          deviceCode: "d".repeat(40),
          userCode: "ABCD-2345",
          verificationUrl: `${API}/cli?code=ABCD-2345`,
          expiresAt: "2026-10-03T10:15:00.000Z",
          expiresIn: 900,
          interval: 5,
        }),
        "POST /api/cli/login/token": [
          json({ status: "pending" }, 202),
          json({
            status: "approved",
            apiKey: "ocu_new",
            email: "mads@example.com",
          }),
        ],
      });
      const opened: string[] = [];
      const { d, out } = deps({
        openBrowser: async (url) => {
          opened.push(url);
          return true;
        },
      });
      const done = runSetup(["cursor"], d);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await done).toBe(0);
      expect(opened).toEqual([`${API}/cli?code=ABCD-2345`]);
      expect(out()).toContain(
        `Your code is ABCD-2345\nApprove it at ${API}/cli?code=ABCD-2345\n(opened in your browser)\n\nWaiting for approval...\nLogged in as mads@example.com.`,
      );
      expect(JSON.parse(readFileSync(credentialsPath(), "utf8"))).toMatchObject(
        {
          apiKey: "ocu_new",
          api: API,
        },
      );
      const cursor = join(home, ".cursor", "mcp.json");
      expect(readFileSync(cursor, "utf8")).not.toContain("ocu_new");
      expect(JSON.parse(readFileSync(cursor, "utf8")).mcpServers.ouicu).toEqual(
        {
          command: "npx",
          args: ["-y", "@ouicu/mcp"],
          env: { OUICU_API: API },
        },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs in again when the saved key no longer works", async () => {
    loggedIn("ocu_revoked");
    const api = fakeApi({
      "GET /api/cli/whoami": json({ error: "That key does not work." }, 401),
      "POST /api/cli/login": json(
        { error: "Too many logins are waiting." },
        503,
      ),
    });
    const { d, out } = deps();
    expect(await runSetup(["windsurf"], d)).toBe(1);
    expect(api.seen.map((s) => s.url)).toEqual([
      "/api/cli/whoami",
      "/api/cli/login",
    ]);
    expect(out()).toContain("The saved key does not work any more");
    expect(out()).toContain("Too many logins are waiting.");
    expect(existsSync(join(home, ".codeium"))).toBe(false);
  });

  it("prints the command to run by hand when the tool's CLI is missing", async () => {
    loggedIn();
    fakeApi({ "GET /api/cli/whoami": whoami });
    const { d, out } = deps({
      run: () => {
        throw Object.assign(new Error("spawn claude ENOENT"), {
          code: "ENOENT",
        });
      },
    });
    expect(await runSetup(["claude-code"], d)).toBe(1);
    expect(out()).toContain(
      `claude mcp add -s user --transport stdio ouicu -e OUICU_API=${API} -- npx -y @ouicu/mcp`,
    );
  });

  it("lists the tools when it does not know the one asked for", async () => {
    const { d, out } = deps();
    expect(await runSetup(["emacs"], d)).toBe(1);
    expect(out()).toContain('There is no tool called "emacs".');
    expect(out()).toContain(TOOLS.join(", "));
    expect(await runSetup([], d)).toBe(0);
  });
});
