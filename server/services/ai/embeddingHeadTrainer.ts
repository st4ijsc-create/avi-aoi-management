/**
 * AOI-C — First-party DEFECT-CLASSIFIER HEAD trained on frozen image EMBEDDINGS.
 * (doc 24 Wave-3, phase AOI-C). Flag: AOI_DL_HEAD_ENABLED (default OFF — this
 * module is pure and flag-agnostic; the flag gates the SERVING wiring in
 * embeddingHead.ts + aiInferenceEngine.ts.)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *   DINOv2 image embeddings ALREADY EXIST (aiImageEmbedding.ts → ai_image_embeddings,
 *   384-d for dinov2-small). So a genuinely-trainable, first-party defect classifier
 *   needs only a LIGHTWEIGHT HEAD over those frozen embeddings — trainable in pure
 *   JS/TS with NO Python, NO GPU, NO onnxruntime-training. This module is that head:
 *
 *     • multinomial logistic regression (softmax) with L2 regularization,
 *     • deterministic SEEDED init + mini-batch gradient descent,
 *     • optional feature standardization (train mean/std) baked into the artifact,
 *     • 1-D temperature calibration fit on the val split (honest confidence),
 *     • serializable weights (JSON) = THE shipped model artifact.
 *
 * EVERYTHING here is PURE + deterministic (no I/O, no Date-driven randomness) so it
 * is fully unit-testable with synthetic embeddings. The DB/registry/serving/fs glue
 * lives in embeddingHead.ts.
 *
 * REUSE: softmax / argmax / confusion-matrix / P-R-F1 / seeded RNG / label helpers
 * come from aiMetrics.ts — the SAME source of truth the WS-1 pipeline + eval harness
 * use, so metrics are comparable across the codebase.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";
import {
  softmax,
  argmax,
  buildConfusionMatrix,
  computeMetrics,
  normalizeLabel,
  displayLabel,
  mulberry32,
  seededShuffle,
  hashString,
  type ClassificationMetrics,
} from "../aiMetrics";

// ─── Public types ──────────────────────────────────────────────────────────────

/** One labeled embedding pair as fed in from a label source. */
export interface LabeledEmbedding {
  embedding: number[];
  label: string;
  /** Optional provenance id (ai_image_embeddings.id) used for dedupe + checksum. */
  id?: number | string | null;
}

/** A frozen, self-contained training sample (vector stored INLINE → immutable). */
export interface EmbeddingDatasetSample {
  embeddingId: number | string | null;
  label: string;
  vector: number[];
}

/** An immutable, reproducible dataset version (content-addressed by `checksum`). */
export interface EmbeddingDatasetSnapshot {
  samples: EmbeddingDatasetSample[];
  /** Stable, sorted, de-duplicated DISPLAY labels — class index = position. */
  classLabels: string[];
  labelDistribution: Record<string, number>;
  inputDim: number;
  sampleCount: number;
  /** sha256 over canonical sample content — same inputs ⇒ same checksum. */
  checksum: string;
  /** Rows dropped for empty/wrong-dim vector or empty label (honest audit). */
  dropped: { badVector: number; dimMismatch: number; noLabel: number; duplicate: number };
}

export interface SplitDataset {
  train: EmbeddingDatasetSample[];
  val: EmbeddingDatasetSample[];
  test: EmbeddingDatasetSample[];
}

