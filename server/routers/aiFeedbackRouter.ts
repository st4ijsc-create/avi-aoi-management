/**
 * AI Feedback Router - User feedback cho AI suggestions để cải thiện model
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { protectedProcedure as thuTucVanHanh, moduleProcedure, router } from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
import { getDb } from "../db";
import { 
  aiSuggestions, 
  aiFeedback, 
  aiModelMetrics,
  aiTrainingBatches
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

export const aiFeedbackRouter = router({
  // ============= AI Suggestions =============
  
  // Create AI suggestion
  createSuggestion: protectedProcedure
    .input(z.object({
      inspectionId: z.number(),
      measurementResultId: z.number().optional(),
      suggestionType: z.enum([
        "DEFECT_CLASSIFICATION",
        "ROOT_CAUSE",
        "CORRECTIVE_ACTION",
        "QUALITY_PREDICTION",
        "PROCESS_OPTIMIZATION"
      ]),
      suggestion: z.string(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().optional(),
      alternatives: z.array(z.object({
        suggestion: z.string(),
        confidence: z.number(),
      })).optional(),
      modelVersion: z.string().optional(),
      modelName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const [result] = await db.insert(aiSuggestions).values({
        inspectionId: input.inspectionId,
        measurementResultId: input.measurementResultId,
        suggestionType: input.suggestionType,
        suggestion: input.suggestion,
        confidence: String(input.confidence),
        reasoning: input.reasoning,
        alternatives: input.alternatives,
        modelVersion: input.modelVersion || "1.0.0",
        modelName: input.modelName || "default",
        status: "PENDING",
      }).returning({ id: aiSuggestions.id });

      return { id: result.id };
    }),

  // Get suggestions by inspection
  // ⚠⚠ CỐ Ý **KHÔNG** khoá sau MOD_AI. `AISuggestionsPanel` được `pages/InspectionDetail.tsx`
  //    gắn **VÔ ĐIỀU KIỆN** (không cờ, không kiểm giấy phép) — mà /inspection/:id là màn CỐT LÕI
  //    của mọi khách. Khoá ở đây ⇒ khách KHÔNG mua AI thấy một khối lỗi giữa trang xem chi tiết
  //    kiểm tra. Muốn khoá thì phải ẩn panel ở client TRƯỚC — xem báo cáo mục (b).
  getSuggestionsByInspection: thuTucVanHanh
    .input(z.object({ inspectionId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      return db
        .select()
        .from(aiSuggestions)
        .where(eq(aiSuggestions.inspectionId, input.inspectionId))
        .orderBy(desc(aiSuggestions.createdAt));
    }),

  // Get pending suggestions
  getPendingSuggestions: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      suggestionType: z.enum([
        "DEFECT_CLASSIFICATION",
        "ROOT_CAUSE",
        "CORRECTIVE_ACTION",
        "QUALITY_PREDICTION",
        "PROCESS_OPTIMIZATION"
      ]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { suggestions: [], total: 0 };

      const conditions = [eq(aiSuggestions.status, "PENDING")];
      if (input.suggestionType) {
        conditions.push(eq(aiSuggestions.suggestionType, input.suggestionType));
      }

      const suggestions = await db
        .select()
        .from(aiSuggestions)
        .where(and(...conditions))
        .orderBy(desc(aiSuggestions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(aiSuggestions)
        .where(and(...conditions));

      return {
        suggestions,
        total: countResult?.count || 0,
      };
    }),

  // ============= Feedback =============

  // Submit feedback
  // ⚠⚠ CỐ Ý **KHÔNG** khoá — cùng lý do với `getSuggestionsByInspection` ở trên (cùng một panel).
  submitFeedback: thuTucVanHanh
    .input(z.object({
      suggestionId: z.number(),
      feedbackType: z.enum(["CORRECT", "INCORRECT", "PARTIAL", "UNSURE"]),
      accuracy: z.number().min(0).max(100).optional(),
      correctedValue: z.string().optional(),
      correctionNotes: z.string().optional(),
      errorCategory: z.enum([
        "FALSE_POSITIVE",
        "FALSE_NEGATIVE",
        "MISCLASSIFICATION",
        "WRONG_LOCATION",
        "WRONG_SEVERITY",
        "OTHER"
      ]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Verify suggestion exists
      const [suggestion] = await db
        .select()
        .from(aiSuggestions)
        .where(eq(aiSuggestions.id, input.suggestionId));

      if (!suggestion) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "suggestion" }, "Suggestion không tồn tại");
      }

      // Create feedback
      const [result] = await db.insert(aiFeedback).values({
        suggestionId: input.suggestionId,
        feedbackType: input.feedbackType,
        accuracy: input.accuracy,
        correctedValue: input.correctedValue,
        correctionNotes: input.correctionNotes,
        errorCategory: input.errorCategory,
        feedbackBy: ctx.user.id,
        feedbackByName: ctx.user.name || ctx.user.username,
      }).returning({ id: aiFeedback.id });

      // Update suggestion status
      const newStatus = input.feedbackType === "CORRECT" ? "ACCEPTED" 
        : input.feedbackType === "INCORRECT" ? "REJECTED" 
        : "REVIEWED";

      await db
        .update(aiSuggestions)
        .set({ status: newStatus })
        .where(eq(aiSuggestions.id, input.suggestionId));

      return { id: result.id };
    }),

  // List feedback
  listFeedback: protectedProcedure
    .input(z.object({
      feedbackType: z.enum(["CORRECT", "INCORRECT", "PARTIAL", "UNSURE"]).optional(),
      errorCategory: z.enum([
        "FALSE_POSITIVE",
        "FALSE_NEGATIVE",
        "MISCLASSIFICATION",
        "WRONG_LOCATION",
        "WRONG_SEVERITY",
        "OTHER"
      ]).optional(),
      includedInTraining: z.boolean().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { feedback: [], total: 0 };

      const conditions = [];
      if (input.feedbackType) conditions.push(eq(aiFeedback.feedbackType, input.feedbackType));
      if (input.errorCategory) conditions.push(eq(aiFeedback.errorCategory, input.errorCategory));
      if (input.includedInTraining !== undefined) {
        conditions.push(eq(aiFeedback.includedInTraining, input.includedInTraining));
      }

      const feedback = await db
        .select()
        .from(aiFeedback)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(aiFeedback.feedbackAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(aiFeedback)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return {
        feedback,
        total: countResult?.count || 0,
      };
    }),

  // ============= Model Metrics =============

  // Get model metrics
  getModelMetrics: protectedProcedure
    .input(z.object({
      modelName: z.string().optional(),
      modelVersion: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions = [];
      if (input.modelName) conditions.push(eq(aiModelMetrics.modelName, input.modelName));
      if (input.modelVersion) conditions.push(eq(aiModelMetrics.modelVersion, input.modelVersion));
      if (input.startDate) conditions.push(gte(aiModelMetrics.periodStart, new Date(input.startDate)));
      if (input.endDate) conditions.push(lte(aiModelMetrics.periodEnd, new Date(input.endDate)));

      return db
        .select()
        .from(aiModelMetrics)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(aiModelMetrics.generatedAt));
    }),

  // Calculate metrics
  calculateMetrics: protectedProcedure
    .input(z.object({
      modelName: z.string(),
      modelVersion: z.string(),
      startDate: z.string(),
      endDate: z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const periodStart = new Date(input.startDate);
      const periodEnd = new Date(input.endDate);

      // Get all suggestions for this model
      const suggestions = await db
        .select()
        .from(aiSuggestions)
        .where(and(
          eq(aiSuggestions.modelName, input.modelName),
          eq(aiSuggestions.modelVersion, input.modelVersion),
          gte(aiSuggestions.createdAt, periodStart),
          lte(aiSuggestions.createdAt, periodEnd),
        ));

      // Get feedback
      const suggestionIds = suggestions.map(s => s.id);
      const feedback = suggestionIds.length > 0 
        ? await db
            .select()
            .from(aiFeedback)
            .where(inArray(aiFeedback.suggestionId, suggestionIds))
        : [];

      // Calculate metrics
      const totalSuggestions = suggestions.length;
      const reviewedSuggestions = feedback.length;
      const correctCount = feedback.filter(f => f.feedbackType === "CORRECT").length;
      const incorrectCount = feedback.filter(f => f.feedbackType === "INCORRECT").length;
      const partialCount = feedback.filter(f => f.feedbackType === "PARTIAL").length;

      const accuracy = reviewedSuggestions > 0 ? correctCount / reviewedSuggestions : 0;

      // Save metrics
      const [result] = await db.insert(aiModelMetrics).values({
        modelName: input.modelName,
        modelVersion: input.modelVersion,
        periodStart,
        periodEnd,
        totalSuggestions,
        reviewedSuggestions,
        correctCount,
        incorrectCount,
        partialCount,
        accuracy: String(accuracy),
        accuracyTrend: "STABLE",
      }).returning({ id: aiModelMetrics.id });

      return { 
        id: result.id, 
        accuracy, 
        totalSuggestions, 
        reviewedSuggestions 
      };
    }),

  // ============= Training Batches =============

  // Create training batch
  createTrainingBatch: protectedProcedure
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      feedbackIds: z.array(z.number()).optional(),
      feedbackType: z.enum(["CORRECT", "INCORRECT", "PARTIAL", "UNSURE"]).optional(),
      exportFormat: z.enum(["JSON", "CSV", "JSONL", "PARQUET"]).default("JSONL"),
      targetModelName: z.string().optional(),
      targetModelVersion: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const batchId = randomUUID();

      // Get feedback to include
      let feedbackToInclude;
      if (input.feedbackIds && input.feedbackIds.length > 0) {
        feedbackToInclude = await db
          .select()
          .from(aiFeedback)
          .where(inArray(aiFeedback.id, input.feedbackIds));
      } else if (input.feedbackType) {
        feedbackToInclude = await db
          .select()
          .from(aiFeedback)
          .where(and(
            eq(aiFeedback.feedbackType, input.feedbackType),
            eq(aiFeedback.includedInTraining, false),
          ));
      } else {
        feedbackToInclude = await db
          .select()
          .from(aiFeedback)
          .where(eq(aiFeedback.includedInTraining, false));
      }

      const correctSamples = feedbackToInclude.filter(f => f.feedbackType === "CORRECT").length;
      const incorrectSamples = feedbackToInclude.filter(f => f.feedbackType === "INCORRECT").length;

      // Create batch
      const [result] = await db.insert(aiTrainingBatches).values({
        batchId,
        name: input.name,
        description: input.description,
        feedbackCount: feedbackToInclude.length,
        correctSamples,
        incorrectSamples,
        exportFormat: input.exportFormat,
        status: "PENDING",
        targetModelName: input.targetModelName,
        targetModelVersion: input.targetModelVersion,
        createdBy: ctx.user.id,
        createdByName: ctx.user.name || ctx.user.username,
      }).returning({ id: aiTrainingBatches.id });

      // Mark feedback as included
      if (feedbackToInclude.length > 0) {
        const feedbackIds = feedbackToInclude.map(f => f.id);
        await db
          .update(aiFeedback)
          .set({ 
            includedInTraining: true,
            trainingBatchId: batchId,
          })
          .where(inArray(aiFeedback.id, feedbackIds));
      }

      return { 
        id: result.id, 
        batchId, 
        feedbackCount: feedbackToInclude.length 
      };
    }),

  // List training batches
  listTrainingBatches: protectedProcedure
    .input(z.object({
      status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "UPLOADED"]).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { batches: [], total: 0 };

      const conditions = [];
      if (input.status) conditions.push(eq(aiTrainingBatches.status, input.status));

      const batches = await db
        .select()
        .from(aiTrainingBatches)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(aiTrainingBatches.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(aiTrainingBatches)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return {
        batches,
        total: countResult?.count || 0,
      };
    }),

  // Export training batch.
  // W7-B (doc 27 V2): `includeCorrections` (additive, default false) appends the
  // harvested operator corrections (measurement_corrections, migration 0188) as
  // a SECOND training-data source — the aiSuggestions feedback path below is
  // untouched, so existing consumers see the exact same `data`/`format`/`count`.
  exportTrainingBatch: protectedProcedure
    .input(z.object({
      batchId: z.string(),
      includeCorrections: z.boolean().optional().default(false),
      correctionsSinceDays: z.number().int().min(1).max(365).optional(),
      correctionsLimit: z.number().int().min(1).max(5000).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Get batch
      const [batch] = await db
        .select()
        .from(aiTrainingBatches)
        .where(eq(aiTrainingBatches.batchId, input.batchId));

      if (!batch) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "trainingBatch" }, "Training batch không tồn tại");
      }

      // Get feedback with suggestions
      const feedback = await db
        .select({
          feedback: aiFeedback,
          suggestion: aiSuggestions,
        })
        .from(aiFeedback)
        .innerJoin(aiSuggestions, eq(aiFeedback.suggestionId, aiSuggestions.id))
        .where(eq(aiFeedback.trainingBatchId, input.batchId));

      // Format data
      const exportData = feedback.map(({ feedback: fb, suggestion }) => ({
        suggestionId: suggestion.id,
        inspectionId: suggestion.inspectionId,
        suggestionType: suggestion.suggestionType,
        originalSuggestion: suggestion.suggestion,
        confidence: suggestion.confidence,
        feedbackType: fb.feedbackType,
        correctedValue: fb.correctedValue,
        errorCategory: fb.errorCategory,
        accuracy: fb.accuracy,
      }));

      // W7-B (doc 27 V2) — second source: harvested operator corrections
      // (machineLabel vs humanLabel + image-ref snapshot). Fail-open: a
      // corrections read problem never breaks the primary export.
      let corrections: unknown[] = [];
      if (input.includeCorrections) {
        try {
          const { getCorrectionTrainingSamples } = await import("../services/ai/measurementCorrectionsService");
          corrections = await getCorrectionTrainingSamples({
            limit: input.correctionsLimit,
            since: input.correctionsSinceDays
              ? new Date(Date.now() - input.correctionsSinceDays * 86_400_000)
              : undefined,
          });
        } catch (err) {
          console.warn("[aiFeedback.exportTrainingBatch] corrections source skipped (fail-open):", err instanceof Error ? err.message : err);
        }
      }

      // Update batch status
      await db
        .update(aiTrainingBatches)
        .set({
          status: "COMPLETED",
          completedAt: new Date(),
        })
        .where(eq(aiTrainingBatches.batchId, input.batchId));

      return {
        data: exportData,
        format: batch.exportFormat,
        count: exportData.length,
        // Additive fields — absent-by-default semantics preserved for old callers.
        corrections,
        correctionCount: corrections.length,
      };
    }),

  // ============= Dashboard Stats =============

  // Get dashboard stats
  getDashboardStats: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return {
        totalSuggestions: 0,
        pendingReview: 0,
        reviewedToday: 0,
        accuracy: 0,
        recentFeedback: [],
      };

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get counts
      const [totalResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(aiSuggestions);

      const [pendingResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(aiSuggestions)
        .where(eq(aiSuggestions.status, "PENDING"));

      const [todayResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(aiFeedback)
        .where(gte(aiFeedback.feedbackAt, today));

      // Calculate accuracy
      const [correctResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(aiFeedback)
        .where(eq(aiFeedback.feedbackType, "CORRECT"));

      const [totalFeedbackResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(aiFeedback);

      const accuracy = totalFeedbackResult?.count && totalFeedbackResult.count > 0
        ? ((correctResult?.count || 0) / totalFeedbackResult.count) * 100
        : 0;

      // Get recent feedback
      const recentFeedback = await db
        .select()
        .from(aiFeedback)
        .orderBy(desc(aiFeedback.feedbackAt))
        .limit(10);

      return {
        totalSuggestions: totalResult?.count || 0,
        pendingReview: pendingResult?.count || 0,
        reviewedToday: todayResult?.count || 0,
        accuracy,
        recentFeedback,
      };
    }),
});

export type AiFeedbackRouter = typeof aiFeedbackRouter;
