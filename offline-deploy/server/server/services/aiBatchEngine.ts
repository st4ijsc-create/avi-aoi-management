import { runInference } from "./aiInferenceEngine";
import * as db from "../db/aiAdvanced";
import { getAiModelById } from "../db/ai";
import fs from "fs";
import path from "path";

interface BatchOptions {
  name: string;
  modelId: number;
  modelVersion?: string;
  inputs: Array<{ reference: string; type?: string; data?: string }>;
  concurrency?: number;
  priority?: number;
  createdBy?: number;
}

/**
 * Create and start a batch inference job
 */
export async function createBatchJob(options: BatchOptions) {
  const model = await getAiModelById(options.modelId);
  if (!model) throw new Error(`Model ${options.modelId} not found`);
  if (model.status !== "ACTIVE") throw new Error(`Model ${model.code} is not active`);

  const job = await db.createBatchInferenceJob({
    name: options.name,
    modelId: options.modelId,
    modelVersion: options.modelVersion ?? model.currentVersion,
    totalItems: options.inputs.length,
    concurrency: options.concurrency ?? 4,
    priority: options.priority ?? 5,
    createdBy: options.createdBy,
  });

  // Create batch items
  for (const input of options.inputs) {
    await db.createBatchInferenceItem({
      batchJobId: job.id,
      inputReference: input.reference,
      inputType: input.type ?? "image",
    });
  }

  // Start processing asynchronously
  processBatchJob(job.id, options.modelId, options.concurrency ?? 4).catch(() => {});

  return job;
}

/**
 * Process a batch job with controlled concurrency
 */
async function processBatchJob(jobId: number, modelId: number, concurrency: number) {
  await db.updateBatchInferenceJob(jobId, {
    status: "PROCESSING",
    startedAt: new Date(),
  });

  const items = await db.getBatchInferenceItems(jobId);
  const pending = [...items];
  let completedCount = 0;
  let failedCount = 0;
  const labelCounts: Record<string, number> = {};
  let totalConfidence = 0;
  let totalProcessingTime = 0;

  // Process with concurrency limit
  const processItem = async (item: typeof items[0]) => {
    try {
      await db.updateBatchInferenceItem(item.id, { status: "PROCESSING" });

      const imageBuffer = await resolveInputToBuffer(item.inputReference);
      const result = await runInference(modelId, imageBuffer, {
        inputReference: item.inputReference,
      });

      await db.updateBatchInferenceItem(item.id, {
        status: "COMPLETED",
        predictions: result.predictions,
        confidence: result.confidence?.toString(),
        topLabel: result.topLabel,
        processingTimeMs: result.processingTimeMs,
        completedAt: new Date(),
      });

      completedCount++;
      if (result.topLabel) {
        labelCounts[result.topLabel] = (labelCounts[result.topLabel] ?? 0) + 1;
      }
      totalConfidence += result.confidence ?? 0;
      totalProcessingTime += result.processingTimeMs;

      // Update progress periodically
      if (completedCount % 10 === 0 || completedCount === items.length) {
        await db.updateBatchInferenceJob(jobId, {
          completedItems: completedCount,
          failedItems: failedCount,
        });
      }
    } catch (err: unknown) {
      failedCount++;
      await db.updateBatchInferenceItem(item.id, {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      });
    }
  };

  // Execute with concurrency pool
  const pool: Promise<void>[] = [];
  for (const item of pending) {
    const promise = processItem(item).then(() => {
      pool.splice(pool.indexOf(promise), 1);
    });
    pool.push(promise);
    if (pool.length >= concurrency) {
      await Promise.race(pool);
    }
  }
  await Promise.all(pool);

  // Finalize job
  const totalProcessed = completedCount + failedCount;
  const topDefects = Object.entries(labelCounts)
    .map(([label, count]) => ({
      label,
      count,
      percentage: totalProcessed > 0 ? Number(((count / totalProcessed) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  await db.updateBatchInferenceJob(jobId, {
    status: failedCount === items.length ? "FAILED" : "COMPLETED",
    completedItems: completedCount,
    failedItems: failedCount,
    completedAt: new Date(),
    resultsSummary: {
      labelCounts,
      avgConfidence: completedCount > 0 ? Number((totalConfidence / completedCount).toFixed(4)) : 0,
      avgProcessingTimeMs: completedCount > 0 ? Math.round(totalProcessingTime / completedCount) : 0,
      topDefects,
    },
  });
}

/**
 * Cancel a running batch job
 */
export async function cancelBatchJob(jobId: number) {
  const job = await db.getBatchInferenceJob(jobId);
  if (!job) throw new Error(`Batch job ${jobId} not found`);
  if (job.status !== "PENDING" && job.status !== "PROCESSING") {
    throw new Error(`Cannot cancel job in status ${job.status}`);
  }
  await db.updateBatchInferenceJob(jobId, {
    status: "CANCELLED",
    completedAt: new Date(),
  });
  // Mark remaining pending items as SKIPPED
  const items = await db.getBatchInferenceItems(jobId);
  for (const item of items) {
    if (item.status === "PENDING") {
      await db.updateBatchInferenceItem(item.id, { status: "SKIPPED" });
    }
  }
  return { success: true };
}

/**
 * Get batch job progress
 */
export async function getBatchJobProgress(jobId: number) {
  const job = await db.getBatchInferenceJob(jobId);
  if (!job) throw new Error(`Batch job ${jobId} not found`);

  const progress = job.totalItems > 0
    ? Math.round(((job.completedItems + job.failedItems) / job.totalItems) * 100)
    : 0;

  return {
    ...job,
    progress,
    isRunning: job.status === "PROCESSING",
    isComplete: job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED",
  };
}

/**
 * Resolve input reference to a buffer for inference
 */
async function resolveInputToBuffer(inputReference: string): Promise<Buffer> {
  // Handle base64 data
  if (inputReference.startsWith("data:")) {
    const base64Data = inputReference.split(",")[1];
    if (!base64Data) throw new Error("Invalid base64 data URI");
    return Buffer.from(base64Data, "base64");
  }

  // Handle local file path
  let filePath = inputReference;
  if (filePath.startsWith("/uploads/")) {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");
    filePath = path.join(uploadsRoot, filePath.replace("/uploads/", ""));
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${inputReference}`);
  }
  return fs.promises.readFile(filePath);
}
