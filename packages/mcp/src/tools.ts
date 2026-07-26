import type { Pool } from "@pulse/db";

// The MCP tools are thin, honest wrappers over Postgres. Pulse's MCP is full-access by design
// (query + execute + DDL) and protected by a bearer token + network placement — see the README's
// security section. The query/execute split is about intent and auditability, not a security
// boundary: both run SQL. Keep these functions pure over a Pool so they're trivially testable.

/** Cap on rows returned to the caller, so a huge SELECT can't flood the transport. */
const MAX_ROWS = 1000;

export interface QueryResult {
  rows: unknown[];
  rowCount: number;
  truncated: boolean;
}

/** Run a read query and return up to MAX_ROWS rows. */
export async function query(pool: Pool, sql: string): Promise<QueryResult> {
  const res = await pool.query(sql);
  const rows = res.rows.slice(0, MAX_ROWS);
  return { rows, rowCount: res.rowCount ?? rows.length, truncated: res.rows.length > MAX_ROWS };
}

/** Run a write / DDL statement. Returns the affected row count when the driver reports one. */
export async function execute(pool: Pool, sql: string): Promise<{ rowCount: number }> {
  const res = await pool.query(sql);
  return { rowCount: res.rowCount ?? 0 };
}

/** EXPLAIN (or EXPLAIN ANALYZE) a query and return the plan text. */
export async function explain(pool: Pool, sql: string, analyze = false): Promise<{ plan: string }> {
  const prefix = analyze ? "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " : "EXPLAIN (FORMAT TEXT) ";
  const res = await pool.query<{ "QUERY PLAN": string }>(prefix + sql);
  return { plan: res.rows.map((r) => r["QUERY PLAN"]).join("\n") };
}

const SCHEMA_SQL = `
  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`;

const INDEX_SQL = `
  SELECT tablename AS table_name, indexname AS index_name, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
  ORDER BY tablename, indexname
`;

/** List public tables (with columns) and indexes, so an AI knows what it can query. */
export async function schema(pool: Pool): Promise<{ columns: unknown[]; indexes: unknown[] }> {
  const [cols, idx] = await Promise.all([pool.query(SCHEMA_SQL), pool.query(INDEX_SQL)]);
  return { columns: cols.rows, indexes: idx.rows };
}

const STATS_SQL = `
  SELECT
    relname AS table_name,
    n_live_tup AS live_rows,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC
`;

/** Table sizes and live row counts — an ops view over the store. */
export async function stats(pool: Pool): Promise<{ tables: unknown[] }> {
  const res = await pool.query(STATS_SQL);
  return { tables: res.rows };
}
