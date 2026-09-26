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
  /**
   * doc 69 T9 (security fast-follow) — set when this bundle was narrowed to a single
   * factory's data (factory-scoped caller). Undefined = system-wide (global/admin),
   * matching every pre-existing report. Persisted verbatim into `ai_insights.contextJson`
   * (see `persistExecutiveSummary`/`getExecutiveSummaries`) so scoped rows can be
   * filtered back out for the caller that generated them, never mixed with another
   * factory's or the global aggregate.
   */
  factoryCode?: string;
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
  /**
   * FE-W0.3 (doc 46 §2.3) — set when the generation guard rejected/truncated a
   * degenerate LLM output (e.g. "cell cell cell…" loop). When true the narrative
   * fell back to the honest offline/rule-based summary instead of showing garbage.
   */
  degraded?: boolean;
  degradedReason?: string;
}

// ─── Period windows ────────────────────────────────────────────

const SHIFT_HOURS = Number(process.env.EXEC_REPORT_SHIFT_HOURS || "8");

// FE-W0.3 (doc 46 §2.3) — anti-degenerate-loop decode params for the exec-summary
// narrative. An executive summary is SHORT, so cap tokens hard and use a stronger
// repeat penalty than the engine default (1.1) to discourage token loops.
const EXEC_REPORT_MAX_TOKENS = (() => {
  const n = Number(process.env.EXEC_REPORT_MAX_TOKENS || "800");
  return Number.isFinite(n) && n > 0 ? n : 800;
})();
const EXEC_REPORT_REPEAT_PENALTY = (() => {
  const n = Number(process.env.EXEC_REPORT_REPEAT_PENALTY || "1.3");
  return Number.isFinite(n) && n >= 1 ? n : 1.3;
})();

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
  factoryCode?: string,
): Promise<{ total: number; ok: number; ng: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const { productInspections } = await import("../../drizzle/schema");
  const conditions = [
    sql`${productInspections.inspectionTime} >= ${start.toISOString()}`,
    sql`${productInspections.inspectionTime} <= ${end.toISOString()}`,
  ];
  // doc 69 T9 — productInspections carries a native `factoryCode` column (indexed:
  // idx_inspections_factory), so a factory-scoped caller's totals can be narrowed
  // exactly like `getYieldTrendData`'s own `factoryCode` filter below.
  if (factoryCode) conditions.push(eq(productInspections.factoryCode, factoryCode));
  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      ok: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'OK')`,
      ng: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`,
    })
    .from(productInspections)
    .where(and(...conditions));
  return { total: Number(row?.total) || 0, ok: Number(row?.ok) || 0, ng: Number(row?.ng) || 0 };
}

/**
 * Máy đang hoạt động thuộc một nhà máy cụ thể (cho PdM risk, khi bundle bị siết theo
 * factory) — doc 69 T9. `getMachines()` (nguồn cho đường KHÔNG siết) không lọc theo
 * nhà máy; ở đây tái dùng `getMachinesWithHierarchy()` (đã JOIN tới `factories`) và lọc
 * trong bộ nhớ theo `factory.code`, tránh phải thêm hàm export mới trong hierarchy.ts.
 */
async function getMachinesForFactory(factoryCode: string): Promise<Array<{ id: number; code: string }>> {
  const { getMachinesWithHierarchy } = await import("../db/hierarchy");
  const rows = await getMachinesWithHierarchy();
  return (rows || [])
    .filter((r: any) => r?.factory?.code === factoryCode)
    .map((r: any) => r.machine)
    .filter((m: any): m is { id: number; code: string } => !!m);
}

/**
 * Thu thập một bundle KPI gọn cho kỳ. Mỗi nguồn được bọc try/catch riêng — một nguồn
 * lỗi sẽ ghi vào dataWarnings và để giá trị mặc định, KHÔNG ném ra ngoài.
 *
 * `factoryCode` (doc 69 T9, security fast-follow): khi được cung cấp, MỌI nguồn KPI bên
 * dưới được siết về đúng một nhà máy đó (không còn tổng hợp toàn hệ thống). Bỏ trống =
 * hành vi TOÀN CỤC gốc (dùng bởi scheduler cron + trigger admin thủ công) — không đổi.
 */
