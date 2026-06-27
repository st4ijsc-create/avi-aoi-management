/**
 * AI Executive Report — Phase B4.3 (Báo cáo điều hành tự động).
 *
 * Tổng hợp KPI THỰC từ các nguồn hiện có (yield/FPY, NG Pareto, PdM risk, throughput)
 * cho một kỳ (ca / ngày / tuần), rồi nhờ MODEL SÂU (Tier-2/deep, định tuyến qua Model
 * Router task:"report") viết một bản tóm tắt điều hành có cấu trúc cho ban lãnh đạo.
 *
 * Nguyên tắc:
 *  - ADDITIVE + flag-gated default OFF (EXEC_REPORT_ENABLED). An toàn no-op khi tắt.
 *  - FAIL-SAFE: thiếu/ lỗi một nguồn KPI → báo cáo một phần, KHÔNG bao giờ ném (crash scheduler).
 *  - LLM 100% cục bộ qua aiProviderRouter (GGUF) — Model Router chỉ chọn tham số decode
 *    của tầng sâu (task:"report" → hard → Tier 2 / deep model). KHÔNG sửa router/engine.
 *  - Đa ngôn ngữ: vi mặc định, tôn trọng tham số lang.
 *
 * Lưu trữ: bảng `ai_insights` (đã có) với source='exec_report'; toàn bộ summary có cấu trúc
 * nằm trong contextJson để UI lấy lại — KHÔNG cần migration mới.
 *
 * Tham khảo: docs/ECOSYSTEM/04_AI_BRAIN_NEXTGEN_DESIGN_AND_UPGRADE_2026-06.md (§A6②, §B4.3).
 */

import { sql, desc, eq, and } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiInsights } from "../../drizzle/schema/aiInsight";

// ─── Types ─────────────────────────────────────────────────────

export type ReportPeriod = "shift" | "day" | "week";
export type ReportLang = "vi" | "en";

export interface KpiBundle {
  period: ReportPeriod;
  lang: ReportLang;
  window: { start: string; end: string };
  /** Throughput / sản lượng */
  totalInspections: number;
  okCount: number;
  ngCount: number;
  /** First-pass yield (%) — ok/total */
  fpy: number;
  /** NG rate hiện tại (%) */
  ngRate: number;
  /** NG rate kỳ liền trước (%) — để xác định xu hướng (delta) */
  prevNgRate: number;
  ngRateTrend: "up" | "down" | "flat";
  /** OEE xấp xỉ — quality dùng yield (availability/performance không có dữ liệu state ở mức bundle) */
  oeeQuality: number;
  /** Top loại NG (Pareto theo measurement point) */
  topDefects: Array<{ type: string; count: number; percentage: number }>;
  /** Chuỗi NG rate theo ngày trong kỳ (throughput trend) */
  ngRateSeries: Array<{ t: string; ngRate: number; total: number }>;
  /** Máy có rủi ro hỏng cao (PdM) */
  pdmRiskMachines: Array<{
    machineCode: string;
    failureRisk: number;
    urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    predictedTimeframe: string | null;
  }>;
  /** Cảnh báo thu thập dữ liệu (nguồn nào lỗi/thiếu) — minh bạch cho báo cáo một phần */
  dataWarnings: string[];
}

export interface ExecutiveSummaryStructured {
  period: ReportPeriod;
  lang: ReportLang;
  window: { start: string; end: string };
  headline: string;
  highlights: string[];
  risks: string[];
  recommendations: string[];
  kpiTable: Array<{ label: string; value: string }>;
  /** Bundle KPI gốc (để UI/PDF tái dùng số liệu thô) */
  kpis: KpiBundle;
  generatedBy: "gguf" | "offline";
  model?: string;
  generatedAt: string;
}

// ─── Period windows ────────────────────────────────────────────

const SHIFT_HOURS = Number(process.env.EXEC_REPORT_SHIFT_HOURS || "8");

