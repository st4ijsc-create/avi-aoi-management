/**
 * AI Bootstrap-First-Classifier Workflow — doc 69 Wave 6 (F1), servability fixed
 * in the F1 review.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE CHANGED SHAPE (F1-REVIEW FIX 1)
 *
 * The original version of this workflow trained via `aiLocalTraining.
 * runFewShotLearning`, producing a `format:"CUSTOM"` artifact with NO
 * `metadata.headKind`. Verified against `aiInferenceEngine.runInference`'s
 * actual dispatch (server/services/aiInferenceEngine.ts:363-384): it ONLY
 * special-cases the DINOv2 **embedding-head** shape (`isEmbeddingHeadModel()` +
 * `AOI_DL_HEAD_ENABLED=true`) — every other ACTIVE model, including the
 * few-shot artifact this workflow used to produce, falls through to the raw
 * ONNX session path, which THROWS trying to parse a JSON file as an ONNX
 * graph. So a "successful" bootstrap registered, gate-passed, and ACTIVATED a
 * model that could never actually run a prediction — the health banner would
 * go dark while `runInference` was still broken.
 *
 * FIX: the default (and ONLY) trainer this workflow uses now is the DINOv2
 * embedding-head pipeline (`server/services/ai/embeddingHead.ts` +
 * `embeddingHeadTrainer.ts`) — the ONE classifier shape `runInference` can
 * dispatch to. `runFewShotLearning` is deliberately NOT wired in here anymore
 * (see "What was dropped" below) — a single, always-servable path is safer
 * than a two-path API where the "advanced" option quietly reproduces the exact
 * bug this fix exists to close.
 *
 * IMPORTANT — servable ≠ automatically LIVE. Two more prerequisites, both
 * pre-existing and outside this file's control, still gate whether a
 * bootstrapped classifier is actually reachable in production:
 *   - `AOI_DL_HEAD_ENABLED` must be "true" for `runInference` to dispatch the
 *     head path at all (default OFF). `aiClassifierHealth.ts` already reports
 *     `hasActiveClassifier:false` with an explicit reason when it's off, so
 *     the banner will NOT lie even after a "successful" bootstrap.
 *   - `AOI_EMBEDDING_ENABLED` must be "true" for embeddings to be captured
 *     into `ai_image_embeddings` in the first place (default OFF) — the
 *     honesty pre-check below counts REAL rows in that table, so with it off
 *     there is nothing to count and bootstrap honestly reports "insufficient
 *     labeled samples", never a fabricated model.
 *
 * WHAT WAS DROPPED — `aiLocalTraining.runFewShotLearning` remains available as
 * a standalone, lower-level API (transfer/few-shot/incremental training) for
 * advanced/manual use outside this workflow. It is NOT wired into
 * `bootstrapFirstClassifier` because `runInference` does not dispatch its
 * artifact shape today — wiring it back in (even as an opt-in) would let an
 * admin re-create the exact "ACTIVE but throws at inference" state this fix
 * closes. Fast-follow (out of scope here, tracked in the runbook §8): extend
 * `runInference`'s dispatch to also serve `aiLocalTraining` artifacts, at
 * which point that path can be re-offered here as a genuine alternative.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ORCHESTRATION (unchanged shape from the original F1 design — still wiring
 * EXISTING services, not reimplementing training/eval/gate):
 *
 *   countLabeledSamples (honesty check — REAL labeled embedding pairs, the
 *     SAME pool `ai_image_embeddings` ⋈ `ai_label_queue` the trainer draws from)
 *     → buildEmbeddingDataset (embeddingHead.snapshotEmbeddingDataset — collect
 *       + assemble + persist an IMMUTABLE dataset snapshot, or load a supplied one)
 *     → ensureClassifierModel (registry identity — a NEW `ai_models` row SHAPED
 *       so `isEmbeddingHeadModel()` recognizes it, separate from the base
 *       DINOv2 feature-extractor so activation never clobbers its filePath)
 *     → split (embeddingHeadTrainer.splitEmbeddingDataset — locked train/val/test)
 *     → trainHead (embeddingHeadTrainer.trainEmbeddingHead — pure multinomial
 *       logreg head over the frozen embeddings)
 *     → evaluateHead + evaluateQualityGate (embeddingHead.evaluateOnSplit on the
 *       locked TEST split, vs the classifier's current ACTIVE version if any)
 *     → writeArtifact (embeddingHead.writeHeadArtifact — persist the JSON)
 *     → registerVersion (ALWAYS, even on a gate FAIL, for audit history)
 *     → activateModelVersionManual (aiModelService — the W0-2 GATED path; only
 *       called when the gate passed, and it independently re-checks
 *       evalReport.gate.pass before flipping the model ACTIVE — defense in depth)
 *
 * HONEST by construction (unchanged guarantees):
 *   - Insufficient REAL labeled samples (< minSamplesPerClass for any requested
 *     class) throws `InsufficientLabeledSamplesError` BEFORE touching the
 *     dataset snapshot, the trainer, or the registry — no model is ever fabricated.
 *   - A trainer failure (e.g. too few rows survive the split) aborts before any
 *     model_versions row is created.
 *   - A quality-gate FAIL still registers the version (status READY, evalReport
 *     attached) for visibility/audit, but never activates it.
 *
 * Every DB/trainer/eval touchpoint is injectable via `deps` (defaults to the
 * real services) so the orchestration is unit-testable without a GPU, ONNX
 * session, or live DB. See aiBootstrapClassifier.test.ts — it lets the REAL
 * pure trainer/eval math run against small synthetic embeddings (same approach
 * as embeddingHead.test.ts) while mocking only the DB/fs boundaries.
 */
