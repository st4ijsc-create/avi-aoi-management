/**
 * AOI-C — Embedding-head ORCHESTRATION + SERVING (doc 24 Wave-3).
 * Flag: AOI_DL_HEAD_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The impure glue around the PURE trainer (embeddingHeadTrainer.ts):
 *
 *   1. DATASET VERSIONING — collect (embedding, label) pairs from the STORED DINOv2
 *      embeddings (ai_image_embeddings) + active-learning human labels
 *      (ai_label_queue), assemble them via the pure core, and persist an IMMUTABLE
 *      snapshot row (ai_embedding_datasets). Never re-reads the embeddings later.
 *
 *   2. TRAIN + REGISTER — split (deterministic) → train the head → serialize the
 *      artifact JSON to uploads/ → register it as a model_version in the EXISTING
 *      registry (ai_models / model_versions) with REAL metrics + a quality gate vs
 *      the current ACTIVE version. Activation reuses aiModelService.activateModelVersion
 *      (the SAME path manual activation + auto-rollback use — no registry fork).
 *
 *   3. SERVE — runEmbeddingHeadInference() mirrors runInference()'s shape and is
 *      dispatched to from aiInferenceEngine.runInference when the model is a head
 *      model AND the flag is on. Because the quality gate, ensemble, A/B canary and
 *      active-learning auto-label ALL call runInference, they serve the head for
 *      free. Low-confidence predictions route to human review by re-using the
 *      active-learning queue.
 *
 *   4. A/B + DRIFT + ROLLBACK — the head registers as an ordinary ai_models row, so
 *      the existing A/B canary (aiABTesting), perf-snapshot producer, and
 *      modelAutoRollback apply UNCHANGED. Thin helpers here just wire them up.
 *
 * HONEST DEGRADE: when the flag is off, or the model isn't a head model, runInference
 * behaves EXACTLY as today (ONNX/threshold path). When a head IS registered but the
 * runtime embedding space doesn't match the head's inputDim (e.g. no real DINOv2 at
 * AI_DINOV2_MODEL_PATH → 1024-d text-of-image vs a 384-d head), serving returns a
 * LABELED degraded result (empty predictions, confidence 0) → the quality gate routes
 * it to review. It never fabricates a class.
 *
 * PREREQUISITE (AOI-A): the head trains on DINOv2 embeddings, so a real DINOv2 ONNX
 * at AI_DINOV2_MODEL_PATH is required for REAL-image accuracy. Without it, both the
 * training embeddings and the serving embeddings degrade to text-of-image (1024-d)
 * — the round-trip still works, but accuracy reflects the degraded features (labeled).
 * ════════════════════════════════════════════════════════════════════════════
 */

import path from "path";
import fs from "fs";
import { getDb } from "../../db/connection";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  aiImageEmbeddings,
  aiLabelQueue,
  aiEmbeddingDatasets,
  type AiModel,
  type InsertAiEmbeddingDataset,
  type InsertAiLabelQueue,
  type InsertModelVersion,
} from "../../../drizzle/schema";
import {
  getAiModelById,
  getAiModelByCode,
  getAiModels,
  createAiModel,
  createModelVersion,
  getModelVersions,
  createInferenceResult,
  getActiveModelForProduct,
} from "../../db/ai";
import { activateModelVersion } from "../aiModelService";
import { evaluateQualityGate, type QualityGateResult } from "../aiEvalHarness";
import {
  parseVectorLiteral,
  extractEmbedding,
  embedImageAsText,
  type EmbeddingSource,
} from "../aiImageEmbedding";
import {
  assembleEmbeddingDataset,
  splitEmbeddingDataset,
  trainEmbeddingHead,
  predictWithHead,
  parseHeadArtifact,
  serializeHeadArtifact,
  buildHeadModelVersionPayload,
  HeadInputDimError,
  type EmbeddingDatasetSnapshot,
  type EmbeddingDatasetSample,
  type HeadArtifact,
  type TrainHeadConfig,
  type LabeledEmbedding,
} from "./embeddingHeadTrainer";
import { computeMetrics, buildConfusionMatrix, normalizeLabel } from "../aiMetrics";
import {
  getFeatures,
  recordInference,
  prepareImageEmbeddingVector,
  isFeatureStoreEnabled,
  IMAGE_EMBEDDING_ENTITY,
  IMAGE_EMBEDDING_FEATURE,
} from "./featureStore";