/** Khoảng thời gian [start,end] cho kỳ, kết thúc tại `now` (mặc định hiện tại). */
export function periodWindow(period: ReportPeriod, now: Date = new Date()): { start: Date; end: Date } {
  const end = now;
  const start = new Date(end);
  switch (period) {
    case "shift":
      start.setHours(start.getHours() - SHIFT_HOURS);
      break;
    case "day":
      start.setDate(start.getDate() - 1);
      break;
    case "week":
      start.setDate(start.getDate() - 7);
      break;
  }
  return { start, end };
}

// ─── KPI collection (fail-safe per source) ─────────────────────

async function collectInspectionTotals(
  start: Date,
  end: Date,
): Promise<{ total: number; ok: number; ng: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const { productInspections } = await import("../../drizzle/schema");
  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      ok: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'OK')`,
      ng: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`,
    })
    .from(productInspections)
    .where(
      and(
        sql`${productInspections.inspectionTime} >= ${start.toISOString()}`,
        sql`${productInspections.inspectionTime} <= ${end.toISOString()}`,
      ),
    );
  return { total: Number(row?.total) || 0, ok: Number(row?.ok) || 0, ng: Number(row?.ng) || 0 };
}

/**
 * Thu thập một bundle KPI gọn cho kỳ. Mỗi nguồn được bọc try/catch riêng — một nguồn
 * lỗi sẽ ghi vào dataWarnings và để giá trị mặc định, KHÔNG ném ra ngoài.
 */
export async function gatherKpis(period: ReportPeriod, lang: ReportLang = "vi", now?: Date): Promise<KpiBundle> {
  const { start, end } = periodWindow(period, now);
  const dataWarnings: string[] = [];

  // 1) Throughput / yield hiện tại + kỳ trước (cho xu hướng NG)
  let totals = { total: 0, ok: 0, ng: 0 };
  let prevNgRate = 0;
  try {
    const cur = await collectInspectionTotals(start, end);
    if (cur) totals = cur;
    const durationMs = end.getTime() - start.getTime();
    const prev = await collectInspectionTotals(new Date(start.getTime() - durationMs), start);
    if (prev && prev.total > 0) prevNgRate = (prev.ng / prev.total) * 100;
  } catch (err) {
    dataWarnings.push(`inspection totals unavailable: ${String((err as any)?.message || err)}`);
  }

  const fpy = totals.total > 0 ? (totals.ok / totals.total) * 100 : 0;
  const ngRate = totals.total > 0 ? (totals.ng / totals.total) * 100 : 0;
  const ngDelta = ngRate - prevNgRate;
  const ngRateTrend: KpiBundle["ngRateTrend"] = Math.abs(ngDelta) < 0.5 ? "flat" : ngDelta > 0 ? "up" : "down";

  // 2) NG rate series (throughput trend) — qua getYieldTrendData
  let ngRateSeries: KpiBundle["ngRateSeries"] = [];
  try {
    const { getYieldTrendData } = await import("../db/statistics");
    const interval = period === "shift" ? "hour" : period === "week" ? "day" : "hour";
    const trend = await getYieldTrendData({ startDate: start, endDate: end, interval });
    ngRateSeries = (trend || []).map((r: any) => ({
      t: String(r.timeInterval),
      ngRate: Number(r.ngRate) || 0,
      total: Number(r.totalCount) || 0,
    }));
  } catch (err) {
    dataWarnings.push(`yield trend unavailable: ${String((err as any)?.message || err)}`);
  }

  // 3) Top NG defects (Pareto theo measurement point)
  let topDefects: KpiBundle["topDefects"] = [];
  try {
    const { paretoByDefectType } = await import("./paretoAnalysisService");
    const pareto = await paretoByDefectType({ startDate: start, endDate: end, limit: 5 });
    topDefects = (pareto?.items || []).slice(0, 5).map((it) => ({
      type: it.category,
      count: it.count,
      percentage: it.percentage,
    }));
  } catch (err) {
    dataWarnings.push(`defect pareto unavailable: ${String((err as any)?.message || err)}`);
  }

  // 4) PdM risk machines — chấm rủi ro cho các máy active, giữ top theo risk
  let pdmRiskMachines: KpiBundle["pdmRiskMachines"] = [];
  try {
    const maxMachines = Number(process.env.EXEC_REPORT_PDM_MAX_MACHINES || "20");
    const { getMachines } = await import("../db/hierarchy");
    const { computeFailureRisk } = await import("./predictiveMaintenanceService");
    const machineRows = (await getMachines()).slice(0, maxMachines);
    const risks = await Promise.all(
      machineRows.map(async (m: any) => {
        try {
          const r = await computeFailureRisk(m.id);
          return {
            machineCode: m.code || `M-${m.id}`,
            failureRisk: r.failureRisk,
            urgency: r.maintenanceUrgency,
            predictedTimeframe: r.predictedTimeframe,
          };
        } catch {
          return null;
        }
      }),
    );
    pdmRiskMachines = risks
      .filter((r): r is NonNullable<typeof r> => !!r && r.failureRisk > 0)
      .sort((a, b) => b.failureRisk - a.failureRisk)
      .slice(0, 5);
  } catch (err) {
    dataWarnings.push(`pdm risk unavailable: ${String((err as any)?.message || err)}`);
  }

  return {
    period,
    lang,
    window: { start: start.toISOString(), end: end.toISOString() },
    totalInspections: totals.total,
    okCount: totals.ok,
    ngCount: totals.ng,
    fpy,
    ngRate,
    prevNgRate,
    ngRateTrend,
    oeeQuality: fpy, // quality-only proxy ở mức bundle
    topDefects,
    ngRateSeries,
    pdmRiskMachines,
    dataWarnings,
  };
}

