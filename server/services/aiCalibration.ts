/**
 * B2 — Confidence calibration service.
 *
 * Provides:
 *  - computeECE: Expected/Maximum Calibration Error + Brier score + reliability bins.
 *  - fitTemperature: 1-D temperature scaling that minimises NLL on a labelled set.
 *  - collectCalibrationSamples: pulls {confidence, correct} from human-reviewed
 *    quality-gate results (ground truth = reviewDecision).
 *
 * Offline-first: only reads the internal Postgres DB; no cloud calls.
 *
 * ── IMPORTANT LIMITATION (read before using fitTemperature) ──
 * The ONNX inference engine only persists the top-K *probabilities* per inspection
 * (aiQualityGateResults.confidence / predictions), NOT the full pre-softmax logit
 * vector. Proper temperature scaling needs the full logits to recompute softmax.
 * We therefore offer two fit modes:
 *   - fitTemperature(samples)            : binary-confidence approximation. Treats the
 *                                          stored top-1 confidence p as a Bernoulli logit
 *                                          z = ln(p/(1-p)) and minimises binary NLL. This
 *                                          is an APPROXIMATION (single logit, not the full
 *                                          softmax vector) but is monotone-correct: an
 *                                          overconfident model yields T>1 and lower ECE.
 *   - fitTemperatureFromLogits(logits, labels) : exact multi-class fit when full logits
 *                                          ARE available (e.g. offline calibration runs).
 * Callers that only have stored confidences should prefer the binary path and surface
 * the approximation to the user (the router stores temperature as optional).
 */

export interface CalibrationSample {
  confidence: number; // top-1 confidence in [0,1]
  correct: boolean;   // did the prediction match ground truth?
}

export interface ReliabilityBin {
  binLower: number;
  binUpper: number;
  avgConfidence: number;
  accuracy: number;
  count: number;
}

