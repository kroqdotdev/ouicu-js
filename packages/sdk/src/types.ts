/** Who an API key belongs to (`ouicu whoami`). */
export interface WhoAmI {
  email: string;
  name: string;
  plan: {
    key: string;
    name: string;
    /** How the account has the plan: "default", "subscription", "grant" or "staff". */
    source: string;
  };
  /** The key itself: its name and the start of it. */
  key: { name: string; prefix: string };
}

/** The account's data this month (UTC) against the plan's allowance. */
export interface Usage {
  plan: "free" | "hobby" | "pro";
  /** "2026-10" */
  month: string;
  /** Bytes served to visitors this month, shares and sites together. */
  bytes: number;
  requests: number;
  allowanceBytes: number;
  /** When the month's count starts again (ISO). */
  resetsAt: string;
  /** Over the allowance: shares cannot open and uploads are refused until it resets. */
  over: boolean;
}

/** One `ouicu share` run, live or ended. */
export interface Share {
  id: string;
  name: string;
  url: string;
  live: boolean;
  /** The computer it ran on: "mads-laptop, macOS". */
  client: string;
  startedAt: string;
  endedAt: string | null;
  /** Why it ended, in words ("stopped from the dashboard"), or null while live. */
  ended: string | null;
  /** Whether visitors need a password. */
  password: boolean;
  /**
   * Whether only invited people may open it (Pro): those the owner listed,
   * who sign in with a link ouicu emails them. Always false once ended.
   */
  people: boolean;
  requests: number;
  bytes: number;
}

/** A site put up with `ouicu deploy` or `deploy()`. */
export interface Site {
  id: string;
  name: string;
  url: string;
  files: number;
  /** Bytes its files take on ouicu. */
  size: number;
  uploadedAt: string;
  /** When it goes (Free sites: a week after their last upload), or null. */
  expiresAt: string | null;
  /** Whether visitors need a password. */
  password: boolean;
  /** Whether only the people on its name's list may open it (Pro). */
  people: boolean;
  requests: number;
  /** Bytes served to visitors. */
  bytes: number;
}

/** One request a visitor made, as the edge saw it. */
export interface RecentRequest {
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  bytes: number;
  /** Two letters ("DK"), or null when not known. */
  country: string | null;
  device: "phone" | "tablet" | "computer" | "bot" | "unknown";
  /** 1 for the first visitor seen, 2 for the next, and so on. */
  visitor: number;
  /**
   * Which of ouicu's own pages answered instead of the site, if one did:
   * "notice", "password", "invited people", "link sent", "let in",
   * "too many requests", "paused", "no answer", "not served", "not found",
   * "visitor's day used".
   */
  ouicu: string | null;
}

export interface RecentRequests {
  /** False when the edge did not answer; `requests` is empty then. */
  available: boolean;
  /**
   * Distinct visitors since the edge last restarted; `requests[].visitor`
   * counts up to it.
   */
  visitors: number;
  /** Newest first. */
  requests: RecentRequest[];
}

/** A file ouicu left out of an upload, and why. */
export interface Skipped {
  path: string;
  why: string;
}
