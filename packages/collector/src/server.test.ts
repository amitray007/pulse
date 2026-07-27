import { afterEach, expect, test } from "vitest";
import { InvalidPayloadError, SourceRegistry, type Source } from "@pulse/core";
import type { Pool } from "@pulse/db";
import { buildServer } from "./server.js";

// A generic test source: explodes { items: [{ value, region? }, ...] } into numeric events,
// carrying a region label only when the item provides one. No specific adapter involved.
const testSource: Source = {
  sourceType: "test_metric",
  toEvents(payload) {
    const items = (payload as { items?: unknown }).items;
    if (!Array.isArray(items)) throw new InvalidPayloadError("items must be an array");
    return items.map((raw) => {
      const item = raw as { value: number; region?: string };
      const labels: Record<string, string> = {};
      if (item.region) labels.region = item.region;
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

function build(
  pool: Pool,
  enrich?: import("./server.js").HeaderEnrichment[],
  corsOrigins?: string[],
) {
  const app = buildServer({ pool, registry: registry(), enrich, corsOrigins });
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

test("the /e alias ingests identically to /ingest", async () => {
  const { pool, inserted } = fakePool();
  const res = await build(pool).inject({
    method: "POST",
    url: "/e", // short, filter-list-neutral alias for browser beacons
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

test("rejects a non-JSON text/plain body with 400, not 500", async () => {
  const { pool, inserted } = fakePool();
  const res = await build(pool).inject({
    method: "POST",
    url: "/ingest",
    headers: { "content-type": "text/plain" },
    payload: "this is not json at all",
  });
  // The content-type parser throws InvalidPayloadError (statusCode 400); Fastify must surface
  // it as a client error, not a 500. Regression test for the sendBeacon-malformed-body path.
  expect(res.statusCode).toBe(400);
  expect(inserted).toHaveLength(0);
});

const enrich = [{ header: "x-region", label: "region", validate: /^[a-z0-9-]+$/ }];

test("enrichment stamps a label from a configured header when the event omits it", async () => {
  const { pool, inserted } = fakePool();
  await build(pool, enrich).inject({
    method: "POST",
    url: "/ingest",
    headers: { "x-region": "eu-west" },
    payload: { source: "s", source_type: "custom", name: "x", value: { type: "num", value: 1 } },
  });
  // labels is param index 9 (0-based) in the INSERT (see events.ts column order).
  const labels = JSON.parse(inserted[0]?.[9] as string);
  expect(labels.region).toBe("eu-west");
});

test("enrichment does not override a label the event already provided", async () => {
  const { pool, inserted } = fakePool();
  await build(pool, enrich).inject({
    method: "POST",
    url: "/ingest",
    headers: { "x-region": "eu-west" },
    payload: { source_type: "test_metric", items: [{ value: 1, region: "us-east" }] },
  });
  const labels = JSON.parse(inserted[0]?.[9] as string);
  expect(labels.region).toBe("us-east");
});

test("enrichment rejects a header value that fails validation", async () => {
  const { pool, inserted } = fakePool();
  await build(pool, enrich).inject({
    method: "POST",
    url: "/ingest",
    headers: { "x-region": "BAD REGION!" },
    payload: { source: "s", source_type: "custom", name: "x", value: { type: "num", value: 1 } },
  });
  const labels = JSON.parse(inserted[0]?.[9] as string);
  expect(labels.region).toBeUndefined();
});

test("no CORS headers when corsOrigins is unset", async () => {
  const { pool } = fakePool();
  const res = await build(pool).inject({
    method: "POST",
    url: "/ingest",
    headers: { origin: "https://admin.shopify.com" },
    payload: { source_type: "test_metric", items: [{ value: 1 }] },
  });
  expect(res.statusCode).toBe(204);
  expect(res.headers["access-control-allow-origin"]).toBeUndefined();
});

test("wildcard corsOrigins echoes * on ingest", async () => {
  const { pool } = fakePool();
  const res = await build(pool, undefined, ["*"]).inject({
    method: "POST",
    url: "/ingest",
    headers: { origin: "https://admin.shopify.com" },
    payload: { source_type: "test_metric", items: [{ value: 1 }] },
  });
  expect(res.statusCode).toBe(204);
  expect(res.headers["access-control-allow-origin"]).toBe("*");
});

test("OPTIONS preflight is answered with 204 and CORS headers", async () => {
  const { pool } = fakePool();
  const res = await build(pool, undefined, ["*"]).inject({
    method: "OPTIONS",
    url: "/ingest",
    headers: {
      origin: "https://admin.shopify.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  expect(res.statusCode).toBe(204);
  expect(res.headers["access-control-allow-origin"]).toBe("*");
  expect(res.headers["access-control-allow-methods"]).toContain("POST");
  expect(res.headers["access-control-allow-headers"]).toContain("content-type");
});

test("explicit allow-list echoes a listed origin and adds Vary", async () => {
  const { pool } = fakePool();
  const res = await build(pool, undefined, ["https://admin.shopify.com"]).inject({
    method: "POST",
    url: "/ingest",
    headers: { origin: "https://admin.shopify.com" },
    payload: { source_type: "test_metric", items: [{ value: 1 }] },
  });
  expect(res.headers["access-control-allow-origin"]).toBe("https://admin.shopify.com");
  expect(res.headers["vary"]).toContain("Origin");
});

test("explicit allow-list omits the header for an unlisted origin", async () => {
  const { pool } = fakePool();
  const res = await build(pool, undefined, ["https://admin.shopify.com"]).inject({
    method: "POST",
    url: "/ingest",
    headers: { origin: "https://evil.example.com" },
    payload: { source_type: "test_metric", items: [{ value: 1 }] },
  });
  expect(res.statusCode).toBe(204); // ingest still succeeds; the browser just won't expose the response
  expect(res.headers["access-control-allow-origin"]).toBeUndefined();
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
