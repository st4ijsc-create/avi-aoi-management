/**
 * AI Local Tools — Sprint F6 Insight Handlers (READ-ONLY, text-only).
 *
 * Two cross-station INSIGHT tools that combine reads + light analytics and
 * return a Vietnamese narrative plus a plain-text "Đề xuất bước tiếp theo" that
 * POINTS AT the existing HITL write-tools (F4/GĐ2). They DO NOT execute any
 * action and — by design — DO NOT import commandDispatcher / proposeAction /
 * writeTags. Anything actionable is words only; the user must go through the
 * existing HITL confirm flow.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ G3-A — "CHỈ PHÂN TÍCH, KHÔNG GHI" **KHÔNG** CÓ NGHĨA LÀ "KHÔNG CẦN QUYỀN".
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai tool ở đây không ghi gì thật, nhưng chúng **ĐỌC** — và đầu ra của chúng (nút thắt chuyền,
 * tương quan thông số ↔ chất lượng) là **chính thứ** hai màn phân tích của hệ đang đứng sau cổng.
 * Trước đợt này chúng không có cổng nào ⇒ ai đăng nhập cũng hỏi được.
 *
 *   analyze_line_bottleneck  → `analytics_oee`      — cùng nguồn `getLineBalanceSeries` với
 *       `get_line_balance`; hai màn bày nó (`/wip-dashboard`, `/mes-control-tower`) đều khai
 *       `analytics_oee`. Để tool này lỏng hơn `get_line_balance` là mở cửa sau cho chính nó.
 *   correlate_process_quality → `analytics_advanced` — `/correlation-analysis` (và
 *       `/data-comparison`, `/comparison-studio`) khai đúng bit này; mô tả module là
 *       "Phân tích Nâng cao — Truy cập SPC, phân tích xu hướng, v.v.".
 *
 * Self-registers on import (see index.ts → `import "./insightHandlersF6"`).
 */

import { z } from "zod";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { processResults, machines } from "../../../drizzle/schema";
import { getLineBalanceSeries, resolveLineIdByCode } from "../../db/lineBalance";
import { analyzeTimeSeries, forecastWithConfidenceInterval, type TimeSeriesPoint } from "../aiTimeSeriesEngine";
import { pearsonCorrelation } from "../../utils/statistics";
import { registerTool, type Tool, type ToolPermission, type ToolResult } from "./toolRegistry";
import { authCtxParam, rbacGate } from "./readToolRbac";

/** G3-A — MỘT hằng cho mỗi tool, dùng ở CẢ `requiredPermission` LẪN `rbacGate`. */
const PERM_BOTTLENECK: ToolPermission = { module: "analytics_oee", action: "canView" };
const PERM_CORRELATION: ToolPermission = { module: "analytics_advanced", action: "canView" };

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
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function noDbResult<T>(type: ToolResult["type"], title: string, fallback: T): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: "Không có kết nối CSDL — không thể phân tích dữ liệu thời gian thực.",
    note: "DB_UNAVAILABLE",
  };
}

// ── 1. analyze_line_bottleneck ───────────────────────────────────────────────

interface BottleneckData {
  lineId: number;
  points: number;
  cycleTrend: "increasing" | "decreasing" | "stable";
  wipTrend: "increasing" | "decreasing" | "stable";
  latestMaxCycleMs: number | null;
  taktTimeMs: number | null;
  forecastMaxCycleMs: number | null;
  taktBreachForecast: boolean;
}

const bottleneckParams = z
  .object({
    lineCode: z.string().min(1).max(50).optional(),
    lineId: z.number().int().positive().optional(),
    days: z.number().int().min(2).max(30).optional().default(7),
    __authCtx: authCtxParam,
  })
  .strict()
  .refine((v) => !!(v.lineCode || v.lineId), { message: "Cần lineCode hoặc lineId" });

