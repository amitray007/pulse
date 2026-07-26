import { expect, test } from "vitest";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://x", MCP_AUTH_TOKEN: "real-secret" };

test("loads a valid config", () => {
  const cfg = loadConfig({ ...base, MCP_PORT: "9000" } as NodeJS.ProcessEnv);
  expect(cfg).toEqual({
    databaseUrl: "postgres://x",
    authToken: "real-secret",
    port: 9000,
    host: "0.0.0.0",
  });
});

test("defaults the port when unset", () => {
  expect(loadConfig(base as NodeJS.ProcessEnv).port).toBe(8090);
});

test("refuses the placeholder token", () => {
  expect(() => loadConfig({ ...base, MCP_AUTH_TOKEN: "change-me" } as NodeJS.ProcessEnv)).toThrow(
    /change-me/,
  );
});

test("requires MCP_AUTH_TOKEN", () => {
  expect(() => loadConfig({ DATABASE_URL: "postgres://x" } as NodeJS.ProcessEnv)).toThrow(
    /MCP_AUTH_TOKEN/,
  );
});

test("rejects an invalid port", () => {
  expect(() => loadConfig({ ...base, MCP_PORT: "nope" } as NodeJS.ProcessEnv)).toThrow(/port/);
});
