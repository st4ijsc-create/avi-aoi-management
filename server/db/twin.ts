// Sprint G2.7 — read-only DB access for Digital Twin WIP flow + prediction.
//
// SAFETY: every function is READ-ONLY (SELECT only). NO INSERT/UPDATE/DELETE on
// wipTracking / stationDwellTime / machines. Auto-degrades to [] when the DB is
// not available (getDb() returns null). Re-uses getStationDwellAgg /
// getLatestLineBalance from ./lineBalance for the heatmap path.
import { getDb } from "./connection";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { wipTracking } from "../../drizzle/schema";

export interface WipByStationRow {
  currentStationId: number;
  count: number;
  serials: string[];
}

/**
 * WIP đang trong chuyền theo station (exitedAt IS NULL). Lọc theo lineId nếu có.
 * layoutId được nhận để API thống nhất nhưng wipTracking không có cột layout →
 * lọc theo lineId là chính; layoutId dùng ở tầng router để join vị trí.
 * Read-only. Trả [] khi !db.
 */
export async function getWipByStation(opts?: { lineId?: number }): Promise<WipByStationRow[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [isNull(wipTracking.exitedAt)];
  if (opts?.lineId != null) conds.push(eq(wipTracking.lineId, opts.lineId));
  const rows = await db
    .select({
      currentStationId: wipTracking.currentStationId,
      count: sql<number>`count(*)::int`,
      serials: sql<string[]>`coalesce(array_agg(${wipTracking.serialNumber}) FILTER (WHERE ${wipTracking.serialNumber} IS NOT NULL), '{}')`,
    })
    .from(wipTracking)
    .where(and(...conds, sql`${wipTracking.currentStationId} IS NOT NULL`))
    .groupBy(wipTracking.currentStationId);
  return rows
    .filter((r) => r.currentStationId != null)
    .map((r) => ({
      currentStationId: Number(r.currentStationId),
      count: Number(r.count ?? 0),
      serials: Array.isArray(r.serials) ? r.serials.filter((s): s is string => !!s) : [],
    }));
}

export interface WipCountBucket {
  bucketStart: string; // ISO
  wipCount: number;
}

/**
 * Chuỗi WIP count theo bucket thời gian cho 1 line (số đơn vị enteredAt trong
 * bucket, chưa exit hoặc exit sau bucket). Dùng làm time-series đầu vào forecast.
 * Read-only. Trả [] khi !db.
 */
export async function getWipCountSeries(
  lineId: number,
  since: Date,
  bucketMin: number,
): Promise<WipCountBucket[]> {
  const db = await getDb();
  if (!db) return [];
  const bucket = Math.max(1, Math.floor(bucketMin));
  const intervalSql = sql.raw(`'${bucket} minutes'`);
  // date_bin origin MUST be a constant inlined identically in SELECT/GROUP BY/ORDER BY.
  // A bind param (the old `${since}` origin) is emitted as a DIFFERENT placeholder per clause
  // ($1 in SELECT vs $4 in GROUP BY), so Postgres sees two distinct expressions and rejects the
  // query: `column "wip_tracking.enteredAt" must appear in the GROUP BY clause` (SQLSTATE 42803).
  // A fixed epoch origin keeps the bucket expression byte-identical everywhere; the query window
  // is still bounded by `enteredAt >= since` below, and bucket phase is irrelevant to a forecast
  // that only needs an ordered, evenly-spaced series.
  const originSql = sql.raw(`timestamp '1970-01-01 00:00:00'`);
  const bucketExpr = sql`date_bin(${intervalSql}, ${wipTracking.enteredAt}, ${originSql})`;
  const rows = await db
    .select({
      bucketStart: sql<string>`${bucketExpr}`,
      wipCount: sql<number>`count(*)::int`,
    })
    .from(wipTracking)
    .where(and(eq(wipTracking.lineId, lineId), gte(wipTracking.enteredAt, since)))
    .groupBy(bucketExpr)
    .orderBy(asc(bucketExpr));
  return rows.map((r) => ({
    bucketStart: r.bucketStart ? new Date(r.bucketStart).toISOString() : "",
    wipCount: Number(r.wipCount ?? 0),
  }));
}
