-- Pulse core schema: one generic, typed events table.
--
-- An event is a named, typed value, at a time, with labels (Prometheus/OpenTelemetry shaped).
-- The value is split into typed columns so numbers aggregate fast, text is searchable, and every
-- dimension is a first-class label — never a JSON blob you have to dig through.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS events (
  id            bigserial PRIMARY KEY,
  received_at   timestamptz NOT NULL DEFAULT now(),
  ts            timestamptz,                 -- client-supplied event time (nullable)

  source        text NOT NULL,               -- who sent it, e.g. 'shopify-app'
  source_type   text NOT NULL,               -- schema discriminator, e.g. 'web_vital'
  name          text NOT NULL,               -- the metric/event name, e.g. 'LCP'

  -- Typed value: exactly one column is authoritative, named by value_type.
  value_num     double precision,
  value_text    text,
  value_bool    boolean,
  value_type    text NOT NULL,               -- 'num' | 'text' | 'bool'
  unit          text,                        -- 'ms' | 'score' | 'count' | null

  -- Generic dimensions (labels). Filtered via GIN out of the box; hot keys promoted to
  -- generated columns per deployment (see 002+ migrations added by source adapters).
  labels        jsonb NOT NULL DEFAULT '{}',

  -- Generic correlation / dedup.
  event_id      text,                        -- source's unique id for this measurement (dedup key)
  group_id      text,                        -- correlate events from one session/launch/request

  CONSTRAINT events_value_type_check CHECK (value_type IN ('num', 'text', 'bool'))
);

-- Idempotent dedup: a source that supplies event_id upserts on (source_type, event_id, name).
-- Sources without an event_id always insert (partial index leaves them unconstrained).
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_dedup
  ON events (source_type, event_id, name)
  WHERE event_id IS NOT NULL;

-- Percentile / numeric-aggregation path.
CREATE INDEX IF NOT EXISTS ix_events_num
  ON events (source_type, name, received_at)
  WHERE value_num IS NOT NULL;

-- Arbitrary label filtering (any dimension, no per-deployment setup required).
CREATE INDEX IF NOT EXISTS ix_events_labels
  ON events USING gin (labels jsonb_path_ops);

-- Text search over string-valued events.
CREATE INDEX IF NOT EXISTS ix_events_text
  ON events USING gin (value_text gin_trgm_ops)
  WHERE value_text IS NOT NULL;
