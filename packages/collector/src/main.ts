import { SourceRegistry } from "@pulse/core";
import { createPool, migrate } from "@pulse/db";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

// Collector entry point: wire the pool + sources, run migrations, then serve.
async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  await migrate(pool);

  // Register your source adapters here (see packages under sources/). With none registered, the
  // collector still accepts generic events posted directly to /ingest.
  const registry = new SourceRegistry();

  const app = buildServer({ pool, registry, corsOrigins: config.corsOrigins, logger: true });

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
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
