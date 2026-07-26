import { expect, test } from "vitest";
import { InvalidPayloadError, SourceRegistry } from "@pulse/core";
import { webVitalSource } from "@pulse/source-web-vital";
import { payloadToEvents } from "./ingest.js";

function registry(): SourceRegistry {
  const r = new SourceRegistry();
  r.register(webVitalSource);
  return r;
}

test("routes a registered source_type to its adapter", () => {
  const events = payloadToEvents(
    { source_type: "web_vital", app: "A", metrics: [{ name: "LCP", value: 1, id: "x" }] },
    registry(),
  );
  expect(events).toHaveLength(1);
  expect(events[0]?.name).toBe("LCP");
});

test("accepts a generic event when source_type is not registered", () => {
  const events = payloadToEvents(
    { source: "svc", source_type: "custom", name: "latency", value: { type: "num", value: 42 } },
    registry(),
  );
  expect(events[0]).toMatchObject({
    source: "svc",
    sourceType: "custom",
    name: "latency",
    value: { type: "num", value: 42 },
  });
});

test("accepts an array of generic events", () => {
  const events = payloadToEvents(
    [
      { source: "s", source_type: "t", name: "a", value: { type: "num", value: 1 } },
      { source: "s", source_type: "t", name: "b", value: { type: "text", value: "ok" } },
    ],
    registry(),
  );
  expect(events.map((e) => e.name)).toEqual(["a", "b"]);
});

test("parses optional fields: unit, ts, labels, event_id, group_id", () => {
  const [e] = payloadToEvents(
    {
      source: "s",
      source_type: "t",
      name: "x",
      value: { type: "num", value: 1 },
      unit: "ms",
      ts: "2026-07-24T00:00:00.000Z",
      labels: { env: "prod", drop_me: 5 },
      event_id: "e1",
      group_id: "g1",
    },
    registry(),
  );
  expect(e?.unit).toBe("ms");
  expect(e?.eventId).toBe("e1");
  expect(e?.groupId).toBe("g1");
  expect(e?.labels).toEqual({ env: "prod" }); // non-string label dropped
  expect(e?.ts?.toISOString()).toBe("2026-07-24T00:00:00.000Z");
});

test("rejects a generic event missing required fields", () => {
  expect(() => payloadToEvents({ source: "s", name: "x" }, registry())).toThrow(
    InvalidPayloadError,
  );
});

test("rejects a bad value shape", () => {
  expect(() =>
    payloadToEvents({ source: "s", source_type: "t", name: "x", value: 5 }, registry()),
  ).toThrow(/event.value must be/);
});

test("rejects a non-finite numeric value", () => {
  expect(() =>
    payloadToEvents(
      { source: "s", source_type: "t", name: "x", value: { type: "num", value: Infinity } },
      registry(),
    ),
  ).toThrow(/finite number/);
});

test("rejects a non-object, non-array body", () => {
  expect(() => payloadToEvents("nope", registry())).toThrow(InvalidPayloadError);
});
