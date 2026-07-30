import { getDb } from "../db/connection";
import { aiLabelQueue, aiImageEmbeddings } from "../../drizzle/schema";
import { eq, and, desc, asc, sql, SQL, inArray, lte, gte } from "drizzle-orm";
import { runInference } from "./aiInferenceEngine";
import { getAiModels } from "../db/ai";
import { extractEmbedding } from "./aiImageEmbedding";
import type { InsertAiLabelQueue } from "../../drizzle/schema";

// ─── Configuration ───────────────────────────────────────────────────────────

interface AutoLabelConfig {
  autoAcceptThreshold: number;   // >= this → AUTO_LABELED (default 0.95)
  reviewThreshold: number;       // >= this but < autoAccept → IN_REVIEW (default 0.5)
  expertThreshold: number;       // < this → EXPERT_REQUIRED (implicit)
  maxBatchSize: number;          // max images per auto-label run
}

const DEFAULT_CONFIG: AutoLabelConfig = {
  autoAcceptThreshold: 0.95,
  reviewThreshold: 0.5,
  expertThreshold: 0.5,
  maxBatchSize: 100,
};

// ─── Auto-Label Pipeline ─────────────────────────────────────────────────────

/**
 * Run auto-labeling on a batch of images using a specified model.
 * Routes each image to AUTO_LABELED, IN_REVIEW, or EXPERT_REQUIRED based on confidence.
 */
export async function autoLabelImages(
  modelId: number,
  images: Array<{
    imageBuffer: Buffer;
    imageUrl: string;
    inspectionId?: number;
    measurementResultId?: number;
    machineId?: number;
    productModelId?: number;
    defectType?: string;
  }>,
  config?: Partial<AutoLabelConfig>,
): Promise<{
  total: number;
  autoLabeled: number;
  forReview: number;
  forExpert: number;
  results: Array<{ imageUrl: string; status: string; label: string | null; confidence: number }>;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const batch = images.slice(0, cfg.maxBatchSize);

  const results: Array<{ imageUrl: string; status: string; label: string | null; confidence: number }> = [];
  let autoLabeled = 0;
  let forReview = 0;
  let forExpert = 0;

  for (const img of batch) {
    try {
      const inference = await runInference(modelId, img.imageBuffer, {
        inspectionId: img.inspectionId,
        measurementResultId: img.measurementResultId,
      });

      const confidence = inference.confidence;
      const topLabel = inference.topLabel;

      // Entropy-based uncertainty: H = -Σ p_i * log2(p_i) / log2(n_classes)
      // Normalized to [0, 1]; outperforms margin sampling (1-conf) when multiple
      // classes have similar probabilities (e.g. BGA tombstone vs. offset).
      const probs = inference.predictions?.map(p => p.confidence) ?? [confidence, 1 - confidence];
      const nClasses = Math.max(probs.length, 2);
      const entropy = probs.reduce((h, p) => (p > 0 ? h - p * Math.log2(p) : h), 0);
      const uncertainty = entropy / Math.log2(nClasses); // normalized 0–1

      // Route by confidence thresholds
      let status: "AUTO_LABELED" | "IN_REVIEW" | "EXPERT_REQUIRED";
      if (confidence >= cfg.autoAcceptThreshold) {
        status = "AUTO_LABELED";
        autoLabeled++;
      } else if (confidence >= cfg.reviewThreshold) {
        status = "IN_REVIEW";
        forReview++;
      } else {
        status = "EXPERT_REQUIRED";
        forExpert++;
      }

      // Priority: lower confidence = higher urgency
      const priority = Math.round((1 - confidence) * 100);

      const queueEntry: InsertAiLabelQueue = {
        imageUrl: img.imageUrl,
        modelId,
        predictedLabel: topLabel,
        confidence: confidence.toFixed(4),
        predictions: inference.predictions.map(p => ({
          label: p.label,
          confidence: p.confidence,
        })),
        uncertainty: uncertainty.toFixed(4),
        samplingStrategy: "UNCERTAINTY",
        priority,
        status,
        inspectionId: img.inspectionId,
        measurementResultId: img.measurementResultId,
        machineId: img.machineId,
        productModelId: img.productModelId,
        defectType: img.defectType,
      };

      await db.insert(aiLabelQueue).values(queueEntry);

      results.push({ imageUrl: img.imageUrl, status, label: topLabel, confidence });
    } catch {
      results.push({ imageUrl: img.imageUrl, status: "ERROR", label: null, confidence: 0 });
    }
  }

  return {
    total: batch.length,
    autoLabeled,
    forReview,
    forExpert,
    results,
  };
}

