import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs", "plugins/extract-ts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "plugins/extract-ts/testdata/**"],
  },
});
