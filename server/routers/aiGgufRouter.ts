/**
 * AI GGUF Router — Local LLM model management & inference via .gguf files
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, moduleProcedure, moduleGate } from "../_core/trpc";
import { appError } from "../_core/appError";
import { adminProcedure as adminProcedureBase } from "./_shared";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
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
// ★ G5-E — bộ cắt chuỗi suy luận. Module LÁ (0 import, 0 I/O) ⇒ import TĨNH, hàng rào vô điều kiện.
import { stripThinking } from "../services/ai/thinkingStrip";

/**
 * ★ G5-E — `generate`/`chat` trả NGUYÊN VẸN đối tượng của engine cho playground/Vision-Lab: ô
 * `text` đi thẳng vào mắt kỹ sư, không qua một bộ lọc nào. Cả hai đều cho phép `modelId` RỖNG ⇒
 * dùng model MẶC ĐỊNH ⇒ đổi roster sang một model họ Qwen3.x là chỗ này phát `<think>`.
 *
 * `stripThinking().answer` đã `.trim()`. Playground là nơi soi đầu ra THÔ, nên khi không có gì bị
 * cắt ta trả lại nguyên văn: bản vá là **no-op từng ký tự** với roster hiện tại
 * (Qwen3-30B-A3B-Instruct không phát `<think>`). `answer === raw.trim()` xảy ra khi và chỉ khi
 * phép quét không xoá ký tự phi-khoảng-trắng nào — mọi lượt cắt thật đều xoá ít nhất một cặp thẻ.
 *
 * Các ô đo lường (`tokensPrompt`/`tokensGenerated`/`modelId`) giữ nguyên: chúng nói về LƯỢT SINH,
 * không phải về chữ hiển thị — nắn chúng theo phép cắt là làm sai số liệu.
 */
function catSuyLuanGiuBien<T extends { text: string }>(ket: T): T {
  const cut = stripThinking(ket.text);
  return { ...ket, text: cut.answer === ket.text.trim() ? ket.text : cut.answer };
}

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
        throw appError(
          "INTERNAL_SERVER_ERROR",
          "OPERATION_FAILED",
          { operation: "loadGgufModel" },
          `Failed to load GGUF model: ${err.message}`,
        );
      }
    }),

  unloadModel: adminProcedure
    .input(z.object({ modelId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const success = await unloadGgufModel(input.modelId);
      if (!success) {
        throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "unloadGgufModel" }, `Model "${input.modelId}" is not loaded`);
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
        return catSuyLuanGiuBien(await generateText(options, modelId));
      } catch (err: any) {
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "generateText" }, `Generation failed: ${err.message}`);
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
        return catSuyLuanGiuBien(await chatCompletion(options, modelId));
      } catch (err: any) {
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "chatCompletion" }, `Chat completion failed: ${err.message}`);
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
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "analyzeDefect" }, `Defect analysis failed: ${err.message}`);
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
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "generateQualityInsights" }, `Insights generation failed: ${err.message}`);
      }
    }),

  // ─── Engine Health ──────────────────────────────────
  health: protectedProcedure.query(async () => {
    return getEngineHealth();
  }),

  // ─── Model Router telemetry (tier distribution for "AI Brain" dashboard) ──
  // Now DB-backed via the AI Gateway: tier distribution is aggregated from the
  // persisted ai_gateway_metrics table (durable across restarts) and merged with the
  // legacy in-memory router counter so pre-gateway callers still register. Shape is
  // kept backward-compatible ({ total, byTier, fastModelConfigured }) for the frontend.
  routerStats: protectedProcedure.query(async () => {
    const [{ getRouterStats }, { getGatewayStats }] = await Promise.all([
      import("../services/aiModelRouter"),
      import("../services/aiGateway"),
    ]);
    const mem = getRouterStats(); // legacy in-memory (route() callers not yet on the gateway)
    const gw = await getGatewayStats(); // DB-backed (gateway callers)

    // Merge tier distributions so the dashboard reflects ALL routed traffic.
    const byTier: Record<number, number> = { ...mem.byTier };
    for (const [tier, count] of Object.entries(gw.byTier)) {
      byTier[Number(tier)] = (byTier[Number(tier)] ?? 0) + (count as number);
    }
    const total = Object.values(byTier).reduce((a, b) => a + b, 0);
    return {
      total,
      byTier,
      fastModelConfigured: mem.fastModelConfigured || gw.fastModelConfigured,
      // Provenance so the UI can label whether numbers are durable (db) or volatile (memory).
      source: gw.source,
    };
  }),

  // ─── AI Gateway stats (tokens / latency / rate-limit / A/B) — DB-backed ──
  // Richer observability surface for the AI Gateway. Honest-empty (zeroes) when nothing
  // has been routed yet; `source` reports whether numbers came from the durable table.
  gatewayStats: protectedProcedure
    .input(z.object({ sinceHours: z.number().min(1).max(720).optional() }).optional())
    .query(async ({ input }) => {
      const { getGatewayStats, isAbEnabled } = await import("../services/aiGateway");
      const stats = await getGatewayStats(input?.sinceHours ?? 24);
      return { ...stats, abEnabled: isAbEnabled() };
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
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "generateEmbedding" }, `Embedding generation failed: ${err.message}`);
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
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "countTokens" }, `Token counting failed: ${err.message}`);
      }
    }),
});
