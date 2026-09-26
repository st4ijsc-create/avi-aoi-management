/**
 * AI Local Tools — Phase B4 Management & Data-Analysis READ tools.
 *
 * NL→analytics done the SAFE way (USER DECISION §B8bis#5 / §B4.1): the deep
 * model NEVER writes free SQL. Each capability below is a parameterized,
 * READ-ONLY, WHITELISTED tool that wraps an EXISTING analytics service
 * (oeeService / paretoAnalysisService / aiTimeSeriesEngine /
 * predictiveMaintenanceService / yield-trend statistics). The Model Router
 * (Tier 1 = 4B) picks the tool + extracts params via the intentClassifier;
 * Tier 0 services produce numbers; Tier 2 (30B) narrates the returned
 * `textSummary` + structured `data`.
 *
 * Every tool here is `kind: "read"` (no preview/execute/HITL) BUT — unlike the
 * GĐ1/F6 read tools — each declares a `requiredPermission` (the matching
 * `analytics_*` RBAC module) AND ENFORCES it inside the handler:
 *
 *   - The authenticated session user is threaded in via the reserved param
 *     `__authCtx` ({ userId, role }). The chat/orchestrator layer supplies it.
 *   - The handler calls checkPermission(...) BEFORE touching data.
 *   - FAIL-SAFE: if `__authCtx` is absent OR permission is denied, the tool
 *     returns a localized "denied" result with NO data (never throws, never
 *     leaks). This guarantees a denied role gets zero analytics data.
 *
 * Forecasting tools return BOTH the numeric forecast AND interpretation context
 * (trend direction, confidence, threshold breaches) so the deep model can
 * explain it — no new forecasting math is invented here; we wrap the existing
 * Holt-Winters/EWMA engine and the statistical PdM risk model.
 *
 * Self-registers on import (see index.ts → `import "./analyticsTools"`).
 */

import { z } from "zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { machines, oeeMetrics } from "../../../drizzle/schema";
import { checkPermission } from "../../_core/accessControl";
import { resolveLineIdByCode } from "../../db/lineBalance";
import {
  paretoByDefectType,
  paretoByMachine,
  type ParetoAnalysisResult,
} from "../paretoAnalysisService";
import { getYieldTrendData } from "../../db/statistics";
import { getTopNGMeasurementPointsEnhanced } from "../../db/statistics";
import { computeFailureRisk } from "../predictiveMaintenanceService";
import {
  analyzeTimeSeries,
  forecastWithConfidenceInterval,
  type TimeSeriesPoint,
  type ForecastPoint,
} from "../aiTimeSeriesEngine";
import { registerTool, type Tool, type ToolResult, type ToolLang, type ToolResultType } from "./toolRegistry";

// ─── shared helpers ──────────────────────────────────────────────────────────

type Lang = ToolLang;

/** Reserved auth-context param threaded from the API/chat layer. Optional in
 *  the schema so the heuristic classifier (which omits it) still validates; a
 *  MISSING context is treated as DENY (fail-safe). */
const authCtxSchema = z
  .object({
    userId: z.number().int().positive(),
    role: z.string().min(1),
  })
  .strict();
type AuthCtx = z.infer<typeof authCtxSchema>;

/** Pick a language hint out of the threaded context (defaults to vi). */
function langOf(params: { lang?: unknown }): Lang {
  const l = params.lang;
  return l === "en" || l === "zh" ? l : "vi";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function sinceDays(days: number): Date {
  const start = startOfDay(new Date());
  start.setDate(start.getDate() - (days - 1));
  return start;
}

function noDbResult<T>(type: ToolResultType, title: string, fallback: T): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: "Không có kết nối CSDL — không thể truy vấn dữ liệu phân tích.",
    note: "DB_UNAVAILABLE",
  };
}

const DENY_MSG: Record<Lang, (mod: string) => string> = {
  vi: (m) => `Bạn không có quyền xem dữ liệu phân tích "${m}". Vui lòng liên hệ quản trị viên.`,
  en: (m) => `You do not have permission to view analytics "${m}". Please contact an administrator.`,
  zh: (m) => `您无权查看分析数据 "${m}"。请联系管理员。`,
};

function deniedResult<T>(type: ToolResultType, title: string, fallback: T, module: string, lang: Lang): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: DENY_MSG[lang](module),
    note: "PERMISSION_DENIED",
  };
}

/**
 * RBAC gate shared by every analytics read tool. Returns null when ALLOWED;
 * otherwise returns a no-data "denied" ToolResult the handler returns as-is.
 * FAIL-SAFE: a missing/invalid `__authCtx` → DENY (never leaks data).
 */
async function rbacGate<T>(
  rawAuthCtx: unknown,
  module: string,
  type: ToolResultType,
  title: string,
  fallback: T,
  lang: Lang,
): Promise<ToolResult<T> | null> {
  const parsed = authCtxSchema.safeParse(rawAuthCtx);
  if (!parsed.success) {
    return deniedResult(type, title, fallback, module, lang);
  }
  const auth: AuthCtx = parsed.data;
  let allowed = false;
  try {
    allowed = await checkPermission(auth.userId, auth.role, module, "canView");
  } catch {
    allowed = false; // fail-safe on any RBAC lookup error
  }
  if (!allowed) return deniedResult(type, title, fallback, module, lang);
  return null;
}

/** Resolve machines.code → numeric id (read-only). */
async function resolveMachineId(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  machineCode: string,
): Promise<number | null> {
  const rows = await db.select({ id: machines.id }).from(machines).where(eq(machines.code, machineCode)).limit(1);
  return rows[0]?.id ?? null;
}

