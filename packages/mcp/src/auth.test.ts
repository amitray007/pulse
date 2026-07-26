import { expect, test } from "vitest";
import { isAuthorized } from "./auth.js";

const TOKEN = "s3cret-token";
const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} });

test("accepts a correct bearer token", () => {
  expect(isAuthorized(req(`Bearer ${TOKEN}`), TOKEN)).toBe(true);
});

test("rejects a wrong token", () => {
  expect(isAuthorized(req("Bearer wrong"), TOKEN)).toBe(false);
});

test("rejects a missing Authorization header", () => {
  expect(isAuthorized(req(), TOKEN)).toBe(false);
});

test("rejects a non-Bearer scheme", () => {
  expect(isAuthorized(req(`Basic ${TOKEN}`), TOKEN)).toBe(false);
});

test("rejects a bearer header with no token", () => {
  expect(isAuthorized(req("Bearer "), TOKEN)).toBe(false);
});

test("rejects a token that is a prefix of the expected token", () => {
  expect(isAuthorized(req("Bearer s3cret"), TOKEN)).toBe(false);
});

test("accepts a token containing spaces (whole remainder after scheme)", () => {
  expect(isAuthorized(req("Bearer tok en with spaces"), "tok en with spaces")).toBe(true);
});

test("accepts a case-insensitive bearer scheme", () => {
  expect(isAuthorized(req(`bearer ${TOKEN}`), TOKEN)).toBe(true);
});

test("rejects a header with no space separator", () => {
  expect(isAuthorized(req("Bearer"), TOKEN)).toBe(false);
});
