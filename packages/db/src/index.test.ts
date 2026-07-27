import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createPool, migrate, insertEvent, insertEvents, type Pool } from "./index.js";

// Integration tests run against a real Postgres. Set PULSE_TEST_DATABASE_URL to point at a
// throwaway database (e.g. postgres://localhost:5432/pulse_test). Skipped when unset.
const DB_URL = process.env.PULSE_TEST_DATABASE_URL;
const describeDb = DB_URL ? test : test.skip;

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

describeDb("migrate is idempotent (second run applies nothing)", async () => {
  const ran = await migrate(pool);
  expect(ran).toEqual([]);
});

describeDb("stores a numeric event in value_num with its unit", async () => {
  await insertEvent(pool, {
    source: "test",
    sourceType: "http",
    name: "latency_ms",
    value: { type: "num", value: 2772 },
    unit: "ms",
    labels: { service: "api", country: "IN" },
  });
  const { rows } = await pool.query("SELECT name, value_num, value_type, unit, labels FROM events");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    name: "latency_ms",
    value_num: 2772,
    value_type: "num",
    unit: "ms",
    labels: { service: "api", country: "IN" },
  });
});

describeDb("stores text and bool events in their typed columns", async () => {
  await insertEvents(pool, [
    { source: "t", sourceType: "s", name: "status", value: { type: "text", value: "ok" } },
    { source: "t", sourceType: "s", name: "flag", value: { type: "bool", value: true } },
  ]);
  const { rows } = await pool.query(
    "SELECT name, value_text, value_bool, value_type FROM events ORDER BY name",
  );
  expect(rows).toEqual([
    { name: "flag", value_text: null, value_bool: true, value_type: "bool" },
    { name: "status", value_text: "ok", value_bool: null, value_type: "text" },
  ]);
});

describeDb("dedups on event_id — same id upserts, keeps last value", async () => {
  const base = {
    source: "t",
    sourceType: "http",
    name: "latency_ms",
    eventId: "v3-abc",
    value: { type: "num" as const, value: 1000 },
  };
  await insertEvent(pool, base);
  await insertEvent(pool, { ...base, value: { type: "num", value: 2500 } }); // reportAllChanges re-fire
  const { rows } = await pool.query("SELECT value_num FROM events");
  expect(rows).toHaveLength(1);
  expect(rows[0].value_num).toBe(2500);
});

describeDb(
  "upsert MERGES labels + persists group_id — context accretes, sparse re-fire doesn't erase",
  async () => {
    await insertEvent(pool, {
      source: "t",
      sourceType: "web_vital",
      name: "LCP",
      eventId: "v3-x",
      groupId: "launch-1",
      value: { type: "num", value: 1000 },
      labels: { app: "FB", shop: "s1", country: "IN" },
    });
    // reportAllChanges-style re-fire: only the metric, no shop/country/group_id.
    await insertEvent(pool, {
      source: "t",
      sourceType: "web_vital",
      name: "LCP",
      eventId: "v3-x",
      value: { type: "num", value: 3100 },
      labels: {},
    });
    const { rows } = await pool.query("SELECT value_num, labels, group_id FROM events");
    expect(rows).toHaveLength(1);
    expect(rows[0].value_num).toBe(3100); // value takes last write
    expect(rows[0].labels).toEqual({ app: "FB", shop: "s1", country: "IN" }); // labels preserved
    expect(rows[0].group_id).toBe("launch-1"); // group_id persisted
  },
);

describeDb("upsert label merge adds/overwrites keys from a later beacon", async () => {
  const base = {
    source: "t",
    sourceType: "web_vital",
    name: "LCP",
    eventId: "v3-y",
    value: { type: "num" as const, value: 1 },
  };
  await insertEvent(pool, { ...base, labels: { app: "FB", country: "IN" } });
  await insertEvent(pool, { ...base, labels: { country: "US", plan: "pro" } }); // change + add
  const { rows } = await pool.query("SELECT labels FROM events");
  expect(rows[0].labels).toEqual({ app: "FB", country: "US", plan: "pro" });
});

describeDb("events without event_id always insert (no dedup)", async () => {
  const e = {
    source: "t",
    sourceType: "s",
    name: "x",
    value: { type: "num" as const, value: 1 },
  };
  await insertEvent(pool, e);
  await insertEvent(pool, e);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM events");
  expect(rows[0].n).toBe(2);
});

describeDb("filters by label via GIN containment", async () => {
  await insertEvents(pool, [
    {
      source: "t",
      sourceType: "s",
      name: "latency_ms",
      value: { type: "num", value: 1 },
      labels: { app: "A" },
    },
    {
      source: "t",
      sourceType: "s",
      name: "latency_ms",
      value: { type: "num", value: 2 },
      labels: { app: "B" },
    },
  ]);
  const { rows } = await pool.query(`SELECT value_num FROM events WHERE labels @> '{"app":"A"}'`);
  expect(rows).toEqual([{ value_num: 1 }]);
});
