import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { OuicuError } from "./errors";

/*
 * The key `ouicu login` saved, shared with the CLI (apps/cli/src/credentials.rs):
 * the same file, in the same form, readable by its owner only. Logging in
 * with either one logs in both.
 */

export interface Credentials {
  apiKey: string;
  email: string;
  /** The site the key is for, so a key for a test server is not sent to ouicu.com. */
  api: string;
}

/**
 * Where the CLI keeps it: the config folder Rust's `dirs` crate picks, so
 * ~/.config/ouicu/credentials.json on Linux ($XDG_CONFIG_HOME when set),
 * ~/Library/Application Support/ouicu/credentials.json on a Mac and
 * %APPDATA%\ouicu\credentials.json on Windows.
 */
export function credentialsPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const home = env.HOME || homedir();
  let config: string;
  if (platform === "darwin")
    config = join(home, "Library", "Application Support");
  else if (platform === "win32")
    config = env.APPDATA || join(homedir(), "AppData", "Roaming");
  else {
    const xdg = env.XDG_CONFIG_HOME;
    config = xdg && isAbsolute(xdg) ? xdg : join(home, ".config");
  }
  return join(config, "ouicu", "credentials.json");
}

/** The saved credentials, or null when nobody has logged in on this computer. */
export function readCredentials(path = credentialsPath()): Credentials | null {
  if (!existsSync(path)) return null;
  let saved: Partial<Credentials>;
  try {
    saved = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new OuicuError(
      0,
      "The credentials file is damaged. Run `ouicu login`.",
      { cause: err },
    );
  }
  if (
    typeof saved.apiKey !== "string" ||
    typeof saved.email !== "string" ||
    typeof saved.api !== "string"
  )
    throw new OuicuError(
      0,
      "The credentials file is damaged. Run `ouicu login`.",
    );
  return { apiKey: saved.apiKey, email: saved.email, api: saved.api };
}

/** Saves a key as the CLI does, and returns where. */
export function saveCredentials(
  credentials: Credentials,
  path = credentialsPath(),
): string {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Field order and indentation as serde_json's to_string_pretty writes them.
  const json = JSON.stringify(
    {
      apiKey: credentials.apiKey,
      email: credentials.email,
      api: credentials.api,
    },
    null,
    2,
  );
  if (process.platform !== "win32") chmodSync(dir, 0o700);
  writeFileSync(path, json, { mode: 0o600 });
  // A file made by an older version may be readable by others.
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return path;
}

/**
 * The key for `api`: OUICU_API_KEY when set, or the saved one when it is
 * for this site. Throws, with what to do, when there is none.
 */
export function savedKeyFor(api: string, env = process.env): string {
  const fromEnv = env.OUICU_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const saved = readCredentials(credentialsPath(env));
  const plain = (url: string) => url.replace(/\/+$/, "");
  if (saved && plain(saved.api) === plain(api)) return saved.apiKey;
  if (saved)
    throw new OuicuError(
      401,
      "You are logged in to another server. Run `ouicu login`.",
    );
  throw new OuicuError(
    401,
    "You are not logged in. Run `ouicu login`, or set OUICU_API_KEY.",
  );
}