// ─── Review Queue ────────────────────────────────────────────────────────────

/**
 * Get the review queue sorted by priority (highest uncertainty first).
 */
export async function getReviewQueue(options?: {
  status?: string;
  machineId?: number;
  productModelId?: number;
  assignedTo?: number;
  limit?: number;
  offset?: number;
}): Promise<Array<typeof aiLabelQueue.$inferSelect>> {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [];

  if (options?.status) {
    conditions.push(eq(aiLabelQueue.status, options.status as any));
  } else {
    // Default: show items needing review
    conditions.push(
      inArray(aiLabelQueue.status, ["PENDING", "IN_REVIEW", "EXPERT_REQUIRED"]),
    );
  }

  if (options?.machineId) conditions.push(eq(aiLabelQueue.machineId, options.machineId));
  if (options?.productModelId) conditions.push(eq(aiLabelQueue.productModelId, options.productModelId));
  if (options?.assignedTo) conditions.push(eq(aiLabelQueue.assignedTo, options.assignedTo));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(aiLabelQueue)
    .where(where)
    .orderBy(desc(aiLabelQueue.priority), asc(aiLabelQueue.createdAt))
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0);
}

// ─── Human Label Submission ──────────────────────────────────────────────────

/**
 * Submit a human label for a queue item. Moves it to LABELED status.
 */
export async function submitHumanLabel(
  queueId: number,
  humanLabel: string,
  reviewedBy: number,
  reviewNotes?: string,
): Promise<typeof aiLabelQueue.$inferSelect | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [updated] = await db
    .update(aiLabelQueue)
    .set({
      humanLabel,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes,
      status: "LABELED",
    })
    .where(eq(aiLabelQueue.id, queueId))
    .returning();

  return updated ?? null;
}

/**
 * Skip a queue item (e.g. poor image quality).
 */
export async function skipQueueItem(
  queueId: number,
  reviewedBy: number,
  reason?: string,
): Promise<typeof aiLabelQueue.$inferSelect | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [updated] = await db
    .update(aiLabelQueue)
    .set({
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: reason,
      status: "SKIPPED",
    })
    .where(eq(aiLabelQueue.id, queueId))
    .returning();

  return updated ?? null;
}

/**
 * Assign queue items to a reviewer.
 */
export async function assignToReviewer(
  queueIds: number[],
  assignedTo: number,
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .update(aiLabelQueue)
    .set({ assignedTo })
    .where(inArray(aiLabelQueue.id, queueIds));

  return (result as any).rowCount ?? queueIds.length;
}

// ─── Sampling Strategies ─────────────────────────────────────────────────────

/**
 * Uncertainty Sampling: select items with highest uncertainty (lowest confidence).
 */
export async function runUncertaintySampling(
  limit: number = 20,
  machineId?: number,
  productModelId?: number,
): Promise<Array<typeof aiLabelQueue.$inferSelect>> {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [
    inArray(aiLabelQueue.status, ["PENDING", "IN_REVIEW", "EXPERT_REQUIRED"]),
  ];
  if (machineId) conditions.push(eq(aiLabelQueue.machineId, machineId));
  if (productModelId) conditions.push(eq(aiLabelQueue.productModelId, productModelId));

  return db
    .select()
    .from(aiLabelQueue)
    .where(and(...conditions))
    .orderBy(desc(aiLabelQueue.uncertainty))
    .limit(limit);
}

/**
 * Diversity Sampling: select items that are most different from each other
 * using image embeddings from pgvector.
 */
