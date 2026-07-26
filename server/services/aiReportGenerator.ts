/**
 * AI Report Generator Service
 * 
 * Generates AI-powered quality and performance reports:
 *  1. Daily Quality Summary — defect rate, top defects, anomalies, recommendations
 *  2. Root Cause Investigation Report — triggered by spikes, includes timeline and correlations
 *  3. Model Performance Report — accuracy trends, drift alerts, retrain recommendations
 *  4. Weekly/Monthly Executive Summary — KPI tracking, trends, forecasts
 * 
 * Narrative analysis runs 100% locally (GGUF / llama.cpp) via aiProviderRouter,
 * with structured JSON + rule-based offline fallbacks. No cloud LLM is used.
 */

import { createHash } from "crypto";
import { generateNarrative as routerNarrative } from "./aiProviderRouter";

function narrativeCacheKey(systemPrompt: string, data: string): string {
  return "narrative:" + createHash("sha1").update(systemPrompt + "\u0000" + data).digest("hex").slice(0, 16);
}
import { getDb } from "../db/connection";
import { sql, gte, lte, eq, and, desc, SQL } from "drizzle-orm";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  dailyStatistics,
  machines,
  inferenceResults,
} from "../../drizzle/schema";
import { aiModels } from "../../drizzle/schema/ai";
import { checkConfidenceDrift } from "./aiDriftMonitor";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ReportParams {
  startDate: Date;
  endDate: Date;
  machineId?: number;
  factoryId?: number;
  reportType: "daily" | "rca" | "model_performance" | "executive";
  language?: "en" | "vi";
}

export interface NarrativeMetadata {
  generatedBy: "openai" | "gguf" | "offline";
  confidence: number; // 0.1-1.0
  timestamp: Date;
  model?: string; // e.g., local GGUF model id (llama.cpp)
}

export interface QualitySummary {
  period: string;
  totalInspections: number;
  okCount: number;
  ngCount: number;
  yieldRate: number;
  topDefects: Array<{ type: string; count: number; percentage: number }>;
  anomalies: string[];
  recommendations: string[];
  narrative: string;
  narrativeMetadata?: NarrativeMetadata;
}

export interface RCAReport {
  triggeredBy: string;
  timeline: Array<{ time: string; event: string }>;
  contributingFactors: Array<{ factor: string; impact: number; evidence: string }>;
  correlations: Array<{ factor1: string; factor2: string; correlation: number }>;
  actionItems: string[];
  narrative: string;
  narrativeMetadata?: NarrativeMetadata;
}

export interface ModelPerformanceReport {
  models: Array<{
    modelId: number;
    modelCode: string;
    /**
     * doc69 A4 — true when AT LEAST ONE real operational signal was found for this
     * model in the report window: either `inference_results` rows (latency/error/
     * volume — see `collectModelOperationalStats`) or an evaluated aiDriftMonitor
     * check. `false` means every metric below is null — NOT a fabricated "healthy"
     * reading. Note this is granular per FIELD, not just per model: a model can have
     * `dataAvailable:true` (real latency/error/volume) while `currentAccuracy` is
     * STILL null, because no real accuracy source exists anywhere in this system yet
     * (see comment on `currentAccuracy` below). Consumers must branch on each field's
     * own nullness, not assume `dataAvailable:true` ⇒ every field is non-null.
     */
    dataAvailable: boolean;
    /**
     * Always null — doc69 A4 STOP-LYING scope explicitly excludes accuracy: there is
     * no real accuracy/label-comparison source wired anywhere in this codebase yet
     * (server/db/aiAdvanced.ts's own getInferenceStatsForPeriod hardcodes the same
     * `accuracy: null` for the identical reason). Do NOT fabricate a number here —
     * when a real accuracy source (e.g. getLabelAccuracy / eval reports) exists,
     * wire it and flip this to real values.
     */
    currentAccuracy: number | null;
    /** Always null — derived from currentAccuracy, which is always null (see above). */
    accuracyTrend: "improving" | "stable" | "declining" | null;
    /**
     * Real value from aiDriftMonitor.checkConfidenceDrift when it could EVALUATE
     * (enough samples in both baseline+recent windows AND AI_DRIFT_MONITOR_ENABLED).
     * null — not false — when the monitor is disabled or under-sampled: "we didn't
     * check" must never be reported as "no drift found".
     */
    driftDetected: boolean | null;
    /** Severity of the above, from aiDriftMonitor. Null under the same conditions as driftDetected. */
    driftSeverity: "NONE" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
    /** Real inference_results row count for this model in the report window (call volume). Null when zero rows. */
    totalPredictions: number | null;
    /** Real avg(processingTimeMs) from inference_results. Null when no rows. */
    avgLatencyMs: number | null;
    /** Real p50 latency (percentile_cont) from inference_results. Null when no rows. */
    p50LatencyMs: number | null;
    /** Real p95 latency (percentile_cont) from inference_results. Null when no rows. */
    p95LatencyMs: number | null;
    /** Real (FAILED+TIMEOUT)/total fraction [0,1] from inference_results. Null when no rows. */
    errorRate: number | null;
  }>;
  retrainRecommendations: string[];
  narrative: string;
  narrativeMetadata?: NarrativeMetadata;
}

