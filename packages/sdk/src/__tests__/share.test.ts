import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ouicu } from "../client";
import { older, type ShareEvent, type ShareRequest } from "../share";
import { FAKE_CLI, freshHome, recorded as recordedIn } from "./helpers";

let home: string;
beforeEach(() => {
  home = freshHome();
});

const ouicu = (options = {}) =>
  new Ouicu({
    apiKey: "ocu_test",
    api: "http://ouicu.test",
    bin: FAKE_CLI,
    ...options,
  });

/** What the fake CLI was run with. */
const recorded = () => recordedIn(join(home, "record.json"));

/** The fake CLI at a path of its own, so its version is checked afresh. */
const fakeAt = (dots: number) =>
  `${FAKE_CLI.replace(/\/[^/]+$/, "")}/${"./".repeat(dots)}fake-ouicu.mjs`;

describe("share()", () => {
  it("resolves with the link once the CLI says it is live", async () => {
    vi.stubEnv("FAKE_OUICU_RECORD", join(home, "record.json"));
    const live = await ouicu().share(3000);
    try {
      expect(live).toMatchObject({
        url: "https://quiet-otter.ouicu.app",
        name: "quiet-otter",
        expiresAt: "2026-10-03T12:00:00.000Z",
        notice: true,
        password: false,
        people: false,
        port: 3000,
      });
      expect(recorded().args).toEqual([
        "share",
        "3000",
        "--json",
        "--until-stdin-closes",
      ]);
    } finally {
      await live.stop();
    }
  });

  it("gives the CLI the key, the site and the tunnel through its environment", async () => {
    vi.stubEnv("FAKE_OUICU_RECORD", join(home, "record.json"));
    const live = await ouicu({ tunnel: "ws://localhost:4000" }).share(3000, {
      name: "studio",
      password: "a long password",
    });
    await live.stop();
    const { args, env } = recorded();
    expect(args).toEqual([
      "share",
      "3000",
      "--json",
      "--until-stdin-closes",
      "--name",
      "studio",
      "--password",
    ]);
    expect(env).toEqual({
      OUICU_API_KEY: "ocu_test",
      OUICU_API: "http://ouicu.test",
      OUICU_TUNNEL: "ws://localhost:4000",
      OUICU_PASSWORD: "a long password",
    });
    // Never in the arguments, which anyone on the computer can list.
    expect(args.join(" ")).not.toContain("a long password");
  });

  it("passes visitors' requests and ouicu's notices on as they come", async () => {
    const requests: ShareRequest[] = [];
    const notices: string[] = [];
    const events: ShareEvent["event"][] = [];
    const live = await ouicu().share(3000, {
      onRequest: (r) => requests.push(r),
      onNotice: (t) => notices.push(t),
      onEvent: (e) => events.push(e.event),
    });
    await vi.waitFor(() => expect(events).toContain("reconnected"));
    await live.stop();
    expect(requests).toEqual([
      { method: "GET", path: "/pricing", status: 200, ms: 12 },
    ]);
    expect(notices).toEqual(["Kept back /movie.mp4: not part of a web page."]);
    expect(events).toEqual([
      "live",
      "notice",
      "request",
      "retrying",
      "reconnected",
      "stopped",
    ]);
  });

  it("stops the CLI and says so when stopped", async () => {
    const live = await ouicu().share(3000);
    await live.stop();
    expect(await live.closed).toEqual({
      reason: "you stopped it on this computer",
    });
    // Stopping twice is fine.
    await live.stop();
  });

  it("kills a CLI that does not stop when asked", async () => {
    vi.stubEnv("FAKE_OUICU_PLAY", "ignores-sigint");
    const live = await ouicu().share(3000);
    await live.stop();
    expect((await live.closed).reason).toBe("you stopped it on this computer");
  }, 10_000);

  it("tells when ouicu ends the share", async () => {
    vi.stubEnv("FAKE_OUICU_PLAY", "stopped-on-ouicu");
    const live = await ouicu().share(3000);
    expect(await live.closed).toEqual({
      reason: "you stopped it on ouicu.com",
    });
  });

  it("rejects with the CLI's words when it is refused", async () => {
    vi.stubEnv("FAKE_OUICU_PLAY", "refused");
    await expect(ouicu().share(3000, { name: "taken" })).rejects.toMatchObject({
      status: 0,
      message: "That name is taken.",
    });
  });

  it("rejects with what the CLI printed when it fails another way", async () => {
    vi.stubEnv("FAKE_OUICU_PLAY", "crash");
    await expect(ouicu().share(3000)).rejects.toThrow("thread 'main' panicked");
  });

  it("gives up when the link does not come, with the last reason", async () => {
    vi.stubEnv("FAKE_OUICU_PLAY", "never");
    // Long enough for the fake CLI, a Node process, to start and say why
    // on a slow runner.
    await expect(ouicu().share(3000, { timeout: 2_000 })).rejects.toThrow(
      "The share did not open within 2 seconds: Could not reach the tunnel.",
    );
  });

  it("says how to install the CLI when there is none", async () => {
    await expect(
      ouicu({ bin: join(home, "no-such-ouicu") }).share(3000),
    ).rejects.toThrow("curl -fsSL https://ouicu.com/install.sh | sh");
  });

  it("says how to install the CLI in PowerShell on Windows", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      vi.resetModules();
      const { INSTALL_COMMAND } = await import("../share");
      expect(INSTALL_COMMAND).toBe("irm https://ouicu.com/install.ps1 | iex");
    } finally {
      Object.defineProperty(process, "platform", platform);
      vi.resetModules();
    }
  });

  it("says how to update a CLI too old for this", async () => {
    vi.stubEnv("FAKE_OUICU_VERSION", "0.1.6");
    // Its own path, so the check is not the one remembered from other tests.
    await expect(ouicu({ bin: fakeAt(1) }).share(3000)).rejects.toThrow(
      /needs the ouicu CLI 0\.1\.7 or later, and this computer has 0\.1\.6\. Update it with `ouicu update`/,
    );
  });

  it("lets only the people allow names open it, given to the CLI as one argument", async () => {
    vi.stubEnv("FAKE_OUICU_RECORD", join(home, "record.json"));
    const live = await ouicu().share(3000, {
      name: "client",
      allow: [" anna@acme.example ", "@client.example", ""],
    });
    await live.stop();
    expect(live).toMatchObject({ people: true, password: false });
    expect(recorded().args).toEqual([
      "share",
      "3000",
      "--json",
      "--until-stdin-closes",
      "--name",
      "client",
      "--allow=anna@acme.example,@client.example",
    ]);
  });

  it("refuses allow with a password before running the CLI", async () => {
    vi.stubEnv("FAKE_OUICU_RECORD", join(home, "record.json"));
    await expect(
      ouicu().share(3000, {
        allow: ["anna@acme.example"],
        password: "a long password",
      }),
    ).rejects.toMatchObject({
      status: 0,
      message:
        "A share takes a password or a list of people (allow), not both.",
    });
    expect(existsSync(join(home, "record.json"))).toBe(false);
  });

  it("refuses an empty allow, which would let anyone in", async () => {
    vi.stubEnv("FAKE_OUICU_RECORD", join(home, "record.json"));
    for (const allow of [[], [" ", ""], "anna@acme.example"])
      await expect(
        ouicu().share(3000, { allow: allow as string[] }),
      ).rejects.toThrow(
        'allow is a list of email addresses, or "@" and a domain for everyone at one, and it needs at least one.',
      );
    expect(existsSync(join(home, "record.json"))).toBe(false);
  });

  it("needs the CLI 0.1.8 for allow, while 0.1.7 still shares with anyone", async () => {
    vi.stubEnv("FAKE_OUICU_VERSION", "0.1.7");
    const bin = fakeAt(2);
    const live = await ouicu({ bin }).share(3000);
    await live.stop();
    // 0.1.7 does not say, and it has no lists.
    expect(live.people).toBe(false);
    vi.stubEnv("FAKE_OUICU_RECORD", join(home, "record.json"));
    await expect(
      ouicu({ bin }).share(3000, { allow: ["anna@acme.example"] }),
    ).rejects.toThrow(
      "Sharing a port with only invited people (allow) needs the ouicu CLI 0.1.8 or later, and this computer has 0.1.7. Update it with `ouicu update`",
    );
    expect(existsSync(join(home, "record.json"))).toBe(false);
  });

  it("refuses what is not a port", async () => {
    await expect(ouicu().share(70000)).rejects.toThrow("is not a port");
  });

  it("needs a key before it runs anything", async () => {
    await expect(
      new Ouicu({ bin: FAKE_CLI }).share(3000),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("CLI versions", () => {
  it("compare part by part", () => {
    expect(older("0.1.6", "0.1.7")).toBe(true);
    expect(older("0.1.10", "0.1.7")).toBe(false);
    expect(older("0.1.7", "0.1.7")).toBe(false);
    expect(older("1.0.0", "0.1.7")).toBe(false);
  });
});
