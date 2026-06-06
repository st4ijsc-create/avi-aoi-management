/**
 * AI Local Tools — Sprint F6 Handlers (line-monitoring READ-ONLY tools).
 *
 * Six read-only tools that give the assistant cross-station visibility over a
 * generic factory line (process results, metric trends, line balance,
 * packaging throughput, palletizer status, OT telemetry). They follow the same
 * KHUÔN as handlers.ts: zod `.strict()` params, a `getDb()` guard returning
 * `noDbResult`, Drizzle queries (delegated to db/* helpers), and a Vietnamese
 * `textSummary`. Every tool here is `kind: 'read'` — NO preview/execute/
 * requiredPermission. Any actionable suggestion is plain text pointing at the
 * existing HITL write-tools (F4/GĐ2); nothing is executed here.
 *
 * Self-registers on import (see index.ts → `import "./handlersF6"`).
 */

import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { machines, processResults } from "../../../drizzle/schema";
import {
  listProcessResultsByMachine,
  aggregateProcessResultStats,
  getProcessMetricSeries,
  type ProcessResultRow,
} from "../../db/processResult";
import { getLatestTelemetry, getTelemetrySeries } from "../../db/otTelemetry";
import {
  getLatestLineBalance,
  getStationDwellAgg,
  resolveLineIdByCode,
} from "../../db/lineBalance";
import { analyzeTimeSeries, type TimeSeriesPoint } from "../aiTimeSeriesEngine";
import { registerTool, type Tool, type ToolResult } from "./toolRegistry";

// ── shared helpers ──────────────────────────────────────────────────────────

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

function pct(num: number, total: number): number {
  if (!total) return 0;
  return Math.round((num / total) * 10000) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function noDbResult<T>(type: ToolResult["type"], title: string, fallback: T): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: "Không có kết nối CSDL — không thể truy vấn dữ liệu thời gian thực.",
    note: "DB_UNAVAILABLE",
  };
}

function notFoundMachine<T>(type: ToolResult["type"], machineCode: string, fallback: T): ToolResult<T> {
  return {
    type,
    title: `Máy ${machineCode}`,
    data: fallback,
    textSummary: `Không tìm thấy máy "${machineCode}".`,
    note: "NOT_FOUND",
  };
}

/** Resolve machines.code → { id, machineType }. Returns null when not found. */
async function resolveMachine(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  machineCode: string,
): Promise<{ id: number; machineType: string | null } | null> {
  const rows = await db
    .select({ id: machines.id, machineType: machines.machineType })
    .from(machines)
    .where(eq(machines.code, machineCode))
    .limit(1);
  const r = rows[0];
  return r ? { id: r.id, machineType: r.machineType == null ? null : String(r.machineType) } : null;
}

// ── 1. get_machine_process_result ────────────────────────────────────────────

interface ProcessResultData {
  rows: Array<{
    serialNumber: string;
    machineId: number;
    stepType: string;
    result: string;
    measuredAt: string;
    metrics: Record<string, unknown> | null;
  }>;
  summary: { pass: number; fail: number; warn: number; skip: number; failRate: number };
}

const processResultParams = z
  .object({
    serialNumber: z.string().min(1).max(128).optional(),
    machineCode: z.string().min(1).max(50).optional(),
    stepType: z.string().min(1).max(64).optional(),
    days: z.number().int().min(1).max(30).optional().default(1),
    limit: z.number().int().min(1).max(50).optional().default(20),
  })
  .strict()
  .refine((v) => !!(v.serialNumber || v.machineCode || v.stepType), {
    message: "Cần ít nhất một trong: serialNumber / machineCode / stepType",
  });

