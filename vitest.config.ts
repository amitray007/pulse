import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one Postgres database and TRUNCATE between cases, so test files must
    // not run in parallel — a single fork keeps them from clobbering each other's rows.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
  },
});
