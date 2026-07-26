import { Pool } from "pg";
import type { PoolConfig } from "pg";

/**
 * Create a Postgres connection pool from a connection string.
 * Callers own the pool lifecycle and must call `pool.end()` on shutdown.
 */
export function createPool(connectionString: string, config: PoolConfig = {}): Pool {
  return new Pool({ connectionString, ...config });
}

export type { Pool } from "pg";
