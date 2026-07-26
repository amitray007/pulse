import { afterEach, expect, test } from "vitest";
import { InvalidPayloadError, SourceRegistry, type Source } from "@pulse/core";
import type { Pool } from "@pulse/db";
import { buildServer } from "./server.js";

// A generic test source: explodes { items: [{ value, country? }, ...] } into numeric events,
// carrying a country label only when the item provides one. No specific adapter involved.
const testSource: Source = {
  sourceType: "test_metric",
  toEvents(payload) {
    const items = (payload as { items?: unknown }).items;
    if (!Array.isArray(items)) throw new InvalidPayloadError("items must be an array");
    return items.map((raw) => {
      const item = raw as { value: number; country?: string };
      const labels: Record<string, string> = {};
      if (item.country) labels.country = item.country;
      return {
        source: "test",
        sourceType: "test_metric",
        name: "n",
        value: { type: "num" as const, value: item.value },
        labels,
      };
    });
  },
};

// A fake pool that records what insertEvents() would write, so server tests need no real Postgres.
// insertEvents() uses pool.connect() + client.query(BEGIN/INSERT.../COMMIT); we capture the INSERT rows.
function fakePool(): { pool: Pool; inserted: unknown[][] } {
  const inserted: unknown[][] = [];
  const client = {
    query: (sql: string, params?: unknown[]) => {
      if (sql.trim().toUpperCase().startsWith("INSERT") && params) inserted.push(params);
      return Promise.resolve({ rows: [] });
    },
    release: () => {},
  };
  const pool = {
    connect: () => Promise.resolve(client),
    query: () => Promise.resolve({ rows: [] }),
  } as unknown as Pool;
  return { pool, inserted };
}

function registry(): SourceRegistry {
  const r = new SourceRegistry();
  r.register(testSource);
  return r;
}

let servers: ReturnType<typeof buildServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

function build(pool: Pool) {
  const app = buildServer({ pool, registry: registry() });
  servers.push(app);
  return app;
}

test("health check returns ok", async () => {
  const { pool } = fakePool();
  const res = await build(pool).inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ok" });
});

test("ingests a registered-source payload and returns 204", async () => {
  const { pool, inserted } = fakePool();
  const res = await build(pool).inject({
    method: "POST",
    url: "/ingest",
    payload: { source_type: "test_metric", items: [{ value: 1 }] },
  });
  expect(res.statusCode).toBe(204);
  expect(inserted).toHaveLength(1);
});

test("accepts text/plain body (sendBeacon default)", async () => {
  const { pool, inserted } = fakePool();
  const res = await build(pool).inject({
    method: "POST",
    url: "/ingest",
    headers: { "content-type": "text/plain" },
    payload: JSON.stringify({
      source: "s",
      source_type: "custom",
      name: "x",
      value: { type: "num", value: 1 },
    }),
  });
  expect(res.statusCode).toBe(204);
  expect(inserted).toHaveLength(1);
});

test("fills country from a proxy header when the event omits it", async () => {
  const { pool, inserted } = fakePool();
  await build(pool).inject({
    method: "POST",
    url: "/ingest",
    headers: { "cf-ipcountry": "DE" },
    payload: { source: "s", source_type: "custom", name: "x", value: { type: "num", value: 1 } },
  });
  // labels is param index 9 (0-based) in the INSERT (see events.ts column order).
  const labels = JSON.parse(inserted[0]?.[9] as string);
  expect(labels.country).toBe("DE");
});

test("does not override a country the event already provided", async () => {
  const { pool, inserted } = fakePool();
  await build(pool).inject({
    method: "POST",
    url: "/ingest",
    headers: { "cf-ipcountry": "DE" },
    payload: { source_type: "test_metric", items: [{ value: 1, country: "IN" }] },
  });
  const labels = JSON.parse(inserted[0]?.[9] as string);
  expect(labels.country).toBe("IN");
});

test("returns 400 on an invalid payload, does not insert", async () => {
  const { pool, inserted } = fakePool();
  const res = await build(pool).inject({
    method: "POST",
    url: "/ingest",
    payload: { source: "s", name: "missing-source-type-and-value" },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toHaveProperty("error");
  expect(inserted).toHaveLength(0);
});
