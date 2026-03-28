/**
 * AI Quality Gate Service
 * 
 * Automatically evaluates inspection images using AI models and makes
 * pass/fail decisions based on configurable confidence thresholds.
 * 
 * Flow: Image → Inference (single or ensemble) → Threshold → Decision → Alert
 */
import { getDb } from "../db/connection";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  aiQualityGateConfigs,
  aiQualityGateResults,
  aiEnsembleConfigs,
  productInspections,
  type AiQualityGateConfig,
  type AiEnsembleConfig,
} from "../../drizzle/schema";
import { runInference } from "./aiInferenceEngine";
import { getAiModelById } from "../db/ai";

// ─── Types ───────────────────────────────────────────────────────

export interface QualityGateDecision {
  decision: "AUTO_OK" | "AUTO_NG" | "NEEDS_REVIEW" | "MANUAL";
  confidence: number;
  topLabel: string;
  predictions: Array<{ label: string; confidence: number }>;
  ensembleResults?: Array<{
    modelId: number;
    modelCode: string;
    topLabel: string;
    confidence: number;
    predictions: Array<{ label: string; confidence: number }>;
  }>;
  processingTimeMs: number;
  reviewReason?: string;
}

// ─── Config Lookup ───────────────────────────────────────────────

const configCache = new Map<string, { config: AiQualityGateConfig; ts: number }>();
const CONFIG_TTL = 30_000; // 30s cache

function configKey(machineId: number, productModelId?: number | null): string {
  return `${machineId}:${productModelId ?? 0}`;
}

/**
 * Find the best matching quality gate config for a machine/product pair.
 * Priority: machine+product > machine-only > null (disabled).
 */
export async function getQualityGateConfig(
  machineId: number,
  productModelId?: number | null,
): Promise<AiQualityGateConfig | null> {
  const key = configKey(machineId, productModelId);
  const cached = configCache.get(key);
  if (cached && Date.now() - cached.ts < CONFIG_TTL) return cached.config;

  const db = await getDb();
  if (!db) return null;

  // Try machine + product first
  if (productModelId) {
    const [exact] = await db
      .select()
      .from(aiQualityGateConfigs)
      .where(
        and(
          eq(aiQualityGateConfigs.machineId, machineId),
          eq(aiQualityGateConfigs.productModelId, productModelId),
          eq(aiQualityGateConfigs.enabled, true),
        ),
      )
      .limit(1);
    if (exact) {
      configCache.set(key, { config: exact, ts: Date.now() });
      return exact;
    }
  }

  // Fallback: machine only
  const [machineOnly] = await db
    .select()
    .from(aiQualityGateConfigs)
    .where(
      and(
        eq(aiQualityGateConfigs.machineId, machineId),
        sql`${aiQualityGateConfigs.productModelId} IS NULL`,
        eq(aiQualityGateConfigs.enabled, true),
      ),
    )
    .limit(1);

  if (machineOnly) {
    configCache.set(key, { config: machineOnly, ts: Date.now() });
    return machineOnly;
  }

  return null;
}

/** Invalidate config cache for a specific machine or all */
export function invalidateConfigCache(machineId?: number) {
  if (machineId == null) {
    configCache.clear();
    return;
  }
  for (const key of configCache.keys()) {
    if (key.startsWith(`${machineId}:`)) configCache.delete(key);
  }
}

// ─── Ensemble Logic ──────────────────────────────────────────────

