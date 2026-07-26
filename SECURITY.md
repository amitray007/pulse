# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's **"Report a vulnerability"** feature
(Security → Advisories) rather than opening a public issue. We'll acknowledge within a few days.

## Security model (read before deploying)

Pulse has two network surfaces with very different trust levels:

- **The collector (`/ingest`)** is **public and unauthenticated by design** — browser beacons
  (`navigator.sendBeacon`) can't send auth headers. It only ever _writes_ validated, typed events,
  is body-size-capped, and rejects malformed input. Treat all ingested data as untrusted.

- **The MCP server** has **full database power** (read, write, and DDL) by design — it's a
  single-operator AI tool. It is protected by a **bearer token** (constant-time compared) and is
  meant to be **deployed off the public internet** (private network / VPN). **Do not expose the MCP
  port publicly**, and always set a strong, unique `MCP_AUTH_TOKEN`. The server refuses to boot with
  the placeholder token.

## Hardening checklist

- Set a strong random `MCP_AUTH_TOKEN`.
- Keep the MCP reachable only from your own network (the sample compose binds it to `127.0.0.1`).
- Use a dedicated Postgres role for the deployment; the data is aggregate telemetry, but scope it as
  you would any datastore.
- Put the collector behind your CDN/WAF if you want rate limiting; Pulse itself does validation and
  body limits but not rate limiting.
