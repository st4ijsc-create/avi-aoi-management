/**
 * W7-B (doc 27 §9 gap V3 — P0, Đợt 7 item 7.3) — NTF / FALSE-CALL PREDICTOR.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Scores every NG inspection with a false-call likelihood (0..1) so the
 * operator verify queue can be PRE-SORTED — the highest-ROI AI assist for AVI
 * (doc 27 §9 V3). Persisted to product_inspections."ntfScore" (migration 0188);
 * History sorts by it ("Khả năng báo giả") and badges rows ≥ threshold.
 *
 * ⚠ HONEST HEURISTIC v1 — NOT A TRAINED MODEL. There are not yet enough
 * harvested labels to train one (that is exactly what V2's
 * measurement_corrections ledger is accumulating; doc 27 §7.3's phased plan
 * upgrades this to a classifier once labels exist). v1 blends three
 * transparent signals, each in [0,1] where 1 = "likely false call":
 *
 *  (a) REPEAT OFFENDER (weight 0.5) — historical false-call rate of each NG
 *      point's (machine, pointDef) pair over the last 90 days, from BOTH
 *      harvested corrections (NG→OK/NTF) and inspection-level NTF clears.
 *      Laplace-smoothed ((cleared+1)/(total+2)) so thin history → ~0.5 neutral.
 *  (b) LIMIT MARGIN (weight 0.3) — Cpk-style proxy: an NG value BARELY over
 *      its limit is a false-call candidate; far outside is likely real.
 *      relative overshoot r = dist-outside-limit / tolerance-width:
 *      r ≤ 2% → 0.9, r ≥ 50% → 0.05, linear in between. Points without a
 *      numeric value + limits contribute nothing (signal = null, not 0.5).
 *  (c) MACHINE TREND (weight 0.2) — the machine's NG→cleared rate over the
 *      last 7 days (Laplace-smoothed).
 *
 *  Per-point (a)+(b) are combined per point, then the INSPECTION takes the
 *  MINIMUM over its NG points — weakest-link logic: one point that looks like
 *  a real defect makes the whole board a real NG regardless of how noisy the
 *  other points are. Missing signals renormalize the remaining weights; if NO
 *  signal is computable the inspection is left unscored (NULL — we never
 *  fabricate a score).
 *
 * SEAM for W7-A's ingest path (machineApiRouters, dynamic import):
 *   scoreInspectionNtf(inspectionId) — self-gated by env NTF_PREDICTOR_ENABLED
 *   (default ON), FAIL-OPEN (never throws), no-op for non-NG inspections.
 *
 * ADVISORY ONLY: the score pre-sorts/badges the human queue. It never changes
 * a verdict, never auto-clears an NG.
 */
import { getDb } from "../../db/connection";
import { and, desc, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  measurementCorrections,
} from "../../../drizzle/schema";

// ─── Env gates / tunables ────────────────────────────────────────────────────

/** Default ON — the predictor is advisory-only and fail-open. */
export function isNtfPredictorEnabled(): boolean {
  return process.env.NTF_PREDICTOR_ENABLED !== "false";
}

