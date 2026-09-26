import { createHash } from "crypto";
import { appError } from "../_core/appError";
import * as db from "../db/aiAdvanced";
import { runInference } from "./aiInferenceEngine";
import { getAiModelById } from "../db/ai";
import type { AbTestExperiment } from "../../drizzle/schema/ai";

/**
 * Deterministic canary routing.
 *
 * Replaces the previous `Math.random()` split so that the SAME inspectionId always
 * maps to the SAME variant. This is required for offline-first / idempotent sync:
 * re-processing the same inspection (e.g. after an edge device reconnects) must not
 * flip the variant and double-skew the experiment.
 *
 * Maps inspectionId → a stable bucket in [0,100) via a sha256 hash and compares it
 * against the experiment's trafficSplitPercent (= % of traffic routed to variant B,
 * matching the original `roll < trafficSplitPercent ? "B" : "A"` semantics).
 */
export function selectCanaryVariant(
  experiment: Pick<AbTestExperiment, "trafficSplitPercent">,
  inspectionId: number,
): "A" | "B" {
  const split = experiment.trafficSplitPercent ?? 50;
  const bucket = hashToBucket(inspectionId);
  return bucket < split ? "B" : "A";
}

/** Stable hash of a numeric id → integer in [0, 100). */
function hashToBucket(id: number): number {
  const digest = createHash("sha256").update(String(id)).digest();
  // Use the first 4 bytes as an unsigned 32-bit int for a uniform spread.
  const n = digest.readUInt32BE(0);
  return n % 100;
}

/**
 * Derive a stable numeric routing key from an arbitrary string (e.g. inputReference)
 * when no inspectionId is available. Returns a fresh pseudo-random key when the
 * string is empty (non-deterministic, but only hit by ad-hoc batch calls without a
 * stable identifier — the live canary path always supplies inspectionId).
 */
function hashKeyFromString(s: string | undefined): number {
  if (!s) return Math.floor(Math.random() * 1_000_000_000);
  return createHash("sha256").update(s).digest().readUInt32BE(0);
}

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
  if (!modelA) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aiModel" }, `Model A (${options.modelAId}) not found`);
  if (!modelB) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aiModel" }, `Model B (${options.modelBId}) not found`);

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
  if (!exp) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "abTestExperiment" }, `Experiment ${experimentId} not found`);
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
  if (!exp) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "abTestExperiment" }, `Experiment ${experimentId} not found`);
  if (exp.status !== "RUNNING") {
    throw new Error(`Experiment is not running (status: ${exp.status})`);
  }

  // Deterministic routing keyed on inspectionId (idempotent for offline sync).
  // Falls back to inputReference / a fresh random id only when no stable key exists.
  const routingKey =
    (metadata?.inspectionId as number | undefined) ??
    hashKeyFromString(metadata?.inputReference as string | undefined);
  const variant = selectCanaryVariant(exp, routingKey);

  const modelId = variant === "A" ? exp.modelAId : exp.modelBId;
  const modelVersion = (variant === "A" ? exp.modelAVersion : exp.modelBVersion) ?? "";

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

  // Update experiment counters.
  // B6 FIX: write the REAL column names (modelAInferences / modelBInferences) — the
  // previous code wrote modelAInferenceCount / modelBInferenceCount which do not
  // exist on the table, so (with the old `as any` cast) the counters never moved.
  // Also keep totalInferences in sync so total == A + B.
  const updates: Partial<import("../../drizzle/schema/ai").InsertAbTestExperiment> = {
    totalInferences: (exp.totalInferences ?? 0) + 1,
  };
  if (variant === "A") {
    updates.modelAInferences = (exp.modelAInferences ?? 0) + 1;
  } else {
    updates.modelBInferences = (exp.modelBInferences ?? 0) + 1;
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
  if (!exp) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "abTestExperiment" }, `Experiment ${experimentId} not found`);

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
    // decimal columns are stored as strings by drizzle-orm/postgres.
    statisticalSignificance: significance === null ? null : String(significance),
    modelAAccuracy: String(stats.modelA.accuracy),
    modelBAccuracy: String(stats.modelB.accuracy),
    // B6 FIX: real column names are modelAAvgLatency / modelBAvgLatency (not …Ms).
    modelAAvgLatency: String(stats.modelA.avgLatencyMs),
    modelBAvgLatency: String(stats.modelB.avgLatencyMs),
  });

  return { winner, significance, stats };
}

