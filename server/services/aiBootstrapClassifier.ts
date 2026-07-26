/**
 * AI Bootstrap-First-Classifier Workflow — doc 69 Wave 6 (F1)
 *
 * The ML lifecycle machinery (few-shot trainer → eval harness → quality gate →
 * registry → gated activation) already exists, piece by piece, but nothing
 * wires them into ONE admin action that takes a factory from "no classifier at
 * all" to "one ACTIVE, gate-validated classifier". This is that wiring — it does
 * NOT reimplement training, evaluation, or the gate; it only orchestrates the
 * EXISTING services:
 *
 *   countLabeledSamples (honesty check)
 *     → ensureClassifierModel (registry identity — NEW row, separate from the
 *       base ONNX/DINOv2 feature extractor so its filePath is never clobbered)
 *     → buildDatasetForModel (aiDatasetBuilder.buildDataset — locked train/val/test)
 *     → runFewShotLearning (aiLocalTraining — prototypical-network head on the
 *       base model's frozen embeddings)
 *     → evaluateModelVersion + evaluateQualityGate (aiEvalHarness.compareBeforeAfter
 *       — locked TEST split, vs the current ACTIVE version of this classifier if any)
 *     → createModelVersion (register — ALWAYS, even on a gate FAIL, for audit history)
 *     → activateModelVersionManual (aiModelService — the W0-2 GATED path; only
 *       called when the gate passed, and it independently re-checks
 *       evalReport.gate.pass before flipping the model ACTIVE — defense in depth)
 *
 * HONEST by construction:
 *   - Insufficient REAL labeled samples (< minSamplesPerClass for any requested
 *     class) throws `InsufficientLabeledSamplesError` BEFORE touching the
 *     trainer or the registry — no model is ever fabricated.
 *   - A trainer failure (e.g. aiLocalTraining's own "insufficient data" guard)
 *     aborts before any model_versions row is created.
 *   - A quality-gate FAIL still registers the version (status READY, evalReport
 *     attached) for visibility/audit, but never activates it.
 *
 * Every DB/service touchpoint is injectable via `deps` (defaults to the real
 * services) so the orchestration is unit-testable with the trainer/eval MOCKED
 * — no GPU, no ONNX session, no live DB required. See aiBootstrapClassifier.test.ts.
 */
import {
  getAiModelByCode,
  createAiModel,
  createModelVersion,
  getModelVersions,
} from "../db/ai";
import { createTrainingDataset } from "../db/aiAdvanced";
import { collectDatasetSamples, buildDataset } from "./aiDatasetBuilder";
import { normalizeLabel } from "./aiMetrics";
import { runFewShotLearning, type LocalTrainingRequest, type LocalTrainingResult } from "./aiLocalTraining";
import { compareBeforeAfter, type CompareReport, type SplitName } from "./aiEvalHarness";
import { activateModelVersionManual, type ManualActivateOptions } from "./aiModelService";
import type { InsertModelVersion, ModelVersion } from "../../drizzle/schema";

/** Marker written to the new classifier's ai_models.metadata for provenance/audit. */
export const BOOTSTRAP_CLASSIFIER_KIND = "bootstrap_fewshot_local" as const;

/** Few-shot floor — mirrors aiLocalTraining.getTrainingCapabilities' fewshot minSamples (5). */
const DEFAULT_MIN_SAMPLES_PER_CLASS = 5;

export class InsufficientLabeledSamplesError extends Error {
  public readonly shortfalls: Array<{ label: string; have: number; need: number }>;

  constructor(shortfalls: Array<{ label: string; have: number; need: number }>, minSamplesPerClass: number) {
    const detail = shortfalls.map((s) => `"${s.label}" ${s.have}/${s.need}`).join(", ");
    super(
      `Cannot bootstrap classifier: insufficient labeled samples (need >= ${minSamplesPerClass}/class). ` +
      `Short: ${detail}. Label more images via the active-learning queue (ai_label_queue) before ` +
      `bootstrapping — no model was created.`,
    );
    this.name = "InsufficientLabeledSamplesError";
    this.shortfalls = shortfalls;
  }
}

export interface BootstrapFirstClassifierOptions {
  /** Base feature-extractor model (ONNX, e.g. DINOv2) that few-shot embeddings come from. */
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
  /** Pre-built locked dataset id; if omitted, one is created + materialized fresh. */
  datasetId?: number;
  /** Quality-gate no-regression tolerance (default 0 — no regression tolerated). */
  gateEpsilon?: number;
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
  gate: CompareReport["gate"];
  metrics: { accuracy: number; precision: number; recall: number; f1Score: number };
  trainingSamples: number;
  validationSamples: number;
  datasetId: number;
  reason: string;
}

// ─── Injectable seams (default to the real services; tests override) ───────────

