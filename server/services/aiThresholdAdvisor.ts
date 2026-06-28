/**
 * AI Threshold / Param Advisor (LUỒNG ② — doc 06 Technician Copilot).
 *
 * Goal: AI computes the RIGHT threshold/parameter values from data; the
 * technician only APPROVES. This service is read-only and fail-safe — it
 * never mutates anything and never throws. Applying a recommendation always
 * goes through an existing HITL path (the router wires that up):
 *   - measurement-point limits → thresholdApproval flow.
 *   - NG-rate thresholds       → proposeAction(adjust_ng_threshold) + confirm.
 *
 * Flag-gated: AI_THRESHOLD_ADVISOR_ENABLED (default OFF) → recommend* return a
 * disabled no-op result. When data is thin (< AI_THRESHOLD_ADVISOR_MIN_SAMPLES,
 * default 300) the result is honestly marked `degraded` with a conservative
 * recommendation.
 *
 * Heavy stats live in server/utils/thresholdSuggestion.ts (suggestThresholds);
 * we reuse it for the measurement-point path rather than re-implementing it.
 */

import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import * as productDb from "../db/product";
import { suggestThresholds } from "../utils/thresholdSuggestion";
import {
  measurementResults,
  productInspections,
  mqttNgRateThresholds,
} from "../../drizzle/schema";

// ─── Flags / constants ────────────────────────────────────────────────────────

export function isThresholdAdvisorEnabled(): boolean {
  return (process.env.AI_THRESHOLD_ADVISOR_ENABLED ?? "false").toLowerCase() === "true";
}

export function minSamples(): number {
  const n = Number(process.env.AI_THRESHOLD_ADVISOR_MIN_SAMPLES ?? 300);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
}

/** Bounds of the adjust_ng_threshold tool (warning/critical are NG-rate %). */
export const NG_THRESHOLD_BOUNDS = { min: 0, max: 100 } as const;

// ─── Shared result shapes (mirrored by the frontend) ──────────────────────────

export interface PointRecommendation {
  ok: boolean;
  disabled?: boolean;
  pointDefId: number;
  code: string | null;
  name: string | null;
  unit: string | null;
  current: { lsl: number | null; usl: number | null; target: number | null; cpk: number | null };
  recommended: { lsl: number; usl: number; target: number; projectedCpk: number };
  sampleSize: number;
  confidence: number; // 0..1
  basis: string;
  degraded: boolean;
  /** True when the measured data is grossly inconsistent with the configured limits
   *  (likely wrong unit/config) → the recommendation is unreliable; flag for a human
   *  to review instead of auto-tuning. */
  needsReview?: boolean;
  note?: string;
}

export interface NgRecommendation {
  ok: boolean;
  disabled?: boolean;
  ngThresholdId: number;
  name: string | null;
  current: { warning: number | null; critical: number | null };
  recommended: { warning: number; critical: number };
  sampleSize: number;
  basis: string;
  degraded: boolean;
  note?: string;
}

export interface InspectionParamRecommendation {
  ok: boolean;
  disabled?: boolean;
  ngThresholdId: number;
  current: { minSampleSize: number | null; cooldownMinutes: number | null };
  recommended: { minSampleSize: number; cooldownMinutes: number };
  sampleSize: number;
  basis: string;
  degraded: boolean;
  note?: string;
}

// ─── Pure helpers (exported for tests) ────────────────────────────────────────

export function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

export function round2(v: number): number {
  return Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
}

