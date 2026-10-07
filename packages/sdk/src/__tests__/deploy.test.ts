import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Ouicu } from "../client";
import { collect } from "../deploy";
import { fakeApi, freshHome, json, type Seen } from "./helpers";

beforeEach(() => {
  freshHome();
});

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A folder with these files in it. */
function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ouicu-dist-"));
  for (const [path, body] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return root;
}

const site = {
  "index.html": "<h1>hi</h1>",
  "assets/app.js": "console.log(1)",
  "assets/copy.js": "console.log(1)",
  "assets/site.css": "h1 { color: teal }",
};

const DEPLOY = "5b1e8f8e-0000-4000-8000-0000000000aa";

function started(missing: string[], extra = {}) {
  return json({
    deployId: DEPLOY,
    name: "quiet-otter",
    url: "https://quiet-otter.ouicu.app",
    files: 4,
    bytes: 64,
    missing,
    skipped: [],
    ...extra,
  });
}

const finished = json({
  name: "quiet-otter",
  url: "https://quiet-otter.ouicu.app",
  expiresAt: "2026-10-10T09:00:00.000Z",
});

describe("the files taken", () => {
  it("leave out dot files (but .well-known at the top), node_modules and links", async () => {
    const root = folder({
      "index.html": "<h1>hi</h1>",
      "assets/app.js": "1",
      ".well-known/security.txt": "x",
      ".env": "SECRET=1",
      "node_modules/x/index.js": "x",
      "assets/.DS_Store": "x",
      "docs/.well-known/x.txt": "x",
    });
    symlinkSync("/etc/passwd", join(root, "passwd.txt"));
    symlinkSync(join(root, "assets"), join(root, "linked"));
    const paths = (await collect(root)).map((f) => f.path).sort();
    expect(paths).toEqual([
      "/.well-known/security.txt",
      "/assets/app.js",
      "/index.html",
    ]);
  });

  it("carry each file's size and SHA-256", async () => {
    const root = folder({ "index.html": "<h1>hi</h1>" });
    expect(await collect(root)).toEqual([
      {
        path: "/index.html",
        file: join(root, "index.html"),
        size: 11,
        sha256: sha("<h1>hi</h1>"),
      },
    ]);
  });
});