const getMachineProcessResult: Tool<z.infer<typeof processResultParams>, ProcessResultData> = {
  name: "get_machine_process_result",
  description:
    "Kết quả công đoạn (pass/fail/warn/skip) của một máy/serial/loại công đoạn trong N ngày, kèm tỉ lệ fail.",
  parameters: processResultParams,
  triggers: [
    "kết quả công đoạn", "process result", "pass fail", "kết quả máy",
    "công đoạn của", "fail rate công đoạn", "tỉ lệ fail công đoạn",
  ],
  handler: async ({ serialNumber, machineCode, stepType, days, limit }) => {
    const empty: ProcessResultData = {
      rows: [],
      summary: { pass: 0, fail: 0, warn: 0, skip: 0, failRate: 0 },
    };
    const db = await getDb();
    if (!db) return noDbResult<ProcessResultData>("process_result", "Kết quả công đoạn", empty);

    const since = sinceDays(days);
    let machineId: number | undefined;
    if (machineCode) {
      const m = await resolveMachine(db, machineCode);
      if (!m) return notFoundMachine<ProcessResultData>("process_result", machineCode, empty);
      machineId = m.id;
    }

    let rows: ProcessResultRow[];
    if (machineId != null) {
      rows = await listProcessResultsByMachine({ machineId, stepType, since, limit });
    } else {
      // serial/step-only path — direct query (no machine resolution needed).
      const conds = [gte(processResults.measuredAt, since)];
      if (serialNumber) conds.push(eq(processResults.serialNumber, serialNumber));
      if (stepType) conds.push(eq(processResults.stepType, stepType));
      rows = (await db
        .select()
        .from(processResults)
        .where(and(...conds))
        .orderBy(desc(processResults.measuredAt))
        .limit(limit)) as ProcessResultRow[];
    }

    const stats = await aggregateProcessResultStats({ machineId, serialNumber, stepType, since });
    const totalEval = stats.pass + stats.fail + stats.warn;
    const failRate = pct(stats.fail, totalEval);

    const data: ProcessResultData = {
      rows: rows.map((r) => ({
        serialNumber: r.serialNumber,
        machineId: r.machineId,
        stepType: r.stepType,
        result: String(r.result),
        measuredAt: r.measuredAt ? new Date(r.measuredAt).toISOString() : "",
        metrics: (r.metrics as Record<string, unknown> | null) ?? null,
      })),
      summary: { ...stats, failRate },
    };

    const scope =
      machineCode ? `máy ${machineCode}` : serialNumber ? `serial ${serialNumber}` : `công đoạn ${stepType}`;
    const title = `Kết quả công đoạn ${scope}`;
    if (totalEval + stats.skip === 0) {
      return {
        type: "process_result",
        title,
        data,
        textSummary: `Chưa có kết quả công đoạn cho ${scope} trong ${days} ngày qua.`,
        note: "NOT_FOUND",
      };
    }
    return {
      type: "process_result",
      title,
      data,
      textSummary:
        `Kết quả công đoạn ${scope} (${days} ngày): pass=${stats.pass}, fail=${stats.fail}, ` +
        `warn=${stats.warn}, skip=${stats.skip}; tỉ lệ fail=${failRate}%. ` +
        `Hiển thị ${data.rows.length} bản ghi gần nhất.`,
    };
  },
};

// ── 2. get_process_metric_trend ──────────────────────────────────────────────

interface MetricTrendData {
  metricKey: string;
  source: "process" | "telemetry";
  bucket: "hour" | "day";
  series: Array<{ ts: number; value: number }>;
  trend: "increasing" | "decreasing" | "stable";
  mean: number;
  anomalyCount: number;
  forecastNext: number | null;
}

const metricTrendParams = z
  .object({
    machineCode: z.string().min(1).max(50).optional(),
    stepType: z.string().min(1).max(64).optional(),
    metricKey: z.string().min(1).max(64),
    tagKey: z.string().min(1).max(128).optional(),
    source: z.enum(["process", "telemetry"]).optional().default("process"),
    days: z.number().int().min(1).max(30).optional().default(7),
    bucket: z.enum(["hour", "day"]).optional().default("hour"),
  })
  .strict();