export interface TrainHeadConfig {
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  /** L2 (weight-decay) strength. Default 1e-4. */
  l2?: number;
  /** Deterministic seed for weight init + batch shuffling. Default 1337. */
  seed?: number;
  earlyStoppingPatience?: number;
  /** Standardize features by train mean/std (baked into artifact). Default true. */
  standardize?: boolean;
  /** Fit a 1-D temperature on the val split to calibrate confidence. Default true. */
  fitTemperature?: boolean;
  // ── W5-B1 (doc 44, gap G4.14) — CLASS-IMBALANCE handling ────────────────────
  // Rare-defect classes get drowned out by an unweighted cross-entropy loss. The
  // caller gates these behind HEAD_CLASS_BALANCE_ENABLED; the trainer itself is
  // pure + flag-agnostic. DEFAULTS ("none" + γ=0) are BYTE-COMPATIBLE with the
  // pre-G4.14 trainer (sampleWeight collapses to exactly 1.0 → identical math).
  /**
   * Imbalance strategy:
   *  - "none"         : current behaviour (unweighted) — DEFAULT.
   *  - "class_weight" : scale each sample's loss/gradient by balanced inverse
   *                     frequency w_c = N / (C · n_c) (sklearn "balanced").
   *  - "oversample"   : replicate minority-class training rows up to the majority
   *                     count (deterministic cycling; the per-epoch shuffle mixes them).
   */
  classBalance?: "none" | "class_weight" | "oversample";
  /** Focal-loss-lite focusing parameter γ. 0 (default) = plain cross-entropy. */
  focalGamma?: number;
}

/** Per-class distribution snapshot + weights (honest audit of the balancing). */
export interface ClassBalanceInfo {
  mode: "none" | "class_weight" | "oversample";
  focalGamma: number;
  /** Raw class counts in the TRAIN split BEFORE balancing (by display label). */
  distributionBefore: Record<string, number>;
  /** Effective class counts the optimizer sees AFTER balancing (by display label). */
  distributionAfter: Record<string, number>;
  /** Per-class loss weight actually applied (index = class index). */
  classWeights: number[];
}

/** The SHIPPED artifact — serializable to JSON, self-contained for inference. */
export interface HeadArtifact {
  type: "embedding_logreg_head";
  formatVersion: 1;
  inputDim: number;
  classLabels: string[];
  /** Row-major [feature * numClasses + class]. length = inputDim * numClasses. */
  weights: number[];
  /** length = numClasses. */
  biases: number[];
  l2: number;
  /** Feature standardization baked in (null when disabled). */
  standardization: { mean: number[]; std: number[] } | null;
  /** Temperature for confidence calibration (logits / T before softmax). */
  temperature: number;
  seed: number;
  trainedAt: string;
  trainConfig: Required<Omit<TrainHeadConfig, "seed">> & { seed: number };
}

export interface TrainHeadResult {
  artifact: HeadArtifact;
  /** Metrics on the held-out VAL split, using the best-epoch weights. */
  metrics: ClassificationMetrics;
  history: Array<{ epoch: number; loss: number; acc: number; valLoss: number; valAcc: number }>;
  bestEpoch: number;
  trainCount: number;
  valCount: number;
  /** W5-B1 (G4.14) — class-imbalance audit (distribution before/after + weights). */
  classBalance: ClassBalanceInfo;
}

export interface HeadPrediction {
  label: string;
  /** Calibrated top probability (post-temperature). */
  confidence: number;
  /** Un-calibrated top probability (temperature = 1). */
  rawConfidence: number;
  probabilities: Array<{ label: string; confidence: number }>;
  /** "review" when calibrated confidence < autoThreshold → route to human (active learning). */
  route: "auto" | "review";
  /** Normalized Shannon entropy of the calibrated distribution (0..1). */
  entropy: number;
}

/** Typed error so serving can degrade honestly on an embedding-space mismatch. */
export class HeadInputDimError extends Error {
  code = "HEAD_INPUT_DIM_MISMATCH" as const;
  constructor(public expected: number, public got: number) {
    super(`Embedding dim ${got} does not match head inputDim ${expected}`);
    this.name = "HeadInputDimError";
  }
}

// ─── Dataset assembly (pure, deterministic, immutable) ──────────────────────────

/** Round a vector for a STABLE checksum (float noise-tolerant, 6 dp). */
function canonVec(vec: number[]): number[] {
  return vec.map((v) => Number(v.toFixed(6)));
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
    Object.freeze(obj);
  }
  return obj;
}