export interface BootstrapDeps {
  countLabeledSamples?: (modelId: number, classLabels: string[]) => Promise<Record<string, number>>;
  ensureClassifierModel?: (input: {
    code: string;
    name: string;
    classLabels: string[];
    baseModelId: number;
    productModelId?: number;
    createdBy?: number;
  }) => Promise<number>;
  getActiveBaseline?: (classifierModelId: number) => Promise<{ id: number; filePath: string | null } | null>;
  buildDatasetForModel?: (baseModelId: number, createdBy?: number) => Promise<number>;
  trainFewShot?: (request: LocalTrainingRequest) => Promise<LocalTrainingResult>;
  evalAndGate?: (input: {
    modelId: number;
    candidateClassifierPath: string;
    baselineClassifierPath: string | null;
    baselineVersionId: number | null;
    datasetId: number;
    split: SplitName;
    epsilon: number;
  }) => Promise<CompareReport>;
  registerVersion?: (data: InsertModelVersion) => Promise<ModelVersion | undefined>;
  activate?: (modelId: number, versionId: number, opts?: ManualActivateOptions) => Promise<ModelVersion>;
}

async function defaultCountLabeledSamples(modelId: number, classLabels: string[]): Promise<Record<string, number>> {
  const samples = await collectDatasetSamples(modelId);
  const byNorm = new Map(classLabels.map((l) => [normalizeLabel(l), l]));
  const counts: Record<string, number> = {};
  for (const l of classLabels) counts[l] = 0;
  for (const s of samples) {
    const canonical = byNorm.get(normalizeLabel(s.label));
    if (canonical) counts[canonical] = (counts[canonical] ?? 0) + 1;
  }
  return counts;
}

async function defaultEnsureClassifierModel(input: {
  code: string;
  name: string;
  classLabels: string[];
  baseModelId: number;
  productModelId?: number;
  createdBy?: number;
}): Promise<number> {
  const existing = await getAiModelByCode(input.code);
  if (existing) return existing.id;
  const created = await createAiModel({
    code: input.code,
    name: input.name,
    modelType: "classification",
    format: "CUSTOM",
    labels: input.classLabels,
    productModelId: input.productModelId,
    status: "READY",
    postprocessConfig: { type: "classification" },
    metadata: {
      bootstrapKind: BOOTSTRAP_CLASSIFIER_KIND,
      baseModelId: input.baseModelId,
      bootstrappedAt: new Date().toISOString(),
    },
    createdBy: input.createdBy,
  });
  if (!created) throw new Error(`bootstrapFirstClassifier: failed to create registry row for code "${input.code}".`);
  return created.id;
}

async function defaultGetActiveBaseline(
  classifierModelId: number,
): Promise<{ id: number; filePath: string | null } | null> {
  const versions = await getModelVersions(classifierModelId);
  const active = versions.find((v) => v.status === "ACTIVE");
  return active ? { id: active.id, filePath: active.filePath } : null;
}

async function defaultBuildDatasetForModel(baseModelId: number, createdBy?: number): Promise<number> {
  const ds = await createTrainingDataset({
    name: `bootstrap-${baseModelId}-${Date.now()}`,
    modelId: baseModelId,
    sourceType: "feedback",
    splitConfig: { train: 0.7, validation: 0.15, test: 0.15 },
    createdBy,
  });
  await buildDataset(ds.id);
  return ds.id;
}