export const HEAD_KIND = "embedding_logreg_head" as const;
export const HEAD_MODEL_FORMAT = "CUSTOM" as const;

// ─── Flag + detection ───────────────────────────────────────────────────────────

export function isEmbeddingHeadEnabled(): boolean {
  const v = String(process.env.AOI_DL_HEAD_ENABLED ?? "false").toLowerCase();
  return v === "true" || v === "1";
}

/** Whether an automated retrain may swap the ACTIVE head (reuses the WS-1 flag). */
function autoPromoteEnabled(): boolean {
  return String(process.env.AI_AUTO_PROMOTE_ENABLED ?? "false").toLowerCase() === "true";
}

/**
 * W5-B1 (G4.14) — class-imbalance handling on the head trainer. Default OFF ⇒ the
 * trainer runs the pre-G4.14 unweighted loss (byte-compatible). When ON, rare
 * defect classes are balanced by inverse-frequency loss weights; HEAD_FOCAL_GAMMA
 * additionally enables focal-loss-lite. The pure trainer stays flag-agnostic; the
 * flag is read HERE (the orchestrator) and passed as trainConfig, so an explicit
 * opts.trainConfig.classBalance still wins.
 */
function classBalanceTrainConfig(): { classBalance?: "class_weight"; focalGamma?: number } {
  const on = String(process.env.HEAD_CLASS_BALANCE_ENABLED ?? "false").toLowerCase() === "true"
    || process.env.HEAD_CLASS_BALANCE_ENABLED === "1";
  if (!on) return {};
  const g = Number(process.env.HEAD_FOCAL_GAMMA);
  return { classBalance: "class_weight", ...(Number.isFinite(g) && g > 0 ? { focalGamma: g } : {}) };
}

/** A model is an embedding-head model when format=CUSTOM + metadata.headKind matches. */
export function isEmbeddingHeadModel(model: Pick<AiModel, "format" | "metadata"> | null | undefined): boolean {
  if (!model) return false;
  if (model.format !== HEAD_MODEL_FORMAT) return false;
  const meta = (model.metadata as Record<string, unknown> | null) ?? null;
  return meta?.headKind === HEAD_KIND;
}

// ─── Artifact storage (fs) ──────────────────────────────────────────────────────

function headsDir(): string {
  return path.join(process.cwd(), "uploads", "models", "heads");
}

function resolveArtifactPath(filePath: string): string {
  if (filePath.startsWith("/uploads/")) return path.join(process.cwd(), filePath);
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(process.cwd(), filePath);
}

/** Persist a head artifact JSON. Returns {absPath, storagePath} (storagePath is /uploads-relative). */
export function writeHeadArtifact(code: string, version: string, artifact: HeadArtifact): { absPath: string; storagePath: string } {
  const dir = path.join(headsDir(), code, `v${version}`);
  fs.mkdirSync(dir, { recursive: true });
  const absPath = path.join(dir, "head.json");
  fs.writeFileSync(absPath, serializeHeadArtifact(artifact), "utf-8");
  const storagePath = "/uploads/" + path.relative(path.join(process.cwd(), "uploads"), absPath).split(path.sep).join("/");
  return { absPath, storagePath };
}

/** Load + validate a head artifact from a stored filePath. Returns null when absent/invalid. */
export function loadHeadArtifact(filePath: string | null | undefined): HeadArtifact | null {
  if (!filePath) return null;
  const abs = resolveArtifactPath(filePath);
  if (!fs.existsSync(abs)) return null;
  try {
    return parseHeadArtifact(fs.readFileSync(abs, "utf-8"));
  } catch {
    return null;
  }
}

