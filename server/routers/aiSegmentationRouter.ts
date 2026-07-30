/**
 * B7 — AI Segmentation Router (tRPC).
 *
 * Procedures:
 *   • saveMask     — lưu mask QC vẽ (source "human") hoặc model; tính metrology nếu có grid.
 *   • listMasks    — liệt kê mask theo measurement/inspection/image/source.
 *   • deleteMask   — xoá (chủ sở hữu hoặc admin).
 *   • runSegmentation — chạy model segmentation (degrade MODEL_NOT_AVAILABLE rõ ràng
 *                       nếu chưa có seg model) + đo metrology mỗi mask.
 *   • measureMask  — đo metrology từ polygon (không cần model).
 *
 * Degrade trung thực: thiếu model seg → PRECONDITION_FAILED (MODEL_NOT_AVAILABLE),
 * KHÔNG crash. Thiếu calibration µm/pixel → đơn vị "px", cờ degraded.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import {
  insertDefectSegmentation,
  listDefectSegmentations,
  getDefectSegmentationById,
  deleteDefectSegmentation,
} from "../db/aiSegmentation";
import { measureMask, polygonToMask } from "../services/aiMetrology";
import { buildSegmentationDataset } from "../services/aiDatasetBuilder";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const pointSchema = z.object({ x: z.number(), y: z.number() });
const maskDataSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  points: z.array(pointSchema).optional(),
  counts: z.array(z.number()).optional(),
});

function decodeBase64Image(b64: string): Buffer {
  const cleaned = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  let buf: Buffer;
  try {
    buf = Buffer.from(cleaned, "base64");
  } catch {
    // Task 5 (doc 71) — xem ghi chú cùng pattern ở aiAdvancedVisionRouter.ts:
    // reason tách 3 nguyên nhân trước đây render 1 câu; nhánh vượt dung lượng tái
    // dùng KB_FILE_TOO_LARGE{limitMb}, KHÔNG nhồi vào INVALID_VALUE.
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "image", reason: "invalidBase64Image" }, "Invalid base64 image");
  }
  if (buf.length === 0) throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "image", reason: "emptyImagePayload" }, "Empty image payload");
  if (buf.length > MAX_IMAGE_BYTES) {
    throw appError(
      "PAYLOAD_TOO_LARGE",
      "KB_FILE_TOO_LARGE",
      { limitMb: Math.round((MAX_IMAGE_BYTES / (1024 * 1024)) * 10) / 10 },
      `Image exceeds ${MAX_IMAGE_BYTES} bytes`,
    );
  }
  return buf;
}

/** Đo metrology từ maskData polygon (rasterize). RLE chưa hỗ trợ đo → trả null degrade. */
function measureFromMaskData(
  maskData: z.infer<typeof maskDataSchema>,
  umPerPx?: number | null,
) {
  if (maskData.points && maskData.points.length >= 3) {
    const grid = polygonToMask(maskData.points, maskData.width, maskData.height);
    return measureMask(grid, umPerPx);
  }
  return null;
}

