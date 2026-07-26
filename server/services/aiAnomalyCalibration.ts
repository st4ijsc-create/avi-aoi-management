/**
 * F3/D2 — Anomaly threshold ROC calibration (doc69 G9).
 *
 * `aiAnomalyDetection`'s memory-bank threshold is a fixed p99 self-distance
 * (THRESHOLD_PERCENTILE, computed from the OK bank's own internal kNN distance
 * distribution — see `buildBankFromVectors`). It is never validated against a
 * target recall/FPR because building the bank needs no labels (unsupervised).
 *
 * This module adds an OPTIONAL, opt-in calibration step: given LABELLED NG/OK
 * anomaly scores (e.g. from `backfillAnomalyScores` output, or a held-out
 * labelled set), sweep every candidate threshold and pick the one that hits a
 * target recall or target FPR — i.e. an ROC operating point. Pure math (no
 * DB/fs); `calibrateAndStore` is the thin DB-writing wrapper (persists via
 * `server/db/aiAnomaly.ts#setCalibratedThreshold`, additive migration 0300).
 *
 * Convention matches `scoreFromVector`'s `isAnomaly = score > threshold`
 * (strict greater-than) so recall/FPR computed here are EXACTLY what the
 * scorer will produce once calibrated.
 *
 * Behaviour-preserving: `aiAnomalyDetection.scoreFromVector` uses the
 * calibrated threshold ONLY when `ai_anomaly_profiles.calibratedThreshold` is
 * set; absent (uncalibrated, or migration 0300 not yet applied) → falls back
 * to the existing fixed p99 `threshold`, byte-for-byte unchanged.
 */
import { setCalibratedThreshold, type AnomalyScope } from "../db/aiAnomaly";

export interface LabelledScore {
  score: number;
  label: "NG" | "OK";
}

export interface RocPoint {
  threshold: number;
  /** True-positive rate over NG samples: NG correctly flagged (score > threshold) / total NG. */
  recall: number;
  /** False-positive rate over OK samples: OK incorrectly flagged (score > threshold) / total OK. */
  fpr: number;
  precision: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export interface CalibrationTarget {
  /** Achieve recall >= this, minimizing FPR (tightest threshold that still clears the target). */
  targetRecall?: number;
  /** Achieve FPR <= this, maximizing recall (loosest threshold that still satisfies the constraint). */
  targetFpr?: number;
}

export interface CalibrationResult {
  threshold: number;
  achievedRecall: number;
  achievedFpr: number;
  target: CalibrationTarget;
  /** Full sweep, for transparency/debugging/UI (e.g. plotting the ROC curve). */
  rocPoints: RocPoint[];
  sampleCount: { ng: number; ok: number };
}

/**
 * Sweep every candidate threshold (each unique score value, plus one just
 * below the minimum so recall/FPR can both reach 1.0) and compute the ROC
 * point at each. Both recall(t) and fpr(t) are non-increasing as t increases
 * (isAnomaly = score > t flags strictly fewer samples at a higher threshold).
 */
export function computeRocSweep(samples: LabelledScore[]): RocPoint[] {
  const ngScores = samples.filter((s) => s.label === "NG").map((s) => s.score);
  const okScores = samples.filter((s) => s.label === "OK").map((s) => s.score);
  const totalNg = ngScores.length;
  const totalOk = okScores.length;

  if (samples.length === 0) return [];

  const uniqueThresholds = Array.from(new Set(samples.map((s) => s.score))).sort((a, b) => a - b);
  // Prepend a threshold just below the minimum so t=min-eps flags EVERY sample
  // (recall=1, fpr=1 reachable even though isAnomaly uses strict >).
  const thresholds = [uniqueThresholds[0] - 1e-9, ...uniqueThresholds];

  return thresholds.map((t) => {
    const tp = ngScores.filter((s) => s > t).length;
    const fn = totalNg - tp;
    const fp = okScores.filter((s) => s > t).length;
    const tn = totalOk - fp;
    return {
      threshold: t,
      recall: totalNg > 0 ? tp / totalNg : 0,
      fpr: totalOk > 0 ? fp / totalOk : 0,
      precision: tp + fp > 0 ? tp / (tp + fp) : 0,
      tp, fp, tn, fn,
    };
  });
}

/**
 * Calibrate a threshold to a target recall OR target FPR (exactly one must be
 * given). Returns the achieved operating point + the full sweep. Throws if
 * neither target is given, or if there are no labelled samples.
 *
 * targetRecall  → picks the HIGHEST threshold whose recall still >= target
 *                 (tightest — minimizes false positives while meeting the bar).
 *                 Unattainable (even t=min-eps falls short) → falls back to the
 *                 loosest point (max achievable recall), degrading truthfully.
 * targetFpr     → picks the LOWEST threshold whose fpr still <= target
 *                 (loosest — maximizes recall while respecting the FPR cap).
 *                 Unattainable → falls back to the tightest point (min FPR).
 */
export function calibrateThreshold(samples: LabelledScore[], target: CalibrationTarget): CalibrationResult {
  if (target.targetRecall == null && target.targetFpr == null) {
    throw new Error("calibrateThreshold: must specify targetRecall or targetFpr");
  }
  if (samples.length === 0) {
    throw new Error("calibrateThreshold: no labelled samples provided");
  }

  const rocPoints = computeRocSweep(samples);
  const totalNg = samples.filter((s) => s.label === "NG").length;
  const totalOk = samples.filter((s) => s.label === "OK").length;

  let chosen: RocPoint;
  if (target.targetRecall != null) {
    const candidates = rocPoints.filter((p) => p.recall >= target.targetRecall!);
    chosen = candidates.length > 0
      ? candidates.reduce((best, p) => (p.threshold > best.threshold ? p : best))
      : rocPoints.reduce((best, p) => (p.recall > best.recall ? p : best)); // unattainable → loosest (max recall)
  } else {
    const candidates = rocPoints.filter((p) => p.fpr <= target.targetFpr!);
    chosen = candidates.length > 0
      ? candidates.reduce((best, p) => (p.threshold < best.threshold ? p : best))
      : rocPoints.reduce((best, p) => (p.fpr < best.fpr ? p : best)); // unattainable → tightest (min fpr)
  }

  return {
    threshold: chosen.threshold,
    achievedRecall: chosen.recall,
    achievedFpr: chosen.fpr,
    target,
    rocPoints,
    sampleCount: { ng: totalNg, ok: totalOk },
  };
}

/**
 * Calibrate + persist in one call (the typical admin-action entry point):
 * sweep `samples` to the target, then store the result on the scope's
 * `ai_anomaly_profiles` row via `setCalibratedThreshold` (throws if that row
 * doesn't exist yet, or if migration 0300 hasn't run — see that function's
 * doc comment).
 */
export async function calibrateAndStore(
  scope: AnomalyScope,
  samples: LabelledScore[],
  target: CalibrationTarget,
): Promise<CalibrationResult> {
  const result = calibrateThreshold(samples, target);
  await setCalibratedThreshold(scope, result.threshold, {
    targetRecall: target.targetRecall,
    targetFpr: target.targetFpr,
    achievedRecall: result.achievedRecall,
    achievedFpr: result.achievedFpr,
    sampleCount: result.sampleCount,
    calibratedAt: new Date().toISOString(),
  });
  return result;
}
