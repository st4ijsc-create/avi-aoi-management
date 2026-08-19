import { z } from "zod";
import { appError } from "../_core/appError";
import {
  router,
  protectedProcedure as thuTucVanHanh,
  moduleProcedure,
  moduleGate,
  adminProcedure as adminProcedureBase,
} from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
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
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "image" }, `Image not found: ${imageKey}`);
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
  // ⚠⚠ CỐ Ý **KHÔNG** khoá sau MOD_AI. `components/RepairAISummary.tsx` gọi thủ tục này và nó
  //    được gắn ở `pages/RepairStation.tsx` — màn thuộc MOD_QUALITY, KHÔNG phải màn AI. Khoá ở đây
  //    ⇒ khách mua MOD_QUALITY mà không mua AI bấm nút "tìm lỗi tương tự" nhận FORBIDDEN. Không
  //    mua AI thì hệ vốn KHÔNG có embedding nào để tìm — nên khoá chỉ đổi thông báo lỗi, không
  //    thêm giá trị, mà lại thêm rủi ro. Ẩn widget ở client trước — xem báo cáo mục (b).
  searchByUpload: thuTucVanHanh
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
      const { results, embedding, searchMode, embeddingSource } = await searchByImage(input.modelId, imageBuffer, input.limit, {
        machineId: input.machineId,
        productModelId: input.productModelId,
        label: input.label,
        defectType: input.defectType,
        minSimilarity: input.minSimilarity,
      });
      return {
        results,
        searchMode,
        embeddingSource,
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
        throw appError(
          "BAD_REQUEST",
          "INVALID_VALUE",
          { field: "embedding" },
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
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "image", reason: "emptyImagePayload" }, "Empty image data");
      }
      fs.writeFileSync(filePath, buffer);
      return { imageKey: `temp/${safeName}` };
    }),
});

