import { InvalidPayloadError, type SourceRegistry } from "@pulse/core";
import type { EventInput, EventValue } from "@pulse/db";

// Two accepted ingest shapes:
//   1. Raw source payload:  { source_type: "web_vital", ...sourceSpecificFields }
//      → the registered source explodes it into events.
//   2. Generic event(s):    { source, source_type, name, value, ... }  (or an array of them)
//      → stored directly, no source adapter needed.

const VALUE_TYPES = new Set(["num", "text", "bool"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse a generic event object into a validated EventInput. Throws InvalidPayloadError. */
function parseGenericEvent(raw: Record<string, unknown>): EventInput {
  const source = raw.source;
  const sourceType = raw.source_type;
  const name = raw.name;
  if (typeof source !== "string" || typeof sourceType !== "string" || typeof name !== "string") {
    throw new InvalidPayloadError("event requires string source, source_type, and name");
  }

  const value = parseValue(raw.value);

  const event: EventInput = { source, sourceType, name, value };
  if (typeof raw.unit === "string") event.unit = raw.unit;
  if (typeof raw.event_id === "string") event.eventId = raw.event_id;
  if (typeof raw.group_id === "string") event.groupId = raw.group_id;
  if (typeof raw.ts === "string") {
    const ts = new Date(raw.ts);
    if (!Number.isNaN(ts.getTime())) event.ts = ts;
  }
  if (isObject(raw.labels)) {
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.labels)) {
      if (typeof v === "string") labels[k] = v;
    }
    event.labels = labels;
  }
  return event;
}

function parseValue(raw: unknown): EventValue {
  if (!isObject(raw) || typeof raw.type !== "string" || !VALUE_TYPES.has(raw.type)) {
    throw new InvalidPayloadError("event.value must be { type: num|text|bool, value }");
  }
  if (raw.type === "num") {
    if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) {
      throw new InvalidPayloadError("numeric event value must be a finite number");
    }
    return { type: "num", value: raw.value };
  }
  if (raw.type === "text") {
    if (typeof raw.value !== "string")
      throw new InvalidPayloadError("text event value must be a string");
    return { type: "text", value: raw.value };
  }
  if (typeof raw.value !== "boolean")
    throw new InvalidPayloadError("bool event value must be a boolean");
  return { type: "bool", value: raw.value };
}

/**
 * Turn a request body into events to persist.
 * Resolves a registered source when `source_type` matches one; otherwise treats the body as
 * generic event(s). Throws InvalidPayloadError on anything malformed.
 */
export function payloadToEvents(body: unknown, registry: SourceRegistry): EventInput[] {
  if (Array.isArray(body)) {
    return body.map((item) => {
      if (!isObject(item)) throw new InvalidPayloadError("event array items must be objects");
      return parseGenericEvent(item);
    });
  }
  if (!isObject(body)) {
    throw new InvalidPayloadError("ingest body must be an object or array of events");
  }

  const sourceType = body.source_type;
  if (typeof sourceType === "string" && registry.has(sourceType)) {
    // A registered source owns this payload — let it explode/validate.
    const source = registry.get(sourceType);
    return source ? source.toEvents(body) : [];
  }

  // No matching source → treat as a single generic event.
  return [parseGenericEvent(body)];
}