/**
 * Assemble labeled embeddings into an IMMUTABLE, REPRODUCIBLE dataset snapshot.
 *
 *  - drops rows with an empty/degenerate vector, an empty label, or a vector whose
 *    dim differs from the modal (first-seen) dim — counted in `dropped` (honest, no
 *    fabrication / no zero-padding).
 *  - de-dupes by `id` when present (first wins).
 *  - orders deterministically (normalized label, then id, then vector hash) so the
 *    checksum + any later split are reproducible regardless of input order.
 *  - the returned object is DEEP-FROZEN (immutable).
 */
export function assembleEmbeddingDataset(pairs: LabeledEmbedding[]): EmbeddingDatasetSnapshot {
  const dropped = { badVector: 0, dimMismatch: 0, noLabel: 0, duplicate: 0 };

  // Modal dim = the first valid vector's dim (all others must match it).
  let inputDim = 0;
  for (const p of pairs) {
    if (Array.isArray(p.embedding) && p.embedding.length > 0 && p.embedding.every(Number.isFinite)) {
      inputDim = p.embedding.length;
      break;
    }
  }

  const seenIds = new Set<string>();
  const kept: EmbeddingDatasetSample[] = [];
  for (const p of pairs) {
    const label = displayLabel(p.label);
    if (!label) {
      dropped.noLabel++;
      continue;
    }
    if (!Array.isArray(p.embedding) || p.embedding.length === 0 || !p.embedding.every(Number.isFinite)) {
      dropped.badVector++;
      continue;
    }
    if (p.embedding.length !== inputDim) {
      dropped.dimMismatch++;
      continue;
    }
    if (p.id != null) {
      const key = String(p.id);
      if (seenIds.has(key)) {
        dropped.duplicate++;
        continue;
      }
      seenIds.add(key);
    }
    kept.push({ embeddingId: p.id ?? null, label, vector: canonVec(p.embedding) });
  }

  // Deterministic order: normalized label → id → vector hash. Independent of input order.
  kept.sort((a, b) => {
    const la = normalizeLabel(a.label);
    const lb = normalizeLabel(b.label);
    if (la !== lb) return la < lb ? -1 : 1;
    const ia = a.embeddingId == null ? "" : String(a.embeddingId);
    const ib = b.embeddingId == null ? "" : String(b.embeddingId);
    if (ia !== ib) return ia < ib ? -1 : 1;
    const ha = hashString(a.vector.join(","));
    const hb = hashString(b.vector.join(","));
    return ha - hb;
  });

  const labelDistribution: Record<string, number> = {};
  for (const s of kept) labelDistribution[s.label] = (labelDistribution[s.label] ?? 0) + 1;
  const classLabels = Object.keys(labelDistribution).sort();

  const checksum = createHash("sha256")
    .update(
      JSON.stringify(
        kept.map((s) => [s.embeddingId, normalizeLabel(s.label), s.vector]),
      ),
    )
    .digest("hex");

  return deepFreeze({
    samples: kept,
    classLabels,
    labelDistribution,
    inputDim,
    sampleCount: kept.length,
    checksum,
    dropped,
  });
}

/**
 * Deterministic STRATIFIED split (per class, by ratio). Same samples + seed ⇒ same
 * partitions on every machine. Remainder → test so val/test stay populated.
 */
export function splitEmbeddingDataset(
  samples: EmbeddingDatasetSample[],
  splitConfig: { train: number; validation: number; test: number },
  seed = 1337,
): SplitDataset {
  const byClass = new Map<string, EmbeddingDatasetSample[]>();
  for (const s of samples) {
    const key = normalizeLabel(s.label);
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key)!.push(s);
  }

  const total = Math.max(splitConfig.train + splitConfig.validation + splitConfig.test, 1e-9);
  const trainR = splitConfig.train / total;
  const valR = splitConfig.validation / total;

  const train: EmbeddingDatasetSample[] = [];
  const val: EmbeddingDatasetSample[] = [];
  const test: EmbeddingDatasetSample[] = [];

  for (const key of Array.from(byClass.keys()).sort()) {
    const items = byClass.get(key)!;
    // Stable base order (by id, then vector hash), then seeded shuffle.
    const sorted = items.slice().sort((a, b) => {
      const ia = a.embeddingId == null ? "" : String(a.embeddingId);
      const ib = b.embeddingId == null ? "" : String(b.embeddingId);
      if (ia !== ib) return ia < ib ? -1 : 1;
      return hashString(a.vector.join(",")) - hashString(b.vector.join(","));
    });
    const shuffled = seededShuffle(sorted, (seed ^ hashString(key)) >>> 0);
    const n = shuffled.length;
    const nTrain = Math.floor(n * trainR);
    const nVal = Math.floor(n * valR);
    train.push(...shuffled.slice(0, nTrain));
    val.push(...shuffled.slice(nTrain, nTrain + nVal));
    test.push(...shuffled.slice(nTrain + nVal));
  }

  return { train, val, test };
}

