/**
 * doc 54 §11 P1.2 ⭐ — LIVE daily-statistics rollup writer.
 * ═══════════════════════════════════════════════════════════════════════════════
 * VẤN ĐỀ (đòn bẩy §11.2): `daily_statistics` (nguồn cho getAllOEE / OEE dashboards /
 * warRoom line-OEE) chỉ được ghi bởi `scripts/sim-factory/sim-live-daemon.mjs`.
 * `upsertDailyStatistics` (server/db/statistics.ts) có ZERO live caller, nên với MÁY
 * THẬT (ingest qua product_inspections) bảng này RỖNG → OEE/health/monitoring "rỗng".
 *
 * DỊCH VỤ NÀY BỔ SUNG: một sweep định kỳ, với MỖI máy ACTIVE có sản lượng HÔM NAY,
 * tổng hợp TUYỆT ĐỐI (absolute recompute — idempotent + tự-chữa-lành) từ
 * product_inspections và ghi vào daily_statistics qua `upsertDailyStatistics`
 * (ON CONFLICT(machineId,date)). Chạy lại bao nhiêu lần trong ngày cũng hội tụ về
 * cùng con số — KHÔNG cộng dồn (khác sim-daemon vốn cộng thêm `+ EXCLUDED`).
 *
 * ok/ng/ntf mapping (canonical, loại trừ lẫn nhau → ok+ng+ntf === total):
 *   ntf  ⇐ overallResult = 'NTF'  HOẶC  ntfConfirmedAt IS NOT NULL   (ưu tiên cao nhất)
 *   ng   ⇐ overallResult = 'NG'   VÀ    ntfConfirmedAt IS NULL
 *   ok   ⇐ overallResult = 'OK'   VÀ    ntfConfirmedAt IS NULL
 * yieldRate = FINAL yield (NTF tính là PASS) = (ok+ntf)/total*100 — quy ước
 * canonical toàn hệ thống (utils/kpi.finalYield, decision #4). Các CASE-sum trong
 * `rollupDailyStatisticsNow` PHẢN CHIẾU CHÍNH XÁC `classifyInspectionResult` bên dưới
 * (đơn vị được unit-test).
 *
 * factoryId/workshopId (2 cột NOT NULL của daily_statistics) resolve qua chuỗi
 * machine → station → production_line → workshop (workshop.factoryId). Máy KHÔNG
 * active hoặc thiếu hierarchy đầy đủ → BỎ QUA (không thể thoả 2 cột NOT NULL; không
 * bịa attribution).
 *
 * HONEST / DEGRADE RÕ RÀNG:
 *   - Chỉ ghi cho máy CÓ sản lượng hôm nay (total>0). Máy không có inspection → không
 *     ghi hàng zero (giống oeeSnapshotScheduler.skippedNoProduction — không bịa 0%).
 *   - Thiếu DB ⇒ no-op. Mỗi máy fail-safe riêng; một run KHÔNG BAO GIỜ ném.
 *   - LƯU Ý (giới hạn của sink dùng chung — KHÔNG được sửa statistics.ts ở nhiệm vụ
 *     này): `upsertDailyStatistics` ON CONFLICT chỉ cập nhật totalCount/okCount/
 *     ngCount/ntfCount/yieldRate (các số OEE/dashboard trọng yếu — TỰ CHỮA mỗi lần
 *     chạy). avgCycleTime/factoryId/workshopId chỉ set ở lần INSERT đầu trong ngày,
 *     KHÔNG refresh khi conflict — chấp nhận được (factory/workshop tĩnh theo máy;
 *     avgCycleTime hơi cũ trong-ngày).
 *
 * "Hôm nay" dùng biên UTC-floored, GIỐNG oeeSnapshotScheduler: ingest lưu
 * inspectionTime dạng "fake-UTC" (giờ tường nhà máy đọc như UTC) nên biên UTC-day
 * khớp đúng ngày-nhà-máy — cùng logic với sibling gần nhất đọc product_inspections.
 *
 * ⚠ DOUBLE-WRITE (xem .env / .env.example): sim-live-daemon cộng dồn vào cùng bảng.
 * KHÔNG bật LIVE_STATS_ROLLUP_ENABLED trên env Full-Sim (sẽ đè/đá nhau — cumulative
 * vs absolute). Ở PRODUCTION tắt sim-daemon và bật cờ này (hai nguồn LOẠI TRỪ nhau).
 *
 * CỜ (mặc định OFF — job GHI dữ liệu):
 *   LIVE_STATS_ROLLUP_ENABLED=true    bật sweep (default OFF)
 *   LIVE_STATS_ROLLUP_MS=60000        chu kỳ (default 60s, floor 15s)
 */

import { getDb } from "../db/connection";
import { sql, and, eq, inArray } from "drizzle-orm";
import { executeRows, finalYield, roundPct } from "../utils/kpi";
import { upsertDailyStatistics } from "../db/statistics";
import { machines, stations, productionLines, workshops } from "../../drizzle/schema";