const analyzeLineBottleneck: Tool<z.infer<typeof bottleneckParams>, BottleneckData | null> = {
  name: "analyze_line_bottleneck",
  description:
    "Phân tích xu hướng nút thắt chuyền: cycle time/WIP tăng dần và dự báo vượt takt. Chỉ trả phân tích + đề xuất (không tự thực thi).",
  parameters: bottleneckParams,
  triggers: [
    "phân tích nút thắt", "dự báo nghẽn", "sẽ nghẽn", "nút thắt dự báo", "xu hướng nút thắt",
    "dự báo nút thắt", "bottleneck forecast",
  ],
  kind: "read",
  requiredPermission: PERM_BOTTLENECK,
  handler: async ({ lineCode, lineId, days, __authCtx }) => {
    const denied = await rbacGate<BottleneckData | null>(
      __authCtx, PERM_BOTTLENECK, "line_insight", "Phân tích nút thắt", null,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<BottleneckData | null>("line_insight", "Phân tích nút thắt", null);

    let resolvedLineId = lineId;
    if (resolvedLineId == null && lineCode) {
      const id = await resolveLineIdByCode(lineCode);
      if (id == null) {
        return {
          type: "line_insight",
          title: `Nút thắt chuyền ${lineCode}`,
          data: null,
          textSummary: `Không tìm thấy chuyền "${lineCode}".`,
          note: "NOT_FOUND",
        };
      }
      resolvedLineId = id;
    }
    if (resolvedLineId == null) return noDbResult<BottleneckData | null>("line_insight", "Phân tích nút thắt", null);

    const since = sinceDays(days);
    const series = await getLineBalanceSeries(resolvedLineId, since);
    const label = lineCode ? `chuyền ${lineCode}` : `chuyền #${resolvedLineId}`;
    const title = `Phân tích nút thắt ${label}`;

    if (series.length < 2) {
      return {
        type: "line_insight",
        title,
        data: null,
        textSummary: `Chưa đủ dữ liệu cân bằng cho ${label} trong ${days} ngày qua để phân tích xu hướng.`,
        note: "NOT_FOUND",
      };
    }

    const cyclePts: TimeSeriesPoint[] = series
      .filter((r) => r.maxCycleTimeMs != null)
      .map((r) => ({ timestamp: new Date(r.periodStart).getTime(), value: r.maxCycleTimeMs as number }));
    const wipPts: TimeSeriesPoint[] = series.map((r) => ({
      timestamp: new Date(r.periodStart).getTime(),
      value: r.wipCount,
    }));

    const cycleAnalysis = cyclePts.length >= 2 ? analyzeTimeSeries(cyclePts, { algorithm: "ewma", horizon: 3 }) : null;
    const wipAnalysis = analyzeTimeSeries(wipPts, { algorithm: "ewma", horizon: 1 });

    const latest = series[series.length - 1];
    const takt = latest.taktTimeMs;
    const forecast = cyclePts.length >= 2 ? forecastWithConfidenceInterval(cyclePts, 3, "ewma") : [];
    const forecastMax = forecast.length ? round2(Math.max(...forecast.map((f) => f.predicted))) : null;
    const taktBreachForecast = takt != null && forecastMax != null && forecastMax > takt;

    const cycleTrend = cycleAnalysis?.summary.trendDirection ?? "stable";
    const wipTrend = wipAnalysis.summary.trendDirection;

    const data: BottleneckData = {
      lineId: resolvedLineId,
      points: series.length,
      cycleTrend,
      wipTrend,
      latestMaxCycleMs: latest.maxCycleTimeMs,
      taktTimeMs: takt,
      forecastMaxCycleMs: forecastMax,
      taktBreachForecast,
    };

    const trendVi = (t: string) => (t === "increasing" ? "đang TĂNG" : t === "decreasing" ? "đang GIẢM" : "ỔN ĐỊNH");
    const bnStation = latest.bottleneckStationId != null ? `trạm #${latest.bottleneckStationId}` : "chưa xác định trạm";

    const hienTrang =
      `[Hiện trạng] ${label}: cycle max mới nhất=${latest.maxCycleTimeMs ?? "?"}ms (takt=${takt ?? "?"}ms), ` +
      `WIP=${latest.wipCount}. Cycle max ${trendVi(cycleTrend)}, WIP ${trendVi(wipTrend)}. Nút thắt: ${bnStation}.`;
    const duBao = taktBreachForecast
      ? `[Dự báo] Cycle max dự báo ≈ ${forecastMax}ms sẽ VƯỢT takt ${takt}ms trong các chu kỳ tới → nguy cơ nghẽn chuyền.`
      : forecastMax != null
        ? `[Dự báo] Cycle max dự báo ≈ ${forecastMax}ms, vẫn trong ngưỡng takt ${takt ?? "?"}ms.`
        : `[Dự báo] Chưa đủ dữ liệu cycle để dự báo.`;
    const deXuat =
      `[ĐỀ XUẤT] Nếu cần can thiệp, hãy dùng quy trình HITL sẵn có (cần xác nhận của người vận hành): ` +
      `ví dụ "tạm dừng máy ${bnStation === "chưa xác định trạm" ? "X" : "tại " + bnStation}" hoặc điều chỉnh nhịp qua write-tool điều khiển máy. ` +
      `Công cụ này CHỈ phân tích — không tự thực thi bất kỳ hành động nào.`;

    return {
      type: "line_insight",
      title,
      data,
      textSummary: [hienTrang, duBao, deXuat].join("\n"),
    };
  },
};

// ── 2. correlate_process_quality ─────────────────────────────────────────────

interface CorrelationData {
  upstreamStepType: string;
  downstreamStepType: string | null;
  metricKey: string;
  paired: number;
  pearson: number | null;
  failBins: Array<{ range: string; count: number; fail: number; failRate: number }>;
}

const correlationParams = z
  .object({
    upstreamStepType: z.string().min(1).max(64),
    metricKey: z.string().min(1).max(64),
    downstreamStepType: z.string().min(1).max(64).optional(),
    days: z.number().int().min(1).max(30).optional().default(7),
    machineCode: z.string().min(1).max(50).optional(),
    __authCtx: authCtxParam,
  })
  .strict();

const correlateProcessQuality: Tool<z.infer<typeof correlationParams>, CorrelationData | null> = {
  name: "correlate_process_quality",
  description:
    "Tương quan giữa chỉ số đo công đoạn thượng nguồn (vd torque) với kết quả lỗi công đoạn hạ nguồn theo serial. Chỉ phân tích + đề xuất.",
  parameters: correlationParams,
  triggers: [
    "tương quan", "ảnh hưởng đến ng", "liên quan đến lỗi", "ảnh hưởng tới ng",
    "correlation", "tác động đến lỗi", "có gây lỗi", "ảnh hưởng chất lượng",
  ],
  kind: "read",
  requiredPermission: PERM_CORRELATION,
  handler: async ({ upstreamStepType, metricKey, downstreamStepType, days, machineCode, __authCtx }) => {
    const denied = await rbacGate<CorrelationData | null>(
      __authCtx, PERM_CORRELATION, "correlation_insight", "Tương quan chất lượng", null,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<CorrelationData | null>("correlation_insight", "Tương quan chất lượng", null);

    const since = sinceDays(days);

    let machineId: number | undefined;
    if (machineCode) {
      const rows = await db
        .select({ id: machines.id })
        .from(machines)
        .where(eq(machines.code, machineCode))
        .limit(1);
      if (!rows[0]) {
        return {
          type: "correlation_insight",
          title: `Tương quan ${metricKey}`,
          data: null,
          textSummary: `Không tìm thấy máy "${machineCode}".`,
          note: "NOT_FOUND",
        };
      }
      machineId = rows[0].id;
    }

    // Upstream rows: serial → metric numeric value (latest per serial).
    const upConds = [eq(processResults.stepType, upstreamStepType), gte(processResults.measuredAt, since)];
    if (machineId != null) upConds.push(eq(processResults.machineId, machineId));
    const upRows = await db
      .select({ serialNumber: processResults.serialNumber, metrics: processResults.metrics, result: processResults.result })
      .from(processResults)
      .where(and(...upConds))
      .orderBy(asc(processResults.measuredAt));

    const upBySerial = new Map<string, number>();
    for (const r of upRows) {
      const m = r.metrics as Record<string, unknown> | null;
      const raw = m ? m[metricKey] : undefined;
      const val = typeof raw === "number" ? raw : typeof raw === "string" && /^-?[0-9.]+$/.test(raw) ? Number(raw) : null;
      if (val != null && Number.isFinite(val)) upBySerial.set(r.serialNumber, val);
    }

    // Downstream rows: serial → fail flag (1 if any fail in downstream step).
    const downConds = [gte(processResults.measuredAt, since)];
    if (downstreamStepType) downConds.push(eq(processResults.stepType, downstreamStepType));
    const downRows = await db
      .select({ serialNumber: processResults.serialNumber, result: processResults.result, stepType: processResults.stepType })
      .from(processResults)
      .where(and(...downConds));

    const downFailBySerial = new Map<string, number>();
    for (const r of downRows) {
      if (downstreamStepType && r.stepType === upstreamStepType) continue;
      if (!downstreamStepType && r.stepType === upstreamStepType) continue; // exclude upstream itself
      const prev = downFailBySerial.get(r.serialNumber) ?? 0;
      downFailBySerial.set(r.serialNumber, prev === 1 ? 1 : String(r.result) === "fail" ? 1 : 0);
    }

    // Pair them by serial.
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [serial, metricVal] of upBySerial) {
      const fail = downFailBySerial.get(serial);
      if (fail == null) continue;
      xs.push(metricVal);
      ys.push(fail);
    }

    const label = `${upstreamStepType}.${metricKey} → lỗi ${downstreamStepType ?? "hạ nguồn"}`;
    const title = `Tương quan ${label}`;
    if (xs.length < 3) {
      return {
        type: "correlation_insight",
        title,
        data: {
          upstreamStepType,
          downstreamStepType: downstreamStepType ?? null,
          metricKey,
          paired: xs.length,
          pearson: null,
          failBins: [],
        },
        textSummary:
          `Chưa đủ dữ liệu ghép cặp theo serial (${xs.length} cặp) để tính tương quan ${label} trong ${days} ngày qua.`,
        note: "NOT_FOUND",
      };
    }

    const r = round2(pearsonCorrelation(xs, ys));

    // Bin the metric into 3 ranges and compute fail-rate per bin.
    const minV = Math.min(...xs);
    const maxV = Math.max(...xs);
    const span = maxV - minV || 1;
    const bins = [
      { lo: minV, hi: minV + span / 3, count: 0, fail: 0 },
      { lo: minV + span / 3, hi: minV + (2 * span) / 3, count: 0, fail: 0 },
      { lo: minV + (2 * span) / 3, hi: maxV + 1e-9, count: 0, fail: 0 },
    ];
    for (let i = 0; i < xs.length; i++) {
      const v = xs[i];
      const b = bins.find((bb) => v >= bb.lo && v < bb.hi) ?? bins[bins.length - 1];
      b.count++;
      if (ys[i] === 1) b.fail++;
    }
    const failBins = bins.map((b) => ({
      range: `${round2(b.lo)}–${round2(b.hi)}`,
      count: b.count,
      fail: b.fail,
      failRate: b.count ? round2((b.fail / b.count) * 100) : 0,
    }));

    const data: CorrelationData = {
      upstreamStepType,
      downstreamStepType: downstreamStepType ?? null,
      metricKey,
      paired: xs.length,
      pearson: r,
      failBins,
    };

    const strength = Math.abs(r) >= 0.7 ? "MẠNH" : Math.abs(r) >= 0.4 ? "TRUNG BÌNH" : "YẾU";
    const dir = r > 0 ? "thuận (giá trị cao → lỗi nhiều hơn)" : r < 0 ? "nghịch (giá trị cao → lỗi ít hơn)" : "không rõ";
    const binSummary = failBins.map((b) => `[${b.range}] fail ${b.failRate}% (${b.fail}/${b.count})`).join("; ");
    const deXuat =
      `[ĐỀ XUẤT] Nếu tương quan đáng kể, cân nhắc dùng các write-tool HITL sẵn có (cần xác nhận): ` +
      `'set_spec_limits' để siết USL/LSL cho ${metricKey}, hoặc 'select_recipe' để đổi recipe phù hợp. ` +
      `Công cụ này CHỈ phân tích — không tự thực thi.`;

    return {
      type: "correlation_insight",
      title,
      data,
      textSummary:
        `[Hiện trạng] Ghép ${xs.length} cặp serial cho ${label}. Hệ số tương quan Pearson r=${r} ` +
        `(${strength}, tương quan ${dir}).\n` +
        `[Phân bố lỗi theo dải ${metricKey}] ${binSummary}.\n` +
        deXuat,
    };
  },
};

// ── register ──────────────────────────────────────────────────────────────

let _registeredInsightF6 = false;
export function registerInsightF6Tools(): void {
  if (_registeredInsightF6) return;
  _registeredInsightF6 = true;
  registerTool(analyzeLineBottleneck);
  registerTool(correlateProcessQuality);
}

registerInsightF6Tools();

export { analyzeLineBottleneck, correlateProcessQuality };
