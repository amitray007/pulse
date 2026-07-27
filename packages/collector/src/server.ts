import Fastify, { type FastifyInstance } from "fastify";
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

/** Build the collector HTTP server. Does not listen; call `.listen()` on the result. */
export function buildServer(deps: CollectorDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: deps.bodyLimit ?? 64 * 1024,
  });

  // sendBeacon defaults to text/plain; accept it and parse as JSON.
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new InvalidPayloadError("body is not valid JSON"), undefined);
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/ingest", async (request, reply) => {
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
  });

  return app;
}
