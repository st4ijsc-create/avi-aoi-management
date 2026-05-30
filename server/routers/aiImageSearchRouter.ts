import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import path from "path";
import fs from "fs";
import { resolveSafeImagePath } from "../utils/safeImagePath";
import {
  extractEmbedding,
  storeEmbedding,
  findSimilarByIdWithMode,
  searchByImage,
  findSimilarByVectorWithMode,
  clusterDefects,
  getEmbeddingStats,
  DEFAULT_EMBEDDING_DIM,
} from "../services/aiImageEmbedding";

// ─── License gating ────────────────────────────────────────────────────────
// LƯU Ý (WS-3): Dự án gate license ở tầng route/module — frontend gọi
// license.checkRouteAccess + Express licenseEnforcementMiddleware (server/license/
// license-middleware.ts) tự chặn mutation khi state = readonly/locked/no_license.
// KHÔNG có middleware license per-procedure trong _core/trpc.ts, và không router
// nào trong repo gate license trong thân procedure. Vì vậy ở đây giữ nguyên cơ chế
// hiện có (protectedProcedure + enforcement middleware) thay vì bịa thêm 1 lớp
// gating riêng. Nếu cần khóa riêng tính năng vector-search theo module license,
// thêm route tương ứng vào shared/module-registry và để middleware xử lý.

function resolveImagePath(imageKey: string): string {
  let normalizedKey = imageKey.trim().replace(/\\/g, "/").replace(/^\/+/, "");

  if (/^https?:\/\//i.test(normalizedKey)) {
    try {
      normalizedKey = new URL(normalizedKey).pathname.replace(/^\/+/, "");
    } catch {
      // Fall back to the original string if URL parsing fails.
    }
  }

  normalizedKey = normalizedKey.replace(/^uploads\//i, "");
  return resolveSafeImagePath(normalizedKey);
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
      defectType: z.string().optional(),
      minSimilarity: z.number().min(0).max(1).optional(),
    }))
    .query(async ({ input }) => {
      const { results, searchMode } = await findSimilarByIdWithMode(input.embeddingId, input.limit, {
        machineId: input.machineId,
        productModelId: input.productModelId,
        label: input.label,
        defectType: input.defectType,
        minSimilarity: input.minSimilarity,
      });
      // Back-compat: trả mảng kèm thuộc tính searchMode (mảng vẫn iterate được như cũ).
      return Object.assign(results, { searchMode });
    }),

  // ─── Search by uploaded image ──────────────────────────────────────────────
  searchByUpload: protectedProcedure
    .input(z.object({
      modelId: z.number().optional(),
      imageKey: z.string(),
      limit: z.number().min(1).max(100).default(10),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      label: z.string().optional(),
      defectType: z.string().optional(),
      minSimilarity: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input }) => {
      const imageBuffer = await loadImage(input.imageKey);
      const { results, embedding, searchMode } = await searchByImage(input.modelId, imageBuffer, input.limit, {
        machineId: input.machineId,
        productModelId: input.productModelId,
        label: input.label,
        defectType: input.defectType,
        minSimilarity: input.minSimilarity,
      });
      return {
        results,
        searchMode,
        embeddingDim: embedding.dim,
        modelCode: embedding.modelCode,
        processingTimeMs: embedding.processingTimeMs,
      };
    }),

  // ─── Search by raw vector (client/edge gửi sẵn vector) ─────────────────────
  searchByVector: protectedProcedure
    .input(z.object({
      embedding: z.array(z.number()).min(1).max(4096),
      dim: z.number().int().positive(),
      limit: z.number().min(1).max(100).default(10),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      label: z.string().optional(),
      defectType: z.string().optional(),
      minSimilarity: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input }) => {
      // Chỉ chấp nhận không gian D=1024 (mxbai-embed-large) — tránh trộn vector khác chiều.
      if (input.dim !== DEFAULT_EMBEDDING_DIM || input.embedding.length !== DEFAULT_EMBEDDING_DIM) {
        throw new Error(
          `searchByVector chỉ hỗ trợ vector ${DEFAULT_EMBEDDING_DIM}-chiều (nhận dim=${input.dim}, length=${input.embedding.length}).`,
        );
      }
      const started = Date.now();
      const { results, searchMode } = await findSimilarByVectorWithMode(
        input.embedding,
        input.dim,
        input.limit,
        {
          machineId: input.machineId,
          productModelId: input.productModelId,
          label: input.label,
          defectType: input.defectType,
          minSimilarity: input.minSimilarity,
        },
      );
      return { results, searchMode, processingTimeMs: Date.now() - started };
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

  // ─── Upload image for temporary search ─────────────────────────────────────
  uploadForSearch: protectedProcedure
    .input(z.object({
      imageData: z.string(),
      fileName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const uploadsRoot = process.env.LOCAL_STORAGE_DIR
        ? path.resolve(process.env.LOCAL_STORAGE_DIR)
        : path.join(process.cwd(), "uploads");
      const tempDir = path.join(uploadsRoot, "temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      // Prune temp files older than 1 hour
      try {
        const now = Date.now();
        for (const f of fs.readdirSync(tempDir)) {
          const fp = path.join(tempDir, f);
          const stat = fs.statSync(fp);
          if (now - stat.mtimeMs > 3_600_000) fs.unlinkSync(fp);
        }
      } catch { /* non-critical */ }

      const ext = input.fileName
        ? (path.extname(input.fileName) || ".jpg")
        : ".jpg";
      const safeName = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
      const filePath = path.join(tempDir, safeName);

      // Strip optional data-URL prefix and decode
      const base64 = input.imageData.replace(/^data:image\/[a-z]+;base64,/, "");
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length === 0) {
        throw new Error("Empty image data");
      }
      fs.writeFileSync(filePath, buffer);
      return { imageKey: `temp/${safeName}` };
    }),
});

