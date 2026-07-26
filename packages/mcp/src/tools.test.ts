import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createPool, migrate, insertEvent, type Pool } from "@pulse/db";
import * as tools from "./tools.js";

// Integration tests against a real Postgres. Set PULSE_TEST_DATABASE_URL; skipped when unset.
const DB_URL = process.env.PULSE_TEST_DATABASE_URL;
const dbTest = DB_URL ? test : test.skip;

let pool: Pool;

beforeAll(async () => {
  if (!DB_URL) return;
  pool = createPool(DB_URL);
  await migrate(pool);
});

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  if (!DB_URL) return;
  await pool.query("TRUNCATE events");
});

async function seed(): Promise<void> {
  await insertEvent(pool, {
    source: "t",
    sourceType: "web_vital",
    name: "LCP",
    value: { type: "num", value: 2772 },
    unit: "ms",
    labels: { app: "A", country: "IN" },
  });
}

dbTest("query returns rows with rowCount and truncation flag", async () => {
  await seed();
  const res = await tools.query(pool, "SELECT name, value_num FROM events");
  expect(res.rowCount).toBe(1);
  expect(res.truncated).toBe(false);
  expect(res.rows).toEqual([{ name: "LCP", value_num: 2772 }]);
});

dbTest("query strips a trailing semicolon and still runs", async () => {
  await seed();
  const res = await tools.query(pool, "SELECT name FROM events;");
  expect(res.rows).toEqual([{ name: "LCP" }]);
});

dbTest("query caps rows and flags truncation (cap enforced in SQL)", async () => {
  // generate_series makes 2000 rows without inserting; proves the LIMIT wrapping works.
  const res = await tools.query(pool, "SELECT g FROM generate_series(1, 2000) AS g");
  expect(res.rows).toHaveLength(1000);
  expect(res.truncated).toBe(true);
});

dbTest("execute runs a write and reports the affected count", async () => {
  await seed();
  const res = await tools.execute(pool, "UPDATE events SET unit = 'milliseconds'");
  expect(res.rowCount).toBe(1);
});

dbTest("explain returns a plan", async () => {
  const res = await tools.explain(pool, "SELECT * FROM events WHERE name = 'LCP'");
  expect(res.plan).toMatch(/Scan/i);
});

dbTest("explain analyze actually runs the query", async () => {
  const res = await tools.explain(pool, "SELECT 1", true);
  expect(res.plan).toMatch(/actual time/i);
});

dbTest("schema lists the events table columns and indexes", async () => {
  const res = await tools.schema(pool);
  const tables = new Set((res.columns as { table_name: string }[]).map((c) => c.table_name));
  expect(tables.has("events")).toBe(true);
  expect(
    (res.indexes as { index_name: string }[]).some((i) => i.index_name.includes("events")),
  ).toBe(true);
});

dbTest("stats reports the events table row count", async () => {
  await seed();
  const res = await tools.stats(pool);
  const events = (res.tables as { table_name: string; live_rows: number }[]).find(
    (t) => t.table_name === "events",
  );
  expect(events).toBeDefined();
});
