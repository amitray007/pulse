# Pulse

**Self-hosted, generic telemetry platform.** Ingest typed events, store them queryably in Postgres,
and expose the database to AI over MCP — so you ask questions and build dashboards on demand instead
of maintaining fixed ones.

> Status: early. Foundation + generic core first; the first source adapter is Shopify embedded-app
> Web Vitals, but Pulse itself knows nothing about web vitals.

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
- **sources/** — per-source descriptors + optional adapter code. `sources/web_vital/` is the reference.

## Repo layout

```
packages/db/     shared Postgres access + schema/migrations
core/            ingest handling + source registry (planned)
collector/       HTTP ingest service (planned)
mcp/             MCP server (planned)
sources/         source adapters — web_vital is the first (planned)
deploy/          Docker Compose + deploy notes (planned)
```

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm run check      # format check + lint + typecheck + test
```

## License

MIT — see [LICENSE](./LICENSE).
