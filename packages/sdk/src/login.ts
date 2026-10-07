import { saveCredentials } from "./credentials";
import { OuicuError } from "./errors";
import { call, errorOf, sleep, type Http } from "./http";

/*
 * login(): the device login `ouicu login` does (apps/cli/src/api.rs). ouicu
 * gives a code; the person approves it in a browser where they are logged
 * in to ouicu.com; the key that comes back is saved where the CLI keeps it.
 */

export interface LoginCode {
  /** What the person checks on the approval page: "ABCD-2345". */
  userCode: string;
  /** Where they approve it; the code is in the address already. */
  verificationUrl: string;
  /** When the code runs out (ISO). */
  expiresAt: string;
}

export interface LoginOptions {
  /** What this computer is called, shown on the approval page and the dashboard. */
  client?: string;
  /** Show the person the code and where to approve it. */
  onCode: (code: LoginCode) => void;
  signal?: AbortSignal;
}

export interface LoggedIn {
  email: string;
  apiKey: string;
  /** Where the key was saved. */
  path: string;
}

interface Started extends LoginCode {
  deviceCode: string;
  expiresIn: number;
  interval: number;
}

export async function login(
  http: Http,
  client: string,
  options: LoginOptions,
): Promise<LoggedIn> {
  const response = await call(http, "POST", "/api/cli/login", {
    json: { client },
    auth: false,
    signal: options.signal,
  });
  if (!response.ok) throw await errorOf(response);
  const start = (await response.json()) as Started;
  options.onCode({
    userCode: start.userCode,
    verificationUrl: start.verificationUrl,
    expiresAt: start.expiresAt,
  });

  const deadline = Date.now() + start.expiresIn * 1000;
  let interval =
    Math.max(1, Number.isFinite(start.interval) ? start.interval : 5) * 1000;
  for (;;) {
    await sleep(interval, options.signal);
    if (Date.now() > deadline)
      throw new OuicuError(410, "That code ran out. Log in again.");
    let answer: Response;
    try {
      answer = await call(http, "POST", "/api/cli/login/token", {
        json: { deviceCode: start.deviceCode },
        auth: false,
        signal: options.signal,
      });
    } catch (err) {
      // A dropped connection while waiting is worth another try.
      if (options.signal?.aborted) throw err;
      continue;
    }
    if (answer.status === 202) continue;
    if (answer.status === 429) {
      interval += 5000;
      continue;
    }
    if (answer.status !== 200) throw await errorOf(answer);
    const done = (await answer.json()) as { apiKey: string; email: string };
    const path = saveCredentials({
      apiKey: done.apiKey,
      email: done.email,
      api: http.api,
    });
    return { email: done.email, apiKey: done.apiKey, path };
  }
}
