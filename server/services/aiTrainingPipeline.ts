/**
 * AI Training Pipeline — WS-1 (Tier 1, offline-first)
 *
 * Orchestrates the closed AI self-learning loop entirely on local Node:
 *   PREPARING_DATA → buildDataset (stratified train/val/test JSONL)
 *   → TRAINING      → Tier-1 local trainer (softmax/prototype on frozen ONNX
 *                     backbone embeddings — see aiLocalTraining.ts)
 *   → VALIDATING    → eval on the locked VAL split
 *   → eval on TEST + quality gate vs. the current ACTIVE version
 *   → create model_versions (REAL metrics + outputModelPath, evalReport)
 *   → if gate passes: activate version + evict inference session cache
 *   → COMPLETED
 *
 * Removed entirely (vs. legacy): the TRAINING_SERVICE_URL cloud branch and the
 * Math.random "simulated training" branch. Tier 2 (Python sidecar) is a stub
 * behind LOCAL_TRAINER_CMD (default OFF) — see dispatchTier2 below.
 */

import * as db from "../db/aiAdvanced";
import { getAiModelById, createModelVersion, updateModelVersion, getModelVersions, updateAiModel } from "../db/ai";
import { getDb } from "../db/connection";
import { modelVersions } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import type { InsertTrainingJob } from "../../drizzle/schema";
import { buildDataset } from "./aiDatasetBuilder";
import { runTransferLearning, runFewShotLearning } from "./aiLocalTraining";
import { evaluateModelVersion, compareBeforeAfter } from "./aiEvalHarness";
import { evictSessionCache } from "./aiInferenceEngine";

export type TrainingMode = "local-embedding" | "local-sidecar";

interface CreateTrainingJobOptions {
  name: string;
  modelId: number;
  targetVersion: string;
  datasetConfig: InsertTrainingJob["datasetConfig"];
  trainingConfig?: InsertTrainingJob["trainingConfig"];
  /** Class labels for the Tier-1 classifier (required for actual training). */
  classLabels?: string[];
  /** Pre-built dataset id (if omitted, one is auto-created + built). */
  datasetId?: number;
  trainingMode?: TrainingMode;
  /** Tier-1 strategy. "transfer" (softmax) default, "fewshot" (prototype). */
  strategy?: "transfer" | "fewshot";
  /** Quality-gate epsilon (default 0 — no regression tolerated). */
  gateEpsilon?: number;
  createdBy?: number;
}

/**
 * Create a new training job and kick off the pipeline asynchronously.
 */
export async function createTrainingJob(options: CreateTrainingJobOptions) {
  const model = await getAiModelById(options.modelId);
  if (!model) throw new Error(`Model ${options.modelId} not found`);

  const job = await db.createTrainingJob({
    name: options.name,
    modelId: options.modelId,
    targetVersion: options.targetVersion,
    datasetConfig: {
      ...(options.datasetConfig ?? {}),
      ...(options.datasetId != null ? { datasetId: options.datasetId } : {}),
    },
    trainingConfig: options.trainingConfig ?? {
      epochs: 50,
      batchSize: 32,
      learningRate: 0.001,
      optimizer: "adam",
      earlyStoppingPatience: 10,
    },
    totalEpochs: (options.trainingConfig as any)?.epochs ?? 50,
    // datasetId + trainingMode columns added in migration 0104 (additive).
    ...(options.datasetId != null ? { datasetId: options.datasetId } : {}),
    trainingMode: options.trainingMode ?? "local-embedding",
    createdBy: options.createdBy,
  } as any);

  // Fire-and-forget; the pipeline updates the job row as it progresses.
  runTrainingPipeline(job.id, {
    classLabels: options.classLabels,
    datasetId: options.datasetId,
    strategy: options.strategy ?? "transfer",
    gateEpsilon: options.gateEpsilon ?? 0,
    createdBy: options.createdBy,
  }).catch((err) => {
    console.error(`[aiTrainingPipeline] job ${job.id} failed:`, err?.message || err);
  });

  return job;
}

interface PipelineOptions {
  classLabels?: string[];
  datasetId?: number;
  strategy: "transfer" | "fewshot";
  gateEpsilon: number;
  createdBy?: number;
}

/**
 * Execute the offline training pipeline (Tier 1).
 */
