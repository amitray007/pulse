import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { InvalidPayloadError, type SourceRegistry } from "@pulse/core";
import { insertEvents, type EventInput, type Pool } from "@pulse/db";
import { payloadToEvents } from "./ingest.js";

/**
 * Stamp a label onto ingested events from a request header, when the event doesn't already carry it.
 * Generic — the deployment decides which headers become which labels (e.g. a CDN geo header). The
 * collector itself has no built-in header knowledge.
 */
export interface HeaderEnrichment {
  /** Request header to read (lower-case), e.g. "cf-ipcountry". */
  header: string;
  /** Label key to set from it, e.g. "country". */
  label: string;
  /** Optional guard on the header value; reject anything that doesn't match. */
  validate?: RegExp;
}

export interface CollectorDeps {
  pool: Pool;
  registry: SourceRegistry;
  /** Max ingest body size in bytes (abuse guard). Default 64 KiB. */
  bodyLimit?: number;
  /** Optional header→label enrichments (e.g. a CDN geo header). Default: none. */
  enrich?: HeaderEnrichment[];
  /**
   * Allowed CORS origins for browser clients. `/ingest` is written from browsers on other origins,
   * so the collector must answer preflight and echo an allow-origin header. Values:
   *   - undefined / [] → CORS disabled (no headers; same-origin or sendBeacon-only use).
   *   - ["*"]          → allow any origin (fine for a public write-only ingest endpoint).
   *   - explicit list  → echo the request Origin only when it's in the list.
   */
  corsOrigins?: string[];
  logger?: boolean;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
  validate?: RegExp,
): string | undefined {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  if (validate && !validate.test(value)) return undefined;
  return value;
}

// Apply the configured enrichments: for each event missing the label, set it from the header.
// Clones labels before writing — a source adapter may share one labels object across events.
function applyEnrichments(
  events: EventInput[],
  headers: Record<string, string | string[] | undefined>,
  enrich: HeaderEnrichment[],
): void {
  for (const { header, label, validate } of enrich) {
    const value = headerValue(headers, header, validate);
    if (!value) continue;
    for (const event of events) {
      if (event.labels?.[label]) continue;
      event.labels = { ...(event.labels ?? {}), [label]: value };
    }
  }
}

/**
 * Resolve the `Access-Control-Allow-Origin` value for a request, or undefined when CORS is off or
 * the origin isn't allowed. `["*"]` allows any origin; an explicit list echoes the request Origin
 * only on a match (so the header is never a blanket `*` for a listed deployment).
 */
function resolveAllowOrigin(
  requestOrigin: string | undefined,
  corsOrigins: string[] | undefined,
): string | undefined {
  if (!corsOrigins?.length) return undefined;
  if (corsOrigins.includes("*")) return "*";
  if (requestOrigin && corsOrigins.includes(requestOrigin)) return requestOrigin;
  return undefined;
}

/** Build the collector HTTP server. Does not listen; call `.listen()` on the result. */
export function buildServer(deps: CollectorDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: deps.bodyLimit ?? 64 * 1024,
  });

  // CORS: `/ingest` is written cross-origin from browsers. When enabled, echo an allow-origin
  // header on every response and answer the preflight OPTIONS. sendBeacon (text/plain) is a CORS
  // "simple request" and works without this, but fetch()-based clients and preflighted requests need it.
  if (deps.corsOrigins?.length) {
    app.addHook("onRequest", async (request, reply) => {
      const allowOrigin = resolveAllowOrigin(request.headers.origin, deps.corsOrigins);
      if (!allowOrigin) return;
      reply.header("access-control-allow-origin", allowOrigin);
      if (allowOrigin !== "*") reply.header("vary", "Origin");
      if (request.method === "OPTIONS") {
        reply
          .header("access-control-allow-methods", "POST, OPTIONS")
          .header("access-control-allow-headers", "content-type")
          .header("access-control-max-age", "86400")
          .code(204)
          .send();
      }
    });
  }

  // sendBeacon defaults to text/plain; accept it and parse as JSON.
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new InvalidPayloadError("body is not valid JSON"), undefined);
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Ingest handler, registered on multiple paths. `/ingest` is the descriptive canonical route;
  // `/e` is a short, neutral alias that avoids tracker/ad-blocker filter-list patterns (many lists
  // match "/ingest", "/collect", "/track", etc.), so a browser beacon is less likely to be blocked.
  const ingest = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    let events: EventInput[];
    try {
      events = payloadToEvents(request.body, deps.registry);
    } catch (err) {
      if (err instanceof InvalidPayloadError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    if (deps.enrich?.length) applyEnrichments(events, request.headers, deps.enrich);
    await insertEvents(deps.pool, events);
    return reply.code(204).send();
  };

  app.post("/ingest", ingest);
  app.post("/e", ingest); // short, filter-list-neutral alias

  return app;
}