function toNum(x: unknown): number | null {
  if (x == null) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Pure NG-rate recommendation from a list of recent interval NG rates (%).
 * Strategy: warning = an upper percentile (p75) of the observed NG-rate
 * distribution + a small margin; critical = a higher percentile (p90) + margin.
 * Both CLAMPED to the tool bounds (0..100) and ordered critical >= warning.
 * Degraded when fewer than `min` observations.
 */
export function computeNgRecommendation(
  rates: number[],
  opts: { min: number; bounds?: { min: number; max: number }; fallbackWarning?: number; fallbackCritical?: number },
): { warning: number; critical: number; sampleSize: number; degraded: boolean; basis: string } {
  const bounds = opts.bounds ?? NG_THRESHOLD_BOUNDS;
  const valid = rates.filter((r) => typeof r === "number" && Number.isFinite(r) && r >= 0);
  const n = valid.length;

  if (n === 0) {
    const warning = clamp(opts.fallbackWarning ?? 5, bounds.min, bounds.max);
    const critical = clamp(Math.max(warning, opts.fallbackCritical ?? 10), bounds.min, bounds.max);
    return {
      warning: round2(warning),
      critical: round2(critical),
      sampleSize: 0,
      degraded: true,
      basis: "Không có dữ liệu NG-rate gần đây — dùng giá trị bảo thủ mặc định.",
    };
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const p75 = quantileSorted(sorted, 0.75);
  const p90 = quantileSorted(sorted, 0.90);
  const p50 = quantileSorted(sorted, 0.5);
  // Margin scales with spread but stays modest.
  const spread = Math.max(0, p90 - p50);
  const warnMargin = Math.max(0.5, spread * 0.5);
  const critMargin = Math.max(1, spread);

  let warning = clamp(p75 + warnMargin, bounds.min, bounds.max);
  let critical = clamp(p90 + critMargin, bounds.min, bounds.max);
  // Conservative when thin: widen the gap a touch so we don't alert too eagerly.
  const degraded = n < opts.min;
  if (degraded) {
    warning = clamp(warning + 1, bounds.min, bounds.max);
    critical = clamp(critical + 2, bounds.min, bounds.max);
  }
  if (critical < warning) critical = warning;

  const basis =
    `${n} khoảng đo NG-rate, p75=${round2(p75)}% → cảnh báo, p90=${round2(p90)}% → nghiêm trọng` +
    `, biên an toàn +${round2(warnMargin)}/${round2(critMargin)}%`;

  return { warning: round2(warning), critical: round2(critical), sampleSize: n, degraded, basis };
}

// ─── Data access (fail-safe) ──────────────────────────────────────────────────

/**
 * Recent per-day NG rates (%) for a threshold's scope (machine + point),
 * over the last `days` days. Each day with at least 1 inspection becomes one
 * observation. Best-effort: returns [] on any failure.
 */
async function recentDailyNgRates(opts: {
  machineId?: number | null;
  measurementPointId?: number | null;
  days: number;
}): Promise<number[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);
    const conds: any[] = [gte(productInspections.inspectionTime, since)];
    if (opts.machineId != null) conds.push(eq(productInspections.machineId, opts.machineId));
    if (opts.measurementPointId != null) conds.push(eq(measurementResults.pointDefId, opts.measurementPointId));

    const rows = await db
      .select({
        day: sql<string>`date_trunc('day', ${productInspections.inspectionTime})`.as("day"),
        total: sql<number>`COUNT(*)`.as("total"),
        ng: sql<number>`SUM(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 ELSE 0 END)`.as("ng"),
      })
      .from(measurementResults)
      .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
      .where(and(...conds))
      .groupBy(sql`date_trunc('day', ${productInspections.inspectionTime})`)
      .orderBy(desc(sql`date_trunc('day', ${productInspections.inspectionTime})`))
      .limit(Math.max(1, opts.days));

    const out: number[] = [];
    for (const r of rows) {
      const total = Number(r.total);
      const ng = Number(r.ng);
      if (total > 0) out.push((ng / total) * 100);
    }
    return out;
  } catch (err) {
    console.warn("[aiThresholdAdvisor] recentDailyNgRates failed:", err);
    return [];
  }
}

/** Count of measurement results in scope over `days` — for inspection-param throughput. */
async function inspectionThroughput(opts: {
  machineId?: number | null;
  measurementPointId?: number | null;
  days: number;
}): Promise<{ total: number; perDay: number }> {
  try {
    const db = await getDb();
    if (!db) return { total: 0, perDay: 0 };
    const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);
    const conds: any[] = [gte(productInspections.inspectionTime, since)];
    if (opts.machineId != null) conds.push(eq(productInspections.machineId, opts.machineId));
    if (opts.measurementPointId != null) conds.push(eq(measurementResults.pointDefId, opts.measurementPointId));
    const [row] = await db
      .select({ total: sql<number>`COUNT(*)`.as("total") })
      .from(measurementResults)
      .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
      .where(and(...conds));
    const total = Number(row?.total ?? 0);
    return { total, perDay: total / Math.max(1, opts.days) };
  } catch (err) {
    console.warn("[aiThresholdAdvisor] inspectionThroughput failed:", err);
    return { total: 0, perDay: 0 };
  }
}