describe("deploy()", () => {
  it("lists the files, uploads only the missing ones, then finishes", async () => {
    const root = folder(site);
    const api = fakeApi({
      "POST /api/deploys": started([sha("console.log(1)")], {
        skipped: [{ path: "/movie.mp4", why: "not part of a web page" }],
      }),
      [`PUT /api/deploys/${DEPLOY}/blobs/${sha("console.log(1)")}`]: json({
        ok: true,
      }),
      [`POST /api/deploys/${DEPLOY}/finish`]: finished,
    });
    const progress: { sent: number; total: number }[] = [];
    const done = await new Ouicu({ apiKey: "ocu_test" }).deploy(root, {
      name: "quiet-otter",
      spa: true,
      onProgress: (p) => progress.push(p),
    });

    expect(done).toEqual({
      url: "https://quiet-otter.ouicu.app",
      name: "quiet-otter",
      files: 4,
      bytes: 64,
      expiresAt: "2026-10-10T09:00:00.000Z",
      skipped: [{ path: "/movie.mp4", why: "not part of a web page" }],
    });
    const listing = api.seen[0].body as {
      name: string;
      spa: boolean;
      password: string | null;
      client: string;
      files: { path: string; size: number; sha256: string }[];
    };
    expect(listing).toMatchObject({
      name: "quiet-otter",
      spa: true,
      password: null,
    });
    expect(listing.client).toMatch(/, (Linux|macOS|Windows|\w+)$/);
    expect(listing.files.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "/assets/app.js", size: 14, sha256: sha("console.log(1)") },
      { path: "/assets/copy.js", size: 14, sha256: sha("console.log(1)") },
      { path: "/assets/site.css", size: 18, sha256: sha("h1 { color: teal }") },
      { path: "/index.html", size: 11, sha256: sha("<h1>hi</h1>") },
    ]);
    // One upload for the two copies, as its raw bytes.
    const puts = api.seen.filter((s) => s.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(Buffer.from(puts[0].body as Uint8Array).toString()).toBe(
      "console.log(1)",
    );
    expect(api.seen.at(-1)?.url).toBe(`/api/deploys/${DEPLOY}/finish`);
    expect(progress).toEqual([
      { sent: 0, total: 1 },
      { sent: 1, total: 1 },
    ]);
  });

  it("uploads nothing when ouicu has every file", async () => {
    const api = fakeApi({
      "POST /api/deploys": started([]),
      [`POST /api/deploys/${DEPLOY}/finish`]: finished,
    });
    await new Ouicu({ apiKey: "ocu_test" }).deploy(folder(site));
    expect(api.seen.map((s) => s.method)).toEqual(["POST", "POST"]);
  });

  it("uploads six files at once at most", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`page${i}.html`] = `<p>${i}</p>`;
    let now = 0;
    let most = 0;
    const slowly = async () => {
      now += 1;
      most = Math.max(most, now);
      await new Promise((r) => setTimeout(r, 5));
      now -= 1;
      return json({ ok: true });
    };
    const routes: Record<string, (s: Seen) => Promise<Response>> = {};
    for (const body of Object.values(files))
      routes[`PUT /api/deploys/${DEPLOY}/blobs/${sha(body)}`] = slowly;
    fakeApi({
      "POST /api/deploys": started(Object.values(files).map(sha)),
      ...routes,
      [`POST /api/deploys/${DEPLOY}/finish`]: finished,
    });
    await new Ouicu({ apiKey: "ocu_test" }).deploy(folder(files));
    expect(most).toBe(6);
  });

  it("tries a file again after a server error, three times in all", async () => {
    const blob = `PUT /api/deploys/${DEPLOY}/blobs/${sha("<h1>hi</h1>")}`;
    const api = fakeApi({
      "POST /api/deploys": started([sha("<h1>hi</h1>")]),
      [blob]: [json({ error: "busy" }, 503), json({ ok: true })],
      [`POST /api/deploys/${DEPLOY}/finish`]: finished,
    });
    await new Ouicu({ apiKey: "ocu_test" }).deploy(
      folder({ "index.html": "<h1>hi</h1>" }),
    );
    expect(api.seen.filter((s) => s.method === "PUT")).toHaveLength(2);
  });

  it("gives up after three server errors, saying which file", async () => {
    const blob = `PUT /api/deploys/${DEPLOY}/blobs/${sha("<h1>hi</h1>")}`;
    const api = fakeApi({
      "POST /api/deploys": started([sha("<h1>hi</h1>")]),
      [blob]: json({ error: "The box is full." }, 507),
    });
    await expect(
      new Ouicu({ apiKey: "ocu_test" }).deploy(
        folder({ "index.html": "<h1>hi</h1>" }),
      ),
    ).rejects.toMatchObject({
      status: 507,
      message: "Could not upload /index.html: The box is full.",
    });
    expect(api.seen.filter((s) => s.method === "PUT")).toHaveLength(3);
  }, 10_000);

  it("stops at a refusal without trying again", async () => {
    const blob = `PUT /api/deploys/${DEPLOY}/blobs/${sha("<h1>hi</h1>")}`;
    const api = fakeApi({
      "POST /api/deploys": started([sha("<h1>hi</h1>")]),
      [blob]: json({ error: "The file does not match its hash." }, 400),
    });
    await expect(
      new Ouicu({ apiKey: "ocu_test" }).deploy(
        folder({ "index.html": "<h1>hi</h1>" }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message:
        "Could not upload /index.html: The file does not match its hash.",
    });
    expect(api.seen.filter((s) => s.method === "PUT")).toHaveLength(1);
  });

  it("passes on ouicu's refusal of the upload", async () => {
    fakeApi({
      "POST /api/deploys": json(
        {
          error: "This month's data is used up. It resets on 1 November.",
        },
        429,
      ),
    });
    await expect(
      new Ouicu({ apiKey: "ocu_test" }).deploy(folder(site)),
    ).rejects.toMatchObject({
      status: 429,
      message: "This month's data is used up. It resets on 1 November.",
    });
  });

  it("sends a password, and checks its length first", async () => {
    const api = fakeApi({
      "POST /api/deploys": started([]),
      [`POST /api/deploys/${DEPLOY}/finish`]: finished,
    });
    const ouicu = new Ouicu({ apiKey: "ocu_test" });
    await expect(
      ouicu.deploy(folder(site), { password: "short" }),
    ).rejects.toThrow("Use a password of at least 8 characters.");
    expect(api.fetch).not.toHaveBeenCalled();
    await ouicu.deploy(folder(site), { password: "long enough" });
    expect(api.seen[0].body).toMatchObject({ password: "long enough" });
  });

  it("refuses what is not a folder, or holds nothing to put up", async () => {
    const ouicu = new Ouicu({ apiKey: "ocu_test" });
    const root = folder({ ".env": "x", "node_modules/a.js": "x" });
    await expect(ouicu.deploy(join(root, ".env"))).rejects.toThrow(
      "is not a folder.",
    );
    await expect(ouicu.deploy(root)).rejects.toThrow("has no files to put up.");
  });

  it("refuses to upload a file ouicu named that the folder does not have", async () => {
    fakeApi({ "POST /api/deploys": started([sha("something else")]) });
    await expect(
      new Ouicu({ apiKey: "ocu_test" }).deploy(folder(site)),
    ).rejects.toThrow("ouicu asked for a file this folder does not have.");
  });
});
