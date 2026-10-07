import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const define = { PKG_VERSION: JSON.stringify(pkg.version) };

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    target: "node20",
    dts: true,
    define,
  },
  {
    // `npx @ouicu/mcp`: one file with setup in it; the SDK and the MCP
    // SDK stay dependencies.
    entry: { mcp: "bin/mcp.ts" },
    format: ["cjs"],
    target: "node20",
    outDir: "dist/bin",
    banner: { js: "#!/usr/bin/env node" },
    define,
  },
]);