// ─── Standardization ────────────────────────────────────────────────────────────

function computeStandardization(
  samples: EmbeddingDatasetSample[],
  dim: number,
): { mean: number[]; std: number[] } {
  const mean = new Array<number>(dim).fill(0);
  const std = new Array<number>(dim).fill(0);
  if (samples.length === 0) return { mean, std: std.map(() => 1) };
  for (const s of samples) for (let f = 0; f < dim; f++) mean[f] += s.vector[f];
  for (let f = 0; f < dim; f++) mean[f] /= samples.length;
  for (const s of samples) for (let f = 0; f < dim; f++) {
    const d = s.vector[f] - mean[f];
    std[f] += d * d;
  }
  for (let f = 0; f < dim; f++) {
    std[f] = Math.sqrt(std[f] / samples.length);
    if (!(std[f] > 1e-8)) std[f] = 1; // guard constant features
  }
  return { mean, std };
}

function applyStandardization(vec: number[], std: { mean: number[]; std: number[] } | null): number[] {
  if (!std) return vec;
  const out = new Array<number>(vec.length);
  for (let f = 0; f < vec.length; f++) out[f] = (vec[f] - std.mean[f]) / std.std[f];
  return out;
}

function forwardLogits(
  x: number[],
  weights: number[],
  biases: number[],
  numClasses: number,
  numFeatures: number,
): number[] {
  const logits = new Array<number>(numClasses);
  for (let c = 0; c < numClasses; c++) {
    let sum = biases[c];
    for (let f = 0; f < numFeatures; f++) sum += x[f] * weights[f * numClasses + c];
    logits[c] = sum;
  }
  return logits;
}

// ─── Class-imbalance helpers (W5-B1, gap G4.14) ─────────────────────────────────

/**
 * Balanced inverse-frequency class weights (sklearn "balanced"):
 *   w_c = N / (C · n_c)   — a rare class gets a bigger weight so its samples are
 * not drowned out. mode="none" ⇒ every weight is EXACTLY 1.0 (byte-compatible).
 * Empty classes get weight 1 (they contribute no samples anyway).
 */
function computeClassWeights(counts: number[], mode: TrainHeadConfig["classBalance"]): number[] {
  const numClasses = counts.length;
  if (mode !== "class_weight") return new Array<number>(numClasses).fill(1);
  const total = counts.reduce((a, b) => a + b, 0);
  const present = counts.filter((c) => c > 0).length || 1;
  return counts.map((c) => (c > 0 ? total / (present * c) : 1));
}

/**
 * Deterministic oversampled index order: replicate each class's rows (cycling in a
 * stable order) up to the majority-class count. No RNG here — the per-epoch
 * seededShuffle randomizes the resulting order. mode≠"oversample" ⇒ caller keeps
 * the plain [0..n) order (byte-compatible).
 */
function buildOversampledOrder(trainY: number[], numClasses: number): number[] {
  const byClass: number[][] = Array.from({ length: numClasses }, () => []);
  for (let i = 0; i < trainY.length; i++) {
    const y = trainY[i];
    if (y >= 0 && y < numClasses) byClass[y].push(i);
  }
  const target = byClass.reduce((m, arr) => Math.max(m, arr.length), 0);
  const out: number[] = [];
  for (let c = 0; c < numClasses; c++) {
    const arr = byClass[c];
    if (arr.length === 0) continue;
    for (let k = 0; k < target; k++) out.push(arr[k % arr.length]);
  }
  // Stable ascending order so a downstream shuffle is the only source of ordering.
  return out.sort((a, b) => a - b);
}

