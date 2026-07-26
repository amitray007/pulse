import { expect, test } from "vitest";
import { SourceRegistry } from "./registry.js";
import type { Source } from "./source.js";

const fakeSource = (sourceType: string): Source => ({
  sourceType,
  toEvents: () => [],
});

test("registers and retrieves a source by type", () => {
  const reg = new SourceRegistry();
  const s = fakeSource("http");
  reg.register(s);
  expect(reg.get("http")).toBe(s);
  expect(reg.has("http")).toBe(true);
  expect(reg.list()).toEqual(["http"]);
});

test("unknown source type returns undefined", () => {
  const reg = new SourceRegistry();
  expect(reg.get("nope")).toBeUndefined();
  expect(reg.has("nope")).toBe(false);
});

test("rejects duplicate source type", () => {
  const reg = new SourceRegistry();
  reg.register(fakeSource("dup"));
  expect(() => reg.register(fakeSource("dup"))).toThrow(/duplicate source type/);
});