// ─── 1) Dataset versioning ──────────────────────────────────────────────────────

export interface CollectPairsOptions {
  productModelId?: number;
  machineId?: number;
  /** Restrict to one embedding space (modelCode) so vectors are comparable. */
  modelCode?: string;
  limit?: number;
}

/**
 * Collect (embedding, label) pairs from the STORED embeddings + active-learning
 * human labels. Human labels (ai_label_queue.humanLabel, status LABELED) win over
 * the embedding row's own label. Returns the raw pairs (no dedupe/validation — the
 * pure assembler does that) + the dominant embedding modelCode/dim for provenance.
 */
export async function collectHeadTrainingPairs(
  opts: CollectPairsOptions = {},
): Promise<{ pairs: LabeledEmbedding[]; modelCode: string | null }> {
  const db = await getDb();
  if (!db) return { pairs: [], modelCode: null };

  const conds = [isNotNull(aiImageEmbeddings.embedding)];
  if (opts.productModelId != null) conds.push(eq(aiImageEmbeddings.productModelId, opts.productModelId));
  if (opts.machineId != null) conds.push(eq(aiImageEmbeddings.machineId, opts.machineId));
  if (opts.modelCode) conds.push(eq(aiImageEmbeddings.modelCode, opts.modelCode));

  const rows = await db
    .select({
      id: aiImageEmbeddings.id,
      imageUrl: aiImageEmbeddings.imageUrl,
      embedding: aiImageEmbeddings.embedding,
      embeddingDim: aiImageEmbeddings.embeddingDim,
      label: aiImageEmbeddings.label,
      modelCode: aiImageEmbeddings.modelCode,
    })
    .from(aiImageEmbeddings)
    .where(and(...conds))
    .orderBy(desc(aiImageEmbeddings.createdAt))
    .limit(opts.limit ?? 20000);

  // Human labels by imageUrl (LABELED reviews) — the ground-truth source.
  const urls = Array.from(new Set(rows.map((r) => r.imageUrl).filter(Boolean))) as string[];
  const humanByUrl = new Map<string, string>();
  if (urls.length > 0) {
    const labelRows = await db
      .select({ imageUrl: aiLabelQueue.imageUrl, humanLabel: aiLabelQueue.humanLabel })
      .from(aiLabelQueue)
      .where(and(inArray(aiLabelQueue.imageUrl, urls), isNotNull(aiLabelQueue.humanLabel), eq(aiLabelQueue.status, "LABELED")));
    for (const lr of labelRows) {
      if (lr.imageUrl && lr.humanLabel && !humanByUrl.has(lr.imageUrl)) humanByUrl.set(lr.imageUrl, lr.humanLabel);
    }
  }

  // Dominant modelCode (largest group) for provenance when not filtered.
  const codeCounts = new Map<string, number>();
  for (const r of rows) codeCounts.set(r.modelCode, (codeCounts.get(r.modelCode) ?? 0) + 1);
  let modelCode: string | null = opts.modelCode ?? null;
  if (!modelCode) {
    let best = -1;
    for (const [code, n] of codeCounts) if (n > best) { best = n; modelCode = code; }
  }

  // G4.23: when the feature store is ON, resolve each vector through its group-(a)
  // definition — the SAME contract the serve path uses (anti train/serve skew) —
  // seeded with the already-loaded row so there is no re-query. OFF ⇒ the exact
  // original inline parse (byte-compatible dataset).
  const useStore = isFeatureStoreEnabled();
  const pairs: LabeledEmbedding[] = [];
  for (const r of rows) {
    const label = (r.imageUrl ? humanByUrl.get(r.imageUrl) : undefined) ?? r.label ?? "";
    if (!label) continue;
    let vector: number[];
    if (useStore) {
      const feats = await getFeatures(IMAGE_EMBEDDING_ENTITY, String(r.id), [IMAGE_EMBEDDING_FEATURE], {
        seed: { embedding: r.embedding, embeddingDim: r.embeddingDim, modelCode: r.modelCode, label: r.label },
      });
      const f = feats[IMAGE_EMBEDDING_FEATURE] as { embedding?: number[] } | undefined;
      vector = Array.isArray(f?.embedding) ? (f!.embedding as number[]) : parseVectorLiteral(r.embedding);
    } else {
      vector = parseVectorLiteral(r.embedding);
    }
    if (vector.length === 0) continue;
    pairs.push({ id: r.id, label, embedding: vector });
  }

  return { pairs, modelCode };
}

