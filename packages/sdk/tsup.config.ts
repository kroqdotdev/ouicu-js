import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  target: "node20",
  dts: true,
  clean: true,
  define: { PKG_VERSION: JSON.stringify(pkg.version) },
});