// ─── Pure ok/ng/ntf mapping (unit-tested; the GROUP BY SQL below mirrors it) ────

/** Just the two product_inspections columns that decide an inspection's bucket. */
export interface InspectionResultRow {
  overallResult: string | null;
  ntfConfirmedAt: Date | string | null;
}

export type ResultBucket = "ok" | "ng" | "ntf";

/**
 * Canonical bucket for one inspection. Mutually exclusive; NTF takes precedence
 * (overallResult 'NTF' OR a confirmed-NTF timestamp), then NG, else OK. This is
 * the single definition; the CASE sums in rollupDailyStatisticsNow mirror it so
 * ok+ng+ntf always equals COUNT(*).
 */
export function classifyInspectionResult(row: InspectionResultRow): ResultBucket {
  if (row.overallResult === "NTF" || row.ntfConfirmedAt != null) return "ntf";
  if (row.overallResult === "NG") return "ng";
  return "ok";
}

export interface ResultCounts {
  total: number;
  ok: number;
  ng: number;
  ntf: number;
}

/** Pure reducer over rows → {total, ok, ng, ntf}; the JS mirror of the SQL sums. */
export function aggregateInspectionResults(rows: InspectionResultRow[]): ResultCounts {
  const c: ResultCounts = { total: 0, ok: 0, ng: 0, ntf: 0 };
  for (const r of rows) {
    c.total++;
    c[classifyInspectionResult(r)]++;
  }
  return c;
}

// ─── Flags / helpers ────────────────────────────────────────────────────────────

function rollupEnabled(): boolean {
  return process.env.LIVE_STATS_ROLLUP_ENABLED === "true";
}

/** Interval ms; default 60s, hard floor 15s, NaN-safe. */
export function rollupIntervalMs(): number {
  const n = Number(process.env.LIVE_STATS_ROLLUP_MS);
  return Number.isFinite(n) && n >= 15_000 ? n : 60_000;
}

/** UTC-floored start of the day containing `d` (mirrors oeeSnapshotScheduler). */
function floorDayUtc(d: Date): Date {
  const t = new Date(d);
  t.setUTCHours(0, 0, 0, 0);
  return t;
}

// ─── Module state ─────────────────────────────────────────────────────────────
let rollupTimer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastRunStats: LiveStatsRollupStats | null = null;

export interface LiveStatsRollupStats {
  /** ISO of the UTC day-start bucket written as daily_statistics.date. */
  day: string;
  windowStart: string;
  windowEnd: string;
  /** Machines with ≥1 inspection today (candidates). */
  machinesWithProduction: number;
  /** Rows upserted (absolute recompute). */
  upserted: number;
  /** Producing machines that are inactive or lack a full factory/workshop chain. */
  skippedNoHierarchy: number;
  errors: number;
  ms: number;
}