export interface ExecutiveSummary {
  period: string;
  kpis: {
    totalProduction: number;
    overallYield: number;
    yieldChange: number; // vs previous period
    avgDefectRate: number;
    defectRateChange: number;
    topPerformingMachine: string;
    worstPerformingMachine: string;
  };
  trends: string[];
  concerns: string[];
  forecast: string;
  narrative: string;
  narrativeMetadata?: NarrativeMetadata;
}

// ─── Offline Narrative Fallback ───────────────────────────────────────────

function generateOfflineNarrative(systemPrompt: string, data: string): string {
  const isVi = systemPrompt.includes("tiếng Việt") || systemPrompt.includes("Việt");
  try {
    const d = JSON.parse(data) as Record<string, unknown>;

    // Daily quality summary
    if ("yieldRate" in d && "topDefects" in d) {
      const yieldRate = Number(d.yieldRate ?? 0).toFixed(1);
      const total = d.total ?? 0;
      const ng = d.ng ?? 0;
      const topDefects = (d.topDefects as Array<{ type: string; count: number }> | undefined) ?? [];
      const topType = topDefects[0]?.type ?? (isVi ? "không xác định" : "unknown");
      const anomalies = (d.anomalies as string[] | undefined) ?? [];
      if (isVi) {
        return `Trong kỳ báo cáo ${d.period ?? ""}, hệ thống đã kiểm tra ${total} sản phẩm với tỷ lệ đạt ${yieldRate}% và ${ng} sản phẩm lỗi. ` +
          (topDefects.length > 0 ? `Loại lỗi phổ biến nhất là "${topType}". ` : "") +
          (anomalies.length > 0 ? `Phát hiện bất thường: ${anomalies.join("; ")}. ` : "") +
          `Cần theo dõi và so sánh với kỳ trước để xác định xu hướng.`;
      }
      return `During period ${d.period ?? ""}, ${total} inspections were completed with a ${yieldRate}% yield rate and ${ng} defective items. ` +
        (topDefects.length > 0 ? `The most common defect type was "${topType}". ` : "") +
        (anomalies.length > 0 ? `Anomalies detected: ${anomalies.join("; ")}. ` : "") +
        `Continue monitoring and compare with previous periods to identify trends.`;
    }

    // RCA report
    if ("triggerReason" in d && "contributingFactors" in d) {
      const factors = (d.contributingFactors as Array<{ factor: string; impact: number }> | undefined) ?? [];
      const topFactor = factors[0]?.factor ?? (isVi ? "không xác định" : "unknown");
      const actions = (d.actionItems as string[] | undefined) ?? [];
      if (isVi) {
        return `Cuộc điều tra nguyên nhân gốc được kích hoạt bởi: ${d.triggerReason}. ` +
          (factors.length > 0 ? `Yếu tố đóng góp chính là "${topFactor}" (${Number(factors[0]?.impact ?? 0).toFixed(1)}% tác động). ` : "") +
          (actions.length > 0 ? `Hành động đề xuất: ${actions.slice(0, 3).join("; ")}.` : "");
      }
      return `Root cause investigation triggered by: ${d.triggerReason}. ` +
        (factors.length > 0 ? `The primary contributing factor was "${topFactor}" (${Number(factors[0]?.impact ?? 0).toFixed(1)}% impact). ` : "") +
        (actions.length > 0 ? `Recommended actions: ${actions.slice(0, 3).join("; ")}.` : "");
    }

    // Model performance report
    if ("models" in d && "retrainRecommendations" in d) {
      const models = (d.models as Array<{ modelCode: string; currentAccuracy: number; driftDetected: boolean }> | undefined) ?? [];
      const recs = (d.retrainRecommendations as string[] | undefined) ?? [];
      const driftCount = models.filter(m => m.driftDetected).length;
      if (isVi) {
        return `Báo cáo hiệu suất gồm ${models.length} mô hình AI. ` +
          (driftCount > 0 ? `${driftCount} mô hình phát hiện dịch chuyển độ chính xác. ` : "Tất cả mô hình hoạt động trong ngưỡng cho phép. ") +
          (recs.length > 0 ? `Khuyến nghị: ${recs[0]}.` : "");
      }
      return `Performance report covers ${models.length} AI models. ` +
        (driftCount > 0 ? `${driftCount} model(s) show accuracy drift. ` : "All models performing within acceptable ranges. ") +
        (recs.length > 0 ? `Recommendation: ${recs[0]}.` : "");
    }

    // Executive summary
    if ("currentYield" in d && "kpis" in d || "currentYield" in d) {
      const yieldVal = Number(d.currentYield ?? 0).toFixed(1);
      const yieldChange = Number(d.currentYield ?? 0) - Number(d.prevYield ?? 0);
      const changeStr = yieldChange >= 0 ? `+${yieldChange.toFixed(1)}` : yieldChange.toFixed(1);
      const trends = (d.trends as string[] | undefined) ?? [];
      const concerns = (d.concerns as string[] | undefined) ?? [];
      if (isVi) {
        return `Tóm tắt điều hành kỳ ${d.period ?? ""}: tỷ lệ sản xuất đạt ${yieldVal}% (${changeStr}% so với kỳ trước). ` +
          (trends.length > 0 ? `Xu hướng: ${trends[0]}. ` : "") +
          (concerns.length > 0 ? `Vấn đề cần chú ý: ${concerns[0]}.` : "Không có vấn đề nghiêm trọng trong kỳ này.");
      }
      return `Executive summary for period ${d.period ?? ""}: overall yield ${yieldVal}% (${changeStr}pp vs previous period). ` +
        (trends.length > 0 ? `Key trend: ${trends[0]}. ` : "") +
        (concerns.length > 0 ? `Concern: ${concerns[0]}.` : "No critical issues identified in this period.");
    }
  } catch (err) {
    console.warn("[aiReportGenerator] offline narrative parse failed:", err);
  }
  return isVi
    ? "Báo cáo được tạo tự động từ dữ liệu cục bộ (chế độ offline)."
    : "Report generated automatically from local data (offline mode).";
}