export async function runTrainingPipeline(jobId: number, options: PipelineOptions) {
  try {
    await db.updateTrainingJob(jobId, { status: "PREPARING_DATA", startedAt: new Date(), progress: 5 });

    const job = await db.getTrainingJob(jobId);
    if (!job) throw new Error("Training job not found");

    const dsCfg = (job.datasetConfig as any) ?? {};
    const classLabels: string[] = options.classLabels ?? dsCfg.classLabels ?? [];
    if (classLabels.length < 2) {
      throw new Error("At least 2 class labels are required for Tier-1 classifier training");
    }

    // ── Stage 1: Prepare data — materialize dataset (train/val/test) ──
    const datasetId = options.datasetId ?? dsCfg.datasetId ?? (await autoCreateDataset(job.modelId, options.createdBy));
    const built = await buildDataset(datasetId);

    await db.updateTrainingJob(jobId, {
      status: "PREPARING_DATA",
      progress: 20,
      trainingDataCount: built.split.train,
      validationDataCount: built.split.val,
      ...(datasetId != null ? { datasetId } : {}),
    } as any);

    if (built.split.train < classLabels.length) {
      throw new Error(`Insufficient training data: ${built.split.train} train samples for ${classLabels.length} classes`);
    }

    // ── Stage 2: Training (Tier 1 — local embedding classifier) ──
    await db.updateTrainingJob(jobId, { status: "TRAINING", progress: 30 });

    const trainingResult = options.strategy === "fewshot"
      ? await runFewShotLearning({
          modelId: job.modelId,
          strategy: "fewshot",
          targetVersion: job.targetVersion,
          classLabels,
          createdBy: options.createdBy,
        })
      : await runTransferLearning({
          modelId: job.modelId,
          strategy: "transfer",
          targetVersion: job.targetVersion,
          classLabels,
          config: job.trainingConfig as any,
          createdBy: options.createdBy,
        });

    if (!trainingResult.success || !trainingResult.outputModelPath) {
      throw new Error(trainingResult.error ?? "Tier-1 training failed to produce a model");
    }
    const candidatePath = trainingResult.outputModelPath;

    // ── Stage 3: Validation on the locked VAL split ──
    await db.updateTrainingJob(jobId, { status: "VALIDATING", progress: 75 });

    const valEval = await evaluateModelVersion({
      modelId: job.modelId,
      classifierPath: candidatePath,
      datasetId,
      split: "val",
    });

    // ── Stage 4: Baseline (current ACTIVE version) + TEST eval + gate ──
    const baseline = await getActiveVersionClassifier(job.modelId);

    const compare = await compareBeforeAfter({
      modelId: job.modelId,
      candidateClassifierPath: candidatePath,
      baselineClassifierPath: baseline?.filePath ?? null,
      baselineVersionId: baseline?.id ?? null,
      datasetId,
      split: "test",
      epsilon: options.gateEpsilon,
    });

    const validationMetrics = {
      accuracy: valEval.accuracy,
      precision: valEval.precision,
      recall: valEval.recall,
      f1Score: valEval.f1Score,
      confusionMatrix: valEval.confusionMatrix,
    };

    await db.updateTrainingJob(jobId, { validationMetrics, progress: 90 });

    // ── Stage 5: Create model_versions with REAL metrics ──
    const versionStatus = compare.gate.pass ? "ACTIVE" : "READY";
    const created = await createModelVersion({
      modelId: job.modelId,
      version: job.targetVersion,
      filePath: candidatePath,
      changeLog: `Tier-1 ${options.strategy} training (job ${jobId}). Gate: ${compare.gate.pass ? "PASS" : "FAIL"} — ${compare.gate.reason}`,
      metrics: {
        accuracy: compare.candidate.accuracy,
        precision: compare.candidate.precision,
        recall: compare.candidate.recall,
        f1Score: compare.candidate.f1Score,
      },
      accuracy: String(Number((compare.candidate.accuracy * 100).toFixed(2))),
      status: versionStatus,
      createdBy: options.createdBy,
      // additive columns (migration 0104)
      datasetId,
      baselineVersionId: baseline?.id ?? null,
      evalReport: compare as unknown,
    } as any);

    // ── Stage 6: Activate iff the quality gate passed ──
    if (compare.gate.pass && created) {
      await activateModelVersion(job.modelId, created.id, job.targetVersion);
      evictSessionCache(job.modelId);
    }

    await db.updateTrainingJob(jobId, {
      status: "COMPLETED",
      progress: 100,
      completedAt: new Date(),
      outputModelPath: candidatePath,
      validationMetrics,
    });

    return { jobId, versionId: created?.id, gate: compare.gate, metrics: compare.candidate };
  } catch (err: unknown) {
    await db.updateTrainingJob(jobId, {
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
      completedAt: new Date(),
    });
    throw err;
  }
}

/**
 * Tier 2 dispatcher — STUB. The Python sidecar trainer is intentionally NOT
 * implemented in WS-1. It only activates when LOCAL_TRAINER_CMD is set, which is
 * off by default to honor the offline-first / Tier-1-only decision.
 *
 * TODO(WS-1 Tier 2): spawn `process.env.LOCAL_TRAINER_CMD` with the dataset
 * manifest dir + class labels, await a JSON result, register the produced model.
 * Until then this throws so callers fall back to Tier 1.
 */