// ─── Core run (NOT gated by the flag — the flag only controls scheduling, so this
//     is callable on demand / in tests). Never throws. ─────────────────────────
export async function rollupDailyStatisticsNow(opts?: { now?: Date }): Promise<LiveStatsRollupStats> {
  const t0 = Date.now();
  const now = opts?.now ?? new Date();
  const dayStart = floorDayUtc(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const stats: LiveStatsRollupStats = {
    day: dayStart.toISOString(),
    windowStart: dayStart.toISOString(),
    windowEnd: dayEnd.toISOString(),
    machinesWithProduction: 0,
    upserted: 0,
    skippedNoHierarchy: 0,
    errors: 0,
    ms: 0,
  };

  try {
    const db = await getDb();
    if (!db) {
      stats.ms = Date.now() - t0;
      return stats; // DB-missing = no-op (honest).
    }

    // 1) ABSOLUTE per-machine result counts for TODAY. The CASE sums mirror
    //    classifyInspectionResult (NTF precedence) so ok+ng+ntf === total.
    const countRows = executeRows(
      await db.execute(sql`
        SELECT "machineId"                                                                          AS machine_id,
               COUNT(*)::int                                                                        AS total,
               SUM(CASE WHEN "overallResult" = 'NTF' OR "ntfConfirmedAt" IS NOT NULL THEN 1 ELSE 0 END)::int AS ntf,
               SUM(CASE WHEN "overallResult" = 'NG'  AND "ntfConfirmedAt" IS NULL     THEN 1 ELSE 0 END)::int AS ng,
               SUM(CASE WHEN "overallResult" = 'OK'  AND "ntfConfirmedAt" IS NULL     THEN 1 ELSE 0 END)::int AS ok,
               AVG(NULLIF("cycleTime", 0))::float                                                   AS avg_cycle
        FROM product_inspections
        WHERE "machineId" IS NOT NULL
          AND "inspectionTime" >= ${dayStart.toISOString()}
          AND "inspectionTime" <  ${dayEnd.toISOString()}
        GROUP BY "machineId"
      `),
    ) as Array<{ machine_id: number; total: number; ok: number; ng: number; ntf: number; avg_cycle: number | null }>;

    if (countRows.length === 0) {
      stats.ms = Date.now() - t0;
      lastRunAt = new Date().toISOString();
      lastRunStats = stats;
      return stats;
    }

    // 2) Resolve factoryId/workshopId for exactly those machines that are ACTIVE
    //    and have a full machine→station→line→workshop chain.
    const machineIds = countRows.map((r) => Number(r.machine_id)).filter((n) => Number.isFinite(n));
    const hierRows = await db
      .select({
        machineId: machines.id,
        factoryId: workshops.factoryId,
        workshopId: workshops.id,
      })
      .from(machines)
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
      .where(and(inArray(machines.id, machineIds), eq(machines.isActive, true)));

    const hier = new Map<number, { factoryId: number; workshopId: number }>();
    for (const r of hierRows) {
      hier.set(Number(r.machineId), { factoryId: Number(r.factoryId), workshopId: Number(r.workshopId) });
    }

    // 3) Absolute upsert per machine (self-healing / idempotent). Fail-safe each.
    for (const r of countRows) {
      const machineId = Number(r.machine_id);
      stats.machinesWithProduction++;
      const h = hier.get(machineId);
      if (!h || !Number.isFinite(h.factoryId) || !Number.isFinite(h.workshopId)) {
        // Inactive machine or broken hierarchy → cannot satisfy NOT NULL columns.
        stats.skippedNoHierarchy++;
        continue;
      }

      const total = Number(r.total) || 0;
      const ok = Number(r.ok) || 0;
      const ng = Number(r.ng) || 0;
      const ntf = Number(r.ntf) || 0;
      const avgCycle = r.avg_cycle != null ? Number(r.avg_cycle) : null;

      try {
        await upsertDailyStatistics({
          machineId,
          factoryId: h.factoryId,
          workshopId: h.workshopId,
          date: dayStart,
          totalCount: total,
          okCount: ok,
          ngCount: ng,
          ntfCount: ntf,
          // Canonical FINAL yield (NTF counts as pass) — decimal(5,2) → string.
          yieldRate: String(roundPct(finalYield({ ok, ntf, total }), 2)),
          // decimal(10,2) → string | null. NB: upsertDailyStatistics only refreshes
          // avgCycleTime on the day's first INSERT (documented sink limitation).
          avgCycleTime: avgCycle != null ? String(roundPct(avgCycle, 2)) : null,
        });
        stats.upserted++;
      } catch (e) {
        stats.errors++;
        console.error(
          `[liveStatsRollup] machine ${machineId} upsert failed:`,
          (e as any)?.message || e,
        );
      }
    }
  } catch (e) {
    // Top-level guard: a run must never throw.
    console.error("[liveStatsRollup] run error:", (e as any)?.message || e);
  }

  stats.ms = Date.now() - t0;
  lastRunAt = new Date().toISOString();
  lastRunStats = stats;
  return stats;
}

// ─── Scheduler lifecycle (mirrors machinePresenceService: gated, unref'd,
//     non-overlapping, idempotent) ────────────────────────────────────────────

/** Start the periodic rollup. Idempotent + self-gates LIVE_STATS_ROLLUP_ENABLED. */
export function startLiveStatsRollup(): void {
  if (!rollupEnabled()) {
    console.log(
      "[liveStatsRollup] disabled (set LIVE_STATS_ROLLUP_ENABLED=true to enable — WRITES daily_statistics)",
    );
    return;
  }
  if (rollupTimer) {
    console.log("[liveStatsRollup] already running");
    return;
  }
  const intervalMs = rollupIntervalMs();
  console.log(`[liveStatsRollup] starting (interval=${Math.round(intervalMs / 1000)}s)`);

  const run = async () => {
    if (running) return; // no overlap
    running = true;
    try {
      const r = await rollupDailyStatisticsNow();
      if (r.upserted > 0 || r.errors > 0 || r.skippedNoHierarchy > 0) {
        console.log(
          `[liveStatsRollup] ${r.upserted}/${r.machinesWithProduction} machine(s) rolled up ` +
            `(noHier=${r.skippedNoHierarchy} err=${r.errors}) in ${r.ms}ms`,
        );
      }
    } catch (e) {
      console.error("[liveStatsRollup] run failed:", (e as any)?.message || e);
    } finally {
      running = false;
    }
  };

  // Run once immediately, then on the interval.
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  rollupTimer = timer;
}

/** Stop the rollup. Idempotent no-op when never started. */
export function stopLiveStatsRollup(): void {
  if (rollupTimer) {
    clearInterval(rollupTimer);
    rollupTimer = null;
    console.log("[liveStatsRollup] stopped");
  }
}

/** Current config/status (for health / diagnostics). */
export function getLiveStatsRollupConfig() {
  return {
    enabled: rollupEnabled(),
    running: rollupTimer !== null,
    intervalSeconds: Math.round(rollupIntervalMs() / 1000),
    lastRunAt,
    lastRunStats,
  };
}