const getProcessMetricTrend: Tool<z.infer<typeof metricTrendParams>, MetricTrendData> = {
  name: "get_process_metric_trend",
  description:
    "Xu hướng một chỉ số đo (torque, lượng keo, cycle time…) theo giờ/ngày, kèm phát hiện bất thường và dự báo (EWMA).",
  parameters: metricTrendParams,
  triggers: [
    "xu hướng chỉ số", "trend chỉ số", "metric trend", "xu hướng đo",
    "lực siết", "mô-men", "torque", "lượng keo", "dispense", "cycle time", "thời gian chu kỳ",
  ],
  handler: async ({ machineCode, stepType, metricKey, tagKey, source, days, bucket }) => {
    const empty: MetricTrendData = {
      metricKey, source, bucket, series: [], trend: "stable", mean: 0, anomalyCount: 0, forecastNext: null,
    };
    const db = await getDb();
    if (!db) return noDbResult<MetricTrendData>("process_metric_trend", `Xu hướng ${metricKey}`, empty);

    const since = sinceDays(days);
    let machineId: number | undefined;
    if (machineCode) {
      const m = await resolveMachine(db, machineCode);
      if (!m) return notFoundMachine<MetricTrendData>("process_metric_trend", machineCode, empty);
      machineId = m.id;
    }

    let series: Array<{ ts: number; value: number }>;
    if (source === "telemetry") {
      if (machineId == null || !tagKey) {
        return {
          type: "process_metric_trend",
          title: `Xu hướng ${metricKey}`,
          data: empty,
          textSummary: "Nguồn telemetry cần cả machineCode và tagKey.",
          note: "MISSING_ARGS",
        };
      }
      series = await getTelemetrySeries({ machineId, tagKey, since });
    } else {
      const pts = await getProcessMetricSeries({ machineId, stepType, metricKey, since, bucket });
      series = pts.map((p) => ({ ts: p.ts, value: p.value }));
    }

    const scope = machineCode ? `máy ${machineCode}` : stepType ? `công đoạn ${stepType}` : "toàn line";
    const title = `Xu hướng ${metricKey} (${scope})`;
    if (series.length < 2) {
      return {
        type: "process_metric_trend",
        title,
        data: { ...empty, series },
        textSummary: `Chưa đủ dữ liệu ${metricKey} cho ${scope} trong ${days} ngày qua để phân tích xu hướng.`,
        note: "NOT_FOUND",
      };
    }

    const tsPoints: TimeSeriesPoint[] = series.map((p) => ({ timestamp: p.ts, value: p.value }));
    const analysis = analyzeTimeSeries(tsPoints, { algorithm: "ewma", horizon: 1 });
    const forecastNext = analysis.forecast[0] ? round2(analysis.forecast[0].predicted) : null;
    const trendVi =
      analysis.summary.trendDirection === "increasing"
        ? "TĂNG"
        : analysis.summary.trendDirection === "decreasing"
          ? "GIẢM"
          : "ỔN ĐỊNH";

    const data: MetricTrendData = {
      metricKey,
      source,
      bucket,
      series,
      trend: analysis.summary.trendDirection,
      mean: round2(analysis.summary.meanValue),
      anomalyCount: analysis.summary.anomalyCount,
      forecastNext,
    };

    return {
      type: "process_metric_trend",
      title,
      data,
      textSummary:
        `Xu hướng ${metricKey} ${scope} (${days} ngày, ${series.length} điểm theo ${bucket}): ` +
        `${trendVi} (TB=${data.mean}). Bất thường: ${analysis.summary.anomalyCount} điểm. ` +
        (forecastNext != null ? `Dự báo điểm kế tiếp ≈ ${forecastNext}.` : "Không dự báo được."),
    };
  },
};

// ── 3. get_line_balance ──────────────────────────────────────────────────────

