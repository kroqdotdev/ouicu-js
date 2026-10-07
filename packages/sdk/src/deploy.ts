import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { OuicuError } from "./errors";
import { call, callJson, errorOf, sleep, type Http } from "./http";
import type { Skipped } from "./types";

/*
 * deploy(): puts a built site up at a name, as `ouicu deploy` does
 * (apps/cli/src/deploy.rs), with the same rules. The list of files goes
 * first, each with its SHA-256; ouicu answers which it does not have yet,
 * only those are uploaded, and finishing the upload makes it what visitors
 * see.
 */

/** A folder this big is not a built site (a project's root, say). */
const MOST_FILES = 5_000;
const MOST_BYTES = 1024 * 1024 * 1024;
/** Uploads at once. */
const AT_ONCE = 6;
/** Time for a large file over a slow line. */
const UPLOAD_TIMEOUT_MS = 600_000;
/** Each file is tried this many times, waiting 1 s, then 2 s, between. */
const TRIES = 3;

export interface DeployOptions {
  /** One of your sites to replace, or a reserved name (Hobby and Pro). */
  name?: string;
  /** A single-page app: unknown paths get index.html. */
  spa?: boolean;
  /** What visitors must type to open it (Hobby and Pro), 8 to 200 characters. */
  password?: string;
  /** Files uploaded so far, of those ouicu asked for. */
  onProgress?: (progress: { sent: number; total: number }) => void;
  signal?: AbortSignal;
}

export interface Deployed {
  url: string;
  name: string;
  /** Files in the site, and their bytes. */
  files: number;
  bytes: number;
  /** When it goes (Free: a week after this upload), or null. */
  expiresAt: string | null;
  /** Files ouicu left out, and why. */
  skipped: Skipped[];
}

export interface LocalFile {
  /** "/assets/app.js", as visitors ask for it. */
  path: string;
  /** Where it is on this computer. */
  file: string;
  size: number;
  sha256: string;
}

interface Started {
  deployId: string;
  files: number;
  bytes: number;
  missing: string[];
  skipped: Skipped[];
}

/** The password rules the CLI checks before sending one. */
export function passwordProblem(password: string): string | null {
  const length = [...password].length;
  if (length < 8) return "Use a password of at least 8 characters.";
  if (length > 200) return "Keep the password under 200 characters.";
  return null;
}

export async function deploy(
  http: Http,
  dir: string,
  client: string,
  options: DeployOptions = {},
): Promise<Deployed> {
  if (options.password !== undefined) {
    const problem = passwordProblem(options.password);
    if (problem) throw new OuicuError(0, problem);
  }
  const folder = await stat(dir).catch(() => null);
  if (!folder?.isDirectory())
    throw new OuicuError(0, `${dir} is not a folder.`);
  const files = await collect(dir);
  if (files.length === 0)
    throw new OuicuError(0, `${dir} has no files to put up.`);

  const started = await callJson<Started>(http, "POST", "/api/deploys", {
    json: {
      name: options.name || null,
      spa: options.spa === true,
      password: options.password || null,
      client,
      files: files.map((f) => ({
        path: f.path,
        size: f.size,
        sha256: f.sha256,
      })),
    },
    timeout: UPLOAD_TIMEOUT_MS,
    signal: options.signal,
  });

  await upload(http, files, started, options);

  const done = await callJson<{
    name: string;
    url: string;
    expiresAt: string | null;
  }>(http, "POST", `/api/deploys/${started.deployId}/finish`, {
    timeout: UPLOAD_TIMEOUT_MS,
    signal: options.signal,
  });
  return {
    url: done.url,
    name: done.name,
    files: started.files,
    bytes: started.bytes,
    expiresAt: done.expiresAt ?? null,
    skipped: started.skipped ?? [],
  };
}

/** Sends the files ouicu asked for, a few at a time, saying how far it got. */
async function upload(
  http: Http,
  files: LocalFile[],
  started: Started,
  options: DeployOptions,
): Promise<void> {
  const bySha = new Map<string, LocalFile>();
  for (const f of files) if (!bySha.has(f.sha256)) bySha.set(f.sha256, f);
  const queue = started.missing.map((sha) => {
    const local = bySha.get(sha);
    if (!local)
      throw new OuicuError(
        0,
        "ouicu asked for a file this folder does not have.",
      );
    return { sha, local };
  });
  const total = queue.length;
  if (total === 0) return;
  options.onProgress?.({ sent: 0, total });

  // One failure stops the rest.
  const failed = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, failed.signal])
    : failed.signal;
  let next = 0;
  let sent = 0;
  const worker = async () => {
    while (next < queue.length && !signal.aborted) {
      const { sha, local } = queue[next++];
      const path = `/api/deploys/${started.deployId}/blobs/${sha}`;
      try {
        await put(http, path, local.file, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        const why = err instanceof Error ? err.message : String(err);
        throw new OuicuError(
          err instanceof OuicuError ? err.status : 0,
          `Could not upload ${local.path}: ${why}`,
          { cause: err },
        );
      }
      sent += 1;
      options.onProgress?.({ sent, total });
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, total) }, worker));
  } catch (err) {
    failed.abort();
    throw err;
  }
}

/**
 * One file. A refusal (4xx) ends it at once; a server error or no answer
 * is tried again, three times in all.
 */
async function put(
  http: Http,
  path: string,
  file: string,
  signal: AbortSignal,
): Promise<void> {
  let wait = 1000;
  for (let attempt = 1; ; attempt++) {
    const body = await readFile(file);
    let failure: unknown;
    try {
      const response = await call(http, "PUT", path, {
        body,
        timeout: UPLOAD_TIMEOUT_MS,
        signal,
      });
      if (response.ok) return;
      failure = await errorOf(response);
      if (response.status >= 400 && response.status < 500) throw failure;
    } catch (err) {
      if (signal.aborted || err === failure) throw err;
      failure = err;
    }
    if (attempt === TRIES) throw failure;
    await sleep(wait, signal);
    wait *= 2;
  }
}

/**
 * Every file under the folder, with its hash. Dot files (but .well-known
 * at the top), node_modules and links are left out.
 */
export async function collect(root: string): Promise<LocalFile[]> {
  const files: LocalFile[] = [];
  let total = 0;
  const dirs: [string, string][] = [[root, ""]];
  while (dirs.length > 0) {
    const [dir, prefix] = dirs.pop()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      (err: unknown) => {
        throw new OuicuError(0, `Could not read ${dir}.`, { cause: err });
      },
    );
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const name = entry.name;
      const keptDot = prefix === "" && name === ".well-known";
      if ((name.startsWith(".") && !keptDot) || name === "node_modules")
        continue;
      const path = `${prefix}/${name}`;
      const full = join(dir, name);
      // Dirents describe links as links, so a link is neither.
      if (entry.isDirectory()) dirs.push([full, path]);
      else if (entry.isFile()) {
        const { size } = await stat(full);
        total += size;
        if (files.length >= MOST_FILES || total > MOST_BYTES)
          throw new OuicuError(
            0,
            `${root} holds more than 20,000 files or 1 GB, more than a built site. Deploy the folder your build writes, like ./dist.`,
          );
        files.push({ path, file: full, size, sha256: await sha256Of(full) });
      }
    }
  }
  return files;
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", (err) =>
        reject(new OuicuError(0, `Could not read ${file}.`, { cause: err })),
      );
  });
}
