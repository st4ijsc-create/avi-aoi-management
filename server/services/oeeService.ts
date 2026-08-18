/**
 * OEE Service — SEMI E10 compliant calculator
 *
 * Computes Overall Equipment Effectiveness from `downtime_events` and
 * `oee_metrics` over a time window, classifying every minute into one of
 * SEMI E10 six equipment states:
 *
 *   1. Productive Time              (PT)  — making good product
 *   2. Standby Time                 (SB)  — capable, no demand
 *   3. Engineering Time             (ET)  — qualification / experiments
 *   4. Scheduled Downtime           (SD)  — planned maintenance, setup
 *   5. Unscheduled Downtime         (UD)  — failures, repairs
 *   6. Non-Scheduled Time           (NS)  — shift off, holiday
 *
 * SEMI E10 / SEMI E79 OEE definitions:
 *   Availability  = (Operations Time) / (Equipment Uptime)
 *                 = (PT + ET) / (PT + SB + ET + UD)
 *   Performance   = (Theoretical Production Time for Actual Units)
 *                  / (PT)
 *                 = (idealCycleTime × goodCount + idealCycleTime × rejectCount)
 *                  / (PT × 60)
 *   Quality       = goodCount / totalCount
 *   OEE           = Availability × Performance × Quality
 *
 * Standards: SEMI E10-0701, SEMI E79-0200, ISO 22400-2 (KPI for MOM).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CANONICAL SOURCE OF TRUTH
 * ─────────────────────────────────────────────────────────────────────────
 * This module is the ONE place OEE is defined. Every consumer (mqttOeeRouters
 * `getAllOEE`/`getMachineOEE`/`calculateOEE`, dashboards, reports) must delegate
 * here rather than re-deriving A/P/Q with its own formula.
 *
 * `getMachineOEELive` / `getAllMachinesOEELive` compute OEE on read from REAL
 * sources — no in-memory cache, no synthetic multipliers, no random fallback:
 *
 *   Availability  = online time / (online + offline)            ← machine_status_logs
 *                   (getMachineUptimeStats — the unified status/uptime path)
 *   Performance   = (idealCycleTime × totalCount) / runTimeSec  ← daily_statistics
 *                   runTimeSec = online seconds from the same uptime source.
 *                   idealCycleTime resolved from the active oee_target's
 *                   implied ideal (targetPerformance vs avgCycleTime) or, when
 *                   no ideal is configured, Performance is NULL (honest N/A).
 *   Quality       = (okCount + ntfCount) / totalCount           ← daily_statistics
 *                   NTF = "no-trouble-found" (confirmed good); this is the same
 *                   yield convention used everywhere else (server/db/statistics).
 *   OEE           = Availability × Performance × Quality
 *
 * When a factor's inputs are absent we return `null` for that factor (and for
 * OEE), NEVER a fabricated number. Callers/UI render null as "N/A".
 */