interface LineBalanceData {
  lineId: number;
  periodStart: string | null;
  taktTimeMs: number | null;
  avgCycleTimeMs: number | null;
  maxCycleTimeMs: number | null;
  utilizationPct: number | null;
  balanceRatePct: number | null;
  wipCount: number;
  topStarved: { stationId: number; avgStarvedMs: number } | null;
  topBlocked: { stationId: number; avgBlockedMs: number } | null;
}

const lineBalanceParams = z
  .object({
    lineCode: z.string().min(1).max(50).optional(),
    lineId: z.number().int().positive().optional(),
    days: z.number().int().min(1).max(14).optional().default(1),
  })
  .strict()
  .refine((v) => !!(v.lineCode || v.lineId), { message: "Cần lineCode hoặc lineId" });

const getLineBalance: Tool<z.infer<typeof lineBalanceParams>, LineBalanceData | null> = {
  name: "get_line_balance",
  description: "Cân bằng chuyền mới nhất: takt/cycle time, hệ số cân bằng, trạm starved/blocked nặng nhất.",
  parameters: lineBalanceParams,
  triggers: [
    "cân bằng chuyền", "cân bằng line", "nút thắt", "bottleneck", "nghẽn",
    "line balance", "takt", "cycle time chuyền",
  ],
  handler: async ({ lineCode, lineId, days }) => {
    const db = await getDb();
    if (!db) return noDbResult<LineBalanceData | null>("line_balance", "Cân bằng chuyền", null);

    let resolvedLineId = lineId;
    if (resolvedLineId == null && lineCode) {
      const id = await resolveLineIdByCode(lineCode);
      if (id == null) {
        return {
          type: "line_balance",
          title: `Chuyền ${lineCode}`,
          data: null,
          textSummary: `Không tìm thấy chuyền "${lineCode}".`,
          note: "NOT_FOUND",
        };
      }
      resolvedLineId = id;
    }
    if (resolvedLineId == null) {
      return noDbResult<LineBalanceData | null>("line_balance", "Cân bằng chuyền", null);
    }

    const latest = await getLatestLineBalance(resolvedLineId);
    const since = sinceDays(days);
    const dwell = await getStationDwellAgg(resolvedLineId, since);
    const topStarved = [...dwell].sort((a, b) => b.avgStarvedMs - a.avgStarvedMs)[0] ?? null;
    const topBlocked = [...dwell].sort((a, b) => b.avgBlockedMs - a.avgBlockedMs)[0] ?? null;

    const label = lineCode ? `chuyền ${lineCode}` : `chuyền #${resolvedLineId}`;
    if (!latest) {
      return {
        type: "line_balance",
        title: `Cân bằng ${label}`,
        data: null,
        textSummary: `Chưa có dữ liệu cân bằng cho ${label}.`,
        note: "NOT_FOUND",
      };
    }

    const data: LineBalanceData = {
      lineId: resolvedLineId,
      periodStart: latest.periodStart || null,
      taktTimeMs: latest.taktTimeMs,
      avgCycleTimeMs: latest.avgCycleTimeMs,
      maxCycleTimeMs: latest.maxCycleTimeMs,
      utilizationPct: latest.utilizationPct,
      balanceRatePct: latest.balanceRatePct,
      wipCount: latest.wipCount,
      topStarved: topStarved ? { stationId: topStarved.stationId, avgStarvedMs: topStarved.avgStarvedMs } : null,
      topBlocked: topBlocked ? { stationId: topBlocked.stationId, avgBlockedMs: topBlocked.avgBlockedMs } : null,
    };

    const taktBreach =
      latest.taktTimeMs != null && latest.maxCycleTimeMs != null && latest.maxCycleTimeMs > latest.taktTimeMs;
    return {
      type: "line_balance",
      title: `Cân bằng ${label}`,
      data,
      textSummary:
        `Cân bằng ${label}: takt=${latest.taktTimeMs ?? "?"}ms, cycle TB=${latest.avgCycleTimeMs ?? "?"}ms, ` +
        `cycle max=${latest.maxCycleTimeMs ?? "?"}ms, hệ số cân bằng=${latest.balanceRatePct ?? "?"}%, WIP=${latest.wipCount}. ` +
        (taktBreach ? "CẢNH BÁO: cycle max vượt takt → có nút thắt. " : "") +
        (topBlocked && topBlocked.avgBlockedMs > 0 ? `Trạm bị chặn nặng nhất: #${topBlocked.stationId} (${topBlocked.avgBlockedMs}ms). ` : "") +
        (topStarved && topStarved.avgStarvedMs > 0 ? `Trạm thiếu liệu nhất: #${topStarved.stationId} (${topStarved.avgStarvedMs}ms).` : ""),
    };
  },
};

