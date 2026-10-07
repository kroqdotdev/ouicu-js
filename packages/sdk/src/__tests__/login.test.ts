import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ouicu } from "../client";
import { credentialsPath } from "../credentials";
import type { LoginCode } from "../login";
import { fakeApi, freshHome, json } from "./helpers";

beforeEach(() => {
  freshHome();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const start = json({
  deviceCode: "d".repeat(40),
  userCode: "ABCD-2345",
  verificationUrl: "http://ouicu.test/cli?code=ABCD-2345",
  expiresAt: "2026-10-03T10:15:00.000Z",
  expiresIn: 900,
  interval: 5,
});

describe("login()", () => {
  it("shows the code, waits for approval and saves the key where the CLI keeps it", async () => {
    const api = fakeApi({
      "POST /api/cli/login": start,
      "POST /api/cli/login/token": [
        json({ status: "pending" }, 202),
        json({
          status: "approved",
          apiKey: "ocu_new",
          email: "mads@example.com",
        }),
      ],
    });
    const codes: LoginCode[] = [];
    const ouicu = new Ouicu({ api: "http://ouicu.test" });
    const done = ouicu.login({
      client: "build box, Linux",
      onCode: (c) => codes.push(c),
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await done).toEqual({
      email: "mads@example.com",
      apiKey: "ocu_new",
      path: credentialsPath(),
    });
    expect(codes).toEqual([
      {
        userCode: "ABCD-2345",
        verificationUrl: "http://ouicu.test/cli?code=ABCD-2345",
        expiresAt: "2026-10-03T10:15:00.000Z",
      },
    ]);
    expect(api.seen[0].body).toEqual({ client: "build box, Linux" });
    expect(api.seen[0].headers.authorization).toBeUndefined();
    expect(api.seen[1].body).toEqual({ deviceCode: "d".repeat(40) });
    expect(JSON.parse(readFileSync(credentialsPath(), "utf8"))).toEqual({
      apiKey: "ocu_new",
      email: "mads@example.com",
      api: "http://ouicu.test",
    });
    // The client uses it from then on.
    expect(ouicu.apiKey()).toBe("ocu_new");
  });

  it("asks less often when ouicu says too many", async () => {
    const api = fakeApi({
      "POST /api/cli/login": start,
      "POST /api/cli/login/token": [
        json({ error: "Too many." }, 429),
        json({ status: "approved", apiKey: "ocu_new", email: "a@b.c" }),
      ],
    });
    const done = new Ouicu({ api: "http://ouicu.test" }).login({
      onCode: () => {},
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(api.seen).toHaveLength(2);
    // Five seconds more than before: not yet at 9 s.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(api.seen).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(api.seen).toHaveLength(3);
  });

  it("ends with ouicu's words when the code runs out", async () => {
    fakeApi({
      "POST /api/cli/login": start,
      "POST /api/cli/login/token": json(
        {
          status: "expired",
          error: "The login ran out. Run `ouicu login` again.",
        },
        410,
      ),
    });
    const done = new Ouicu({ api: "http://ouicu.test" }).login({
      onCode: () => {},
    });
    const failed = expect(done).rejects.toMatchObject({
      status: 410,
      message: "The login ran out. Run `ouicu login` again.",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await failed;
  });

  it("can be called off while it waits", async () => {
    fakeApi({
      "POST /api/cli/login": start,
      "POST /api/cli/login/token": json({ status: "pending" }, 202),
    });
    const stop = new AbortController();
    const done = new Ouicu({ api: "http://ouicu.test" }).login({
      onCode: () => stop.abort(new Error("called off")),
      signal: stop.signal,
    });
    await expect(done).rejects.toThrow("called off");
  });
});