// ─── Narrative (delegates to aiProviderRouter) ─────────────────────────────

async function generateNarrative(systemPrompt: string, data: string): Promise<{ text: string; metadata: NarrativeMetadata }> {
  const timestamp = new Date();
  try {
    const result = await routerNarrative({
      systemPrompt,
      prompt: data,
      maxTokens: 1500,
      temperature: 0.3,
      cacheKey: narrativeCacheKey(systemPrompt, data),
    });
    if (result.text) {
      console.log(`[aiReportGenerator] ${result.provider}${result.fallbackUsed ? " (fallback)" : ""} narrative in ${result.totalTimeMs}ms`);
      return {
        text: result.text,
        metadata: {
          generatedBy: result.provider,
          confidence: result.provider === "openai" ? 0.95 : 0.75,
          timestamp,
          model: result.model,
        },
      };
    }
  } catch (err) {
    console.error(`[aiReportGenerator] Provider router failed, using offline template:`, err);
  }

  // Last resort: offline static template
  return {
    text: generateOfflineNarrative(systemPrompt, data),
    metadata: {
      generatedBy: "offline",
      confidence: 0.4,
      timestamp,
      model: "template",
    },
  };
}

// ─── Data Collection ───────────────────────────────────────────────────────

async function collectInspectionStats(startDate: Date, endDate: Date, machineId?: number) {
  const db = await getDb();
  if (!db) {
    console.error("[collectInspectionStats] Database connection unavailable (DB_UNAVAILABLE)");
    return null;
  }

  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, startDate),
    lte(productInspections.inspectionTime, endDate),
  ];
  if (machineId) conditions.push(eq(productInspections.machineId, machineId));

  const [stats] = await db.select({
    total: sql<number>`COUNT(*)`.as("total"),
    ok: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'OK')`.as("ok"),
    ng: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`.as("ng"),
  })
    .from(productInspections)
    .where(and(...conditions));

  return {
    total: Number(stats?.total) || 0,
    ok: Number(stats?.ok) || 0,
    ng: Number(stats?.ng) || 0,
  };
}

