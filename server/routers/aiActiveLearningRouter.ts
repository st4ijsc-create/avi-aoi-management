import { z } from "zod";
import { appError } from "../_core/appError";
import { router, moduleProcedure, moduleGate, adminProcedure as adminProcedureBase } from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
import path from "path";
import fs from "fs";
import {
  autoLabelImages,
  getReviewQueue,
  submitHumanLabel,
  skipQueueItem,
  assignToReviewer,
  runUncertaintySampling,
  runDiversitySampling,
  checkRetrainThreshold,
  getActiveLearningStats,
  getLabelAccuracy,
} from "../services/aiActiveLearning";

function resolveImagePath(imageKey: string): string {
  const uploadsRoot = process.env.LOCAL_STORAGE_DIR
    ? path.resolve(process.env.LOCAL_STORAGE_DIR)
    : path.join(process.cwd(), "uploads");
  return path.join(uploadsRoot, imageKey);
}

async function loadImage(imageKey: string): Promise<Buffer> {
  const fullPath = resolveImagePath(imageKey);
  if (!fs.existsSync(fullPath)) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "image" }, `Image not found: ${imageKey}`);
  }
  return fs.promises.readFile(fullPath);
}

export const aiActiveLearningRouter = router({
  /**
   * Run auto-labeling on a list of images.
   */
  autoLabel: adminProcedure
    .input(z.object({
      modelId: z.number(),
      images: z.array(z.object({
        imageKey: z.string(),
        inspectionId: z.number().optional(),
        measurementResultId: z.number().optional(),
        machineId: z.number().optional(),
        productModelId: z.number().optional(),
        defectType: z.string().optional(),
      })),
      autoAcceptThreshold: z.number().min(0).max(1).optional(),
      reviewThreshold: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input }) => {
      const imageData = await Promise.all(
        input.images.map(async (img) => ({
          imageBuffer: await loadImage(img.imageKey),
          imageUrl: img.imageKey,
          inspectionId: img.inspectionId,
          measurementResultId: img.measurementResultId,
          machineId: img.machineId,
          productModelId: img.productModelId,
          defectType: img.defectType,
        })),
      );
      return autoLabelImages(input.modelId, imageData, {
        autoAcceptThreshold: input.autoAcceptThreshold,
        reviewThreshold: input.reviewThreshold,
      });
    }),

  /**
   * Get items in the review queue.
   */
  getQueue: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      assignedTo: z.number().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(({ input }) => getReviewQueue(input)),

  /**
   * Submit a human label for a queue item.
   */
  submitLabel: protectedProcedure
    .input(z.object({
      queueId: z.number(),
      humanLabel: z.string().min(1),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = (ctx as any).user?.id ?? 0;
      return submitHumanLabel(input.queueId, input.humanLabel, userId, input.reviewNotes);
    }),

  /**
   * Skip a queue item.
   */
  skipItem: protectedProcedure
    .input(z.object({
      queueId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = (ctx as any).user?.id ?? 0;
      return skipQueueItem(input.queueId, userId, input.reason);
    }),

  /**
   * Assign queue items to a reviewer.
   */
  assignReviewer: adminProcedure
    .input(z.object({
      queueIds: z.array(z.number()),
      assignedTo: z.number(),
    }))
    .mutation(({ input }) => assignToReviewer(input.queueIds, input.assignedTo)),

  /**
   * Run uncertainty sampling to get the most uncertain items.
   */
  uncertaintySampling: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).optional(),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
    }).optional())
    .query(({ input }) =>
      runUncertaintySampling(input?.limit, input?.machineId, input?.productModelId),
    ),

  /**
   * Run diversity sampling using image embeddings.
   */
  diversitySampling: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).optional(),
      machineId: z.number().optional(),
    }).optional())
    .query(({ input }) =>
      runDiversitySampling(input?.limit, input?.machineId),
    ),

  /**
   * Check if we have enough new labels to trigger retraining.
   */
  checkRetrain: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      minNewLabels: z.number().min(1).optional(),
    }))
    .query(({ input }) => checkRetrainThreshold(input.modelId, input.minNewLabels)),

  /**
   * Get active learning statistics.
   */
  stats: protectedProcedure
    .input(z.object({
      modelId: z.number().optional(),
      machineId: z.number().optional(),
    }).optional())
    .query(({ input }) => getActiveLearningStats(input)),

  /**
   * Get label accuracy comparison for a model.
   */
  labelAccuracy: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(({ input }) => getLabelAccuracy(input.modelId)),
});
