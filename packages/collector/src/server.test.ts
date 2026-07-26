import { afterEach, expect, test } from "vitest";
import { SourceRegistry } from "@pulse/core";
import { webVitalSource } from "@pulse/source-web-vital";
import type { Pool } from "@pulse/db";
import { buildServer } from "./server.js";

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
  r.register(webVitalSource);
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

test("ingests a web-vital beacon and returns 204", async () => {
  const { pool, inserted } = fakePool();
  const res = await build(pool).inject({
    method: "POST",
    url: "/ingest",
    payload: { source_type: "web_vital", app: "A", metrics: [{ name: "LCP", value: 1, id: "x" }] },
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

test("does not override a country the beacon already provided", async () => {
  const { pool, inserted } = fakePool();
  await build(pool).inject({
    method: "POST",
    url: "/ingest",
    headers: { "cf-ipcountry": "DE" },
    payload: {
      source_type: "web_vital",
      app: "A",
      metrics: [{ name: "LCP", value: 1, id: "x", country: "IN" }],
    },
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