async function collectTopDefects(startDate: Date, endDate: Date, machineId?: number, limit = 10) {
  const db = await getDb();
  if (!db) {
    console.error("[collectTopDefects] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, startDate),
    lte(productInspections.inspectionTime, endDate),
    eq(productInspections.overallResult, "NG"),
  ];
  if (machineId) conditions.push(eq(productInspections.machineId, machineId));

  // Join measurement results with point definitions to get defect names
  const result = await db.select({
    defectType: measurementPointDefs.name,
    count: sql<number>`COUNT(*)`.as("cnt"),
  })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .where(and(
      ...conditions,
      eq(measurementResults.result, "NG"),
    ))
    .groupBy(measurementPointDefs.name)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(limit);

  return result.map(r => ({
    type: r.defectType ?? "Unknown",
    count: Number(r.count),
  }));
}

// doc 69 W0-3 security review fix (Important #2) — `machineId` is OPTIONAL and, when
// given, scopes this sub-aggregation to that single machine. Before this fix,
// generateRCAReport always called this GLOBALLY regardless of its own (correctly
// machine-scoped) stats/topDefects — so a factory-scoped RCA report's `correlations[]`
// and "worst machine" still leaked every OTHER factory's machines. Callers that
// legitimately want the full cross-factory ranking (generateExecutiveSummary, which is
// now admin-only — see aiAnalyticsScope.enforceGlobalReportScope) simply omit machineId.
async function collectMachinePerformance(startDate: Date, endDate: Date, machineId?: number) {
  const db = await getDb();
  if (!db) {
    console.error("[collectMachinePerformance] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, startDate),
    lte(productInspections.inspectionTime, endDate),
  ];
  if (machineId) conditions.push(eq(productInspections.machineId, machineId));

  const result = await db.select({
    machineId: productInspections.machineId,
    machineCode: machines.code,
    total: sql<number>`COUNT(*)`.as("total"),
    ok: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'OK')`.as("ok"),
    ng: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`.as("ng"),
  })
    .from(productInspections)
    .leftJoin(machines, eq(productInspections.machineId, machines.id))
    .where(and(...conditions))
    .groupBy(productInspections.machineId, machines.code)
    .orderBy(desc(sql`COUNT(*)`));

  return result.map(r => ({
    machineId: r.machineId,
    machineCode: r.machineCode ?? `Machine-${r.machineId}`,
    total: Number(r.total),
    ok: Number(r.ok),
    ng: Number(r.ng),
    yieldRate: Number(r.total) > 0 ? (Number(r.ok) / Number(r.total)) * 100 : 0,
  }));
}

/** Minimum inference_results rows in-window before we flag an error-rate concern (avoid noise on tiny samples). */
const MIN_SAMPLES_FOR_ERROR_ALERT = 20;

interface ModelOperationalStats {
  totalPredictions: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
}

/**
 * doc69 A4 — REAL per-model latency/throughput/error-rate signal, read from
 * `inference_results` (written by aiInferenceEngine.runInference on every actual
 * vision-model inference — the ONLY table in this codebase that ties inference
 * telemetry back to `ai_models.id`). `ai_gateway_metrics` was considered first (it
 * is what G2 metering populates) but its `model` column is the resolved GGUF/LLM
 * basename routed through the chat/RCA/report narrative gateway — a DIFFERENT
 * model namespace from the ONNX/vision defect-detection models this report lists
 * (`ai_models.code`, format ONNX/TENSORRT/etc.). Joining those two would either
 * never match (dead code dressed up as "wired") or silently mix two unrelated
 * model universes — so this reads the table that is actually keyed by `modelId`.
 * Returns null (honest-empty) when there is no inference activity for this model
 * in the window — NOT zeros.
 */
async function collectModelOperationalStats(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  modelId: number,
  startDate: Date,
  endDate: Date,
): Promise<ModelOperationalStats | null> {
  const [row] = await db.select({
    total: sql<number>`COUNT(*)`.as("total"),
    avgLatencyMs: sql<number>`COALESCE(AVG(${inferenceResults.processingTimeMs}), 0)`.as("avgLatencyMs"),
    p50LatencyMs: sql<number>`COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${inferenceResults.processingTimeMs}), 0)`.as("p50LatencyMs"),
    p95LatencyMs: sql<number>`COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${inferenceResults.processingTimeMs}), 0)`.as("p95LatencyMs"),
    errCount: sql<number>`COUNT(*) FILTER (WHERE ${inferenceResults.status} IN ('FAILED', 'TIMEOUT'))`.as("errCount"),
  })
    .from(inferenceResults)
    .where(and(
      eq(inferenceResults.modelId, modelId),
      gte(inferenceResults.createdAt, startDate),
      lte(inferenceResults.createdAt, endDate),
    ));

  const total = Number(row?.total) || 0;
  if (total === 0) return null; // honest-empty: no real inference activity in this window

  return {
    totalPredictions: total,
    avgLatencyMs: Math.round(Number(row?.avgLatencyMs) || 0),
    p50LatencyMs: Math.round(Number(row?.p50LatencyMs) || 0),
    p95LatencyMs: Math.round(Number(row?.p95LatencyMs) || 0),
    errorRate: total > 0 ? (Number(row?.errCount) || 0) / total : 0,
  };
}

/**
 * doc69 A4 — wires the previously HONEST-EMPTY (T5/doc69 W0-5) model-performance
 * collector to the REAL signals that exist:
 *  - latency/throughput/error-rate ← inference_results (see collectModelOperationalStats)
 *  - drift ← aiDriftMonitor.checkConfidenceDrift (confidence-distribution PSI/mean-shift)
 *  - accuracy ← still no real source anywhere in this system → stays honestly null
 * `emitAlert:false` on the drift check: report generation is a READ path (may be
 * triggered repeatedly by dashboard refreshes / scheduled reports) and must not
 * have the side effect of writing model_drift_alerts rows — that's aiDriftMonitor's
 * own scheduled-check responsibility, not this report's.
 */
async function collectModelPerformanceData(startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) {
    console.error("[collectModelPerformanceData] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const result = await db.select({
    modelId: aiModels.id,
    modelCode: aiModels.code,
    modelVersion: aiModels.currentVersion,
    status: aiModels.status,
  })
    .from(aiModels)
    .where(eq(aiModels.status, "ACTIVE"))
    .orderBy(aiModels.code);

  return Promise.all(result.map(async (m) => {
    let stats: ModelOperationalStats | null = null;
    try {
      stats = await collectModelOperationalStats(db, m.modelId, startDate, endDate);
    } catch (err) {
      console.error(`[collectModelPerformanceData] operational-stats query failed for model ${m.modelId}:`, err);
    }

    let driftDetected: boolean | null = null;
    let driftSeverity: "NONE" | "MEDIUM" | "HIGH" | "CRITICAL" | null = null;
    try {
      const drift = await checkConfidenceDrift({
        modelId: m.modelId,
        modelVersion: m.modelVersion ?? undefined,
        now: endDate,
        emitAlert: false,
      });
      if (drift.evaluated) {
        driftDetected = drift.drift;
        driftSeverity = drift.severity;
      }
    } catch (err) {
      console.error(`[collectModelPerformanceData] drift check failed for model ${m.modelId}:`, err);
    }

    return {
      modelId: m.modelId,
      modelCode: m.modelCode,
      dataAvailable: stats != null || driftDetected != null,
      // doc69 A4 — intentionally still null: no real accuracy source exists (see
      // interface comment). This is NOT a leftover — do not "fix" by fabricating.
      currentAccuracy: null,
      accuracyTrend: null,
      driftDetected,
      driftSeverity,
      totalPredictions: stats?.totalPredictions ?? null,
      avgLatencyMs: stats?.avgLatencyMs ?? null,
      p50LatencyMs: stats?.p50LatencyMs ?? null,
      p95LatencyMs: stats?.p95LatencyMs ?? null,
      errorRate: stats?.errorRate ?? null,
    };
  }));
}

