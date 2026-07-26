import Fastify, { type FastifyInstance } from "fastify";
import { InvalidPayloadError, type SourceRegistry } from "@pulse/core";
import { insertEvents, type EventInput, type Pool } from "@pulse/db";
import { payloadToEvents } from "./ingest.js";

export interface CollectorDeps {
  pool: Pool;
  registry: SourceRegistry;
  /** Max ingest body size in bytes (abuse guard). Default 64 KiB. */
  bodyLimit?: number;
  logger?: boolean;
}

// Some proxies/CDNs add a country header (e.g. Cloudflare's cf-ipcountry). When a beacon omits
// country, fall back to that header so the population signal is never lost. Applied only to events
// that don't already carry a country label.
const COUNTRY_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "x-country-code"];

function countryFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  for (const h of COUNTRY_HEADERS) {
    const v = headers[h];
    const code = Array.isArray(v) ? v[0] : v;
    if (code && code !== "XX") return code;
  }
  return undefined;
}

function fillCountry(events: EventInput[], country: string | undefined): void {
  if (!country) return;
  for (const event of events) {
    const labels = event.labels ?? (event.labels = {});
    if (!labels.country) labels.country = country;
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

    fillCountry(events, countryFromHeaders(request.headers));
    await insertEvents(deps.pool, events);
    return reply.code(204).send();
  });

  return app;
}
