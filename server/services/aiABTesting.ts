import * as db from "../db/aiAdvanced";
import { runInference } from "./aiInferenceEngine";
import { getAiModelById } from "../db/ai";

interface CreateExperimentOptions {
  name: string;
  description?: string;
  modelAId: number;
  modelAVersion: string;
  modelBId: number;
  modelBVersion: string;
  trafficSplitPercent?: number;
  productModelId?: number;
  createdBy?: number;
}

/**
 * Create a new A/B test experiment
 */
export async function createExperiment(options: CreateExperimentOptions) {
  const [modelA, modelB] = await Promise.all([
    getAiModelById(options.modelAId),
    getAiModelById(options.modelBId),
  ]);
  if (!modelA) throw new Error(`Model A (${options.modelAId}) not found`);
  if (!modelB) throw new Error(`Model B (${options.modelBId}) not found`);

  return db.createABTestExperiment({
    name: options.name,
    description: options.description,
    modelAId: options.modelAId,
    modelAVersion: options.modelAVersion,
    modelBId: options.modelBId,
    modelBVersion: options.modelBVersion,
    trafficSplitPercent: options.trafficSplitPercent ?? 50,
    productModelId: options.productModelId,
    createdBy: options.createdBy,
  });
}

/**
 * Start an experiment (set status to RUNNING)
 */
export async function startExperiment(experimentId: number) {
  const exp = await db.getABTestExperiment(experimentId);
  if (!exp) throw new Error(`Experiment ${experimentId} not found`);
  if (exp.status !== "DRAFT" && exp.status !== "PAUSED") {
    throw new Error(`Cannot start experiment in status ${exp.status}`);
  }
  return db.updateABTestExperiment(experimentId, {
    status: "RUNNING",
    startDate: exp.startDate ?? new Date(),
  });
}

/**
 * Run an A/B inference — routes to model A or B based on traffic split
 */
export async function runABInference(
  experimentId: number,
  inputBuffer: Buffer,
  metadata?: Record<string, unknown>,
): Promise<{
  variant: "A" | "B";
  modelId: number;
  modelVersion: string;
  predictions: any;
  confidence: number;
  topLabel: string;
  processingTimeMs: number;
}> {
  const exp = await db.getABTestExperiment(experimentId);
  if (!exp) throw new Error(`Experiment ${experimentId} not found`);
  if (exp.status !== "RUNNING") {
    throw new Error(`Experiment is not running (status: ${exp.status})`);
  }

  // Route traffic based on split percentage
  const roll = Math.random() * 100;
  const variant: "A" | "B" = roll < exp.trafficSplitPercent ? "B" : "A";

  const modelId = variant === "A" ? exp.modelAId : exp.modelBId;
  const modelVersion = variant === "A" ? exp.modelAVersion : exp.modelBVersion;

  const startTime = Date.now();
  const result = await runInference(modelId, inputBuffer);
  const processingTimeMs = Date.now() - startTime;

  const predictions = result.predictions;
  const topPred = predictions.reduce(
    (best: any, p: any) => (p.confidence > (best?.confidence ?? 0) ? p : best),
    null,
  );

  // Record the result
  await db.createABTestResult({
    experimentId,
    variant,
    modelId,
    modelVersion,
    inputReference: metadata?.inputReference as string,
    predictions,
    confidence: topPred?.confidence ?? 0,
    topLabel: topPred?.label ?? "unknown",
    processingTimeMs,
  });

  // Update experiment counters
  const updates: Record<string, unknown> = {};
  if (variant === "A") {
    updates.modelAInferenceCount = (exp.modelAInferenceCount ?? 0) + 1;
  } else {
    updates.modelBInferenceCount = (exp.modelBInferenceCount ?? 0) + 1;
  }
  await db.updateABTestExperiment(experimentId, updates);

  return {
    variant,
    modelId,
    modelVersion,
    predictions,
    confidence: topPred?.confidence ?? 0,
    topLabel: topPred?.label ?? "unknown",
    processingTimeMs,
  };
}

/**
 * Submit feedback for an A/B test result
 */
export async function submitABFeedback(
  resultId: number,
  feedbackType: "CORRECT" | "INCORRECT" | "PARTIAL",
  isCorrect: boolean,
) {
  return db.updateABTestResult(resultId, {
    feedbackType: feedbackType.toLowerCase() as any,
    isCorrect,
  });
}

/**
 * Get experiment statistics with comparison metrics
 */
export async function getExperimentStats(experimentId: number) {
  const exp = await db.getABTestExperiment(experimentId);
  if (!exp) throw new Error(`Experiment ${experimentId} not found`);

  const stats = await db.getABTestStats(experimentId);

  return {
    experiment: exp,
    modelA: {
      inferenceCount: stats.modelACount,
      avgConfidence: stats.modelAAvgConfidence,
      avgLatencyMs: stats.modelAAvgLatency,
      accuracy: stats.modelAAccuracy,
      feedbackCount: stats.modelAFeedbackCount,
    },
    modelB: {
      inferenceCount: stats.modelBCount,
      avgConfidence: stats.modelBAvgConfidence,
      avgLatencyMs: stats.modelBAvgLatency,
      accuracy: stats.modelBAccuracy,
      feedbackCount: stats.modelBFeedbackCount,
    },
    statisticalSignificance: calculateSignificance(stats),
  };
}

/**
 * Calculate Chi-squared significance between model A and B
 */
function calculateSignificance(stats: {
  modelACount: number;
  modelBCount: number;
  modelAAccuracy: number;
  modelBAccuracy: number;
  modelAFeedbackCount: number;
  modelBFeedbackCount: number;
}): number | null {
  const nA = stats.modelAFeedbackCount;
  const nB = stats.modelBFeedbackCount;
  if (nA < 30 || nB < 30) return null; // Insufficient data

  const pA = stats.modelAAccuracy;
  const pB = stats.modelBAccuracy;
  const pPooled = (pA * nA + pB * nB) / (nA + nB);
  if (pPooled === 0 || pPooled === 1) return null;

  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / nA + 1 / nB));
  if (se === 0) return null;

  const z = Math.abs(pA - pB) / se;
  // Approximate p-value using normal CDF
  const pValue = 2 * (1 - normalCDF(z));
  return Number(pValue.toFixed(6));
}

function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Conclude an experiment and determine winner
 */
export async function concludeExperiment(experimentId: number) {
  const stats = await getExperimentStats(experimentId);
  const significance = stats.statisticalSignificance;

  let winner: "A" | "B" | "INCONCLUSIVE" = "INCONCLUSIVE";
  if (significance !== null && significance < 0.05) {
    // Statistically significant
    winner = stats.modelA.accuracy > stats.modelB.accuracy ? "A" : "B";
  }

  await db.updateABTestExperiment(experimentId, {
    status: "COMPLETED",
    endDate: new Date(),
    winner,
    statisticalSignificance: significance,
    modelAAccuracy: stats.modelA.accuracy,
    modelBAccuracy: stats.modelB.accuracy,
    modelAAvgLatencyMs: stats.modelA.avgLatencyMs,
    modelBAvgLatencyMs: stats.modelB.avgLatencyMs,
  });

  return { winner, significance, stats };
}
