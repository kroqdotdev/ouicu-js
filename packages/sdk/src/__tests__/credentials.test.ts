import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  credentialsPath,
  readCredentials,
  saveCredentials,
  savedKeyFor,
} from "../credentials";
import { Ouicu } from "../client";
import { OuicuError } from "../errors";
import { freshHome } from "./helpers";

let home: string;
beforeEach(() => {
  home = freshHome();
});

/** The file as `ouicu login` writes it (serde_json's to_string_pretty). */
const fromTheCli = `{
  "apiKey": "ocu_fromthecli",
  "email": "mads@example.com",
  "api": "https://ouicu.com"
}`;

function writeAsTheCli(text = fromTheCli) {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe("where the key is kept", () => {
  it("is the folder the CLI's dirs crate picks on each system", () => {
    expect(credentialsPath({ HOME: "/home/mads" }, "linux")).toBe(
      "/home/mads/.config/ouicu/credentials.json",
    );
    expect(
      credentialsPath(
        { HOME: "/home/mads", XDG_CONFIG_HOME: "/tmp/config" },
        "linux",
      ),
    ).toBe("/tmp/config/ouicu/credentials.json");
    expect(credentialsPath({ HOME: "/Users/mads" }, "darwin")).toBe(
      "/Users/mads/Library/Application Support/ouicu/credentials.json",
    );
  });

  it("passes over a relative XDG_CONFIG_HOME, as the CLI does", () => {
    expect(
      credentialsPath(
        { HOME: "/home/mads", XDG_CONFIG_HOME: "config" },
        "linux",
      ),
    ).toBe("/home/mads/.config/ouicu/credentials.json");
  });
});

describe("the credentials file", () => {
  it("reads what `ouicu login` wrote", () => {
    writeAsTheCli();
    expect(readCredentials()).toEqual({
      apiKey: "ocu_fromthecli",
      email: "mads@example.com",
      api: "https://ouicu.com",
    });
  });

  it("is written exactly as the CLI writes it, for its owner only", () => {
    const path = saveCredentials({
      apiKey: "ocu_fromthecli",
      email: "mads@example.com",
      api: "https://ouicu.com",
    });
    expect(path).toBe(join(home, ".config", "ouicu", "credentials.json"));
    expect(readFileSync(path, "utf8")).toBe(fromTheCli);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  });

  it("tightens a file others could read", () => {
    writeAsTheCli();
    const path = credentialsPath();
    chmodSync(path, 0o644);
    saveCredentials({
      apiKey: "ocu_new",
      email: "a@b.c",
      api: "https://ouicu.com",
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("says when it is damaged", () => {
    writeAsTheCli("{ not json");
    expect(() => readCredentials()).toThrow(/damaged/);
  });

  it("is nothing before anyone logs in", () => {
    expect(readCredentials()).toBeNull();
  });
});

describe("which key a call uses", () => {
  it("takes OUICU_API_KEY over the saved one", () => {
    writeAsTheCli();
    vi.stubEnv("OUICU_API_KEY", "  ocu_fromenv ");
    expect(savedKeyFor("https://ouicu.com")).toBe("ocu_fromenv");
  });

  it("takes the saved key only for the site it was made for", () => {
    writeAsTheCli();
    expect(savedKeyFor("https://ouicu.com")).toBe("ocu_fromthecli");
    expect(() => savedKeyFor("http://localhost:3232")).toThrow(
      "You are logged in to another server. Run `ouicu login`.",
    );
  });

  it("says how to log in when there is no key, as a 401", () => {
    let error: unknown;
    try {
      savedKeyFor("https://ouicu.com");
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(OuicuError);
    expect((error as OuicuError).status).toBe(401);
    expect((error as OuicuError).message).toMatch(/ouicu login/);
  });

  it("takes the client's own key over both", () => {
    writeAsTheCli();
    vi.stubEnv("OUICU_API_KEY", "ocu_fromenv");
    expect(new Ouicu({ apiKey: "ocu_given" }).apiKey()).toBe("ocu_given");
  });

  it("looks again on every call, so a login elsewhere counts at once", () => {
    const ouicu = new Ouicu();
    expect(ouicu.hasKey()).toBe(false);
    writeAsTheCli();
    expect(ouicu.hasKey()).toBe(true);
    expect(ouicu.apiKey()).toBe("ocu_fromthecli");
  });
});