export interface SnapshotDatasetOptions extends CollectPairsOptions {
  name?: string;
  description?: string;
  modelId?: number;
  splitSeed?: number;
  splitConfig?: { train: number; validation: number; test: number };
  createdBy?: number;
}

export interface DatasetVersion {
  id: number | null;
  snapshot: EmbeddingDatasetSnapshot;
  splitSeed: number;
  splitConfig: { train: number; validation: number; test: number };
  modelCode: string | null;
}

/**
 * Snapshot the CURRENT labels into an IMMUTABLE dataset version row. Reproducible:
 * the same labels+vectors always yield the same `checksum`; the split is deterministic
 * from `splitSeed`. Returns the persisted row id (null when no DB).
 */
export async function snapshotEmbeddingDataset(opts: SnapshotDatasetOptions = {}): Promise<DatasetVersion> {
  const splitSeed = opts.splitSeed ?? 1337;
  const splitConfig = opts.splitConfig ?? { train: 0.7, validation: 0.15, test: 0.15 };

  const { pairs, modelCode } = await collectHeadTrainingPairs(opts);
  const snapshot = assembleEmbeddingDataset(pairs);

  const db = await getDb();
  if (!db) return { id: null, snapshot, splitSeed, splitConfig, modelCode };

  const row: InsertAiEmbeddingDataset = {
    name: opts.name ?? `head-dataset-${modelCode ?? "mixed"}-${Date.now()}`,
    description: opts.description,
    modelId: opts.modelId ?? null,
    productModelId: opts.productModelId ?? null,
    machineId: opts.machineId ?? null,
    classLabels: snapshot.classLabels,
    labelDistribution: snapshot.labelDistribution,
    sampleCount: snapshot.sampleCount,
    inputDim: snapshot.inputDim,
    splitSeed,
    splitConfig,
    checksum: snapshot.checksum,
    samples: snapshot.samples,
    dropped: snapshot.dropped,
    source: "ai_image_embeddings+label_queue",
    createdBy: opts.createdBy,
  };
  const [inserted] = await db.insert(aiEmbeddingDatasets).values(row).returning({ id: aiEmbeddingDatasets.id });
  return { id: inserted?.id ?? null, snapshot, splitSeed, splitConfig, modelCode };
}

/** Load a persisted dataset version back into a snapshot + split config. */
export async function loadEmbeddingDataset(datasetId: number): Promise<DatasetVersion | null> {
  const db = await getDb();
  if (!db) return null;
  const [ds] = await db.select().from(aiEmbeddingDatasets).where(eq(aiEmbeddingDatasets.id, datasetId)).limit(1);
  if (!ds) return null;
  const snapshot: EmbeddingDatasetSnapshot = {
    samples: ds.samples,
    classLabels: ds.classLabels,
    labelDistribution: ds.labelDistribution,
    inputDim: ds.inputDim,
    sampleCount: ds.sampleCount,
    checksum: ds.checksum,
    dropped: ds.dropped ?? { badVector: 0, dimMismatch: 0, noLabel: 0, duplicate: 0 },
  };
  return {
    id: ds.id,
    snapshot,
    splitSeed: ds.splitSeed,
    splitConfig: ds.splitConfig ?? { train: 0.7, validation: 0.15, test: 0.15 },
    modelCode: null,
  };
}