import {
  getAiModelById,
  getAiModelByCode,
  createAiModel,
  createModelVersion,
  getModelVersions,
} from "../db/ai";
import {
  HEAD_KIND,
  HEAD_MODEL_FORMAT,
  isEmbeddingHeadModel,
  collectHeadTrainingPairs,
  snapshotEmbeddingDataset,
  loadEmbeddingDataset,
  writeHeadArtifact,
  loadHeadArtifact,
  evaluateOnSplit,
  type DatasetVersion,
} from "./ai/embeddingHead";
import {
  trainEmbeddingHead,
  splitEmbeddingDataset,
  type EmbeddingDatasetSample,
  type EmbeddingDatasetSnapshot,
  type HeadArtifact,
  type TrainHeadConfig,
  type TrainHeadResult,
} from "./ai/embeddingHeadTrainer";
import { evaluateQualityGate, type QualityGateResult } from "./aiEvalHarness";
import { activateModelVersionManual, type ManualActivateOptions } from "./aiModelService";
import { normalizeLabel, type ClassificationMetrics } from "./aiMetrics";
import type { InsertModelVersion, ModelVersion } from "../../drizzle/schema";

/** Marker written to the new classifier's ai_models.metadata for provenance/audit. */
export const BOOTSTRAP_CLASSIFIER_KIND = "bootstrap_embedding_head" as const;

/** Few-shot-era floor, kept as the default — a tiny logreg head needs a similar minimum. */
const DEFAULT_MIN_SAMPLES_PER_CLASS = 5;

export class InsufficientLabeledSamplesError extends Error {
  public readonly shortfalls: Array<{ label: string; have: number; need: number }>;

  constructor(shortfalls: Array<{ label: string; have: number; need: number }>, minSamplesPerClass: number) {
    const detail = shortfalls.map((s) => `"${s.label}" ${s.have}/${s.need}`).join(", ");
    super(
      `Cannot bootstrap classifier: insufficient labeled samples (need >= ${minSamplesPerClass}/class). ` +
      `Short: ${detail}. Label more images via the active-learning queue (ai_label_queue) — and make sure ` +
      `AOI_EMBEDDING_ENABLED is on so they get an embedding row in ai_image_embeddings — before bootstrapping. ` +
      `No model was created.`,
    );
    this.name = "InsufficientLabeledSamplesError";
    this.shortfalls = shortfalls;
  }
}