export async function gatherKpis(
  period: ReportPeriod,
  lang: ReportLang = "vi",
  now?: Date,
  factoryCode?: string,
): Promise<KpiBundle> {
  const { start, end } = periodWindow(period, now);
  const dataWarnings: string[] = [];

  // 1) Throughput / yield hiện tại + kỳ trước (cho xu hướng NG)
  let totals = { total: 0, ok: 0, ng: 0 };
  let prevNgRate = 0;
  try {
    const cur = await collectInspectionTotals(start, end, factoryCode);
    if (cur) totals = cur;
    const durationMs = end.getTime() - start.getTime();
    const prev = await collectInspectionTotals(new Date(start.getTime() - durationMs), start, factoryCode);
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
    // doc 69 T9 — getYieldTrendData already accepts a factoryCode filter; simply thread
    // it through instead of always aggregating every factory.
    const trend = await getYieldTrendData({ startDate: start, endDate: end, interval, factoryCode });
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
    // doc 69 T9 — paretoByDefectType filters by numeric factoryId (joins through
    // workshop→line→station), not factoryCode; resolve the code once when scoped.
    // FAIL CLOSED: if a factoryCode was requested but doesn't resolve to a real
    // factory, do NOT silently fall through to an unscoped (all-factory) query —
    // that would re-open the exact leak this task closes for an edge case. Skip
    // the section instead (recorded as a data warning, same as any other source
    // outage) and let the rest of the bundle proceed.
    let factoryId: number | undefined;
    if (factoryCode) {
      const { getFactoryByCode } = await import("../db/hierarchy");
      const factory = await getFactoryByCode(factoryCode);
      if (!factory?.id) throw new Error(`unknown factoryCode "${factoryCode}"`);
      factoryId = factory.id;
    }
    const pareto = await paretoByDefectType({ startDate: start, endDate: end, limit: 5, factoryId });
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
    const { computeFailureRisk } = await import("./predictiveMaintenanceService");
    // doc 69 T9 — a factory-scoped bundle must only risk-score machines belonging to
    // that factory (getMachinesForFactory, join-filtered); the unscoped/global path
    // (scheduler + admin trigger) is byte-for-byte unchanged (getMachines(), no join).
    let allMachines: Array<{ id: number; code: string }>;
    if (factoryCode) {
      allMachines = await getMachinesForFactory(factoryCode);
    } else {
      const { getMachines } = await import("../db/hierarchy");
      allMachines = await getMachines();
    }
    const machineRows = allMachines.slice(0, maxMachines);
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
    ...(factoryCode ? { factoryCode } : {}),
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
    // ★ 2026-08-16 — `\b` sau `tiêu đề` KHÔNG BAO GIỜ khớp: JS coi ký tự từ là [A-Za-z0-9_],
    // nên `ề` (non-word) đứng cạnh khoảng trắng (non-word) không tạo biên. Đo: "Tiêu đề: …"
    // → false, "Headline: …" → true ⇒ BÁO CÁO ĐIỀU HÀNH TIẾNG VIỆT MẤT DÒNG TIÊU ĐỀ.
    // Thay bằng biên nhận biết Unicode (cần cờ `u`). Cùng lớp lỗi đã vá ở intentClassifier.ts.
    if (/^(headline|tiêu đề)(?![\p{L}\p{N}_])/iu.test(line)) {
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
 *
 * doc 69 T9 (security fast-follow):
 *  - `factoryCode` — khi có, TOÀN BỘ bundle KPI (`gatherKpis`) bị siết về một nhà máy
 *    (xem đó). Bỏ trống = hành vi TOÀN CỤC gốc (scheduler cron + trigger admin) —
 *    không đổi.
 *  - `opts.skipLlm` — bỏ qua tầng LLM sâu (Tier-2/deep model), luôn dùng tóm tắt
 *    rule-based (`offlineSummary`). Dùng cho đường ĐỌC theo-nhu-cầu của người dùng bị
 *    siết nhà máy (router `executiveReportRouter.latest`) — tránh việc MỘT LƯỢT TẢI
 *    TRANG kích hoạt suy luận LLM tốn kém/tranh chấp GPU với các tính năng AI khác;
 *    scheduler cron + `generateNow` (admin) không đặt cờ này nên vẫn dùng LLM như cũ.
 */
export async function generateExecutiveSummary(
  period: ReportPeriod,
  lang: ReportLang = (process.env.EXEC_REPORT_LANG as ReportLang) || "vi",
  now?: Date,
  factoryCode?: string,
  opts?: { skipLlm?: boolean },
): Promise<ExecutiveSummaryStructured> {
  const kpis = await gatherKpis(period, lang, now, factoryCode);

  let generatedBy: "gguf" | "offline" = "offline";
  let model: string | undefined;
  let degraded = false;
  let degradedReason: string | undefined;
  let parsed = offlineSummary(kpis);

  // doc 69 T9 — skipLlm bypasses this whole block; `parsed`/`generatedBy` above
  // (already the honest, real-KPI-driven rule-based summary) fall straight through
  // to the return statement below unchanged.
  if (!opts?.skipLlm) try {
    // Model Router: task:"report" → hard → Tier 2 (deep model) decode params.
    const { route } = await import("./aiModelRouter");
    const decision = route({ task: "report", requiredQuality: "high" });
    const { generateNarrative } = await import("./aiProviderRouter");
    // FE-W0.3 (doc 46 §2.3) — anti-degenerate-loop decode: cap tokens for an exec
    // summary (it should be SHORT), and use a stronger repeat penalty than the
    // engine default (1.1) which still let the "cell cell…" loop through.
    const maxTokens = Math.min(decision.maxTokens, EXEC_REPORT_MAX_TOKENS);
    const result = await generateNarrative({
      systemPrompt: buildSystemPrompt(lang),
      prompt: buildUserPrompt(kpis),
      // doc 48 R1 — PIN the deep model the router chose for task:"report" (Tier 2 / deep, or the
      // Thinking model when that tier is on). Without this the engine's getOrLoadModel(undefined)
      // reuses whatever is RESIDENT — at boot that is the RAG embedder → "PPT slide slide…"
      // gibberish. Mirrors how RCA/codegen pass decision.modelId to the engine. The embedding-model
      // reject + degenerate-loop guard below still catch the honest-degrade (VRAM) path.
      modelId: decision.modelId,
      maxTokens,
      temperature: decision.temperature,
      language: lang,
      repeatPenalty: EXEC_REPORT_REPEAT_PENALTY,
      cacheKey: `exec-report:${period}:${kpis.window.start}:${lang}`,
    });
    // FE-W3 (doc 46) — an EMBEDDING model can never generate coherent narrative.
    // When the generative tier can't load (e.g. VRAM), the engine may fall back to
    // the embedding model, which emits pure gibberish ("PPT slide slide slide…").
    // The repeat-loop guard salvages a "clean head", but that head is ALSO garbage
    // here — so reject embedding-model output outright and keep the offline summary.
    const isEmbeddingNarrative = /embed/i.test(result.model || "");
    if (isEmbeddingNarrative) {
      degraded = true;
      degradedReason = `embedding_model_narrative:${result.model}`;
      console.warn(
        `[aiExecutiveReport] narrative came from an embedding model (${result.model}) — ` +
          `discarding, using offline summary (generative tier unavailable).`,
      );
    }
    // FE-W0.3 (doc 46 §2.3) — GUARDRAIL: reject/salvage degenerate output BEFORE
    // parsing so a "cell cell cell…" loop never reaches management. Unsalvageable
    // → keep the honest offline summary + flag degraded; a clean head → parse it.
    const { guardGeneratedText } = await import("./ai/generationGuard");
    const guard = guardGeneratedText(result.text);
    // Embedding-model output is garbage end-to-end (not just a repeated tail), so its
    // salvaged head is unusable → force the offline summary.
    const usable = isEmbeddingNarrative ? "" : guard.text.trim();
    if (guard.degraded && !isEmbeddingNarrative) {
      degraded = true;
      degradedReason = guard.reason;
      console.warn(
        `[aiExecutiveReport] degenerate LLM narrative rejected (${guard.reason}) — ` +
          `${usable ? "using salvaged head" : "falling back to offline summary"}.`,
      );
    }
    if (usable.length > 0) {
      const fromLlm = parseLlmText(usable);
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
    // else: usable empty (degenerate garbage or no output) → offline summary stays.
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
    ...(degraded ? { degraded, degradedReason } : {}),
  };
}

// ─── Persistence (ai_insights, source='exec_report') ───────────

export const EXEC_REPORT_SOURCE = "exec_report";

function summaryTitle(s: ExecutiveSummaryStructured): string {
  const pl = periodLabel(s.period, s.lang);
  const prefix = s.lang === "vi" ? "Báo cáo điều hành" : "Executive report";
  const scope = s.kpis.factoryCode ? ` [${s.kpis.factoryCode}]` : "";
  return `${prefix}${scope} — ${pl} (${s.window.end.slice(0, 16).replace("T", " ")})`.slice(0, 255);
}

/**
 * Wave 3 §4.4 — một báo cáo không nói gì mà vẫn chiếm chỗ trong hòm chờ đọc
 * chính là thứ dạy người ta bỏ qua cả hòm. Đo được: 111 dòng chỉ mang 36 nội
 * dung khác nhau, nhiều bản `fpy: 0, ngRate: 0`, thân bài 129 ký tự.
 *
 * Vòng sửa 1 (code review) — KHÔNG được kiểm `s.highlights`/`s.risks`/`s.recommendations`:
 * `offlineSummary()` (:368-423) tô ĐẦY cả ba mảng đó bằng câu "không có gì để nói" một
 * cách VÔ ĐIỀU KIỆN — highlights luôn có dòng "Sản lượng: 0 (OK 0/NG 0)", risks luôn rơi
 * về "Không phát hiện rủi ro nghiêm trọng trong kỳ." khi không có rủi ro cụ thể, và
 * recommendations luôn kết bằng "Tiếp tục theo dõi...". `generateExecutiveSummary` chỉ
 * ghi đè một mảng khi LLM THỰC SỰ cung cấp nội dung cho đúng mảng đó (:542-548) — mảng
 * nào LLM không cung cấp thì giữ nguyên bản offline. Do đó `s.highlights.length >= 1`
 * (và risks, recommendations) LUÔN đúng ở MỌI lời gọi thật, khiến 3 nhánh kiểm tra đó là
 * mã chết — báo cáo `fpy:0, ngRate:0` vẫn được lưu y như cũ. Vị từ phải dựa vào tín hiệu
 * KPI THÔ (`s.kpis`), không dựa vào tường thuật đã được tô vẽ TỪ CHÍNH KPI đó.
 */
export function hasReportableContent(s: ExecutiveSummaryStructured): boolean {
  const k = s.kpis as unknown as Partial<KpiBundle> | undefined;
  // Có lượt kiểm tra thật trong kỳ ⇒ có dữ liệu thật để báo cáo (fpy/ngRate/okCount/
  // ngCount đều bằng 0 chính xác khi totalInspections = 0 — xem gatherKpis :202-203 —
  // nên đây là tín hiệu THÔ duy nhất cần cho "có sản lượng hay không").
  if (typeof k?.totalInspections === "number" && k.totalInspections > 0) return true;
  // Không có lượt kiểm tra nào trong kỳ, nhưng có rủi ro máy THẬT (PdM chấm điểm độc
  // lập với sản lượng trong kỳ, dựa trên lịch sử/telemetry máy) ⇒ vẫn đáng báo dù sản
  // lượng bằng 0 — khác với `s.risks` (tường thuật), đây đọc thẳng dữ liệu PdM thô.
  if (Array.isArray(k?.pdmRiskMachines) && k.pdmRiskMachines.some((m) => m?.urgency === "HIGH" || m?.urgency === "CRITICAL")) {
    return true;
  }
  return false;
}

/**
 * Lưu summary vào ai_insights; trả về id (hoặc null nếu DB không sẵn sàng). Không ném.
 *
 * doc 69 T9 (security fast-follow) — tag `reportFactoryCode` vào contextJson (mirror
 * `reportPeriod`, cùng cơ chế lọc) khi `s.kpis.factoryCode` được set (bundle đã bị siết
 * về một nhà máy). `null` = báo cáo TOÀN CỤC (mọi hàng trước task này, + mọi hàng do
 * scheduler/generateNow sinh — không đổi) — never conflated with a factory-scoped row.
 */
/**
 * Vòng sửa cuối (review toàn nhánh, mục 3) — `id` không đủ để phân biệt "vừa lưu
 * MỘT DÒNG MỚI" với "id của một dòng ĐÃ CÓ SẴN" (chống-trùng §4.3 trả về id CŨ) hay
 * "không lưu gì cả" (báo cáo rỗng §4.4, id=null). `notifyExecutiveSummary` chỉ nên
 * chạy ở trường hợp ĐẦU — bắn lại thông báo cho một báo cáo đã gửi rồi, hay bắn
 * thông báo `reportId: undefined` cho một báo cáo không hề tồn tại, chính là thứ
 * dạy người dùng bỏ qua CẢ hòm thông báo lẫn hòm chờ đọc mà §4.4 muốn dọn sạch.
 */
export interface PersistExecutiveSummaryResult {
  /** id của dòng ai_insights (dòng mới HOẶC dòng trùng đã có sẵn); null nếu không lưu. */
  id: number | null;
  /** true CHỈ KHI một dòng MỚI vừa được insert ở lượt gọi NÀY. */
  created: boolean;
}

export async function persistExecutiveSummary(s: ExecutiveSummaryStructured): Promise<PersistExecutiveSummaryResult> {
  try {
    const db = await getDb();
    if (!db) return { id: null, created: false };

    // Wave 3 §4.4 — không lưu báo cáo rỗng; nói rõ lý do thay vì im lặng.
    if (!hasReportableContent(s)) {
      console.log(`[aiExecutiveReport] bỏ qua báo cáo rỗng (${s.period}) — không có KPI khác 0, rủi ro hay điểm nhấn.`);
      return { id: null, created: false };
    }

    // Wave 3 §4.3 — chống trùng theo (source, title). Tiêu đề đã chứa sẵn kỳ và
    // mốc thời gian, nên trùng tiêu đề = chạy lặp cùng một kỳ.
    const title = summaryTitle(s);
    const existing = await db
      .select({ id: aiInsights.id })
      .from(aiInsights)
      .where(and(eq(aiInsights.source, EXEC_REPORT_SOURCE), eq(aiInsights.title, title)))
      .limit(1);
    if (existing[0]) {
      console.log(`[aiExecutiveReport] đã có báo cáo cùng tiêu đề (#${existing[0].id}) — không tạo bản trùng.`);
      return { id: existing[0].id, created: false };
    }

    const body = [s.headline, "", ...s.highlights.map((h) => `• ${h}`)].join("\n").slice(0, 8000);
    const recommendation = s.recommendations.map((r) => `• ${r}`).join("\n").slice(0, 8000);
    const severity = s.kpis.ngRate > 5 || s.risks.length > 2 ? "warning" : "info";
    const [row] = await db
      .insert(aiInsights)
      .values({
        source: EXEC_REPORT_SOURCE,
        severity,
        title,
        body,
        recommendation,
        contextJson: {
          ...(s as unknown as Record<string, unknown>),
          reportPeriod: s.period,
          reportFactoryCode: s.kpis.factoryCode ?? null,
        },
      })
      .returning({ id: aiInsights.id });
    return { id: row?.id ?? null, created: row?.id != null };
  } catch (err) {
    console.error("[aiExecutiveReport] persist failed:", (err as any)?.message || err);
    return { id: null, created: false };
  }
}

export interface PersistedExecSummary {
  id: number;
  period: ReportPeriod | null;
  /** doc 69 T9 — null/undefined = system-wide (global) report; set = scoped to one factory. */
  factoryCode?: string | null;
  title: string;
  severity: string;
  createdAt: Date;
  summary: ExecutiveSummaryStructured | null;
}

/**
 * Lấy các báo cáo điều hành đã lưu (mới nhất trước), tuỳ chọn lọc theo kỳ.
 *
 * doc 69 T9 (security fast-follow) — `factoryCode`, khi được truyền, lọc NGAY TRONG SQL
 * (jsonb `->>`) trước `LIMIT`, không phải lọc hậu-kỳ trong JS như `period` từng làm —
 * nếu không, một người dùng bị siết nhà máy có thể xin `limit` hàng lâu đời hơn số hàng
 * thực sự thuộc nhà máy họ trong N bản ghi TOÀN HỆ THỐNG mới nhất (gần như luôn rỗng vì
 * đa số lịch sử vẫn là báo cáo toàn cục). Bỏ trống `factoryCode` = hành vi ADMIN/TOÀN CỤC
 * gốc — thấy MỌI hàng (cả toàn cục lẫn theo-nhà-máy), không đổi.
 */
export async function getExecutiveSummaries(opts?: {
  period?: ReportPeriod;
  limit?: number;
  factoryCode?: string;
}): Promise<PersistedExecSummary[]> {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const conditions = [eq(aiInsights.source, EXEC_REPORT_SOURCE)];
  if (opts?.period) {
    conditions.push(sql`${aiInsights.contextJson}->>'reportPeriod' = ${opts.period}`);
  }
  if (opts?.factoryCode) {
    conditions.push(sql`${aiInsights.contextJson}->>'reportFactoryCode' = ${opts.factoryCode}`);
  }
  const rows = await db
    .select()
    .from(aiInsights)
    .where(and(...conditions))
    .orderBy(desc(aiInsights.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    period: ((r.contextJson as any)?.reportPeriod as ReportPeriod) ?? null,
    factoryCode: ((r.contextJson as any)?.reportFactoryCode as string | null | undefined) ?? null,
    title: r.title,
    severity: r.severity,
    createdAt: r.createdAt,
    summary: (r.contextJson as unknown as ExecutiveSummaryStructured) ?? null,
  }));
}

// ─── Push notification to managers (in-app + optional email) ───

/** Liên kết tới trang UI hiển thị báo cáo điều hành đã lưu. */
const EXEC_REPORT_LINK = "/management-insight";

interface NotifyRecipient {
  id: number;
  email: string | null;
}

/** Parse một CSV env an toàn → mảng chuỗi đã trim, bỏ rỗng. */
function csvEnv(name: string): string[] {
  return (process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Giải quyết danh sách người nhận: users có role thuộc tập cấu hình
 * (mặc định admin, supervisor — env EXEC_REPORT_NOTIFY_ROLES csv) hợp với
 * EXEC_REPORT_NOTIFY_USER_IDS (csv id) — đã dedup theo id. Không ném.
 */
export async function resolveExecReportRecipients(): Promise<NotifyRecipient[]> {
  const roles = new Set(
    (csvEnv("EXEC_REPORT_NOTIFY_ROLES").length ? csvEnv("EXEC_REPORT_NOTIFY_ROLES") : ["admin", "supervisor"]).map((r) =>
      r.toLowerCase(),
    ),
  );
  const explicitIds = new Set(csvEnv("EXEC_REPORT_NOTIFY_USER_IDS").map((s) => Number(s)).filter((n) => Number.isFinite(n)));

  const byId = new Map<number, NotifyRecipient>();
  try {
    const { getAllUsers } = await import("../db/auth");
    const users = (await getAllUsers()) as Array<{ id: number; role?: string | null; email?: string | null; isActive?: boolean | null }>;
    for (const u of users || []) {
      if (!u || typeof u.id !== "number") continue;
      const matchesRole = roles.has(String(u.role || "").toLowerCase());
      const matchesId = explicitIds.has(u.id);
      if (!matchesRole && !matchesId) continue;
      if (u.isActive === false) continue;
      byId.set(u.id, { id: u.id, email: u.email ?? null });
    }
  } catch (err) {
    console.error("[aiExecutiveReport] resolve recipients failed:", (err as any)?.message || err);
  }
  return Array.from(byId.values());
}

/** Tóm tắt một câu cho body thông báo: highlight đầu, hoặc risk đầu. */
function notifyBody(s: ExecutiveSummaryStructured): string {
  const first = s.highlights[0] || s.risks[0] || s.recommendations[0] || "";
  return String(first).slice(0, 280);
}

/** Render email HTML đơn giản (headline + KPI table + highlights/risks/recommendations). */
function renderExecReportEmailHtml(s: ExecutiveSummaryStructured): string {
  const esc = (v: string) =>
    String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const vi = s.lang === "vi";
  const L = (a: string, b: string) => (vi ? a : b);
  const link = `${process.env.VITE_FRONTEND_FORGE_API_URL || "http://localhost:3000"}${EXEC_REPORT_LINK}`;
  const section = (title: string, items: string[]) =>
    items.length
      ? `<h3 style="color:#2563eb;margin:18px 0 6px;">${esc(title)}</h3><ul style="margin:0;padding-left:20px;">${items
          .map((i) => `<li style="margin:4px 0;">${esc(i)}</li>`)
          .join("")}</ul>`
      : "";
  const kpiRows = s.kpiTable
    .map(
      (k) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#374151;">${esc(k.label)}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">${esc(k.value)}</td></tr>`,
    )
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;color:#1f2937;">
      <div style="background:#2563eb;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">${esc(s.headline || L("Báo cáo điều hành", "Executive report"))}</h2>
      </div>
      <div style="background:#f8fafc;padding:20px 22px;border-radius:0 0 8px 8px;">
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;">${kpiRows}</table>
        ${section(L("Điểm nổi bật", "Highlights"), s.highlights)}
        ${section(L("Rủi ro", "Risks"), s.risks)}
        ${section(L("Khuyến nghị", "Recommendations"), s.recommendations)}
        <p style="margin-top:20px;">
          <a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">
            ${esc(L("Xem báo cáo đầy đủ", "View full report"))}
          </a>
        </p>
        <p style="font-size:11px;color:#9ca3af;margin-top:18px;">
          ${esc(L("Báo cáo tự động từ hệ thống SYNAPSE", "Automated report from SYNAPSE"))}
        </p>
      </div>
    </div>`.trim();
}

/** Render bản text thuần (fallback cho email client không hiển thị HTML). */
function renderExecReportEmailText(s: ExecutiveSummaryStructured): string {
  const vi = s.lang === "vi";
  const L = (a: string, b: string) => (vi ? a : b);
  const lines: string[] = [s.headline, ""];
  lines.push(...s.kpiTable.map((k) => `${k.label}: ${k.value}`));
  const block = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push("", title);
    lines.push(...items.map((i) => `- ${i}`));
  };
  block(L("Điểm nổi bật", "Highlights"), s.highlights);
  block(L("Rủi ro", "Risks"), s.risks);
  block(L("Khuyến nghị", "Recommendations"), s.recommendations);
  return lines.join("\n");
}

/**
 * PUSH báo cáo điều hành tới các quản lý: thông báo in-app (luôn) + email (tuỳ chọn).
 *
 *  - Người nhận: resolveExecReportRecipients() (role-based + explicit ids, dedup).
 *  - In-app: sendReportNotification cho từng người (title = headline, body = highlight/risk đầu,
 *    link tới /management-insight). No-op an toàn nếu không có người nhận.
 *  - Email: chỉ khi EXEC_REPORT_EMAIL_ENABLED=true VÀ SMTP đã cấu hình (SMTP_HOST/USER/PASS|PASSWORD).
 *    Bỏ qua im lặng nếu tắt/thiếu SMTP/không có email người nhận.
 *  - FAIL-SAFE: mọi lỗi gửi được bắt + log theo từng người nhận; KHÔNG bao giờ ném
 *    (không được làm hỏng việc tạo báo cáo / scheduler).
 *
 * @returns thống kê gửi (để test/log) — không ném.
 */
export async function notifyExecutiveSummary(
  summary: ExecutiveSummaryStructured,
  insightId?: number | null,
): Promise<{ recipients: number; inAppSent: number; emailsSent: number }> {
  const stats = { recipients: 0, inAppSent: 0, emailsSent: 0 };
  try {
    const recipients = await resolveExecReportRecipients();
    stats.recipients = recipients.length;
    if (recipients.length === 0) return stats; // safe no-op

    const title = (summary.headline || (summary.lang === "vi" ? "Báo cáo điều hành" : "Executive report")).slice(0, 200);
    const message = notifyBody(summary);

    // ── In-app (always on when notify enabled) ──
    let notif: typeof import("./notificationService") | null = null;
    try {
      notif = await import("./notificationService");
    } catch (err) {
      console.error("[aiExecutiveReport] notificationService unavailable:", (err as any)?.message || err);
    }
    if (notif) {
      for (const r of recipients) {
        try {
          await notif.sendReportNotification(r.id, {
            title,
            message,
            reportId: insightId ?? undefined,
            actionUrl: EXEC_REPORT_LINK,
          });
          stats.inAppSent++;
        } catch (err) {
          console.error(`[aiExecutiveReport] in-app notify failed for user ${r.id}:`, (err as any)?.message || err);
        }
      }
    }

    // ── Email (optional) ──
    const emailEnabled = (process.env.EXEC_REPORT_EMAIL_ENABLED || "").toLowerCase() === "true";
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && (process.env.SMTP_PASS || process.env.SMTP_PASSWORD));
    if (emailEnabled && smtpConfigured) {
      const emails = recipients.map((r) => r.email).filter((e): e is string => !!e && e.includes("@"));
      if (emails.length > 0) {
        try {
          const { sendEmail } = await import("../_core/email");
          const subject = `[SYNAPSE] ${title}`.slice(0, 200);
          const html = renderExecReportEmailHtml(summary);
          const text = renderExecReportEmailText(summary);
          for (const email of emails) {
            try {
              const res = await sendEmail({ to: email, subject, html, text });
              if (res?.success) stats.emailsSent++;
            } catch (err) {
              console.error(`[aiExecutiveReport] email failed for ${email}:`, (err as any)?.message || err);
            }
          }
        } catch (err) {
          console.error("[aiExecutiveReport] email module unavailable:", (err as any)?.message || err);
        }
      }
    }
  } catch (err) {
    // Lá chắn cuối — push KHÔNG BAO GIỜ làm hỏng việc tạo báo cáo.
    console.error("[aiExecutiveReport] notifyExecutiveSummary failed:", (err as any)?.message || err);
  }
  return stats;
}

// ─── Manual trigger (admin/test, on-demand) ────────────────────

/**
 * Sinh + lưu một báo cáo điều hành ngay (không chờ cron). Dùng cho admin/UI/test.
 * Trả về summary và id đã lưu (id=null nếu DB không sẵn sàng). Không ném.
 * Sau khi lưu, PUSH thông báo tới quản lý nếu EXEC_REPORT_NOTIFY_ENABLED (mặc định bật).
 *
 * doc 69 T9 (security fast-follow):
 *  - `factoryCode` — thread through to `generateExecutiveSummary`/`persistExecutiveSummary`
 *    so the persisted row is tagged (see there). Scheduler cron (`reportScheduler.ts
 *    runExecutiveReport`) and the admin `generateNow` mutation both call this with NO
 *    factoryCode — their behavior (global report, LLM narrative, notify) is unchanged.
 *  - `opts.notify` (default true) — the ROUTER's on-demand path for a factory-scoped
 *    reader (`executiveReportRouter.latest`) passes `false`: `resolveExecReportRecipients`
 *    is role-based only (NOT factory-aware — see its own docstring), so notifying on a
 *    mere READ from one factory's viewer would broadcast to every admin/supervisor
 *    system-wide for a report they didn't ask for. Only an actual admin action (cron tick
 *    or the admin's own manual "Tạo ngay" button) should ever trigger a push.
 *  - `opts.skipLlm` — threaded to `generateExecutiveSummary` (see there).
 */
export async function runExecutiveReportNow(
  period: ReportPeriod = "day",
  lang?: ReportLang,
  factoryCode?: string,
  opts?: { notify?: boolean; skipLlm?: boolean },
): Promise<{ summary: ExecutiveSummaryStructured; insightId: number | null }> {
  const summary = await generateExecutiveSummary(period, lang, undefined, factoryCode, { skipLlm: opts?.skipLlm });
  const persisted = await persistExecutiveSummary(summary);
  const insightId = persisted.id;

  // PUSH (in-app + optional email). Default ON; fail-safe (never throws).
  const notifyEnabled =
    (opts?.notify ?? true) && (process.env.EXEC_REPORT_NOTIFY_ENABLED || "true").toLowerCase() !== "false";
  // Vòng sửa cuối (mục 3) — CHỈ bắn thông báo khi lượt gọi NÀY thực sự vừa lưu một
  // dòng MỚI (persisted.created). id không-null KHÔNG đủ: có thể là id của một báo
  // cáo trùng đã gửi rồi (§4.3), và id=null (báo cáo rỗng, §4.4) trước đây vẫn lọt
  // qua vì notify chỉ gate theo notifyEnabled — bắn thông báo `reportId: undefined`
  // cho một báo cáo không hề được lưu.
  if (notifyEnabled && persisted.created) {
    await notifyExecutiveSummary(summary, insightId);
  }
  return { summary, insightId };
}