// ─── Prompt + offline fallback ─────────────────────────────────

function periodLabel(period: ReportPeriod, lang: ReportLang): string {
  if (lang === "vi") return period === "shift" ? "ca làm việc" : period === "week" ? "tuần" : "ngày";
  return period;
}

function buildSystemPrompt(lang: ReportLang): string {
  if (lang === "vi") {
    return (
      "Bạn là giám đốc chất lượng nhà máy AOI/AVI. Dựa trên bộ KPI THỰC được cung cấp (JSON), " +
      "hãy viết một bản tóm tắt điều hành NGẮN GỌN, sắc bén cho ban lãnh đạo bằng tiếng Việt. " +
      "Tập trung vào sản lượng, tỷ lệ đạt (FPY), xu hướng NG, các lỗi hàng đầu, và máy có rủi ro hỏng. " +
      "Chỉ dùng số liệu trong dữ liệu, không bịa. Trả lời theo đúng định dạng được yêu cầu."
    );
  }
  return (
    "You are an AOI/AVI factory quality director. Using the provided REAL KPI bundle (JSON), " +
    "write a SHORT, sharp executive summary for management in English. Focus on throughput, yield (FPY), " +
    "NG trend, top defects, and at-risk machines. Use only the figures in the data; never invent. " +
    "Respond in the exact requested format."
  );
}

/** Prompt người dùng: KPI JSON + yêu cầu các phần. */
function buildUserPrompt(kpis: KpiBundle): string {
  return JSON.stringify({
    instruction:
      "Produce: headline (1 sentence), highlights (3-5 bullets), risks (2-4 bullets), recommendations (2-4 bullets).",
    kpis,
  });
}

