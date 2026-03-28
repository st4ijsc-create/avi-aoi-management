import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import path from "path";
import fs from "fs";
import {
  extractEmbedding,
  storeEmbedding,
  findSimilarById,
  searchByImage,
  clusterDefects,
  getEmbeddingStats,
} from "../services/aiImageEmbedding";

function resolveImagePath(imageKey: string): string {
  const uploadsRoot = process.env.LOCAL_STORAGE_DIR
    ? path.resolve(process.env.LOCAL_STORAGE_DIR)
    : path.join(process.cwd(), "uploads");
  return path.join(uploadsRoot, imageKey);
}

async function loadImage(imageKey: string): Promise<Buffer> {
  const fullPath = resolveImagePath(imageKey);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Image not found: ${imageKey}`);
  }
  return fs.promises.readFile(fullPath);
}

export const aiImageSearchRouter = router({

  // ─── Extract and store embedding for a single image ────────────────────────
  embed: adminProcedure
    .input(z.object({
      modelId: z.number(),
      imageKey: z.string(),
      inspectionId: z.number().optional(),
      measurementResultId: z.number().optional(),
      label: z.string().optional(),
      confidence: z.number().optional(),
      defectType: z.string().optional(),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const imageBuffer = await loadImage(input.imageKey);
      const embResult = await extractEmbedding(input.modelId, imageBuffer);
      const id = await storeEmbedding({
        inspectionId: input.inspectionId,
        measurementResultId: input.measurementResultId,
        imageUrl: input.imageKey,
        embedding: embResult.embedding,
        dim: embResult.dim,
        modelCode: embResult.modelCode,
        label: input.label,
        confidence: input.confidence,
        defectType: input.defectType,
        machineId: input.machineId,
        productModelId: input.productModelId,
      });

      return { id, dim: embResult.dim, modelCode: embResult.modelCode, processingTimeMs: embResult.processingTimeMs };
    }),

  // ─── Find similar by embedding ID ──────────────────────────────────────────
  findSimilar: protectedProcedure
    .input(z.object({
      embeddingId: z.number(),
      limit: z.number().min(1).max(100).default(10),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      label: z.string().optional(),
      minSimilarity: z.number().min(0).max(1).optional(),
    }))
    .query(async ({ input }) => {
      const results = await findSimilarById(input.embeddingId, input.limit, {
        machineId: input.machineId,
        productModelId: input.productModelId,
        label: input.label,
        minSimilarity: input.minSimilarity,
      });
      return results;
    }),

  // ─── Search by uploaded image ──────────────────────────────────────────────
  searchByUpload: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      imageKey: z.string(),
      limit: z.number().min(1).max(100).default(10),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      label: z.string().optional(),
      minSimilarity: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input }) => {
      const imageBuffer = await loadImage(input.imageKey);
      const { results, embedding } = await searchByImage(input.modelId, imageBuffer, input.limit, {
        machineId: input.machineId,
        productModelId: input.productModelId,
        label: input.label,
        minSimilarity: input.minSimilarity,
      });
      return {
        results,
        embeddingDim: embedding.dim,
        modelCode: embedding.modelCode,
        processingTimeMs: embedding.processingTimeMs,
      };
    }),

  // ─── Cluster similar defect images ─────────────────────────────────────────
  clusterDefects: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      label: z.string().optional(),
      minSimilarity: z.number().min(0).max(1).default(0.85),
      maxClusters: z.number().min(1).max(50).default(20),
      limit: z.number().min(10).max(1000).default(500),
    }))
    .query(async ({ input }) => {
      const clusters = await clusterDefects({
        machineId: input.machineId,
        productModelId: input.productModelId,
        label: input.label,
        minSimilarity: input.minSimilarity,
        maxClusters: input.maxClusters,
        limit: input.limit,
      });
      return clusters;
    }),

  // ─── Embedding stats ──────────────────────────────────────────────────────
  stats: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return getEmbeddingStats(input);
    }),
});