export const aiSegmentationRouter = router({
  // ── saveMask ────────────────────────────────────────────────────────────────
  saveMask: protectedProcedure
    .input(z.object({
      measurementResultId: z.number().int().positive().nullish(),
      inspectionId: z.number().int().positive().nullish(),
      imageUrl: z.string().nullish(),
      modelId: z.number().int().positive().nullish(),
      modelVersion: z.string().nullish(),
      source: z.enum(["human", "model"]).default("human"),
      maskFormat: z.enum(["polygon", "rle"]).default("polygon"),
      maskData: maskDataSchema,
      classLabel: z.string().min(1),
      defectCatalogId: z.number().int().positive().nullish(),
      confidence: z.number().min(0).max(1).nullish(),
      umPerPx: z.number().positive().nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      const m = measureFromMaskData(input.maskData, input.umPerPx ?? null);
      const row = await insertDefectSegmentation({
        measurementResultId: input.measurementResultId ?? null,
        inspectionId: input.inspectionId ?? null,
        imageUrl: input.imageUrl ?? null,
        modelId: input.modelId ?? null,
        modelVersion: input.modelVersion ?? null,
        source: input.source,
        maskFormat: input.maskFormat,
        maskData: input.maskData,
        classLabel: input.classLabel,
        defectCatalogId: input.defectCatalogId ?? null,
        confidence: input.confidence != null ? input.confidence.toString() : null,
        areaPx: m ? m.areaPx.toString() : null,
        perimeterPx: m ? m.perimeterPx.toString() : null,
        feretMaxPx: m ? m.feretMaxPx.toString() : null,
        feretMinPx: m ? m.feretMinPx.toString() : null,
        equivDiaPx: m ? m.equivDiameterPx.toString() : null,
        umPerPx: m?.umPerPx != null ? m.umPerPx.toString() : null,
        areaUnit: m ? m.unit : null,
        lengthUnit: m ? m.unit : null,
        createdBy: ctx.user.id,
      });
      return { id: row.id, metrology: m };
    }),

  // ── listMasks ─────────────────────────────────────────────────────────────
  listMasks: protectedProcedure
    .input(z.object({
      measurementResultId: z.number().int().positive().nullish(),
      inspectionId: z.number().int().positive().nullish(),
      imageUrl: z.string().nullish(),
      source: z.enum(["human", "model"]).nullish(),
      limit: z.number().int().min(1).max(500).default(200),
    }))
    .query(async ({ input }) => {
      return listDefectSegmentations({
        measurementResultId: input.measurementResultId ?? null,
        inspectionId: input.inspectionId ?? null,
        imageUrl: input.imageUrl ?? null,
        source: input.source ?? null,
        limit: input.limit,
      });
    }),

  // ── deleteMask ──────────────────────────────────────────────────────────────
  deleteMask: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getDefectSegmentationById(input.id);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "mask" }, "Mask not found");
      if (row.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "deleteMask" }, "Not authorized to delete this mask");
      }
      await deleteDefectSegmentation(input.id);
      return { success: true };
    }),

  // ── measureMask (polygon → metrology, không cần model) ───────────────────────
  measureMask: protectedProcedure
    .input(z.object({
      maskData: maskDataSchema,
      umPerPx: z.number().positive().nullish(),
    }))
    .query(({ input }) => {
      const m = measureFromMaskData(input.maskData, input.umPerPx ?? null);
      if (!m) {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "maskData" }, "Cannot measure mask: polygon requires >= 3 points (RLE measurement not supported)");
      }
      return m;
    }),

  // ── buildDataset (materialize SEGMENTATION manifest from QC masks) ───────────
  // Sinh manifest YOLOv8-seg từ defect_segmentations source="human": 1 dòng/ảnh,
  // points normalized 0..1, classLabels thứ tự ổn định. Admin-only (giống
  // aiEval.buildDataset). Trả classLabels để feed thẳng vào startPipeline.
  buildDataset: adminProcedure
    .input(z.object({
      datasetId: z.number().int().positive(),
      seed: z.number().int().optional(),
    }))
    .mutation(async ({ input }) => {
      return buildSegmentationDataset(input.datasetId, { seed: input.seed });
    }),

  // ── runSegmentation (degrade MODEL_NOT_AVAILABLE) ────────────────────────────
  runSegmentation: protectedProcedure
    .input(z.object({
      modelId: z.number().int().positive(),
      image: z.string().min(16),
      umPerPx: z.number().positive().nullish(),
    }))
    .mutation(async ({ input }) => {
      const buffer = decodeBase64Image(input.image);
      // import động: tránh nạp onnxruntime-node nếu router chỉ dùng saveMask/measure.
      const { runSegmentation, SegmentationUnavailableError } = await import("../services/aiInferenceEngine");
      const { measureMask: measure, polygonToMask: polyToMask } = await import("../services/aiMetrology");
      try {
        const result = await runSegmentation(input.modelId, buffer);
        const masks = result.masks.map((mk) => {
          // đo trên lưới output bằng polygon (đã ở pixel-space output).
          const grid = polyToMask(mk.polygon, result.maskWidth, result.maskHeight);
          return { ...mk, metrology: measure(grid, input.umPerPx ?? null) };
        });
        return { ...result, masks, degraded: false as const };
      } catch (err) {
        if (err instanceof SegmentationUnavailableError) {
          // Review cuối, ca I-A #12: SegmentationUnavailableError ném khi model không
          // tồn tại HOẶC `model.status !== "ACTIVE"` — trạng thái của MỘT bản ghi model,
          // không phải một cờ tính năng hệ thống. FEATURE_DISABLED nói "tính năng chưa
          // bật" — sai, không có công tắc nào cho người dùng bật. Đổi sang
          // OPERATION_FAILED, tái dùng cùng khoá "segmentImage" với nhánh catch chung ở
          // dưới — cả hai đều là "không thực hiện được: phân đoạn ảnh".
          throw appError("PRECONDITION_FAILED", "OPERATION_FAILED", { operation: "segmentImage" }, `MODEL_NOT_AVAILABLE: ${err.message}`);
        }
        throw appError(
          "INTERNAL_SERVER_ERROR",
          "OPERATION_FAILED",
          { operation: "segmentImage" },
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
});
