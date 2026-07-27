import type { EventInput } from "@pulse/db";

/**
 * A Source teaches Pulse how to accept one kind of raw payload and turn it into generic events.
 * Adding a new data source means implementing this interface — never changing the core.
 */
export interface Source {
  /** Schema discriminator stored on every event, e.g. "http" or "app_metric". Unique per source. */
  readonly sourceType: string;

  /**
   * Turn one raw ingest payload into zero or more generic events.
   * Throw on invalid input; the collector maps that to a 4xx and drops the payload.
   */
  toEvents(payload: unknown): EventInput[];
}

/** Thrown by a Source when the incoming payload is malformed. */
export class InvalidPayloadError extends Error {
  /**
   * HTTP status for this error. Malformed input is a client error, so 400. Fastify reads
   * `statusCode` when a content-type parser rejects, so this ensures a bad body (e.g. non-JSON)
   * surfaces as 400 rather than the default 500.
   */
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "InvalidPayloadError";
  }
}