export async function runDiversitySampling(
  limit: number = 20,
  machineId?: number,
): Promise<Array<{ queueId: number; imageUrl: string; diversityScore: number }>> {
  const db = await getDb();
  if (!db) return [];

  // Get pending queue items that have embeddings
  const conditions: SQL[] = [
    inArray(aiLabelQueue.status, ["PENDING", "IN_REVIEW", "EXPERT_REQUIRED"]),
  ];
  if (machineId) conditions.push(eq(aiLabelQueue.machineId, machineId));

  const queueItems = await db
    .select()
    .from(aiLabelQueue)
    .where(and(...conditions))
    .orderBy(desc(aiLabelQueue.priority))
    .limit(200); // Get a pool to sample from

  if (queueItems.length === 0) return [];

  // Batch-fetch embeddings for ALL candidate images in ONE query (fixes N+1)
  const imageUrls = queueItems.map(q => q.imageUrl);
  const embeddings = await db
    .select({ id: aiImageEmbeddings.id, imageUrl: aiImageEmbeddings.imageUrl })
    .from(aiImageEmbeddings)
    .where(inArray(aiImageEmbeddings.imageUrl, imageUrls));

  if (embeddings.length === 0) return [];

  // Build a lookup: imageUrl → embedding id
  const urlToEmbId = new Map(embeddings.map(e => [e.imageUrl, e.id]));
  const candidateEmbIds = embeddings.map(e => e.id);

  // One SQL query: for each candidate embedding, compute avg cosine distance
  // to all labeled embeddings (diversity = low similarity to what's already labeled).
  const diversityRows = await db.execute(
    sql`SELECT e1.id            AS candidate_id,
               e1."imageUrl"   AS image_url,
               AVG(1 - (e1.embedding <=> e2.embedding)) AS avg_similarity
        FROM ${aiImageEmbeddings} e1
        JOIN ${aiImageEmbeddings} e2
          ON e2.label IS NOT NULL
         AND e2.id != e1.id
        WHERE e1.id = ANY(${sql`ARRAY[${sql.join(candidateEmbIds.map((id) => sql`${id}`), sql`,`)}]`}::int[])
        GROUP BY e1.id, e1."imageUrl"`,
  ) as any;

  // Map results back to queue items
  const scoreByEmbId = new Map<number, number>(
    (diversityRows.rows ?? []).map((r: any) => [
      Number(r.candidate_id),
      1 - parseFloat(r.avg_similarity ?? "0.5"), // diversity = 1 - similarity
    ])
  );

  const diversityScores: Array<{ queueId: number; imageUrl: string; diversityScore: number }> = [];
  for (const item of queueItems) {
    const embId = urlToEmbId.get(item.imageUrl);
    if (!embId) continue;
    diversityScores.push({
      queueId: item.id,
      imageUrl: item.imageUrl,
      diversityScore: scoreByEmbId.get(embId) ?? 0.5, // default mid if no labeled data yet
    });
  }

  // Sort by diversity (descending) and return top N
  diversityScores.sort((a, b) => b.diversityScore - a.diversityScore);
  return diversityScores.slice(0, limit);
}

/**
 * Query-by-Committee: run multiple models and select items with highest disagreement.
 */
export async function runCommitteeSampling(
  imageBuffers: Array<{ imageUrl: string; buffer: Buffer }>,
  modelIds: number[],
  limit: number = 20,
): Promise<Array<{ imageUrl: string; disagreement: number; predictions: Array<{ modelId: number; label: string; confidence: number }> }>> {
  if (modelIds.length < 2) {
    throw new Error("Committee sampling requires at least 2 models");
  }

  const disagreements: Array<{
    imageUrl: string;
    disagreement: number;
    predictions: Array<{ modelId: number; label: string; confidence: number }>;
  }> = [];

  for (const img of imageBuffers) {
    const committeePredictions: Array<{ modelId: number; label: string; confidence: number }> = [];

    for (const modelId of modelIds) {
      try {
        const result = await runInference(modelId, img.buffer);
        committeePredictions.push({
          modelId,
          label: result.topLabel ?? "unknown",
          confidence: result.confidence,
        });
      } catch {
        // Skip model if inference fails
      }
    }

    if (committeePredictions.length < 2) continue;

    // Calculate disagreement: count distinct labels / total votes
    const labelCounts = new Map<string, number>();
    for (const p of committeePredictions) {
      labelCounts.set(p.label, (labelCounts.get(p.label) ?? 0) + 1);
    }
    const maxAgree = Math.max(...labelCounts.values());
    const disagreement = 1 - (maxAgree / committeePredictions.length);

    disagreements.push({
      imageUrl: img.imageUrl,
      disagreement,
      predictions: committeePredictions,
    });
  }

  // Sort by disagreement (descending) and return top N
  disagreements.sort((a, b) => b.disagreement - a.disagreement);
  return disagreements.slice(0, limit);
}

// ─── Retrain Trigger ─────────────────────────────────────────────────────────

/**
 * Check whether enough new labeled data has accumulated to trigger retraining.
 */