// ─── Report Generators ─────────────────────────────────────────────────────

/**
 * Generate a Daily Quality Summary report.
 */
export async function generateDailyQualitySummary(params: ReportParams): Promise<QualitySummary> {
  const { startDate, endDate, machineId, language = "en" } = params;
  const period = `${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`;

  const [stats, topDefects] = await Promise.all([
    collectInspectionStats(startDate, endDate, machineId),
    collectTopDefects(startDate, endDate, machineId),
  ]);

  const total = stats?.total ?? 0;
  const ok = stats?.ok ?? 0;
  const ng = stats?.ng ?? 0;
  const yieldRate = total > 0 ? (ok / total) * 100 : 0;

  const topDefectsFormatted = topDefects.map(d => ({
    ...d,
    percentage: ng > 0 ? (d.count / ng) * 100 : 0,
  }));

  // Simple anomaly detection: flag if defect rate > 10% or unusual patterns
  const anomalies: string[] = [];
  const defectRate = total > 0 ? (ng / total) * 100 : 0;
  if (defectRate > 10) anomalies.push(`High defect rate: ${defectRate.toFixed(1)}%`);
  if (topDefectsFormatted.length > 0 && topDefectsFormatted[0].percentage > 50) {
    anomalies.push(`Dominant defect type "${topDefectsFormatted[0].type}" accounts for ${topDefectsFormatted[0].percentage.toFixed(1)}% of all defects`);
  }

  const recommendations: string[] = [];
  if (defectRate > 5) recommendations.push("Review inspection criteria and machine calibration");
  if (topDefectsFormatted.length > 0) {
    recommendations.push(`Focus improvement on "${topDefectsFormatted[0].type}" defect type`);
  }
  recommendations.push("Continue monitoring and compare with previous periods");

  // Generate narrative
  const narrativeResult = await generateNarrative(
    language === "vi"
      ? "Bạn là chuyên gia chất lượng AOI. Viết tóm tắt báo cáo chất lượng hàng ngày bằng tiếng Việt."
      : "You are an AOI quality expert. Write a brief daily quality summary report.",
    JSON.stringify({ period, total, ok, ng, yieldRate, topDefects: topDefectsFormatted, anomalies }),
  );

  return {
    period,
    totalInspections: total,
    okCount: ok,
    ngCount: ng,
    yieldRate,
    topDefects: topDefectsFormatted,
    anomalies,
    recommendations,
    narrative: narrativeResult.text,
    narrativeMetadata: narrativeResult.metadata,
  };
}

