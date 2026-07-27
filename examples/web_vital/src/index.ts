import { InvalidPayloadError, type Source } from "@pulse/core";
import type { EventInput } from "@pulse/db";

// EXAMPLE source adapter — a reference implementation of the `Source` interface, not part of the
// Pulse core. It turns a Shopify App Bridge Web Vitals beacon (one onReport firing carrying an array
// of metrics) into one generic event per metric. Copy this shape to write your own adapter.

const KNOWN_METRICS = new Set(["LCP", "FCP", "CLS", "INP", "TTFB", "FID"]);

// CLS is a unitless score; the rest are milliseconds.
function unitFor(metricName: string): string {
  return metricName === "CLS" ? "score" : "ms";
}

interface RawMetric {
  name?: unknown;
  value?: unknown;
  id?: unknown;
  country?: unknown;
}

interface RawBeacon {
  metrics?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// Structural fields that are NOT labels (they drive routing/correlation, handled explicitly).
const RESERVED_KEYS = new Set(["source", "source_type", "metrics", "launch_id"]);

// Promote every non-structural top-level beacon field to a label. Strings pass through; finite
// numbers and booleans are stringified (labels are text); everything else (objects, arrays) is skipped.
function collectLabels(beacon: Record<string, unknown>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(beacon)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (typeof value === "string") {
      if (value.length > 0) labels[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      labels[key] = String(value);
    } else if (typeof value === "boolean") {
      labels[key] = String(value);
    }
  }
  return labels;
}

export const webVitalSource: Source = {
  sourceType: "web_vital",

  toEvents(payload: unknown): EventInput[] {
    if (typeof payload !== "object" || payload === null) {
      throw new InvalidPayloadError("beacon must be an object");
    }
    const beacon = payload as Record<string, unknown> & RawBeacon;

    if (!Array.isArray(beacon.metrics)) {
      throw new InvalidPayloadError("beacon.metrics must be an array");
    }

    // Every top-level field EXCEPT the structural ones becomes a shared label on each metric. This
    // way the beacon can carry any context (app, shop_id, connection_type, is_mobile, os, path, ...)
    // without changing this adapter — the app decides what's worth grouping by.
    const labels = collectLabels(beacon);

    const groupId = asString(beacon.launch_id) ?? null;

    const events: EventInput[] = [];
    for (const raw of beacon.metrics as RawMetric[]) {
      const name = asString(raw?.name);
      if (!name || !KNOWN_METRICS.has(name)) continue; // ignore unknown metrics, don't fail the beacon
      if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) continue;

      const country = asString(raw.country);
      const metricLabels = country ? { ...labels, country } : labels;

      events.push({
        source: "shopify-app",
        sourceType: "web_vital",
        name,
        value: { type: "num", value: raw.value },
        unit: unitFor(name),
        labels: metricLabels,
        eventId: asString(raw.id) ?? null, // Shopify's per-measurement id → dedup key
        groupId,
      });
    }

    if (events.length === 0) {
      throw new InvalidPayloadError("beacon contained no valid metrics");
    }
    return events;
  },
};
