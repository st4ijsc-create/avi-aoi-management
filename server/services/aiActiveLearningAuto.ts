/**
 * AI Active Learning — Automatic Scanners (WS-1)
 *
 * Closes the loop's first hop: instead of requiring a manual auto-label call,
 * these scanners sweep completed inference results, score uncertainty (entropy)
 * or committee disagreement, and enqueue the hardest images into
 * `ai_label_queue` for human labeling.
 *
 * IDEMPOTENT: before inserting, we check whether a queue row already exists for
 * the same (modelId, inspectionId, measurementResultId). Running a scan twice
 * does NOT duplicate rows. A partial unique index (migration 0104) is the DB
 * backstop; this code-level guard keeps it correct even before migration.
 *
 * Offline-first: only DB access, no network.
 */

import { getDb } from "../db/connection";
import {
  inferenceResults,
  aiLabelQueue,
  type InsertAiLabelQueue,
} from "../../drizzle/schema";
import { eq, and, inArray, gte, isNotNull, sql, desc } from "drizzle-orm";
import { normalizedEntropy } from "./aiMetrics";

export interface UncertaintyScanOptions {
  modelId: number;
  /** Min normalized entropy to enqueue (default 0.5). */
  uncertaintyThreshold?: number;
  /** Only scan inference rows newer than this. */
  since?: Date;
  /** Max rows to enqueue per run. */
  maxItems?: number;
}

export interface ScanResult {
  scanned: number;
  enqueued: number;
  skippedExisting: number;
  belowThreshold: number;
}

/**
 * Check whether a queue row already exists for this (model, inspection,
 * measurement) tuple. Uses IS NOT DISTINCT FROM so NULLs compare equal.
 */
async function queueRowExists(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  modelId: number,
  inspectionId: number | null,
  measurementResultId: number | null,
): Promise<boolean> {
  const [row] = await db
    .select({ id: aiLabelQueue.id })
    .from(aiLabelQueue)
    .where(and(
      eq(aiLabelQueue.modelId, modelId),
      sql`${aiLabelQueue.inspectionId} is not distinct from ${inspectionId}`,
      sql`${aiLabelQueue.measurementResultId} is not distinct from ${measurementResultId}`,
    ))
    .limit(1);
  return !!row;
}

/**
 * Scan COMPLETED inference_results for a model, compute entropy-based
 * uncertainty from the prediction distribution, and enqueue images at/above the
 * threshold into ai_label_queue with samplingStrategy = UNCERTAINTY.
 */
export async function scanInferenceForUncertainty(
  options: UncertaintyScanOptions,
): Promise<ScanResult> {
  const db = await getDb();
  if (!db) return { scanned: 0, enqueued: 0, skippedExisting: 0, belowThreshold: 0 };

  const threshold = options.uncertaintyThreshold ?? 0.5;
  const maxItems = options.maxItems ?? 200;

  const conds = [
    eq(inferenceResults.modelId, options.modelId),
    eq(inferenceResults.status, "COMPLETED"),
    isNotNull(inferenceResults.inputReference),
  ];
  if (options.since) conds.push(gte(inferenceResults.createdAt, options.since));

  const rows = await db.select({
    inspectionId: inferenceResults.inspectionId,
    measurementResultId: inferenceResults.measurementResultId,
    inputReference: inferenceResults.inputReference,
    predictions: inferenceResults.predictions,
    topLabel: inferenceResults.topLabel,
    confidence: inferenceResults.confidence,
  })
    .from(inferenceResults)
    .where(and(...conds))
    .orderBy(desc(inferenceResults.createdAt))
    .limit(2000);

  let scanned = 0;
  let enqueued = 0;
  let skippedExisting = 0;
  let belowThreshold = 0;

  for (const row of rows) {
    if (enqueued >= maxItems) break;
    scanned++;
    if (!row.inputReference) continue;

    const probs = (row.predictions ?? []).map(p => p.confidence);
    const uncertainty = probs.length >= 1
      ? normalizedEntropy(probs)
      : (row.confidence != null ? normalizedEntropy([Number(row.confidence), 1 - Number(row.confidence)]) : 0);

    if (uncertainty < threshold) { belowThreshold++; continue; }

    const exists = await queueRowExists(db, options.modelId, row.inspectionId, row.measurementResultId);
    if (exists) { skippedExisting++; continue; }

    const entry: InsertAiLabelQueue = {
      imageUrl: row.inputReference,
      modelId: options.modelId,
      predictedLabel: row.topLabel,
      confidence: row.confidence != null ? String(row.confidence) : null,
      predictions: (row.predictions ?? []).map(p => ({ label: p.label, confidence: p.confidence })),
      uncertainty: uncertainty.toFixed(4),
      samplingStrategy: "UNCERTAINTY",
      priority: Math.round(uncertainty * 100),
      status: "PENDING",
      inspectionId: row.inspectionId,
      measurementResultId: row.measurementResultId,
    };

    try {
      await db.insert(aiLabelQueue).values(entry);
      enqueued++;
    } catch {
      // Unique-index race → treat as already existing.
      skippedExisting++;
    }
  }

  return { scanned, enqueued, skippedExisting, belowThreshold };
}

