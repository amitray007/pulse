import { expect, test } from "vitest";
import { InvalidPayloadError, SourceRegistry, type Source } from "@pulse/core";
import { payloadToEvents } from "./ingest.js";

// A tiny generic source used only in tests: it explodes { items: [n, ...] } into one numeric event
// per item. Keeps the collector tests self-contained and free of any specific adapter.
const testSource: Source = {
  sourceType: "test_metric",
  toEvents(payload) {
    const items = (payload as { items?: unknown }).items;
    if (!Array.isArray(items)) throw new InvalidPayloadError("items must be an array");
    return items.map((value) => ({
      source: "test",
      sourceType: "test_metric",
      name: "n",
      value: { type: "num" as const, value: value as number },
    }));
  },
};

function registry(): SourceRegistry {
  const r = new SourceRegistry();
  r.register(testSource);
  return r;
}

test("routes a registered source_type to its adapter", () => {
  const events = payloadToEvents({ source_type: "test_metric", items: [1, 2] }, registry());
  expect(events).toHaveLength(2);
  expect(events[0]?.name).toBe("n");
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
