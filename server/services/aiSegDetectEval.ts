/**
 * F3/D1 — Segmentation & detection evaluators (doc69 G11).
 *
 * `aiEvalHarness.evaluateModelVersion`/`evaluateQualityGate` only score
 * CLASSIFICATION models (confusion matrix over labels). Segmentation models
 * (masks, e.g. `aiSegmentation.decodeYoloSeg` output) and detection models
 * (boxes) need different metrics — IoU/Dice for masks, mAP for boxes — before
 * they can be quality-gated the same way a classifier is.
 *
 * Pure math, no DB/fs/ONNX — takes predicted-vs-ground-truth masks/boxes
 * (already produced elsewhere, e.g. by decoding a real model's output or by a
 * test fixture) and returns metrics. Reference-value tested (perfect overlap
 * → 1.0, disjoint → 0, partial → hand-computed value).
 *
 * `evaluateSegDetectionGate` is a SIBLING of `aiEvalHarness.evaluateQualityGate`
 * (same pass/reason/delta/epsilon shape, generalized to an arbitrary metric
 * name) — NOT a replacement. The classification gate is untouched.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Detection boxes — IoU + mAP
// ─────────────────────────────────────────────────────────────────────────────

export interface EvalBox {
  x: number;
  y: number;
  w: number;
  h: number;
  classIndex: number;
  /** Confidence score — required for predictions (ranks them for AP), ignored for ground truth. */
  score?: number;
}

/** Axis-aligned IoU of two boxes ∈ [0,1]. Zero-area boxes → 0 (no overlap possible). */
export function iouBox(a: EvalBox, b: EvalBox): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = Math.max(0, a.w) * Math.max(0, a.h);
  const areaB = Math.max(0, b.w) * Math.max(0, b.h);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Average Precision for ONE class: rank predictions by score desc, greedily
 * match each to the highest-IoU unmatched ground-truth box of the same class
 * (IoU >= threshold), then take the EXACT area under the raw (non-interpolated)
 * precision/recall curve — AP = Σ (R_n − R_{n−1}) · P_n. This is the same
 * definition sklearn's `average_precision_score` uses; deterministic and easy
 * to hand-verify (no interpolation ambiguity).
 */
