import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

/** The fake CLI (fake-ouicu.mjs). */
export const FAKE_CLI = join(__dirname, "fake-ouicu.mjs");

/** How the fake CLI was run, from the file FAKE_OUICU_RECORD named. */
export function recorded(file: string): {
  args: string[];
  env: Record<string, string>;
  pid: number;
} {
  return JSON.parse(readFileSync(file, "utf8"));
}

export interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Answer = Response | ((seen: Seen) => Response | Promise<Response>);

/**
 * A fake ouicu: `routes` maps "METHOD /path" to an answer (or a list,
 * one per call, the last repeating). Every call is kept in `seen`.
 */
export function fakeApi(routes: Record<string, Answer | Answer[]>) {
  const seen: Seen[] = [];
  const counts = new Map<string, number>();
  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(
      new Headers(init.headers as HeadersInit).entries(),
    );
    let body: unknown = init.body;
    if (typeof body === "string" && headers["content-type"]?.includes("json"))
      body = JSON.parse(body);
    const call: Seen = {
      method: init.method ?? "GET",
      url: `${url.pathname}${url.search}`,
      headers,
      body,
    };
    seen.push(call);
    const key = `${call.method} ${url.pathname}`;
    const route = routes[key];
    if (!route) return json({ error: `No route for ${key}.` }, 404);
    const list = Array.isArray(route) ? route : [route];
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    const answer = list[Math.min(n, list.length - 1)];
    const response = typeof answer === "function" ? await answer(call) : answer;
    return response.clone();
  });
  vi.stubGlobal("fetch", fetch);
  return { seen, fetch };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A home folder of its own, so tests never touch the real credentials. */
export function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "ouicu-sdk-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
  vi.stubEnv("OUICU_API_KEY", "");
  vi.stubEnv("OUICU_API", "");
  vi.stubEnv("OUICU_TUNNEL", "");
  vi.stubEnv("OUICU_BIN", "");
  return home;
}
