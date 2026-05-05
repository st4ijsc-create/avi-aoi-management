import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import {
  uploadModelFile,
  uploadModelVersion,
  activateModelVersion,
  getModelFileUrl,
  registerModel,
} from "../services/aiModelService";
import {
  runInference,
  evictSessionCache,
  getLoadedModels,
} from "../services/aiInferenceEngine";

export const aiModelRouter = router({
  // ─── Model CRUD ──────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      modelType: z.string().optional(),
      format: z.enum(["ONNX", "TENSORRT", "OPENVINO", "CUSTOM", "GGUF"]).optional(),
      status: z.enum(["UPLOADING", "VALIDATING", "READY", "ACTIVE", "INACTIVE", "FAILED", "ARCHIVED"]).optional(),
      productModelId: z.number().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getAiModels(input ?? undefined);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const model = await db.getAiModelById(input.id);
      if (!model) throw new TRPCError({ code: "NOT_FOUND", message: "AI model not found" });
      return model;
    }),

  getByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      const model = await db.getAiModelByCode(input.code);
      if (!model) throw new TRPCError({ code: "NOT_FOUND", message: "AI model not found" });
      return model;
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(100),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      modelType: z.string().min(1).max(100),
      format: z.enum(["ONNX", "TENSORRT", "OPENVINO", "CUSTOM", "GGUF"]).optional(),
      inputShape: z.array(z.number()).optional(),
      outputShape: z.array(z.number()).optional(),
      labels: z.array(z.string()).optional(),
      preprocessConfig: z.object({
        resize: z.object({ width: z.number(), height: z.number() }).optional(),
        normalize: z.object({ mean: z.array(z.number()), std: z.array(z.number()) }).optional(),
        colorSpace: z.enum(["RGB", "BGR", "GRAY"]).optional(),
        channelFirst: z.boolean().optional(),
      }).optional(),
      postprocessConfig: z.object({
        type: z.string(),
        confidenceThreshold: z.number().optional(),
        nmsThreshold: z.number().optional(),
        topK: z.number().optional(),
      }).optional(),
      productModelId: z.number().optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return registerModel({
        ...input,
        createdBy: ctx.user.id,
        status: "UPLOADING",
      });
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      modelType: z.string().optional(),
      inputShape: z.array(z.number()).optional(),
      outputShape: z.array(z.number()).optional(),
      labels: z.array(z.string()).optional(),
      preprocessConfig: z.object({
        resize: z.object({ width: z.number(), height: z.number() }).optional(),
        normalize: z.object({ mean: z.array(z.number()), std: z.array(z.number()) }).optional(),
        colorSpace: z.enum(["RGB", "BGR", "GRAY"]).optional(),
        channelFirst: z.boolean().optional(),
      }).optional(),
      postprocessConfig: z.object({
        type: z.string(),
        confidenceThreshold: z.number().optional(),
        nmsThreshold: z.number().optional(),
        topK: z.number().optional(),
      }).optional(),
      productModelId: z.number().optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const existing = await db.getAiModelById(id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "AI model not found" });
      return db.updateAiModel(id, data);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const existing = await db.getAiModelById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "AI model not found" });
      evictSessionCache(input.id);
      await db.deleteAiModel(input.id);
      return { success: true };
    }),

  // ─── Model File Upload ──────────────────────────────────
  uploadFile: adminProcedure
    .input(z.object({
      modelId: z.number(),
      fileBase64: z.string(),
      filename: z.string(),
      contentType: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const fileBuffer = Buffer.from(input.fileBase64, "base64");
      return uploadModelFile(input.modelId, fileBuffer, input.filename, input.contentType);
    }),

  // ─── Version Management ─────────────────────────────────
  listVersions: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      return db.getModelVersions(input.modelId);
    }),

  createVersion: adminProcedure
    .input(z.object({
      modelId: z.number(),
      version: z.string().min(1),
      fileBase64: z.string(),
      filename: z.string(),
      changeLog: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const fileBuffer = Buffer.from(input.fileBase64, "base64");
      return uploadModelVersion(input.modelId, input.version, fileBuffer, input.filename, input.changeLog, ctx.user.id);
    }),

  activateVersion: adminProcedure
    .input(z.object({
      modelId: z.number(),
      versionId: z.number(),
    }))
    .mutation(async ({ input }) => {
      evictSessionCache(input.modelId);
      return activateModelVersion(input.modelId, input.versionId);
    }),

  getFileUrl: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      return getModelFileUrl(input.modelId);
    }),

  // ─── Inference ──────────────────────────────────────────
  runInference: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      imageBase64: z.string(),
      inspectionId: z.number().optional(),
      measurementResultId: z.number().optional(),
      inputReference: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const imageBuffer = Buffer.from(input.imageBase64, "base64");
      return runInference(input.modelId, imageBuffer, {
        inspectionId: input.inspectionId,
        measurementResultId: input.measurementResultId,
        inputReference: input.inputReference,
      });
    }),

  getInferenceResults: protectedProcedure
    .input(z.object({
      modelId: z.number().optional(),
      inspectionId: z.number().optional(),
      measurementResultId: z.number().optional(),
      status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT"]).optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getInferenceResults(input ?? undefined);
    }),

  getInferenceStats: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      return db.getInferenceStats(input.modelId);
    }),

  // ─── Active Model Lookup ────────────────────────────────
  getActiveForProduct: protectedProcedure
    .input(z.object({
      productModelId: z.number(),
      modelType: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return db.getActiveModelForProduct(input.productModelId, input.modelType);
    }),

  // ─── Health Check ───────────────────────────────────────
  loadedModels: protectedProcedure
    .query(async () => {
      return getLoadedModels();
    }),
});
