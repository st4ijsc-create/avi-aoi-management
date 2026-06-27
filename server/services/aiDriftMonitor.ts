/**
 * AI Drift Monitor — B5.2 (MLOps closed-loop)
 *
 * Lightweight, self-contained detector for **confidence/score distribution
 * drift** on a live model. Complements aiMonitoring.detectDrift (which needs a
 * materialized performance snapshot + label distribution + a baseline snapshot):
 * this monitor reads inference_results.confidence DIRECTLY for two time windows
 * and flags when the RECENT confidence distribution has shifted away from a
 * BASELINE window — without needing any ground-truth labels.
 *
 * Signals (no labels required):
 *   - PSI (Population Stability Index) over fixed [0,1] confidence bins.
 *       PSI < 0.1 = stable · 0.1–0.25 = moderate · > 0.25 = significant drift.
 *   - Mean shift  |mean_recent − mean_baseline|   (absolute, in [0,1]).
 *   - Std  shift  |std_recent − std_baseline|.
 * The PSI binning + thresholds mirror the convention already used in
 * aiMonitoring.calculatePSI so the two paths read consistently.
 *
 * SAFETY / GOVERNANCE:
 *   - Flag-gated: AI_DRIFT_MONITOR_ENABLED (default OFF). When off, the public
 *     entry points are safe no-ops returning { enabled:false, ... }.
 *   - Advisory only. It NEVER swaps, retrains, or deactivates a model. On drift
 *     it emits a metric counter and (best-effort) a DRIFT_DETECTED row into
 *     model_drift_alerts — the same table the monitoring dashboard already reads.
 *   - Offline-first: only the internal Postgres DB; no network. Fail-safe: any
 *     error degrades to a no-op result, never throws into the caller.
 *
 * Env flags:
 *   AI_DRIFT_MONITOR_ENABLED       (default "false")
 *   AI_DRIFT_PSI_THRESHOLD         (default "0.25"  — significant-drift cutoff)
 *   AI_DRIFT_MEAN_THRESHOLD        (default "0.15"  — mean-confidence shift cutoff)
 *   AI_DRIFT_BASELINE_HOURS        (default "168"   — baseline window length, 7d)
 *   AI_DRIFT_RECENT_HOURS          (default "24"    — recent window length, 1d)
 *   AI_DRIFT_MIN_SAMPLES           (default "50"    — min rows per window to judge)
 */

import { getDb } from "../db/connection";
import { inferenceResults } from "../../drizzle/schema";
import { eq, and, gte, lt, isNotNull } from "drizzle-orm";

const ENABLED = String(process.env.AI_DRIFT_MONITOR_ENABLED ?? "false").toLowerCase() === "true";
const PSI_THRESHOLD = Number(process.env.AI_DRIFT_PSI_THRESHOLD || "0.25");
const MEAN_THRESHOLD = Number(process.env.AI_DRIFT_MEAN_THRESHOLD || "0.15");
const BASELINE_HOURS = Number(process.env.AI_DRIFT_BASELINE_HOURS || "168");
const RECENT_HOURS = Number(process.env.AI_DRIFT_RECENT_HOURS || "24");
const MIN_SAMPLES = Number(process.env.AI_DRIFT_MIN_SAMPLES || "50");

/** Number of equal-width bins over [0,1] used for the confidence histogram / PSI. */
const N_BINS = 10;

export interface DistributionSummary {
  count: number;
  mean: number;
  std: number;
  /** Normalized histogram (fractions, sums to ~1) over N_BINS equal-width bins. */
  histogram: number[];
}