// ── 4. get_packaging_throughput ──────────────────────────────────────────────

interface ThroughputData {
  bucket: "hour" | "day";
  series: Array<{ ts: number; value: number }>;
  totalPass: number;
}

const throughputParams = z
  .object({
    machineCode: z.string().min(1).max(50).optional(),
    lineCode: z.string().min(1).max(50).optional(),
    days: z.number().int().min(1).max(14).optional().default(1),
  })
  .strict();

const getPackagingThroughput: Tool<z.infer<typeof throughputParams>, ThroughputData> = {
  name: "get_packaging_throughput",
  description: "Sản lượng đóng gói (số pass) theo giờ của máy/chuyền đóng gói trong N ngày.",
  parameters: throughputParams,
  triggers: [
    "throughput", "sản lượng đóng gói", "đóng gói", "packaging", "năng suất đóng gói",
  ],
  handler: async ({ machineCode, lineCode, days }) => {
    const empty: ThroughputData = { bucket: "hour", series: [], totalPass: 0 };
    const db = await getDb();
    if (!db) return noDbResult<ThroughputData>("throughput", "Sản lượng đóng gói", empty);

    const since = sinceDays(days);
    let machineId: number | undefined;
    if (machineCode) {
      const m = await resolveMachine(db, machineCode);
      if (!m) return notFoundMachine<ThroughputData>("throughput", machineCode, empty);
      machineId = m.id;
    }

    const conds = [
      gte(processResults.measuredAt, since),
      eq(processResults.result, "pass"),
      eq(processResults.machineType, "PACKAGING"),
    ];
    if (machineId != null) conds.push(eq(processResults.machineId, machineId));
    if (lineCode) conds.push(eq(processResults.lineCode, lineCode));

    const rows = await db
      .select({
        bucketTs: sql<string>`date_trunc('hour', ${processResults.measuredAt})`,
        cnt: sql<number>`count(*)::int`,
      })
      .from(processResults)
      .where(and(...conds))
      .groupBy(sql`date_trunc('hour', ${processResults.measuredAt})`)
      .orderBy(sql`date_trunc('hour', ${processResults.measuredAt})`);

    const series = rows.map((r) => ({ ts: new Date(r.bucketTs).getTime(), value: Number(r.cnt ?? 0) }));
    const totalPass = series.reduce((s, p) => s + p.value, 0);
    const scope = machineCode ? `máy ${machineCode}` : lineCode ? `chuyền ${lineCode}` : "toàn bộ đóng gói";
    const title = `Sản lượng đóng gói ${scope}`;

    if (totalPass === 0) {
      return {
        type: "throughput",
        title,
        data: { ...empty, series },
        textSummary: `Chưa có sản lượng đóng gói (pass) cho ${scope} trong ${days} ngày qua.`,
        note: "NOT_FOUND",
      };
    }
    const avgPerHour = round2(totalPass / Math.max(series.length, 1));
    return {
      type: "throughput",
      title,
      data: { bucket: "hour", series, totalPass },
      textSummary:
        `Sản lượng đóng gói ${scope} (${days} ngày): tổng ${totalPass} pass qua ${series.length} giờ có hoạt động, ` +
        `TB ≈ ${avgPerHour} đơn vị/giờ.`,
    };
  },
};

// ── 5. get_palletizer_status ─────────────────────────────────────────────────

