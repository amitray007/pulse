import { expect, test } from "vitest";
import { InvalidPayloadError } from "@pulse/core";
import { webVitalSource } from "./index.js";

const beacon = {
  app: "FACEBOOK_PIXEL",
  shop: "adnabu-dev-test.myshopify.com",
  shop_id: 61820960924,
  path: "/shopify/facebook-pixel/home",
  app_version: "3.1.104",
  launch_id: "launch-abc",
  metrics: [
    { name: "LCP", value: 2772, id: "v3-1", country: "IN" },
    { name: "CLS", value: 0.006, id: "v3-2", country: "IN" },
  ],
};

test("explodes a beacon into one event per metric", () => {
  const events = webVitalSource.toEvents(beacon);
  expect(events).toHaveLength(2);
});

test("maps a metric to a typed numeric event with unit + labels + dedup id", () => {
  const [lcp] = webVitalSource.toEvents(beacon);
  expect(lcp).toEqual({
    source: "shopify-app",
    sourceType: "web_vital",
    name: "LCP",
    value: { type: "num", value: 2772 },
    unit: "ms",
    labels: {
      app: "FACEBOOK_PIXEL",
      shop: "adnabu-dev-test.myshopify.com",
      shop_id: "61820960924",
      path: "/shopify/facebook-pixel/home",
      app_version: "3.1.104",
      country: "IN",
    },
    eventId: "v3-1",
    groupId: "launch-abc",
  });
});

test("passes through arbitrary context fields as labels (network, device, page)", () => {
  const [lcp] = webVitalSource.toEvents({
    app: "TIKTOK_PIXEL",
    shop_id: 72000000001,
    connection_type: "3g",
    is_mobile: true,
    os: "Android",
    cpu_cores: 4,
    device_memory_gb: 4,
    path: "/home",
    timezone: "Asia/Kolkata",
    launch_id: "L1",
    metrics: [{ name: "LCP", value: 4200, id: "x", country: "IN" }],
  });
  expect(lcp?.labels).toEqual({
    app: "TIKTOK_PIXEL",
    shop_id: "72000000001", // number stringified
    connection_type: "3g",
    is_mobile: "true", // boolean stringified
    os: "Android",
    cpu_cores: "4",
    device_memory_gb: "4",
    path: "/home",
    timezone: "Asia/Kolkata",
    country: "IN", // from the metric
  });
  // structural keys must NOT leak into labels:
  expect(lcp?.labels).not.toHaveProperty("metrics");
  expect(lcp?.labels).not.toHaveProperty("launch_id");
  expect(lcp?.labels).not.toHaveProperty("source_type");
  expect(lcp?.groupId).toBe("L1"); // launch_id → group_id
});

test("CLS uses the score unit, not ms", () => {
  const cls = webVitalSource.toEvents(beacon).find((e) => e.name === "CLS");
  expect(cls?.unit).toBe("score");
  expect(cls?.value).toEqual({ type: "num", value: 0.006 });
});

test("ignores unknown metric names but keeps valid ones", () => {
  const events = webVitalSource.toEvents({
    app: "A",
    metrics: [
      { name: "MADE_UP", value: 1, id: "x" },
      { name: "LCP", value: 100, id: "y" },
    ],
  });
  expect(events.map((e) => e.name)).toEqual(["LCP"]);
});

test("skips metrics with non-numeric values", () => {
  const events = webVitalSource.toEvents({
    app: "A",
    metrics: [
      { name: "LCP", value: "slow", id: "x" },
      { name: "FCP", value: 200, id: "y" },
    ],
  });
  expect(events.map((e) => e.name)).toEqual(["FCP"]);
});

test("omits optional labels that are absent", () => {
  const [e] = webVitalSource.toEvents({ app: "A", metrics: [{ name: "LCP", value: 1, id: "x" }] });
  expect(e?.labels).toEqual({ app: "A" });
  expect(e?.groupId).toBeNull();
});

test("rejects a non-object payload", () => {
  expect(() => webVitalSource.toEvents("nope")).toThrow(InvalidPayloadError);
});

test("rejects a beacon without a metrics array", () => {
  expect(() => webVitalSource.toEvents({ app: "A" })).toThrow(InvalidPayloadError);
});

test("rejects a beacon whose metrics are all invalid", () => {
  expect(() =>
    webVitalSource.toEvents({ app: "A", metrics: [{ name: "NOPE", value: 1 }] }),
  ).toThrow(/no valid metrics/);
});