export interface DriftCheckResult {
  enabled: boolean;
  modelId: number;
  /** true only when there is enough data in BOTH windows to judge. */
  evaluated: boolean;
  drift: boolean;
  severity: "NONE" | "MEDIUM" | "HIGH" | "CRITICAL";
  psi: number;
  meanShift: number;
  stdShift: number;
  baseline: DistributionSummary;
  recent: DistributionSummary;
  reasons: string[];
  /** id of the model_drift_alerts row created (when drift + DB available). */
  alertId?: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Bin index in [0, N_BINS) for a confidence c∈[0,1] (c===1 → last bin). */
function binIndex(c: number): number {
  let idx = Math.floor(clamp01(c) * N_BINS);
  if (idx >= N_BINS) idx = N_BINS - 1;
  if (idx < 0) idx = 0;
  return idx;
}

/** Summarize a list of confidences into count/mean/std + a normalized histogram. */
export function summarizeConfidences(values: number[]): DistributionSummary {
  const hist = new Array(N_BINS).fill(0);
  const finite = values.filter((v) => Number.isFinite(v)).map(clamp01);
  const n = finite.length;
  if (n === 0) return { count: 0, mean: 0, std: 0, histogram: hist };

  let sum = 0;
  for (const v of finite) {
    sum += v;
    hist[binIndex(v)] += 1;
  }
  const mean = sum / n;

  let varSum = 0;
  for (const v of finite) varSum += (v - mean) * (v - mean);
  const std = Math.sqrt(varSum / n);

  for (let i = 0; i < N_BINS; i++) hist[i] = hist[i] / n;
  return { count: n, mean, std, histogram: hist };
}

/**
 * PSI between two normalized histograms (same bin layout). A small epsilon floor
 * avoids log(0) for empty bins (matches aiMonitoring.calculatePSI convention).
 */
export function psiFromHistograms(baseline: number[], recent: number[]): number {
  const eps = 1e-4;
  let psi = 0;
  for (let i = 0; i < baseline.length; i++) {
    const b = Math.max(baseline[i] ?? 0, eps);
    const r = Math.max(recent[i] ?? 0, eps);
    psi += (r - b) * Math.log(r / b);
  }
  return psi;
}

function severityFor(psi: number, meanShift: number): DriftCheckResult["severity"] {
  if (psi > 0.5 || meanShift > MEAN_THRESHOLD * 2) return "CRITICAL";
  if (psi > PSI_THRESHOLD || meanShift > MEAN_THRESHOLD) return "HIGH";
  if (psi > 0.1) return "MEDIUM";
  return "NONE";
}

/** Pull confidences from inference_results for [start, end) for a model. */
async function loadConfidences(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  modelId: number,
  start: Date,
  end: Date,
): Promise<number[]> {
  const rows = await db
    .select({ confidence: inferenceResults.confidence })
    .from(inferenceResults)
    .where(and(
      eq(inferenceResults.modelId, modelId),
      eq(inferenceResults.status, "COMPLETED"),
      isNotNull(inferenceResults.confidence),
      gte(inferenceResults.createdAt, start),
      lt(inferenceResults.createdAt, end),
    ));
  return rows
    .map((r) => (r.confidence != null ? Number(r.confidence) : NaN))
    .filter((v) => Number.isFinite(v));
}

/**
 * Check confidence-distribution drift for a single model. Compares a RECENT
 * window (last RECENT_HOURS) against a BASELINE window
 * ([now − BASELINE_HOURS − RECENT_HOURS, now − RECENT_HOURS)). Advisory-only.
 *
 * `now` is injectable for tests; `samples` lets tests bypass the DB entirely by
 * supplying { baseline, recent } confidence arrays.
 */
export async function checkConfidenceDrift(opts: {
  modelId: number;
  modelVersion?: string;
  now?: Date;
  emitAlert?: boolean;
  samples?: { baseline: number[]; recent: number[] };
}): Promise<DriftCheckResult> {
  const base: DriftCheckResult = {
    enabled: ENABLED,
    modelId: opts.modelId,
    evaluated: false,
    drift: false,
    severity: "NONE",
    psi: 0,
    meanShift: 0,
    stdShift: 0,
    baseline: { count: 0, mean: 0, std: 0, histogram: new Array(N_BINS).fill(0) },
    recent: { count: 0, mean: 0, std: 0, histogram: new Array(N_BINS).fill(0) },
    reasons: [],
  };

  if (!ENABLED && !opts.samples) {
    base.reasons.push("AI_DRIFT_MONITOR_ENABLED is off — no-op");
    return base;
  }

  let baselineVals: number[];
  let recentVals: number[];

  if (opts.samples) {
    baselineVals = opts.samples.baseline;
    recentVals = opts.samples.recent;
  } else {
    const db = await getDb();
    if (!db) {
      base.reasons.push("db unavailable — no-op");
      return base;
    }
    const now = opts.now ?? new Date();
    const recentStart = new Date(now.getTime() - RECENT_HOURS * 3600_000);
    const baselineStart = new Date(recentStart.getTime() - BASELINE_HOURS * 3600_000);
    try {
      [baselineVals, recentVals] = await Promise.all([
        loadConfidences(db, opts.modelId, baselineStart, recentStart),
        loadConfidences(db, opts.modelId, recentStart, now),
      ]);
    } catch (err) {
      base.reasons.push(`query failed: ${(err as Error)?.message ?? err}`);
      return base;
    }
  }

  const baseline = summarizeConfidences(baselineVals);
  const recent = summarizeConfidences(recentVals);
  base.baseline = baseline;
  base.recent = recent;

  if (baseline.count < MIN_SAMPLES || recent.count < MIN_SAMPLES) {
    base.reasons.push(
      `insufficient samples (baseline=${baseline.count}, recent=${recent.count}, need ≥${MIN_SAMPLES} each)`,
    );
    return base;
  }

  const psi = psiFromHistograms(baseline.histogram, recent.histogram);
  const meanShift = Math.abs(recent.mean - baseline.mean);
  const stdShift = Math.abs(recent.std - baseline.std);
  const severity = severityFor(psi, meanShift);
  const drift = severity === "HIGH" || severity === "CRITICAL";

  const reasons: string[] = [];
  if (psi > PSI_THRESHOLD) reasons.push(`confidence PSI ${psi.toFixed(3)} > ${PSI_THRESHOLD}`);
  if (meanShift > MEAN_THRESHOLD) {
    reasons.push(`mean confidence shift ${meanShift.toFixed(3)} > ${MEAN_THRESHOLD} (baseline ${baseline.mean.toFixed(3)} → recent ${recent.mean.toFixed(3)})`);
  }
  if (!drift && psi > 0.1) reasons.push(`moderate PSI ${psi.toFixed(3)} (watch)`);

  const result: DriftCheckResult = {
    ...base,
    evaluated: true,
    drift,
    severity,
    psi: Number(psi.toFixed(4)),
    meanShift: Number(meanShift.toFixed(4)),
    stdShift: Number(stdShift.toFixed(4)),
    reasons,
  };

  // ── Emit telemetry + (optional) advisory alert row. Both fail-safe. ──
  if (drift) {
    incrementDriftMetric(opts.modelId, severity);
    if (opts.emitAlert !== false && !opts.samples) {
      try {
        const advanced = await import("../db/aiAdvanced");
        const alert = await advanced.createDriftAlert({
          modelId: opts.modelId,
          modelVersion: opts.modelVersion ?? null,
          // dedicated enum value (drizzle/schema/enums.ts driftAlertTypeEnum) for
          // confidence-distribution drift — distinct from label PSI in aiMonitoring.
          alertType: "CONFIDENCE_SHIFT",
          severity,
          message: `Confidence-distribution drift (PSI ${result.psi}, meanShift ${result.meanShift})`,
          details: {
            psi: result.psi,
            meanShift: result.meanShift,
            stdShift: result.stdShift,
            baseline: { count: baseline.count, mean: baseline.mean, std: baseline.std },
            recent: { count: recent.count, mean: recent.mean, std: recent.std },
            method: "confidence-PSI",
            source: "aiDriftMonitor",
          } as any,
          currentValue: String(result.psi),
          baselineValue: "0",
        } as any);
        result.alertId = (alert as any)?.id;
      } catch (err) {
        result.reasons.push(`alert persist failed (advisory): ${(err as Error)?.message ?? err}`);
      }
    }
  }

  return result;
}

// ─── Lightweight in-memory metric (read by dashboards / future Prometheus) ───
const driftCounters: Record<string, number> = {};

function incrementDriftMetric(modelId: number, severity: string): void {
  const key = `${modelId}:${severity}`;
  driftCounters[key] = (driftCounters[key] ?? 0) + 1;
}

/** Read-only snapshot of drift detections since process start (for telemetry). */
export function getDriftMetrics(): { enabled: boolean; counters: Record<string, number> } {
  return { enabled: ENABLED, counters: { ...driftCounters } };
}

export function isDriftMonitorEnabled(): boolean {
  return ENABLED;
}