/** Badge threshold for "Nghi báo giả" (History rows), env NTF_BADGE_THRESHOLD, default 0.7. */
export function ntfBadgeThreshold(): number {
  const n = Number(process.env.NTF_BADGE_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.7;
}

const HISTORY_WINDOW_DAYS = 90; // (a) repeat-offender lookback
const MACHINE_TREND_DAYS = 7;   // (c) machine trend lookback
const WEIGHTS = { repeatOffender: 0.5, limitMargin: 0.3, machineTrend: 0.2 } as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NtfSignals {
  /** min over NG points of the (machine, pointDef) historical false-call rate; null = no NG points resolved. */
  repeatOffender: number | null;
  /** min over NG points of the near-limit margin score; null = no point had numeric value + limits. */
  limitMargin: number | null;
  /** machine-level NG→cleared rate, recent window; null = no DB. */
  machineTrend: number | null;
}

export interface NtfScoreResult {
  inspectionId: number;
  score: number;
  signals: NtfSignals;
}

// ─── Pure scoring pieces (unit-testable) ─────────────────────────────────────

/** Laplace-smoothed rate: thin history drifts to 0.5 instead of 0 or 1. */
export function laplaceRate(cleared: number, total: number): number {
  return (cleared + 1) / (total + 2);
}

/**
 * Near-limit margin score for one NG numeric point.
 * @param value measured value
 * @param lsl lower limit (nullable), @param usl upper limit (nullable)
 * @returns 0..1 (1 = barely over → false-call candidate) or null when not computable.
 */
export function limitMarginScore(value: number, lsl: number | null, usl: number | null): number | null {
  if (!Number.isFinite(value) || (lsl == null && usl == null)) return null;
  // Tolerance width: usl−lsl when both present; single-limit fallback scale
  // (documented, deliberately coarse for v1): 10% of |limit|, floor 1.
  let width: number;
  if (lsl != null && usl != null && usl > lsl) width = usl - lsl;
  else width = Math.max(Math.abs(usl ?? lsl ?? 1), 1) * 0.1;

  let overshoot = 0;
  if (usl != null && value > usl) overshoot = value - usl;
  else if (lsl != null && value < lsl) overshoot = lsl - value;
  else return null; // value inside limits yet NG → attribute/visual NG, no margin signal

  const r = overshoot / width;
  if (r <= 0.02) return 0.9;
  if (r >= 0.5) return 0.05;
  return 0.9 - ((r - 0.02) / (0.5 - 0.02)) * (0.9 - 0.05);
}

/** Weighted blend with renormalization over the available (non-null) signals. */
export function blendSignals(signals: NtfSignals): number | null {
  let num = 0;
  let den = 0;
  if (signals.repeatOffender != null) { num += WEIGHTS.repeatOffender * signals.repeatOffender; den += WEIGHTS.repeatOffender; }
  if (signals.limitMargin != null) { num += WEIGHTS.limitMargin * signals.limitMargin; den += WEIGHTS.limitMargin; }
  if (signals.machineTrend != null) { num += WEIGHTS.machineTrend * signals.machineTrend; den += WEIGHTS.machineTrend; }
  if (den === 0) return null;
  const score = num / den;
  return Math.round(Math.min(1, Math.max(0, score)) * 10000) / 10000;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Compute the false-call likelihood for one inspection. Returns null when the
 * inspection is missing, not NG, or no signal is computable. THROWS only on
 * DB errors — callers that must be fail-open use scoreInspectionNtf.
 */
export async function computeNtfScore(inspectionId: number): Promise<NtfScoreResult | null> {
  const db = await getDb();
  if (!db) return null;

  const [inspection] = await db
    .select({
      id: productInspections.id,
      machineId: productInspections.machineId,
      overallResult: productInspections.overallResult,
    })
    .from(productInspections)
    .where(eq(productInspections.id, inspectionId))
    .limit(1);
  if (!inspection || inspection.overallResult !== "NG") return null;

  const now = Date.now();
  const historySince = new Date(now - HISTORY_WINDOW_DAYS * 86_400_000);
  const trendSince = new Date(now - MACHINE_TREND_DAYS * 86_400_000);

  // NG points of THIS inspection, with their numeric limits.
  const ngPoints = await db
    .select({
      pointDefId: measurementResults.pointDefId,
      measuredValue: measurementResults.measuredValue,
      lowerLimit: measurementPointDefs.lowerLimit,
      upperLimit: measurementPointDefs.upperLimit,
    })
    .from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .where(and(
      eq(measurementResults.inspectionId, inspectionId),
      eq(measurementResults.result, "NG"),
    ))
    .limit(50);

  const pointDefIds = Array.from(new Set(ngPoints.map((p) => p.pointDefId).filter((x): x is number => x != null)));

  // (a) repeat-offender history per (machine, pointDef): corrections ledger +
  // inspection-level NTF clears, one grouped query each.
  const corrHist = pointDefIds.length > 0
    ? await db
        .select({
          pointDefId: measurementCorrections.pointDefId,
          total: sql<number>`COUNT(*)`,
          cleared: sql<number>`COUNT(*) FILTER (WHERE ${measurementCorrections.correctedResult} <> 'NG')`,
        })
        .from(measurementCorrections)
        .where(and(
          eq(measurementCorrections.machineId, inspection.machineId),
          eq(measurementCorrections.originalResult, "NG"),
          inArray(measurementCorrections.pointDefId, pointDefIds),
          gte(measurementCorrections.createdAt, historySince),
        ))
        .groupBy(measurementCorrections.pointDefId)
    : [];

  const ntfHist = pointDefIds.length > 0
    ? await db
        .select({
          pointDefId: measurementResults.pointDefId,
          total: sql<number>`COUNT(*)`,
          cleared: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NTF')`,
        })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(
          eq(productInspections.machineId, inspection.machineId),
          eq(productInspections.originalResult, "NG"),
          eq(measurementResults.result, "NG"),
          inArray(measurementResults.pointDefId, pointDefIds),
          gte(productInspections.inspectionTime, historySince),
          sql`${productInspections.id} <> ${inspectionId}`, // exclude self
        ))
        .groupBy(measurementResults.pointDefId)
    : [];

  const corrByPoint = new Map(corrHist.map((r) => [r.pointDefId, r]));
  const ntfByPoint = new Map(ntfHist.map((r) => [r.pointDefId, r]));

  // Per-point repeat-offender rate → weakest link (min) across the board.
  let repeatOffender: number | null = null;
  for (const p of ngPoints) {
    const corr = p.pointDefId != null ? corrByPoint.get(p.pointDefId) : undefined;
    const ntf = p.pointDefId != null ? ntfByPoint.get(p.pointDefId) : undefined;
    const total = (Number(corr?.total) || 0) + (Number(ntf?.total) || 0);
    const cleared = (Number(corr?.cleared) || 0) + (Number(ntf?.cleared) || 0);
    const rate = laplaceRate(cleared, total);
    repeatOffender = repeatOffender == null ? rate : Math.min(repeatOffender, rate);
  }

  // (b) limit-margin proxy → weakest link (min) across computable points.
  let limitMargin: number | null = null;
  for (const p of ngPoints) {
    const value = p.measuredValue != null ? Number(p.measuredValue) : NaN;
    const s = limitMarginScore(
      value,
      p.lowerLimit != null ? Number(p.lowerLimit) : null,
      p.upperLimit != null ? Number(p.upperLimit) : null,
    );
    if (s == null) continue;
    limitMargin = limitMargin == null ? s : Math.min(limitMargin, s);
  }

  // (c) machine recent false-call trend (inspection-level NG→cleared).
  const [trendRow] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      cleared: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} <> 'NG')`,
    })
    .from(productInspections)
    .where(and(
      eq(productInspections.machineId, inspection.machineId),
      eq(productInspections.originalResult, "NG"),
      gte(productInspections.inspectionTime, trendSince),
      sql`${productInspections.id} <> ${inspectionId}`,
    ));
  const machineTrend = laplaceRate(Number(trendRow?.cleared) || 0, Number(trendRow?.total) || 0);

  const signals: NtfSignals = { repeatOffender, limitMargin, machineTrend };
  const score = blendSignals(signals);
  if (score == null) return null;
  return { inspectionId, score, signals };
}

/**
 * INGEST SEAM (consumed by W7-A's machineApiRouters via dynamic import):
 * compute + persist the score for one inspection. Self-gated by env
 * NTF_PREDICTOR_ENABLED (default ON). FAIL-OPEN: never throws — a scoring
 * failure must never affect ingest.
 */
export async function scoreInspectionNtf(inspectionId: number): Promise<void> {
  if (!isNtfPredictorEnabled()) return;
  try {
    const result = await computeNtfScore(inspectionId);
    if (!result) return;
    const db = await getDb();
    if (!db) return;
    await db
      .update(productInspections)
      .set({ ntfScore: result.score })
      .where(eq(productInspections.id, inspectionId));
  } catch (err) {
    console.warn("[ntfPredictor] scoring failed (fail-open):", err instanceof Error ? err.message : err);
  }
}

/**
 * Backfill scores for recent NG inspections (scripts/backfill-ntf-scores.mjs —
 * on-demand, never auto-run). Skips already-scored rows unless rescore=true.
 */
export async function backfillNtfScores(opts: {
  days?: number;
  limit?: number;
  rescore?: boolean;
} = {}): Promise<{ scanned: number; scored: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { scanned: 0, scored: 0, skipped: 0 };

  const since = new Date(Date.now() - (opts.days ?? 7) * 86_400_000);
  const conditions: SQL[] = [
    eq(productInspections.overallResult, "NG"),
    gte(productInspections.inspectionTime, since),
  ];
  if (!opts.rescore) conditions.push(isNull(productInspections.ntfScore));

  const rows = await db
    .select({ id: productInspections.id })
    .from(productInspections)
    .where(and(...conditions))
    .orderBy(desc(productInspections.inspectionTime))
    .limit(Math.min(Math.max(opts.limit ?? 500, 1), 5000));

  let scored = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const result = await computeNtfScore(row.id);
      if (!result) { skipped++; continue; }
      await db.update(productInspections).set({ ntfScore: result.score }).where(eq(productInspections.id, row.id));
      scored++;
    } catch {
      skipped++;
    }
  }
  return { scanned: rows.length, scored, skipped };
}
