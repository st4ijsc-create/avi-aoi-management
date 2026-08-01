/**
 * W5-B1 (doc 44, gap G4.12) — TRAINED NTF / FALSE-CALL CLASSIFIER.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ntfPredictorService ships an HONEST HEURISTIC (a hand-tuned weighted blend of
 * 3 signals). This service upgrades it to a genuinely-TRAINED classifier once
 * real human verdicts exist — WITHOUT Python / GPU / new deps:
 *
 *   • FEATURES  — the 3 heuristic NTF signals + the heuristic blend itself +
 *     board size + a defect-type (measurementType) one-hot + a station one-hot.
 *     Extracted via ntfPredictorService.computeNtfFeatureContext so the TRAIN
 *     and SERVE feature definitions are identical (anti train/serve skew —
 *     SYNAPSE LDS-L4 §3.2 Feature Store).
 *   • LABELS    — the HUMAN verdict on REVIEWED machine-NG inspections:
 *       cleared (overallResult ≠ NG)           → "false_call"
 *       reviewed & kept NG (acknowledged)      → "true_defect"
 *     (the measurement_corrections ledger only yields the cleared side; the kept
 *     side comes from acknowledged-still-NG inspections — together = the human
 *     feedback loop, spec §8.2 "phán quyết cuối của người … làm nhãn").
 *   • MODEL     — a lightweight multinomial-logistic HEAD reusing the PURE,
 *     deterministic embeddingHeadTrainer (softmax + L2 + temperature calibration)
 *     — the SAME engine as the vision embedding head, so it inherits the G4.14
 *     class-imbalance handling (crucial: false-calls vs real defects are skewed).
 *   • MLOps     — dataset sha256 + stratified split + eval on an INDEPENDENT
 *     TEST split + a QUALITY GATE vs the heuristic baseline on that SAME split.
 *     A candidate is promoted to ACTIVE only when it BEATS the heuristic.
 *
 * DEGRADE / FLAG: NTF_CLASSIFIER_ENABLED (default OFF) gates SERVING in
 * ntfPredictorService.computeNtfScore. When off, or when no model is active, or
 * the features can't be built, scoring falls back to the heuristic (honest
 * `method:'heuristic'`). The trainer itself is flag-agnostic.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { getDb } from "../../db/connection";
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { productInspections, ntfClassifierModels, type NtfClassifierModel } from "../../../drizzle/schema";
import {
  assembleEmbeddingDataset,
  splitEmbeddingDataset,
  trainEmbeddingHead,
  predictWithHead,
  type HeadArtifact,
  type LabeledEmbedding,
  type EmbeddingDatasetSample,
  type ClassBalanceInfo,
} from "./embeddingHeadTrainer";
import {
  buildConfusionMatrix,
  computeMetrics,
  normalizeLabel,
  type ClassificationMetrics,
} from "../aiMetrics";
import { evaluateQualityGate } from "../aiEvalHarness";
import { computeNtfFeatureContext, ntfBadgeThreshold, type NtfFeatureContext } from "./ntfPredictorService";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Feature-extractor contract version. Bump when the feature set changes so a
 *  stale artifact is never served against a newer feature vector. */
export const FEATURE_SCHEMA = "ntf-feat-v1" as const;

export const LABEL_FALSE_CALL = "false_call" as const;
export const LABEL_TRUE_DEFECT = "true_defect" as const;

/** Ordered numeric features (categoricals appended after these). */
const NUMERIC_FEATURE_NAMES = [
  "sig_repeat_offender",
  "sig_limit_margin",
  "sig_machine_trend",
  "heuristic_blend",
  "ng_point_count_norm",
  "has_numeric_margin",
] as const;
/** Index of `heuristic_blend` in the vector — used to score the heuristic baseline. */
const HEURISTIC_BLEND_INDEX = 3;

const DEFAULT_TOPK_MTYPE = 12;
const DEFAULT_TOPK_STATION = 24;
const ACTIVE_CACHE_TTL_MS = 30_000;

// ─── Flags / env ─────────────────────────────────────────────────────────────

