/**
 * Cached Statistics Functions
 *
 * Wrapper functions that add caching to statistics queries.
 *
 * W4-B (doc 27 gap B8): now routed through the consolidated cacheService
 * FACADE (L1 in-process LRU + Redis L2 when REDIS_URL is set) instead of
 * talking to redisService directly. This closes the audit finding that
 * `invalidateStatistics` only cleared the Redis tier while the in-memory
 * tier kept serving stale dashboard numbers: invalidation now clears BOTH
 * tiers and broadcasts to other instances. Cache TTL: 5 minutes.
 *
 * W4-B (doc 27 gap A7): also hosts the `hourly_yield_cache` materialized-view
 * read path (getHourlyYieldFromMV / getHourlyStatsViaMV) — MV data is served
 * ONLY while fresh (last successful refresh < 2× MATVIEW_REFRESH_INTERVAL_MS
 * ago); stale or absent → callers fall back to the live query. Never
 * silently stale.
 */

import { sql, type SQL } from "drizzle-orm";
import { cacheService } from "../services/cacheService";
import { redisService } from "../services/redisService";
import {
  getMatviewRefreshInfo,
  getMatviewRefreshIntervalMs,
  MATVIEW_STATUS_FEATURE,
} from "../services/materializedViewRefreshService";
import { getDb } from "../db/connection";
import { productInspections } from "../../drizzle/schema";
import {
  executeRows,
  factoryHourTextSql,
  finalYield,
  fpyAggregateSql,
  fpyFromFirstInspections,
} from "../utils/kpi";
import * as db from "../db";

const CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Get yield rate by corporate with caching
 */
export async function getCachedYieldRateByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const cacheKey = cacheService.generateKey('yield:corporate', {
    startDate: filters.startDate,
    endDate: filters.endDate,
    userId: filters.userId,
    userRole: filters.userRole,
  });

  return cacheService.getOrFetchAsync(
    cacheKey,
    () => db.getYieldRateByCorporate(filters),
    CACHE_TTL_MS
  );
}

/**
 * Get yield rate by factory with caching
 */
export async function getCachedYieldRateByFactory(filters: {
  corporateCode?: string;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const cacheKey = cacheService.generateKey('yield:factory', {
    corporateCode: filters.corporateCode,
    startDate: filters.startDate,
    endDate: filters.endDate,
    userId: filters.userId,
    userRole: filters.userRole,
  });

  return cacheService.getOrFetchAsync(
    cacheKey,
    () => db.getYieldRateByFactory(filters),
    CACHE_TTL_MS
  );
}

/**
 * Get throughput by corporate with caching
 */
export async function getCachedThroughputByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  interval?: 'hour' | 'day' | 'week';
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const cacheKey = cacheService.generateKey('throughput:corporate', {
    startDate: filters.startDate,
    endDate: filters.endDate,
    interval: filters.interval,
    userId: filters.userId,
    userRole: filters.userRole,
  });

  return cacheService.getOrFetchAsync(
    cacheKey,
    () => db.getThroughputByCorporate(filters),
    CACHE_TTL_MS
  );
}

/**
 * Get throughput by factory with caching
 */