export interface CommitteeScanOptions {
  /** Models in the committee (>= 2). The first is the "owner" model for the queue row. */
  modelIds: number[];
  /** Min disagreement (fraction of dissenting votes) to enqueue (default 0.5). */
  disagreementThreshold?: number;
  since?: Date;
  maxItems?: number;
}

/**
 * Scan inference_results across an ensemble of models for the SAME image
 * (matched by inputReference), compute label disagreement, and enqueue
 * high-disagreement images with samplingStrategy = COMMITTEE, recording
 * ensembleDisagreement + ensemblePredictions.
 */
export async function scanCommitteeDisagreement(
  options: CommitteeScanOptions,
): Promise<ScanResult> {
  const db = await getDb();
  if (!db) return { scanned: 0, enqueued: 0, skippedExisting: 0, belowThreshold: 0 };
  if (options.modelIds.length < 2) {
    throw new Error("Committee scan requires at least 2 models");
  }

  const threshold = options.disagreementThreshold ?? 0.5;
  const maxItems = options.maxItems ?? 200;
  const ownerModelId = options.modelIds[0]!;

  const conds = [
    inArray(inferenceResults.modelId, options.modelIds),
    eq(inferenceResults.status, "COMPLETED"),
    isNotNull(inferenceResults.inputReference),
  ];
  if (options.since) conds.push(gte(inferenceResults.createdAt, options.since));

  const rows = await db.select({
    modelId: inferenceResults.modelId,
    inspectionId: inferenceResults.inspectionId,
    measurementResultId: inferenceResults.measurementResultId,
    inputReference: inferenceResults.inputReference,
    topLabel: inferenceResults.topLabel,
    confidence: inferenceResults.confidence,
  })
    .from(inferenceResults)
    .where(and(...conds))
    .orderBy(desc(inferenceResults.createdAt))
    .limit(5000);

  // Group by image (inputReference). Keep latest prediction per model per image.
  interface Group {
    inputReference: string;
    inspectionId: number | null;
    measurementResultId: number | null;
    byModel: Map<number, { label: string; confidence: number }>;
  }
  const groups = new Map<string, Group>();
  for (const row of rows) {
    if (!row.inputReference) continue;
    let g = groups.get(row.inputReference);
    if (!g) {
      g = {
        inputReference: row.inputReference,
        inspectionId: row.inspectionId,
        measurementResultId: row.measurementResultId,
        byModel: new Map(),
      };
      groups.set(row.inputReference, g);
    }
    if (!g.byModel.has(row.modelId)) {
      g.byModel.set(row.modelId, {
        label: row.topLabel ?? "unknown",
        confidence: row.confidence != null ? Number(row.confidence) : 0,
      });
    }
  }

  let scanned = 0;
  let enqueued = 0;
  let skippedExisting = 0;
  let belowThreshold = 0;

  for (const g of groups.values()) {
    if (enqueued >= maxItems) break;
    scanned++;
    const votes = Array.from(g.byModel.entries());
    if (votes.length < 2) continue;

    const labelCounts = new Map<string, number>();
    for (const [, v] of votes) labelCounts.set(v.label, (labelCounts.get(v.label) ?? 0) + 1);
    const maxAgree = Math.max(...labelCounts.values());
    const disagreement = 1 - maxAgree / votes.length;

    if (disagreement < threshold) { belowThreshold++; continue; }

    const exists = await queueRowExists(db, ownerModelId, g.inspectionId, g.measurementResultId);
    if (exists) { skippedExisting++; continue; }

    const ensemblePredictions = votes.map(([modelId, v]) => ({ modelId, label: v.label, confidence: v.confidence }));

    const entry: InsertAiLabelQueue = {
      imageUrl: g.inputReference,
      modelId: ownerModelId,
      ensembleDisagreement: disagreement.toFixed(4),
      ensemblePredictions,
      samplingStrategy: "COMMITTEE",
      priority: Math.round(disagreement * 100),
      status: "PENDING",
      inspectionId: g.inspectionId,
      measurementResultId: g.measurementResultId,
    };

    try {
      await db.insert(aiLabelQueue).values(entry);
      enqueued++;
    } catch {
      skippedExisting++;
    }
  }

  return { scanned, enqueued, skippedExisting, belowThreshold };
}
