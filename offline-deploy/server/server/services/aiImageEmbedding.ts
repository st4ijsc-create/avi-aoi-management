import * as ort from "onnxruntime-node";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { getDb } from "../db/connection";
import { aiImageEmbeddings } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getAiModelById } from "../db/ai";
import type { AiModel } from "../../drizzle/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  embedding: number[];
  dim: number;
  modelCode: string;
  processingTimeMs: number;
}

export interface SimilarImage {
  id: number;
  inspectionId: number | null;
  measurementResultId: number | null;
  imageUrl: string;
  label: string | null;
  defectType: string | null;
  machineId: number | null;
  productModelId: number | null;
  similarity: number;
  createdAt: Date;
}

export interface ClusterResult {
  clusterId: number;
  centroidImageId: number;
  memberCount: number;
  members: Array<{
    id: number;
    imageUrl: string;
    label: string | null;
    similarity: number;
  }>;
}

// ─── Session Cache (separate from inference engine) ──────────────────────────

const embeddingSessionCache = new Map<string, ort.InferenceSession>();

async function getEmbeddingSession(model: AiModel): Promise<ort.InferenceSession> {
  const cacheKey = `emb:${model.id}:${model.currentVersion}`;
  const cached = embeddingSessionCache.get(cacheKey);
  if (cached) return cached;

  if (!model.filePath) throw new Error(`Model ${model.code} has no file path`);

  let modelPath = model.filePath;
  if (modelPath.startsWith("/uploads/")) {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");
    modelPath = path.join(uploadsRoot, modelPath.replace("/uploads/", ""));
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Embedding model file not found: ${modelPath}`);
  }

  const providers: string[] = [];
  if (process.env.ENABLE_CUDA === "true") providers.push("cuda");
  providers.push("cpu");

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: providers,
    graphOptimizationLevel: "all",
  });

  embeddingSessionCache.set(cacheKey, session);
  return session;
}

export function evictEmbeddingSessionCache(modelId: number) {
  for (const [key] of embeddingSessionCache) {
    if (key.startsWith(`emb:${modelId}:`)) {
      embeddingSessionCache.delete(key);
    }
  }
}

// ─── Image Preprocessing ─────────────────────────────────────────────────────

async function preprocessForEmbedding(
  imageBuffer: Buffer,
  config: NonNullable<AiModel["preprocessConfig"]>,
): Promise<Float32Array> {
  const width = config.resize?.width ?? 224;
  const height = config.resize?.height ?? 224;
  const channels = config.colorSpace === "GRAY" ? 1 : 3;

  let pipeline = sharp(imageBuffer).resize(width, height);
  if (config.colorSpace === "GRAY") {
    pipeline = pipeline.grayscale();
  }
  const raw = await pipeline.removeAlpha().raw().toBuffer();

  const mean = config.normalize?.mean ?? [0.485, 0.456, 0.406];
  const std = config.normalize?.std ?? [0.229, 0.224, 0.225];
  const totalPixels = width * height;
  const tensor = new Float32Array(channels * totalPixels);

  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < totalPixels; i++) {
      const rawIndex = i * channels + c;
      const pixelValue = raw[rawIndex] / 255.0;
      const normalized = (pixelValue - (mean[c] ?? 0)) / (std[c] ?? 1);
      tensor[c * totalPixels + i] = normalized; // channel-first
    }
  }

  return tensor;
}

// ─── Extract Embedding ───────────────────────────────────────────────────────

/**
 * Extract embedding vector from an image using an ONNX model.
 * The model should output a 1D feature vector (e.g. ResNet50 → 2048-dim,
 * EfficientNet → 1280-dim, CLIP → 512-dim).
 * 
 * If the model has an "embedding" output, it uses that.
 * Otherwise it takes the last output and flattens it.
 */
export async function extractEmbedding(
  modelId: number,
  imageBuffer: Buffer,
): Promise<EmbeddingResult> {
  const startTime = Date.now();
  const model = await getAiModelById(modelId);
  if (!model) throw new Error(`Embedding model ${modelId} not found`);
  if (model.status !== "ACTIVE") throw new Error(`Model ${model.code} is not active`);

  const session = await getEmbeddingSession(model);

  const preprocessConfig = (model.preprocessConfig as AiModel["preprocessConfig"]) ?? {
    resize: { width: 224, height: 224 },
    colorSpace: "RGB" as const,
    channelFirst: true,
  };
  const tensorData = await preprocessForEmbedding(imageBuffer, preprocessConfig);

  const inputShape = (model.inputShape as number[]) ?? [1, 3, 224, 224];
  const inputTensor = new ort.Tensor("float32", tensorData, inputShape);
  const inputName = session.inputNames[0];
  if (!inputName) throw new Error("Model has no input names");

  const results = await session.run({ [inputName]: inputTensor });

  // Try to find an "embedding" or "feature" output, otherwise use last output
  const embOutputName =
    session.outputNames.find((n) => /embed|feature|pool/i.test(n)) ??
    session.outputNames[session.outputNames.length - 1];

  const embOutput = results[embOutputName!];
  if (!embOutput) throw new Error("No embedding output found");

  const rawArray = Array.from(embOutput.data as Float32Array);

  // L2 normalize
  const norm = Math.sqrt(rawArray.reduce((sum, v) => sum + v * v, 0)) || 1;
  const embedding = rawArray.map((v) => v / norm);

  return {
    embedding,
    dim: embedding.length,
    modelCode: model.code,
    processingTimeMs: Date.now() - startTime,
  };
}

// ─── Ensure pgvector extension ───────────────────────────────────────────────

let _pgvectorChecked = false;

async function ensurePgvector() {
  if (_pgvectorChecked) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    _pgvectorChecked = true;
  } catch (e) {
    console.warn("[aiImageEmbedding] Could not create vector extension:", e);
    _pgvectorChecked = true; // don't retry every call
  }
}

// ─── Store Embedding ─────────────────────────────────────────────────────────

export async function storeEmbedding(params: {
  inspectionId?: number;
  measurementResultId?: number;
  imageUrl: string;
  embedding: number[];
  dim: number;
  modelCode: string;
  label?: string;
  confidence?: number;
  defectType?: string;
  machineId?: number;
  productModelId?: number;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await ensurePgvector();

  const embeddingStr = `[${params.embedding.join(",")}]`;

  const [row] = await db
    .insert(aiImageEmbeddings)
    .values({
      inspectionId: params.inspectionId ?? null,
      measurementResultId: params.measurementResultId ?? null,
      imageUrl: params.imageUrl,
      embedding: embeddingStr,
      embeddingDim: params.dim,
      modelCode: params.modelCode,
      label: params.label ?? null,
      confidence: params.confidence?.toFixed(4) ?? null,
      defectType: params.defectType ?? null,
      machineId: params.machineId ?? null,
      productModelId: params.productModelId ?? null,
      metadata: params.metadata ?? null,
    })
    .returning({ id: aiImageEmbeddings.id });

  return row.id;
}

// ─── Find Similar Images ─────────────────────────────────────────────────────

/**
 * Find similar images by embedding ID using cosine distance in pgvector.
 */
export async function findSimilarById(
  imageEmbeddingId: number,
  limit: number = 10,
  filters?: {
    machineId?: number;
    productModelId?: number;
    label?: string;
    minSimilarity?: number;
  },
): Promise<SimilarImage[]> {
  const db = await getDb();
  if (!db) return [];
  await ensurePgvector();

  const source = await db
    .select()
    .from(aiImageEmbeddings)
    .where(eq(aiImageEmbeddings.id, imageEmbeddingId))
    .limit(1);

  if (!source[0]) throw new Error(`Embedding ${imageEmbeddingId} not found`);

  return findSimilarByVector(
    JSON.parse(source[0].embedding) as number[],
    source[0].embeddingDim,
    limit,
    { ...filters, excludeId: imageEmbeddingId },
  );
}

/**
 * Find similar images by raw embedding vector using cosine distance.
 * Uses pgvector's <=> operator for cosine distance.
 */
export async function findSimilarByVector(
  embedding: number[],
  dim: number,
  limit: number = 10,
  filters?: {
    machineId?: number;
    productModelId?: number;
    label?: string;
    minSimilarity?: number;
    excludeId?: number;
  },
): Promise<SimilarImage[]> {
  const db = await getDb();
  if (!db) return [];
  await ensurePgvector();

  const embStr = `[${embedding.join(",")}]`;
  const minSim = filters?.minSimilarity ?? 0;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const safeDim = Math.max(1, Math.min(Number(dim) || 512, 4096));

  // Build parameterized WHERE using drizzle sql template
  const whereParts: ReturnType<typeof sql>[] = [];

  if (filters?.excludeId != null) {
    whereParts.push(sql`id != ${Number(filters.excludeId)}`);
  }
  if (filters?.machineId != null) {
    whereParts.push(sql`"machineId" = ${Number(filters.machineId)}`);
  }
  if (filters?.productModelId != null) {
    whereParts.push(sql`"productModelId" = ${Number(filters.productModelId)}`);
  }
  if (filters?.label) {
    whereParts.push(sql`"label" = ${filters.label}`);
  }

  const whereClause =
    whereParts.length > 0
      ? sql`WHERE ${sql.join(whereParts, sql` AND `)}`
      : sql``;

  // pgvector cosine distance: <=> returns distance, similarity = 1 - distance
  const query = sql`
    SELECT 
      id, "inspectionId", "measurementResultId", "imageUrl",
      "label", "defectType", "machineId", "productModelId", "createdAt",
      1 - (embedding::vector(${sql.raw(String(safeDim))}) <=> ${embStr}::vector(${sql.raw(String(safeDim))})) as similarity
    FROM ai_image_embeddings
    ${whereClause}
    ORDER BY embedding::vector(${sql.raw(String(safeDim))}) <=> ${embStr}::vector(${sql.raw(String(safeDim))})
    LIMIT ${safeLimit}
  `;

  const result = await db.execute(query) as any;
  return (result.rows as any[])
    .filter((r) => parseFloat(r.similarity) >= minSim)
    .map((r) => ({
      id: r.id,
      inspectionId: r.inspectionId,
      measurementResultId: r.measurementResultId,
      imageUrl: r.imageUrl,
      label: r.label,
      defectType: r.defectType,
      machineId: r.machineId,
      productModelId: r.productModelId,
      similarity: parseFloat(r.similarity),
      createdAt: new Date(r.createdAt),
    }));
}

/**
 * Upload image, extract embedding, find similar images.
 */
export async function searchByImage(
  modelId: number,
  imageBuffer: Buffer,
  limit: number = 10,
  filters?: {
    machineId?: number;
    productModelId?: number;
    label?: string;
    minSimilarity?: number;
  },
): Promise<{ results: SimilarImage[]; embedding: EmbeddingResult }> {
  const embResult = await extractEmbedding(modelId, imageBuffer);
  const results = await findSimilarByVector(embResult.embedding, embResult.dim, limit, filters);
  return { results, embedding: embResult };
}

// ─── Batch Embedding ─────────────────────────────────────────────────────────

/**
 * Bulk extract and store embeddings for multiple images.
 * Returns count of successfully processed images.
 */
export async function batchStoreEmbeddings(
  modelId: number,
  images: Array<{
    imageBuffer: Buffer;
    imageUrl: string;
    inspectionId?: number;
    measurementResultId?: number;
    label?: string;
    confidence?: number;
    defectType?: string;
    machineId?: number;
    productModelId?: number;
  }>,
): Promise<{ processed: number; failed: number; errors: string[] }> {
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const img of images) {
    try {
      const embResult = await extractEmbedding(modelId, img.imageBuffer);
      await storeEmbedding({
        inspectionId: img.inspectionId,
        measurementResultId: img.measurementResultId,
        imageUrl: img.imageUrl,
        embedding: embResult.embedding,
        dim: embResult.dim,
        modelCode: embResult.modelCode,
        label: img.label,
        confidence: img.confidence,
        defectType: img.defectType,
        machineId: img.machineId,
        productModelId: img.productModelId,
      });
      processed++;
    } catch (err: any) {
      failed++;
      errors.push(`${img.imageUrl}: ${err.message}`);
    }
  }

  return { processed, failed, errors };
}

// ─── Cluster Defects ─────────────────────────────────────────────────────────

/**
 * Simple greedy clustering: pick unclustered item with most neighbors,
 * form cluster from all items within similarity threshold, repeat.
 */
export async function clusterDefects(params: {
  machineId?: number;
  productModelId?: number;
  label?: string;
  minSimilarity?: number;
  maxClusters?: number;
  limit?: number;
}): Promise<ClusterResult[]> {
  const db = await getDb();
  if (!db) return [];
  await ensurePgvector();

  // Fetch all embeddings matching filters
  const conditions = [];
  if (params.machineId != null) {
    conditions.push(eq(aiImageEmbeddings.machineId, params.machineId));
  }
  if (params.productModelId != null) {
    conditions.push(eq(aiImageEmbeddings.productModelId, params.productModelId));
  }
  if (params.label) {
    conditions.push(eq(aiImageEmbeddings.label, params.label));
  }

  const queryLimit = params.limit ?? 500;
  const rows = await db
    .select({
      id: aiImageEmbeddings.id,
      imageUrl: aiImageEmbeddings.imageUrl,
      label: aiImageEmbeddings.label,
      embedding: aiImageEmbeddings.embedding,
      embeddingDim: aiImageEmbeddings.embeddingDim,
    })
    .from(aiImageEmbeddings)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(aiImageEmbeddings.createdAt))
    .limit(queryLimit);

  if (rows.length === 0) return [];

  // Parse embeddings
  const items = rows.map((r: { id: number; imageUrl: string; label: string | null; embedding: string; embeddingDim: number }) => ({
    id: r.id,
    imageUrl: r.imageUrl,
    label: r.label,
    vec: JSON.parse(r.embedding) as number[],
  }));

  const threshold = params.minSimilarity ?? 0.85;
  const maxClusters = params.maxClusters ?? 20;
  const assigned = new Set<number>();
  const clusters: ClusterResult[] = [];

  // Cosine similarity between L2-normalized vectors = dot product
  function cosineSim(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }

  while (assigned.size < items.length && clusters.length < maxClusters) {
    // Find unassigned item with most neighbors above threshold
    let bestIdx = -1;
    let bestNeighborCount = -1;

    for (let i = 0; i < items.length; i++) {
      if (assigned.has(i)) continue;
      let neighborCount = 0;
      for (let j = 0; j < items.length; j++) {
        if (i === j || assigned.has(j)) continue;
        if (cosineSim(items[i].vec, items[j].vec) >= threshold) neighborCount++;
      }
      if (neighborCount > bestNeighborCount) {
        bestNeighborCount = neighborCount;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    // Form cluster
    const centroid = items[bestIdx];
    const members: ClusterResult["members"] = [];
    assigned.add(bestIdx);
    members.push({ id: centroid.id, imageUrl: centroid.imageUrl, label: centroid.label, similarity: 1.0 });

    for (let j = 0; j < items.length; j++) {
      if (assigned.has(j)) continue;
      const sim = cosineSim(centroid.vec, items[j].vec);
      if (sim >= threshold) {
        assigned.add(j);
        members.push({ id: items[j].id, imageUrl: items[j].imageUrl, label: items[j].label, similarity: sim });
      }
    }

    members.sort((a, b) => b.similarity - a.similarity);

    clusters.push({
      clusterId: clusters.length + 1,
      centroidImageId: centroid.id,
      memberCount: members.length,
      members,
    });
  }

  return clusters;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getEmbeddingStats(filters?: {
  machineId?: number;
  productModelId?: number;
}) {
  const db = await getDb();
  if (!db) return { totalEmbeddings: 0, byModel: [], byLabel: [], byMachine: [] };

  const conditions = [];
  if (filters?.machineId != null) {
    conditions.push(eq(aiImageEmbeddings.machineId, filters.machineId));
  }
  if (filters?.productModelId != null) {
    conditions.push(eq(aiImageEmbeddings.productModelId, filters.productModelId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select({
      totalEmbeddings: sql<number>`count(*)`,
      distinctModels: sql<number>`count(distinct ${aiImageEmbeddings.modelCode})`,
      distinctLabels: sql<number>`count(distinct ${aiImageEmbeddings.label})`,
      latestAt: sql<Date>`max(${aiImageEmbeddings.createdAt})`,
    })
    .from(aiImageEmbeddings)
    .where(whereClause);

  return result[0] ?? { totalEmbeddings: 0, distinctModels: 0, distinctLabels: 0, latestAt: null };
}