/** Shared with the embedding head (G4.14): class-imbalance handling on the heads. */
function classBalanceMode(): "none" | "class_weight" {
  const on = String(process.env.HEAD_CLASS_BALANCE_ENABLED ?? "false").toLowerCase() === "true"
    || process.env.HEAD_CLASS_BALANCE_ENABLED === "1";
  return on ? "class_weight" : "none";
}
function focalGammaEnv(): number {
  const g = Number(process.env.HEAD_FOCAL_GAMMA);
  return Number.isFinite(g) && g > 0 ? g : 0;
}
/** Automated retrains additionally require this to swap the ACTIVE model. */
function autoPromoteEnabled(): boolean {
  return String(process.env.AI_AUTO_PROMOTE_ENABLED ?? "false").toLowerCase() === "true";
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Learned categorical vocabulary (baked into the artifact for train/serve parity). */
export interface NtfVocab {
  /** normalized measurement types (top-K by frequency). */
  measurementTypes: string[];
  /** station ids (top-K by frequency). */
  stations: number[];
}

/** The self-contained NTF classifier artifact (stored INLINE in the registry row). */
export interface NtfClassifierArtifact {
  type: "ntf_logreg_classifier";
  formatVersion: 1;
  featureSchema: string;
  featureNames: string[];
  vocab: NtfVocab;
  classLabels: string[];
  head: HeadArtifact;
  createdAt: string;
}

export interface LabeledNtfContext {
  ctx: NtfFeatureContext;
  label: string; // LABEL_FALSE_CALL | LABEL_TRUE_DEFECT
}

export interface NtfGateResult {
  pass: boolean;
  reason: string;
  metric: "f1" | "accuracy";
  candidate: number;
  baseline: number | null;
  delta: number;
  epsilon: number;
}

export interface NtfTrainCore {
  trained: boolean;
  reason?: string;
  sampleCount: number;
  labelDistribution: Record<string, number>;
  datasetChecksum?: string;
  classLabels?: string[];
  featureNames?: string[];
  vocab?: NtfVocab;
  artifact?: NtfClassifierArtifact;
  trainCount?: number;
  valCount?: number;
  testCount?: number;
  testMetrics?: ClassificationMetrics;
  valMetrics?: ClassificationMetrics;
  baselineMetrics?: ClassificationMetrics;
  classBalance?: ClassBalanceInfo;
  gate?: NtfGateResult;
}

export interface TrainNtfOptions {
  machineId?: number;
  productModelId?: number;
  sinceDays?: number;
  limit?: number;
  seed?: number;
  splitConfig?: { train: number; validation: number; test: number };
  gateEpsilon?: number;
  gateMetric?: "f1" | "accuracy";
  minSamples?: number;
  minPerClass?: number;
  topKMeasurementTypes?: number;
  topKStations?: number;
  version?: string;
  /** Persist + promote to ACTIVE when the gate passes. Default true. */
  activate?: boolean;
  /** Automated context — promotion additionally requires AI_AUTO_PROMOTE_ENABLED. */
  autoContext?: boolean;
  /** Train + evaluate but NEVER persist/activate (for previews/tests). */
  dryRun?: boolean;
  createdBy?: number;
}

export interface TrainNtfResult extends NtfTrainCore {
  modelId: number | null;
  version: string | null;
  activated: boolean;
}

// ─── Pure feature engineering ────────────────────────────────────────────────

function numericFeatures(ctx: NtfFeatureContext): number[] {
  return [
    ctx.signals.repeatOffender ?? 0.5,
    ctx.signals.limitMargin ?? 0.5,
    ctx.signals.machineTrend ?? 0.5,
    ctx.heuristicBlend ?? 0.5,
    Math.min(Math.max(ctx.ngPointCount, 0), 10) / 10,
    ctx.hasNumericMargin ? 1 : 0,
  ];
}

/** Deterministic top-K vocabulary over the labeled contexts (frequency desc, key asc). */
export function buildVocab(contexts: NtfFeatureContext[], opts: { topKMeasurementTypes?: number; topKStations?: number } = {}): NtfVocab {
  const mCounts = new Map<string, number>();
  const sCounts = new Map<number, number>();
  for (const c of contexts) {
    const mt = normalizeLabel(c.measurementType ?? "");
    if (mt) mCounts.set(mt, (mCounts.get(mt) ?? 0) + 1);
    if (c.stationId != null) sCounts.set(c.stationId, (sCounts.get(c.stationId) ?? 0) + 1);
  }
  const topKM = opts.topKMeasurementTypes ?? DEFAULT_TOPK_MTYPE;
  const topKS = opts.topKStations ?? DEFAULT_TOPK_STATION;
  const measurementTypes = Array.from(mCounts.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, topKM)
    .map(([k]) => k);
  const stations = Array.from(sCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, topKS)
    .map(([k]) => k);
  return { measurementTypes, stations };
}

/** Feature names parallel to buildFeatureVector's output. */
export function ntfFeatureNames(vocab: NtfVocab): string[] {
  return [
    ...NUMERIC_FEATURE_NAMES,
    ...vocab.measurementTypes.map((t) => `mtype:${t}`),
    "mtype:__other__",
    ...vocab.stations.map((s) => `station:${s}`),
    "station:__other__",
  ];
}

/** Build the numeric feature vector for one context using a baked vocab (pure). */
export function buildFeatureVector(ctx: NtfFeatureContext, vocab: NtfVocab): number[] {
  const num = numericFeatures(ctx);
  const mt = normalizeLabel(ctx.measurementType ?? "");
  const mtypeInVocab = mt !== "" && vocab.measurementTypes.includes(mt);
  const mtypeOneHot = vocab.measurementTypes.map((t) => (t === mt ? 1 : 0));
  const st = ctx.stationId;
  const stationInVocab = st != null && vocab.stations.includes(st);
  const stationOneHot = vocab.stations.map((s) => (s === st ? 1 : 0));
  return [
    ...num,
    ...mtypeOneHot,
    mtypeInVocab ? 0 : 1, // mtype:__other__
    ...stationOneHot,
    stationInVocab ? 0 : 1, // station:__other__
  ];
}

// ─── Evaluation (pure) ───────────────────────────────────────────────────────

function evalHead(head: HeadArtifact, samples: EmbeddingDatasetSample[], classLabels: string[]): ClassificationMetrics {
  const idx = new Map<string, number>();
  classLabels.forEach((l, i) => idx.set(normalizeLabel(l), i));
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const s of samples) {
    const a = idx.get(normalizeLabel(s.label));
    if (a == null) continue;
    let pred: number;
    try {
      const p = predictWithHead(head, s.vector);
      pred = idx.get(normalizeLabel(p.label)) ?? -1;
    } catch {
      continue;
    }
    predicted.push(pred);
    actual.push(a);
  }
  return computeMetrics(buildConfusionMatrix(predicted, actual, classLabels.length));
}

