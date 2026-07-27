import type { Pool } from "pg";

/** The value carried by an event. Exactly one variant; the DB stores it in the matching column. */
export type EventValue =
  | { type: "num"; value: number }
  | { type: "text"; value: string }
  | { type: "bool"; value: boolean };

/** A single generic telemetry event, ready to persist. */
export interface EventInput {
  source: string;
  sourceType: string;
  name: string;
  value: EventValue;
  unit?: string | null;
  ts?: Date | null;
  labels?: Record<string, string>;
  /** Source's unique id for this measurement. When set, inserts dedup (upsert, last write wins). */
  eventId?: string | null;
  /** Correlates events from one session / launch / request. */
  groupId?: string | null;
}

// Dedup contract: `event_id` must be unique within a (source_type, name) across all sources —
// the conflict target is (source_type, event_id, name), NOT scoped by `source`. `source` is left
// out of DO UPDATE SET, so a re-fire keeps the original `source`. On conflict we keep the LAST
// value and bump received_at to now(), so received_at is "ingest time of the latest write" for a
// deduped measurement, not first-seen time.
//
// Context ACCRETES, it does not get erased. A re-fire (e.g. web-vitals reportAllChanges) often
// carries only the metric, not the full context — so `labels` MERGE (existing || incoming: keep known
// keys, add/overwrite with new ones) and `group_id` persists when the re-fire omits it (COALESCE).
// This keeps grouping dimensions (shop, country, session) reliable across sparse re-fires.
const INSERT_SQL = `
  INSERT INTO events
    (source, source_type, name, value_num, value_text, value_bool, value_type, unit, ts, labels, event_id, group_id)
  VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (source_type, event_id, name) WHERE event_id IS NOT NULL
  DO UPDATE SET
    value_num = EXCLUDED.value_num,
    value_text = EXCLUDED.value_text,
    value_bool = EXCLUDED.value_bool,
    value_type = EXCLUDED.value_type,
    unit = EXCLUDED.unit,
    ts = EXCLUDED.ts,
    labels = events.labels || EXCLUDED.labels,
    group_id = COALESCE(EXCLUDED.group_id, events.group_id),
    received_at = now()
`;

function toRow(e: EventInput): unknown[] {
  const num = e.value.type === "num" ? e.value.value : null;
  const text = e.value.type === "text" ? e.value.value : null;
  const bool = e.value.type === "bool" ? e.value.value : null;
  return [
    e.source,
    e.sourceType,
    e.name,
    num,
    text,
    bool,
    e.value.type,
    e.unit ?? null,
    e.ts ?? null,
    JSON.stringify(e.labels ?? {}),
    e.eventId ?? null,
    e.groupId ?? null,
  ];
}

/** Persist one event. Upserts when `eventId` is set, otherwise inserts. */
export async function insertEvent(pool: Pool, event: EventInput): Promise<void> {
  await pool.query(INSERT_SQL, toRow(event));
}

/** Persist many events in a single transaction. Empty input is a no-op. */
export async function insertEvents(pool: Pool, events: EventInput[]): Promise<void> {
  if (events.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const event of events) {
      await client.query(INSERT_SQL, toRow(event));
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