export interface BootstrapFirstClassifierOptions {
  /** Base DINOv2/embedding feature-extractor model whose stored embeddings the head trains on. */
  baseModelId: number;
  /** Registry code for the classifier's OWN ai_models row (created if it doesn't exist yet). */
  classifierCode: string;
  classifierName?: string;
  /** Defect classes to bootstrap the classifier for (>= 2 required). */
  classLabels: string[];
  productModelId?: number;
  /** Defaults to a timestamp-derived "bootstrap-YYYYMMDD-HHmm" string. */
  targetVersion?: string;
  /** Minimum REAL labeled samples required per class before training (default 5). */
  minSamplesPerClass?: number;
  /** Pre-built locked embedding-dataset snapshot id (ai_embedding_datasets); if omitted, one is snapshotted fresh. */
  datasetId?: number;
  /** Quality-gate no-regression tolerance (default 0 — no regression tolerated). */
  gateEpsilon?: number;
  /** Optional trainer overrides (epochs/lr/etc.) — defaults match embeddingHeadTrainer's own. */
  trainConfig?: TrainHeadConfig;
  /** Acting admin — recorded on the audit trail of a forced/overridden activation, if any. */
  actorUserId?: number | null;
  createdBy?: number;
}

export interface BootstrapFirstClassifierResult {
  ok: true;
  classifierModelId: number;
  versionId: number;
  version: string;
  /** True only when the quality gate PASSED and activateModelVersionManual succeeded. */
  activated: boolean;
  gate: QualityGateResult;
  metrics: { accuracy: number; precision: number; recall: number; f1Score: number };
  trainingSamples: number;
  validationSamples: number;
  datasetId: number | null;
  reason: string;
}

// ─── Injectable seams (default to the real services; tests override) ───────────

export interface BootstrapDeps {
  countLabeledSamples?: (baseModelId: number, classLabels: string[], productModelId?: number) => Promise<Record<string, number>>;
  buildEmbeddingDataset?: (baseModelId: number, opts: { productModelId?: number; createdBy?: number }) => Promise<DatasetVersion>;
  loadEmbeddingDatasetById?: (datasetId: number) => Promise<DatasetVersion | null>;
  ensureClassifierModel?: (input: {
    code: string;
    name: string;
    classLabels: string[];
    baseModelId: number;
    inputDim: number;
    productModelId?: number;
    createdBy?: number;
  }) => Promise<number>;
  getActiveBaseline?: (classifierModelId: number) => Promise<{ id: number; filePath: string | null; accuracy: number | null } | null>;
  loadBaselineArtifact?: (filePath: string | null) => HeadArtifact | null;
  splitDataset?: (
    samples: EmbeddingDatasetSample[],
    splitConfig: { train: number; validation: number; test: number },
    seed: number,
  ) => { train: EmbeddingDatasetSample[]; val: EmbeddingDatasetSample[]; test: EmbeddingDatasetSample[] };
  trainHead?: (
    train: EmbeddingDatasetSample[],
    val: EmbeddingDatasetSample[],
    classLabels: string[],
    config?: TrainHeadConfig,
  ) => Promise<TrainHeadResult>;
  evaluateHead?: (artifact: HeadArtifact, samples: EmbeddingDatasetSample[]) => ClassificationMetrics;
  writeArtifact?: (code: string, version: string, artifact: HeadArtifact) => { absPath: string; storagePath: string };
  registerVersion?: (data: InsertModelVersion) => Promise<ModelVersion | undefined>;
  activate?: (modelId: number, versionId: number, opts?: ManualActivateOptions) => Promise<ModelVersion>;
}