/** Compute [start,end) for "this" period and the immediately prior one. */
function periodWindows(period: "day" | "week" | "month"): {
  curStart: Date;
  curEnd: Date;
  prevStart: Date;
  prevEnd: Date;
} {
  const now = new Date();
  const curEnd = now;
  let span: number;
  if (period === "day") span = 1;
  else if (period === "week") span = 7;
  else span = 30;
  const curStart = startOfDay(new Date(now.getTime() - (span - 1) * 86400_000));
  const prevEnd = new Date(curStart.getTime());
  const prevStart = startOfDay(new Date(prevEnd.getTime() - span * 86400_000));
  return { curStart, curEnd, prevStart, prevEnd };
}

// ── 1. analytics_query_oee ────────────────────────────────────────────────────

interface OeeAnalyticsData {
  machineCode: string | null;
  period: "day" | "week" | "month";
  current: { avgOee: number; avgA: number; avgP: number; avgQ: number; samples: number };
  previous: { avgOee: number; samples: number } | null;
  deltaPct: number | null; // current.avgOee − previous.avgOee (percentage points)
  trend: "up" | "down" | "flat" | null;
}

const oeeQueryParams = z
  .object({
    machineCode: z.string().min(1).max(50).optional(),
    period: z.enum(["day", "week", "month"]).optional().default("week"),
    compareToPrior: z.boolean().optional().default(true),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

async function avgOeeOver(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  machineCode: string | undefined,
  from: Date,
  to: Date,
): Promise<{ avgOee: number; avgA: number; avgP: number; avgQ: number; samples: number }> {
  const conds = [gte(oeeMetrics.timestamp, from), lte(oeeMetrics.timestamp, to)];
  if (machineCode) conds.push(eq(oeeMetrics.machineCode, machineCode));
  const rows = await db
    .select({
      availability: oeeMetrics.availability,
      performance: oeeMetrics.performance,
      quality: oeeMetrics.quality,
      oee: oeeMetrics.oee,
    })
    .from(oeeMetrics)
    .where(and(...conds));
  if (rows.length === 0) return { avgOee: 0, avgA: 0, avgP: 0, avgQ: 0, samples: 0 };
  // columns are integer percentage×100 → /100 to get %.
  const sum = rows.reduce(
    (a, r) => ({
      o: a.o + Number(r.oee),
      av: a.av + Number(r.availability),
      p: a.p + Number(r.performance),
      q: a.q + Number(r.quality),
    }),
    { o: 0, av: 0, p: 0, q: 0 },
  );
  const n = rows.length;
  return {
    avgOee: round2(sum.o / n / 100),
    avgA: round2(sum.av / n / 100),
    avgP: round2(sum.p / n / 100),
    avgQ: round2(sum.q / n / 100),
    samples: n,
  };
}

const analyticsQueryOee: Tool<z.infer<typeof oeeQueryParams>, OeeAnalyticsData | null> = {
  name: "analytics_query_oee",
  description:
    "Truy vấn OEE (Availability×Performance×Quality) theo máy + kỳ (ngày/tuần/tháng), so sánh với kỳ trước. READ-ONLY, RBAC analytics_oee.",
  parameters: oeeQueryParams,
  triggers: [
    "oee kỳ này", "oee tuần này", "oee tháng này", "so sánh oee", "oee so với",
    "oee compare", "oee this week", "oee dây chuyền", "oee máy",
  ],
  kind: "read",
  requiredPermission: { module: "analytics_oee", action: "canView" },
  summarize: (p, lang) =>
    lang === "en"
      ? `Query OEE for ${p.machineCode ?? "all machines"} (${p.period})`
      : lang === "zh"
        ? `查询 OEE：${p.machineCode ?? "全部设备"}（${p.period}）`
        : `Tra OEE ${p.machineCode ?? "toàn bộ máy"} (${p.period})`,
  handler: async (params) => {
    const lang = langOf(params);
    const { machineCode, period, compareToPrior, __authCtx } = params;
    const title = machineCode ? `OEE ${machineCode} (${period})` : `OEE (${period})`;
    const denied = await rbacGate<OeeAnalyticsData | null>(__authCtx, "analytics_oee", "analytics_oee", title, null, lang);
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<OeeAnalyticsData | null>("analytics_oee", title, null);

    const { curStart, curEnd, prevStart, prevEnd } = periodWindows(period);
    const current = await avgOeeOver(db, machineCode, curStart, curEnd);
    if (current.samples === 0) {
      return {
        type: "analytics_oee",
        title,
        data: { machineCode: machineCode ?? null, period, current, previous: null, deltaPct: null, trend: null },
        textSummary: machineCode
          ? `Chưa có dữ liệu OEE cho máy "${machineCode}" trong kỳ này.`
          : "Chưa có dữ liệu OEE trong kỳ này.",
        note: "NOT_FOUND",
      };
    }
    const previous = compareToPrior ? await avgOeeOver(db, machineCode, prevStart, prevEnd) : null;
    const prev = previous && previous.samples > 0 ? { avgOee: previous.avgOee, samples: previous.samples } : null;
    const deltaPct = prev ? round2(current.avgOee - prev.avgOee) : null;
    const trend: OeeAnalyticsData["trend"] =
      deltaPct == null ? null : deltaPct > 0.5 ? "up" : deltaPct < -0.5 ? "down" : "flat";

    const data: OeeAnalyticsData = {
      machineCode: machineCode ?? null,
      period,
      current: { avgOee: current.avgOee, avgA: current.avgA, avgP: current.avgP, avgQ: current.avgQ, samples: current.samples },
      previous: prev,
      deltaPct,
      trend,
    };

    const scope = machineCode ? `máy ${machineCode}` : "toàn bộ máy";
    const cmp =
      prev && deltaPct != null
        ? ` So kỳ trước (OEE ${prev.avgOee}%): ${deltaPct >= 0 ? "+" : ""}${deltaPct} điểm % (${trend === "up" ? "TĂNG" : trend === "down" ? "GIẢM" : "ổn định"}).`
        : "";
    return {
      type: "analytics_oee",
      title,
      data,
      textSummary:
        `OEE ${scope} kỳ ${period}: TB ${current.avgOee}% ` +
        `(A=${current.avgA}%, P=${current.avgP}%, Q=${current.avgQ}%; ${current.samples} điểm).${cmp}`,
    };
  },
};

// ── 2. analytics_defect_pareto ────────────────────────────────────────────────

interface ParetoToolData {
  groupBy: "defectType" | "machine";
  totalDefects: number;
  pareto80Count: number;
  topN: Array<{ category: string; count: number; percentage: number; cumulativePercentage: number }>;
}

const paretoParams = z
  .object({
    groupBy: z.enum(["defectType", "machine"]).optional().default("defectType"),
    days: z.number().int().min(1).max(90).optional().default(7),
    machineId: z.number().int().positive().optional(),
    lineId: z.number().int().positive().optional(),
    factoryId: z.number().int().positive().optional(),
    topN: z.number().int().min(1).max(50).optional().default(5),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const analyticsDefectPareto: Tool<z.infer<typeof paretoParams>, ParetoToolData | null> = {
  name: "analytics_defect_pareto",
  description:
    "Phân tích Pareto 80/20 lỗi NG: top-N loại lỗi hoặc top-N máy gây lỗi trong N ngày (lọc theo máy/line/nhà máy). READ-ONLY, RBAC analytics_root_cause.",
  parameters: paretoParams,
  triggers: [
    "top lỗi", "top ng", "pareto", "lỗi nhiều nhất", "loại lỗi", "80/20",
    "top defect", "máy lỗi nhiều", "lỗi theo máy", "top 5 lỗi",
  ],
  kind: "read",
  requiredPermission: { module: "analytics_root_cause", action: "canView" },
  summarize: (p, lang) =>
    lang === "en"
      ? `Top-${p.topN} defect Pareto by ${p.groupBy} (${p.days}d)`
      : lang === "zh"
        ? `按${p.groupBy}的前${p.topN}缺陷帕累托（${p.days}天）`
        : `Pareto top-${p.topN} lỗi theo ${p.groupBy} (${p.days} ngày)`,
  handler: async (params) => {
    const lang = langOf(params);
    const { groupBy, days, machineId, lineId, factoryId, topN, __authCtx } = params;
    const title = `Pareto lỗi (${groupBy}, ${days} ngày)`;
    const denied = await rbacGate<ParetoToolData | null>(
      __authCtx, "analytics_root_cause", "analytics_pareto", title, null, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<ParetoToolData | null>("analytics_pareto", title, null);

    const endDate = new Date();
    const startDate = sinceDays(days);
    let result: ParetoAnalysisResult;
    try {
      result =
        groupBy === "machine"
          ? await paretoByMachine({ startDate, endDate, factoryId, lineId, limit: topN })
          : await paretoByDefectType({ startDate, endDate, factoryId, lineId, machineId, limit: topN });
    } catch {
      // Fail-safe: any analytics-query error → honest empty result, never throw.
      return {
        type: "analytics_pareto",
        title,
        data: { groupBy, totalDefects: 0, pareto80Count: 0, topN: [] },
        textSummary: `Không truy vấn được Pareto lỗi (${groupBy}) trong ${days} ngày qua.`,
        note: "QUERY_ERROR",
      };
    }

    const top = result.items.slice(0, topN).map((it) => ({
      category: it.category,
      count: it.count,
      percentage: round2(it.percentage),
      cumulativePercentage: round2(it.cumulativePercentage),
    }));
    const data: ParetoToolData = {
      groupBy,
      totalDefects: result.totalDefects,
      pareto80Count: result.pareto80Count,
      topN: top,
    };

    if (result.totalDefects === 0) {
      return {
        type: "analytics_pareto",
        title,
        data,
        textSummary: `Không có lỗi NG nào theo ${groupBy} trong ${days} ngày qua.`,
        note: "NOT_FOUND",
      };
    }
    const listing = top.map((t, i) => `${i + 1}. ${t.category}: ${t.count} (${t.percentage}%)`).join("; ");
    return {
      type: "analytics_pareto",
      title,
      data,
      textSummary:
        `Pareto lỗi theo ${groupBy} (${days} ngày): tổng ${result.totalDefects} NG; ` +
        `${result.pareto80Count} hạng mục chiếm ~80%. Top: ${listing}.`,
    };
  },
};

// ── 3. analytics_defect_heatmap_summary ───────────────────────────────────────

interface HeatmapSummaryData {
  totalNG: number;
  hotspots: Array<{ pointCode: string; pointName: string; ngCount: number; ngRate: number; percentage: number }>;
  /**
   * Nhà máy mà con số này thực sự nói về. `null` = người gọi là vai TOÀN QUYỀN
   * (admin) ⇒ tổng hợp toàn hệ thống, y như trước bản vá 2026-08-17.
   */
  factoryScope?: string | null;
}

/**
 * Câu "rỗng" TRUNG THỰC cho tài khoản chưa được gán nhà máy. Cùng luật với
 * `readToolRbac.cauTuChoi`: nói ĐÚNG lý do, không bao giờ giả vờ "không có dữ liệu".
 */
const HEATMAP_NO_SCOPE_MSG: Record<Lang, string> = {
  vi:
    "Tài khoản của bạn chưa được gán nhà máy nào, nên không có bản ghi kiểm nào nằm trong " +
    "phạm vi bạn được xem. Đây là phạm vi rỗng — KHÔNG phải kết luận rằng dây chuyền không " +
    "có lỗi. Liên hệ quản trị viên để được gán nhà máy.",
  en:
    "Your account is not assigned to any factory, so no inspection records fall within your " +
    "data scope. This is an EMPTY SCOPE — not a finding that the line has no defects. " +
    "Contact an administrator to be assigned a factory.",
  zh:
    "您的账户尚未分配任何工厂，因此没有任何检测记录处于您的数据范围内。这是范围为空——" +
    "并不代表产线没有缺陷。请联系管理员分配工厂。",
};

const heatmapParams = z
  .object({
    days: z.number().int().min(1).max(90).optional().default(7),
    machineId: z.number().int().positive().optional(),
    productModelId: z.number().int().positive().optional(),
    topN: z.number().int().min(1).max(30).optional().default(5),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const analyticsDefectHeatmapSummary: Tool<z.infer<typeof heatmapParams>, HeatmapSummaryData | null> = {
  name: "analytics_defect_heatmap_summary",
  description:
    "Tóm tắt heatmap lỗi: các điểm đo (vị trí) nóng nhất theo số NG trong N ngày. READ-ONLY, RBAC analytics_defect_heatmap.",
  parameters: heatmapParams,
  triggers: [
    "heatmap", "bản đồ nhiệt", "điểm nóng lỗi", "vị trí lỗi", "hotspot",
    "điểm đo lỗi nhiều", "defect heatmap",
  ],
  kind: "read",
  requiredPermission: { module: "analytics_defect_heatmap", action: "canView" },
  summarize: (p, lang) =>
    lang === "en"
      ? `Defect heatmap hotspots (${p.days}d)`
      : lang === "zh"
        ? `缺陷热力图热点（${p.days}天）`
        : `Điểm nóng heatmap lỗi (${p.days} ngày)`,
  handler: async (params) => {
    const lang = langOf(params);
    const { days, machineId, productModelId, topN, __authCtx } = params;
    const title = `Heatmap lỗi (${days} ngày)`;
    const denied = await rbacGate<HeatmapSummaryData | null>(
      __authCtx, "analytics_defect_heatmap", "analytics_heatmap", title, null, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<HeatmapSummaryData | null>("analytics_heatmap", title, null);

    // ── PHẠM VI DỮ LIỆU (2026-08-17) ────────────────────────────────────────
    // `rbacGate` ở trên chỉ kiểm QUYỀN ("được xem loại dữ liệu này không?"), KHÔNG
    // giới hạn PHẠM VI ("được xem dữ liệu của NHỮNG nhà máy nào?") — hai thứ khác
    // nhau, và trước hôm nay chỉ có cái thứ nhất tồn tại ở đây. Dùng ĐÚNG bộ phân
    // giải phạm vi đã có cho các bề mặt AI (`_core/aiAnalyticsScope`, vốn xây trên
    // cùng `accessControl.getUserAssignmentCodes` mà `/history` dùng) — không có cơ
    // chế thứ hai. `import()` động: giữ `_core/aiAnalyticsScope` (kéo theo aiGateway)
    // ra khỏi đồ thị nạp của sổ đăng ký tool.
    const { resolveFactoryScope, firstFactoryCodeInScope } = await import("../../_core/aiAnalyticsScope");
    const auth = authCtxSchema.safeParse(__authCtx);
    if (!auth.success) {
      // Không thể tới đây (rbacGate đã chặn) — nhưng nếu tới thì ĐÓNG, không mở.
      return deniedResult<HeatmapSummaryData | null>("analytics_heatmap", title, null, "analytics_defect_heatmap", lang);
    }
    const scope = await resolveFactoryScope({ id: auth.data.userId, role: auth.data.role } as never);
    let factoryCode: string | undefined;
    if (!scope.isGlobal) {
      // Người gọi bị giới hạn: thu về ĐÚNG MỘT mã nhà máy trong phạm vi của họ
      // (`getTopNGMeasurementPointsEnhanced` chỉ nhận một mã). Không phân giải được
      // ⇒ phạm vi RỖNG ⇒ trả câu trung thực và KHÔNG chạm một hàng dữ liệu nào.
      const picked = await firstFactoryCodeInScope(scope);
      if (!picked) {
        return {
          type: "analytics_heatmap",
          title,
          data: { totalNG: 0, hotspots: [], factoryScope: null },
          textSummary: HEATMAP_NO_SCOPE_MSG[lang],
          note: "SCOPE_EMPTY",
        };
      }
      factoryCode = picked;
    }

    const startDate = sinceDays(days);
    const endDate = new Date();
    let rows: Awaited<ReturnType<typeof getTopNGMeasurementPointsEnhanced>>;
    try {
      rows = await getTopNGMeasurementPointsEnhanced({ startDate, endDate, machineId, productModelId, factoryCode, limit: topN });
    } catch {
      return {
        type: "analytics_heatmap",
        title,
        data: { totalNG: 0, hotspots: [], factoryScope: factoryCode ?? null },
        textSummary: `Không truy vấn được điểm nóng lỗi trong ${days} ngày qua.`,
        note: "QUERY_ERROR",
      };
    }

    const totalNG = rows.reduce((s, r) => s + Number(r.ngCount), 0);
    const hotspots = rows.map((r) => ({
      pointCode: String(r.pointCode ?? ""),
      pointName: String(r.pointName ?? r.pointCode ?? "Unknown"),
      ngCount: Number(r.ngCount),
      ngRate: round2(Number(r.ngRate ?? 0)),
      percentage: totalNG > 0 ? round2((Number(r.ngCount) / totalNG) * 100) : 0,
    }));
    const data: HeatmapSummaryData = { totalNG, hotspots, factoryScope: factoryCode ?? null };
    // Nói RÕ con số này thuộc nhà máy nào — một tổng "toàn hệ thống" và một tổng
    // "một nhà máy" trông giống hệt nhau nếu không ghi phạm vi ra.
    const scopeNote = factoryCode ? ` (phạm vi: nhà máy ${factoryCode})` : "";

    if (totalNG === 0) {
      return {
        type: "analytics_heatmap",
        title,
        data,
        textSummary: `Không có lỗi NG để dựng heatmap trong ${days} ngày qua${scopeNote}.`,
        note: "NOT_FOUND",
      };
    }
    const listing = hotspots.map((h, i) => `${i + 1}. ${h.pointName}: ${h.ngCount} NG (${h.percentage}%)`).join("; ");
    return {
      type: "analytics_heatmap",
      title,
      data,
      textSummary: `Điểm nóng lỗi (${days} ngày)${scopeNote}: tổng ${totalNG} NG. Top vị trí: ${listing}.`,
    };
  },
};

// ── 4. analytics_query_yield ──────────────────────────────────────────────────

interface YieldAnalyticsData {
  interval: "hour" | "day" | "week" | "month";
  points: number;
  avgYield: number; // %
  latestYield: number | null;
  trend: "improving" | "declining" | "stable";
  series: Array<{ ts: string; yieldRate: number; total: number; ng: number }>;
}

const yieldParams = z
  .object({
    days: z.number().int().min(1).max(180).optional().default(14),
    interval: z.enum(["hour", "day", "week", "month"]).optional().default("day"),
    machineId: z.number().int().positive().optional(),
    factoryCode: z.string().min(1).max(50).optional(),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const analyticsQueryYield: Tool<z.infer<typeof yieldParams>, YieldAnalyticsData | null> = {
  name: "analytics_query_yield",
  description:
    "Truy vấn yield/FPY theo ngày/tuần/tháng (lọc máy/nhà máy), kèm xu hướng tăng/giảm. READ-ONLY, RBAC analytics_oee.",
  parameters: yieldParams,
  // ★★★ Đợt N / TASK N1 — gỡ trigger MỘT TỪ "yield" khỏi danh sách (cùng gốc rễ với `get_oee` ở
  // `handlers.ts`, xem docblock ở đó + `task-n1-report.md`). "yield" còn NGUY HIỂM HƠN
  // "performance"/"quality": nó là TỪ KHOÁ JavaScript/TypeScript (`function*`/`yield`) — xuất hiện
  // dày đặc trong CHÍNH mã nguồn dự án này (vd `aiLocalKnowledgeService.ts::streamAnswer` có hàng
  // chục lượt `yield`/`yield*`). ĐO SỐNG: ngữ cảnh mã trích nguyên văn từ `streamAnswer` (có
  // `yield`) + câu hỏi "đọc code và tóm tắt tổng quan" ⇒ `analytics_query_yield` bị chọn nhầm, RBAC
  // `analytics_oee` từ chối thật. Tool vẫn gọi được bằng "fpy", "tỉ lệ đạt", "tỷ lệ đạt", "tỉ lệ
  // pass", "first pass", "yield trend", "xu hướng yield", "sản lượng đạt" (đều ≥2 từ, đặc trưng).
  triggers: [
    "fpy", "tỉ lệ đạt", "tỷ lệ đạt", "tỉ lệ pass", "first pass",
    "yield trend", "xu hướng yield", "sản lượng đạt",
  ],
  kind: "read",
  requiredPermission: { module: "analytics_oee", action: "canView" },
  summarize: (p, lang) =>
    lang === "en"
      ? `Query yield/FPY (${p.days}d by ${p.interval})`
      : lang === "zh"
        ? `查询良率/FPY（${p.days}天，按${p.interval}）`
        : `Tra yield/FPY (${p.days} ngày theo ${p.interval})`,
  handler: async (params) => {
    const lang = langOf(params);
    const { days, interval, machineId, factoryCode, __authCtx } = params;
    const title = `Yield/FPY (${days} ngày, ${interval})`;
    const denied = await rbacGate<YieldAnalyticsData | null>(__authCtx, "analytics_oee", "analytics_yield", title, null, lang);
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<YieldAnalyticsData | null>("analytics_yield", title, null);

    const startDate = sinceDays(days);
    const endDate = new Date();
    let trend: Awaited<ReturnType<typeof getYieldTrendData>>;
    try {
      trend = await getYieldTrendData({ startDate, endDate, machineId, factoryCode, interval });
    } catch {
      return {
        type: "analytics_yield",
        title,
        data: { interval, points: 0, avgYield: 0, latestYield: null, trend: "stable", series: [] },
        textSummary: `Không truy vấn được yield trong ${days} ngày qua.`,
        note: "QUERY_ERROR",
      };
    }

    const series = trend.map((r) => ({
      ts: r.timeInterval ? new Date(r.timeInterval as any).toISOString() : "",
      yieldRate: round2(r.yieldRate),
      total: r.totalCount,
      ng: r.ngCount,
    }));
    if (series.length === 0) {
      return {
        type: "analytics_yield",
        title,
        data: { interval, points: 0, avgYield: 0, latestYield: null, trend: "stable", series: [] },
        textSummary: `Chưa có dữ liệu yield trong ${days} ngày qua.`,
        note: "NOT_FOUND",
      };
    }

    const avgYield = round2(series.reduce((s, p) => s + p.yieldRate, 0) / series.length);
    const latestYield = series[series.length - 1].yieldRate;
    // Trend via the existing engine (slope sign).
    let trendDir: YieldAnalyticsData["trend"] = "stable";
    if (series.length >= 2) {
      const pts: TimeSeriesPoint[] = series.map((p, i) => ({ timestamp: i, value: p.yieldRate }));
      const slope = analyzeTimeSeries(pts, { algorithm: "ewma", horizon: 1 }).summary.trendSlope;
      trendDir = slope > 0.3 ? "improving" : slope < -0.3 ? "declining" : "stable";
    }

    const data: YieldAnalyticsData = {
      interval,
      points: series.length,
      avgYield,
      latestYield,
      trend: trendDir,
      series,
    };
    const trendVi = trendDir === "improving" ? "ĐANG CẢI THIỆN" : trendDir === "declining" ? "ĐANG GIẢM" : "ỔN ĐỊNH";
    return {
      type: "analytics_yield",
      title,
      data,
      textSummary:
        `Yield/FPY (${days} ngày theo ${interval}, ${series.length} điểm): TB ${avgYield}%, ` +
        `mới nhất ${latestYield}%. Xu hướng: ${trendVi}.`,
    };
  },
};

// ── 5. analytics_spc_status ──────────────────────────────────────────────────

interface SpcStatusData {
  metric: string;
  points: number;
  mean: number;
  stdDev: number;
  ucl: number;
  lcl: number;
  outOfControl: Array<{ index: number; value: number; score: number }>;
  anomalyCount: number;
}

const spcParams = z
  .object({
    days: z.number().int().min(1).max(90).optional().default(14),
    machineId: z.number().int().positive().optional(),
    factoryCode: z.string().min(1).max(50).optional(),
    sigma: z.number().min(1).max(4).optional().default(3),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const analyticsSpcStatus: Tool<z.infer<typeof spcParams>, SpcStatusData | null> = {
  name: "analytics_spc_status",
  description:
    "Trạng thái SPC trên chuỗi yield: các điểm vượt kiểm soát (out-of-control, >±kσ). READ-ONLY, RBAC analytics_spc.",
  parameters: spcParams,
  triggers: [
    "spc", "out of control", "vượt kiểm soát", "ngoài tầm kiểm soát", "control chart",
    "điểm bất thường", "biểu đồ kiểm soát", "kσ",
  ],
  kind: "read",
  requiredPermission: { module: "analytics_spc", action: "canView" },
  summarize: (p, lang) =>
    lang === "en"
      ? `SPC out-of-control points (${p.days}d, ${p.sigma}σ)`
      : lang === "zh"
        ? `SPC 失控点（${p.days}天，${p.sigma}σ）`
        : `Điểm vượt kiểm soát SPC (${p.days} ngày, ${p.sigma}σ)`,
  handler: async (params) => {
    const lang = langOf(params);
    const { days, machineId, factoryCode, sigma, __authCtx } = params;
    const title = `SPC yield (${days} ngày, ${sigma}σ)`;
    const denied = await rbacGate<SpcStatusData | null>(__authCtx, "analytics_spc", "analytics_spc", title, null, lang);
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<SpcStatusData | null>("analytics_spc", title, null);

    const startDate = sinceDays(days);
    const endDate = new Date();
    let trend: Awaited<ReturnType<typeof getYieldTrendData>>;
    try {
      trend = await getYieldTrendData({ startDate, endDate, machineId, factoryCode, interval: "day" });
    } catch {
      return {
        type: "analytics_spc",
        title,
        data: { metric: "yieldRate", points: 0, mean: 0, stdDev: 0, ucl: 0, lcl: 0, outOfControl: [], anomalyCount: 0 },
        textSummary: `Không truy vấn được dữ liệu SPC trong ${days} ngày qua.`,
        note: "QUERY_ERROR",
      };
    }

    const values = trend.map((r) => r.yieldRate);
    if (values.length < 3) {
      return {
        type: "analytics_spc",
        title,
        data: { metric: "yieldRate", points: values.length, mean: 0, stdDev: 0, ucl: 0, lcl: 0, outOfControl: [], anomalyCount: 0 },
        textSummary: `Chưa đủ dữ liệu yield (${values.length} điểm) để đánh giá SPC trong ${days} ngày qua.`,
        note: "NOT_FOUND",
      };
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (values.length - 1);
    const stdDev = Math.sqrt(variance);
    const ucl = mean + sigma * stdDev;
    const lcl = mean - sigma * stdDev;
    const outOfControl = values
      .map((v, index) => ({ index, value: round2(v), score: stdDev > 0 ? round2((v - mean) / stdDev) : 0 }))
      .filter((p) => p.value > ucl || p.value < lcl);

    const data: SpcStatusData = {
      metric: "yieldRate",
      points: values.length,
      mean: round2(mean),
      stdDev: round2(stdDev),
      ucl: round2(ucl),
      lcl: round2(lcl),
      outOfControl,
      anomalyCount: outOfControl.length,
    };
    return {
      type: "analytics_spc",
      title,
      data,
      textSummary:
        `SPC yield (${days} ngày, ${values.length} điểm): TB=${data.mean}%, σ=${data.stdDev}, ` +
        `UCL=${data.ucl}% / LCL=${data.lcl}% (${sigma}σ). ` +
        (outOfControl.length > 0
          ? `${outOfControl.length} điểm VƯỢT KIỂM SOÁT.`
          : "Không có điểm vượt kiểm soát — quá trình ổn định."),
    };
  },
};

// ── 6. analytics_pdm_forecast ─────────────────────────────────────────────────

interface PdmForecastData {
  machineId: number;
  failureRisk: number; // 0-100
  confidenceScore: number; // 0-100
  maintenanceUrgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  predictedTimeframe: string | null;
  recommendedMaintenanceDate: string | null;
  topFactors: Array<{ name: string; contribution: number; description: string }>;
  thresholdBreach: boolean;
}

const pdmParams = z
  .object({
    machineId: z.number().int().positive().optional(),
    machineCode: z.string().min(1).max(50).optional(),
    windowHours: z.number().int().min(24).max(24 * 90).optional(),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict()
  .refine((v) => !!(v.machineId || v.machineCode), { message: "Cần machineId hoặc machineCode" });

const RISK_ALERT = Number(process.env.PM_RISK_THRESHOLD ?? 60);

const analyticsPdmForecast: Tool<z.infer<typeof pdmParams>, PdmForecastData | null> = {
  name: "analytics_pdm_forecast",
  description:
    "Dự báo rủi ro hỏng máy (predictive maintenance): risk%, độ tin cậy, khung thời gian, các yếu tố rủi ro. READ-ONLY, RBAC analytics_predictive_alerts.",
  parameters: pdmParams,
  triggers: [
    "dự báo hỏng", "rủi ro hỏng", "bảo trì dự đoán", "predictive maintenance", "pdm",
    "máy sắp hỏng", "failure risk", "sức khỏe máy", "machine health",
  ],
  kind: "read",
  requiredPermission: { module: "analytics_predictive_alerts", action: "canView" },
  summarize: (p, lang) =>
    lang === "en"
      ? `Predict failure risk for ${p.machineCode ?? `machine #${p.machineId}`}`
      : lang === "zh"
        ? `预测设备故障风险：${p.machineCode ?? `设备 #${p.machineId}`}`
        : `Dự báo rủi ro hỏng ${p.machineCode ?? `máy #${p.machineId}`}`,
  handler: async (params) => {
    const lang = langOf(params);
    const { machineId, machineCode, windowHours, __authCtx } = params;
    const title = `Dự báo hỏng ${machineCode ?? `máy #${machineId}`}`;
    const denied = await rbacGate<PdmForecastData | null>(
      __authCtx, "analytics_predictive_alerts", "analytics_pdm_forecast", title, null, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<PdmForecastData | null>("analytics_pdm_forecast", title, null);

    let resolvedId = machineId ?? null;
    if (resolvedId == null && machineCode) {
      resolvedId = await resolveMachineId(db, machineCode);
      if (resolvedId == null) {
        return {
          type: "analytics_pdm_forecast",
          title,
          data: null,
          textSummary: `Không tìm thấy máy "${machineCode}".`,
          note: "NOT_FOUND",
        };
      }
    }
    if (resolvedId == null) return noDbResult<PdmForecastData | null>("analytics_pdm_forecast", title, null);

    let risk: Awaited<ReturnType<typeof computeFailureRisk>>;
    try {
      risk = windowHours ? await computeFailureRisk(resolvedId, windowHours) : await computeFailureRisk(resolvedId);
    } catch {
      return {
        type: "analytics_pdm_forecast",
        title,
        data: null,
        textSummary: `Không tính được rủi ro hỏng cho ${machineCode ?? `máy #${resolvedId}`}.`,
        note: "QUERY_ERROR",
      };
    }

    const thresholdBreach = risk.failureRisk >= RISK_ALERT;
    const data: PdmForecastData = {
      machineId: resolvedId,
      failureRisk: risk.failureRisk,
      confidenceScore: risk.confidenceScore,
      maintenanceUrgency: risk.maintenanceUrgency,
      predictedTimeframe: risk.predictedTimeframe,
      recommendedMaintenanceDate: risk.recommendedMaintenanceDate
        ? risk.recommendedMaintenanceDate.toISOString()
        : null,
      topFactors: risk.factors
        .slice()
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 3)
        .map((f) => ({ name: f.name, contribution: f.contribution, description: f.description })),
      thresholdBreach,
    };

    const scope = machineCode ?? `máy #${resolvedId}`;
    if (risk.dataPoints === 0 && risk.confidenceScore === 0) {
      return {
        type: "analytics_pdm_forecast",
        title,
        data,
        textSummary: `Chưa đủ dữ liệu sức khỏe/heartbeat cho ${scope} để dự báo rủi ro hỏng.`,
        note: "NOT_FOUND",
      };
    }
    const factorVi = data.topFactors.map((f) => `${f.name}=${f.contribution}`).join(", ");
    return {
      type: "analytics_pdm_forecast",
      title,
      data,
      textSummary:
        `Rủi ro hỏng ${scope}: ${risk.failureRisk}% (độ tin cậy ${risk.confidenceScore}%, mức ${risk.maintenanceUrgency}). ` +
        (risk.predictedTimeframe ? `Dự báo: ${risk.predictedTimeframe}. ` : "") +
        (thresholdBreach ? `VƯỢT NGƯỠNG cảnh báo ${RISK_ALERT}%. ` : `Dưới ngưỡng cảnh báo ${RISK_ALERT}%. `) +
        (factorVi ? `Yếu tố chính: ${factorVi}.` : ""),
    };
  },
};

// ── 7. analytics_forecast_series ──────────────────────────────────────────────

interface ForecastSeriesData {
  metric: "yield" | "throughput";
  algorithm: "ewma" | "holt_winters";
  history: number;
  horizon: number;
  trend: "increasing" | "decreasing" | "stable";
  lastValue: number | null;
  forecast: Array<{ step: number; predicted: number; lower: number; upper: number }>;
  thresholdBreach: { threshold: number; firstBreachStep: number | null } | null;
}

const forecastParams = z
  .object({
    metric: z.enum(["yield", "throughput"]).optional().default("yield"),
    days: z.number().int().min(3).max(180).optional().default(30),
    horizon: z.number().int().min(1).max(30).optional().default(7),
    algorithm: z.enum(["ewma", "holt_winters"]).optional().default("ewma"),
    machineId: z.number().int().positive().optional(),
    factoryCode: z.string().min(1).max(50).optional(),
    threshold: z.number().optional(),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const analyticsForecastSeries: Tool<z.infer<typeof forecastParams>, ForecastSeriesData | null> = {
  name: "analytics_forecast_series",
  description:
    "Dự báo time-series (yield hoặc throughput) bằng Holt-Winters/EWMA, kèm khoảng tin cậy + cảnh báo vượt ngưỡng. READ-ONLY, RBAC analytics_oee.",
  parameters: forecastParams,
  triggers: [
    "dự báo yield", "dự báo sản lượng", "dự báo throughput", "forecast yield",
    "forecast throughput", "dự đoán yield", "dự báo xu hướng", "predict yield",
  ],
  kind: "read",
  requiredPermission: { module: "analytics_oee", action: "canView" },
  summarize: (p, lang) =>
    lang === "en"
      ? `Forecast ${p.metric} (${p.horizon} steps, ${p.algorithm})`
      : lang === "zh"
        ? `预测 ${p.metric}（${p.horizon} 步，${p.algorithm}）`
        : `Dự báo ${p.metric} (${p.horizon} bước, ${p.algorithm})`,
  handler: async (params) => {
    const lang = langOf(params);
    const { metric, days, horizon, algorithm, machineId, factoryCode, threshold, __authCtx } = params;
    const title = `Dự báo ${metric} (${horizon} bước)`;
    const denied = await rbacGate<ForecastSeriesData | null>(__authCtx, "analytics_oee", "analytics_forecast", title, null, lang);
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<ForecastSeriesData | null>("analytics_forecast", title, null);

    const startDate = sinceDays(days);
    const endDate = new Date();
    let trend: Awaited<ReturnType<typeof getYieldTrendData>>;
    try {
      trend = await getYieldTrendData({ startDate, endDate, machineId, factoryCode, interval: "day" });
    } catch {
      return {
        type: "analytics_forecast",
        title,
        data: null,
        textSummary: `Không truy vấn được dữ liệu lịch sử để dự báo ${metric}.`,
        note: "QUERY_ERROR",
      };
    }

    // metric → value: yield = yieldRate; throughput = totalCount.
    const pts: TimeSeriesPoint[] = trend.map((r, i) => ({
      timestamp: i,
      value: metric === "throughput" ? r.totalCount : r.yieldRate,
    }));
    if (pts.length < 3) {
      return {
        type: "analytics_forecast",
        title,
        data: null,
        textSummary: `Chưa đủ dữ liệu (${pts.length} điểm) để dự báo ${metric} trong ${days} ngày qua.`,
        note: "NOT_FOUND",
      };
    }

    const analysis = analyzeTimeSeries(pts, { algorithm, horizon });
    const fc: ForecastPoint[] = analysis.forecast.length
      ? analysis.forecast
      : forecastWithConfidenceInterval(pts, horizon, algorithm);
    const forecast = fc.map((f, i) => ({
      step: i + 1,
      predicted: round2(f.predicted),
      lower: round2(f.lower),
      upper: round2(f.upper),
    }));

    // Threshold breach interpretation (for the deep model to narrate).
    let thresholdBreach: ForecastSeriesData["thresholdBreach"] = null;
    if (threshold != null) {
      // yield: breach when forecast drops BELOW threshold; throughput: same direction.
      const firstBreach = forecast.find((f) => f.predicted < threshold);
      thresholdBreach = { threshold, firstBreachStep: firstBreach ? firstBreach.step : null };
    }

    const data: ForecastSeriesData = {
      metric,
      algorithm,
      history: pts.length,
      horizon,
      trend: analysis.summary.trendDirection,
      lastValue: pts.length ? round2(pts[pts.length - 1].value) : null,
      forecast,
      thresholdBreach,
    };

    const trendVi =
      analysis.summary.trendDirection === "increasing"
        ? "TĂNG"
        : analysis.summary.trendDirection === "decreasing"
          ? "GIẢM"
          : "ỔN ĐỊNH";
    const nextVal = forecast[0]?.predicted ?? null;
    const breachTxt =
      thresholdBreach && thresholdBreach.firstBreachStep != null
        ? ` CẢNH BÁO: dự báo vượt ngưỡng ${threshold} ở bước +${thresholdBreach.firstBreachStep}.`
        : thresholdBreach
          ? ` Không vượt ngưỡng ${threshold} trong ${horizon} bước.`
          : "";
    return {
      type: "analytics_forecast",
      title,
      data,
      textSummary:
        `Dự báo ${metric} (${algorithm}, ${pts.length} điểm lịch sử → ${horizon} bước): xu hướng ${trendVi}, ` +
        (nextVal != null ? `điểm kế tiếp ≈ ${nextVal} ` : "") +
        (forecast[0] ? `(khoảng tin cậy ${forecast[0].lower}–${forecast[0].upper}).` : ".") +
        breachTxt,
    };
  },
};

// ─── register ──────────────────────────────────────────────────────────────

let _registeredAnalytics = false;
export function registerAnalyticsTools(): void {
  if (_registeredAnalytics) return;
  _registeredAnalytics = true;
  registerTool(analyticsQueryOee);
  registerTool(analyticsDefectPareto);
  registerTool(analyticsDefectHeatmapSummary);
  registerTool(analyticsQueryYield);
  registerTool(analyticsSpcStatus);
  registerTool(analyticsPdmForecast);
  registerTool(analyticsForecastSeries);
}

registerAnalyticsTools();

export {
  analyticsQueryOee,
  analyticsDefectPareto,
  analyticsDefectHeatmapSummary,
  analyticsQueryYield,
  analyticsSpcStatus,
  analyticsPdmForecast,
  analyticsForecastSeries,
};