import { getDb } from "../db/connection";
import { and, eq, gte, lte, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { executeRows } from "../utils/kpi";
import { publishToOutbox } from "./integration/outboxProducers"; // K0+-c: ADDITIVE ERP outbox (ERP_OUTBOX_ENABLED)
import {
  downtimeEvents,
  oeeMetrics,
  oeeTargets,
  dailyStatistics,
  machines,
  type InsertOEEMetric,
} from "../../drizzle/schema";
import { getMachineUptimeStats } from "../db/machine";
import {
  resolveTenantFactoryScope,
  factoryIdGate,
  type TenantFactoryScope,
} from "../db/reportAggregators";
import { UNSCOPED_LABELS, withScopeLabels, type ScopedRows } from "../_core/accessControlLabels";
import type { TenantCodeScope } from "../_core/tenantCodeScope";

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-18 — NHÓM B #2. TRỤC PHẠM VI CỦA BA BỀ MẶT OEE.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// **Lỗ đã đo.** `getAllMachinesOEELive` / `getLineOEE` / `getLineTaktUtilization` đọc thẳng
// `FROM daily_statistics` KHÔNG có một mệnh đề tenant nào, rồi được phơi ra qua
// `mqttClient.getAllOEE` (OEE Dashboard, MachineHealthMonitoring, CorporateDashboard,
// ControlTower), `warRoom.briefing` và `productionDashboard.getLineBalance`. Mọi tài khoản đã
// đăng nhập đọc được sản lượng/OEE của MỌI nhà máy.
//
// **Cách vá.** `daily_statistics` ĐÃ CÓ `factoryId` NOT NULL + chỉ mục `idx_stats_factory_date`
// ⇒ KHÔNG cần DDL, KHÔNG cần bán-nối qua `product_inspections`. Phân giải tập `factories.id`
// được phép MỘT LẦN (`resolveTenantFactoryScope` — bộ phân giải DÙNG CHUNG ở
// `db/reportAggregators.ts`) rồi gắn vị từ `IN (…)` vào:
//   • danh sách máy   — qua `machines → stations → production_lines → workshops."factoryId"`
//                       (bước này CHỈ để biết máy thuộc nhà máy nào, KHÔNG suy lại quyền);
//   • `daily_statistics."factoryId"` — thẳng, dùng chỉ mục.
//
// ⚠ Vì sao PHẢI chặn cả danh sách máy, không chỉ `daily_statistics`: availability đến từ
// `machine_status_logs`, nên nếu chỉ chặn sản lượng thì máy nhà máy khác vẫn hiện với
// availability/uptime thật — rò một nửa vẫn là rò.
//
// ⚠ `userId`/`userRole` LUÔN đến từ `ctx.user` (máy chủ tự xác thực). **CẤM lấy từ `input`** —
// một `input.userId` là lời tự khai của người gọi. Bỏ trống = KHÔNG lọc: đúng hình dạng của lối
// đi không mang danh tính (UNS publisher, metricRegistry, commandCenter, REST máy-với-máy) và là
// chiều DƯƠNG chống vá quá tay.

/**
 * Phạm vi của NGƯỜI XEM — xem khối chú thích ngay trên.
 *
 * ★★★ 2026-08-18 — HAI TRỤC, loại trừ nhau ở mức KIỂU:
 *   ① `userId`/`userRole` — người dùng thật (`ctx.user`).
 *   ② `tenantScope`       — mã tenant TƯỜNG MINH của một khoá API (mig 0325). Cần vì một khoá
 *      KHÔNG phải người dùng CSDL: lối đi REST `/api/v1/ecosystem/kpi` trước đây gọi
 *      `buildKpiSummary` bằng một principal tổng hợp `{id: 0, role: "api"}`, nên ô OEE của dải
 *      KPI đọc số của MỌI nhà máy dù khoá chỉ được cấp một nhà máy.
 * Bỏ trống CẢ HAI = KHÔNG lọc (UNS publisher, metricRegistry, broadcaster nội bộ).
 */
export type OeeViewerScope =
  | { userId?: number; userRole?: string; tenantScope?: never }
  | { tenantScope: TenantCodeScope; userId?: never; userRole?: never };

/**
 * Mảnh ` AND <col> IN (…)` để NHÚNG vào một truy vấn thô. `factoryIds === null` (vai toàn quyền)
 * ⇒ mảnh RỖNG: truy vấn giữ nguyên TỪNG BYTE, không có "cổng luôn đúng" nào chạy thêm.
 *
 * @param col biểu thức cột nhà máy của truy vấn đích, ví dụ sql`w."factoryId"` hoặc sql`"factoryId"`
 */
function factoryGateFragment(scope: TenantFactoryScope, col: SQL): SQL {
  if (scope.factoryIds === null) return sql``;
  return sql` AND ${factoryIdGate(col, scope.factoryIds)}`;
}

// SEMI E10 category → equipment state mapping. The `category` enum used by
// downtime_events is application-specific (`unplanned`, `planned`, …); we
// normalize it into the canonical six states here.
const SEMI_E10_MAP: Record<string, "SD" | "UD" | "ET" | "NS" | "SB"> = {
  planned: "SD",
  scheduled: "SD",
  maintenance: "SD",
  setup: "SD",
  changeover: "SD",
  unplanned: "UD",
  failure: "UD",
  breakdown: "UD",
  fault: "UD",
  engineering: "ET",
  qualification: "ET",
  test: "ET",
  non_scheduled: "NS",
  holiday: "NS",
  standby: "SB",
  idle: "SB",
};

export interface StateDurations {
  PT: number; // Productive (minutes)
  SB: number; // Standby
  ET: number; // Engineering
  SD: number; // Scheduled downtime
  UD: number; // Unscheduled downtime
  NS: number; // Non-scheduled
  totalWindow: number; // Total minutes in window
  equipmentUptime: number; // PT + SB + ET + UD
  operationsTime: number;  // PT + ET
}

/**
 * doc 54 P2.2 (OEE-trust §3 — reconcile the two OEE notions) — which availability
 * DEFINITION backs a given number. The codebase deliberately carries TWO:
 *
 *   "semi_e10" — SEMI E10 / ISO 22400 six-state availability
 *                = operationsTime / equipmentUptime = (PT+ET)/(PT+SB+ET+UD),
 *                derived from downtime_events classified into equipment states.
 *                This is the TRUE OEE availability (computeOEE / semiE10Breakdown /
 *                the oee_metrics snapshots). Feeds "true OEE = A×P×Q".
 *
 *   "uptime"   — simple uptime% = onlineTime / (onlineTime + offlineTime) from
 *                machine_status_logs (getMachineUptimeStats). This is the LIVE
 *                read-path availability (getMachineOEELive / getAllMachinesOEELive /
 *                getLineOEE) — a coarse connectivity-based proxy, NOT the six-state
 *                availability. It is labelled distinctly so the UI/API never conflates
 *                "uptime %" with SEMI-E10 "Availability".
 *
 * The two are NOT silently merged: every OEE-bearing shape carries `availabilityBasis`
 * so a consumer can tell exactly which definition produced `availability`/`oee`.
 */
export type AvailabilityBasis = "semi_e10" | "uptime";

export interface OEEBreakdown {
  machineId: number;
  windowStart: Date;
  windowEnd: Date;
  states: StateDurations;
  availability: number;   // 0..1
  performance: number;    // 0..1
  quality: number;        // 0..1
  oee: number;            // 0..1
  totalCount: number;
  goodCount: number;
  rejectCount: number;
  idealCycleTimeSec: number;
  /** SEMI-E10 six-state availability backs this breakdown (see AvailabilityBasis). */
  availabilityBasis: AvailabilityBasis;
}

function classify(category: string | null | undefined): "SD" | "UD" | "ET" | "NS" | "SB" {
  if (!category) return "UD";
  return SEMI_E10_MAP[category.toLowerCase()] ?? "UD";
}

function clipToWindow(start: Date, end: Date, winStart: Date, winEnd: Date): number {
  const s = Math.max(start.getTime(), winStart.getTime());
  const e = Math.min(end.getTime(), winEnd.getTime());
  return Math.max(0, Math.round((e - s) / 60000));
}

/**
 * Compute SEMI E10 state durations for a machine over [from, to].
 * Any time not covered by a downtime event is treated as productive.
 */
export async function computeStateDurations(params: {
  machineId: number;
  from: Date;
  to: Date;
}): Promise<StateDurations> {
  const { machineId, from, to } = params;
  const db = await getDb();
  if (!db) {
    return {
      PT: 0, SB: 0, ET: 0, SD: 0, UD: 0, NS: 0,
      totalWindow: 0, equipmentUptime: 0, operationsTime: 0,
    };
  }

  const events = await db.select({
    category: downtimeEvents.category,
    startTime: downtimeEvents.startTime,
    endTime: downtimeEvents.endTime,
  })
    .from(downtimeEvents)
    .where(and(
      eq(downtimeEvents.machineId, machineId),
      lte(downtimeEvents.startTime, to),
      // MON-F7 (doc 40) — lower time bound so we never scan the machine's ENTIRE
      // downtime history: keep only events that can still overlap [from, to] —
      // ongoing (endTime IS NULL) or ended at/after `from`. The JS loop below
      // already drops `end <= from`; this just moves that filter into SQL.
      or(isNull(downtimeEvents.endTime), gte(downtimeEvents.endTime, from)),
    ));

  const states: Omit<StateDurations, "totalWindow" | "equipmentUptime" | "operationsTime"> = {
    PT: 0, SB: 0, ET: 0, SD: 0, UD: 0, NS: 0,
  };

  let nonProductiveMinutes = 0;
  for (const ev of events) {
    const end = ev.endTime ? new Date(ev.endTime) : to;
    const start = new Date(ev.startTime);
    if (end <= from) continue;
    const mins = clipToWindow(start, end, from, to);
    if (mins <= 0) continue;
    const code = classify(ev.category as any);
    states[code] += mins;
    nonProductiveMinutes += mins;
  }

  const totalWindow = Math.round((to.getTime() - from.getTime()) / 60000);
  states.PT = Math.max(0, totalWindow - nonProductiveMinutes);

  const equipmentUptime = states.PT + states.SB + states.ET + states.UD;
  const operationsTime  = states.PT + states.ET;

  return { ...states, totalWindow, equipmentUptime, operationsTime };
}

/**
 * Compute OEE breakdown over [from, to] using production counts from a
 * caller-supplied source (typically `daily_statistics`).
 */
export async function computeOEE(params: {
  machineId: number;
  from: Date;
  to: Date;
  totalCount: number;
  goodCount: number;
  idealCycleTimeSec: number;
}): Promise<OEEBreakdown> {
  const states = await computeStateDurations({
    machineId: params.machineId,
    from: params.from,
    to: params.to,
  });

  const goodCount  = Math.max(0, params.goodCount);
  const totalCount = Math.max(goodCount, params.totalCount);
  const rejectCount = totalCount - goodCount;

  const availability = states.equipmentUptime > 0
    ? states.operationsTime / states.equipmentUptime
    : 0;

  // theoretical productive seconds for actual output
  const theoreticalSec = totalCount * params.idealCycleTimeSec;
  const actualProductiveSec = states.PT * 60;
  const performance = actualProductiveSec > 0
    ? Math.min(1, theoreticalSec / actualProductiveSec)
    : 0;

  const quality = totalCount > 0 ? goodCount / totalCount : 0;
  const oee = availability * performance * quality;

  return {
    machineId: params.machineId,
    windowStart: params.from,
    windowEnd: params.to,
    states,
    availability,
    performance,
    quality,
    oee,
    totalCount,
    goodCount,
    rejectCount,
    idealCycleTimeSec: params.idealCycleTimeSec,
    // computeOEE is the SEMI-E10 six-state calculator (availability from equipment
    // states), the canonical "true OEE". Labelled so it is never read as uptime%.
    availabilityBasis: "semi_e10",
  };
}

/**
 * Persist a computed OEE breakdown to `oee_metrics` (percentage × 100).
 */
export async function persistOEEMetric(params: {
  breakdown: OEEBreakdown;
  machineCode: string;
  periodType?: "HOUR" | "SHIFT" | "DAY" | "WEEK" | "MONTH";
  calculatedBy?: string;
  notes?: string;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const b = params.breakdown;
  const row: InsertOEEMetric = {
    machineId: b.machineId,
    machineCode: params.machineCode,
    timestamp: b.windowEnd,
    periodType: (params.periodType ?? "HOUR") as any,
    availability: Math.round(b.availability * 10000),
    performance:  Math.round(b.performance  * 10000),
    quality:      Math.round(b.quality      * 10000),
    oee:          Math.round(b.oee          * 10000),
    plannedTime:  b.states.equipmentUptime,
    runTime:      b.states.PT,
    idealCycleTime: b.idealCycleTimeSec,
    totalCount: b.totalCount,
    goodCount:  b.goodCount,
    rejectCount: b.rejectCount,
    calculatedBy: params.calculatedBy ?? "AUTO",
    notes: params.notes,
  };
  const [inserted] = await db.insert(oeeMetrics).values(row).returning({ id: oeeMetrics.id });

  // K0+-c: ADDITIVELY publish the OEE metric to the durable ERP outbox.
  // Fire-and-forget + error-isolated (never blocks OEE persist); gated by
  // ERP_OUTBOX_ENABLED (no-op when off). Idempotent per machine+window+period.
  if (inserted?.id) {
    const periodType = params.periodType ?? "HOUR";
    publishToOutbox({
      eventType: "oee-metric",
      payload: {
        oeeMetricId: inserted.id,
        machineId: b.machineId,
        machineCode: params.machineCode,
        timestamp: b.windowEnd.toISOString(),
        periodType,
        availability: row.availability,
        performance: row.performance,
        quality: row.quality,
        oee: row.oee,
        totalCount: b.totalCount,
        goodCount: b.goodCount,
        rejectCount: b.rejectCount,
      },
      idempotencyKey: `oee-${b.machineId}-${b.windowEnd.getTime()}-${periodType}`,
    });
  }

  return inserted?.id ?? null;
}

/**
 * Look up the active OEE target row that applies at `at`.
 */
export async function getActiveOEETarget(params: {
  machineId?: number;
  lineId?: number;
  at?: Date;
}): Promise<typeof oeeTargets.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;
  const at = params.at ?? new Date();
  const rows = await db.select().from(oeeTargets).where(and(
    eq(oeeTargets.isActive, true),
    lte(oeeTargets.effectiveFrom, at),
    params.machineId ? eq(oeeTargets.machineId, params.machineId) : sql`true`,
    params.lineId ? eq(oeeTargets.lineId, params.lineId) : sql`true`,
  ));
  return rows[0] ?? null;
}

export interface OEEAlert {
  level: "ok" | "warning" | "critical";
  oeePct: number;
  threshold: number;
  message: string;
}

export function evaluateOEEAlert(
  oee: number,
  target: { alertThreshold: number; criticalThreshold: number } | null,
): OEEAlert {
  const oeePct = Math.round(oee * 10000);
  if (!target) {
    return { level: "ok", oeePct, threshold: 0, message: "no target configured" };
  }
  if (oeePct < target.criticalThreshold) {
    return {
      level: "critical",
      oeePct,
      threshold: target.criticalThreshold,
      message: `OEE ${(oeePct / 100).toFixed(1)}% below critical ${(target.criticalThreshold / 100).toFixed(1)}%`,
    };
  }
  if (oeePct < target.alertThreshold) {
    return {
      level: "warning",
      oeePct,
      threshold: target.alertThreshold,
      message: `OEE ${(oeePct / 100).toFixed(1)}% below warning ${(target.alertThreshold / 100).toFixed(1)}%`,
    };
  }
  return { level: "ok", oeePct, threshold: target.alertThreshold, message: "within target" };
}

// ───────────────────────────────────────────────────────────────────────────
// LIVE OEE — computed on read from real sources (no in-memory cache).
//
// This is the canonical replacement for the legacy socket.ts in-memory
// `calculateOEE`/`machineOEEData` path. Factors that lack real inputs are
// returned as `null` (honest N/A) — never fabricated.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Live OEE for a single machine. Percentages are 0..100 to match the existing
 * frontend contract (CorporateDashboard / OEEDashboard / MachineHealthMonitoring
 * read `.oee/.availability/.performance/.quality` as percentages). Any factor
 * whose inputs are missing is `null`, and OEE is `null` unless all three exist.
 */
export interface LiveOEEMetrics {
  machineId: number;
  machineCode: string;
  timestamp: Date;
  availability: number | null; // %  online/(online+offline) — UPTIME% (see availabilityBasis)
  performance: number | null;  // %  ideal·count / runTime   (null if no ideal cycle)
  quality: number | null;      // %  (ok+ntf)/total
  oee: number | null;          // %  A×P×Q (null if any factor null)
  // doc 54 P2.2 §3 — live availability is uptime% (online/(online+offline)), a coarse
  // connectivity proxy, NOT the SEMI-E10 six-state availability. Always "uptime" here.
  availabilityBasis: AvailabilityBasis;
  details: {
    windowHours: number;
    onlineSeconds: number;
    offlineSeconds: number;
    totalCount: number;
    goodCount: number;       // ok + ntf
    rejectCount: number;     // ng
    idealCycleTimeSec: number | null;
    hasUptimeData: boolean;
    hasProductionData: boolean;
  };
}

function pct(x: number): number {
  return Math.round(Math.min(100, Math.max(0, x * 100)) * 100) / 100;
}

/**
 * Compute live OEE for one machine over the trailing `windowHours`.
 *
 *  - Availability from the unified machine-status/uptime path
 *    (getMachineUptimeStats → machine_status_logs).
 *  - Production counts (ok/ng/ntf/total) summed from daily_statistics for the
 *    window. Quality = (ok+ntf)/total (NTF treated as good — same convention as
 *    server/db/statistics yieldRate).
 *  - Ideal cycle time resolved by `resolveIdealCycleTimeSec`; when none is
 *    available, Performance (and therefore OEE) is null.
 */
export async function getMachineOEELive(params: {
  machineId: number;
  machineCode?: string;
  windowHours?: number;
  idealCycleTimeSec?: number | null;
}): Promise<LiveOEEMetrics> {
  const windowHours = params.windowHours ?? 24;
  const db = await getDb();

  // Resolve machine code if not supplied.
  let machineCode = params.machineCode ?? "";
  if (!machineCode && db) {
    const rows = await db.select({ code: machines.code })
      .from(machines).where(eq(machines.id, params.machineId)).limit(1);
    machineCode = rows[0]?.code ?? `M-${params.machineId}`;
  }

  const empty = (): LiveOEEMetrics => ({
    machineId: params.machineId,
    machineCode,
    timestamp: new Date(),
    availability: null,
    performance: null,
    quality: null,
    oee: null,
    availabilityBasis: "uptime",
    details: {
      windowHours,
      onlineSeconds: 0,
      offlineSeconds: 0,
      totalCount: 0,
      goodCount: 0,
      rejectCount: 0,
      idealCycleTimeSec: null,
      hasUptimeData: false,
      hasProductionData: false,
    },
  });

  if (!db) return empty();

  // ── Availability ─────────────────────────────────────────────────────────
  const uptime = await getMachineUptimeStats(params.machineId, windowHours);
  const onlineSeconds = uptime.totalOnlineTime;
  const offlineSeconds = uptime.totalOfflineTime;
  const totalStatusTime = onlineSeconds + offlineSeconds;
  const hasUptimeData = totalStatusTime > 0;
  const availability = hasUptimeData ? onlineSeconds / totalStatusTime : null;

  // ── Production counts (Quality + Performance numerator) ───────────────────
  // doc 54 P2.2 §2 (window alignment) — the availability window above runs to NOW
  // (getMachineUptimeStats integrates status logs over [now-windowHours, now]). The
  // production-count window MUST match: previously this query bounded only the LOWER
  // edge (date >= from) with no upper bound, so counts drifted vs the availability
  // denominator. Bind BOTH edges to [from, to=now]. CAVEAT: daily_statistics is
  // DAY-grained (one row/machine/day), so alignment is at day resolution here; for
  // sub-day-exact OEE use the SEMI-E10 snapshot path (computeOEE over product_inspections
  // + downtime_events on an identical [from,to]).
  const to = new Date();
  const from = new Date(to.getTime() - windowHours * 60 * 60 * 1000);
  const statsRows = await db.select({
    totalCount: dailyStatistics.totalCount,
    okCount: dailyStatistics.okCount,
    ngCount: dailyStatistics.ngCount,
    ntfCount: dailyStatistics.ntfCount,
    avgCycleTime: dailyStatistics.avgCycleTime,
  })
    .from(dailyStatistics)
    .where(and(
      eq(dailyStatistics.machineId, params.machineId),
      gte(dailyStatistics.date, from),
      lte(dailyStatistics.date, to),
    ));

  let totalCount = 0, okCount = 0, ngCount = 0, ntfCount = 0;
  for (const r of statsRows) {
    totalCount += Number(r.totalCount) || 0;
    okCount += Number(r.okCount) || 0;
    ngCount += Number(r.ngCount) || 0;
    ntfCount += Number(r.ntfCount) || 0;
  }
  const hasProductionData = totalCount > 0;
  const goodCount = okCount + ntfCount;
  const quality = hasProductionData ? goodCount / totalCount : null;

  // ── Performance ───────────────────────────────────────────────────────────
  const idealCycleTimeSec = params.idealCycleTimeSec ?? null;
  let performance: number | null = null;
  if (idealCycleTimeSec && idealCycleTimeSec > 0 && hasProductionData && onlineSeconds > 0) {
    performance = Math.min(1, (idealCycleTimeSec * totalCount) / onlineSeconds);
  }

  const allFactors = availability !== null && performance !== null && quality !== null;
  const oee = allFactors ? availability! * performance! * quality! : null;

  return {
    machineId: params.machineId,
    machineCode,
    timestamp: new Date(),
    availability: availability !== null ? pct(availability) : null,
    performance: performance !== null ? pct(performance) : null,
    quality: quality !== null ? pct(quality) : null,
    oee: oee !== null ? pct(oee) : null,
    availabilityBasis: "uptime",
    details: {
      windowHours,
      onlineSeconds,
      offlineSeconds,
      totalCount,
      goodCount,
      rejectCount: ngCount,
      idealCycleTimeSec,
      hasUptimeData,
      hasProductionData,
    },
  };
}

/**
 * MON-F8 (doc 40) — proactive ideal-cycle-time source flag.
 *
 * Default OFF (behaviour unchanged: ideal is read back from oee_metrics). When
 * armed (in .env.sim) `resolveIdealCycleTimeSec` prefers a CONFIGURED active OEE
 * target's implied ideal (observed avg cycle × targetPerformance) over the
 * oee_metrics read-back — breaking the chicken-and-egg where OEE needs an ideal
 * that only a prior OEE snapshot could supply.
 */
function idealFromTargetEnabled(): boolean {
  return String(process.env.OEE_IDEAL_FROM_TARGET ?? "false").toLowerCase() === "true";
}

/**
 * doc 54 P2.2 (OEE-trust §1, migration 0285) — cached probe for the CONFIGURED
 * `product_machine_mappings."idealCycleTimeSec"` column. 0285 is a plain ADD COLUMN
 * but it is applied by the DB owner separately, so the column can be ABSENT at
 * runtime. If we read it unconditionally the query would fail on a DB without the
 * migration and take the whole OEE path down. So we probe once (information_schema),
 * cache it, and only read the column when present — absent ⇒ we fall through to the
 * legacy ideal sources (identical behaviour to before 0285). Returns false WITHOUT
 * caching when the executor can't answer (mock db in unit tests) so a real probe
 * still runs later in production.
 */
let pmmIdealCycleColumn: boolean | null = null;
/** Test seam — reset the 0285 column probe between suites. */
export function _resetPmmIdealCycleColumnProbe(): void {
  pmmIdealCycleColumn = null;
}
export async function productMachineMappingHasIdealColumn(exec?: unknown): Promise<boolean> {
  if (pmmIdealCycleColumn !== null) return pmmIdealCycleColumn;
  const runner = exec ?? (await getDb());
  const execFn = (runner as { execute?: (q: unknown) => Promise<unknown> } | null)?.execute;
  if (!runner || typeof execFn !== "function") return false; // can't tell (mock) → treat absent, don't cache
  try {
    const res = await execFn.call(
      runner,
      sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'product_machine_mappings' AND column_name = 'idealCycleTimeSec' LIMIT 1`,
    );
    const rows = Array.isArray(res) ? res : ((res as { rows?: unknown[] } | null)?.rows ?? []);
    pmmIdealCycleColumn = rows.length > 0;
    return pmmIdealCycleColumn;
  } catch {
    return false; // transient failure — don't cache, retry next time
  }
}

/**
 * The CONFIGURED ideal cycle time (seconds/unit) for a machine from
 * product_machine_mappings (doc 54 P2.2). When a productModelId is given, the exact
 * (product, machine) pair's ideal is used; otherwise the highest-PRIORITY active
 * mapping that has a configured ideal wins (honest limitation: a machine running
 * several products with different ideals resolves to its top-priority product here —
 * pass productModelId when the product is known). Returns null when the column is
 * absent (migration 0285 not applied) or nothing is configured.
 */
async function resolveConfiguredIdealCycleTimeSec(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  machineId: number,
  productModelId?: number | null,
): Promise<number | null> {
  if (!(await productMachineMappingHasIdealColumn(db))) return null;
  const rows = executeRows(await db.execute(sql`
    SELECT "idealCycleTimeSec" AS ideal
    FROM product_machine_mappings
    WHERE "machineId" = ${machineId}
      AND "isActive" = true
      AND "idealCycleTimeSec" IS NOT NULL
      AND "idealCycleTimeSec" > 0
      ${productModelId ? sql`AND "productModelId" = ${productModelId}` : sql``}
    ORDER BY "priority" DESC, "idealCycleTimeSec" ASC
    LIMIT 1
  `)) as Array<{ ideal: number | null }>;
  const v = rows[0]?.ideal;
  return v != null && Number(v) > 0 ? Number(v) : null;
}

/**
 * Resolve an ideal cycle time (seconds/unit) for a machine.
 * Priority (highest first):
 *   0. CONFIGURED product_machine_mappings.idealCycleTimeSec (doc 54 P2.2, 0285) —
 *      a truly configured standard, NOT a read-back. Guarded by a column probe so a
 *      DB without 0285 simply falls through.
 *   1. (MON-F8, when OEE_IDEAL_FROM_TARGET armed AND an observed avg cycle is
 *      supplied) the active oee_target's implied ideal = avgCycle × targetPerformance.
 *   2. Most-recent persisted oee_metrics.idealCycleTime for this machine.
 *   3. null (no synthetic default — Performance stays honest-NULL).
 */
export async function resolveIdealCycleTimeSec(
  machineId: number,
  opts?: { avgCycleTimeSec?: number | null; at?: Date; productModelId?: number | null },
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  // 0) CONFIGURED ideal from product_machine_mappings — the proper configured standard.
  const configured = await resolveConfiguredIdealCycleTimeSec(db, machineId, opts?.productModelId ?? null);
  if (configured && configured > 0) return configured;

  // 1) Proactive: active OEE target's implied ideal (gated OFF by default).
  if (idealFromTargetEnabled() && opts?.avgCycleTimeSec && opts.avgCycleTimeSec > 0) {
    const target = await getActiveOEETarget({ machineId, at: opts?.at });
    if (target && target.targetPerformance > 0) {
      const implied = opts.avgCycleTimeSec * (target.targetPerformance / 10000);
      if (implied > 0) return implied;
    }
  }

  // 2) Fallback: last-known persisted ideal from oee_metrics.
  const rows = await db.select({ idealCycleTime: oeeMetrics.idealCycleTime })
    .from(oeeMetrics)
    .where(and(eq(oeeMetrics.machineId, machineId), isNotNull(oeeMetrics.idealCycleTime)))
    .orderBy(sql`${oeeMetrics.timestamp} DESC`)
    .limit(1);
  const v = rows[0]?.idealCycleTime;
  return v && Number(v) > 0 ? Number(v) : null;
}

/**
 * Live OEE for every active machine. Returns one entry per machine; factors are
 * null where data is absent. This is the canonical backing for `getAllOEE`.
 *
 * ★ PHẠM VI (2026-08-18): truyền `userId`/`userRole` từ `ctx.user` ⇒ chỉ máy thuộc nhà máy được
 * gán. Bỏ trống ⇒ KHÔNG lọc (lối đi không mang danh tính). Xem khối chú thích đầu file.
 *
 * ★ Kết quả là MẢNG CÓ NHÃN (`withScopeLabels`): `rows.scopeEmptyReason` / `rows.scopeMessage`
 * nói RÕ "chưa được gán nhà máy" thay vì để một mảng rỗng bị đọc thành "không có dữ liệu".
 * ⚠ Ba ô ấy KHÔNG liệt kê được nên KHÔNG đi qua tRPC/superjson (cố ý — xem `withScopeLabels`);
 * nơi gọi TRONG máy chủ đọc được ngay, nơi gọi qua dây phải lấy lý do từ một truy vấn có mang
 * nhãn trên cùng màn (`dashboard.getStats`) hoặc từ `warRoom.briefing`.
 */
export async function getAllMachinesOEELive(params?: {
  windowHours?: number;
} & OeeViewerScope): Promise<ScopedRows<LiveOEEMetrics>> {
  const scope = await resolveTenantFactoryScope(params);
  const db = await getDb();
  if (!db) return withScopeLabels<LiveOEEMetrics>([], UNSCOPED_LABELS);
  const windowHours = params?.windowHours ?? 24;
  // doc 54 P2.2 §2 — availability integrates status logs to NOW; bind the production
  // window to the SAME [from, to=now] so the count numerator and the online-time
  // denominator use one window (see getMachineOEELive note; day-grain caveat applies).
  const to = new Date();
  const from = new Date(to.getTime() - windowHours * 60 * 60 * 1000);

  // MON-F7 (doc 40) — SET-BASED fleet OEE. The old path fanned out one
  // getMachineOEELive per machine, each doing a full status-log scan + a
  // daily_statistics query + an ideal read-back — i.e. N+1 × several ≈ ~300
  // queries/min for a 100-machine fleet on the 60s broadcaster. This computes the
  // whole fleet with a FIXED handful of grouped queries (machine list + status
  // durations + production + ideal, +1 target when OEE_IDEAL_FROM_TARGET),
  // regardless of fleet size. Result shape is identical to the per-machine path.

  // 1) Active machines.
  // ⚠ Vai toàn quyền giữ NGUYÊN truy vấn cũ (không JOIN thêm gì) — chiều DƯƠNG chống vá quá tay:
  // một máy có chuỗi phân cấp gãy vẫn hiện đúng như trước. Chỉ khi CÓ phạm vi mới đi qua
  // `stations → production_lines → workshops` để biết máy thuộc nhà máy nào (đây là phép TRA
  // CỨU quan hệ, KHÔNG phải một bộ luật phân quyền thứ hai — luật nằm ở `factoryIds`).
  const machineRows = scope.factoryIds === null
    ? await db.select({ id: machines.id, code: machines.code })
        .from(machines)
        .where(eq(machines.isActive, true))
    : (executeRows(await db.execute(sql`
        SELECT m."id" AS id, m."code" AS code
        FROM machines m
        JOIN stations s ON s."id" = m."stationId"
        JOIN production_lines l ON l."id" = s."lineId"
        JOIN workshops w ON w."id" = l."workshopId"
        WHERE m."isActive" = true
          AND ${factoryIdGate(sql`w."factoryId"`, scope.factoryIds)}
      `)) as Array<{ id: number; code: string }>).map((r) => ({ id: Number(r.id), code: r.code }));
  if (machineRows.length === 0) return withScopeLabels<LiveOEEMetrics>([], scope.labels);

  // 2) Availability — online/offline seconds per machine from machine_status_logs,
  //    computed set-based with a window LEAD. Mirrors getMachineUptimeStats exactly:
  //    only rows inside the window count, and the last row's interval extends to
  //    NOW() (open-ended current state).
  const durationRows = executeRows(await db.execute(sql`
    WITH ordered AS (
      SELECT "machineId" AS machine_id, status, "timestamp" AS ts,
             LEAD("timestamp") OVER (PARTITION BY "machineId" ORDER BY "timestamp") AS next_ts
      FROM machine_status_logs
      WHERE "timestamp" >= ${from.toISOString()}
    )
    SELECT machine_id,
      COALESCE(SUM(CASE WHEN status = 'online'
        THEN EXTRACT(EPOCH FROM (COALESCE(next_ts, NOW()) - ts)) ELSE 0 END), 0)::float AS online_sec,
      COALESCE(SUM(CASE WHEN status <> 'online'
        THEN EXTRACT(EPOCH FROM (COALESCE(next_ts, NOW()) - ts)) ELSE 0 END), 0)::float AS offline_sec
    FROM ordered
    GROUP BY machine_id
  `)) as Array<{ machine_id: number; online_sec: number; offline_sec: number }>;
  const uptimeByMachine = new Map<number, { online: number; offline: number }>();
  for (const r of durationRows) {
    uptimeByMachine.set(Number(r.machine_id), {
      online: Math.round(Number(r.online_sec) || 0),
      offline: Math.round(Number(r.offline_sec) || 0),
    });
  }

  // 3) Production counts + observed avg cycle per machine from daily_statistics.
  const statRows = executeRows(await db.execute(sql`
    SELECT "machineId" AS machine_id,
      COALESCE(SUM("totalCount"), 0)::int  AS total,
      COALESCE(SUM("okCount"), 0)::int     AS ok,
      COALESCE(SUM("ngCount"), 0)::int     AS ng,
      COALESCE(SUM("ntfCount"), 0)::int    AS ntf,
      AVG(NULLIF("avgCycleTime", 0))::float AS avg_cycle
    FROM daily_statistics
    WHERE "date" >= ${from.toISOString()} AND "date" <= ${to.toISOString()}
      ${factoryGateFragment(scope, sql`"factoryId"`)}
    GROUP BY "machineId"
  `)) as Array<{ machine_id: number; total: number; ok: number; ng: number; ntf: number; avg_cycle: number | null }>;
  const prodByMachine = new Map<number, { total: number; ok: number; ng: number; ntf: number; avgCycle: number | null }>();
  for (const r of statRows) {
    prodByMachine.set(Number(r.machine_id), {
      total: Number(r.total) || 0,
      ok: Number(r.ok) || 0,
      ng: Number(r.ng) || 0,
      ntf: Number(r.ntf) || 0,
      avgCycle: r.avg_cycle != null ? Number(r.avg_cycle) : null,
    });
  }

  // 4) Ideal cycle time per machine — latest persisted oee_metrics.idealCycleTime
  //    (DISTINCT ON), the same fallback source resolveIdealCycleTimeSec uses.
  const idealRows = executeRows(await db.execute(sql`
    SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "idealCycleTime" AS ideal
    FROM oee_metrics
    WHERE "idealCycleTime" IS NOT NULL
    ORDER BY "machineId", "timestamp" DESC
  `)) as Array<{ machine_id: number; ideal: number | null }>;
  const idealByMachine = new Map<number, number>();
  for (const r of idealRows) {
    const v = r.ideal != null ? Number(r.ideal) : 0;
    if (v > 0) idealByMachine.set(Number(r.machine_id), v);
  }

  // 4a) doc 54 P2.2 — CONFIGURED ideal per machine (highest-priority active mapping
  //     with a non-null idealCycleTimeSec). Guarded by the 0285 column probe: absent ⇒
  //     skipped entirely (no query, no behaviour change). When present it WINS over the
  //     oee_metrics read-back and the target-implied ideal below.
  let configuredIdealByMachine: Map<number, number> | null = null;
  if (await productMachineMappingHasIdealColumn(db)) {
    const cfgRows = executeRows(await db.execute(sql`
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "idealCycleTimeSec" AS ideal
      FROM product_machine_mappings
      WHERE "isActive" = true AND "idealCycleTimeSec" IS NOT NULL AND "idealCycleTimeSec" > 0
      ORDER BY "machineId", "priority" DESC, "idealCycleTimeSec" ASC
    `)) as Array<{ machine_id: number; ideal: number | null }>;
    configuredIdealByMachine = new Map<number, number>();
    for (const r of cfgRows) {
      const v = r.ideal != null ? Number(r.ideal) : 0;
      if (v > 0) configuredIdealByMachine.set(Number(r.machine_id), v);
    }
  }

  // 4b) MON-F8 — PROACTIVE ideal from active OEE targets (implied ideal =
  //     observed avg cycle × targetPerformance). Gated OFF by default; when armed
  //     it wins over the oee_metrics read-back (per-machine, applied in step 5).
  let targetPerfByMachine: Map<number, number> | null = null;
  if (idealFromTargetEnabled()) {
    const now = new Date();
    const targetRows = executeRows(await db.execute(sql`
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "targetPerformance" AS perf
      FROM oee_targets
      WHERE "isActive" = true AND "machineId" IS NOT NULL AND "effectiveFrom" <= ${now.toISOString()}
      ORDER BY "machineId", "effectiveFrom" DESC
    `)) as Array<{ machine_id: number; perf: number | null }>;
    targetPerfByMachine = new Map<number, number>();
    for (const r of targetRows) {
      const p = r.perf != null ? Number(r.perf) : 0;
      if (p > 0) targetPerfByMachine.set(Number(r.machine_id), p);
    }
  }

  // 5) Assemble per machine (pure JS; SAME math as getMachineOEELive — honest N/A
  //    for any factor whose inputs are absent).
  const now = new Date();
  return withScopeLabels(machineRows.map((m) => {
    const up = uptimeByMachine.get(m.id) ?? { online: 0, offline: 0 };
    const prod = prodByMachine.get(m.id) ?? { total: 0, ok: 0, ng: 0, ntf: 0, avgCycle: null };

    const onlineSeconds = up.online;
    const offlineSeconds = up.offline;
    const totalStatusTime = onlineSeconds + offlineSeconds;
    const hasUptimeData = totalStatusTime > 0;
    const availability = hasUptimeData ? onlineSeconds / totalStatusTime : null;

    const totalCount = prod.total;
    const hasProductionData = totalCount > 0;
    const goodCount = prod.ok + prod.ntf;
    const quality = hasProductionData ? goodCount / totalCount : null;

    // Ideal priority: CONFIGURED mapping (0285) → proactive target-implied (if armed
    // + observed avg present) → last-known oee_metrics. Honest-NULL if none resolve.
    let idealCycleTimeSec: number | null = configuredIdealByMachine?.get(m.id) ?? null;
    if (idealCycleTimeSec == null && targetPerfByMachine && prod.avgCycle && prod.avgCycle > 0) {
      const perf = targetPerfByMachine.get(m.id);
      if (perf && perf > 0) idealCycleTimeSec = prod.avgCycle * (perf / 10000);
    }
    if (idealCycleTimeSec == null) idealCycleTimeSec = idealByMachine.get(m.id) ?? null;

    let performance: number | null = null;
    if (idealCycleTimeSec && idealCycleTimeSec > 0 && hasProductionData && onlineSeconds > 0) {
      performance = Math.min(1, (idealCycleTimeSec * totalCount) / onlineSeconds);
    }

    const allFactors = availability !== null && performance !== null && quality !== null;
    const oee = allFactors ? availability! * performance! * quality! : null;

    return {
      machineId: m.id,
      machineCode: m.code,
      timestamp: now,
      availability: availability !== null ? pct(availability) : null,
      performance: performance !== null ? pct(performance) : null,
      quality: quality !== null ? pct(quality) : null,
      oee: oee !== null ? pct(oee) : null,
      availabilityBasis: "uptime",
      details: {
        windowHours,
        onlineSeconds,
        offlineSeconds,
        totalCount,
        goodCount,
        rejectCount: prod.ng,
        idealCycleTimeSec,
        hasUptimeData,
        hasProductionData,
      },
    } satisfies LiveOEEMetrics;
  }), scope.labels);
}

// ───────────────────────────────────────────────────────────────────────────
// LINE-LEVEL OEE — rollup by production line over an explicit [from, to] window.
//
// doc 40 Wave 4c (§11 — MON supervisor "OEE theo LINE" + War-Room briefing).
// Same SEMI-E10 math as getMachineOEELive, but aggregated to the LINE grain by
// walking machines → stations → production_lines → workshops. Fully SET-BASED
// (a fixed handful of grouped queries regardless of fleet size — no N+1) and
// HONEST-NULL: any factor whose inputs are absent is null, and line OEE is null
// unless all three factors exist.
//
// Unlike getAllMachinesOEELive (trailing window from NOW), this accepts an
// explicit [from, to] so callers (War-Room "today"/per-shift briefing) can scope
// the exact period. Sources are identical: machine_status_logs (availability),
// daily_statistics (quality + performance numerator), oee_metrics.idealCycleTime
// (last-known ideal cycle time).
// ───────────────────────────────────────────────────────────────────────────

export interface LineOEEMetrics {
  lineId: number;
  lineName: string;
  availability: number | null; // %  online / (online + offline) — UPTIME% (see availabilityBasis)
  performance: number | null;  // %  Σ(ideal·total) / Σonline over machines w/ ideal
  quality: number | null;      // %  (ok + ntf) / total
  oee: number | null;          // %  A × P × Q (null if any factor null)
  // doc 54 P2.2 §3 — line availability is uptime% (online/(online+offline)), not SEMI-E10.
  availabilityBasis: AvailabilityBasis;
  details: {
    from: Date;
    to: Date;
    machineCount: number;
    onlineSeconds: number;
    offlineSeconds: number;
    totalCount: number;
    goodCount: number;   // ok + ntf
    rejectCount: number; // ng
    hasUptimeData: boolean;
    hasProductionData: boolean;
    hasIdeal: boolean;
  };
}

export async function getLineOEE(params?: {
  lineId?: number;
  factoryId?: number;
  from?: Date;
  to?: Date;
} & OeeViewerScope): Promise<ScopedRows<LineOEEMetrics>> {
  const scope = await resolveTenantFactoryScope(params);
  const db = await getDb();
  if (!db) return withScopeLabels<LineOEEMetrics>([], UNSCOPED_LABELS);
  const to = params?.to ?? new Date();
  const from = params?.from ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (to.getTime() <= from.getTime()) return withScopeLabels<LineOEEMetrics>([], scope.labels);

  // 1) Active machine → line map (optionally scoped to one line / one factory).
  const mapRows = executeRows(await db.execute(sql`
    SELECT m."id" AS machine_id, l."id" AS line_id, l."name" AS line_name
    FROM machines m
    JOIN stations s ON s."id" = m."stationId"
    JOIN production_lines l ON l."id" = s."lineId"
    JOIN workshops w ON w."id" = l."workshopId"
    WHERE m."isActive" = true
      ${params?.lineId ? sql`AND l."id" = ${params.lineId}` : sql``}
      ${params?.factoryId ? sql`AND w."factoryId" = ${params.factoryId}` : sql``}
      ${factoryGateFragment(scope, sql`w."factoryId"`)}
  `)) as Array<{ machine_id: number; line_id: number; line_name: string }>;
  // ⚠ Cổng phạm vi đứng SAU bộ lọc `factoryId` do người gọi chọn, và là phép GIAO — một
  // `factoryId` nằm ngoài phạm vi cho ra tập rỗng, KHÔNG mở rộng quyền.
  if (mapRows.length === 0) return withScopeLabels<LineOEEMetrics>([], scope.labels);

  const lineNameById = new Map<number, string>();
  const machineToLine = new Map<number, number>();
  const lineOrder: number[] = [];
  for (const r of mapRows) {
    const mid = Number(r.machine_id), lid = Number(r.line_id);
    machineToLine.set(mid, lid);
    if (!lineNameById.has(lid)) { lineNameById.set(lid, r.line_name); lineOrder.push(lid); }
  }

  // 2) Availability inputs — online/offline seconds per machine over [from, to].
  //    Mirrors getAllMachinesOEELive but with a closed upper bound: the current
  //    (open-ended) interval is clipped to `to`, not NOW().
  const durationRows = executeRows(await db.execute(sql`
    WITH ordered AS (
      SELECT "machineId" AS machine_id, status, "timestamp" AS ts,
             LEAD("timestamp") OVER (PARTITION BY "machineId" ORDER BY "timestamp") AS next_ts
      FROM machine_status_logs
      WHERE "timestamp" >= ${from.toISOString()} AND "timestamp" <= ${to.toISOString()}
    )
    SELECT machine_id,
      COALESCE(SUM(CASE WHEN status = 'online'
        THEN EXTRACT(EPOCH FROM (LEAST(COALESCE(next_ts, ${to.toISOString()}), ${to.toISOString()}) - ts)) ELSE 0 END), 0)::float AS online_sec,
      COALESCE(SUM(CASE WHEN status <> 'online'
        THEN EXTRACT(EPOCH FROM (LEAST(COALESCE(next_ts, ${to.toISOString()}), ${to.toISOString()}) - ts)) ELSE 0 END), 0)::float AS offline_sec
    FROM ordered
    GROUP BY machine_id
  `)) as Array<{ machine_id: number; online_sec: number; offline_sec: number }>;
  const uptimeByMachine = new Map<number, { online: number; offline: number }>();
  for (const r of durationRows) {
    uptimeByMachine.set(Number(r.machine_id), {
      online: Math.max(0, Math.round(Number(r.online_sec) || 0)),
      offline: Math.max(0, Math.round(Number(r.offline_sec) || 0)),
    });
  }

  // 3) Production counts per machine over [from, to].
  const statRows = executeRows(await db.execute(sql`
    SELECT "machineId" AS machine_id,
      COALESCE(SUM("totalCount"), 0)::int AS total,
      COALESCE(SUM("okCount"), 0)::int    AS ok,
      COALESCE(SUM("ngCount"), 0)::int    AS ng,
      COALESCE(SUM("ntfCount"), 0)::int   AS ntf
    FROM daily_statistics
    WHERE "date" >= ${from.toISOString()} AND "date" <= ${to.toISOString()}
      ${factoryGateFragment(scope, sql`"factoryId"`)}
    GROUP BY "machineId"
  `)) as Array<{ machine_id: number; total: number; ok: number; ng: number; ntf: number }>;
  const prodByMachine = new Map<number, { total: number; ok: number; ng: number; ntf: number }>();
  for (const r of statRows) {
    prodByMachine.set(Number(r.machine_id), {
      total: Number(r.total) || 0, ok: Number(r.ok) || 0,
      ng: Number(r.ng) || 0, ntf: Number(r.ntf) || 0,
    });
  }

  // 4) Ideal cycle time per machine — latest persisted oee_metrics.idealCycleTime.
  const idealRows = executeRows(await db.execute(sql`
    SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "idealCycleTime" AS ideal
    FROM oee_metrics
    WHERE "idealCycleTime" IS NOT NULL
    ORDER BY "machineId", "timestamp" DESC
  `)) as Array<{ machine_id: number; ideal: number | null }>;
  const idealByMachine = new Map<number, number>();
  for (const r of idealRows) {
    const v = r.ideal != null ? Number(r.ideal) : 0;
    if (v > 0) idealByMachine.set(Number(r.machine_id), v);
  }

  // 4a) doc 54 P2.2 — CONFIGURED ideal per machine wins over the oee_metrics read-back.
  //     Guarded by the 0285 column probe (absent ⇒ skipped, no behaviour change).
  if (await productMachineMappingHasIdealColumn(db)) {
    const cfgRows = executeRows(await db.execute(sql`
      SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "idealCycleTimeSec" AS ideal
      FROM product_machine_mappings
      WHERE "isActive" = true AND "idealCycleTimeSec" IS NOT NULL AND "idealCycleTimeSec" > 0
      ORDER BY "machineId", "priority" DESC, "idealCycleTimeSec" ASC
    `)) as Array<{ machine_id: number; ideal: number | null }>;
    for (const r of cfgRows) {
      const v = r.ideal != null ? Number(r.ideal) : 0;
      if (v > 0) idealByMachine.set(Number(r.machine_id), v); // configured overrides read-back
    }
  }

  // 5) Aggregate per line (pure JS; honest-null for absent inputs).
  type Acc = {
    machineCount: number; online: number; offline: number;
    total: number; good: number; ng: number;
    perfNum: number; perfDen: number; hasIdeal: boolean;
  };
  const accByLine = new Map<number, Acc>();
  for (const lid of lineOrder) {
    accByLine.set(lid, {
      machineCount: 0, online: 0, offline: 0, total: 0, good: 0, ng: 0,
      perfNum: 0, perfDen: 0, hasIdeal: false,
    });
  }
  for (const [mid, lid] of machineToLine) {
    const acc = accByLine.get(lid);
    if (!acc) continue;
    acc.machineCount += 1;
    const up = uptimeByMachine.get(mid);
    if (up) { acc.online += up.online; acc.offline += up.offline; }
    const prod = prodByMachine.get(mid);
    if (prod) {
      acc.total += prod.total;
      acc.good += prod.ok + prod.ntf;
      acc.ng += prod.ng;
      // Performance numerator/denominator restricted to machines that HAVE an
      // ideal cycle time AND produced units (so a machine with no configured
      // ideal never silently deflates the line's performance).
      const ideal = idealByMachine.get(mid);
      if (ideal && ideal > 0 && prod.total > 0 && up && up.online > 0) {
        acc.perfNum += ideal * prod.total;
        acc.perfDen += up.online;
        acc.hasIdeal = true;
      }
    }
  }

  return withScopeLabels(lineOrder.map((lid) => {
    const a = accByLine.get(lid)!;
    const totalStatus = a.online + a.offline;
    const hasUptimeData = totalStatus > 0;
    const availability = hasUptimeData ? a.online / totalStatus : null;

    const hasProductionData = a.total > 0;
    const quality = hasProductionData ? a.good / a.total : null;

    let performance: number | null = null;
    if (a.hasIdeal && a.perfDen > 0) performance = Math.min(1, a.perfNum / a.perfDen);

    const allFactors = availability !== null && performance !== null && quality !== null;
    const oee = allFactors ? availability! * performance! * quality! : null;

    return {
      lineId: lid,
      lineName: lineNameById.get(lid) ?? `Line ${lid}`,
      availability: availability !== null ? pct(availability) : null,
      performance: performance !== null ? pct(performance) : null,
      quality: quality !== null ? pct(quality) : null,
      oee: oee !== null ? pct(oee) : null,
      availabilityBasis: "uptime",
      details: {
        from, to,
        machineCount: a.machineCount,
        onlineSeconds: a.online,
        offlineSeconds: a.offline,
        totalCount: a.total,
        goodCount: a.good,
        rejectCount: a.ng,
        hasUptimeData,
        hasProductionData,
        hasIdeal: a.hasIdeal,
      },
    } satisfies LineOEEMetrics;
  }), scope.labels);
}

// ═══════════════════════════════════════════════════════════════════════════
// doc 54 P2.5 — Production analytics (downtime Pareto, MTBF/MTTR, takt/utilization/
// line-balance). All REAL computations from real sources, HONEST when data is sparse
// (null/empty, never fabricated). Pure math is factored into exported helpers so the
// formulas are unit-testable without a database.
// ═══════════════════════════════════════════════════════════════════════════

/** Float minutes of overlap between [start, end] and the window [from, to]. */
function overlapMinutes(start: Date, end: Date, from: Date, to: Date): number {
  const s = Math.max(start.getTime(), from.getTime());
  const e = Math.min(end.getTime(), to.getTime());
  return Math.max(0, (e - s) / 60000);
}

// ─── Downtime Pareto ─────────────────────────────────────────────────────────

export interface DowntimeParetoRow {
  key: string;             // category or reason label
  eventCount: number;
  downtimeMinutes: number; // clipped to the window
  pct: number;             // % of total downtime minutes
  cumulativePct: number;   // running total, ascending order of the sorted rows
}

export interface DowntimeParetoResult {
  from: Date;
  to: Date;
  groupBy: "category" | "reason";
  totalEvents: number;
  totalDowntimeMinutes: number;
  rows: DowntimeParetoRow[]; // sorted by downtimeMinutes DESC; overflow folded into "Other"
  hasData: boolean;
}

/**
 * PURE — build a Pareto (sorted desc, cumulative %) from grouped downtime rows.
 * Groups beyond `limit` are folded into a single "Other" bucket so the % + cumulative
 * still sum to 100 over the full population (no silent truncation of the denominator).
 */
export function computeParetoRows(
  groups: Array<{ key: string; eventCount: number; downtimeMinutes: number }>,
  limit = 20,
): { rows: DowntimeParetoRow[]; totalEvents: number; totalDowntimeMinutes: number } {
  const totalEvents = groups.reduce((s, g) => s + g.eventCount, 0);
  const totalMinutes = groups.reduce((s, g) => s + g.downtimeMinutes, 0);
  const sorted = [...groups].sort((a, b) => b.downtimeMinutes - a.downtimeMinutes);

  let kept = sorted;
  if (sorted.length > limit) {
    const head = sorted.slice(0, limit);
    const tail = sorted.slice(limit);
    const other = {
      key: "Other",
      eventCount: tail.reduce((s, g) => s + g.eventCount, 0),
      downtimeMinutes: tail.reduce((s, g) => s + g.downtimeMinutes, 0),
    };
    kept = [...head, other];
  }

  let cum = 0;
  const rows: DowntimeParetoRow[] = kept.map((g) => {
    const pct = totalMinutes > 0 ? (g.downtimeMinutes / totalMinutes) * 100 : 0;
    cum += pct;
    return {
      key: g.key,
      eventCount: g.eventCount,
      downtimeMinutes: Math.round(g.downtimeMinutes * 100) / 100,
      pct: Math.round(pct * 100) / 100,
      cumulativePct: Math.round(Math.min(100, cum) * 100) / 100,
    };
  });
  return { rows, totalEvents, totalDowntimeMinutes: Math.round(totalMinutes * 100) / 100 };
}

/**
 * Downtime Pareto over [from, to] from downtime_events. Minutes are clipped to the
 * window (open events extend to `to`). Optional machine scope; empty scope ⇒ empty.
 */
export async function getDowntimePareto(params: {
  machineIds?: number[];
  from: Date;
  to: Date;
  groupBy?: "category" | "reason";
  limit?: number;
}): Promise<DowntimeParetoResult> {
  const groupBy = params.groupBy ?? "category";
  const empty: DowntimeParetoResult = {
    from: params.from, to: params.to, groupBy,
    totalEvents: 0, totalDowntimeMinutes: 0, rows: [], hasData: false,
  };
  const db = await getDb();
  if (!db) return empty;
  if (params.machineIds && params.machineIds.length === 0) return empty;
  if (params.to.getTime() <= params.from.getTime()) return empty;

  const machineFilter = params.machineIds && params.machineIds.length > 0
    ? sql`AND "machineId" IN (${sql.join(params.machineIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``;
  const keyExpr = groupBy === "reason"
    ? sql`COALESCE(NULLIF(btrim("reason"), ''), '(unspecified)')`
    : sql`"category"::text`;

  const rows = executeRows(await db.execute(sql`
    SELECT ${keyExpr} AS key,
           COUNT(*)::int AS event_count,
           COALESCE(SUM(
             GREATEST(0, EXTRACT(EPOCH FROM (
               LEAST(COALESCE("endTime", ${params.to.toISOString()}), ${params.to.toISOString()})
               - GREATEST("startTime", ${params.from.toISOString()})
             )) / 60.0)
           ), 0)::float AS minutes
    FROM downtime_events
    WHERE "startTime" <= ${params.to.toISOString()}
      AND COALESCE("endTime", ${params.to.toISOString()}) >= ${params.from.toISOString()}
      ${machineFilter}
    GROUP BY key
  `)) as Array<{ key: string; event_count: number; minutes: number }>;

  const groups = rows.map((r) => ({
    key: String(r.key ?? "(unspecified)"),
    eventCount: Number(r.event_count) || 0,
    downtimeMinutes: Number(r.minutes) || 0,
  }));
  const { rows: paretoRows, totalEvents, totalDowntimeMinutes } = computeParetoRows(groups, params.limit ?? 20);

  return {
    from: params.from, to: params.to, groupBy,
    totalEvents, totalDowntimeMinutes,
    rows: paretoRows,
    hasData: totalEvents > 0,
  };
}

// ─── Reliability: MTBF / MTTR ────────────────────────────────────────────────

/** Downtime categories that count as FAILURES for MTBF/MTTR (unplanned stoppages). */
export const DEFAULT_FAILURE_CATEGORIES = ["unplanned", "breakdown"] as const;

export interface ReliabilityMachine {
  machineId: number;
  failureCount: number;
  totalDowntimeMinutes: number; // ALL categories, clipped
  failureDowntimeMinutes: number; // failure categories only, clipped
  mtbfHours: number | null;     // uptime between failures (null if no failures)
  mttrHours: number | null;     // mean repair time per failure (null if no failures)
}

export interface ReliabilityResult {
  from: Date;
  to: Date;
  windowHours: number;
  failureCategories: string[];
  machineCount: number;         // machines with ≥1 downtime event in the window
  failureCount: number;
  mtbfHours: number | null;     // fleet: total uptime / total failures
  mttrHours: number | null;     // fleet: total failure-repair time / total failures
  perMachine: ReliabilityMachine[];
  hasData: boolean;
}

interface DowntimeRowLite { machineId: number; category: string | null; startTime: Date; endTime: Date | null }

/**
 * PURE — MTBF / MTTR from downtime rows over [from, to].
 *   MTTR = Σ(failure repair minutes) / (# failures)                    — mean time to repair
 *   MTBF = Σ(uptime minutes) / (# failures),
 *          uptime = windowMinutes − totalDowntimeMinutes(all categories) per machine — mean
 *          operating time between failures. Both null when there are no failures (honest N/A).
 * Open events (endTime null) extend to `to`. Repair time uses the failure events' clipped
 * duration; uptime nets out ALL downtime (planned + unplanned) so MTBF reflects true operating time.
 */
export function computeReliability(
  events: DowntimeRowLite[],
  from: Date,
  to: Date,
  failureCategories: readonly string[] = DEFAULT_FAILURE_CATEGORIES,
): ReliabilityResult {
  const windowMs = Math.max(0, to.getTime() - from.getTime());
  const windowMinutes = windowMs / 60000;
  const failSet = new Set(failureCategories.map((c) => c.toLowerCase()));

  const byMachine = new Map<number, DowntimeRowLite[]>();
  for (const e of events) {
    const arr = byMachine.get(e.machineId) ?? [];
    arr.push(e);
    byMachine.set(e.machineId, arr);
  }

  const perMachine: ReliabilityMachine[] = [];
  let fleetFailures = 0;
  let fleetRepairMin = 0;
  let fleetUptimeMin = 0;

  for (const [machineId, evs] of byMachine) {
    let failureCount = 0;
    let totalDowntimeMin = 0;
    let failureDowntimeMin = 0;
    for (const e of evs) {
      const end = e.endTime ?? to;
      const mins = overlapMinutes(new Date(e.startTime), new Date(end), from, to);
      if (mins <= 0) continue;
      totalDowntimeMin += mins;
      if (e.category && failSet.has(e.category.toLowerCase())) {
        failureCount += 1;
        failureDowntimeMin += mins;
      }
    }
    const uptimeMin = Math.max(0, windowMinutes - totalDowntimeMin);
    const mtbfHours = failureCount > 0 ? (uptimeMin / failureCount) / 60 : null;
    const mttrHours = failureCount > 0 ? (failureDowntimeMin / failureCount) / 60 : null;
    perMachine.push({
      machineId,
      failureCount,
      totalDowntimeMinutes: Math.round(totalDowntimeMin * 100) / 100,
      failureDowntimeMinutes: Math.round(failureDowntimeMin * 100) / 100,
      mtbfHours: mtbfHours == null ? null : Math.round(mtbfHours * 100) / 100,
      mttrHours: mttrHours == null ? null : Math.round(mttrHours * 100) / 100,
    });
    if (failureCount > 0) {
      fleetFailures += failureCount;
      fleetRepairMin += failureDowntimeMin;
      fleetUptimeMin += uptimeMin;
    }
  }

  perMachine.sort((a, b) => b.failureCount - a.failureCount || a.machineId - b.machineId);

  return {
    from, to,
    windowHours: Math.round((windowMinutes / 60) * 100) / 100,
    failureCategories: [...failureCategories],
    machineCount: byMachine.size,
    failureCount: fleetFailures,
    mtbfHours: fleetFailures > 0 ? Math.round(((fleetUptimeMin / fleetFailures) / 60) * 100) / 100 : null,
    mttrHours: fleetFailures > 0 ? Math.round(((fleetRepairMin / fleetFailures) / 60) * 100) / 100 : null,
    perMachine,
    hasData: events.length > 0,
  };
}

/** MTBF / MTTR over [from, to] from downtime_events. Optional machine scope. */
export async function getReliabilityMetrics(params: {
  machineIds?: number[];
  from: Date;
  to: Date;
  failureCategories?: string[];
}): Promise<ReliabilityResult> {
  const empty: ReliabilityResult = {
    from: params.from, to: params.to,
    windowHours: Math.round(((params.to.getTime() - params.from.getTime()) / 3600000) * 100) / 100,
    failureCategories: params.failureCategories ?? [...DEFAULT_FAILURE_CATEGORIES],
    machineCount: 0, failureCount: 0, mtbfHours: null, mttrHours: null, perMachine: [], hasData: false,
  };
  const db = await getDb();
  if (!db) return empty;
  if (params.machineIds && params.machineIds.length === 0) return empty;
  if (params.to.getTime() <= params.from.getTime()) return empty;

  const machineFilter = params.machineIds && params.machineIds.length > 0
    ? sql`AND "machineId" IN (${sql.join(params.machineIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``;

  const rows = executeRows(await db.execute(sql`
    SELECT "machineId" AS machine_id, "category"::text AS category,
           "startTime" AS start_time, "endTime" AS end_time
    FROM downtime_events
    WHERE "startTime" <= ${params.to.toISOString()}
      AND COALESCE("endTime", ${params.to.toISOString()}) >= ${params.from.toISOString()}
      ${machineFilter}
  `)) as Array<{ machine_id: number; category: string | null; start_time: string | Date; end_time: string | Date | null }>;

  const events: DowntimeRowLite[] = rows.map((r) => ({
    machineId: Number(r.machine_id),
    category: r.category,
    startTime: new Date(r.start_time),
    endTime: r.end_time ? new Date(r.end_time) : null,
  }));

  return computeReliability(
    events, params.from, params.to,
    params.failureCategories ?? DEFAULT_FAILURE_CATEGORIES,
  );
}

// ─── Takt / utilization / line-balance ───────────────────────────────────────

export interface StationBalanceRow {
  stationId: number;
  stationName: string;
  machineCount: number;
  producedUnits: number;
  onlineSeconds: number;
  /** Avg reported cycle time (s) for the station (daily_statistics.avgCycleTime), else derived. */
  cycleTimeSec: number | null;
  isBottleneck: boolean;
}

export interface LineTaktResult {
  lineId: number;
  lineName: string;
  from: Date;
  to: Date;
  windowSeconds: number;
  demandUnits: number | null;         // capacityPerHour × windowHours (configured), else null
  producedUnits: number;
  taktTimeSec: number | null;         // windowSeconds / demandUnits (null if no demand configured)
  actualCycleTimeSec: number | null;  // windowSeconds / producedUnits (null if no output)
  timeUtilizationPct: number | null;  // onlineSec / (onlineSec+offlineSec) — logged-time online share
  capacityUtilizationPct: number | null; // producedUnits / demandUnits × 100 (null if no demand)
  balanceRatePct: number | null;      // mean(stationCycle)/max(stationCycle) × 100 (line balance efficiency)
  bottleneckStationId: number | null;
  stations: StationBalanceRow[];
  hasData: boolean;
}

/**
 * PURE — line-balance efficiency + bottleneck from per-station cycle times.
 * balanceRate = mean(cycle)/max(cycle) × 100 over stations WITH a cycle time; the
 * bottleneck is the slowest station (max cycle). Null when <1 station has a cycle.
 */
export function computeLineBalance(
  stations: Array<{ stationId: number; cycleTimeSec: number | null }>,
): { balanceRatePct: number | null; bottleneckStationId: number | null } {
  const withCycle = stations.filter((s): s is { stationId: number; cycleTimeSec: number } =>
    s.cycleTimeSec != null && s.cycleTimeSec > 0);
  if (withCycle.length === 0) return { balanceRatePct: null, bottleneckStationId: null };
  const maxCycle = Math.max(...withCycle.map((s) => s.cycleTimeSec));
  const meanCycle = withCycle.reduce((sum, s) => sum + s.cycleTimeSec, 0) / withCycle.length;
  const bottleneck = withCycle.find((s) => s.cycleTimeSec === maxCycle) ?? null;
  return {
    balanceRatePct: maxCycle > 0 ? Math.round((meanCycle / maxCycle) * 10000) / 100 : null,
    bottleneckStationId: bottleneck ? bottleneck.stationId : null,
  };
}

/**
 * Takt / utilization / per-station line-balance over an explicit [from, to] window.
 *
 * SOURCES (all real, honest-null when absent):
 *  • available/online time  ← machine_status_logs (clipped to [from,to], set-based LEAD).
 *  • production + avg cycle  ← daily_statistics over the SAME [from,to] window.
 *  • demand                  ← production_lines.capacityPerHour × windowHours (configured);
 *                              absent ⇒ takt + capacityUtilization are null (no fabricated demand).
 * Definitions:
 *  • Takt time            = availableWindowSeconds / demandUnits (line cadence required to meet demand).
 *  • Actual cycle time    = windowSeconds / producedUnits (observed line output cadence).
 *  • Time utilization     = Σonline / Σ(online+offline) across the line's machines.
 *  • Capacity utilization = producedUnits / demandUnits.
 *  • Balance rate         = mean/ max station cycle time; bottleneck = slowest station.
 */
export async function getLineTaktUtilization(params: {
  lineId?: number;
  factoryId?: number;
  from: Date;
  to: Date;
} & OeeViewerScope): Promise<ScopedRows<LineTaktResult>> {
  const scope = await resolveTenantFactoryScope(params);
  const db = await getDb();
  if (!db) return withScopeLabels<LineTaktResult>([], UNSCOPED_LABELS);
  const { from, to } = params;
  if (to.getTime() <= from.getTime()) return withScopeLabels<LineTaktResult>([], scope.labels);
  const windowSeconds = (to.getTime() - from.getTime()) / 1000;
  const windowHours = windowSeconds / 3600;

  // 1) machine → station → line map (+ line name, capacityPerHour), active machines.
  const mapRows = executeRows(await db.execute(sql`
    SELECT m."id" AS machine_id, s."id" AS station_id, s."name" AS station_name,
           l."id" AS line_id, l."name" AS line_name, l."capacityPerHour" AS capacity_per_hour
    FROM machines m
    JOIN stations s ON s."id" = m."stationId"
    JOIN production_lines l ON l."id" = s."lineId"
    JOIN workshops w ON w."id" = l."workshopId"
    WHERE m."isActive" = true
      ${params.lineId ? sql`AND l."id" = ${params.lineId}` : sql``}
      ${params.factoryId ? sql`AND w."factoryId" = ${params.factoryId}` : sql``}
      ${factoryGateFragment(scope, sql`w."factoryId"`)}
  `)) as Array<{
    machine_id: number; station_id: number; station_name: string;
    line_id: number; line_name: string; capacity_per_hour: number | null;
  }>;
  if (mapRows.length === 0) return withScopeLabels<LineTaktResult>([], scope.labels);

  // 2) online/offline seconds per machine over [from, to] (closed upper bound at `to`).
  const durationRows = executeRows(await db.execute(sql`
    WITH ordered AS (
      SELECT "machineId" AS machine_id, status, "timestamp" AS ts,
             LEAD("timestamp") OVER (PARTITION BY "machineId" ORDER BY "timestamp") AS next_ts
      FROM machine_status_logs
      WHERE "timestamp" >= ${from.toISOString()} AND "timestamp" <= ${to.toISOString()}
    )
    SELECT machine_id,
      COALESCE(SUM(CASE WHEN status = 'online'
        THEN EXTRACT(EPOCH FROM (LEAST(COALESCE(next_ts, ${to.toISOString()}), ${to.toISOString()}) - ts)) ELSE 0 END), 0)::float AS online_sec,
      COALESCE(SUM(CASE WHEN status <> 'online'
        THEN EXTRACT(EPOCH FROM (LEAST(COALESCE(next_ts, ${to.toISOString()}), ${to.toISOString()}) - ts)) ELSE 0 END), 0)::float AS offline_sec
    FROM ordered
    GROUP BY machine_id
  `)) as Array<{ machine_id: number; online_sec: number; offline_sec: number }>;
  const uptimeByMachine = new Map<number, { online: number; offline: number }>();
  for (const r of durationRows) {
    uptimeByMachine.set(Number(r.machine_id), {
      online: Math.max(0, Number(r.online_sec) || 0),
      offline: Math.max(0, Number(r.offline_sec) || 0),
    });
  }

  // 3) production + avg cycle per machine over [from, to].
  const statRows = executeRows(await db.execute(sql`
    SELECT "machineId" AS machine_id,
      COALESCE(SUM("totalCount"), 0)::int AS total,
      AVG(NULLIF("avgCycleTime", 0))::float AS avg_cycle
    FROM daily_statistics
    WHERE "date" >= ${from.toISOString()} AND "date" <= ${to.toISOString()}
      ${factoryGateFragment(scope, sql`"factoryId"`)}
    GROUP BY "machineId"
  `)) as Array<{ machine_id: number; total: number; avg_cycle: number | null }>;
  const prodByMachine = new Map<number, { total: number; avgCycle: number | null }>();
  for (const r of statRows) {
    prodByMachine.set(Number(r.machine_id), {
      total: Number(r.total) || 0,
      avgCycle: r.avg_cycle != null ? Number(r.avg_cycle) : null,
    });
  }

  // 4) fold machines → stations → lines.
  type StationAcc = { stationId: number; stationName: string; machineCount: number; produced: number; online: number; cycleSum: number; cycleN: number };
  type LineAcc = {
    lineId: number; lineName: string; capacityPerHour: number | null;
    online: number; offline: number; produced: number;
    stations: Map<number, StationAcc>;
  };
  const lineAcc = new Map<number, LineAcc>();
  const lineOrder: number[] = [];
  for (const r of mapRows) {
    const lid = Number(r.line_id);
    let la = lineAcc.get(lid);
    if (!la) {
      la = { lineId: lid, lineName: r.line_name, capacityPerHour: r.capacity_per_hour != null ? Number(r.capacity_per_hour) : null, online: 0, offline: 0, produced: 0, stations: new Map() };
      lineAcc.set(lid, la);
      lineOrder.push(lid);
    }
    const sid = Number(r.station_id);
    let sa = la.stations.get(sid);
    if (!sa) {
      sa = { stationId: sid, stationName: r.station_name, machineCount: 0, produced: 0, online: 0, cycleSum: 0, cycleN: 0 };
      la.stations.set(sid, sa);
    }
    const up = uptimeByMachine.get(Number(r.machine_id)) ?? { online: 0, offline: 0 };
    const prod = prodByMachine.get(Number(r.machine_id)) ?? { total: 0, avgCycle: null };
    la.online += up.online; la.offline += up.offline; la.produced += prod.total;
    sa.machineCount += 1; sa.online += up.online; sa.produced += prod.total;
    if (prod.avgCycle != null && prod.avgCycle > 0) { sa.cycleSum += prod.avgCycle; sa.cycleN += 1; }
  }

  return withScopeLabels(lineOrder.map((lid) => {
    const la = lineAcc.get(lid)!;
    const demandUnits = la.capacityPerHour != null && la.capacityPerHour > 0
      ? Math.round(la.capacityPerHour * windowHours)
      : null;
    const availTime = la.online + la.offline;
    const stations: StationBalanceRow[] = [...la.stations.values()].map((sa) => {
      // Prefer the reported avg cycle; fall back to online/produced when no reported cycle.
      const reported = sa.cycleN > 0 ? sa.cycleSum / sa.cycleN : null;
      const derived = sa.produced > 0 && sa.online > 0 ? sa.online / sa.produced : null;
      const cycleTimeSec = reported ?? derived;
      return {
        stationId: sa.stationId,
        stationName: sa.stationName,
        machineCount: sa.machineCount,
        producedUnits: sa.produced,
        onlineSeconds: Math.round(sa.online),
        cycleTimeSec: cycleTimeSec != null ? Math.round(cycleTimeSec * 100) / 100 : null,
        isBottleneck: false,
      };
    });
    const balance = computeLineBalance(stations.map((s) => ({ stationId: s.stationId, cycleTimeSec: s.cycleTimeSec })));
    for (const s of stations) s.isBottleneck = balance.bottleneckStationId != null && s.stationId === balance.bottleneckStationId;

    return {
      lineId: lid,
      lineName: la.lineName,
      from, to,
      windowSeconds: Math.round(windowSeconds),
      demandUnits,
      producedUnits: la.produced,
      taktTimeSec: demandUnits && demandUnits > 0 ? Math.round((windowSeconds / demandUnits) * 100) / 100 : null,
      actualCycleTimeSec: la.produced > 0 ? Math.round((windowSeconds / la.produced) * 100) / 100 : null,
      timeUtilizationPct: availTime > 0 ? Math.round((la.online / availTime) * 10000) / 100 : null,
      capacityUtilizationPct: demandUnits && demandUnits > 0 ? Math.round((la.produced / demandUnits) * 10000) / 100 : null,
      balanceRatePct: balance.balanceRatePct,
      bottleneckStationId: balance.bottleneckStationId,
      stations,
      hasData: la.produced > 0 || availTime > 0,
    } satisfies LineTaktResult;
  }), scope.labels);
}
