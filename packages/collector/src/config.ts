/** Collector configuration, read from the environment. */
export interface CollectorConfig {
  databaseUrl: string;
  port: number;
  host: string;
  /** Allowed CORS origins (comma-separated in CORS_ORIGINS). Empty = CORS disabled. */
  corsOrigins: string[];
}

/** Parse a comma-separated origin list; trims blanks. "*" is a valid single entry (allow any). */
function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  return {
    databaseUrl: required("DATABASE_URL", env),
    port: parsePort("COLLECTOR_PORT", env.COLLECTOR_PORT, 8080),
    host: env.COLLECTOR_HOST ?? "0.0.0.0",
    corsOrigins: parseOrigins(env.CORS_ORIGINS),
  };
}
