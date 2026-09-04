import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Inversify's decorators are the experimental kind; explicit @inject tokens
    // mean no emitted metadata is needed for the tests to build the container.
    setupFiles: ["./src/testing/setup.ts"],
  },
  oxc: { decorator: { legacy: true } },
});
