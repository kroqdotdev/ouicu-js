import { OuicuError } from "./errors";

declare const PKG_VERSION: string | undefined;

/** This package's version. */
export const VERSION =
  typeof PKG_VERSION !== "undefined" ? PKG_VERSION : "0.0.0-dev";

/** How calls reach ouicu: the site, and the key when a call needs one. */
export interface Http {
  api: string;
  key: () => string;
}

/** Calls to the API answer within this; uploads get longer (deploy.ts). */
export const CALL_TIMEOUT_MS = 20_000;

export interface CallOptions {
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as it is (a file's bytes). */
  body?: Uint8Array<ArrayBuffer>;
  /** False for the login calls, made before there is a key. */
  auth?: boolean;
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * One call to ouicu. Answers whatever ouicu answered; throws only when it
 * did not answer (status 0), or when `signal` stopped it.
 */
export async function call(
  http: Http,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": `ouicu-sdk/${VERSION}`,
  };
  if (options.auth !== false) headers.authorization = `Bearer ${http.key()}`;
  let body: string | Uint8Array<ArrayBuffer> | undefined = options.body;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  const timeout = options.timeout ?? CALL_TIMEOUT_MS;
  const timer = AbortSignal.timeout(timeout);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timer])
    : timer;
  try {
    return await fetch(`${http.api}${path}`, {
      method,
      headers,
      body,
      signal,
    });
  } catch (err) {
    if (options.signal?.aborted) throw options.signal.reason ?? err;
    if (timer.aborted)
      throw new OuicuError(
        0,
        `${http.api} did not answer within ${Math.round(timeout / 1000)} seconds.`,
        { cause: err },
      );
    throw new OuicuError(0, `Could not reach ${http.api}.`, { cause: err });
  }
}

/** The error in an answer that was not a success, in ouicu's words. */
export async function errorOf(response: Response): Promise<OuicuError> {
  let words: string | undefined;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) words = body.error;
  } catch {
    // Not JSON: a proxy's page, say.
  }
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  return new OuicuError(response.status, words ?? `ouicu answered ${status}.`);
}

/** A call whose answer is JSON on success. */
export async function callJson<T>(
  http: Http,
  method: string,
  path: string,
  options?: CallOptions,
): Promise<T> {
  const response = await call(http, method, path, options);
  if (!response.ok) throw await errorOf(response);
  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new OuicuError(response.status, "ouicu answered oddly.", {
      cause: err,
    });
  }
}

/** Waits, unless `signal` stops the wait first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}