/** Map class-index counts → { displayLabel: count } for the honest audit. */
function countsToRecord(counts: number[], classLabels: string[]): Record<string, number> {
  const rec: Record<string, number> = {};
  for (let c = 0; c < classLabels.length; c++) rec[classLabels[c]] = counts[c] ?? 0;
  return rec;
}

// ─── Trainer ────────────────────────────────────────────────────────────────────

/**
 * Train a multinomial-logistic-regression HEAD on embeddings. Deterministic for a
 * given seed. Returns the serializable artifact + REAL val metrics (never fabricated).
 *
 * The classifier is trained on the TRAIN split; early stopping + best-weight
 * selection + temperature calibration all use the VAL split; the caller evaluates a
 * locked TEST split separately (via the eval harness / compareBeforeAfter) for the
 * promotion gate.
 */
export function trainEmbeddingHead(
  train: EmbeddingDatasetSample[],
  val: EmbeddingDatasetSample[],
  classLabels: string[],
  config: TrainHeadConfig = {},
): TrainHeadResult {
  const cfg = {
    epochs: config.epochs ?? 100,
    batchSize: config.batchSize ?? 16,
    learningRate: config.learningRate ?? 0.1,
    l2: config.l2 ?? 1e-4,
    seed: config.seed ?? 1337,
    earlyStoppingPatience: config.earlyStoppingPatience ?? 15,
    standardize: config.standardize ?? true,
    fitTemperature: config.fitTemperature ?? true,
    // G4.14 — default "none"/0 ⇒ sampleWeight ≡ 1.0 ⇒ byte-compatible with pre-G4.14.
    classBalance: config.classBalance ?? "none",
    focalGamma: config.focalGamma ?? 0,
  };

  if (classLabels.length < 2) throw new Error("trainEmbeddingHead requires >= 2 class labels");
  if (train.length < classLabels.length) {
    throw new Error(`Insufficient training data: ${train.length} samples for ${classLabels.length} classes`);
  }

  const numClasses = classLabels.length;
  const numFeatures = train[0].vector.length;
  const labelIndex = new Map<string, number>();
  classLabels.forEach((l, i) => labelIndex.set(normalizeLabel(l), i));

  const standardization = cfg.standardize ? computeStandardization(train, numFeatures) : null;
  const trainX = train.map((s) => applyStandardization(s.vector, standardization));
  const valX = val.map((s) => applyStandardization(s.vector, standardization));
  const trainY = train.map((s) => labelIndex.get(normalizeLabel(s.label)) ?? -1);
  const valY = val.map((s) => labelIndex.get(normalizeLabel(s.label)) ?? -1);

  // Deterministic Xavier init from the seeded RNG (NOT Math.random).
  const rand = mulberry32(cfg.seed >>> 0);
  const scale = Math.sqrt(2.0 / (numFeatures + numClasses));
  const weights = new Array<number>(numFeatures * numClasses);
  for (let i = 0; i < weights.length; i++) weights[i] = (rand() - 0.5) * 2 * scale;
  const biases = new Array<number>(numClasses).fill(0);

  let bestValAcc = -1;
  let bestValLoss = Infinity;
  let bestWeights = weights.slice();
  let bestBiases = biases.slice();
  let bestEpoch = 0;
  let noImprove = 0;
  const history: TrainHeadResult["history"] = [];

  // G4.14 — class-imbalance: raw counts → loss weights (byte-compatible when "none").
  const classCounts = new Array<number>(numClasses).fill(0);
  for (const y of trainY) if (y >= 0 && y < numClasses) classCounts[y]++;
  const classWeights = computeClassWeights(classCounts, cfg.classBalance);
  const focalGamma = cfg.focalGamma > 0 ? cfg.focalGamma : 0;

  // Optionally oversample minority rows. "none"/"class_weight" ⇒ the plain [0..n)
  // order (identical training set + iteration count as pre-G4.14).
  const order = cfg.classBalance === "oversample"
    ? buildOversampledOrder(trainY, numClasses)
    : trainX.map((_, i) => i);
  const nTrain = order.length;

  for (let epoch = 1; epoch <= cfg.epochs; epoch++) {
    // Deterministic per-epoch shuffle (seed folded with epoch).
    const shuffled = seededShuffle(order, (cfg.seed ^ hashString(`epoch:${epoch}`)) >>> 0);

    let epochLoss = 0;
    let correct = 0;
    for (let b = 0; b < shuffled.length; b += cfg.batchSize) {
      const batch = shuffled.slice(b, b + cfg.batchSize);
      const gradW = new Array<number>(weights.length).fill(0);
      const gradB = new Array<number>(numClasses).fill(0);

      for (const idx of batch) {
        const x = trainX[idx];
        const y = trainY[idx];
        const probs = softmax(forwardLogits(x, weights, biases, numClasses, numFeatures));
        const py = Math.max(probs[y], 1e-10);
        // G4.14 — per-sample weight = classWeight · focal( (1−p_y)^γ ). Both
        // collapse to EXACTLY 1.0 under the defaults ("none"/γ=0) ⇒ identical math.
        const sw = focalGamma > 0 ? classWeights[y] * Math.pow(1 - probs[y], focalGamma) : classWeights[y];
        epochLoss += sw * -Math.log(py);
        if (argmax(probs) === y) correct++;
        for (let c = 0; c < numClasses; c++) {
          const g = sw * (probs[c] - (c === y ? 1 : 0));
          gradB[c] += g;
          for (let f = 0; f < numFeatures; f++) gradW[f * numClasses + c] += x[f] * g;
        }
      }

      const step = cfg.learningRate / batch.length;
      for (let i = 0; i < weights.length; i++) {
        // L2 (weight decay) folded into the gradient step.
        weights[i] -= step * (gradW[i] + cfg.l2 * weights[i]);
      }
      for (let c = 0; c < numClasses; c++) biases[c] -= step * gradB[c];
    }

    epochLoss /= Math.max(nTrain, 1);
    const acc = nTrain > 0 ? correct / nTrain : 0;

    // Validation.
    let valLoss = 0;
    let valCorrect = 0;
    for (let i = 0; i < valX.length; i++) {
      const probs = softmax(forwardLogits(valX[i], weights, biases, numClasses, numFeatures));
      valLoss += -Math.log(Math.max(probs[valY[i]], 1e-10));
      if (argmax(probs) === valY[i]) valCorrect++;
    }
    valLoss = valX.length > 0 ? valLoss / valX.length : epochLoss;
    const valAcc = valX.length > 0 ? valCorrect / valX.length : acc;

    history.push({
      epoch,
      loss: Number(epochLoss.toFixed(6)),
      acc: Number(acc.toFixed(6)),
      valLoss: Number(valLoss.toFixed(6)),
      valAcc: Number(valAcc.toFixed(6)),
    });

    // Best = higher val acc, tie-broken by lower val loss.
    const improved = valAcc > bestValAcc || (valAcc === bestValAcc && valLoss < bestValLoss);
    if (improved) {
      bestValAcc = valAcc;
      bestValLoss = valLoss;
      bestWeights = weights.slice();
      bestBiases = biases.slice();
      bestEpoch = epoch;
      noImprove = 0;
    } else {
      noImprove++;
      if (noImprove >= cfg.earlyStoppingPatience) break;
    }
  }

  // Confusion matrix + metrics on VAL using best weights.
  const evalSet = valX.length > 0 ? { X: valX, Y: valY } : { X: trainX, Y: trainY };
  const predicted: number[] = [];
  const actual: number[] = [];
  for (let i = 0; i < evalSet.X.length; i++) {
    const probs = softmax(forwardLogits(evalSet.X[i], bestWeights, bestBiases, numClasses, numFeatures));
    predicted.push(argmax(probs));
    actual.push(evalSet.Y[i]);
  }
  const metrics = computeMetrics(buildConfusionMatrix(predicted, actual, numClasses));

  // Temperature calibration on VAL (1-D grid minimizing NLL). T=1 when no val.
  const temperature =
    cfg.fitTemperature && valX.length > 0
      ? fitTemperature(valX, valY, bestWeights, bestBiases, numClasses, numFeatures)
      : 1;

  const artifact: HeadArtifact = {
    type: "embedding_logreg_head",
    formatVersion: 1,
    inputDim: numFeatures,
    classLabels: classLabels.slice(),
    weights: bestWeights.map((w) => Number(w.toFixed(8))),
    biases: bestBiases.map((b) => Number(b.toFixed(8))),
    l2: cfg.l2,
    standardization: standardization
      ? {
          mean: standardization.mean.map((m) => Number(m.toFixed(8))),
          std: standardization.std.map((s) => Number(s.toFixed(8))),
        }
      : null,
    temperature: Number(temperature.toFixed(4)),
    seed: cfg.seed,
    trainedAt: new Date().toISOString(),
    trainConfig: cfg,
  };

  // G4.14 — honest audit of the class distribution the optimizer actually saw.
  const effectiveCounts = cfg.classBalance === "oversample"
    ? (() => {
        const c = new Array<number>(numClasses).fill(0);
        for (const idx of order) { const y = trainY[idx]; if (y >= 0 && y < numClasses) c[y]++; }
        return c;
      })()
    : classCounts;
  const classBalanceInfo: ClassBalanceInfo = {
    mode: cfg.classBalance,
    focalGamma: cfg.focalGamma,
    distributionBefore: countsToRecord(classCounts, classLabels),
    distributionAfter: countsToRecord(effectiveCounts, classLabels),
    classWeights,
  };

  return {
    artifact,
    metrics,
    history,
    bestEpoch,
    trainCount: train.length,
    valCount: val.length,
    classBalance: classBalanceInfo,
  };
}

