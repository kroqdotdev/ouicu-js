import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { OuicuError } from "./errors";

/*
 * share(): runs the ouicu CLI (`ouicu share <port> --json`) and reads the
 * events it prints, one JSON object a line (apps/cli/src/events.rs). The
 * tunnel is the CLI's: this only starts it, listens and stops it.
 */

/** How to install the CLI on this computer: in PowerShell on Windows. */
export const INSTALL_COMMAND =
  process.platform === "win32"
    ? "irm https://ouicu.com/install.ps1 | iex"
    : "curl -fsSL https://ouicu.com/install.sh | sh";
/** The first CLI that prints --json events. */
export const LEAST_CLI_VERSION = "0.1.7";
/** The first CLI that takes --allow, for a share only invited people may open. */
export const ALLOW_CLI_VERSION = "0.1.8";
/** How long share() waits for the link before giving up. */
const OPEN_TIMEOUT_MS = 60_000;
/** How long stop() waits for the CLI before killing it. */
const STOP_TIMEOUT_MS = 5_000;

export interface ShareRequest {
  method: string;
  path: string;
  status: number;
  ms: number;
}

/** What `ouicu share --json` prints. */
export type ShareEvent =
  | {
      event: "live";
      url: string;
      name: string;
      expiresAt: string | null;
      notice: boolean;
      password: boolean;
      /** Whether only invited people may open it (CLI 0.1.8 and later). */
      people?: boolean;
    }
  | { event: "reconnected" }
  | ({ event: "request" } & ShareRequest)
  | { event: "notice"; text: string }
  | { event: "retrying"; message: string; seconds: number }
  | { event: "stopped"; reason: string }
  | { event: "error"; message: string };

export interface ShareOptions {
  /** A reserved name (Hobby and Pro): <name>.ouicu.app. */
  name?: string;
  /** What visitors must type to open it (Hobby and Pro), 8 to 200 characters. */
  password?: string;
  /**
   * Only these people may open it (Pro): email addresses, or "@client.com"
   * for everyone at one domain, up to 50. A visitor types their address on
   * ouicu's page and, if it is on the list, gets a sign-in link by email.
   * Not with `password`. Needs the ouicu CLI 0.1.8 or later.
   */
  allow?: string[];
  /** Each visitor request, as it is answered. */
  onRequest?: (request: ShareRequest) => void;
  /** Something ouicu said about the share, such as a file it kept back. */
  onNotice?: (text: string) => void;
  /** Every event the CLI prints, including reconnects. */
  onEvent?: (event: ShareEvent) => void;
  /** How long to wait for the link, in milliseconds (60 s). */
  timeout?: number;
}

export interface LiveShare {
  url: string;
  name: string;
  /** When the plan's time runs out (ISO), or null without a limit. */
  expiresAt: string | null;
  /** Whether visitors see ouicu's notice before the page (Free). */
  notice: boolean;
  /** Whether visitors need a password. */
  password: boolean;
  /**
   * Whether only invited people may open it: those in `allow`, or on the
   * reserved name's own list. They sign in with a link ouicu emails them.
   */
  people: boolean;
  /** The port on this computer it forwards to. */
  port: number;
  /** Stops the share and waits for the CLI to exit. */
  stop(): Promise<void>;
  /** Settles when the share ends, however it ends, with why. */
  closed: Promise<{ reason: string }>;
}

export interface Runner {
  bin: string;
  env: Record<string, string>;
}

/** CLIs still running, stopped if this process exits first. */
const running = new Set<ChildProcess>();
let exitHook = false;

function watch(child: ChildProcess) {
  running.add(child);
  if (!exitHook) {
    exitHook = true;
    process.on("exit", () => {
      for (const c of running) c.kill("SIGTERM");
    });
  }
}

const checked = new Map<string, Promise<void>>();

/**
 * Checks the CLI is there and at least `least` (the first with --json
 * unless told another), once per process. Throws with how to install or
 * update it; `doing` is what needs it, in words.
 */
export function checkCli(
  bin: string,
  least = LEAST_CLI_VERSION,
  doing = "Sharing a port",
): Promise<void> {
  const key = `${bin}\n${least}`;
  let check = checked.get(key);
  if (!check) {
    check = versionOf(bin).then((version) => {
      if (older(version, least))
        throw new OuicuError(
          0,
          `${doing} needs the ouicu CLI ${least} or later, and this computer has ${version}. Update it with \`ouicu update\`, or install it again: ${INSTALL_COMMAND}`,
        );
    });
    // A failed check is tried again, after an install say.
    check.catch(() => checked.delete(key));
    checked.set(key, check);
  }
  return check;
}

function versionOf(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ["--version"], { timeout: 10_000 }, (err, stdout) => {
      if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT")
        return reject(
          new OuicuError(
            0,
            bin === "ouicu"
              ? `Sharing a port needs the ouicu CLI, which is not installed. Install it with: ${INSTALL_COMMAND}`
              : `Sharing a port needs the ouicu CLI, and there is none at ${bin}. Install it with: ${INSTALL_COMMAND}`,
          ),
        );
      if (err)
        return reject(
          new OuicuError(0, `Could not run ${bin} --version: ${err.message}`, {
            cause: err,
          }),
        );
      const found = /(\d+)\.(\d+)\.(\d+)/.exec(stdout);
      if (!found)
        return reject(
          new OuicuError(0, `${bin} does not look like the ouicu CLI.`),
        );
      resolve(found[0]);
    });
  });
}