/**
 * Heuristic BASELINE on the same split: recover the heuristic blend from the
 * feature vector (feature #HEURISTIC_BLEND_INDEX) and apply the badge threshold —
 * blend ≥ threshold ⇒ predict false_call, else true_defect. The gate promotes a
 * candidate only when it BEATS this (spec: "chỉ activate khi thắng heuristic").
 */
function evalHeuristicBaseline(samples: EmbeddingDatasetSample[], classLabels: string[], threshold: number): ClassificationMetrics {
  const idx = new Map<string, number>();
  classLabels.forEach((l, i) => idx.set(normalizeLabel(l), i));
  const fcIdx = idx.get(normalizeLabel(LABEL_FALSE_CALL));
  const tdIdx = idx.get(normalizeLabel(LABEL_TRUE_DEFECT));
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const s of samples) {
    const a = idx.get(normalizeLabel(s.label));
    if (a == null) continue;
    const blend = s.vector[HEURISTIC_BLEND_INDEX] ?? 0.5;
    const pred = blend >= threshold ? fcIdx : tdIdx;
    if (pred == null) continue;
    predicted.push(pred);
    actual.push(a);
  }
  return computeMetrics(buildConfusionMatrix(predicted, actual, classLabels.length));
}

// ─── Artifact (de)serialization ──────────────────────────────────────────────

