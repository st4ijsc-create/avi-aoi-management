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

let _tsdb: ReturnType<typeof drizzle> | null = null;
let _tsClient: ReturnType<typeof postgres> | null = null;
let _initialized = false;

const TSDB_URL = process.env.TSDB_URL || "";

/**
 * Lấy drizzle instance tới TimescaleDB. Trả về null nếu không cấu hình TSDB_URL.
 */
export function getTsdb() {
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
    return [];
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