/** Whether version a comes before b ("0.1.6" before "0.1.7"). */
export function older(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i];
  return false;
}

/**
 * The people `allow` names, trimmed, or undefined without it. Refuses it
 * with a password, and an empty list, which would share with everyone.
 */
function allowed(options: ShareOptions): string[] | undefined {
  if (options.allow === undefined) return undefined;
  if (options.password !== undefined)
    throw new OuicuError(
      0,
      "A share takes a password or a list of people (allow), not both.",
    );
  const list: unknown = options.allow;
  const people =
    Array.isArray(list) && list.every((p) => typeof p === "string")
      ? list.map((p) => p.trim()).filter(Boolean)
      : [];
  if (people.length === 0)
    throw new OuicuError(
      0,
      'allow is a list of email addresses, or "@" and a domain for everyone at one, and it needs at least one.',
    );
  return people;
}

export async function share(
  runner: Runner,
  port: number,
  options: ShareOptions = {},
): Promise<LiveShare> {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new OuicuError(0, `${port} is not a port (1 to 65535).`);
  const allow = allowed(options);
  if (allow)
    await checkCli(
      runner.bin,
      ALLOW_CLI_VERSION,
      "Sharing a port with only invited people (allow)",
    );
  else await checkCli(runner.bin);

  // The CLI stops when its stdin closes, which it does when this process
  // ends however it ends, so no share outlives the program that started it.
  const args = ["share", String(port), "--json", "--until-stdin-closes"];
  if (options.name) args.push("--name", options.name);
  // One argument, so an address can never be read as a flag.
  if (allow) args.push(`--allow=${allow.join(",")}`);
  const env: NodeJS.ProcessEnv = { ...process.env, ...runner.env };
  delete env.OUICU_PASSWORD;
  if (options.password !== undefined) {
    // Through the environment, never the arguments, which others can see.
    args.push("--password");
    env.OUICU_PASSWORD = options.password;
  }
  const child = spawn(runner.bin, args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  watch(child);

  return new Promise<LiveShare>((resolve, reject) => {
    let live: LiveShare | undefined;
    let words: string | undefined;
    let lastRetry: string | undefined;
    let stopping = false;
    let stderr = "";
    let settled = false;
    let ended!: (value: { reason: string }) => void;
    const closed = new Promise<{ reason: string }>((r) => (ended = r));

    const fail = (error: OuicuError) => {
      if (live || settled) return;
      settled = true;
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(
        new OuicuError(
          0,
          `The share did not open within ${Math.round((options.timeout ?? OPEN_TIMEOUT_MS) / 1000)} seconds${lastRetry ? `: ${lastRetry}` : "."}`,
        ),
      );
      void stop();
    }, options.timeout ?? OPEN_TIMEOUT_MS);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const lines = createInterface({ input: child.stdout! });
    lines.on("line", (line) => {
      let event: ShareEvent;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof event?.event !== "string") return;
      options.onEvent?.(event);
      switch (event.event) {
        case "live":
          if (live) {
            // A reconnect that came back at another address.
            live.url = event.url;
            live.name = event.name;
            break;
          }
          live = {
            url: event.url,
            name: event.name,
            expiresAt: event.expiresAt ?? null,
            notice: event.notice === true,
            password: event.password === true,
            people: event.people === true,
            port,
            stop,
            closed,
          };
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolve(live);
          }
          break;
        case "request":
          options.onRequest?.({
            method: event.method,
            path: event.path,
            status: event.status,
            ms: event.ms,
          });
          break;
        case "notice":
          options.onNotice?.(event.text);
          break;
        case "retrying":
          lastRetry = event.message;
          break;
        case "stopped":
          words = event.reason;
          break;
        case "error":
          words = event.message;
          break;
      }
    });

    let exitCode: number | null = null;
    const exited = new Promise<void>((r) =>
      child.on("exit", (code) => {
        exitCode = code;
        r();
      }),
    );
    const read = new Promise<void>((r) => lines.on("close", r));
    child.on("error", (err) => {
      running.delete(child);
      clearTimeout(timer);
      fail(new OuicuError(0, `Could not run ${runner.bin}.`, { cause: err }));
      ended({ reason: `Could not run ${runner.bin}.` });
    });
    void Promise.all([exited, read]).then(() => {
      running.delete(child);
      clearTimeout(timer);
      const said = words ?? (stderr.trim() || undefined);
      fail(
        new OuicuError(
          0,
          said ??
            `ouicu share exited (code ${exitCode}) before the link was ready.`,
        ),
      );
      ended({
        reason:
          said ??
          (stopping
            ? "you stopped it on this computer"
            : `ouicu share exited with code ${exitCode}`),
      });
    });

    async function stop(): Promise<void> {
      if (exitCode === null && child.exitCode === null) {
        stopping = true;
        child.kill("SIGINT");
        const force = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
        await closed;
        clearTimeout(force);
      }
      await closed;
    }
  });
}