/**
 * Generate a Root Cause Investigation report (triggered by defect spike).
 */
export async function generateRCAReport(params: ReportParams & { triggerReason?: string }): Promise<RCAReport> {
  const { startDate, endDate, machineId, language = "en" } = params;
  const triggerReason = params.triggerReason ?? "Defect rate spike detected";

  const [stats, topDefects, machinePerf] = await Promise.all([
    collectInspectionStats(startDate, endDate, machineId),
    collectTopDefects(startDate, endDate, machineId),
    collectMachinePerformance(startDate, endDate, machineId),
  ]);

  const total = stats?.total ?? 0;
  const ng = stats?.ng ?? 0;

  // Build timeline (simplified: hourly breakdown not available, use defect progression)
  const timeline = [
    { time: startDate.toISOString(), event: "Investigation period start" },
    { time: triggerReason, event: "Alert triggered" },
    { time: endDate.toISOString(), event: "Investigation period end" },
  ];

  // Contributing factors from top defects and machine performance
  const contributingFactors = topDefects.slice(0, 5).map(d => ({
    factor: d.type,
    impact: ng > 0 ? (d.count / ng) * 100 : 0,
    evidence: `${d.count} occurrences out of ${ng} total defects`,
  }));

  // Machine correlations
  const correlations = machinePerf
    .filter(m => m.ng > 0)
    .slice(0, 5)
    .map((m, i, arr) => ({
      factor1: m.machineCode,
      factor2: "defect_rate",
      correlation: m.total > 0 ? m.ng / m.total : 0,
    }));

  const actionItems: string[] = [];
  if (contributingFactors.length > 0) {
    actionItems.push(`Investigate root cause of "${contributingFactors[0].factor}" defect type`);
  }
  const worstMachine = machinePerf.sort((a, b) =>
    (b.total > 0 ? b.ng / b.total : 0) - (a.total > 0 ? a.ng / a.total : 0)
  )[0];
  if (worstMachine) {
    actionItems.push(`Check machine "${worstMachine.machineCode}" — highest defect rate`);
  }
  actionItems.push("Review process parameters for anomalous period");
  actionItems.push("Schedule preventive maintenance if machine degradation suspected");

  const narrativeResult = await generateNarrative(
    language === "vi"
      ? "Bạn là chuyên gia phân tích nguyên nhân gốc AOI. Viết báo cáo RCA chi tiết bằng tiếng Việt."
      : "You are an AOI root cause analysis expert. Write a concise RCA report.",
    JSON.stringify({ triggerReason, total, ng, contributingFactors, correlations, actionItems }),
  );

  return {
    triggeredBy: triggerReason,
    timeline,
    contributingFactors,
    correlations,
    actionItems,
    narrative: narrativeResult.text,
    narrativeMetadata: narrativeResult.metadata,
  };
}