/** 1-D temperature search (fixed grid) minimizing validation NLL. Deterministic. */
function fitTemperature(
  X: number[][],
  Y: number[],
  weights: number[],
  biases: number[],
  numClasses: number,
  numFeatures: number,
): number {
  const grid = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
  const logitsAll = X.map((x) => forwardLogits(x, weights, biases, numClasses, numFeatures));
  let bestT = 1;
  let bestNll = Infinity;
  for (const T of grid) {
    let nll = 0;
    for (let i = 0; i < logitsAll.length; i++) {
      const probs = softmax(logitsAll[i].map((l) => l / T));
      nll += -Math.log(Math.max(probs[Y[i]], 1e-10));
    }
    if (nll < bestNll) {
      bestNll = nll;
      bestT = T;
    }
  }
  return bestT;
}

// ─── Predict (pure) ─────────────────────────────────────────────────────────────

function normalizedEntropy(probs: number[]): number {
  const n = Math.max(probs.length, 2);
  let h = 0;
  for (const p of probs) if (p > 0) h -= p * Math.log2(p);
  const norm = h / Math.log2(n);
  return norm < 0 ? 0 : norm > 1 ? 1 : norm;
}

/**
 * Predict a defect class from ONE embedding using a trained head artifact.
 *
 *  - applies the artifact's standardization + temperature (calibrated confidence),
 *  - routes to human review when calibrated confidence < `autoThreshold` (grey zone),
 *  - throws HeadInputDimError on an embedding-space mismatch so serving can degrade
 *    honestly (never guesses / zero-pads a wrong-dim vector).
 */
