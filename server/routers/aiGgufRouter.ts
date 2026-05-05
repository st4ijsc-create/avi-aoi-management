/**
 * AI GGUF Router — Local LLM model management & inference via .gguf files
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import {
  loadGgufModel,
  unloadGgufModel,
  generateText,
  chatCompletion,
  analyzeDefect,
  generateQualityInsights,
  listGgufModels,
  getLoadedGgufModels,
  isGgufAvailable,
  getEngineHealth,
  generateEmbedding,
  generateTextStream,
  chatCompletionStream,
  countTokens,
} from "../services/aiGgufEngine";
import { getAIProviderStatus } from "../services/aiProviderManager";

export const aiGgufRouter = router({
  // ─── Status ──────────────────────────────────────────
  status: protectedProcedure.query(async () => {
    return {
      available: await isGgufAvailable(),
      loadedModels: getLoadedGgufModels(),
    };
  }),

  // ─── AI Provider Status (all providers) ──────────────
  providerStatus: protectedProcedure.query(async () => {
    return getAIProviderStatus();
  }),

  // ─── Model Management ───────────────────────────────
  listModels: protectedProcedure.query(async () => {
    return listGgufModels();
  }),

  loadModel: adminProcedure
    .input(z.object({
      modelPath: z.string().min(1),
      contextSize: z.number().min(256).max(131072).optional(),
      gpuLayers: z.number().min(-1).max(200).optional(),
      threads: z.number().min(1).max(64).optional(),
      batchSize: z.number().min(32).max(4096).optional(),
      flashAttention: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const modelId = await loadGgufModel(input);
        return { success: true, modelId };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to load GGUF model: ${err.message}`,
        });
      }
    }),

  unloadModel: adminProcedure
    .input(z.object({ modelId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const success = await unloadGgufModel(input.modelId);
      if (!success) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Model "${input.modelId}" is not loaded`,
        });
      }
      return { success: true };
    }),

  // ─── Text Generation ────────────────────────────────
  generate: protectedProcedure
    .input(z.object({
      prompt: z.string().min(1).max(8000),
      systemPrompt: z.string().max(4000).optional(),
      modelId: z.string().optional(),
      maxTokens: z.number().min(1).max(4096).optional(),
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().min(0).max(1).optional(),
      topK: z.number().min(1).max(100).optional(),
      repeatPenalty: z.number().min(1).max(2).optional(),
      stopSequences: z.array(z.string()).optional(),
      jsonMode: z.boolean().optional(),
      language: z.enum(["en", "vi"]).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { modelId, ...options } = input;
        return await generateText(options, modelId);
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Generation failed: ${err.message}`,
        });
      }
    }),

  // ─── Chat Completion ────────────────────────────────
  chat: protectedProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })).min(1),
      modelId: z.string().optional(),
      maxTokens: z.number().min(1).max(4096).optional(),
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().min(0).max(1).optional(),
      topK: z.number().min(1).max(100).optional(),
      repeatPenalty: z.number().min(1).max(2).optional(),
      jsonMode: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { modelId, ...options } = input;
        return await chatCompletion(options, modelId);
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Chat completion failed: ${err.message}`,
        });
      }
    }),

  // ─── Specialized AOI Functions ──────────────────────
  analyzeDefect: protectedProcedure
    .input(z.object({
      productModel: z.string(),
      measurementPoint: z.string(),
      result: z.string(),
      measuredValue: z.number().optional(),
      confidence: z.number().optional(),
      machineCode: z.string().optional(),
      modelId: z.string().optional(),
      language: z.enum(["en", "vi"]).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { modelId, language, ...defectInfo } = input;
        const analysis = await analyzeDefect(defectInfo, modelId, language ?? "vi");
        return { analysis };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Defect analysis failed: ${err.message}`,
        });
      }
    }),

  qualityInsights: protectedProcedure
    .input(z.object({
      data: z.object({
        totalInspections: z.number(),
        passCount: z.number(),
        failCount: z.number(),
        passRate: z.number(),
        topDefects: z.array(z.object({
          type: z.string(),
          count: z.number(),
          percentage: z.number(),
        })),
        periodStart: z.string(),
        periodEnd: z.string(),
        machineCode: z.string().optional(),
      }),
      modelId: z.string().optional(),
      language: z.enum(["en", "vi"]).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const insights = await generateQualityInsights(input.data, input.modelId, input.language ?? "vi");
        return { insights };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Insights generation failed: ${err.message}`,
        });
      }
    }),

  // ─── Engine Health ──────────────────────────────────
  health: protectedProcedure.query(async () => {
    return getEngineHealth();
  }),

  // ─── Embedding ──────────────────────────────────────
  embedding: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(8000),
      modelId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await generateEmbedding(input.text, input.modelId);
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Embedding generation failed: ${err.message}`,
        });
      }
    }),

  // ─── Token Counting ─────────────────────────────────
  tokenCount: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(32000),
      modelId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const count = await countTokens(input.text, input.modelId);
        return { tokenCount: count, textLength: input.text.length };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Token counting failed: ${err.message}`,
        });
      }
    }),
});