async function getNgThresholdRow(id: number) {
  try {
    const db = await getDb();
    if (!db) return null;
    const [row] = await db.select().from(mqttNgRateThresholds).where(eq(mqttNgRateThresholds.id, id)).limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Recommend LSL/USL/target for a measurement point from recent samples.
 * Reuses suggestThresholds. Honest-degrade when sampleSize < minSamples().
 */
/**
 * Read recent measured values for a point.
 *   PRIMARY  = measurement_results.measuredValue (real production inspection data)
 *   FALLBACK = measurement_samples.value         (SPC sample table)
 * When windowDays is omitted, takes the latest `windowSize` values regardless of age
 * (on-demand advisor — works even when the freshest data is older than a window).
 * Fail-safe: any error → fall back to samples; never throws.
 */
async function getPointValues(
  pointDefId: number,
  opts: { windowDays?: number; windowSize: number },
): Promise<{ values: number[]; source: "results" | "samples" | "none" }> {
  const since = opts.windowDays ? new Date(Date.now() - opts.windowDays * 24 * 60 * 60 * 1000) : undefined;
  const db = await getDb();
  if (db) {
    try {
      const where = since
        ? and(
            eq(measurementResults.pointDefId, pointDefId),
            isNotNull(measurementResults.measuredValue),
            gte(productInspections.inspectionTime, since),
          )
        : and(eq(measurementResults.pointDefId, pointDefId), isNotNull(measurementResults.measuredValue));
      const rows = await db
        .select({ v: measurementResults.measuredValue })
        .from(measurementResults)
        .innerJoin(productInspections, eq(productInspections.id, measurementResults.inspectionId))
        .where(where)
        .orderBy(desc(productInspections.inspectionTime))
        .limit(opts.windowSize);
      const values: number[] = [];
      for (const r of rows) {
        const v = toNum((r as any).v);
        if (v !== null) values.push(v);
      }
      if (values.length > 0) return { values, source: "results" };
    } catch (err) {
      console.warn("[aiThresholdAdvisor] measured-values read failed, falling back to samples:", (err as Error)?.message ?? err);
    }
  }
  // Fallback: measurement_samples (SPC).
  try {
    const rows = await productDb.listMeasurementSamples({ pointDefId, windowSize: opts.windowSize, fromTs: since });
    const values: number[] = [];
    for (const r of rows) {
      const v = toNum((r as any).value);
      if (v !== null) values.push(v);
    }
    return { values, source: values.length > 0 ? "samples" : "none" };
  } catch {
    return { values: [], source: "none" };
  }
}

export async function recommendForMeasurementPoint(input: {
  measurementPointId: number;
  productModelId?: number;
  machineId?: number;
  windowSize?: number;
  windowDays?: number;
}): Promise<PointRecommendation> {
  const minN = minSamples();
  const disabledResult = (note: string): PointRecommendation => ({
    ok: true,
    disabled: true,
    pointDefId: input.measurementPointId,
    code: null,
    name: null,
    unit: null,
    current: { lsl: null, usl: null, target: null, cpk: null },
    recommended: { lsl: 0, usl: 0, target: 0, projectedCpk: 0 },
    sampleSize: 0,
    confidence: 0,
    basis: "",
    degraded: true,
    note,
  });

  if (!isThresholdAdvisorEnabled()) {
    return disabledResult("Trợ lý đặt ngưỡng chưa bật (AI_THRESHOLD_ADVISOR_ENABLED).");
  }

  try {
    const def = await productDb.getMeasurementPointDefById(input.measurementPointId);
    if (!def) {
      return {
        ...disabledResult("Không tìm thấy điểm đo."),
        disabled: false,
        ok: false,
      };
    }

    const days = input.windowDays ?? 30;
    const { values, source } = await getPointValues(input.measurementPointId, {
      windowDays: input.windowDays,
      windowSize: input.windowSize ?? 5000,
    });

    const currentLsl = toNum((def as any).lowerLimit);
    const currentUsl = toNum((def as any).upperLimit);
    const currentNominal = toNum((def as any).nominalValue);

    const sug = suggestThresholds({
      values,
      currentNominal,
      currentLsl,
      currentUsl,
      // Thin data → lean harder on existing limits (stronger prior).
      priorWeight: values.length < minN ? 0.5 : 0.2,
    });

    const sampleSize = sug.n;
    const degraded = sampleSize < minN;

    // Sanity guard: if the measured data is grossly inconsistent with the configured
    // limits — process mean outside limits (strongly negative Cpk), or the suggested
    // range is an absurd multiple of the current one, or the suggested target lands far
    // outside the current band — the measuredValue likely doesn't share this point's
    // limit semantics (wrong unit/config). Flag for human review + drop confidence so the
    // auto-tune cron skips it (no nonsensical proposal).
    let needsReview = false;
    if (!degraded && currentLsl !== null && currentUsl !== null && currentUsl > currentLsl) {
      const curWidth = currentUsl - currentLsl;
      const recWidth = sug.suggestedUsl - sug.suggestedLsl;
      needsReview =
        (sug.currentCpk !== null && sug.currentCpk < -0.5) ||
        recWidth > 8 * curWidth ||
        sug.suggestedTarget > currentUsl + curWidth ||
        sug.suggestedTarget < currentLsl - curWidth;
    }

    const srcLabel = source === "results" ? "kết quả đo" : source === "samples" ? "mẫu SPC" : "không có dữ liệu";
    const basisParts: string[] = [];
    basisParts.push(`${sampleSize} ${srcLabel}${input.windowDays ? `/${days} ngày` : ""}`);
    basisParts.push("p0.135–p99.865 + ±3σ");
    basisParts.push(`shrinkage ${values.length < minN ? "0.5" : "0.2"}`);
    if (degraded) basisParts.push(`chưa đủ mẫu (cần ≥${minN})`);

    return {
      ok: true,
      pointDefId: input.measurementPointId,
      code: (def as any).code ?? null,
      name: (def as any).name ?? null,
      unit: (def as any).unit ?? null,
      current: {
        lsl: currentLsl,
        usl: currentUsl,
        target: currentNominal,
        cpk: sug.currentCpk,
      },
      recommended: {
        lsl: round2(sug.suggestedLsl),
        usl: round2(sug.suggestedUsl),
        target: round2(sug.suggestedTarget),
        projectedCpk: round2(sug.cpk),
      },
      sampleSize,
      confidence: round2(needsReview ? Math.min(sug.confidence, 0.3) : sug.confidence),
      basis: basisParts.join(", "),
      degraded,
      needsReview,
      note: needsReview
        ? `⚠️ Dữ liệu đo lệch xa giới hạn hiện tại (Cpk hiện tại ${sug.currentCpk?.toFixed(2) ?? "?"}). Có thể sai đơn vị/cấu hình điểm đo — cần kỹ sư xem lại trước khi áp dụng.`
        : degraded
          ? `Chỉ có ${sampleSize} mẫu (khuyến nghị ≥${minN}). Đề xuất thiên về giới hạn hiện tại — hãy duyệt thận trọng.`
          : undefined,
    };
  } catch (err) {
    console.warn("[aiThresholdAdvisor] recommendForMeasurementPoint failed:", err);
    return { ...disabledResult("Lỗi tính toán — vui lòng thử lại."), disabled: false, ok: false };
  }
}

/**
 * Recommend warning/critical NG-rate % for an NG threshold from recent NG-rate
 * distribution. CLAMPED to adjust_ng_threshold bounds. Honest-degrade when thin.
 */
export async function recommendNgThreshold(input: {
  ngThresholdId: number;
  windowDays?: number;
  minSampleDays?: number;
}): Promise<NgRecommendation> {
  const disabledResult = (note: string): NgRecommendation => ({
    ok: true,
    disabled: true,
    ngThresholdId: input.ngThresholdId,
    name: null,
    current: { warning: null, critical: null },
    recommended: { warning: 5, critical: 10 },
    sampleSize: 0,
    basis: "",
    degraded: true,
    note,
  });

  if (!isThresholdAdvisorEnabled()) {
    return disabledResult("Trợ lý đặt ngưỡng chưa bật (AI_THRESHOLD_ADVISOR_ENABLED).");
  }

  try {
    const row = await getNgThresholdRow(input.ngThresholdId);
    if (!row) {
      return { ...disabledResult("Không tìm thấy ngưỡng NG."), disabled: false, ok: false };
    }

    const currentWarning = toNum(row.warningThreshold);
    const currentCritical = toNum(row.criticalThreshold);

    const days = input.windowDays ?? 30;
    // Min observations: number of days with data we want before trusting it.
    const minObs = input.minSampleDays ?? 14;
    const rates = await recentDailyNgRates({
      machineId: row.machineId,
      measurementPointId: row.measurementPointId,
      days,
    });

    const rec = computeNgRecommendation(rates, {
      min: minObs,
      bounds: NG_THRESHOLD_BOUNDS,
      fallbackWarning: currentWarning ?? 5,
      fallbackCritical: currentCritical ?? 10,
    });

    return {
      ok: true,
      ngThresholdId: input.ngThresholdId,
      name: row.name ?? null,
      current: { warning: currentWarning, critical: currentCritical },
      recommended: { warning: rec.warning, critical: rec.critical },
      sampleSize: rec.sampleSize,
      basis: rec.basis,
      degraded: rec.degraded,
      note: rec.degraded
        ? `Chỉ có ${rec.sampleSize} khoảng đo (khuyến nghị ≥${minObs}). Đề xuất bảo thủ — hãy duyệt thận trọng.`
        : undefined,
    };
  } catch (err) {
    console.warn("[aiThresholdAdvisor] recommendNgThreshold failed:", err);
    return { ...disabledResult("Lỗi tính toán — vui lòng thử lại."), disabled: false, ok: false };
  }
}

/**
 * (Optional) Recommend minSampleSize / cooldownMinutes for an NG threshold from
 * throughput + NG-rate variance. CLAMPED to the configure_inspection_param tool
 * bounds (minSampleSize 1..100000, cooldown 1..1440).
 */
export async function recommendInspectionParam(input: {
  ngThresholdId: number;
  windowDays?: number;
}): Promise<InspectionParamRecommendation> {
  const disabledResult = (note: string): InspectionParamRecommendation => ({
    ok: true,
    disabled: true,
    ngThresholdId: input.ngThresholdId,
    current: { minSampleSize: null, cooldownMinutes: null },
    recommended: { minSampleSize: 30, cooldownMinutes: 30 },
    sampleSize: 0,
    basis: "",
    degraded: true,
    note,
  });

  if (!isThresholdAdvisorEnabled()) {
    return disabledResult("Trợ lý đặt ngưỡng chưa bật (AI_THRESHOLD_ADVISOR_ENABLED).");
  }

  try {
    const row = await getNgThresholdRow(input.ngThresholdId);
    if (!row) {
      return { ...disabledResult("Không tìm thấy ngưỡng NG."), disabled: false, ok: false };
    }
    const days = input.windowDays ?? 30;
    const { total, perDay } = await inspectionThroughput({
      machineId: row.machineId,
      measurementPointId: row.measurementPointId,
      days,
    });

    // Heuristic: minSampleSize ≈ 1/8 of a day's throughput (so a NG rate is
    // statistically meaningful), clamped to [10, 500]. Cooldown shorter for
    // high-throughput lines (faster feedback), longer for slow lines.
    const recMin = clamp(Math.round(perDay / 8), 10, 500);
    const recCooldown = perDay >= 500 ? 15 : perDay >= 100 ? 30 : 60;
    const degraded = total < 50;

    return {
      ok: true,
      ngThresholdId: input.ngThresholdId,
      current: { minSampleSize: row.minSampleSize ?? null, cooldownMinutes: row.cooldownMinutes ?? null },
      recommended: {
        minSampleSize: clamp(recMin, 1, 100000),
        cooldownMinutes: clamp(recCooldown, 1, 1440),
      },
      sampleSize: total,
      basis: `${total} kết quả/${days} ngày (~${round2(perDay)}/ngày) → minSample≈${recMin}, cooldown=${recCooldown}'`,
      degraded,
      note: degraded ? `Ít dữ liệu (${total} kết quả) — đề xuất bảo thủ.` : undefined,
    };
  } catch (err) {
    console.warn("[aiThresholdAdvisor] recommendInspectionParam failed:", err);
    return { ...disabledResult("Lỗi tính toán — vui lòng thử lại."), disabled: false, ok: false };
  }
}