export function predictWithHead(
  artifact: HeadArtifact,
  embedding: number[],
  opts?: { autoThreshold?: number },
): HeadPrediction {
  if (embedding.length !== artifact.inputDim) {
    throw new HeadInputDimError(artifact.inputDim, embedding.length);
  }
  const autoThreshold = opts?.autoThreshold ?? 0.7;
  const numClasses = artifact.classLabels.length;
  const numFeatures = artifact.inputDim;

  const x = applyStandardization(embedding, artifact.standardization);
  const rawLogits = forwardLogits(x, artifact.weights, artifact.biases, numClasses, numFeatures);
  const rawProbs = Array.from(softmax(rawLogits));
  const T = artifact.temperature && artifact.temperature > 0 ? artifact.temperature : 1;
  const calProbs = Array.from(softmax(rawLogits.map((l) => l / T)));

  const top = argmax(calProbs);
  const probabilities = artifact.classLabels
    .map((label, i) => ({ label, confidence: Number(calProbs[i].toFixed(6)) }))
    .sort((a, b) => b.confidence - a.confidence);

  const confidence = Number(calProbs[top].toFixed(6));
  return {
    label: artifact.classLabels[top],
    confidence,
    rawConfidence: Number(rawProbs[top].toFixed(6)),
    probabilities,
    route: confidence >= autoThreshold ? "auto" : "review",
    entropy: Number(normalizedEntropy(calProbs).toFixed(6)),
  };
}

