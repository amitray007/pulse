import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Pool } from "pg";

// Migrations live as numbered .sql files in ../migrations (e.g. 001_init.sql), applied in
// numeric-prefix order. A migrations table records which have run, so migrate() is idempotent.
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Ordering key = the leading integer of the filename, so 2 < 10 < 100 regardless of zero-padding. */
function migrationOrder(filename: string): number {
  const prefix = /^\d+/.exec(filename)?.[0];
  return prefix ? Number.parseInt(prefix, 10) : Number.MAX_SAFE_INTEGER;
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  return new Set(rows.map((r) => r.name));
}

/** Apply all pending migrations in order. Returns the names applied this run. */
export async function migrate(pool: Pool): Promise<string[]> {
  await ensureMigrationsTable(pool);
  const applied = await appliedMigrations(pool);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => migrationOrder(a) - migrationOrder(b));

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      ran.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return ran;
}
