import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "sources/*/src/**/*.test.ts",
      "examples/*/src/**/*.test.ts",
    ],
    // Integration tests share one Postgres database and TRUNCATE between cases.
    pool: "forks",
    fileParallelism: false,
  },
});
