# Pulse

A self-hosted telemetry store. It ingests typed events over HTTP, keeps them in one
Postgres table, and exposes that table to an MCP client so you can query it with an AI
instead of maintaining dashboards.

It has no built-in notion of what it's measuring. An event is a named value (number, text,
or bool) with a timestamp and a set of labels. You bring the data; Pulse stores and serves it.

Status: early, and used by one person so far. It ships with no source adapters — there's one
example under `examples/` (Shopify Web Vitals) to show the shape.

## How it fits together

```
your app ──POST──▶ collector ──▶ Postgres ◀── MCP server ◀── AI / SQL client
```

- **collector** — a Fastify service. Accepts events at `POST /ingest` (or `/e`), validates
  them, writes rows.
- **Postgres** — a single `events` table: typed value columns plus a `labels` jsonb column,
  indexed for filtering, text search, and percentiles.
- **mcp** — an MCP server over an authenticated transport, with `query`, `explain`, `schema`,
  `stats`, and (for trusted callers) `execute`.

An event can be posted directly in Pulse's generic shape, or a _source adapter_ can translate
some app-specific payload into events. Adapters implement one function (`payload -> EventInput[]`)
and register themselves; the core doesn't change. See `examples/web_vital`.

## Layout

```
packages/db/          Postgres access, the events schema, migrations
packages/core/        the Source interface + registry
packages/collector/   the HTTP ingest service
packages/mcp/         the MCP server
sources/              your adapters (empty by default)
examples/web_vital/   an example adapter (Shopify Web Vitals)
deploy/               Dockerfile + docker-compose
```

## Running it

```bash
cp .env.example .env        # set MCP_AUTH_TOKEN
docker compose -f deploy/docker-compose.yml up --build
```

Post an event:

```bash
curl -X POST http://localhost:8080/ingest -H 'Content-Type: application/json' \
  -d '{"source":"my-app","source_type":"custom","name":"queue_depth","value":{"type":"num","value":42},"unit":"count","labels":{"env":"prod"}}'
```

Then connect an MCP client to `http://localhost:8090` with an `Authorization: Bearer <token>`
header and query the `events` table.

## Grouping

Two handles let you slice the data without predefined views:

- `labels` (jsonb) — any dimensions you attach (`service`, `shop`, `country`, `env`, ...).
- `group_id` — ties together events from one session, request, or launch.

Labels merge on dedup: if a later event reuses an `event_id`, its labels are added to the
existing row rather than overwriting it, so a sparse follow-up doesn't drop context.

```sql
-- P75 of a metric, by dimension
SELECT labels->>'shop' AS shop, labels->>'country' AS country,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY value_num) AS p75
FROM events WHERE name = 'lcp_ms' GROUP BY 1, 2;

-- one session's events
SELECT name, value_num FROM events WHERE group_id = '<id>' ORDER BY received_at;
```

## Development

Node 22+, pnpm, and a local Postgres for integration tests.

```bash
pnpm install
createdb pulse_test
PULSE_TEST_DATABASE_URL=postgres://localhost:5432/pulse_test pnpm run check
```

`pnpm run check` is Prettier + ESLint + tsc + Vitest. Integration tests skip when
`PULSE_TEST_DATABASE_URL` is unset.

## License

MIT — see [LICENSE](./LICENSE).