function buildKpiTable(kpis: KpiBundle, lang: ReportLang): Array<{ label: string; value: string }> {
  const L = (vi: string, en: string) => (lang === "vi" ? vi : en);
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const trendArrow = kpis.ngRateTrend === "up" ? "▲" : kpis.ngRateTrend === "down" ? "▼" : "▬";
  return [
    { label: L("Sản lượng kiểm", "Inspected"), value: String(kpis.totalInspections) },
    { label: L("Đạt (OK)", "OK"), value: String(kpis.okCount) },
    { label: L("Lỗi (NG)", "NG"), value: String(kpis.ngCount) },
    { label: L("Tỷ lệ đạt (FPY)", "FPY"), value: pct(kpis.fpy) },
    { label: L("Tỷ lệ NG", "NG rate"), value: `${pct(kpis.ngRate)} ${trendArrow}` },
    {
      label: L("Lỗi hàng đầu", "Top defect"),
      value: kpis.topDefects[0] ? `${kpis.topDefects[0].type} (${kpis.topDefects[0].count})` : "—",
    },
    {
      label: L("Máy rủi ro cao", "At-risk machine"),
      value: kpis.pdmRiskMachines[0]
        ? `${kpis.pdmRiskMachines[0].machineCode} (${kpis.pdmRiskMachines[0].failureRisk.toFixed(0)}%)`
        : "—",
    },
  ];
}

/** Tóm tắt offline (rule-based) khi LLM không khả dụng — luôn trả về cấu trúc đầy đủ. */
function offlineSummary(kpis: KpiBundle): { headline: string; highlights: string[]; risks: string[]; recommendations: string[] } {
  const vi = kpis.lang === "vi";
  const pl = periodLabel(kpis.period, kpis.lang);
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const headline = vi
    ? `Báo cáo ${pl}: ${kpis.totalInspections} sản phẩm, FPY ${pct(kpis.fpy)}, NG ${pct(kpis.ngRate)}.`
    : `${pl} report: ${kpis.totalInspections} units, FPY ${pct(kpis.fpy)}, NG ${pct(kpis.ngRate)}.`;

  const highlights: string[] = [];
  highlights.push(
    vi
      ? `Sản lượng: ${kpis.totalInspections} (OK ${kpis.okCount} / NG ${kpis.ngCount}).`
      : `Throughput: ${kpis.totalInspections} (OK ${kpis.okCount} / NG ${kpis.ngCount}).`,
  );
  if (kpis.topDefects[0]) {
    highlights.push(
      vi
        ? `Lỗi phổ biến nhất: "${kpis.topDefects[0].type}" (${kpis.topDefects[0].count}, ${pct(kpis.topDefects[0].percentage)}).`
        : `Top defect: "${kpis.topDefects[0].type}" (${kpis.topDefects[0].count}, ${pct(kpis.topDefects[0].percentage)}).`,
    );
  }
  highlights.push(
    vi
      ? `Xu hướng NG: ${kpis.ngRateTrend === "up" ? "tăng" : kpis.ngRateTrend === "down" ? "giảm" : "ổn định"} so với kỳ trước (${pct(kpis.prevNgRate)}).`
      : `NG trend: ${kpis.ngRateTrend} vs previous period (${pct(kpis.prevNgRate)}).`,
  );

  const risks: string[] = [];
  if (kpis.ngRate > 5) risks.push(vi ? `Tỷ lệ NG ${pct(kpis.ngRate)} vượt ngưỡng mục tiêu.` : `NG rate ${pct(kpis.ngRate)} above target.`);
  if (kpis.ngRateTrend === "up") risks.push(vi ? "NG đang có xu hướng tăng." : "NG trending upward.");
  for (const m of kpis.pdmRiskMachines.filter((x) => x.urgency === "HIGH" || x.urgency === "CRITICAL").slice(0, 2)) {
    risks.push(
      vi
        ? `Máy ${m.machineCode} rủi ro hỏng ${m.failureRisk.toFixed(0)}% (${m.urgency}).`
        : `Machine ${m.machineCode} failure risk ${m.failureRisk.toFixed(0)}% (${m.urgency}).`,
    );
  }
  if (risks.length === 0) risks.push(vi ? "Không phát hiện rủi ro nghiêm trọng trong kỳ." : "No critical risks detected this period.");

  const recommendations: string[] = [];
  if (kpis.topDefects[0]) {
    recommendations.push(
      vi ? `Ưu tiên xử lý lỗi "${kpis.topDefects[0].type}".` : `Prioritize the "${kpis.topDefects[0].type}" defect.`,
    );
  }
  if (kpis.pdmRiskMachines[0] && kpis.pdmRiskMachines[0].failureRisk > 50) {
    recommendations.push(
      vi
        ? `Lên lịch bảo trì sớm cho máy ${kpis.pdmRiskMachines[0].machineCode}.`
        : `Schedule maintenance for machine ${kpis.pdmRiskMachines[0].machineCode}.`,
    );
  }
  recommendations.push(vi ? "Tiếp tục theo dõi và so sánh với kỳ kế tiếp." : "Continue monitoring and compare with next period.");

  return { headline, highlights, risks, recommendations };
}

