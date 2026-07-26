import { createPool } from "@pulse/db";
import { loadConfig } from "./config.js";
import { buildHttpServer } from "./http.js";

// MCP entry point: connect the pool, serve the token-gated HTTP transport.
async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const server = buildHttpServer(pool, config.authToken);

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    server.close(() => void pool.end().then(() => process.exit(0)));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.listen(config.port, config.host, () => {
    console.error(`pulse mcp listening on ${config.host}:${config.port}`);
  });
}

main().catch((err) => {
  console.error("mcp failed to start:", err);
  process.exit(1);
});
