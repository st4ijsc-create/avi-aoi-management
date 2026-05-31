/**
 * B3 — AI Anomaly Detection Router (tRPC)
 *
 * Public-ish (protected): score / getProfile / stats.
 * Admin: buildBank / rebuild / deleteBank.
 *
 * Ảnh nhận base64 (data URI prefix optional) theo pattern aiAdvancedVisionRouter.
 * Mọi output mang cờ source/degraded → UI nói đúng sự thật về tầng degrade.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import {
  scoreImage,
  buildMemoryBank,
  getAnomalyStats,
  anomalyModelCode,
} from "../services/aiAnomalyDetection";
import { getProfile, deleteScope } from "../db/aiAnomaly";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_BANK_IMAGES = 500;

function decodeBase64Image(b64: string): Buffer {
  const cleaned = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  let buf: Buffer;
  try {
    buf = Buffer.from(cleaned, "base64");
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid base64 image" });
  }
  if (buf.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Empty image payload" });
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: `Image exceeds ${MAX_IMAGE_BYTES} bytes` });
  }
  return buf;
}

const base64Image = z.string().min(16);
const scopeInput = z.object({
  productModelId: z.number().int().positive().nullish(),
  machineId: z.number().int().positive().nullish(),
  modelId: z.number().int().positive().nullish(),
});

export const aiAnomalyRouter = router({
  // ── score (protected) ──────────────────────────────────────────────────────
  score: protectedProcedure
    .input(scopeInput.extend({ image: base64Image }))
    .mutation(async ({ input }) => {
      return scoreImage({
        buffer: decodeBase64Image(input.image),
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
        modelId: input.modelId ?? null,
      });
    }),

  // ── getProfile (protected) ──────────────────────────────────────────────────
  // Trả profile cho cả 3 modelCode khả dĩ (onnx/text-of-image/heuristic).
  getProfile: protectedProcedure
    .input(scopeInput)
    .query(async ({ input }) => {
      const base = {
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
      };
      const sources = [
        anomalyModelCode("onnx", input.modelId ?? null),
        anomalyModelCode("text-of-image", null),
        anomalyModelCode("heuristic", null),
      ];
      const profiles = await Promise.all(
        sources.map((modelCode) => getProfile({ ...base, modelCode })),
      );
      return { profiles: profiles.filter((p) => p != null) };
    }),

  // ── stats (protected) ───────────────────────────────────────────────────────
  stats: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive().nullish(),
      machineId: z.number().int().positive().nullish(),
    }))
    .query(async ({ input }) => {
      return getAnomalyStats({
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
      });
    }),

  // ── buildBank (admin) ───────────────────────────────────────────────────────
  buildBank: adminProcedure
    .input(scopeInput.extend({
      images: z.array(base64Image).min(1).max(MAX_BANK_IMAGES),
      coresetRatio: z.number().min(0.01).max(1).optional(),
      k: z.number().int().min(1).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      const buffers = input.images.map((img, i) => {
        const b = decodeBase64Image(img);
        return { buffer: b, imageUrl: `upload:${i}` };
      });
      return buildMemoryBank({
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
        modelId: input.modelId ?? null,
        images: buffers,
        coresetRatio: input.coresetRatio,
        k: input.k,
      });
    }),

  // ── rebuild (admin) — alias build (xóa cũ cùng scope đã nằm trong buildMemoryBank) ──
  rebuild: adminProcedure
    .input(scopeInput.extend({
      images: z.array(base64Image).min(1).max(MAX_BANK_IMAGES),
      coresetRatio: z.number().min(0.01).max(1).optional(),
      k: z.number().int().min(1).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      const buffers = input.images.map((img, i) => ({ buffer: decodeBase64Image(img), imageUrl: `upload:${i}` }));
      return buildMemoryBank({
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
        modelId: input.modelId ?? null,
        images: buffers,
        coresetRatio: input.coresetRatio,
        k: input.k,
      });
    }),

  // ── deleteBank (admin) ──────────────────────────────────────────────────────
  deleteBank: adminProcedure
    .input(scopeInput.extend({
      // Nguồn cần xóa: "onnx" cần modelId; "text-of-image"/"heuristic" không cần.
      source: z.enum(["onnx", "text-of-image", "heuristic"]),
    }))
    .mutation(async ({ input }) => {
      const modelCode = anomalyModelCode(input.source, input.modelId ?? null);
      await deleteScope({
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
        modelCode,
      });
      return { deleted: true, modelCode };
    }),
});