export async function checkRetrainThreshold(
  modelId: number,
  minNewLabels: number = 50,
): Promise<{ shouldRetrain: boolean; labeledCount: number; threshold: number }> {
  const db = await getDb();
  if (!db) return { shouldRetrain: false, labeledCount: 0, threshold: minNewLabels };

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiLabelQueue)
    .where(
      and(
        eq(aiLabelQueue.modelId, modelId),
        inArray(aiLabelQueue.status, ["LABELED", "AUTO_LABELED"]),
      ),
    );

  const labeledCount = Number(result[0]?.count ?? 0);

  return {
    shouldRetrain: labeledCount >= minNewLabels,
    labeledCount,
    threshold: minNewLabels,
  };
}

/**
 * Get statistics for the active learning system.
 */
export async function getActiveLearningStats(options?: {
  modelId?: number;
  machineId?: number;
}): Promise<{
  total: number;
  pending: number;
  inReview: number;
  labeled: number;
  autoLabeled: number;
  expertRequired: number;
  skipped: number;
  avgConfidence: number;
  avgUncertainty: number;
}> {
  const db = await getDb();
  if (!db) return {
    total: 0, pending: 0, inReview: 0, labeled: 0,
    autoLabeled: 0, expertRequired: 0, skipped: 0,
    avgConfidence: 0, avgUncertainty: 0,
  };

  const conditions: SQL[] = [];
  if (options?.modelId) conditions.push(eq(aiLabelQueue.modelId, options.modelId));
  if (options?.machineId) conditions.push(eq(aiLabelQueue.machineId, options.machineId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select({
      total: sql<number>`count(*)`,
      pending: sql<number>`count(*) filter (where ${aiLabelQueue.status} = 'PENDING')`,
      inReview: sql<number>`count(*) filter (where ${aiLabelQueue.status} = 'IN_REVIEW')`,
      labeled: sql<number>`count(*) filter (where ${aiLabelQueue.status} = 'LABELED')`,
      autoLabeled: sql<number>`count(*) filter (where ${aiLabelQueue.status} = 'AUTO_LABELED')`,
      expertRequired: sql<number>`count(*) filter (where ${aiLabelQueue.status} = 'EXPERT_REQUIRED')`,
      skipped: sql<number>`count(*) filter (where ${aiLabelQueue.status} = 'SKIPPED')`,
      avgConfidence: sql<number>`avg(${aiLabelQueue.confidence}::numeric)`,
      avgUncertainty: sql<number>`avg(${aiLabelQueue.uncertainty}::numeric)`,
    })
    .from(aiLabelQueue)
    .where(where);

  const row = result[0];
  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    inReview: Number(row?.inReview ?? 0),
    labeled: Number(row?.labeled ?? 0),
    autoLabeled: Number(row?.autoLabeled ?? 0),
    expertRequired: Number(row?.expertRequired ?? 0),
    skipped: Number(row?.skipped ?? 0),
    avgConfidence: Number(Number(row?.avgConfidence ?? 0).toFixed(4)),
    avgUncertainty: Number(Number(row?.avgUncertainty ?? 0).toFixed(4)),
  };
}

/**
 * Get accuracy comparison: how much does the model's predictions match the human labels?
 */
export async function getLabelAccuracy(
  modelId: number,
): Promise<{
  totalLabeled: number;
  correctPredictions: number;
  accuracy: number;
  confusionSummary: Array<{ predicted: string; actual: string; count: number }>;
}> {
  const db = await getDb();
  if (!db) return { totalLabeled: 0, correctPredictions: 0, accuracy: 0, confusionSummary: [] };

  // Get items where human labeled AND model predicted
  const items = await db
    .select({
      predictedLabel: aiLabelQueue.predictedLabel,
      humanLabel: aiLabelQueue.humanLabel,
    })
    .from(aiLabelQueue)
    .where(
      and(
        eq(aiLabelQueue.modelId, modelId),
        eq(aiLabelQueue.status, "LABELED"),
      ),
    );

  const validItems = items.filter(i => i.predictedLabel && i.humanLabel);
  const totalLabeled = validItems.length;
  const correctPredictions = validItems.filter(i => i.predictedLabel === i.humanLabel).length;
  const accuracy = totalLabeled > 0 ? correctPredictions / totalLabeled : 0;

  // Build confusion summary
  const confusionMap = new Map<string, number>();
  for (const item of validItems) {
    const key = `${item.predictedLabel}→${item.humanLabel}`;
    confusionMap.set(key, (confusionMap.get(key) ?? 0) + 1);
  }

  const confusionSummary = Array.from(confusionMap.entries()).map(([key, count]) => {
    const [predicted, actual] = key.split("→");
    return { predicted: predicted!, actual: actual!, count };
  });

  return { totalLabeled, correctPredictions, accuracy, confusionSummary };
}