async function resolveEmbeddingModelCode(baseModelId: number): Promise<string | undefined> {
  const model = await getAiModelById(baseModelId);
  return model?.code;
}

async function defaultCountLabeledSamples(
  baseModelId: number,
  classLabels: string[],
  productModelId?: number,
): Promise<Record<string, number>> {
  const modelCode = await resolveEmbeddingModelCode(baseModelId);
  const { pairs } = await collectHeadTrainingPairs({ modelCode, productModelId });
  const byNorm = new Map(classLabels.map((l) => [normalizeLabel(l), l]));
  const counts: Record<string, number> = {};
  for (const l of classLabels) counts[l] = 0;
  for (const p of pairs) {
    const canonical = byNorm.get(normalizeLabel(p.label));
    if (canonical) counts[canonical] = (counts[canonical] ?? 0) + 1;
  }
  return counts;
}

async function defaultBuildEmbeddingDataset(
  baseModelId: number,
  opts: { productModelId?: number; createdBy?: number },
): Promise<DatasetVersion> {
  const modelCode = await resolveEmbeddingModelCode(baseModelId);
  return snapshotEmbeddingDataset({
    modelCode,
    productModelId: opts.productModelId,
    name: `bootstrap-head-${baseModelId}-${Date.now()}`,
    createdBy: opts.createdBy,
  });
}

/**
 * Restrict an (unfiltered) embedding dataset snapshot down to EXACTLY the
 * requested classLabels (canonicalized casing) — `snapshotEmbeddingDataset`
 * collects every labeled embedding for the base model, which may include
 * defect classes the caller did NOT ask to bootstrap. Training on the wider
 * set would silently change what the classifier predicts vs. what the admin
 * requested. Pure — no I/O, not injected.
 */
function restrictSnapshotToClasses(
  snapshot: EmbeddingDatasetSnapshot,
  classLabels: string[],
): EmbeddingDatasetSnapshot {
  const byNorm = new Map(classLabels.map((l) => [normalizeLabel(l), l]));
  const samples: EmbeddingDatasetSample[] = [];
  const labelDistribution: Record<string, number> = {};
  for (const s of snapshot.samples) {
    const canonical = byNorm.get(normalizeLabel(s.label));
    if (!canonical) continue;
    samples.push({ ...s, label: canonical });
    labelDistribution[canonical] = (labelDistribution[canonical] ?? 0) + 1;
  }
  return {
    ...snapshot,
    samples,
    classLabels: classLabels.slice().sort(),
    labelDistribution,
    sampleCount: samples.length,
  };
}

/**
 * Pure — the EXACT `ai_models` insert fields a fresh bootstrap creates. Exported
 * (and used by `defaultEnsureClassifierModel` below) so tests can assert the
 * servable-shape claim — `isEmbeddingHeadModel(buildBootstrapClassifierModelFields(...))
 * === true` — directly, without a live DB round-trip through `createAiModel`.
 */
export function buildBootstrapClassifierModelFields(input: {
  code: string;
  name: string;
  classLabels: string[];
  baseModelId: number;
  inputDim: number;
  productModelId?: number;
  createdBy?: number;
}): {
  code: string;
  name: string;
  modelType: "classification";
  format: typeof HEAD_MODEL_FORMAT;
  labels: string[];
  productModelId: number | undefined;
  status: "READY";
  postprocessConfig: { type: "classification" };
  metadata: { headKind: typeof HEAD_KIND; inputDim: number; bootstrapKind: typeof BOOTSTRAP_CLASSIFIER_KIND; baseModelId: number; bootstrappedAt: string };
  createdBy: number | undefined;
} {
  return {
    code: input.code,
    name: input.name,
    modelType: "classification",
    format: HEAD_MODEL_FORMAT,
    labels: input.classLabels,
    productModelId: input.productModelId,
    status: "READY",
    postprocessConfig: { type: "classification" },
    metadata: {
      headKind: HEAD_KIND,
      inputDim: input.inputDim,
      bootstrapKind: BOOTSTRAP_CLASSIFIER_KIND,
      baseModelId: input.baseModelId,
      bootstrappedAt: new Date().toISOString(),
    },
    createdBy: input.createdBy,
  };
}

