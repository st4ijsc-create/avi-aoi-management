/**
 * AI Vision-Language Router
 *
 * Endpoints for VLM-powered inspection image analysis:
 * describe defects, compare images, and generate QA reports.
 */
import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  describeDefect,
  compareImages,
  generateQAReport,
} from "../services/aiVisionLanguage";
import fs from "fs";
import path from "path";

function resolveImagePath(imageKey: string): string {
  const uploadsRoot = process.env.LOCAL_STORAGE_DIR
    ? path.resolve(process.env.LOCAL_STORAGE_DIR)
    : path.join(process.cwd(), "uploads");
  return path.join(uploadsRoot, imageKey);
}

function loadImage(imageKey: string): Buffer {
  const imagePath = resolveImagePath(imageKey);
  if (!fs.existsSync(imagePath)) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Image not found: ${imageKey}` });
  }
  return fs.readFileSync(imagePath);
}

export const aiVisionLanguageRouter = router({
  describeDefect: protectedProcedure
    .input(
      z.object({
        imageKey: z.string(),
        productModel: z.string().optional(),
        machineCode: z.string().optional(),
        inspectionPoint: z.string().optional(),
        existingLabels: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const imageBuffer = loadImage(input.imageKey);
      return describeDefect(imageBuffer, {
        productModel: input.productModel,
        machineCode: input.machineCode,
        inspectionPoint: input.inspectionPoint,
        existingLabels: input.existingLabels,
      });
    }),

  compareImages: protectedProcedure
    .input(
      z.object({
        imageKeyA: z.string(),
        imageKeyB: z.string(),
        productModel: z.string().optional(),
        comparisonType: z
          .enum(["golden_vs_current", "before_after", "side_by_side"])
          .default("side_by_side"),
      }),
    )
    .mutation(async ({ input }) => {
      const imageA = loadImage(input.imageKeyA);
      const imageB = loadImage(input.imageKeyB);
      return compareImages(imageA, imageB, {
        productModel: input.productModel,
        comparisonType: input.comparisonType,
      });
    }),

  generateReport: protectedProcedure
    .input(
      z.object({
        images: z
          .array(
            z.object({
              imageKey: z.string(),
              label: z.string().optional(),
              inspectionPoint: z.string().optional(),
            }),
          )
          .min(1)
          .max(10),
        productModel: z.string().optional(),
        machineCode: z.string().optional(),
        batchId: z.string().optional(),
        date: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const images = input.images.map((img) => ({
        buffer: loadImage(img.imageKey),
        label: img.label,
        inspectionPoint: img.inspectionPoint,
      }));

      return generateQAReport(images, {
        productModel: input.productModel,
        machineCode: input.machineCode,
        batchId: input.batchId,
        date: input.date,
      });
    }),
});