/**
 * Generate Model Performance report.
 */
export async function generateModelPerformanceReport(params: ReportParams): Promise<ModelPerformanceReport> {
  const { startDate, endDate, language = "en" } = params;
  const models = await collectModelPerformanceData(startDate, endDate);

  const retrainRecommendations: string[] = [];
  for (const m of models) {
    // doc69 A4 — no real signal for this model in this window → do not fabricate a
    // verdict (drift/decline/accuracy/error-rate checks below all assume real metrics).
    if (!m.dataAvailable) continue;
    if (m.driftDetected) {
      retrainRecommendations.push(`Model "${m.modelCode}" shows accuracy drift — recommend retraining`);
    }
    if (m.accuracyTrend === "declining") {
      retrainRecommendations.push(`Model "${m.modelCode}" accuracy is declining — investigate data distribution changes`);
    }
    if (m.currentAccuracy != null && m.totalPredictions != null && m.currentAccuracy < 0.9 && m.totalPredictions > 100) {
      retrainRecommendations.push(`Model "${m.modelCode}" accuracy below 90% — consider model architecture update`);
    }
    // doc69 A4 — NEW: real error-rate signal from inference_results (was unavailable before).
    if (m.errorRate != null && m.totalPredictions != null && m.totalPredictions >= MIN_SAMPLES_FOR_ERROR_ALERT && m.errorRate > 0.1) {
      retrainRecommendations.push(
        `Model "${m.modelCode}" inference error rate ${(m.errorRate * 100).toFixed(1)}% over ${m.totalPredictions} predictions — investigate pipeline/model health`,
      );
    }
  }

  if (retrainRecommendations.length === 0) {
    const allUnavailable = models.length > 0 && models.every((m) => !m.dataAvailable);
    retrainRecommendations.push(
      allUnavailable
        ? language === "vi"
          ? "Số liệu hiệu suất model chưa khả dụng cho kỳ báo cáo này — chưa có hoạt động suy luận thực nào được ghi nhận"
          : "Model performance metrics unavailable for this period — no real inference activity recorded yet"
        : "All models performing within acceptable ranges — no immediate action needed",
    );
  }

  const narrativeResult = await generateNarrative(
    language === "vi"
      ? "Bạn là chuyên gia AI/ML. Viết báo cáo hiệu suất model bằng tiếng Việt."
      : "You are an AI/ML expert. Write a brief model performance summary report.",
    JSON.stringify({ models, retrainRecommendations }),
  );

  return { models, retrainRecommendations, narrative: narrativeResult.text, narrativeMetadata: narrativeResult.metadata };
}