export function parseNtfArtifact(json: unknown): NtfClassifierArtifact {
  const obj = (typeof json === "string" ? JSON.parse(json) : json) as NtfClassifierArtifact;
  if (!obj || obj.type !== "ntf_logreg_classifier") throw new Error("Not an ntf_logreg_classifier artifact");
  if (!obj.head || !Array.isArray(obj.head.classLabels) || obj.head.classLabels.length < 2) {
    throw new Error("NTF artifact missing a valid head");
  }
  if (!obj.vocab || !Array.isArray(obj.vocab.measurementTypes) || !Array.isArray(obj.vocab.stations)) {
    throw new Error("NTF artifact missing vocab");
  }
  return obj;
}

// ─── Training core (PURE over labeled contexts — no DB) ──────────────────────

/**
 * Train + evaluate + gate a candidate NTF classifier from labeled feature
 * contexts. PURE (no I/O) so it is fully unit-testable with synthetic contexts.
 * Persistence/activation lives in trainNtfClassifier.
 */
export function trainNtfFromLabeledContexts(labeled: LabeledNtfContext[], opts: TrainNtfOptions = {}): NtfTrainCore {
  const seed = opts.seed ?? 1337;
  const splitConfig = opts.splitConfig ?? { train: 0.7, validation: 0.15, test: 0.15 };
  const minSamples = opts.minSamples ?? 30;
  const minPerClass = opts.minPerClass ?? 8;

  if (labeled.length < minSamples) {
    return { trained: false, reason: `insufficient_labels (${labeled.length} < ${minSamples})`, sampleCount: labeled.length, labelDistribution: {} };
  }

  const vocab = buildVocab(labeled.map((l) => l.ctx), {
    topKMeasurementTypes: opts.topKMeasurementTypes,
    topKStations: opts.topKStations,
  });
  const names = ntfFeatureNames(vocab);

  const pairs: LabeledEmbedding[] = labeled.map((l) => ({
    id: l.ctx.inspectionId,
    label: l.label,
    embedding: buildFeatureVector(l.ctx, vocab),
  }));
  const snapshot = assembleEmbeddingDataset(pairs);

  if (snapshot.classLabels.length < 2) {
    return { trained: false, reason: `single_class (${snapshot.classLabels.join(",") || "none"})`, sampleCount: snapshot.sampleCount, labelDistribution: snapshot.labelDistribution };
  }
  for (const c of snapshot.classLabels) {
    if ((snapshot.labelDistribution[c] ?? 0) < minPerClass) {
      return { trained: false, reason: `class '${c}' has < ${minPerClass} samples`, sampleCount: snapshot.sampleCount, labelDistribution: snapshot.labelDistribution };
    }
  }

  const split = splitEmbeddingDataset(snapshot.samples, splitConfig, seed);
  if (split.train.length < snapshot.classLabels.length) {
    return { trained: false, reason: "train_split_too_small", sampleCount: snapshot.sampleCount, labelDistribution: snapshot.labelDistribution };
  }

  const trained = trainEmbeddingHead(split.train, split.val, snapshot.classLabels, {
    seed,
    classBalance: classBalanceMode(),
    focalGamma: focalGammaEnv(),
  });

  const testSet = split.test.length > 0 ? split.test : split.val;
  const testMetrics = evalHead(trained.artifact, testSet, snapshot.classLabels);
  const baselineMetrics = evalHeuristicBaseline(testSet, snapshot.classLabels, ntfBadgeThreshold());

  const gateMetric = opts.gateMetric ?? "f1";
  const candidate = gateMetric === "accuracy" ? testMetrics.accuracy : testMetrics.f1Score;
  const baseline = gateMetric === "accuracy" ? baselineMetrics.accuracy : baselineMetrics.f1Score;
  const rawGate = evaluateQualityGate(candidate, baseline, opts.gateEpsilon ?? 0);
  const gate: NtfGateResult = {
    pass: rawGate.pass,
    reason: rawGate.reason,
    metric: gateMetric,
    candidate,
    baseline,
    delta: rawGate.accuracyDelta,
    epsilon: rawGate.epsilon,
  };

  const artifact: NtfClassifierArtifact = {
    type: "ntf_logreg_classifier",
    formatVersion: 1,
    featureSchema: FEATURE_SCHEMA,
    featureNames: names,
    vocab,
    classLabels: snapshot.classLabels,
    head: trained.artifact,
    createdAt: new Date().toISOString(),
  };

  return {
    trained: true,
    sampleCount: snapshot.sampleCount,
    labelDistribution: snapshot.labelDistribution,
    datasetChecksum: snapshot.checksum,
    classLabels: snapshot.classLabels,
    featureNames: names,
    vocab,
    artifact,
    trainCount: split.train.length,
    valCount: split.val.length,
    testCount: split.test.length,
    testMetrics,
    valMetrics: trained.metrics,
    baselineMetrics,
    classBalance: trained.classBalance,
    gate,
  };
}

