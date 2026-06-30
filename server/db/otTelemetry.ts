// Sprint F6 / P2 — read-only DB access for OT telemetry (line-monitoring AI tools).
//
// Reads the CANONICAL ot_telemetry table (P2-A: ts/protocol/metric/numValue(double)/
// textValue/boolValue/unit/quality). The public row shape is kept STABLE for
// downstream consumers (handlersF6, /api/v1 telemetry): we still surface
// `tagKey` (= canonical `metric`), `valueNumeric` (= numValue), `valueText`
// (= textValue or stringified boolValue) and `timestamp` (= canonical `ts`).
// All functions are READ-ONLY. No writes.
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

/** Coerce a canonical row's typed columns into the legacy valueNumeric/valueText pair. */
function legacyText(textValue: string | null, boolValue: boolean | null): string | null {
  if (textValue != null) return textValue;
  if (boolValue != null) return boolValue ? "true" : "false";
  return null;
}

/**
 * Latest telemetry rows for a machine (optionally one metric/tag), newest first.
 * Best-effort joins deviceTags by tagKey (= metric) to surface an engineering unit
 * when the canonical row has none (canonical no longer carries adapterId, so the
 * old adapterId+tagKey join is reduced to tagKey + COALESCE on the unit column).
 */
export async function getLatestTelemetry(opts: {
  machineId: number;
  tagKey?: string;
  limit?: number;
}): Promise<TelemetryLatestRow[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(otTelemetry.machineId, opts.machineId)];
  if (opts.tagKey) conds.push(eq(otTelemetry.metric, opts.tagKey));
  const rows = await db
    .select({
      id: otTelemetry.id,
      machineId: otTelemetry.machineId,
      tagKey: otTelemetry.metric,
      numValue: otTelemetry.numValue,
      textValue: otTelemetry.textValue,
      boolValue: otTelemetry.boolValue,
      quality: otTelemetry.quality,
      timestamp: otTelemetry.ts,
      rowUnit: otTelemetry.unit,
      tagUnit: deviceTags.unit,
    })
    .from(otTelemetry)
    .leftJoin(deviceTags, eq(deviceTags.tagKey, otTelemetry.metric))
    .where(and(...conds))
    .orderBy(desc(otTelemetry.ts))
    .limit(Math.min(Math.max(opts.limit ?? 10, 1), 100));
  return rows.map((r) => ({
    id: r.id,
    machineId: r.machineId ?? null,
    tagKey: r.tagKey,
    valueNumeric: r.numValue == null ? null : Number(r.numValue),
    valueText: legacyText(r.textValue ?? null, r.boolValue ?? null),
    quality: String(r.quality ?? "good"),
    timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : "",
    unit: r.rowUnit ?? r.tagUnit ?? null,
  }));
}

export interface TelemetrySeriesPoint {
  ts: number; // epoch ms
  value: number;
}

/**
 * Numeric telemetry series for one metric/tag since `since`, oldest first. Only
 * rows with a non-null numValue are returned (ready for analyzeTimeSeries).
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
      timestamp: otTelemetry.ts,
      numValue: otTelemetry.numValue,
    })
    .from(otTelemetry)
    .where(
      and(
        eq(otTelemetry.machineId, opts.machineId),
        eq(otTelemetry.metric, opts.tagKey),
        gte(otTelemetry.ts, opts.since),
        sql`${otTelemetry.numValue} is not null`,
      ),
    )
    .orderBy(asc(otTelemetry.ts));
  return rows
    .filter((r) => r.numValue != null)
    .map((r) => ({ ts: new Date(r.timestamp).getTime(), value: Number(r.numValue) }));
}
