/**
 * AI Advanced Vision Router
 * 
 * Exposes 8 advanced image-processing features (A-H) via tRPC.
 * All inputs accept base64-encoded images (data URI prefix optional).
 * Binary outputs (heatmap PNG, augmented JPEGs) are returned as base64 strings.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { appError } from "../_core/appError";
import {
  compareOkVsNg,
  imageQualityCheck,
  generateDefectHeatmap,
  extractText,
  autoDetectRoi,
  augmentImage,
  visualQA,
  batchTriage,
  type AugmentTransform,
} from "../services/aiAdvancedVision";
import { explain } from "../services/aiExplainability";
import fs from "fs";
import { resolveSafeImagePath } from "../utils/safeImagePath";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_BATCH = 20;

function decodeBase64Image(b64: string): Buffer {
  // Accept data URI ("data:image/png;base64,XXXX") or raw base64
  const cleaned = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  let buf: Buffer;
  try {
    buf = Buffer.from(cleaned, "base64");
  } catch {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "image" }, "Invalid base64 image");
  }
  if (buf.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Empty image payload" });
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: `Image exceeds ${MAX_IMAGE_BYTES} bytes`,
    });
  }
  return buf;
}

const base64Image = z.string().min(16);
const langSchema = z.enum(["en", "vi"]).optional();

export const aiAdvancedVisionRouter = router({
  // A. Compare OK vs NG
  compareOkVsNg: protectedProcedure
    .input(z.object({
      okImage: base64Image,
      ngImage: base64Image,
      language: langSchema,
    }))
    .mutation(async ({ input }) => {
      return compareOkVsNg(
        decodeBase64Image(input.okImage),
        decodeBase64Image(input.ngImage),
        input.language ?? "vi",
      );
    }),

  // B. Image Quality Check
  imageQualityCheck: protectedProcedure
    .input(z.object({ image: base64Image }))
    .mutation(async ({ input }) => {
      return imageQualityCheck(decodeBase64Image(input.image));
    }),

  // C. Defect Heatmap (returns PNG as base64)
  generateDefectHeatmap: protectedProcedure
    .input(z.object({
      okReference: base64Image,
      candidate: base64Image,
    }))
    .mutation(async ({ input }) => {
      const r = await generateDefectHeatmap(
        decodeBase64Image(input.okReference),
        decodeBase64Image(input.candidate),
      );
      return {
        width: r.width,
        height: r.height,
        heatmapPngBase64: r.heatmapPng.toString("base64"),
        hotspots: r.hotspots,
        totalDiffPixels: r.totalDiffPixels,
        diffRatio: r.diffRatio,
        aligned: r.aligned ?? false,
        alignment: r.alignment ?? null,
      };
    }),

  // D. Extract Text (OCR)
  extractText: protectedProcedure
    .input(z.object({
      image: base64Image,
      language: z.enum(["en", "vi", "auto"]).optional(),
    }))
    .mutation(async ({ input }) => {
      return extractText(decodeBase64Image(input.image), input.language ?? "auto");
    }),

  // E. Auto-detect ROI
  autoDetectRoi: protectedProcedure
    .input(z.object({ image: base64Image }))
    .mutation(async ({ input }) => {
      return autoDetectRoi(decodeBase64Image(input.image));
    }),

  // F. Augment Image
  augmentImage: protectedProcedure
    .input(z.object({
      image: base64Image,
      transforms: z.array(z.enum([
        "rotate90", "rotate180", "rotate270",
        "flipH", "flipV",
        "brightnessUp", "brightnessDown",
        "contrastUp", "noise",
      ])).min(1).max(9),
    }))
    .mutation(async ({ input }) => {
      const results = await augmentImage(
        decodeBase64Image(input.image),
        input.transforms as AugmentTransform[],
      );
      return results.map(r => ({
        transform: r.transform,
        width: r.width,
        height: r.height,
        imageBase64: r.buffer.toString("base64"),
      }));
    }),

  // G. Visual QA
  visualQA: protectedProcedure
    .input(z.object({
      image: base64Image,
      question: z.string().min(3).max(500),
      language: langSchema,
    }))
    .mutation(async ({ input }) => {
      return visualQA(
        decodeBase64Image(input.image),
        input.question,
        input.language ?? "vi",
      );
    }),

  // H. Batch Triage
  batchTriage: protectedProcedure
    .input(z.object({
      images: z.array(base64Image).min(1).max(MAX_BATCH),
      language: langSchema,
    }))
    .mutation(async ({ input }) => {
      const buffers = input.images.map(decodeBase64Image);
      return batchTriage(buffers, input.language ?? "vi");
    }),

  // B5. Explain heatmap (XAI) — 3 tầng: score-cam/cam → occlusion → pixel-diff.
  // GIỮ generateDefectHeatmap cũ nguyên. Nhận base64 HOẶC imageKey; modelId/targetClass optional.
  explainHeatmap: protectedProcedure
    .input(z.object({
      image: base64Image.optional(),
      imageKey: z.string().optional(),
      referenceImage: base64Image.optional(),
      modelId: z.number().int().positive().optional(),
      targetClass: z.number().int().min(0).optional(),
    }).refine((v) => !!v.image || !!v.imageKey, {
      message: "Provide either image (base64) or imageKey",
    }))
    .mutation(async ({ input }) => {
      const imageBuffer = input.image
        ? decodeBase64Image(input.image)
        : await fs.promises.readFile(
            resolveSafeImagePath(
              input.imageKey!.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^uploads\//i, ""),
            ),
          );
      const referenceBuffer = input.referenceImage
        ? decodeBase64Image(input.referenceImage)
        : undefined;

      const r = await explain({
        modelId: input.modelId,
        imageBuffer,
        targetClass: input.targetClass,
        referenceBuffer,
      });

      return {
        method: r.method,
        degraded: r.degraded,
        approximate: r.approximate,
        heatmapPngBase64: r.heatmapPng.toString("base64"),
        width: r.width,
        height: r.height,
        topLabel: r.topLabel,
        topConfidence: r.topConfidence,
        targetClass: r.targetClass,
        notes: r.notes,
      };
    }),
});
