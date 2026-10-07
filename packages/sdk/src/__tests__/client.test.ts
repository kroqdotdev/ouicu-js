import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ouicu } from "../client";
import { OuicuError } from "../errors";
import { fakeApi, freshHome, json } from "./helpers";

beforeEach(() => {
  freshHome();
});

const share = {
  id: "5b1e8f8e-0000-4000-8000-000000000001",
  name: "quiet-otter",
  url: "https://quiet-otter.ouicu.app",
  live: true,
  client: "mads-laptop, Linux",
  startedAt: "2026-10-03T10:00:00.000Z",
  endedAt: null,
  ended: null,
  password: false,
  people: true,
  requests: 12,
  bytes: 34_000,
};

const site = {
  id: "5b1e8f8e-0000-4000-8000-000000000002",
  name: "studio",
  url: "https://studio.ouicu.app",
  files: 2,
  size: 2048,
  uploadedAt: "2026-10-03T09:00:00.000Z",
  expiresAt: null,
  password: true,
  people: false,
  requests: 3,
  bytes: 6144,
};

const requests = {
  available: true,
  visitors: 1,
  requests: [
    {
      at: "2026-10-03T10:01:00.000Z",
      method: "GET",
      path: "/",
      status: 200,
      ms: 9,
      bytes: 512,
      country: "DK",
      device: "phone",
      visitor: 1,
    },
  ],
};

describe("the API", () => {
  it("sends the key and asks the right address for each thing", async () => {
    const api = fakeApi({
      "GET /api/cli/whoami": json({
        email: "mads@example.com",
        name: "Mads",
        plan: { key: "pro", name: "Pro", source: "staff" },
        key: { name: "laptop", prefix: "ocu_ab12" },
      }),
      "GET /api/usage": json({
        plan: "pro",
        month: "2026-10",
        bytes: 1024,
        requests: 4,
        allowanceBytes: 150 * 1024 ** 3,
        resetsAt: "2026-11-01T00:00:00.000Z",
        over: false,
      }),
      "GET /api/shares": json({ shares: [share] }),
      [`POST /api/shares/${share.id}/stop`]: json({
        ok: true,
        message: "Stopped quiet-otter.",
      }),
      [`GET /api/shares/${share.id}/requests`]: json(requests),
      "GET /api/sites": json({ sites: [site] }),
      [`DELETE /api/sites/${site.id}`]: json({ ok: true }),
      [`GET /api/sites/${site.id}/requests`]: json(requests),
    });
    const ouicu = new Ouicu({ apiKey: "ocu_test", api: "http://ouicu.test/" });

    expect((await ouicu.whoami()).email).toBe("mads@example.com");
    expect((await ouicu.usage()).month).toBe("2026-10");
    expect(await ouicu.shares.list()).toEqual([share]);
    expect(await ouicu.shares.stop(share.id)).toEqual({
      message: "Stopped quiet-otter.",
    });
    expect(await ouicu.shares.requests(share.id)).toEqual(requests);
    expect(await ouicu.sites.list()).toEqual([site]);
    await ouicu.sites.delete(site.id);
    expect((await ouicu.sites.requests(site.id)).visitors).toBe(1);

    expect(api.seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET /api/cli/whoami",
      "GET /api/usage",
      "GET /api/shares?limit=30",
      `POST /api/shares/${share.id}/stop`,
      `GET /api/shares/${share.id}/requests`,
      "GET /api/sites",
      `DELETE /api/sites/${site.id}`,
      `GET /api/sites/${site.id}/requests`,
    ]);
    for (const s of api.seen) {
      expect(s.headers.authorization).toBe("Bearer ocu_test");
      expect(s.headers["user-agent"]).toMatch(/^ouicu-sdk\//);
    }
  });

  it("asks for more shares when told to", async () => {
    const api = fakeApi({ "GET /api/shares": json({ shares: [] }) });
    await new Ouicu({ apiKey: "ocu_test" }).shares.list({ limit: 100 });
    expect(api.seen[0].url).toBe("/api/shares?limit=100");
  });

  it("goes to ouicu.com unless OUICU_API says another", async () => {
    const api = fakeApi({ "GET /api/usage": json({}) });
    await new Ouicu({ apiKey: "ocu_test" }).usage();
    expect(api.fetch.mock.calls[0][0]).toBe("https://ouicu.com/api/usage");
    vi.stubEnv("OUICU_API", "http://localhost:3232");
    expect(new Ouicu().api).toBe("http://localhost:3232");
  });

  it("keeps the ids in the address as they are given", async () => {
    const api = fakeApi({});
    await new Ouicu({ apiKey: "ocu_test" }).sites
      .delete("../cli/whoami")
      .catch(() => {});
    expect(api.seen[0].url).toBe("/api/sites/..%2Fcli%2Fwhoami");
  });
});

describe("errors", () => {
  it("carry ouicu's words and the status", async () => {
    fakeApi({
      "GET /api/usage": json(
        { error: "That API key does not work. Run `ouicu login`." },
        401,
      ),
      "GET /api/sites": json(
        { error: "Confirm your email address first." },
        403,
      ),
    });
    const ouicu = new Ouicu({ apiKey: "ocu_test" });
    await expect(ouicu.usage()).rejects.toMatchObject({
      name: "OuicuError",
      status: 401,
      message: "That API key does not work. Run `ouicu login`.",
    });
    await expect(ouicu.sites.list()).rejects.toMatchObject({
      status: 403,
      message: "Confirm your email address first.",
    });
  });

  it("say what came back when it was not ouicu's JSON", async () => {
    fakeApi({
      "GET /api/usage": new Response("<html>Bad gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    });
    await expect(
      new Ouicu({ apiKey: "ocu_test" }).usage(),
    ).rejects.toMatchObject({
      status: 502,
      message: "ouicu answered 502 Bad Gateway.",
    });
  });

  it("have status 0 when ouicu could not be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const error = await new Ouicu({
      apiKey: "ocu_test",
      api: "http://ouicu.test",
    })
      .usage()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OuicuError);
    expect(error).toMatchObject({
      status: 0,
      message: "Could not reach http://ouicu.test.",
    });
  });

  it("come before any call when there is no key", async () => {
    const api = fakeApi({});
    await expect(new Ouicu().whoami()).rejects.toMatchObject({ status: 401 });
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
