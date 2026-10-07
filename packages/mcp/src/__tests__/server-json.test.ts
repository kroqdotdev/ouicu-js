import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * server.json, this server's entry in the official MCP registry
 * (registry.modelcontextprotocol.io). The registry takes it from
 * `mcp-publisher publish` after the npm release, and checks the npm
 * package's mcpName against its name; it lists the version given here.
 * So a release bumps all three versions together.
 */

const read = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));
const pkg = read("package.json");
const server = read("server.json");

describe("server.json", () => {
  it("names the server as package.json's mcpName does, under ouicu.com's namespace (DNS-proven)", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.name).toMatch(/^com\.ouicu\/[a-zA-Z0-9._-]+$/);
  });

  it("lists this package at this version, run with npx over stdio", () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages).toEqual([
      expect.objectContaining({
        registryType: "npm",
        registryBaseUrl: "https://registry.npmjs.org",
        identifier: pkg.name,
        version: pkg.version,
        runtimeHint: "npx",
        transport: { type: "stdio" },
      }),
    ]);
  });

  it("fits the registry's limits and points at the docs", () => {
    expect(server.$schema).toMatch(
      /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/[\d-]+\/server\.schema\.json$/,
    );
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.websiteUrl).toBe(pkg.homepage);
    for (const icon of server.icons) expect(icon.src).toMatch(/^https:\/\//);
  });

  it("says the key it reads is optional and secret", () => {
    const [key] = server.packages[0].environmentVariables;
    expect(key).toMatchObject({
      name: "OUICU_API_KEY",
      isRequired: false,
      isSecret: true,
    });
  });
});
