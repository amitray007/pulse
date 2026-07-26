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
  app?: unknown;
  shop?: unknown;
  shop_id?: unknown;
  path?: unknown;
  app_version?: unknown;
  launch_id?: unknown;
  metrics?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const webVitalSource: Source = {
  sourceType: "web_vital",

  toEvents(payload: unknown): EventInput[] {
    if (typeof payload !== "object" || payload === null) {
      throw new InvalidPayloadError("beacon must be an object");
    }
    const beacon = payload as RawBeacon;

    if (!Array.isArray(beacon.metrics)) {
      throw new InvalidPayloadError("beacon.metrics must be an array");
    }

    // Shared labels/dimensions for every metric in this beacon.
    const app = asString(beacon.app);
    const labels: Record<string, string> = {};
    if (app) labels.app = app;
    const shop = asString(beacon.shop);
    if (shop) labels.shop = shop;
    const appVersion = asString(beacon.app_version);
    if (appVersion) labels.app_version = appVersion;
    const path = asString(beacon.path);
    if (path) labels.path = path;

    const shopId =
      typeof beacon.shop_id === "number" && Number.isFinite(beacon.shop_id)
        ? beacon.shop_id
        : undefined;
    if (shopId !== undefined) labels.shop_id = String(shopId);

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
