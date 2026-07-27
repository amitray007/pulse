// @pulse/collector — HTTP ingest service.

export { buildServer, type CollectorDeps, type HeaderEnrichment } from "./server.js";
export { payloadToEvents } from "./ingest.js";
export { loadConfig, type CollectorConfig } from "./config.js";