/**
 * Generate Executive Summary report (weekly/monthly).
 */
export async function generateExecutiveSummary(params: ReportParams): Promise<ExecutiveSummary> {
  const { startDate, endDate, language = "en" } = params;
  const period = `${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`;

  // Current period stats
  const [currentStats, machinePerf] = await Promise.all([
    collectInspectionStats(startDate, endDate),
    collectMachinePerformance(startDate, endDate),
  ]);

  const currentTotal = currentStats?.total ?? 0;
  const currentOk = currentStats?.ok ?? 0;
  const currentNg = currentStats?.ng ?? 0;
  const currentYield = currentTotal > 0 ? (currentOk / currentTotal) * 100 : 0;
  const currentDefectRate = currentTotal > 0 ? (currentNg / currentTotal) * 100 : 0;

  // Previous period stats (same duration before startDate)
  const durationMs = endDate.getTime() - startDate.getTime();
  const prevStart = new Date(startDate.getTime() - durationMs);
  const prevEnd = new Date(startDate.getTime());
  const prevStats = await collectInspectionStats(prevStart, prevEnd);
  const prevTotal = prevStats?.total ?? 0;
  const prevOk = prevStats?.ok ?? 0;
  const prevNg = prevStats?.ng ?? 0;
  const prevYield = prevTotal > 0 ? (prevOk / prevTotal) * 100 : 0;
  const prevDefectRate = prevTotal > 0 ? (prevNg / prevTotal) * 100 : 0;

  // Machine rankings
  const sorted = [...machinePerf].sort((a, b) => b.yieldRate - a.yieldRate);
  const topMachine = sorted[0]?.machineCode ?? "N/A";
  const worstMachine = sorted[sorted.length - 1]?.machineCode ?? "N/A";

  const trends: string[] = [];
  if (currentYield > prevYield) trends.push(`Yield improved by ${(currentYield - prevYield).toFixed(1)} percentage points`);
  if (currentYield < prevYield) trends.push(`Yield decreased by ${(prevYield - currentYield).toFixed(1)} percentage points`);
  if (currentTotal > prevTotal * 1.1) trends.push("Production volume increased significantly");
  if (currentTotal < prevTotal * 0.9) trends.push("Production volume decreased");

  const concerns: string[] = [];
  if (currentDefectRate > 5) concerns.push(`Defect rate at ${currentDefectRate.toFixed(1)}% — above target`);
  if (currentYield < prevYield - 2) concerns.push("Significant yield decline vs previous period");

  const forecast = currentYield > prevYield
    ? "Positive trend — yield expected to continue improving with current practices"
    : "Declining trend — corrective actions recommended to prevent further degradation";

  const narrativeResult = await generateNarrative(
    language === "vi"
      ? "Bạn là giám đốc chất lượng. Viết tóm tắt executive summary bằng tiếng Việt cho ban lãnh đạo."
      : "You are a quality director. Write a concise executive summary for management.",
    JSON.stringify({
      period, currentTotal, currentYield, currentDefectRate,
      prevYield, prevDefectRate, topMachine, worstMachine, trends, concerns,
    }),
  );

  return {
    period,
    kpis: {
      totalProduction: currentTotal,
      overallYield: currentYield,
      yieldChange: currentYield - prevYield,
      avgDefectRate: currentDefectRate,
      defectRateChange: currentDefectRate - prevDefectRate,
      topPerformingMachine: topMachine,
      worstPerformingMachine: worstMachine,
    },
    trends,
    concerns,
    forecast,
    narrative: narrativeResult.text,
    narrativeMetadata: narrativeResult.metadata,
  };
}

/**
 * Unified report generation entry point.
 */
export async function generateReport(params: ReportParams & { triggerReason?: string }) {
  switch (params.reportType) {
    case "daily":
      return { type: "daily" as const, data: await generateDailyQualitySummary(params) };
    case "rca":
      return { type: "rca" as const, data: await generateRCAReport(params) };
    case "model_performance":
      return { type: "model_performance" as const, data: await generateModelPerformanceReport(params) };
    case "executive":
      return { type: "executive" as const, data: await generateExecutiveSummary(params) };
  }
}
