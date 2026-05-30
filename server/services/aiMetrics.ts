/**
 * AI Metrics Helpers — WS-1 (shared)
 *
 * Pure, dependency-free numeric helpers reused across the AI self-learning
 * pipeline (local training, eval harness, active learning). Extracted so the
 * exact same softmax / argmax / confusion-matrix / P-R-F1 logic is used for
 * training AND offline evaluation — making before/after comparisons fair.
 *
 * All functions are deterministic and side-effect free (unit-testable).
 */

// ─── Softmax / Argmax ──────────────────────────────────────────

/** Numerically-stable softmax over a logits vector. */
export function softmax(logits: ArrayLike<number>): Float32Array {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i]!;
    if (v > max) max = v;
  }
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i]! - max);
    exps[i] = e;
    sum += e;
  }
  if (sum > 0) {
    for (let i = 0; i < exps.length; i++) exps[i] = exps[i]! / sum;
  }
  return exps;
}

/** Index of the maximum element (first wins on ties). */
export function argmax(arr: ArrayLike<number>): number {
  let maxIdx = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]! > arr[maxIdx]!) maxIdx = i;
  }
  return maxIdx;
}

// ─── Uncertainty ───────────────────────────────────────────────

/**
 * Normalized Shannon entropy over a probability distribution → [0, 1].
 * Higher = more uncertain. Robust to multi-class near-ties (preferred over
 * margin = 1 - topConfidence for active-learning uncertainty sampling).
 */
export function normalizedEntropy(probs: ArrayLike<number>): number {
  const n = Math.max(probs.length, 2);
  let h = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i]!;
    if (p > 0) h -= p * Math.log2(p);
  }
  const norm = h / Math.log2(n);
  // Clamp against float drift.
  return norm < 0 ? 0 : norm > 1 ? 1 : norm;
}

// ─── Confusion Matrix ──────────────────────────────────────────

/**
 * Build a confusion matrix from predicted/actual class-index arrays.
 * matrix[actual][predicted] = count. Both arrays must be the same length.
 */
export function buildConfusionMatrix(
  predicted: number[],
  actual: number[],
  numClasses: number,
): number[][] {
  const matrix = Array.from({ length: numClasses }, () =>
    new Array<number>(numClasses).fill(0),
  );
  const n = Math.min(predicted.length, actual.length);
  for (let i = 0; i < n; i++) {
    const a = actual[i]!;
    const p = predicted[i]!;
    if (a >= 0 && a < numClasses && p >= 0 && p < numClasses) {
      matrix[a]![p]++;
    }
  }
  return matrix;
}

/** Overall accuracy = trace / total. */
export function accuracyFromConfusion(matrix: number[][]): number {
  let correct = 0;
  let total = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i]!.length; j++) {
      const v = matrix[i]![j]!;
      total += v;
      if (i === j) correct += v;
    }
  }
  return total > 0 ? correct / total : 0;
}

export interface ClassificationMetrics {
  accuracy: number;
  /** Macro-averaged (mean over classes, equal weight). */
  precision: number;
  recall: number;
  f1Score: number;
  /** Micro-averaged (aggregate TP/FP/FN — equals accuracy for single-label). */
  microPrecision: number;
  microRecall: number;
  microF1: number;
  perClass: Array<{ classIndex: number; precision: number; recall: number; f1: number; support: number }>;
  confusionMatrix: number[][];
}

/**
 * Compute macro + micro precision/recall/F1 + accuracy from a confusion matrix.
 * matrix[actual][predicted].
 */
export function computeMetrics(matrix: number[][]): ClassificationMetrics {
  const numClasses = matrix.length;
  const perClass: ClassificationMetrics["perClass"] = [];

  let macroP = 0;
  let macroR = 0;
  let macroF1 = 0;
  let validClasses = 0;

  let sumTP = 0;
  let sumFP = 0;
  let sumFN = 0;

  for (let c = 0; c < numClasses; c++) {
    const tp = matrix[c]?.[c] ?? 0;
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (let i = 0; i < numClasses; i++) {
      if (i !== c) {
        fp += matrix[i]?.[c] ?? 0; // predicted c but actually i
        fn += matrix[c]?.[i] ?? 0; // actually c but predicted i
      }
      support += matrix[c]?.[i] ?? 0;
    }

    const p = tp + fp > 0 ? tp / (tp + fp) : 0;
    const r = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = p + r > 0 ? (2 * p * r) / (p + r) : 0;

    perClass.push({ classIndex: c, precision: round4(p), recall: round4(r), f1: round4(f1), support });

    // Only count classes that actually appear (support > 0) for macro avg.
    if (support > 0) {
      macroP += p;
      macroR += r;
      macroF1 += f1;
      validClasses++;
    }

    sumTP += tp;
    sumFP += fp;
    sumFN += fn;
  }

  const precision = validClasses > 0 ? macroP / validClasses : 0;
  const recall = validClasses > 0 ? macroR / validClasses : 0;
  const f1Score = validClasses > 0 ? macroF1 / validClasses : 0;

  const microPrecision = sumTP + sumFP > 0 ? sumTP / (sumTP + sumFP) : 0;
  const microRecall = sumTP + sumFN > 0 ? sumTP / (sumTP + sumFN) : 0;
  const microF1 =
    microPrecision + microRecall > 0
      ? (2 * microPrecision * microRecall) / (microPrecision + microRecall)
      : 0;

  return {
    accuracy: round4(accuracyFromConfusion(matrix)),
    precision: round4(precision),
    recall: round4(recall),
    f1Score: round4(f1Score),
    microPrecision: round4(microPrecision),
    microRecall: round4(microRecall),
    microF1: round4(microF1),
    perClass,
    confusionMatrix: matrix,
  };
}

/** Convenience: metrics directly from predicted/actual index arrays. */
export function computeMetricsFromPredictions(
  predicted: number[],
  actual: number[],
  numClasses: number,
): ClassificationMetrics {
  return computeMetrics(buildConfusionMatrix(predicted, actual, numClasses));
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

// ─── Label normalization (multilingual) ────────────────────────

/**
 * Normalize a free-text label so "xước" and " Xước " collapse to one class.
 * - trim
 * - Unicode NFC normalize (compose diacritics)
 * - collapse internal whitespace
 * - lowercase (locale-independent)
 *
 * NOTE: returns lowercase canonical key. Use {@link displayLabel} for UI.
 */
export function normalizeLabel(raw: string | null | undefined): string {
  if (raw == null) return "";
  return raw
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

/** Trim + collapse whitespace but preserve original casing for display. */
export function displayLabel(raw: string | null | undefined): string {
  if (raw == null) return "";
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

// ─── Deterministic RNG (reproducible splits/shuffles) ──────────

/**
 * Mulberry32 — tiny deterministic PRNG. Given the same seed, produces the same
 * sequence on every machine/run → reproducible dataset splits.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle (returns a new array). */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = items.slice();
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Stable 32-bit hash of a string (for deriving per-key seeds). */
export function hashString(str: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
