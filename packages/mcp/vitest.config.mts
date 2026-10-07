import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

export default defineConfig({
  define: { PKG_VERSION: JSON.stringify(pkg.version) },
  resolve: {
    // The SDK's source, so the tests run before it is built.
    alias: {
      "@ouicu/sdk": fileURLToPath(
        new URL("../sdk/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    unstubEnvs: true,
    unstubGlobals: true,
    restoreMocks: true,
  },
});