// ─── 2) Train + register (round-trip through the registry) ──────────────────────

export interface TrainRegisterOptions {
  /** Existing head model code to add a version to (created if absent). */
  code: string;
  name?: string;
  productModelId?: number;
  version: string;
  trainConfig?: TrainHeadConfig;
  /** No-regression tolerance vs the current ACTIVE version (default 0). */
  gateEpsilon?: number;
  /** Automated retrain context (promotion additionally gated by AI_AUTO_PROMOTE_ENABLED). */
  autoContext?: boolean;
  createdBy?: number;
}

export interface TrainRegisterResult {
  modelId: number | null;
  versionId: number | null;
  version: string;
  artifactPath: string;
  valMetrics: ReturnType<typeof computeMetrics>;
  testMetrics: ReturnType<typeof computeMetrics>;
  gate: QualityGateResult;
  activated: boolean;
  trainCount: number;
  valCount: number;
  testCount: number;
}

/**
 * Full label→train→deploy round-trip for a dataset version:
 *   split → train head → eval on locked TEST split → quality gate vs ACTIVE →
 *   serialize artifact → register model_version (REAL metrics) → activate iff the
 *   gate passes (and, for automated retrains, AI_AUTO_PROMOTE_ENABLED).
 */
export async function trainAndRegisterHead(
  dataset: DatasetVersion,
  opts: TrainRegisterOptions,
): Promise<TrainRegisterResult> {
  const { snapshot, splitSeed, splitConfig } = dataset;
  const split = splitEmbeddingDataset(snapshot.samples, splitConfig, splitSeed);
  if (split.train.length < snapshot.classLabels.length) {
    throw new Error(`Insufficient training data after split: ${split.train.length} for ${snapshot.classLabels.length} classes`);
  }

  const trained = trainEmbeddingHead(split.train, split.val, snapshot.classLabels, {
    seed: splitSeed,
    // G4.14 — flag-gated class-imbalance handling (OFF ⇒ absent ⇒ unchanged math).
    ...classBalanceTrainConfig(),
    ...opts.trainConfig,
  });

  // Locked TEST-split eval (fair gate) with the SAME shared metrics helpers.
  const testMetrics = evaluateOnSplit(trained.artifact, split.test.length > 0 ? split.test : split.val);

  // Baseline = current ACTIVE version of this head model (if any).
  const existing = await getAiModelByCode(opts.code);
  let baselineTestAccuracy: number | null = null;
  let baselineVersionId: number | null = null;
  if (existing) {
    const versions = await getModelVersions(existing.id);
    const active = versions.find((v) => v.status === "ACTIVE");
    if (active) {
      baselineVersionId = active.id;
      const baseArtifact = loadHeadArtifact(active.filePath);
      if (baseArtifact && baseArtifact.inputDim === snapshot.inputDim) {
        baselineTestAccuracy = evaluateOnSplit(baseArtifact, split.test.length > 0 ? split.test : split.val).accuracy;
      } else {
        // Fall back to the recorded baseline accuracy (honest, from the registry).
        const m = active.metrics as Record<string, unknown> | null;
        if (m && typeof m.accuracy === "number") baselineTestAccuracy = m.accuracy;
      }
    }
  }

  const gate = evaluateQualityGate(testMetrics.accuracy, baselineTestAccuracy, opts.gateEpsilon ?? 0);

  // Register the head model row (reuse the registry) if needed.
  const modelId = await ensureHeadModelRow({
    code: opts.code,
    name: opts.name ?? opts.code,
    classLabels: snapshot.classLabels,
    inputDim: snapshot.inputDim,
    productModelId: opts.productModelId,
    createdBy: opts.createdBy,
  });

  const { absPath, storagePath } = writeHeadArtifact(opts.code, opts.version, trained.artifact);

  const promotionAllowed = gate.pass && (!opts.autoContext || autoPromoteEnabled());
  const versionStatus: "ACTIVE" | "READY" = promotionAllowed ? "ACTIVE" : "READY";

  let versionId: number | null = null;
  let activated = false;
  if (modelId != null) {
    const payload = buildHeadModelVersionPayload({
      modelId,
      version: opts.version,
      filePath: storagePath,
      metrics: testMetrics,
      datasetId: dataset.id,
      baselineVersionId,
      evalReport: {
        baseline: baselineTestAccuracy == null ? null : { accuracy: baselineTestAccuracy },
        candidate: testMetrics,
        val: trained.metrics,
        gate,
        split: "test",
        datasetChecksum: snapshot.checksum,
        generatedAt: new Date().toISOString(),
      },
      status: "READY", // create as READY; activate below via the shared path
      createdBy: opts.createdBy,
    });
    const created = await createModelVersion(payload as unknown as InsertModelVersion);
    versionId = created?.id ?? null;

    if (promotionAllowed && versionId != null) {
      // Flip via the SAME manual/auto-rollback path (no fork) + evict caches.
      await activateModelVersion(modelId, versionId);
      const { evictSessionCache } = await import("../aiInferenceEngine");
      evictSessionCache(modelId);
      activated = true;
    }
  }

  return {
    modelId,
    versionId,
    version: opts.version,
    artifactPath: absPath,
    valMetrics: trained.metrics,
    testMetrics,
    gate,
    activated,
    trainCount: split.train.length,
    valCount: split.val.length,
    testCount: split.test.length,
  };
}