export async function getCachedThroughputByFactory(filters: {
  corporateCode?: string;
  startDate?: Date;
  endDate?: Date;
  interval?: 'hour' | 'day' | 'week';
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const cacheKey = cacheService.generateKey('throughput:factory', {
    corporateCode: filters.corporateCode,
    startDate: filters.startDate,
    endDate: filters.endDate,
    interval: filters.interval,
    userId: filters.userId,
    userRole: filters.userRole,
  });

  return cacheService.getOrFetchAsync(
    cacheKey,
    () => db.getThroughputByFactory(filters),
    CACHE_TTL_MS
  );
}

interface MachineStats {
  total: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  yieldRate: string;
  trend: Array<{
    date: string;
    total: number;
    ok: number;
    ng: number;
    ntf: number;
    yieldRate: string;
  }>;
  recentInspections: Array<{
    id: number;
    serialNumber: string;
    overallResult: string;
    inspectionTime: Date;
  }>;
}

/**
 * Get machine statistics with caching
 */
export async function getCachedMachineStats(filters: {
  machineId: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<MachineStats> {
  const cacheKey = cacheService.generateKey('stats:machine', {
    machineId: filters.machineId,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });

  return cacheService.getOrFetchAsync(
    cacheKey,
    async (): Promise<MachineStats> => {
      // Get machine inspections and calculate stats
      const result = await db.getProductInspections({
        machineId: filters.machineId,
        startDate: filters.startDate,
        endDate: filters.endDate,
        limit: 1000,
      });

      const inspections = result.data;
      const total = inspections.length;
      const okCount = inspections.filter(i => i.overallResult === 'OK').length;
      const ngCount = inspections.filter(i => i.overallResult === 'NG').length;
      const ntfCount = inspections.filter(i => i.overallResult === 'NTF').length;
      const yieldRate = total > 0 ? ((okCount / total) * 100).toFixed(2) : '0.00';

      // Group by date for trend
      const byDate = inspections.reduce((acc, insp) => {
        const date = new Date(insp.inspectionTime).toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = { total: 0, ok: 0, ng: 0, ntf: 0 };
        }
        acc[date].total++;
        if (insp.overallResult === 'OK') acc[date].ok++;
        if (insp.overallResult === 'NG') acc[date].ng++;
        if (insp.overallResult === 'NTF') acc[date].ntf++;
        return acc;
      }, {} as Record<string, { total: number; ok: number; ng: number; ntf: number }>);

      const trend = Object.entries(byDate)
        .map(([date, stats]) => ({
          date,
          total: stats.total,
          ok: stats.ok,
          ng: stats.ng,
          ntf: stats.ntf,
          yieldRate: stats.total > 0 ? ((stats.ok / stats.total) * 100).toFixed(2) : '0.00',
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        total,
        okCount,
        ngCount,
        ntfCount,
        yieldRate,
        trend,
        recentInspections: inspections.slice(0, 20).map(i => ({
          id: i.id,
          serialNumber: i.serialNumber,
          overallResult: i.overallResult,
          inspectionTime: i.inspectionTime,
        })),
      };
    },
    CACHE_TTL_MS
  );
}

/**
 * Invalidate all statistics caches
 * Should be called when new inspection data is submitted.
 * B8 fix: clears BOTH tiers (in-process L1 + Redis L2) and broadcasts the
 * invalidation to other instances — previously only the Redis tier was hit.
 */
export async function invalidateStatisticsCache(): Promise<void> {
  await cacheService.invalidateStatistics();
}

/**
 * Get cache statistics for monitoring (L2/Redis shape kept for backward
 * compatibility, L1 facade counters added under `l1`).
 */
export async function getCacheStats() {
  const l2 = await redisService.getStats();
  return { ...l2, l1: cacheService.getStats() };
}

/**
 * Get cache health check
 */
export async function getCacheHealth() {
  return redisService.healthCheck();
}

// ═══════════════════════════════════════════════════════════════════════
// A7 — hourly_yield_cache materialized-view read path
// ═══════════════════════════════════════════════════════════════════════

export interface MvFreshness {
  lastRefreshMs: number;
  ageMs: number;
  thresholdMs: number;
}

export interface MvHourlyRow {
  hour: string; // 'YYYY-MM-DD HH24:00' in the FACTORY timezone (same wire format as the live path)
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  yieldRate: number; // canonical final yield %, NTF counts as pass (0174)
}

// Cross-process freshness lookups hit db_feature_status; memoize briefly so
// dashboard polling doesn't turn the freshness check itself into DB load.
let lastRefreshMemo: { value: number | null; fetchedAt: number } | null = null;
const FRESHNESS_MEMO_MS = 10_000;

async function resolveMvLastRefreshMs(): Promise<number | null> {
  // Same-process scheduler (the normal single-process deployment).
  const info = getMatviewRefreshInfo();
  if (info.lastRefreshAt) return info.lastRefreshAt.getTime();

  // Cross-process: the refresh service records epoch ms (TZ-proof) in
  // db_feature_status.detail after every successful refresh.
  if (lastRefreshMemo && Date.now() - lastRefreshMemo.fetchedAt < FRESHNESS_MEMO_MS) {
    return lastRefreshMemo.value;
  }
  let value: number | null = null;
  try {
    const dbc = await getDb();
    if (dbc) {
      const res = await dbc.execute(sql`
        SELECT "detail" FROM db_feature_status
        WHERE "feature" = ${MATVIEW_STATUS_FEATURE} AND "status" = 'ok'
        LIMIT 1
      `);
      const rows = executeRows(res);
      if (rows.length > 0) {
        const parsed = JSON.parse(String((rows[0] as any).detail ?? "null"));
        if (typeof parsed?.lastRefreshMs === "number") value = parsed.lastRefreshMs;
      }
    }
  } catch {
    value = null; // table absent / parse error → treat as unknown = stale
  }
  lastRefreshMemo = { value, fetchedAt: Date.now() };
  return value;
}

/** Test helper: drop the freshness memo. */
export function __resetMvFreshnessMemo(): void {
  lastRefreshMemo = null;
}

/**
 * Freshness gate: the MV counts as fresh only when the last SUCCESSFUL
 * refresh is younger than 2× the refresh interval. Returns the freshness
 * metadata when fresh, null when stale/unknown.
 */
export async function getMvFreshness(): Promise<MvFreshness | null> {
  const lastRefreshMs = await resolveMvLastRefreshMs();
  if (lastRefreshMs == null) return null;
  const thresholdMs = 2 * getMatviewRefreshIntervalMs();
  const ageMs = Date.now() - lastRefreshMs;
  if (ageMs > thresholdMs || ageMs < 0) return null;
  return { lastRefreshMs, ageMs, thresholdMs };
}

/**
 * Read the per-hour yield rollup from the `hourly_yield_cache` MV
 * (canonical final-yield + factory-TZ buckets since 0174), WITH freshness
 * metadata. Returns null when the MV is stale/absent — the caller MUST then
 * use its live query. Filters: optional machineId; window = last `hours`
 * hours (default 24).
 */
export async function getHourlyYieldFromMV(filters: {
  machineId?: number;
  hours?: number;
} = {}): Promise<{ rows: MvHourlyRow[]; freshness: MvFreshness } | null> {
  const freshness = await getMvFreshness();
  if (!freshness) return null;

  const dbc = await getDb();
  if (!dbc) return null;

  const hoursBack = filters.hours || 24;
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - hoursBack);

  // bucket_hour holds factory-LOCAL wall time (0174). The JS Date param is a
  // UTC instant; to_factory_time() converts it under the same storage-TZ
  // assumption (app.factory_storage_tz GUC) the MV itself was built with, so
  // both sides of the comparison live in the same clock.
  const conditions: SQL[] = [
    sql`bucket_hour >= public.to_factory_time(CAST(${startDate.toISOString()} AS timestamp))`,
  ];
  if (filters.machineId) {
    conditions.push(sql`machine_id = ${filters.machineId}`);
  }
  const where = sql.join(conditions, sql` AND `);

  try {
    const res = await dbc.execute(sql`
      SELECT
        TO_CHAR(bucket_hour, 'YYYY-MM-DD HH24:00') AS hour,
        SUM(total)::int AS total,
        SUM(ok)::int    AS ok,
        SUM(ng)::int    AS ng,
        SUM(ntf)::int   AS ntf
      FROM hourly_yield_cache
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    const rows = executeRows(res).map((r: any): MvHourlyRow => {
      const total = Number(r.total) || 0;
      const ok = Number(r.ok) || 0;
      const ntf = Number(r.ntf) || 0;
      return {
        hour: String(r.hour),
        total,
        ok,
        ng: Number(r.ng) || 0,
        ntf,
        yieldRate: finalYield({ ok, ntf, total }),
      };
    });
    return { rows, freshness };
  } catch (err: any) {
    // MV or to_factory_time missing (0111/0174 not applied) → live fallback.
    console.warn("[MV] hourly_yield_cache read failed — falling back to live query:", err?.message ?? err);
    return null;
  }
}

/**
 * Drop-in MV-backed variant of db.getHourlyStats (same wire shape:
 * [{hour,total,ok,ng,ntf,fpy,fy,ntfy}], strings for the rates).
 *
 * Returns null (→ caller uses the live query) when:
 *  - the MV is not fresh (see getMvFreshness), or
 *  - the filter set is not MV-representable: the MV is keyed by machine
 *    only, so factoryId/workshopId/lineId requests take the live path, or
 *  - the MV/query errors (migration not applied).
 *
 * NOTE: true FPY (first inspection per serial) cannot be derived from the
 * per-hour rollup, so this path still runs ONE live fpyAggregateSql query
 * over product_inspections — it replaces the raw-table counts scan only
 * (the larger of the two live scans).
 */
export async function getHourlyStatsViaMV(filters?: {
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  machineId?: number;
  hours?: number;
}): Promise<Array<{
  hour: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  fpy: string;
  fy: string;
  ntfy: string;
}> | null> {
  // Hierarchy filters are not representable on the machine-keyed MV.
  if (filters?.factoryId || filters?.workshopId || filters?.lineId) return null;

  const mv = await getHourlyYieldFromMV({
    machineId: filters?.machineId,
    hours: filters?.hours,
  });
  if (!mv) return null;

  const dbc = await getDb();
  if (!dbc) return null;

  const hoursBack = filters?.hours || 24;
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - hoursBack);

  // Live FPY per hour (same fragment + bucket text format the live
  // db.getHourlyStats uses, so MV counts and FPY join on identical keys).
  const conditions: SQL[] = [
    sql`${productInspections.inspectionTime} >= ${startDate.toISOString()}`,
  ];
  if (filters?.machineId) {
    conditions.push(sql`${productInspections.machineId} = ${filters.machineId}`);
  }
  const whereClause = sql.join(conditions, sql` AND `);
  const hourBucket = factoryHourTextSql(productInspections.inspectionTime);

  let fpyByHour: Map<string, { firstPass: number; firstTotal: number }>;
  try {
    const fpyResult = await dbc.execute(
      fpyAggregateSql({ where: whereClause, bucketExpr: hourBucket, groupBy: "bucket" }),
    );
    fpyByHour = new Map(
      executeRows(fpyResult).map((r: any) => [String(r.bucket), {
        firstPass: Number(r.first_pass) || 0,
        firstTotal: Number(r.first_total) || 0,
      }]),
    );
  } catch (err: any) {
    console.warn("[MV] hourly FPY query failed — falling back to live query:", err?.message ?? err);
    return null;
  }

  return mv.rows.map((r) => {
    const total = r.total || 1; // same guard as the live path
    const firsts = fpyByHour.get(r.hour) || { firstPass: 0, firstTotal: 0 };
    return {
      hour: r.hour,
      total,
      ok: r.ok,
      ng: r.ng,
      ntf: r.ntf,
      fpy: fpyFromFirstInspections(firsts).toFixed(1),
      fy: finalYield({ ok: r.ok, ntf: r.ntf, total }).toFixed(1),
      ntfy: ((r.ntf / total) * 100).toFixed(1),
    };
  });
}
