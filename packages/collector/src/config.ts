/** Collector configuration, read from the environment. */
export interface CollectorConfig {
  databaseUrl: string;
  port: number;
  host: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? required("DATABASE_URL"),
    port: Number.parseInt(env.COLLECTOR_PORT ?? "8080", 10),
    host: env.COLLECTOR_HOST ?? "0.0.0.0",
  };
}