/** Cố parse các phần từ văn bản LLM; nếu không tách được thì để headline=toàn bộ, phần khác rỗng. */
function parseLlmText(text: string): { headline: string; highlights: string[]; risks: string[]; recommendations: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const section: { headline: string; highlights: string[]; risks: string[]; recommendations: string[] } = {
    headline: "",
    highlights: [],
    risks: [],
    recommendations: [],
  };
  let bucket: "highlights" | "risks" | "recommendations" | null = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/^(headline|tiêu đề)\b/i.test(line)) {
      section.headline = line.replace(/^(headline|tiêu đề)\s*[:\-]?\s*/i, "").trim();
      bucket = null;
      continue;
    }
    if (/(highlight|điểm nổi bật|nổi bật)/i.test(lower)) { bucket = "highlights"; continue; }
    if (/(risk|rủi ro|nguy cơ)/i.test(lower)) { bucket = "risks"; continue; }
    if (/(recommend|khuyến nghị|đề xuất)/i.test(lower)) { bucket = "recommendations"; continue; }
    const bullet = line.replace(/^[\-\*\d\.\)•]+\s*/, "").trim();
    if (!bullet) continue;
    if (bucket) section[bucket].push(bullet);
    else if (!section.headline) section.headline = bullet;
  }
  return section;
}

// ─── Public: generate structured summary ───────────────────────

/**
 * Sinh tóm tắt điều hành có cấu trúc cho kỳ. KHÔNG ném — LLM lỗi → fallback offline.
 */