export function computeAveragePrecision(
  predicted: EvalBox[],
  groundTruth: EvalBox[],
  iouThreshold = 0.5,
): number {
  const totalGt = groundTruth.length;
  if (totalGt === 0) return predicted.length === 0 ? 1 : 0;
  if (predicted.length === 0) return 0;

  const ranked = predicted.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const gtMatched = new Array<boolean>(groundTruth.length).fill(false);

  let tp = 0;
  let fp = 0;
  let ap = 0;
  let prevRecall = 0;

  for (const pred of ranked) {
    let bestIdx = -1;
    let bestIou = -1;
    for (let i = 0; i < groundTruth.length; i++) {
      if (gtMatched[i]) continue;
      const iou = iouBox(pred, groundTruth[i]);
      if (iou > bestIou) {
        bestIou = iou;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestIou >= iouThreshold) {
      gtMatched[bestIdx] = true;
      tp++;
    } else {
      fp++;
    }
    const recall = tp / totalGt;
    const precision = tp / (tp + fp);
    ap += (recall - prevRecall) * precision;
    prevRecall = recall;
  }

  return ap;
}

export interface DetEvalReport {
  /** Mean AP across classes present in predicted ∪ groundTruth (macro-average). */
  mAP: number;
  iouThreshold: number;
  perClass: Array<{ classIndex: number; ap: number; support: number }>;
}

/** mAP@iouThreshold (default 0.5) over predicted-vs-ground-truth detection boxes, grouped by classIndex. */
export function evaluateDetection(
  predicted: EvalBox[],
  groundTruth: EvalBox[],
  opts: { iouThreshold?: number } = {},
): DetEvalReport {
  const iouThreshold = opts.iouThreshold ?? 0.5;
  const classes = new Set<number>();
  for (const b of predicted) classes.add(b.classIndex);
  for (const b of groundTruth) classes.add(b.classIndex);

  const perClass: DetEvalReport["perClass"] = [];
  let sum = 0;
  for (const c of Array.from(classes).sort((a, b) => a - b)) {
    const predC = predicted.filter((b) => b.classIndex === c);
    const gtC = groundTruth.filter((b) => b.classIndex === c);
    const ap = computeAveragePrecision(predC, gtC, iouThreshold);
    perClass.push({ classIndex: c, ap: round4(ap), support: gtC.length });
    sum += ap;
  }
  const mAP = perClass.length > 0 ? sum / perClass.length : 0;
  return { mAP: round4(mAP), iouThreshold, perClass };
}

// ─────────────────────────────────────────────────────────────────────────────
// Segmentation masks — IoU + Dice
// ─────────────────────────────────────────────────────────────────────────────

/** A binary(-ish) mask grid — values >= 0.5 are foreground (matches DecodedMask.grid's probability convention). */
export interface MaskLike {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** Pixel IoU of two SAME-SIZE mask grids ∈ [0,1]. Both empty → 1 (nothing to miss, nothing extra). */
export function iouMask(a: MaskLike, b: MaskLike): number {
  requireSameGrid(a, b);
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.data.length; i++) {
    const av = Number(a.data[i]) >= 0.5;
    const bv = Number(b.data[i]) >= 0.5;
    if (av || bv) union++;
    if (av && bv) inter++;
  }
  return union > 0 ? inter / union : 1;
}

/** Dice/F1 coefficient of two SAME-SIZE mask grids ∈ [0,1]. Both empty → 1. */
export function diceMask(a: MaskLike, b: MaskLike): number {
  requireSameGrid(a, b);
  let inter = 0;
  let areaA = 0;
  let areaB = 0;
  for (let i = 0; i < a.data.length; i++) {
    const av = Number(a.data[i]) >= 0.5;
    const bv = Number(b.data[i]) >= 0.5;
    if (av) areaA++;
    if (bv) areaB++;
    if (av && bv) inter++;
  }
  const denom = areaA + areaB;
  return denom > 0 ? (2 * inter) / denom : 1;
}

function requireSameGrid(a: MaskLike, b: MaskLike): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`iouMask/diceMask: grid size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
}

/** One matched (predicted, ground-truth) pair for a class — either side may be null (miss / false positive). */
export interface SegPair {
  classIndex: number;
  label?: string;
  predicted: MaskLike | null;
  groundTruth: MaskLike | null;
}

export interface SegEvalReport {
  /** Macro-mean IoU across classes present. */
  meanIoU: number;
  /** Macro-mean Dice across classes present. */
  meanDice: number;
  perClass: Array<{ classIndex: number; label?: string; iou: number; dice: number; support: number }>;
  evaluated: number;
}

/**
 * Aggregate IoU/Dice over already-matched predicted/ground-truth mask pairs
 * (matching instances is the caller's job — e.g. by image id + class). A pair
 * missing one side (predicted null XOR groundTruth null) scores 0 for both
 * metrics (a miss or a false positive); both null is skipped (nothing to score).
 */
export function evaluateSegmentation(pairs: SegPair[]): SegEvalReport {
  const byClass = new Map<number, { iouSum: number; diceSum: number; n: number; label?: string }>();
  let evaluated = 0;

  for (const p of pairs) {
    if (!p.predicted && !p.groundTruth) continue; // nothing to compare
    let iou: number;
    let dice: number;
    if (p.predicted && p.groundTruth) {
      iou = iouMask(p.predicted, p.groundTruth);
      dice = diceMask(p.predicted, p.groundTruth);
    } else {
      // Missed detection (groundTruth present, predicted absent) or false positive (reverse).
      iou = 0;
      dice = 0;
    }
    evaluated++;
    const bucket = byClass.get(p.classIndex) ?? { iouSum: 0, diceSum: 0, n: 0, label: p.label };
    bucket.iouSum += iou;
    bucket.diceSum += dice;
    bucket.n += 1;
    if (p.label) bucket.label = p.label;
    byClass.set(p.classIndex, bucket);
  }

  const perClass: SegEvalReport["perClass"] = [];
  let iouSum = 0;
  let diceSum = 0;
  for (const classIndex of Array.from(byClass.keys()).sort((a, b) => a - b)) {
    const b = byClass.get(classIndex)!;
    const iou = b.n > 0 ? b.iouSum / b.n : 0;
    const dice = b.n > 0 ? b.diceSum / b.n : 0;
    perClass.push({ classIndex, label: b.label, iou: round4(iou), dice: round4(dice), support: b.n });
    iouSum += iou;
    diceSum += dice;
  }

  return {
    meanIoU: round4(perClass.length > 0 ? iouSum / perClass.length : 0),
    meanDice: round4(perClass.length > 0 ? diceSum / perClass.length : 0),
    perClass,
    evaluated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality gate — parallel to aiEvalHarness.evaluateQualityGate (classification
// gate is untouched; this is the seg/detection sibling).
// ─────────────────────────────────────────────────────────────────────────────

export type SegDetectMetric = "meanIoU" | "meanDice" | "mAP";

export interface SegDetectGateResult {
  pass: boolean;
  reason: string;
  metric: SegDetectMetric;
  candidateValue: number;
  baselineValue: number | null;
  /** candidateValue - baselineValue (null when there's no baseline). */
  delta: number | null;
  epsilon: number;
  /** Absolute minimum the candidate must clear regardless of baseline (null = no floor). */
  floor: number | null;
}

/**
 * Quality gate for a segmentation/detection metric (mean-IoU, mean-Dice, or
 * mAP): candidate passes when it (a) clears the optional absolute `floor`, AND
 * (b) is >= baseline - epsilon (or there is no baseline — first version).
 * Mirrors `evaluateQualityGate`'s pass/regression semantics, generalized to a
 * named metric instead of "accuracy".
 */
export function evaluateSegDetectionGate(opts: {
  metric: SegDetectMetric;
  candidateValue: number;
  baselineValue?: number | null;
  epsilon?: number;
  floor?: number | null;
}): SegDetectGateResult {
  const { metric, candidateValue } = opts;
  const baselineValue = opts.baselineValue ?? null;
  const epsilon = opts.epsilon ?? 0;
  const floor = opts.floor ?? null;
  const delta = baselineValue != null ? Number((candidateValue - baselineValue).toFixed(4)) : null;

  if (floor != null && candidateValue < floor) {
    return {
      pass: false,
      reason: `Candidate ${metric} ${candidateValue.toFixed(4)} below absolute floor ${floor.toFixed(4)}.`,
      metric, candidateValue, baselineValue, delta, epsilon, floor,
    };
  }

  if (baselineValue == null) {
    return {
      pass: true,
      reason: `No baseline — candidate ${metric} ${candidateValue.toFixed(4)} accepted as first version.`,
      metric, candidateValue, baselineValue: null, delta: null, epsilon, floor,
    };
  }

  const pass = candidateValue >= baselineValue - epsilon;
  return {
    pass,
    reason: pass
      ? `Candidate ${metric} ${candidateValue.toFixed(4)} >= baseline ${baselineValue.toFixed(4)} - eps ${epsilon}.`
      : `Candidate ${metric} ${candidateValue.toFixed(4)} regressed below baseline ${baselineValue.toFixed(4)} - eps ${epsilon}.`,
    metric, candidateValue, baselineValue, delta, epsilon, floor,
  };
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}
