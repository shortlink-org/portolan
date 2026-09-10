import { defineConfig } from "vitest/config";
// The app's sources are dated from git at build time (portolan.0010); a test
// that imports src/data.ts needs the same virtual module the site gets.
// @ts-expect-error plain JavaScript module intentionally has no browser types
import { provenancePlugin } from "./scripts/provenance.mjs";

const exampleCatalogTests = [
  "src/routes.test.ts",
  "src/flow/answers.test.ts",
  "src/flow/cross-context.test.ts",
  "src/lib/api.test.ts",
  "src/lib/palette.test.ts",
  "src/likec4/mapping.test.ts",
  "src/selection/hash.test.ts",
  "src/selection/model.test.ts",
  "src/selection/pages.test.ts",
  "src/selection/store.test.ts",
  "src/trail/model.test.ts",
];
const allTests = [
  "src/**/*.test.{ts,tsx}",
  "scripts/**/*.test.mjs",
  "cli/**/*.test.mjs",
  "plugins/extract-ts/**/*.test.{ts,tsx}",
];
const excludedTests = ["**/node_modules/**", "plugins/extract-ts/testdata/**"];

export default defineConfig({
  plugins: [provenancePlugin(".")],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "example catalog",
          environment: "node",
          setupFiles: ["./src/testing/setup.ts"],
          include: exampleCatalogTests,
          exclude: excludedTests,
        },
      },
      {
        extends: true,
        test: {
          name: "default catalog",
          environment: "node",
          include: allTests,
          exclude: [...excludedTests, ...exampleCatalogTests],
        },
      },
    ],
  },
});
