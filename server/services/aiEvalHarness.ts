/**
 * AI Eval Harness — WS-1
 *
 * Offline evaluation of a locally-trained model version against a LOCKED split
 * (val or test) from a materialized dataset. Computes confusion matrix +
 * accuracy + macro/micro P/R/F1 via the shared aiMetrics helpers, so training
 * and evaluation share one source of truth.
 *
 * `compareBeforeAfter` runs baseline + candidate over the SAME test split (fair
 * comparison) and records the report into `model_versions.metrics` /
 * `evalReport`. A quality gate blocks activation when the candidate's accuracy
 * regresses beyond epsilon (default 0 → no regression tolerated).
 *
 * Offline-first; concurrency is 1 (sequential) to avoid VRAM contention and to
 * reuse the LRU session cache in the inference engine.
 */

import path from "path";
import fs from "fs";
import { getModelVersionById, updateModelVersion } from "../db/ai";
import { predictWithLocalClassifier } from "./aiLocalTraining";
import { datasetDir, readJsonl, type DatasetSample } from "./aiDatasetBuilder";
import {
  buildConfusionMatrix,
  computeMetrics,
  normalizeLabel,
  type ClassificationMetrics,
} from "./aiMetrics";

export type SplitName = "train" | "val" | "test";

export interface EvalResult extends ClassificationMetrics {
  evaluated: number;
  skipped: number;
  labels: string[];
  split: SplitName;
}

function resolveModelPath(filePath: string): string {
  if (filePath.startsWith("/uploads/")) return path.join(process.cwd(), filePath);
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(process.cwd(), filePath);
}

/**
 * Evaluate a trained classifier (referenced by `classifierPath`, backed by ONNX
 * model `modelId`) against the given split of a dataset.
 *
 * Returns full classification metrics. Samples whose label isn't in the
 * classifier's class space (or whose image is missing) are counted as `skipped`.
 */
export async function evaluateModelVersion(opts: {
  modelId: number;
  classifierPath: string;
  datasetId: number;
  split: SplitName;
  /** Override sample list (for tests). When provided, datasetId/split are ignored for loading. */
  samples?: DatasetSample[];
  /** Inject a predict fn for tests (defaults to predictWithLocalClassifier). */
  predictFn?: (modelId: number, classifierPath: string, imagePath: string) =>
    Promise<{ label: string; confidence: number } | null>;
}): Promise<EvalResult> {
  const samples = opts.samples ?? readJsonl(path.join(datasetDir(opts.datasetId), `${opts.split}.jsonl`));

  const predict = opts.predictFn ?? predictWithLocalClassifier;
  const resolvedClassifier = resolveModelPath(opts.classifierPath);

  // Build a stable class index over the union of actual + predicted labels.
  const classOrder: string[] = [];
  const classIndex = new Map<string, number>();
  const ensureClass = (label: string): number => {
    const key = normalizeLabel(label);
    let idx = classIndex.get(key);
    if (idx === undefined) {
      idx = classOrder.length;
      classIndex.set(key, idx);
      classOrder.push(label);
    }
    return idx;
  };

  const predictedIdx: number[] = [];
  const actualIdx: number[] = [];
  let skipped = 0;

  // Sequential (concurrency = 1) to reuse session cache, avoid VRAM contention.
  for (const sample of samples) {
    let prediction: { label: string; confidence: number } | null = null;
    try {
      prediction = await predict(opts.modelId, resolvedClassifier, sample.imageUrl);
    } catch {
      prediction = null;
    }
    if (!prediction || !prediction.label) {
      skipped++;
      continue;
    }
    actualIdx.push(ensureClass(sample.label));
    predictedIdx.push(ensureClass(prediction.label));
  }

  const numClasses = classOrder.length;
  const matrix = buildConfusionMatrix(predictedIdx, actualIdx, numClasses);
  const metrics = computeMetrics(matrix);

  return {
    ...metrics,
    evaluated: predictedIdx.length,
    skipped,
    labels: classOrder,
    split: opts.split,
  };
}

export interface QualityGateResult {
  pass: boolean;
  reason: string;
  accuracyDelta: number;
  epsilon: number;
}