/**
 * Pause a running experiment (RUNNING → PAUSED). Used by manual control and by the
 * automatic guardrail. Idempotent: pausing a non-running experiment is a no-op.
 */
export async function pauseExperiment(experimentId: number) {
  const exp = await db.getABTestExperiment(experimentId);
  if (!exp) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "abTestExperiment" }, `Experiment ${experimentId} not found`);
  if (exp.status !== "RUNNING") return exp;
  return db.updateABTestExperiment(experimentId, { status: "PAUSED" });
}

export interface CanaryGuardrailOptions {
  /** Min accuracy gap (A − B) that triggers a rollback. Default 0.05 (5pp). */
  accuracyDelta?: number;
  /** Max acceptable B/A average-latency ratio. Default 1.5 (B is 50% slower). */
  maxLatencyRatio?: number;
  /** Min feedback samples on EACH variant before accuracy is trusted. Default 30. */
  minFeedback?: number;
}

export interface CanaryGuardrailResult {
  shouldRollback: boolean;
  reasons: string[];
  paused: boolean;
  stats: Awaited<ReturnType<typeof getExperimentStats>>;
}

/**
 * Evaluate canary health and auto-PAUSE (rollback to model A) when variant B is
 * materially worse:
 *   - accuracy_B < accuracy_A − δ  (only once both variants have enough feedback), or
 *   - avg latency_B > latency_A × maxLatencyRatio.
 *
 * Returns the decision + reasons. When a rollback is warranted and the experiment is
 * still RUNNING, it is paused. Safe to call repeatedly (idempotent once PAUSED).
 */
export async function evaluateCanaryGuardrail(
  experimentId: number,
  options: CanaryGuardrailOptions = {},
): Promise<CanaryGuardrailResult> {
  const accuracyDelta = options.accuracyDelta ?? 0.05;
  const maxLatencyRatio = options.maxLatencyRatio ?? 1.5;
  const minFeedback = options.minFeedback ?? 30;

  const stats = await getExperimentStats(experimentId);
  const reasons: string[] = [];

  const fbA = stats.modelA.feedbackCount;
  const fbB = stats.modelB.feedbackCount;
  if (
    fbA >= minFeedback &&
    fbB >= minFeedback &&
    stats.modelB.accuracy < stats.modelA.accuracy - accuracyDelta
  ) {
    reasons.push(
      `accuracy_B (${stats.modelB.accuracy.toFixed(4)}) < accuracy_A (${stats.modelA.accuracy.toFixed(4)}) - δ (${accuracyDelta})`,
    );
  }

  const latA = stats.modelA.avgLatencyMs;
  const latB = stats.modelB.avgLatencyMs;
  if (latA > 0 && latB > latA * maxLatencyRatio) {
    reasons.push(
      `latency_B (${latB}ms) > latency_A (${latA}ms) × ${maxLatencyRatio}`,
    );
  }

  const shouldRollback = reasons.length > 0;
  let paused = false;
  if (shouldRollback && stats.experiment.status === "RUNNING") {
    await pauseExperiment(experimentId);
    paused = true;
  }

  return { shouldRollback, reasons, paused, stats };
}

/**
 * Promote variant B as the winner: point the supplied quality-gate config at model B,
 * detach the experiment from the live path, and close the experiment as COMPLETED
 * (winner=B). Additive + reversible at the config level.
 */
export async function promoteWinner(experimentId: number, configId?: number) {
  const exp = await db.getABTestExperiment(experimentId);
  if (!exp) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "abTestExperiment" }, `Experiment ${experimentId} not found`);

  if (configId != null) {
    // Lazy import to avoid a module cycle (aiQualityGate ↔ aiABTesting).
    const qg = await import("./aiQualityGate");
    await qg.promoteConfigToModel(configId, exp.modelBId, experimentId);
  }

  return db.updateABTestExperiment(experimentId, {
    status: "COMPLETED",
    endDate: exp.endDate ?? new Date(),
    winner: "B",
  });
}