/** Evaluate a head artifact over a set of frozen samples (pure — reuses aiMetrics). */
export function evaluateOnSplit(artifact: HeadArtifact, samples: EmbeddingDatasetSample[]): ReturnType<typeof computeMetrics> {
  const idx = new Map<string, number>();
  artifact.classLabels.forEach((l, i) => idx.set(normalizeLabel(l), i));
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const s of samples) {
    const a = idx.get(normalizeLabel(s.label));
    if (a == null) continue; // label outside the head's class space → skip (honest)
    let pred: number;
    try {
      const p = predictWithHead(artifact, s.vector);
      pred = idx.get(normalizeLabel(p.label)) ?? -1;
    } catch {
      continue;
    }
    predicted.push(pred);
    actual.push(a);
  }
  return computeMetrics(buildConfusionMatrix(predicted, actual, artifact.classLabels.length));
}

/** Create (or fetch) the ai_models registry row for a head model. */
async function ensureHeadModelRow(input: {
  code: string;
  name: string;
  classLabels: string[];
  inputDim: number;
  productModelId?: number;
  createdBy?: number;
}): Promise<number | null> {
  const existing = await getAiModelByCode(input.code);
  if (existing) return existing.id;
  const created = await createAiModel({
    code: input.code,
    name: input.name,
    modelType: "classification",
    format: HEAD_MODEL_FORMAT,
    labels: input.classLabels,
    productModelId: input.productModelId,
    status: "READY",
    postprocessConfig: { type: "classification" },
    metadata: { headKind: HEAD_KIND, inputDim: input.inputDim },
  });
  return created?.id ?? null;
}

// ─── 3) Serving (dispatched from aiInferenceEngine.runInference) ────────────────

export interface HeadInferenceResult {
  modelCode: string;
  modelVersion: string | null;
  predictions: Array<{ label: string; confidence: number }>;
  topLabel: string | null;
  confidence: number;
  processingTimeMs: number;
  status: "COMPLETED";
  /** True when features were degraded (wrong embedding space or degraded source). */
  degraded: boolean;
  embeddingSource: EmbeddingSource | "none";
  route: "auto" | "review";
}

/**
 * Embed an image for head serving. Prefers a real ONNX embedding model (DINOv2 at
 * AI_DINOV2_MODEL_PATH via the registry) so the vector matches the head's training
 * space; falls back to text-of-image (1024-d). Honest source tag on the result.
 */