interface PalletizerData {
  machineId: number | null;
  machineCode: string | null;
  operationStatus: string | null;
  lastHeartbeat: string | null;
  latestTelemetry: Array<{ tagKey: string; value: number | string | null; unit: string | null; ts: string }>;
  latestResult: { result: string; measuredAt: string } | null;
}

const palletizerParams = z
  .object({ machineCode: z.string().min(1).max(50).optional() })
  .strict();

const getPalletizerStatus: Tool<z.infer<typeof palletizerParams>, PalletizerData | null> = {
  name: "get_palletizer_status",
  description: "Trạng thái máy xếp pallet (palletizer): telemetry mới nhất, kết quả công đoạn gần nhất, heartbeat.",
  parameters: palletizerParams,
  triggers: ["palletizer", "xếp pallet", "máy xếp pallet", "robot pallet", "trạng thái pallet"],
  handler: async ({ machineCode }) => {
    const db = await getDb();
    if (!db) return noDbResult<PalletizerData | null>("palletizer_status", "Trạng thái palletizer", null);

    let machineRow: { id: number; code: string; operationStatus: string | null; lastHeartbeat: Date | null } | null = null;
    if (machineCode) {
      const rows = await db
        .select({
          id: machines.id,
          code: machines.code,
          operationStatus: machines.operationStatus,
          lastHeartbeat: machines.lastHeartbeat,
        })
        .from(machines)
        .where(eq(machines.code, machineCode))
        .limit(1);
      if (!rows[0]) return notFoundMachine<PalletizerData | null>("palletizer_status", machineCode, null);
      machineRow = {
        id: rows[0].id,
        code: rows[0].code,
        operationStatus: rows[0].operationStatus == null ? null : String(rows[0].operationStatus),
        lastHeartbeat: rows[0].lastHeartbeat ?? null,
      };
    } else {
      const rows = await db
        .select({
          id: machines.id,
          code: machines.code,
          operationStatus: machines.operationStatus,
          lastHeartbeat: machines.lastHeartbeat,
        })
        .from(machines)
        .where(eq(machines.machineType, "PALLETIZER"))
        .limit(1);
      if (rows[0]) {
        machineRow = {
          id: rows[0].id,
          code: rows[0].code,
          operationStatus: rows[0].operationStatus == null ? null : String(rows[0].operationStatus),
          lastHeartbeat: rows[0].lastHeartbeat ?? null,
        };
      }
    }

    if (!machineRow) {
      return {
        type: "palletizer_status",
        title: "Trạng thái palletizer",
        data: null,
        textSummary: "Không tìm thấy máy palletizer nào.",
        note: "NOT_FOUND",
      };
    }

    const telemetry = await getLatestTelemetry({ machineId: machineRow.id, limit: 10 });
    const resultRows = await db
      .select({ result: processResults.result, measuredAt: processResults.measuredAt })
      .from(processResults)
      .where(eq(processResults.machineId, machineRow.id))
      .orderBy(desc(processResults.measuredAt))
      .limit(1);
    const latestResult = resultRows[0]
      ? { result: String(resultRows[0].result), measuredAt: new Date(resultRows[0].measuredAt).toISOString() }
      : null;

    const data: PalletizerData = {
      machineId: machineRow.id,
      machineCode: machineRow.code,
      operationStatus: machineRow.operationStatus,
      lastHeartbeat: machineRow.lastHeartbeat ? new Date(machineRow.lastHeartbeat).toISOString() : null,
      latestTelemetry: telemetry.map((t) => ({
        tagKey: t.tagKey,
        value: t.valueNumeric ?? t.valueText,
        unit: t.unit,
        ts: t.timestamp,
      })),
      latestResult,
    };

    const tagSummary = data.latestTelemetry.slice(0, 4)
      .map((t) => `${t.tagKey}=${t.value ?? "?"}${t.unit ? t.unit : ""}`)
      .join(", ");
    return {
      type: "palletizer_status",
      title: `Trạng thái palletizer ${machineRow.code}`,
      data,
      textSummary:
        `Palletizer ${machineRow.code}: trạng thái=${machineRow.operationStatus ?? "?"}, ` +
        `heartbeat=${data.lastHeartbeat ? data.lastHeartbeat.slice(0, 16) : "không có"}. ` +
        (latestResult ? `Kết quả gần nhất: ${latestResult.result} @ ${latestResult.measuredAt.slice(0, 16)}. ` : "") +
        (tagSummary ? `Telemetry: ${tagSummary}.` : "Chưa có telemetry."),
    };
  },
};