// ─── Artifact (de)serialization + registry payload (pure) ───────────────────────

export function serializeHeadArtifact(artifact: HeadArtifact): string {
  return JSON.stringify(artifact);
}

/** Parse + validate a head artifact from JSON. Throws on a malformed/foreign blob. */
export function parseHeadArtifact(json: string | Record<string, unknown>): HeadArtifact {
  const obj = (typeof json === "string" ? JSON.parse(json) : json) as HeadArtifact;
  if (!obj || obj.type !== "embedding_logreg_head") {
    throw new Error("Not an embedding_logreg_head artifact");
  }
  if (!Array.isArray(obj.classLabels) || obj.classLabels.length < 2) {
    throw new Error("Head artifact has < 2 class labels");
  }
  if (!Array.isArray(obj.weights) || obj.weights.length !== obj.inputDim * obj.classLabels.length) {
    throw new Error("Head artifact weight shape mismatch");
  }
  return obj;
}

/**
 * Build the `model_versions` payload for registering a trained head (REAL metrics —
 * never fabricated). PURE — the DB insert lives in embeddingHead.ts. `evalReport`
 * carries the full before/after CompareReport when supplied.
 */
export function buildHeadModelVersionPayload(input: {
  modelId: number;
  version: string;
  filePath: string;
  metrics: ClassificationMetrics;
  datasetId?: number | null;
  baselineVersionId?: number | null;
  evalReport?: unknown;
  status?: "READY" | "ACTIVE" | "INACTIVE";
  changeLog?: string;
  createdBy?: number;
}): {
  modelId: number;
  version: string;
  filePath: string;
  metrics: { accuracy: number; precision: number; recall: number; f1Score: number; microF1: number };
  accuracy: string;
  status: "READY" | "ACTIVE" | "INACTIVE";
  changeLog: string;
  datasetId: number | null;
  baselineVersionId: number | null;
  evalReport: unknown;
  createdBy: number | undefined;
} {
  return {
    modelId: input.modelId,
    version: input.version,
    filePath: input.filePath,
    metrics: {
      accuracy: input.metrics.accuracy,
      precision: input.metrics.precision,
      recall: input.metrics.recall,
      f1Score: input.metrics.f1Score,
      microF1: input.metrics.microF1,
    },
    accuracy: String(Number((input.metrics.accuracy * 100).toFixed(2))),
    status: input.status ?? "READY",
    changeLog:
      input.changeLog ??
      `AOI-C embedding-head training. Val accuracy ${input.metrics.accuracy.toFixed(4)}, ` +
        `macro-F1 ${input.metrics.f1Score.toFixed(4)}.`,
    datasetId: input.datasetId ?? null,
    baselineVersionId: input.baselineVersionId ?? null,
    evalReport: input.evalReport ?? null,
    createdBy: input.createdBy,
  };
}
