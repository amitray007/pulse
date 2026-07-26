import { SourceRegistry } from "@pulse/core";
import { createPool, migrate } from "@pulse/db";
import { webVitalSource } from "@pulse/source-web-vital";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

// Collector entry point: wire the pool + sources, run migrations, then serve.
async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  await migrate(pool);

  const registry = new SourceRegistry();
  registry.register(webVitalSource);

  const app = buildServer({ pool, registry, logger: true });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error("collector failed to start:", err);
  process.exit(1);
});