async function runEnsembleInference(
  ensembleConfig: AiEnsembleConfig,
  imageBuffer: Buffer,
  options?: { inspectionId?: number },
) {
  const modelIds = ensembleConfig.modelIds;
  const weights = ensembleConfig.weights ?? modelIds.map(() => 1);

  // Run all models in parallel
  const results = await Promise.allSettled(
    modelIds.map((modelId) =>
      runInference(modelId, imageBuffer, {
        inspectionId: options?.inspectionId,
      }),
    ),
  );

  const successResults: Array<{
    modelId: number;
    modelCode: string;
    topLabel: string;
    confidence: number;
    predictions: Array<{ label: string; confidence: number }>;
  }> = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      successResults.push({
        modelId: modelIds[i],
        modelCode: r.value.modelCode,
        topLabel: r.value.topLabel ?? "",
        confidence: r.value.confidence,
        predictions: r.value.predictions.map((p) => ({
          label: p.label,
          confidence: p.confidence,
        })),
      });
    }
  }

  if (successResults.length === 0) {
    throw new Error("All ensemble models failed");
  }

  let finalLabel: string;
  let finalConfidence: number;

  switch (ensembleConfig.strategy) {
    case "WEIGHTED_AVERAGE": {
      // Weighted average of confidence scores per label
      const labelScores: Record<string, number> = {};
      let totalWeight = 0;
      for (let i = 0; i < successResults.length; i++) {
        const idx = modelIds.indexOf(successResults[i].modelId);
        const w = weights[idx] ?? 1;
        totalWeight += w;
        for (const pred of successResults[i].predictions) {
          labelScores[pred.label] = (labelScores[pred.label] ?? 0) + pred.confidence * w;
        }
      }
      // Normalize
      for (const key of Object.keys(labelScores)) {
        labelScores[key] /= totalWeight;
      }
      const sorted = Object.entries(labelScores).sort((a, b) => b[1] - a[1]);
      finalLabel = sorted[0]?.[0] ?? "";
      finalConfidence = sorted[0]?.[1] ?? 0;
      break;
    }

    case "CASCADE": {
      // Use first model; if confidence < threshold, try next
      const cascadeThreshold = Number(ensembleConfig.cascadeThreshold ?? 0.8);
      let chosen = successResults[0];
      for (const r of successResults) {
        chosen = r;
        if (r.confidence >= cascadeThreshold) break;
      }
      finalLabel = chosen.topLabel;
      finalConfidence = chosen.confidence;
      break;
    }

    case "VOTING":
    default: {
      // Majority voting
      const votes: Record<string, number> = {};
      const maxConfByLabel: Record<string, number> = {};
      for (const r of successResults) {
        votes[r.topLabel] = (votes[r.topLabel] ?? 0) + 1;
        maxConfByLabel[r.topLabel] = Math.max(
          maxConfByLabel[r.topLabel] ?? 0,
          r.confidence,
        );
      }
      const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
      finalLabel = sorted[0]?.[0] ?? "";
      finalConfidence = maxConfByLabel[finalLabel] ?? 0;
      break;
    }
  }

  return {
    topLabel: finalLabel,
    confidence: finalConfidence,
    predictions: Object.entries(
      successResults.reduce(
        (acc, r) => {
          for (const p of r.predictions) {
            acc[p.label] = Math.max(acc[p.label] ?? 0, p.confidence);
          }
          return acc;
        },
        {} as Record<string, number>,
      ),
    )
      .map(([label, confidence]) => ({ label, confidence }))
      .sort((a, b) => b.confidence - a.confidence),
    ensembleResults: successResults,
  };
}

// ─── Core Quality Gate ───────────────────────────────────────────

/**
 * Process a single inspection through the AI Quality Gate.
 */
