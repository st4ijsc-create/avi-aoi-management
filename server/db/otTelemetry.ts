// Sprint F6 — read-only DB access for OT telemetry (line-monitoring AI tools).
//
// Additive module. All functions are READ-ONLY and Number()-normalize the
// decimal `valueNumeric`. Used by handlersF6 (get_ot_telemetry_latest,
// get_palletizer_status) and insightHandlersF6. No writes.
import { getDb } from "./connection";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { otTelemetry, deviceTags } from "../../drizzle/schema";

export interface TelemetryLatestRow {
  id: number;
  machineId: number | null;
  tagKey: string;
  valueNumeric: number | null;
  valueText: string | null;
  quality: string;
  timestamp: string; // ISO
  unit: string | null;
}

/**
 * Latest telemetry rows for a machine (optionally one tag), newest first.
 * Joins deviceTags (by adapterId + tagKey) to surface the engineering unit.
 */
export async function getLatestTelemetry(opts: {
  machineId: number;
  tagKey?: string;
  limit?: number;
}): Promise<TelemetryLatestRow[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(otTelemetry.machineId, opts.machineId)];
  if (opts.tagKey) conds.push(eq(otTelemetry.tagKey, opts.tagKey));
  const rows = await db
    .select({
      id: otTelemetry.id,
      machineId: otTelemetry.machineId,
      tagKey: otTelemetry.tagKey,
      valueNumeric: otTelemetry.valueNumeric,
      valueText: otTelemetry.valueText,
      quality: otTelemetry.quality,
      timestamp: otTelemetry.timestamp,
      unit: deviceTags.unit,
    })
    .from(otTelemetry)
    .leftJoin(
      deviceTags,
      and(eq(deviceTags.adapterId, otTelemetry.adapterId), eq(deviceTags.tagKey, otTelemetry.tagKey)),
    )
    .where(and(...conds))
    .orderBy(desc(otTelemetry.timestamp))
    .limit(Math.min(Math.max(opts.limit ?? 10, 1), 100));
  return rows.map((r) => ({
    id: r.id,
    machineId: r.machineId ?? null,
    tagKey: r.tagKey,
    valueNumeric: r.valueNumeric == null ? null : Number(r.valueNumeric),
    valueText: r.valueText ?? null,
    quality: String(r.quality ?? "good"),
    timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : "",
    unit: r.unit ?? null,
  }));
}

export interface TelemetrySeriesPoint {
  ts: number; // epoch ms
  value: number;
}

/**
 * Numeric telemetry series for one tag since `since`, oldest first. Only rows
 * with a non-null valueNumeric are returned (ready for analyzeTimeSeries).
 */
export async function getTelemetrySeries(opts: {
  machineId: number;
  tagKey: string;
  since: Date;
}): Promise<TelemetrySeriesPoint[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      timestamp: otTelemetry.timestamp,
      valueNumeric: otTelemetry.valueNumeric,
    })
    .from(otTelemetry)
    .where(
      and(
        eq(otTelemetry.machineId, opts.machineId),
        eq(otTelemetry.tagKey, opts.tagKey),
        gte(otTelemetry.timestamp, opts.since),
        sql`${otTelemetry.valueNumeric} is not null`,
      ),
    )
    .orderBy(asc(otTelemetry.timestamp));
  return rows
    .filter((r) => r.valueNumeric != null)
    .map((r) => ({ ts: new Date(r.timestamp).getTime(), value: Number(r.valueNumeric) }));
}