// ─── Label collection (DB) ───────────────────────────────────────────────────

/**
 * Collect labeled feature contexts from REVIEWED machine-NG inspections.
 * label: cleared (overall ≠ NG) → false_call; acknowledged & kept NG → true_defect.
 * Sequential context extraction (like the eval harness) — offline/on-demand only.
 */
export async function collectLabeledContexts(opts: TrainNtfOptions = {}): Promise<LabeledNtfContext[]> {
  const db = await getDb();
  if (!db) return [];

  const conds: SQL[] = [
    eq(productInspections.originalResult, "NG"),
    // reviewed = acknowledged OR verdict changed (mirrors measurementCorrectionsService).
    sql`(${productInspections.acknowledgedAt} IS NOT NULL OR ${productInspections.overallResult} <> 'NG')`,
  ];
  if (opts.machineId != null) conds.push(eq(productInspections.machineId, opts.machineId));
  if (opts.productModelId != null) conds.push(eq(productInspections.productModelId, opts.productModelId));
  if (opts.sinceDays != null) {
    conds.push(gte(productInspections.inspectionTime, new Date(Date.now() - opts.sinceDays * 86_400_000)));
  }

  const cap = Math.min(Math.max(opts.limit ?? 2000, 1), 10000);
  const rows = await db
    .select({ id: productInspections.id, overallResult: productInspections.overallResult })
    .from(productInspections)
    .where(and(...conds))
    .orderBy(desc(productInspections.inspectionTime))
    .limit(cap);

  const out: LabeledNtfContext[] = [];
  for (const r of rows) {
    const ctx = await computeNtfFeatureContext(r.id, { needStation: true });
    if (!ctx) continue;
    const label = r.overallResult !== "NG" ? LABEL_FALSE_CALL : LABEL_TRUE_DEFECT;
    out.push({ ctx, label });
  }
  return out;
}

// ─── Full train → persist → gate → activate (DB) ─────────────────────────────

export async function trainNtfClassifier(opts: TrainNtfOptions = {}): Promise<TrainNtfResult> {
  const labeled = await collectLabeledContexts(opts);
  const core = trainNtfFromLabeledContexts(labeled, opts);

  if (!core.trained || opts.dryRun) {
    return { ...core, modelId: null, version: opts.version ?? null, activated: false };
  }

  const db = await getDb();
  if (!db) return { ...core, modelId: null, version: opts.version ?? null, activated: false, trained: false, reason: "no_db" };

  const version = opts.version ?? `ntf-${Date.now()}`;
  const promotionAllowed = !!core.gate?.pass && (opts.activate ?? true) && (!opts.autoContext || autoPromoteEnabled());

  // Insert as candidate first (never violates the single-active partial unique index).
  const [row] = await db
    .insert(ntfClassifierModels)
    .values({
      version,
      status: "candidate",
      featureSchema: FEATURE_SCHEMA,
      classLabels: core.classLabels ?? [],
      featureNames: core.featureNames ?? [],
      artifact: core.artifact as unknown as Record<string, unknown>,
      datasetChecksum: core.datasetChecksum ?? "",
      sampleCount: core.sampleCount,
      trainCount: core.trainCount ?? 0,
      valCount: core.valCount ?? 0,
      testCount: core.testCount ?? 0,
      labelDistribution: core.labelDistribution,
      metrics: core.testMetrics as unknown as Record<string, unknown>,
      valMetrics: core.valMetrics as unknown as Record<string, unknown>,
      baselineMetrics: core.baselineMetrics as unknown as Record<string, unknown>,
      gate: core.gate as unknown as Record<string, unknown>,
      classBalance: core.classBalance as unknown as Record<string, unknown>,
      machineId: opts.machineId ?? null,
      productModelId: opts.productModelId ?? null,
      createdBy: opts.createdBy ?? null,
    })
    .returning({ id: ntfClassifierModels.id });

  let activated = false;
  if (promotionAllowed && row) {
    // Scope = the same (machineId) scope. Retire the prior active FIRST so the
    // single-active partial unique index is never transiently violated.
    const scopeCond = opts.machineId != null
      ? eq(ntfClassifierModels.machineId, opts.machineId)
      : sql`${ntfClassifierModels.machineId} IS NULL`;
    await db.update(ntfClassifierModels)
      .set({ status: "retired" })
      .where(and(eq(ntfClassifierModels.status, "active"), scopeCond));
    await db.update(ntfClassifierModels)
      .set({ status: "active", activatedAt: new Date() })
      .where(eq(ntfClassifierModels.id, row.id));
    activated = true;
    _resetNtfClassifierCache();
  }

  return { ...core, modelId: row?.id ?? null, version, activated };
}