async function defaultEnsureClassifierModel(input: {
  code: string;
  name: string;
  classLabels: string[];
  baseModelId: number;
  inputDim: number;
  productModelId?: number;
  createdBy?: number;
}): Promise<number> {
  const existing = await getAiModelByCode(input.code);
  if (existing) {
    if (!isEmbeddingHeadModel(existing)) {
      throw new Error(
        `bootstrapFirstClassifier: classifier code "${input.code}" already exists as a ` +
        `format=${existing.format} model that is NOT a DINOv2 embedding-head — this workflow only ` +
        `produces embedding-head classifiers (isEmbeddingHeadModel), and reusing that row would register a ` +
        `head artifact under a model shape aiInferenceEngine.runInference still can't dispatch. Pick a ` +
        `different classifierCode, or retire/migrate the existing "${input.code}" model first.`,
      );
    }
    return existing.id;
  }
  const created = await createAiModel(buildBootstrapClassifierModelFields(input));
  if (!created) throw new Error(`bootstrapFirstClassifier: failed to create registry row for code "${input.code}".`);
  return created.id;
}

async function defaultGetActiveBaseline(
  classifierModelId: number,
): Promise<{ id: number; filePath: string | null; accuracy: number | null } | null> {
  const versions = await getModelVersions(classifierModelId);
  const active = versions.find((v) => v.status === "ACTIVE");
  if (!active) return null;
  const m = active.metrics as Record<string, unknown> | null;
  const accuracy = m && typeof m.accuracy === "number" ? (m.accuracy as number) : null;
  return { id: active.id, filePath: active.filePath, accuracy };
}

