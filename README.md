# Pulse

**Self-hosted, generic telemetry platform.** Ingest typed events, store them queryably in Postgres,
and expose the database to AI over MCP — so you ask questions and build dashboards on demand instead
of maintaining fixed ones.

> Status: early. Pulse is source-agnostic — it ships with no source adapters by default. An example
> adapter (Shopify Web Vitals) lives under `examples/` to show the pattern.

## Why

Most telemetry tools lock you into their schema and their dashboards. Pulse is the opposite:

- **Generic core.** An event is a _named, typed value, at a time, with labels_ (Prometheus/OpenTelemetry
  shaped). Numbers are first-class (fast percentiles), text is searchable, labels are filterable — no
  JSON-blob swamp.
- **Sources are plugins.** Teach Pulse a new data source by adding a descriptor, not by changing the core.
- **AI is the dashboard.** A token-gated MCP server exposes the database (query, explain, schema, stats,
  and — for trusted operators — writes). Ask an AI "P75 by country over the last week" instead of
  building a panel.

## Architecture

```
sources ──beacon──▶  collector  ──▶  Postgres  ◀──  MCP server  ◀──  AI / local tools
(any app)            ingest API      the store       query/operate
```

- **collector** — a small HTTP service. Validates incoming events against a registered source, then
  writes typed rows.
- **Postgres** — one generic `events` table (typed value columns + `labels` jsonb, indexed for filter,
  search, and percentiles).
- **mcp** — a remote MCP server exposing the database to AI over an authenticated transport.
- **sources / examples** — source adapters implement the `Source` interface (`payload -> EventInput[]`).
  Pulse ships none by default; `examples/web_vital` shows the pattern. Apps can also POST generic events
  directly, with no adapter at all.

## Repo layout

```
packages/db/          shared Postgres access, the generic events schema, migrations
packages/core/        the Source interface + source registry
packages/collector/   the HTTP ingest service (Fastify)
packages/mcp/         the MCP server (query / execute / explain / schema / stats)
sources/              your own source adapters (empty by default — bring your own)
examples/web_vital/   an example adapter: Shopify App Bridge Web Vitals
deploy/               Dockerfile + docker-compose
```

## Quick start

Run the whole stack (Postgres + collector + MCP) with Docker:

```bash
cp .env.example .env        # set MCP_AUTH_TOKEN to a real secret
docker compose -f deploy/docker-compose.yml up --build
```

Send an event to the collector:

```bash
curl -X POST http://localhost:8080/ingest -H 'Content-Type: application/json' \
  -d '{"source":"my-app","source_type":"custom","name":"queue_depth","value":{"type":"num","value":42},"unit":"count","labels":{"env":"prod"}}'
```

Then point an MCP client at `http://localhost:8090` with an `Authorization: Bearer <token>`
header and ask it to `query`, `explain`, `schema`, or `stats` your telemetry.

## Development

Requires Node 22+ and pnpm, plus a local Postgres for integration tests.

```bash
pnpm install
createdb pulse_test
PULSE_TEST_DATABASE_URL=postgres://localhost:5432/pulse_test pnpm run check
```

`pnpm run check` runs the full gate (Prettier + ESLint + tsc + Vitest). Integration tests skip
cleanly when `PULSE_TEST_DATABASE_URL` is unset.

## License

MIT — see [LICENSE](./LICENSE).