export function dispatchTier2(): never {
  throw new Error(
    "Tier-2 local sidecar trainer is not implemented (offline Tier-1 only). " +
    "Set LOCAL_TRAINER_CMD and implement dispatchTier2 to enable.",
  );
}

// ─── Activation helpers ─────────────────────────────────────────

async function getActiveVersionClassifier(modelId: number): Promise<{ id: number; filePath: string | null } | null> {
  const versions = await getModelVersions(modelId);
  const active = versions.find(v => v.status === "ACTIVE");
  if (!active) return null;
  return { id: active.id, filePath: active.filePath };
}

async function activateModelVersion(modelId: number, versionId: number, version: string): Promise<void> {
  const database = await getDb();
  if (!database) return;
  // Demote any currently-active versions for this model.
  await database.update(modelVersions)
    .set({ status: "INACTIVE" })
    .where(and(eq(modelVersions.modelId, modelId), eq(modelVersions.status, "ACTIVE")));
  // Promote the new one.
  await updateModelVersion(versionId, { status: "ACTIVE" });
  // Point the model at the new current version.
  await updateAiModel(modelId, { currentVersion: version });
}

async function autoCreateDataset(modelId: number, createdBy?: number): Promise<number> {
  const ds = await db.createTrainingDataset({
    name: `auto-${modelId}-${Date.now()}`,
    modelId,
    sourceType: "feedback",
    splitConfig: { train: 0.8, validation: 0.15, test: 0.05 },
    createdBy,
  });
  return ds.id;
}

/**
 * Create a training dataset from feedback data (row only; call buildDataset to
 * materialize). Kept for backward compatibility with existing callers/UI.
 */
export async function createDataset(options: {
  name: string;
  description?: string;
  modelId?: number;
  productModelId?: number;
  sourceType?: string;
  filterConfig?: {
    feedbackTypes?: string[];
    minAccuracy?: number;
    dateRange?: { from: string; to: string };
    productModelIds?: number[];
  };
  splitConfig?: { train: number; validation: number; test: number };
  createdBy?: number;
}) {
  return db.createTrainingDataset({
    name: options.name,
    description: options.description,
    modelId: options.modelId,
    productModelId: options.productModelId,
    sourceType: options.sourceType ?? "feedback",
    filterConfig: options.filterConfig,
    splitConfig: options.splitConfig ?? { train: 0.8, validation: 0.15, test: 0.05 },
    createdBy: options.createdBy,
  });
}

/**
 * Cancel a running training job.
 */
export async function cancelTrainingJob(jobId: number) {
  const job = await db.getTrainingJob(jobId);
  if (!job) throw new Error(`Training job ${jobId} not found`);
  if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
    throw new Error(`Cannot cancel job in status ${job.status}`);
  }
  await db.updateTrainingJob(jobId, { status: "CANCELLED", completedAt: new Date() });
  return { success: true };
}

/**
 * Check auto-retrain trigger conditions. Now also reads labeled-sample supply
 * (ai_label_queue LABELED/AUTO_LABELED) via getTrainingDataStats.
 */
export async function checkAutoRetrainTrigger(modelId: number): Promise<{
  shouldRetrain: boolean;
  reason?: string;
  feedbackCount: number;
  labeledCount: number;
  accuracyDrop?: number;
}> {
  const stats = await db.getTrainingDataStats(modelId);
  if (!stats) return { shouldRetrain: false, feedbackCount: 0, labeledCount: 0 };

  const labeledCount = stats.labeledCount ?? 0;
  const reviewed = stats.correctCount + stats.incorrectCount + stats.partialCount;
  const incorrectRate = reviewed > 0 ? stats.incorrectCount / reviewed : 0;

  // Trigger if a meaningful sample of feedback shows a high error rate.
  if (reviewed >= 100 && incorrectRate > 0.2) {
    return {
      shouldRetrain: true,
      reason: `High error rate: ${(incorrectRate * 100).toFixed(1)}% incorrect across ${reviewed} reviewed`,
      feedbackCount: reviewed,
      labeledCount,
      accuracyDrop: incorrectRate,
    };
  }

  // Trigger if enough freshly LABELED samples have accumulated.
  if (labeledCount >= 100) {
    return {
      shouldRetrain: true,
      reason: `${labeledCount} labeled samples available for retraining`,
      feedbackCount: reviewed,
      labeledCount,
    };
  }

  return { shouldRetrain: false, feedbackCount: reviewed, labeledCount };
}