/**
 * Quality gate: candidate passes only if its accuracy is at least
 * (baselineAccuracy - epsilon). epsilon default 0 → no regression tolerated.
 * If there is no baseline, the candidate passes (first model).
 */
export function evaluateQualityGate(
  candidateAccuracy: number,
  baselineAccuracy: number | null,
  epsilon = 0,
): QualityGateResult {
  if (baselineAccuracy == null) {
    return { pass: true, reason: "No baseline — candidate accepted as first version.", accuracyDelta: candidateAccuracy, epsilon };
  }
  const delta = Number((candidateAccuracy - baselineAccuracy).toFixed(4));
  const pass = candidateAccuracy >= baselineAccuracy - epsilon;
  return {
    pass,
    reason: pass
      ? `Candidate accuracy ${candidateAccuracy.toFixed(4)} >= baseline ${baselineAccuracy.toFixed(4)} - eps ${epsilon}.`
      : `Candidate accuracy ${candidateAccuracy.toFixed(4)} regressed below baseline ${baselineAccuracy.toFixed(4)} - eps ${epsilon}.`,
    accuracyDelta: delta,
    epsilon,
  };
}

export interface CompareReport {
  baseline: EvalResult | null;
  candidate: EvalResult;
  gate: QualityGateResult;
  split: SplitName;
  generatedAt: string;
}

/**
 * Run baseline + candidate over the SAME test split and produce a before/after
 * report. Persists the report into `model_versions.metrics` + `evalReport` for
 * the candidate version (if `candidateVersionId` given). Applies the quality gate.
 */
export async function compareBeforeAfter(opts: {
  modelId: number;
  candidateClassifierPath: string;
  candidateVersionId?: number;
  baselineClassifierPath?: string | null;
  baselineVersionId?: number | null;
  datasetId: number;
  split?: SplitName;
  epsilon?: number;
  samples?: DatasetSample[];
  predictFn?: (modelId: number, classifierPath: string, imagePath: string) =>
    Promise<{ label: string; confidence: number } | null>;
}): Promise<CompareReport> {
  const split = opts.split ?? "test";

  const candidate = await evaluateModelVersion({
    modelId: opts.modelId,
    classifierPath: opts.candidateClassifierPath,
    datasetId: opts.datasetId,
    split,
    samples: opts.samples,
    predictFn: opts.predictFn,
  });

  let baseline: EvalResult | null = null;
  if (opts.baselineClassifierPath && fileExists(opts.baselineClassifierPath)) {
    baseline = await evaluateModelVersion({
      modelId: opts.modelId,
      classifierPath: opts.baselineClassifierPath,
      datasetId: opts.datasetId,
      split,
      samples: opts.samples,
      predictFn: opts.predictFn,
    });
  }

  const gate = evaluateQualityGate(candidate.accuracy, baseline?.accuracy ?? null, opts.epsilon ?? 0);

  const report: CompareReport = {
    baseline,
    candidate,
    gate,
    split,
    generatedAt: new Date().toISOString(),
  };

  if (opts.candidateVersionId != null) {
    await persistEvalReport(opts.candidateVersionId, candidate, report);
  }

  return report;
}

function fileExists(p: string): boolean {
  const resolved = resolveModelPath(p);
  return fs.existsSync(resolved);
}

/** Persist metrics + full eval report onto a model_versions row. */
export async function persistEvalReport(
  versionId: number,
  metrics: ClassificationMetrics,
  report: CompareReport,
): Promise<void> {
  const existing = await getModelVersionById(versionId);
  const prevMetrics = (existing?.metrics as Record<string, unknown> | null) ?? {};

  await updateModelVersion(versionId, {
    metrics: {
      ...prevMetrics,
      accuracy: metrics.accuracy,
      precision: metrics.precision,
      recall: metrics.recall,
      f1Score: metrics.f1Score,
      microF1: metrics.microF1,
    },
    accuracy: String(Number((metrics.accuracy * 100).toFixed(2))),
    // evalReport column added in migration 0104 (additive, nullable).
    evalReport: report as unknown,
  } as any);
}
