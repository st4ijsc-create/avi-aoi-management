/**
 * G1/G3 — Kết nối DUAL-DB tới TimescaleDB (chỉ cho time-series energy_readings).
 *
 * Dữ liệu nghiệp vụ chính vẫn ở Postgres 18 (DATABASE_URL). Module này là kết nối phụ,
 * BẬT khi có `TSDB_URL`. Khi không cấu hình → mọi hàm no-op / trả về null, app chạy như cũ.
 *
 * Container: docker compose up -d timescaledb (host cổng 5433).
 * Hypertable tạo qua: drizzle/timescale/0001_energy_readings_hypertable.sql
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { energyReadings, type InsertEnergyReading } from "../../drizzle/schema/g3";
import { otTelemetry, type InsertOtTelemetry } from "../../drizzle/schema/ot";

let _tsdb: ReturnType<typeof drizzle> | null = null;
let _tsClient: ReturnType<typeof postgres> | null = null;
let _initialized = false;
let _degraded = false;

const TSDB_URL = process.env.TSDB_URL || "";

/**
 * Trip the TSDB into a degraded state after a connection/auth failure so we
 * stop hammering a misconfigured server (e.g. wrong password for user "tsdb")
 * and stop spamming the log. Callers fall back to the main DB path. Logs once.
 */
/**
 * True for errors that mean the TSDB server is unusable rather than a one-off
 * query problem: auth failure (28P01), host/connection issues, pool shutdown.
 */
function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code && ["28P01", "28000", "3D000", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED"].includes(code)) {
    return true;
  }
  const msg = error instanceof Error ? error.message.toLowerCase() : "";
  return msg.includes("password authentication failed") || msg.includes("connect");
}

function degradeTsdb(reason: unknown): void {
  if (_degraded) return;
  _degraded = true;
  console.error(
    "[TSDB] Disabling TimescaleDB for this process after a connection error — " +
      "energy time-series will fall back to the main DB. Fix TSDB_URL credentials and restart. Cause:",
    reason instanceof Error ? reason.message : reason
  );
  if (_tsClient) {
    _tsClient.end({ timeout: 5 }).catch(() => {});
  }
  _tsClient = null;
  _tsdb = null;
}

/**
 * Lấy drizzle instance tới TimescaleDB. Trả về null nếu không cấu hình TSDB_URL.
 */
export function getTsdb() {
  if (_degraded) return null;
  if (_initialized) return _tsdb;
  _initialized = true;

  if (!TSDB_URL) {
    console.log("[TSDB] TimescaleDB disabled. Set TSDB_URL to enable time-series storage.");
    return null;
  }

  try {
    console.log("[TSDB] Connecting to TimescaleDB...");
    _tsClient = postgres(TSDB_URL, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 30,
      max_lifetime: 60 * 10,
    });
    _tsdb = drizzle(_tsClient);
    console.log("[TSDB] Connected successfully");
  } catch (error) {
    console.error("[TSDB] Failed to connect:", error);
    _tsdb = null;
    _tsClient = null;
  }
  return _tsdb;
}

export function isTsdbEnabled(): boolean {
  return Boolean(TSDB_URL);
}

/**
 * Ghi một số đo năng lượng vào hypertable. No-op khi TSDB chưa bật.
 */
export async function insertEnergyReading(reading: InsertEnergyReading): Promise<boolean> {
  const db = getTsdb();
  if (!db) return false;
  try {
    await db.insert(energyReadings).values(reading);
    return true;
  } catch (error) {
    console.error("[TSDB] insertEnergyReading failed:", error);
    if (isConnectionError(error)) degradeTsdb(error);
    return false;
  }
}

/**
 * Truy vấn time-bucket trung bình công suất theo khoảng (dùng TimescaleDB time_bucket).
 * Trả về [] khi TSDB chưa bật.
 */