// ── 6. get_ot_telemetry_latest ───────────────────────────────────────────────

interface OtTelemetryData {
  rows: Array<{ tagKey: string; value: number | string | null; unit: string | null; quality: string; ts: string }>;
}

const otTelemetryParams = z
  .object({
    machineCode: z.string().min(1).max(50).optional(),
    tagKey: z.string().min(1).max(128).optional(),
    limit: z.number().int().min(1).max(50).optional().default(10),
  })
  .strict()
  .refine((v) => !!v.machineCode, { message: "Cần machineCode" });

const getOtTelemetryLatest: Tool<z.infer<typeof otTelemetryParams>, OtTelemetryData> = {
  name: "get_ot_telemetry_latest",
  description: "Giá trị telemetry OT mới nhất của một máy (kèm đơn vị từ deviceTags).",
  parameters: otTelemetryParams,
  triggers: ["telemetry", "tag value", "giá trị tag", "ot telemetry", "đọc tag", "cảm biến máy"],
  handler: async ({ machineCode, tagKey, limit }) => {
    const empty: OtTelemetryData = { rows: [] };
    const db = await getDb();
    if (!db) return noDbResult<OtTelemetryData>("ot_telemetry", "Telemetry OT", empty);
    if (!machineCode) {
      return { type: "ot_telemetry", title: "Telemetry OT", data: empty, textSummary: "Cần machineCode.", note: "MISSING_ARGS" };
    }

    const m = await resolveMachine(db, machineCode);
    if (!m) return notFoundMachine<OtTelemetryData>("ot_telemetry", machineCode, empty);

    const telemetry = await getLatestTelemetry({ machineId: m.id, tagKey, limit });
    const data: OtTelemetryData = {
      rows: telemetry.map((t) => ({
        tagKey: t.tagKey,
        value: t.valueNumeric ?? t.valueText,
        unit: t.unit,
        quality: t.quality,
        ts: t.timestamp,
      })),
    };
    const title = `Telemetry máy ${machineCode}${tagKey ? ` · ${tagKey}` : ""}`;
    if (data.rows.length === 0) {
      return {
        type: "ot_telemetry",
        title,
        data,
        textSummary: `Chưa có telemetry cho máy ${machineCode}${tagKey ? ` (tag ${tagKey})` : ""}.`,
        note: "NOT_FOUND",
      };
    }
    const summary = data.rows.slice(0, 6)
      .map((r) => `${r.tagKey}=${r.value ?? "?"}${r.unit ? r.unit : ""}`)
      .join(", ");
    return {
      type: "ot_telemetry",
      title,
      data,
      textSummary: `Telemetry mới nhất máy ${machineCode}: ${summary}.`,
    };
  },
};

// ── register ──────────────────────────────────────────────────────────────

let _registeredF6 = false;
export function registerF6Tools(): void {
  if (_registeredF6) return;
  _registeredF6 = true;
  registerTool(getMachineProcessResult);
  registerTool(getProcessMetricTrend);
  registerTool(getLineBalance);
  registerTool(getPackagingThroughput);
  registerTool(getPalletizerStatus);
  registerTool(getOtTelemetryLatest);
}

registerF6Tools();

export {
  getMachineProcessResult,
  getProcessMetricTrend,
  getLineBalance,
  getPackagingThroughput,
  getPalletizerStatus,
  getOtTelemetryLatest,
};
