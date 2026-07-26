import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Pool } from "@pulse/db";
import * as tools from "./tools.js";

// Registers the Pulse tools on an McpServer. Full-access by design (query + execute + DDL);
// the transport layer (server-http.ts) enforces the bearer token. Kept separate from transport
// so the tool registration is unit-testable.

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function createMcpServer(pool: Pool): McpServer {
  const server = new McpServer({ name: "pulse", version: "0.1.0" });

  server.registerTool(
    "query",
    {
      description:
        "Run a read-only SQL query against the telemetry database. Returns up to 1000 rows.",
      inputSchema: { sql: z.string().describe("A SQL SELECT (or other read) statement.") },
    },
    async ({ sql }) => {
      try {
        return ok(await tools.query(pool, sql));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "execute",
    {
      description:
        "Run a write or DDL statement (INSERT/UPDATE/DELETE/CREATE INDEX/ALTER/...). Full DB power.",
      inputSchema: { sql: z.string().describe("A SQL statement that modifies data or schema.") },
    },
    async ({ sql }) => {
      try {
        return ok(await tools.execute(pool, sql));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "explain",
    {
      description:
        "EXPLAIN a query's plan. Set analyze=true for EXPLAIN ANALYZE (actually runs it).",
      inputSchema: {
        sql: z.string().describe("The query to explain."),
        analyze: z.boolean().optional().describe("Run EXPLAIN ANALYZE (executes the query)."),
      },
    },
    async ({ sql, analyze }) => {
      try {
        return ok(await tools.explain(pool, sql, analyze ?? false));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "schema",
    { description: "List public tables (with columns) and indexes.", inputSchema: {} },
    async () => {
      try {
        return ok(await tools.schema(pool));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "stats",
    { description: "Table sizes and live row counts (ops view).", inputSchema: {} },
    async () => {
      try {
        return ok(await tools.stats(pool));
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