function defaultTargetVersion(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `bootstrap-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/**
 * Bootstrap the FIRST (or a fresh) defect classifier end-to-end: honesty check
 * → train (few-shot) → eval on the locked TEST split → quality gate → register
 * → activate iff the gate passed. Admin-gated (callers must enforce their own
 * authorization — see aiEvalRouter.bootstrapFirstClassifier which uses
 * adminProcedure). Never runs live GPU training in tests — `deps` lets tests
 * mock the trainer/eval entirely.
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
  const ensureClassifierModel = deps.ensureClassifierModel ?? defaultEnsureClassifierModel;
  const getActiveBaseline = deps.getActiveBaseline ?? defaultGetActiveBaseline;
  const buildDatasetForModel = deps.buildDatasetForModel ?? defaultBuildDatasetForModel;
  const trainFewShot = deps.trainFewShot ?? runFewShotLearning;
  const evalAndGate = deps.evalAndGate ?? ((input) => compareBeforeAfter(input));
  const registerVersion = deps.registerVersion ?? ((data: InsertModelVersion) => createModelVersion(data));
  const activate = deps.activate ?? activateModelVersionManual;

  // 1) HONESTY GATE — verify REAL labeled supply BEFORE touching the trainer or
  //    the registry. Never fabricates a classifier from too few samples.
  const counts = await countLabeledSamples(opts.baseModelId, classLabels);
  const shortfalls = classLabels
    .map((label) => ({ label, have: counts[label] ?? 0, need: minSamplesPerClass }))
    .filter((c) => c.have < c.need);
  if (shortfalls.length > 0) {
    throw new InsufficientLabeledSamplesError(shortfalls, minSamplesPerClass);
  }

  // 2) Ensure the classifier's OWN registry identity — a NEW ai_models row,
  //    separate from the base ONNX/DINOv2 feature-extractor row, so activation
  //    never overwrites the base model's filePath/status.
  const classifierModelId = await ensureClassifierModel({
    code: opts.classifierCode,
    name: opts.classifierName ?? opts.classifierCode,
    classLabels,
    baseModelId: opts.baseModelId,
    productModelId: opts.productModelId,
    createdBy: opts.createdBy,
  });
  const baseline = await getActiveBaseline(classifierModelId);

  // 3) Locked eval split (train/val/test) — build fresh unless the caller supplied one.
  const datasetId = opts.datasetId ?? (await buildDatasetForModel(opts.baseModelId, opts.createdBy));

  // 4) TRAIN — few-shot prototypical head on the base model's frozen embeddings
  //    (aiLocalTraining.runFewShotLearning). NOT reimplemented here.
  const targetVersion = opts.targetVersion ?? defaultTargetVersion();
  const trainResult = await trainFewShot({
    modelId: opts.baseModelId,
    strategy: "fewshot",
    targetVersion,
    classLabels,
    config: { samplesPerClass: minSamplesPerClass },
    createdBy: opts.createdBy,
  });
  if (!trainResult.success || !trainResult.outputModelPath) {
    throw new Error(
      `Bootstrap training failed: ${trainResult.error ?? "few-shot learning produced no classifier artifact"}. ` +
      `No model was registered.`,
    );
  }

  // 5) EVAL (locked TEST split) + QUALITY GATE vs the classifier's current ACTIVE
  //    version, if any (aiEvalHarness.compareBeforeAfter = evaluateModelVersion +
  //    evaluateQualityGate). First bootstrap ⇒ no baseline ⇒ gate auto-PASSES.
  const report = await evalAndGate({
    modelId: opts.baseModelId,
    candidateClassifierPath: trainResult.outputModelPath,
    baselineClassifierPath: baseline?.filePath ?? null,
    baselineVersionId: baseline?.id ?? null,
    datasetId,
    split: "test",
    epsilon: opts.gateEpsilon ?? 0,
  });

  // 6) REGISTER — ALWAYS recorded (status READY) with REAL metrics + the full
  //    evalReport, even on a gate FAIL, so the attempt is auditable.
  const created = await registerVersion({
    modelId: classifierModelId,
    version: targetVersion,
    filePath: trainResult.outputModelPath,
    changeLog:
      `Bootstrap few-shot classifier (${classLabels.length} classes, ${trainResult.trainingSamples} support ` +
      `samples). Gate: ${report.gate.pass ? "PASS" : "FAIL"} — ${report.gate.reason}`,
    metrics: {
      accuracy: report.candidate.accuracy,
      precision: report.candidate.precision,
      recall: report.candidate.recall,
      f1Score: report.candidate.f1Score,
    },
    accuracy: String(Number((report.candidate.accuracy * 100).toFixed(2))),
    status: "READY",
    createdBy: opts.createdBy,
    datasetId,
    baselineVersionId: baseline?.id ?? null,
    evalReport: report as unknown,
  } as InsertModelVersion);
  if (!created) {
    throw new Error("bootstrapFirstClassifier: failed to register the model_versions row.");
  }

  // 7) ACTIVATE — ONLY when the gate passed, via the W0-2 GATED manual path
  //    (activateModelVersionManual independently re-checks evalReport.gate.pass
  //    before flipping ai_models.status → ACTIVE — defense in depth, never a
  //    blind activation). A gate FAIL leaves the version READY, untouched.
  let activated = false;
  if (report.gate.pass) {
    await activate(classifierModelId, created.id, { actorUserId: opts.actorUserId ?? null });
    activated = true;
  }

  return {
    ok: true,
    classifierModelId,
    versionId: created.id,
    version: targetVersion,
    activated,
    gate: report.gate,
    metrics: {
      accuracy: report.candidate.accuracy,
      precision: report.candidate.precision,
      recall: report.candidate.recall,
      f1Score: report.candidate.f1Score,
    },
    trainingSamples: trainResult.trainingSamples,
    validationSamples: trainResult.validationSamples,
    datasetId,
    reason: activated
      ? `Classifier "${opts.classifierCode}" v${targetVersion} bootstrapped and ACTIVATED (quality gate PASS).`
      : `Classifier "${opts.classifierCode}" v${targetVersion} registered as READY but NOT activated — ` +
        `quality gate ${report.gate.pass ? "PASS" : "FAIL"}: ${report.gate.reason}`,
  };
}
