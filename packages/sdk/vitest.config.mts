import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

export default defineConfig({
  define: { PKG_VERSION: JSON.stringify(pkg.version) },
  test: {
    include: ["src/**/*.test.ts"],
    unstubEnvs: true,
    unstubGlobals: true,
    restoreMocks: true,
  },
});
