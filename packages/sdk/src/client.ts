import { hostname } from "node:os";
import { savedKeyFor } from "./credentials";
import { deploy, type Deployed, type DeployOptions } from "./deploy";
import { callJson, type Http } from "./http";
import { login, type LoggedIn, type LoginOptions } from "./login";
import { share, type LiveShare, type ShareOptions } from "./share";
import type { RecentRequests, Share, Site, Usage, WhoAmI } from "./types";

/** The ouicu site, unless OUICU_API or the `api` option says another. */
export const DEFAULT_API = "https://ouicu.com";

export interface OuicuOptions {
  /** An API key (ocu_...). Without one: OUICU_API_KEY, then the key `ouicu login` saved. */
  apiKey?: string;
  /** The ouicu site: OUICU_API, or https://ouicu.com. */
  api?: string;
  /** The tunnel share() connects to: OUICU_TUNNEL, or the CLI's own. */
  tunnel?: string;
  /** The ouicu CLI share() runs: OUICU_BIN, or `ouicu` on the PATH. */
  bin?: string;
}

/** What this computer is called on the dashboard: "mads-laptop, macOS", as the CLI says it. */
export function clientName(): string {
  const systems: Record<string, string> = {
    darwin: "macOS",
    linux: "Linux",
    win32: "Windows",
  };
  return `${hostname()}, ${systems[process.platform] ?? process.platform}`;
}

/**
 * ouicu from Node: share a port at a public link, put a built site up,
 * and see your shares, sites and the month's data.
 *
 * @example
 * ```ts
 * import { Ouicu } from "@ouicu/sdk";
 *
 * const ouicu = new Ouicu(); // the key `ouicu login` saved
 * const site = await ouicu.deploy("./dist");
 * console.log(site.url);
 * ```
 */
export class Ouicu {
  /** The site calls go to, without a trailing slash. */
  readonly api: string;
  private readonly http: Http;
  private readonly options: OuicuOptions;

  constructor(options: OuicuOptions = {}) {
    this.options = options;
    this.api = (options.api || process.env.OUICU_API || DEFAULT_API).replace(
      /\/+$/,
      "",
    );
    this.http = { api: this.api, key: () => this.apiKey() };
  }

  /**
   * The key calls use, looked up on every call, so a login elsewhere (the
   * CLI, another program) takes effect at once. Throws (401) when there is none.
   */
  apiKey(): string {
    return this.options.apiKey || savedKeyFor(this.api);
  }

  /** Whether there is a key to use, without asking ouicu whether it works. */
  hasKey(): boolean {
    try {
      this.apiKey();
      return true;
    } catch {
      return false;
    }
  }

  /** Who the key belongs to, and their plan. */
  whoami(): Promise<WhoAmI> {
    return callJson<WhoAmI>(this.http, "GET", "/api/cli/whoami");
  }

  /** The account's data this month against the plan's allowance. */
  usage(): Promise<Usage> {
    return callJson<Usage>(this.http, "GET", "/api/usage");
  }

  readonly shares = {
    /** The account's shares, live ones first, then the latest ended (30 unless `limit`). */
    list: async (options: { limit?: number } = {}): Promise<Share[]> => {
      const limit = options.limit ?? 30;
      const answer = await callJson<{ shares: Share[] }>(
        this.http,
        "GET",
        `/api/shares?limit=${limit}`,
      );
      return answer.shares;
    },
    /** Stops a live share; its `ouicu share` exits and says why. */
    stop: async (id: string): Promise<{ message: string }> => {
      const answer = await callJson<{ message: string }>(
        this.http,
        "POST",
        `/api/shares/${encodeURIComponent(id)}/stop`,
      );
      return { message: answer.message };
    },
    /** A share's last requests, newest first. */
    requests: (id: string): Promise<RecentRequests> =>
      callJson<RecentRequests>(
        this.http,
        "GET",
        `/api/shares/${encodeURIComponent(id)}/requests`,
      ),
  };

  readonly sites = {
    /** The account's sites, the latest upload first. */
    list: async (): Promise<Site[]> => {
      const answer = await callJson<{ sites: Site[] }>(
        this.http,
        "GET",
        "/api/sites",
      );
      return answer.sites;
    },
    /** Deletes a site and its files; its link stops working. */
    delete: async (id: string): Promise<void> => {
      await callJson(
        this.http,
        "DELETE",
        `/api/sites/${encodeURIComponent(id)}`,
      );
    },
    /** A site's last requests, newest first. */
    requests: (id: string): Promise<RecentRequests> =>
      callJson<RecentRequests>(
        this.http,
        "GET",
        `/api/sites/${encodeURIComponent(id)}/requests`,
      ),
  };

  /**
   * Puts the built site in `dir` up at a public link, as `ouicu deploy`
   * does: only the files ouicu does not have yet are uploaded. Dot files
   * (but .well-known), node_modules and links are left out, and so is
   * anything that is not part of a web page.
   */
  deploy(dir: string, options?: DeployOptions): Promise<Deployed> {
    return deploy(this.http, dir, clientName(), options);
  }

  /**
   * Shares a port on this computer at a public link until stopped, through
   * the ouicu CLI (`ouicu share <port> --json`), which must be installed.
   * Resolves once the link works.
   */
  async share(port: number, options?: ShareOptions): Promise<LiveShare> {
    const env: Record<string, string> = {
      OUICU_API_KEY: this.apiKey(),
      OUICU_API: this.api,
    };
    const tunnel = this.options.tunnel || process.env.OUICU_TUNNEL;
    if (tunnel) env.OUICU_TUNNEL = tunnel;
    const bin = this.options.bin || process.env.OUICU_BIN || "ouicu";
    return share({ bin, env }, port, options);
  }

  /**
   * Logs in through the browser, as `ouicu login` does: `onCode` gets a
   * code and an address for the person to approve it at; once they do,
   * the key is saved where the CLI keeps it, for this client, the CLI and
   * anything else without a key of its own.
   */
  login(options: LoginOptions): Promise<LoggedIn> {
    return login(this.http, options.client ?? clientName(), options);
  }
}