// ─── Serving (active model) ──────────────────────────────────────────────────

type ActiveCacheEntry = { at: number; model: NtfClassifierModel | null; artifact: NtfClassifierArtifact | null };
const activeCache = new Map<string, ActiveCacheEntry>();

function scopeKey(machineId: number | null): string {
  return machineId == null ? "global" : `m:${machineId}`;
}

/** TEST/ops hook: drop the active-model cache (mirrors invalidateConfigCache). */
export function _resetNtfClassifierCache(): void {
  activeCache.clear();
}

async function loadActiveScope(machineId: number | null): Promise<{ model: NtfClassifierModel; artifact: NtfClassifierArtifact } | null> {
  const key = scopeKey(machineId);
  const cached = activeCache.get(key);
  if (cached && Date.now() - cached.at < ACTIVE_CACHE_TTL_MS) {
    return cached.model && cached.artifact ? { model: cached.model, artifact: cached.artifact } : null;
  }
  const db = await getDb();
  if (!db) return null;
  const cond = machineId == null
    ? sql`${ntfClassifierModels.machineId} IS NULL`
    : eq(ntfClassifierModels.machineId, machineId);
  const [row] = await db
    .select()
    .from(ntfClassifierModels)
    .where(and(eq(ntfClassifierModels.status, "active"), cond))
    .orderBy(desc(ntfClassifierModels.activatedAt))
    .limit(1);

  let artifact: NtfClassifierArtifact | null = null;
  if (row) {
    try {
      artifact = parseNtfArtifact(row.artifact);
    } catch {
      artifact = null;
    }
  }
  activeCache.set(key, { at: Date.now(), model: artifact ? row : null, artifact });
  return artifact && row ? { model: row, artifact } : null;
}

/**
 * Load the ACTIVE model (30s cache). A machine-SCOPED active model wins over the
 * GLOBAL one; falls back to global. null when none/unparseable.
 */
export async function getActiveNtfClassifier(
  machineId?: number | null,
): Promise<{ model: NtfClassifierModel; artifact: NtfClassifierArtifact } | null> {
  if (machineId != null) {
    const scoped = await loadActiveScope(machineId);
    if (scoped) return scoped;
  }
  return loadActiveScope(null);
}

/**
 * Serve the trained P(false_call) for a feature context. Returns null (→ heuristic
 * fallback in ntfPredictorService) when no model is active, the feature schema
 * skews, the vector width mismatches, or prediction fails. NEVER throws.
 */
export async function classifyNtfContext(ctx: NtfFeatureContext): Promise<number | null> {
  const active = await getActiveNtfClassifier(ctx.machineId);
  if (!active) return null;
  const { artifact } = active;
  if (artifact.featureSchema !== FEATURE_SCHEMA) return null;
  try {
    const vector = buildFeatureVector(ctx, artifact.vocab);
    if (vector.length !== artifact.head.inputDim) return null;
    const pred = predictWithHead(artifact.head, vector);
    const fc = pred.probabilities.find((p) => normalizeLabel(p.label) === normalizeLabel(LABEL_FALSE_CALL));
    if (!fc || !Number.isFinite(fc.confidence)) return null;
    return fc.confidence < 0 ? 0 : fc.confidence > 1 ? 1 : fc.confidence;
  } catch {
    return null;
  }
}