async function embedImageForHead(
  imageBuffer: Buffer,
  productModelId?: number,
): Promise<{ embedding: number[]; source: EmbeddingSource }> {
  // Try an ACTIVE ONNX embedding model (product-scoped first, then any).
  let onnx: AiModel | null = null;
  if (productModelId != null) {
    const m = await getActiveModelForProduct(productModelId, "embedding");
    if (m && m.status === "ACTIVE" && m.format === "ONNX") onnx = m;
  }
  if (!onnx) {
    const candidates = await getAiModels({ modelType: "embedding", format: "ONNX", status: "ACTIVE", limit: 1 });
    onnx = candidates[0] ?? null;
  }
  if (onnx) {
    const r = await extractEmbedding(onnx.id, imageBuffer);
    return { embedding: r.embedding, source: "onnx" };
  }
  const r = await embedImageAsText(imageBuffer);
  return { embedding: r.embedding, source: "text-of-image" };
}

/**
 * Serve a head model for one image — returns runInference()'s shape. Dispatched to
 * from aiInferenceEngine.runInference when isEmbeddingHeadModel(model) && flag on.
 *
 * Honest degrade: no artifact, or a runtime embedding whose dim ≠ head.inputDim →
 * empty predictions + confidence 0 + degraded:true (→ quality gate NEEDS_REVIEW). It
 * NEVER guesses a class from a mismatched vector.
 */
export async function runEmbeddingHeadInference(
  model: AiModel,
  imageBuffer: Buffer,
  options?: { inspectionId?: number; measurementResultId?: number; inputReference?: string },
): Promise<HeadInferenceResult> {
  const startTime = Date.now();
  const artifact = loadHeadArtifact(model.filePath);

  const degradedResult = (reason: string, source: EmbeddingSource | "none"): HeadInferenceResult => {
    createInferenceResult({
      modelId: model.id,
      modelVersion: model.currentVersion,
      inspectionId: options?.inspectionId,
      measurementResultId: options?.measurementResultId,
      inputType: "image",
      inputReference: options?.inputReference,
      predictions: [],
      status: "COMPLETED",
      processingTimeMs: Date.now() - startTime,
      metadata: { head: { degraded: true, reason, embeddingSource: source } },
    }).catch(() => {});
    return {
      modelCode: model.code,
      modelVersion: model.currentVersion,
      predictions: [],
      topLabel: null,
      confidence: 0,
      processingTimeMs: Date.now() - startTime,
      status: "COMPLETED",
      degraded: true,
      embeddingSource: source,
      route: "review",
    };
  };

  if (!artifact) return degradedResult("no trained head artifact", "none");

  let embedding: number[];
  let source: EmbeddingSource;
  try {
    const emb = await embedImageForHead(imageBuffer, model.productModelId ?? undefined);
    // G4.23: funnel the serving vector through the SAME group-(a) contract the train
    // path uses (identity on already-normalized vectors — anti train/serve skew).
    embedding = isFeatureStoreEnabled() ? prepareImageEmbeddingVector(emb.embedding) : emb.embedding;
    source = emb.source;
  } catch (err) {
    return degradedResult(`embedding extraction failed: ${(err as Error)?.message}`, "none");
  }

  let prediction;
  try {
    prediction = predictWithHead(artifact, embedding);
  } catch (err) {
    if (err instanceof HeadInputDimError) {
      // Wrong embedding space (e.g. text-of-image 1024-d vs a 384-d DINOv2 head).
      return degradedResult(
        `embedding dim ${err.got} ≠ head inputDim ${err.expected} (need a real DINOv2 ONNX at AI_DINOV2_MODEL_PATH)`,
        source,
      );
    }
    return degradedResult(`head predict failed: ${(err as Error)?.message}`, source);
  }

  const processingTimeMs = Date.now() - startTime;
  const predictions = prediction.probabilities.map((p) => ({ label: p.label, confidence: p.confidence }));

  createInferenceResult({
    modelId: model.id,
    modelVersion: model.currentVersion,
    inspectionId: options?.inspectionId,
    measurementResultId: options?.measurementResultId,
    inputType: "image",
    inputReference: options?.inputReference,
    predictions,
    confidence: prediction.confidence.toString(),
    topLabel: prediction.label,
    processingTimeMs,
    status: "COMPLETED",
    metadata: {
      head: {
        degraded: false,
        embeddingSource: source,
        rawConfidence: prediction.rawConfidence,
        entropy: prediction.entropy,
        route: prediction.route,
        temperature: artifact.temperature,
      },
    },
  }).catch(() => {});

  // G4.23: bounded, sampled inference-audit row (active-learning + shadow-gate signal).
  if (isFeatureStoreEnabled()) {
    recordInference({
      modelName: model.code,
      modelVersion: model.currentVersion,
      entityType: options?.inspectionId != null ? "inspection" : "image",
      entityId:
        options?.inspectionId != null ? String(options.inspectionId) : options?.inputReference ?? null,
      input: { embeddingSource: source, embeddingDim: embedding.length },
      output: { topLabel: prediction.label, predictions },
      confidence: prediction.confidence,
      latencyMs: processingTimeMs,
      flaggedForReview: prediction.route === "review",
    }).catch(() => {});
  }

  // Route low-confidence predictions to human review, re-using active learning.
  if (prediction.route === "review") {
    enqueueHeadReview(model, prediction, predictions, options).catch(() => {});
  }

  return {
    modelCode: model.code,
    modelVersion: model.currentVersion,
    predictions,
    topLabel: prediction.label,
    confidence: prediction.confidence,
    processingTimeMs,
    status: "COMPLETED",
    degraded: false,
    embeddingSource: source,
    route: prediction.route,
  };
}