export async function generateExecutiveSummary(
  period: ReportPeriod,
  lang: ReportLang = (process.env.EXEC_REPORT_LANG as ReportLang) || "vi",
  now?: Date,
): Promise<ExecutiveSummaryStructured> {
  const kpis = await gatherKpis(period, lang, now);

  let generatedBy: "gguf" | "offline" = "offline";
  let model: string | undefined;
  let parsed = offlineSummary(kpis);

  try {
    // Model Router: task:"report" → hard → Tier 2 (deep model) decode params.
    const { route } = await import("./aiModelRouter");
    const decision = route({ task: "report", requiredQuality: "high" });
    const { generateNarrative } = await import("./aiProviderRouter");
    const result = await generateNarrative({
      systemPrompt: buildSystemPrompt(lang),
      prompt: buildUserPrompt(kpis),
      maxTokens: decision.maxTokens,
      temperature: decision.temperature,
      language: lang,
      cacheKey: `exec-report:${period}:${kpis.window.start}:${lang}`,
    });
    if (result.text && result.text.trim().length > 0) {
      const fromLlm = parseLlmText(result.text);
      // Chỉ thay phần nào LLM thực sự cung cấp; còn lại giữ offline để không rỗng.
      parsed = {
        headline: fromLlm.headline || parsed.headline,
        highlights: fromLlm.highlights.length ? fromLlm.highlights : parsed.highlights,
        risks: fromLlm.risks.length ? fromLlm.risks : parsed.risks,
        recommendations: fromLlm.recommendations.length ? fromLlm.recommendations : parsed.recommendations,
      };
      generatedBy = result.provider === "gguf" ? "gguf" : "offline";
      model = result.model;
    }
  } catch (err) {
    console.error("[aiExecutiveReport] LLM narrative failed, using offline summary:", (err as any)?.message || err);
  }

  return {
    period,
    lang,
    window: kpis.window,
    headline: parsed.headline,
    highlights: parsed.highlights,
    risks: parsed.risks,
    recommendations: parsed.recommendations,
    kpiTable: buildKpiTable(kpis, lang),
    kpis,
    generatedBy,
    model,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Persistence (ai_insights, source='exec_report') ───────────

export const EXEC_REPORT_SOURCE = "exec_report";

function summaryTitle(s: ExecutiveSummaryStructured): string {
  const pl = periodLabel(s.period, s.lang);
  const prefix = s.lang === "vi" ? "Báo cáo điều hành" : "Executive report";
  return `${prefix} — ${pl} (${s.window.end.slice(0, 16).replace("T", " ")})`.slice(0, 255);
}

/** Lưu summary vào ai_insights; trả về id (hoặc null nếu DB không sẵn sàng). Không ném. */
export async function persistExecutiveSummary(s: ExecutiveSummaryStructured): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const body = [s.headline, "", ...s.highlights.map((h) => `• ${h}`)].join("\n").slice(0, 8000);
    const recommendation = s.recommendations.map((r) => `• ${r}`).join("\n").slice(0, 8000);
    const severity = s.kpis.ngRate > 5 || s.risks.length > 2 ? "warning" : "info";
    const [row] = await db
      .insert(aiInsights)
      .values({
        source: EXEC_REPORT_SOURCE,
        severity,
        title: summaryTitle(s),
        body,
        recommendation,
        contextJson: { ...(s as unknown as Record<string, unknown>), reportPeriod: s.period },
      })
      .returning({ id: aiInsights.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("[aiExecutiveReport] persist failed:", (err as any)?.message || err);
    return null;
  }
}

export interface PersistedExecSummary {
  id: number;
  period: ReportPeriod | null;
  title: string;
  severity: string;
  createdAt: Date;
  summary: ExecutiveSummaryStructured | null;
}

/** Lấy các báo cáo điều hành đã lưu (mới nhất trước), tuỳ chọn lọc theo kỳ. */
export async function getExecutiveSummaries(opts?: {
  period?: ReportPeriod;
  limit?: number;
}): Promise<PersistedExecSummary[]> {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const rows = await db
    .select()
    .from(aiInsights)
    .where(eq(aiInsights.source, EXEC_REPORT_SOURCE))
    .orderBy(desc(aiInsights.createdAt))
    .limit(limit);
  const filtered = opts?.period
    ? rows.filter((r) => (r.contextJson as any)?.reportPeriod === opts.period)
    : rows;
  return filtered.map((r) => ({
    id: r.id,
    period: ((r.contextJson as any)?.reportPeriod as ReportPeriod) ?? null,
    title: r.title,
    severity: r.severity,
    createdAt: r.createdAt,
    summary: (r.contextJson as unknown as ExecutiveSummaryStructured) ?? null,
  }));
}

// ─── Manual trigger (admin/test, on-demand) ────────────────────

/**
 * Sinh + lưu một báo cáo điều hành ngay (không chờ cron). Dùng cho admin/UI/test.
 * Trả về summary và id đã lưu (id=null nếu DB không sẵn sàng). Không ném.
 */
export async function runExecutiveReportNow(
  period: ReportPeriod = "day",
  lang?: ReportLang,
): Promise<{ summary: ExecutiveSummaryStructured; insightId: number | null }> {
  const summary = await generateExecutiveSummary(period, lang);
  const insightId = await persistExecutiveSummary(summary);
  return { summary, insightId };
}
