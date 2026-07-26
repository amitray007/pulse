# Contributing to Pulse

Thanks for your interest. Pulse is a small, focused project — a generic self-hosted telemetry
platform. Contributions that keep it minimal and clean are very welcome.

## Development setup

Requires Node 22+ and pnpm, plus a local Postgres for integration tests.

```bash
pnpm install
createdb pulse_test                              # one-time, for tests
PULSE_TEST_DATABASE_URL=postgres://localhost:5432/pulse_test pnpm run check
```

`pnpm run check` runs the full gate: Prettier, ESLint, `tsc`, and Vitest — the same thing CI runs.
Integration tests skip cleanly when `PULSE_TEST_DATABASE_URL` is unset.

## Project layout

```
packages/db/         Postgres access, the generic events schema, migrations
packages/core/       source registry + the Source interface
packages/collector/  the HTTP ingest service (Fastify)
packages/mcp/        the MCP server (query/execute/explain/schema/stats)
sources/web_vital/   the first source adapter (reference implementation)
deploy/              Dockerfile + docker-compose
```

## Adding a new source

Pulse is source-agnostic. To teach it a new kind of data, add a package under `sources/` that
implements the `Source` interface (`payload -> EventInput[]`) — see `sources/web_vital` as the
reference. You should not need to change `packages/core` or `packages/db`.

## Guidelines

- **Keep it minimal.** Prefer the smallest change that solves the problem. No frameworks-for-the-sake-of.
- **Tests with behavior.** Any behavioral change ships with a test. Bug fixes ship with a regression test.
- **One concern per PR.** Small, reviewable PRs land faster.
- **Conventional commits** (`feat:`, `fix:`, `chore:`, `docs:`) — the history reads as a changelog.
- **`pnpm run check` must pass** before you open a PR.

## Reporting bugs / requesting features

Open an issue using the templates. For security issues, see [SECURITY.md](./SECURITY.md) — do not
open a public issue.
