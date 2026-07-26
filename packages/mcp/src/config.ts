/** MCP server configuration, read from the environment. */
export interface McpConfig {
  databaseUrl: string;
  authToken: string;
  port: number;
  host: string;
}

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

/** Parse a port env var, failing loudly on a non-numeric or out-of-range value. */
function parsePort(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port in 1-65535, got: ${raw}`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const authToken = required("MCP_AUTH_TOKEN", env);
  // The MCP has full DB power; refuse to boot with the placeholder token from .env.example.
  if (authToken === "change-me") {
    throw new Error("MCP_AUTH_TOKEN is still the default 'change-me' — set a real secret");
  }
  return {
    databaseUrl: required("DATABASE_URL", env),
    authToken,
    port: parsePort("MCP_PORT", env.MCP_PORT, 8090),
    host: env.MCP_HOST ?? "0.0.0.0",
  };
}