export async function queryEnergyBuckets(params: {
  machineId?: number;
  from: Date;
  to: Date;
  bucket?: string; // ví dụ '1 hour', '15 minutes'
}): Promise<Array<{ bucket: Date; avgPowerKw: number | null; totalValue: number | null }>> {
  const db = getTsdb();
  if (!db) return [];
  const bucket = params.bucket || "1 hour";
  try {
    const machineFilter = params.machineId != null ? sql`AND "machineId" = ${params.machineId}` : sql``;
    const fromIso = params.from.toISOString();
    const toIso = params.to.toISOString();
    const rows = await db.execute(sql`
      SELECT time_bucket(${bucket}::interval, "timestamp") AS bucket,
             AVG("powerKw")::float8 AS "avgPowerKw",
             SUM(value)::float8     AS "totalValue"
      FROM energy_readings
      WHERE "timestamp" >= ${fromIso}::timestamptz AND "timestamp" < ${toIso}::timestamptz ${machineFilter}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    return (Array.isArray(rows) ? rows : (rows as any).rows || []) as Array<{
      bucket: Date;
      avgPowerKw: number | null;
      totalValue: number | null;
    }>;
  } catch (error) {
    console.error("[TSDB] queryEnergyBuckets failed:", error);
    if (isConnectionError(error)) degradeTsdb(error);
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ot_telemetry — THE canonical telemetry hypertable in the dedicated TimescaleDB.
//
// Mirrors the energy_readings pattern: primary store is the TSDB hypertable
// (drizzle/timescale/0003_ot_telemetry_hypertable.sql) when TSDB_URL is set;
// callers (telemetryBus / otTelemetry reads) fall back to the main-DB
// ot_telemetry table when these return false/null (TSDB disabled or degraded).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bulk-insert canonical telemetry rows into the TSDB hypertable. Returns the
 * number of rows persisted, or `null` when TSDB is disabled/degraded so the
 * caller knows to fall back to the main DB (vs `0` = TSDB on but empty input).
 * Never throws — connection errors trip the degrade latch.
 */
export async function insertOtTelemetryRows(rows: InsertOtTelemetry[]): Promise<number | null> {
  const db = getTsdb();
  if (!db) return null;
  if (rows.length === 0) return 0;
  try {
    await db.insert(otTelemetry).values(rows);
    return rows.length;
  } catch (error) {
    console.error("[TSDB] insertOtTelemetryRows failed:", error);
    if (isConnectionError(error)) degradeTsdb(error);
    return null;
  }
}

/** Raw latest-telemetry row from the TSDB (pre-mapping; shaped by the reader). */
export interface TsdbLatestRow {
  id: number;
  machineId: number | null;
  metric: string;
  numValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
  quality: string;
  ts: string; // ISO
  unit: string | null;
}

/**
 * Latest telemetry rows for a machine (optionally one metric), newest first.
 * Returns `null` when TSDB is disabled/degraded (caller falls back to main DB);
 * returns `[]` when TSDB is on but has no matching rows.
 *
 * NOTE: the deviceTags unit COALESCE join is intentionally NOT done here — the
 * dedicated TSDB only holds the telemetry hypertable, not the relational
 * device_tags table. We surface the row's own `unit`; the caller keeps its
 * deviceTags fallback for the main-DB path.
 */
export async function queryOtTelemetryLatest(opts: {
  machineId: number;
  metric?: string;
  limit?: number;
}): Promise<TsdbLatestRow[] | null> {
  const db = getTsdb();
  if (!db) return null;
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100);
  try {
    const metricFilter = opts.metric != null ? sql`AND "metric" = ${opts.metric}` : sql``;
    const result = await db.execute(sql`
      SELECT "id", "machineId", "metric", "numValue", "textValue", "boolValue",
             "quality", "ts", "unit"
      FROM ot_telemetry
      WHERE "machineId" = ${opts.machineId} ${metricFilter}
      ORDER BY "ts" DESC
      LIMIT ${limit}
    `);
    const rows = (Array.isArray(result) ? result : (result as any).rows || []) as Array<{
      id: number | string;
      machineId: number | null;
      metric: string;
      numValue: number | null;
      textValue: string | null;
      boolValue: boolean | null;
      quality: string | null;
      ts: Date | string;
      unit: string | null;
    }>;
    return rows.map((r) => ({
      id: Number(r.id),
      machineId: r.machineId ?? null,
      metric: r.metric,
      numValue: r.numValue == null ? null : Number(r.numValue),
      textValue: r.textValue ?? null,
      boolValue: r.boolValue ?? null,
      quality: String(r.quality ?? "good"),
      ts: r.ts ? new Date(r.ts).toISOString() : "",
      unit: r.unit ?? null,
    }));
  } catch (error) {
    console.error("[TSDB] queryOtTelemetryLatest failed:", error);
    if (isConnectionError(error)) degradeTsdb(error);
    return null;
  }
}

/**
 * Numeric telemetry series for one (machine, metric) since `since`, oldest first.
 * Only rows with a non-null numValue. Returns `null` when TSDB disabled/degraded
 * (caller falls back to main DB), `[]` when TSDB on but empty.
 */
export async function queryOtTelemetrySeries(opts: {
  machineId: number;
  metric: string;
  since: Date;
}): Promise<Array<{ ts: number; value: number }> | null> {
  const db = getTsdb();
  if (!db) return null;
  try {
    const sinceIso = opts.since.toISOString();
    const result = await db.execute(sql`
      SELECT "ts", "numValue"
      FROM ot_telemetry
      WHERE "machineId" = ${opts.machineId}
        AND "metric" = ${opts.metric}
        AND "ts" >= ${sinceIso}::timestamptz
        AND "numValue" IS NOT NULL
      ORDER BY "ts" ASC
    `);
    const rows = (Array.isArray(result) ? result : (result as any).rows || []) as Array<{
      ts: Date | string;
      numValue: number | null;
    }>;
    return rows
      .filter((r) => r.numValue != null)
      .map((r) => ({ ts: new Date(r.ts).getTime(), value: Number(r.numValue) }));
  } catch (error) {
    console.error("[TSDB] queryOtTelemetrySeries failed:", error);
    if (isConnectionError(error)) degradeTsdb(error);
    return null;
  }
}

/**
 * Đóng kết nối TimescaleDB (dùng khi shutdown).
 */
export async function shutdownTsdb(): Promise<void> {
  if (_tsClient) {
    await _tsClient.end({ timeout: 5 });
    _tsClient = null;
    _tsdb = null;
  }
  _initialized = false;
}