/** Best-effort enqueue of a grey-zone head prediction into the active-learning queue. */
async function enqueueHeadReview(
  model: AiModel,
  prediction: { label: string; confidence: number; entropy: number },
  predictions: Array<{ label: string; confidence: number }>,
  options?: { inspectionId?: number; measurementResultId?: number; inputReference?: string },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const imageUrl = options?.inputReference ?? `inspection:${options?.inspectionId ?? "?"}`;
  const entry: InsertAiLabelQueue = {
    imageUrl,
    modelId: model.id,
    predictedLabel: prediction.label,
    confidence: prediction.confidence.toFixed(4),
    predictions,
    uncertainty: prediction.entropy.toFixed(4),
    samplingStrategy: "UNCERTAINTY",
    priority: Math.round((1 - prediction.confidence) * 100),
    status: "IN_REVIEW",
    inspectionId: options?.inspectionId,
    measurementResultId: options?.measurementResultId,
  };
  await db.insert(aiLabelQueue).values(entry);
}

// ─── 4) A/B convenience (drift + rollback are reused unchanged) ─────────────────

/**
 * Wire a canary A/B experiment for a newly-registered head candidate vs the current
 * production model. Thin wrapper over the EXISTING aiABTesting.createExperiment — the
 * canary path (aiQualityGate.runCanaryInference), perf-snapshot drift producer, and
 * modelAutoRollback all apply unchanged because both sides serve through runInference.
 */
export async function createHeadCanaryExperiment(input: {
  name: string;
  productionModelId: number;
  productionVersion: string;
  candidateModelId: number;
  candidateVersion: string;
  trafficSplitPercent?: number;
  productModelId?: number;
  createdBy?: number;
}) {
  const { createExperiment } = await import("../aiABTesting");
  return createExperiment({
    name: input.name,
    modelAId: input.productionModelId,
    modelAVersion: input.productionVersion,
    modelBId: input.candidateModelId,
    modelBVersion: input.candidateVersion,
    trafficSplitPercent: input.trafficSplitPercent ?? 20,
    productModelId: input.productModelId,
    createdBy: input.createdBy,
  });
}