export async function processQualityGate(
  inspectionId: number,
  imageBuffer: Buffer,
  config: AiQualityGateConfig,
): Promise<QualityGateDecision> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const autoOk = Number(config.autoOkThreshold);
  const autoNg = Number(config.autoNgThreshold);
  const reviewTh = Number(config.reviewThreshold);
  const ngLabels = config.ngLabels ?? [];
  const okLabels = config.okLabels ?? [];

  let topLabel: string;
  let confidence: number;
  let predictions: Array<{ label: string; confidence: number }>;
  let ensembleResults: QualityGateDecision["ensembleResults"] | undefined;

  // If ensemble config, use ensemble; otherwise single model
  if (config.ensembleConfigId) {
    const [ensConfig] = await db
      .select()
      .from(aiEnsembleConfigs)
      .where(
        and(
          eq(aiEnsembleConfigs.id, config.ensembleConfigId),
          eq(aiEnsembleConfigs.enabled, true),
        ),
      )
      .limit(1);

    if (ensConfig) {
      const result = await runEnsembleInference(ensConfig, imageBuffer, {
        inspectionId,
      });
      topLabel = result.topLabel;
      confidence = result.confidence;
      predictions = result.predictions;
      ensembleResults = result.ensembleResults;
    } else {
      // Fallback to single model
      const result = await runInference(config.modelId, imageBuffer, {
        inspectionId,
      });
      topLabel = result.topLabel ?? "";
      confidence = result.confidence;
      predictions = result.predictions.map((p) => ({
        label: p.label,
        confidence: p.confidence,
      }));
    }
  } else {
    const result = await runInference(config.modelId, imageBuffer, {
      inspectionId,
    });
    topLabel = result.topLabel ?? "";
    confidence = result.confidence;
    predictions = result.predictions.map((p) => ({
      label: p.label,
      confidence: p.confidence,
    }));
  }

  // Determine decision
  const isNgLabel = ngLabels.length > 0 && ngLabels.includes(topLabel);
  const isOkLabel = okLabels.length > 0 && okLabels.includes(topLabel);

  let decision: QualityGateDecision["decision"];
  let reviewReason: string | undefined;

  if (isNgLabel && confidence >= autoNg) {
    decision = "AUTO_NG";
  } else if (isOkLabel && confidence >= autoOk) {
    decision = "AUTO_OK";
  } else if (!isNgLabel && !isOkLabel && confidence >= autoOk) {
    // No label config — rely purely on confidence
    decision = "AUTO_OK";
  } else if (confidence < reviewTh) {
    decision = "NEEDS_REVIEW";
    reviewReason = `Low confidence (${(confidence * 100).toFixed(1)}% < ${(reviewTh * 100).toFixed(1)}%)`;
  } else if (isNgLabel && confidence < autoNg) {
    decision = "NEEDS_REVIEW";
    reviewReason = `NG label "${topLabel}" below threshold (${(confidence * 100).toFixed(1)}% < ${(autoNg * 100).toFixed(1)}%)`;
  } else {
    decision = "NEEDS_REVIEW";
    reviewReason = `Confidence in grey zone (${(confidence * 100).toFixed(1)}%)`;
  }

  const processingTimeMs = Date.now() - startTime;

  // Save quality gate result
  await db.insert(aiQualityGateResults).values({
    inspectionId,
    configId: config.id,
    decision,
    confidence: confidence.toFixed(4),
    topLabel,
    predictions,
    ensembleResults,
    processingTimeMs,
  });

  // Update inspection with AI fields
  await db
    .update(productInspections)
    .set({
      aiDecision: decision,
      aiConfidence: confidence.toFixed(4),
      aiModelId: config.modelId,
      aiProcessedAt: new Date(),
      aiDetails: {
        predictions,
        ensembleResults,
        processingTimeMs,
        reviewReason,
      },
    })
    .where(eq(productInspections.id, inspectionId));

  return {
    decision,
    confidence,
    topLabel,
    predictions,
    ensembleResults,
    processingTimeMs,
    reviewReason,
  };
}

// ─── Statistics ──────────────────────────────────────────────────

export interface QualityGateStats {
  total: number;
  autoOk: number;
  autoNg: number;
  needsReview: number;
  manual: number;
  avgConfidence: number;
  avgProcessingTimeMs: number;
}

export async function getQualityGateStats(options: {
  configId?: number;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<QualityGateStats> {
  const db = await getDb();
  if (!db) return { total: 0, autoOk: 0, autoNg: 0, needsReview: 0, manual: 0, avgConfidence: 0, avgProcessingTimeMs: 0 };

  let query = sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE decision = 'AUTO_OK')::int as "autoOk",
      COUNT(*) FILTER (WHERE decision = 'AUTO_NG')::int as "autoNg",
      COUNT(*) FILTER (WHERE decision = 'NEEDS_REVIEW')::int as "needsReview",
      COUNT(*) FILTER (WHERE decision = 'MANUAL')::int as manual,
      COALESCE(AVG(confidence::numeric), 0)::float as "avgConfidence",
      COALESCE(AVG("processingTimeMs"), 0)::float as "avgProcessingTimeMs"
    FROM ai_quality_gate_results
    WHERE 1=1
  `;

  if (options.configId) {
    query = sql`${query} AND "configId" = ${options.configId}`;
  }
  if (options.startDate) {
    query = sql`${query} AND "createdAt" >= ${options.startDate}`;
  }
  if (options.endDate) {
    query = sql`${query} AND "createdAt" <= ${options.endDate}`;
  }

  if (options.machineId) {
    query = sql`${query} AND "inspectionId" IN (
      SELECT id FROM product_inspections WHERE "machineId" = ${options.machineId}
    )`;
  }

  const result = await db.execute(query) as any;
  const row = result.rows?.[0];
  if (!row) return { total: 0, autoOk: 0, autoNg: 0, needsReview: 0, manual: 0, avgConfidence: 0, avgProcessingTimeMs: 0 };

  return {
    total: row.total ?? 0,
    autoOk: row.autoOk ?? 0,
    autoNg: row.autoNg ?? 0,
    needsReview: row.needsReview ?? 0,
    manual: row.manual ?? 0,
    avgConfidence: row.avgConfidence ?? 0,
    avgProcessingTimeMs: row.avgProcessingTimeMs ?? 0,
  };
}