function defaultTargetVersion(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `bootstrap-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/**
 * Bootstrap the FIRST (or a fresh) defect classifier end-to-end: honesty check
 * → snapshot the locked embedding dataset → train a DINOv2 embedding-head →
 * eval on the locked TEST split → quality gate → register → activate iff the
 * gate passed. Admin-gated (callers must enforce their own authorization — see
 * aiEvalRouter.bootstrapFirstClassifier which uses adminProcedure). Never runs
 * live GPU training in tests — `deps` lets tests mock the DB/fs boundaries
 * while the pure trainer/eval math runs for real on synthetic embeddings.
 */
export async function bootstrapFirstClassifier(
  opts: BootstrapFirstClassifierOptions,
  deps: BootstrapDeps = {},
): Promise<BootstrapFirstClassifierResult> {
  const classLabels = Array.from(new Set(opts.classLabels.map((l) => l.trim()).filter(Boolean)));
  if (classLabels.length < 2) {
    throw new Error("bootstrapFirstClassifier requires at least 2 distinct classLabels.");
  }
  const minSamplesPerClass = opts.minSamplesPerClass ?? DEFAULT_MIN_SAMPLES_PER_CLASS;
  if (minSamplesPerClass < 1) {
    throw new Error("bootstrapFirstClassifier: minSamplesPerClass must be >= 1.");
  }

  const countLabeledSamples = deps.countLabeledSamples ?? defaultCountLabeledSamples;
  const buildEmbeddingDataset = deps.buildEmbeddingDataset ?? defaultBuildEmbeddingDataset;
  const loadEmbeddingDatasetById = deps.loadEmbeddingDatasetById ?? loadEmbeddingDataset;
  const ensureClassifierModel = deps.ensureClassifierModel ?? defaultEnsureClassifierModel;
  const getActiveBaseline = deps.getActiveBaseline ?? defaultGetActiveBaseline;
  const loadBaselineArtifact = deps.loadBaselineArtifact ?? loadHeadArtifact;
  const splitDataset = deps.splitDataset ?? splitEmbeddingDataset;
  const trainHead = deps.trainHead ?? (async (train, val, labels, config) => trainEmbeddingHead(train, val, labels, config));
  const evaluateHead = deps.evaluateHead ?? evaluateOnSplit;
  const writeArtifact = deps.writeArtifact ?? writeHeadArtifact;
  const registerVersion = deps.registerVersion ?? ((data: InsertModelVersion) => createModelVersion(data));
  const activate = deps.activate ?? activateModelVersionManual;

  // 1) HONESTY GATE — verify REAL labeled embedding supply BEFORE touching the
  //    dataset snapshot, the trainer, or the registry. Never fabricates a
  //    classifier from too few samples. Counts from the SAME pool
  //    (ai_image_embeddings ⋈ ai_label_queue human labels) the trainer draws
  //    from — not a differently-scoped pool that could pass honesty while the
  //    actual training set is short.
  const counts = await countLabeledSamples(opts.baseModelId, classLabels, opts.productModelId);
  const shortfalls = classLabels
    .map((label) => ({ label, have: counts[label] ?? 0, need: minSamplesPerClass }))
    .filter((c) => c.have < c.need);
  if (shortfalls.length > 0) {
    throw new InsufficientLabeledSamplesError(shortfalls, minSamplesPerClass);
  }

  // 2) Locked embedding-dataset snapshot (build fresh, unless the caller
  //    supplied an existing one) — then restrict it to EXACTLY the requested
  //    classLabels (see restrictSnapshotToClasses).
  const dataset = opts.datasetId != null
    ? await loadEmbeddingDatasetById(opts.datasetId)
    : await buildEmbeddingDataset(opts.baseModelId, { productModelId: opts.productModelId, createdBy: opts.createdBy });
  if (!dataset) {
    throw new Error(`bootstrapFirstClassifier: embedding dataset ${opts.datasetId} not found.`);
  }
  const restricted = restrictSnapshotToClasses(dataset.snapshot, classLabels);

  // 3) Classifier's OWN registry identity — a NEW ai_models row, SHAPED so
  //    isEmbeddingHeadModel() recognizes it (servable), separate from the base
  //    DINOv2 feature-extractor row so activation never overwrites its
  //    filePath/status.
  const classifierModelId = await ensureClassifierModel({
    code: opts.classifierCode,
    name: opts.classifierName ?? opts.classifierCode,
    classLabels: restricted.classLabels,
    baseModelId: opts.baseModelId,
    inputDim: restricted.inputDim,
    productModelId: opts.productModelId,
    createdBy: opts.createdBy,
  });
  const baseline = await getActiveBaseline(classifierModelId);

  // 4) Deterministic locked split (train/val/test).
  const split = splitDataset(restricted.samples, dataset.splitConfig, dataset.splitSeed);

  // 5) TRAIN — DINOv2 embedding-head (multinomial logreg over the frozen
  //    embeddings, embeddingHeadTrainer.trainEmbeddingHead). NOT reimplemented here.
  const targetVersion = opts.targetVersion ?? defaultTargetVersion();
  let trained: TrainHeadResult;
  try {
    // seed defaults to the SAME seed the split was made with (reproducible —
    // mirrors embeddingHead.trainAndRegisterHead's own seed coupling); an
    // explicit opts.trainConfig.seed still wins.
    trained = await trainHead(split.train, split.val, restricted.classLabels, {
      seed: dataset.splitSeed,
      ...opts.trainConfig,
    });
  } catch (err) {
    throw new Error(
      `Bootstrap training failed: ${err instanceof Error ? err.message : String(err)}. No model was registered.`,
    );
  }

  // 6) EVAL (locked TEST split, falling back to VAL when test is empty) +
  //    QUALITY GATE vs the classifier's current ACTIVE version, if any (a
  //    re-bootstrap). First bootstrap ⇒ no baseline ⇒ gate auto-PASSES.
  const evalSamples = split.test.length > 0 ? split.test : split.val;
  const evalSplitName: "test" | "val" = split.test.length > 0 ? "test" : "val";
  const candidateMetrics = evaluateHead(trained.artifact, evalSamples);

  let baselineAccuracy: number | null = null;
  if (baseline) {
    const baseArtifact = loadBaselineArtifact(baseline.filePath);
    baselineAccuracy = baseArtifact && baseArtifact.inputDim === restricted.inputDim
      ? evaluateHead(baseArtifact, evalSamples).accuracy
      : baseline.accuracy;
  }
  const gate = evaluateQualityGate(candidateMetrics.accuracy, baselineAccuracy, opts.gateEpsilon ?? 0);

  // 7) Persist the trained artifact JSON to disk.
  const { storagePath } = writeArtifact(opts.classifierCode, targetVersion, trained.artifact);

  // 8) REGISTER — ALWAYS recorded (status READY) with REAL metrics + the full
  //    evalReport, even on a gate FAIL, so the attempt is auditable.
  const evalReport = {
    baseline: baselineAccuracy == null ? null : { accuracy: baselineAccuracy },
    candidate: candidateMetrics,
    val: trained.metrics,
    gate,
    split: evalSplitName,
    generatedAt: new Date().toISOString(),
  };
  const created = await registerVersion({
    modelId: classifierModelId,
    version: targetVersion,
    filePath: storagePath,
    changeLog:
      `Bootstrap DINOv2 embedding-head classifier (${restricted.classLabels.length} classes, ` +
      `${split.train.length} train / ${split.val.length} val / ${evalSamples.length} ${evalSplitName} samples). ` +
      `Gate: ${gate.pass ? "PASS" : "FAIL"} — ${gate.reason}`,
    metrics: {
      accuracy: candidateMetrics.accuracy,
      precision: candidateMetrics.precision,
      recall: candidateMetrics.recall,
      f1Score: candidateMetrics.f1Score,
    },
    accuracy: String(Number((candidateMetrics.accuracy * 100).toFixed(2))),
    status: "READY",
    createdBy: opts.createdBy,
    datasetId: dataset.id,
    baselineVersionId: baseline?.id ?? null,
    evalReport: evalReport as unknown,
  } as InsertModelVersion);
  if (!created) {
    throw new Error("bootstrapFirstClassifier: failed to register the model_versions row.");
  }

  // 9) ACTIVATE — ONLY when the gate passed, via the W0-2 GATED manual path
  //    (activateModelVersionManual independently re-checks evalReport.gate.pass
  //    before flipping ai_models.status → ACTIVE — defense in depth, never a
  //    blind activation). A gate FAIL leaves the version READY, untouched.
  let activated = false;
  if (gate.pass) {
    await activate(classifierModelId, created.id, { actorUserId: opts.actorUserId ?? null });
    activated = true;
  }

  return {
    ok: true,
    classifierModelId,
    versionId: created.id,
    version: targetVersion,
    activated,
    gate,
    metrics: {
      accuracy: candidateMetrics.accuracy,
      precision: candidateMetrics.precision,
      recall: candidateMetrics.recall,
      f1Score: candidateMetrics.f1Score,
    },
    trainingSamples: split.train.length,
    validationSamples: split.val.length,
    datasetId: dataset.id,
    reason: activated
      ? `Classifier "${opts.classifierCode}" v${targetVersion} bootstrapped and ACTIVATED (quality gate PASS). ` +
        `It is a DINOv2 embedding-head model — set AOI_DL_HEAD_ENABLED=true for aiInferenceEngine.runInference ` +
        `to actually serve it (the classifier health check reports this honestly if it's still off).`
      : `Classifier "${opts.classifierCode}" v${targetVersion} registered as READY but NOT activated — ` +
        `quality gate ${gate.pass ? "PASS" : "FAIL"}: ${gate.reason}`,
  };
}