export interface ECEResult {
  ece: number;
  mce: number;
  brierScore: number;
  reliabilityBins: ReliabilityBin[];
  sampleCount: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const EPS = 1e-7;

/**
 * Compute ECE, MCE, Brier score and the reliability diagram for a set of samples.
 *
 * Binning: [0,1] split into `bins` equal-width intervals on confidence. A sample with
 * confidence c falls in bin floor(c*bins) (c===1 → last bin). For each bin b:
 *   acc(b)  = mean(correct), conf(b) = mean(confidence)
 *   ECE = Σ_b (|B_b|/N) · |acc(b) − conf(b)|
 *   MCE = max_b |acc(b) − conf(b)|   (over non-empty bins)
 * Brier (binary top-1) = mean( (confidence − correct)^2 ).
 */
export function computeECE(samples: CalibrationSample[], bins = 10): ECEResult {
  const N = samples.length;
  const numBins = Math.max(1, Math.floor(bins));

  // Initialise bins
  const binW = 1 / numBins;
  const reliabilityBins: ReliabilityBin[] = Array.from({ length: numBins }, (_, i) => ({
    binLower: i * binW,
    binUpper: (i + 1) * binW,
    avgConfidence: 0,
    accuracy: 0,
    count: 0,
  }));

  if (N === 0) {
    return { ece: 0, mce: 0, brierScore: 0, reliabilityBins, sampleCount: 0 };
  }

  const confSum = new Array(numBins).fill(0);
  const correctSum = new Array(numBins).fill(0);
  let brierSum = 0;

  for (const s of samples) {
    const c = clamp01(s.confidence);
    const y = s.correct ? 1 : 0;
    brierSum += (c - y) * (c - y);
    let idx = Math.floor(c * numBins);
    if (idx >= numBins) idx = numBins - 1; // c === 1 → last bin
    if (idx < 0) idx = 0;
    confSum[idx] += c;
    correctSum[idx] += y;
    reliabilityBins[idx]!.count += 1;
  }

  let ece = 0;
  let mce = 0;
  for (let i = 0; i < numBins; i++) {
    const bin = reliabilityBins[i]!;
    if (bin.count === 0) continue;
    bin.avgConfidence = confSum[i] / bin.count;
    bin.accuracy = correctSum[i] / bin.count;
    const gap = Math.abs(bin.accuracy - bin.avgConfidence);
    ece += (bin.count / N) * gap;
    if (gap > mce) mce = gap;
  }

  return {
    ece,
    mce,
    brierScore: brierSum / N,
    reliabilityBins,
    sampleCount: N,
  };
}

/**
 * Binary negative log-likelihood of stored top-1 confidences after temperature T.
 * Each confidence p is mapped to a Bernoulli logit z = ln(p/(1-p)); scaled probability
 * is sigmoid(z / T). Lower is better.
 */
function binaryNLL(samples: CalibrationSample[], T: number): number {
  if (T <= 0) return Infinity;
  let nll = 0;
  for (const s of samples) {
    const p = clamp01(s.confidence);
    const pc = Math.min(1 - EPS, Math.max(EPS, p));
    const z = Math.log(pc / (1 - pc));
    const scaled = 1 / (1 + Math.exp(-z / T));
    const y = s.correct ? 1 : 0;
    nll -= y * Math.log(Math.max(EPS, scaled)) + (1 - y) * Math.log(Math.max(EPS, 1 - scaled));
  }
  return nll / samples.length;
}

/** Apply a temperature to a single stored confidence (binary approximation). */
export function applyTemperatureToConfidence(confidence: number, T: number): number {
  const p = clamp01(confidence);
  if (T === 1) return p;
  const pc = Math.min(1 - EPS, Math.max(EPS, p));
  const z = Math.log(pc / (1 - pc));
  return 1 / (1 + Math.exp(-z / T));
}

export interface TemperatureFitResult {
  temperature: number;
  nllBefore: number;
  nllAfter: number;
  eceBefore: number;
  eceAfter: number;
  method: "binary-confidence-approx" | "multiclass-logits";
  approximate: boolean;
}

/**
 * Fit a scalar temperature by minimising binary NLL over [tMin, tMax] using ternary
 * search (binaryNLL is unimodal in T for this objective). APPROXIMATE — see file header:
 * uses stored top-1 confidences, not full logits.
 *
 * Returns null when there are too few samples to fit meaningfully (< 10) or when the set
 * has no positive AND negative examples (NLL is degenerate/monotone in T).
 */
export function fitTemperature(
  samples: CalibrationSample[],
  opts?: { bins?: number; tMin?: number; tMax?: number; iterations?: number },
): TemperatureFitResult | null {
  if (samples.length < 10) return null;
  const anyCorrect = samples.some(s => s.correct);
  const anyWrong = samples.some(s => !s.correct);
  if (!anyCorrect || !anyWrong) return null;

  const bins = opts?.bins ?? 10;
  let lo = opts?.tMin ?? 0.05;
  let hi = opts?.tMax ?? 10;
  const iters = opts?.iterations ?? 60;

  for (let i = 0; i < iters; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (binaryNLL(samples, m1) < binaryNLL(samples, m2)) {
      hi = m2;
    } else {
      lo = m1;
    }
  }
  const T = (lo + hi) / 2;

  const eceBefore = computeECE(samples, bins).ece;
  const scaledSamples = samples.map(s => ({
    confidence: applyTemperatureToConfidence(s.confidence, T),
    correct: s.correct,
  }));
  const eceAfter = computeECE(scaledSamples, bins).ece;

  return {
    temperature: Number(T.toFixed(4)),
    nllBefore: binaryNLL(samples, 1),
    nllAfter: binaryNLL(samples, T),
    eceBefore,
    eceAfter,
    method: "binary-confidence-approx",
    approximate: true,
  };
}

/** softmax for the exact (full-logits) path. */
function softmaxVec(logits: number[], T: number): number[] {
  const scaled = logits.map(l => l / T);
  const max = Math.max(...scaled);
  const exps = scaled.map(l => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

function multiclassNLL(logitsSet: number[][], labels: number[], T: number): number {
  if (T <= 0) return Infinity;
  let nll = 0;
  for (let i = 0; i < logitsSet.length; i++) {
    const probs = softmaxVec(logitsSet[i]!, T);
    const p = probs[labels[i]!] ?? EPS;
    nll -= Math.log(Math.max(EPS, p));
  }
  return nll / logitsSet.length;
}

/**
 * EXACT temperature scaling when full pre-softmax logits are available (offline runs).
 * Minimises multi-class NLL via ternary search. Use this in preference to
 * fitTemperature when logits exist.
 */
export function fitTemperatureFromLogits(
  logitsSet: number[][],
  labels: number[],
  opts?: { tMin?: number; tMax?: number; iterations?: number },
): { temperature: number; nllBefore: number; nllAfter: number; method: "multiclass-logits" } | null {
  if (logitsSet.length === 0 || logitsSet.length !== labels.length) return null;
  let lo = opts?.tMin ?? 0.05;
  let hi = opts?.tMax ?? 10;
  const iters = opts?.iterations ?? 60;
  for (let i = 0; i < iters; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (multiclassNLL(logitsSet, labels, m1) < multiclassNLL(logitsSet, labels, m2)) {
      hi = m2;
    } else {
      lo = m1;
    }
  }
  const T = (lo + hi) / 2;
  return {
    temperature: Number(T.toFixed(4)),
    nllBefore: multiclassNLL(logitsSet, labels, 1),
    nllAfter: multiclassNLL(logitsSet, labels, T),
    method: "multiclass-logits",
  };
}

// ───────────────────────── Data collection ─────────────────────────

export interface CollectScope {
  modelId: number;
  period?: { start?: Date; end?: Date };
  scope?: { machineId?: number; productModelId?: number };
}

/**
 * Collect {confidence, correct} samples from human-reviewed quality-gate results.
 *
 * Ground truth = reviewDecision ("OK" | "NG"). The AI's predicted class is derived from
 * its `decision`: AUTO_NG (or a topLabel that is not an OK label) ⇒ predicted NG; AUTO_OK
 * ⇒ predicted OK. NEEDS_REVIEW / MANUAL rows with no clear machine verdict are still
 * usable: we fall back to topLabel. `correct` = (predictedNG === reviewedNG).
 *
 * Only rows that (a) belong to configs for the given model, (b) have a non-null
 * reviewDecision, and (c) have a non-null confidence are returned. Returns null when no
 * usable samples exist (N=0) so callers fail safe.
 */
export async function collectCalibrationSamples(
  args: CollectScope,
): Promise<CalibrationSample[] | null> {
  const { getDb } = await import("../db");
  const { aiQualityGateResults, aiQualityGateConfigs, productInspections } = await import(
    "../../drizzle/schema"
  );
  const { eq, and, gte, lte, isNotNull, inArray } = await import("drizzle-orm");

  const db = await getDb();
  if (!db) return null;

  // Resolve config ids belonging to this model (+ optional scope).
  const cfgConds = [eq(aiQualityGateConfigs.modelId, args.modelId)];
  if (args.scope?.machineId != null) cfgConds.push(eq(aiQualityGateConfigs.machineId, args.scope.machineId));
  if (args.scope?.productModelId != null) cfgConds.push(eq(aiQualityGateConfigs.productModelId, args.scope.productModelId));

  const configs = await db
    .select({ id: aiQualityGateConfigs.id })
    .from(aiQualityGateConfigs)
    .where(and(...cfgConds));
  const configIds = configs.map(c => c.id);
  if (configIds.length === 0) return null;

  const conds = [
    inArray(aiQualityGateResults.configId, configIds),
    isNotNull(aiQualityGateResults.reviewDecision),
    isNotNull(aiQualityGateResults.confidence),
  ];
  if (args.period?.start) conds.push(gte(aiQualityGateResults.createdAt, args.period.start));
  if (args.period?.end) conds.push(lte(aiQualityGateResults.createdAt, args.period.end));

  const rows = await db
    .select({
      confidence: aiQualityGateResults.confidence,
      decision: aiQualityGateResults.decision,
      topLabel: aiQualityGateResults.topLabel,
      reviewDecision: aiQualityGateResults.reviewDecision,
    })
    .from(aiQualityGateResults)
    .where(and(...conds));

  // productInspections imported for parity with the plan (scope joins are handled via
  // config scope above); referenced here to keep the import meaningful for future use.
  void productInspections;

  const samples: CalibrationSample[] = [];
  for (const r of rows) {
    const conf = r.confidence != null ? Number(r.confidence) : NaN;
    if (!Number.isFinite(conf)) continue;
    const reviewedNg = String(r.reviewDecision).toUpperCase() === "NG";
    // Derive the model's predicted OK/NG.
    let predictedNg: boolean;
    if (r.decision === "AUTO_NG") predictedNg = true;
    else if (r.decision === "AUTO_OK") predictedNg = false;
    else predictedNg = !!r.topLabel && r.topLabel.toUpperCase() !== "OK";
    const correct = predictedNg === reviewedNg;
    samples.push({ confidence: clamp01(conf), correct });
  }

  return samples.length > 0 ? samples : null;
}
