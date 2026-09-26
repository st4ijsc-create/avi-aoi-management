/**
 * AI Local Training Router — Phase 4.2
 *
 * Endpoints for built-in transfer, few-shot, and incremental learning.
 */

import { z } from "zod";
import { router, moduleProcedure, moduleGate, adminProcedure as adminProcedureBase } from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { getDb } from "../db/connection";
import { eq, desc } from "drizzle-orm";
import { trainingJobs } from "../../drizzle/schema/ai";
import {
  startLocalTraining,
  getTrainingCapabilities,
  predictWithLocalClassifier,
  type TrainingStrategy,
} from "../services/aiLocalTraining";

export const aiLocalTrainingRouter = router({
  // ─── Start Training Job ─────────────────────────────────────
  startTraining: adminProcedure
    .input(z.object({
      modelId: z.number(),
      strategy: z.enum(["transfer", "fewshot", "incremental"]),
      targetVersion: z.string().min(1),
      classLabels: z.array(z.string().min(1)).min(2).max(100),
      config: z.object({
        epochs: z.number().min(1).max(500).optional(),
        learningRate: z.number().min(0.00001).max(1).optional(),
        batchSize: z.number().min(1).max(256).optional(),
        earlyStopping: z.boolean().optional(),
        patience: z.number().min(1).max(100).optional(),
        validationSplit: z.number().min(0.05).max(0.5).optional(),
        samplesPerClass: z.number().min(1).max(100).optional(),
        incrementalSince: z.string().datetime().optional()
          .transform(s => s ? new Date(s) : undefined),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return startLocalTraining({
        modelId: input.modelId,
        strategy: input.strategy as TrainingStrategy,
        targetVersion: input.targetVersion,
        classLabels: input.classLabels,
        config: input.config,
        createdBy: ctx.user.id,
      });
    }),

  // ─── Get Training Capabilities ──────────────────────────────
  capabilities: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      return getTrainingCapabilities(input.modelId);
    }),

  // ─── Predict With Local Classifier ──────────────────────────
  predict: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      classifierPath: z.string().min(1),
      imagePath: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return predictWithLocalClassifier(input.modelId, input.classifierPath, input.imagePath);
    }),

  // ─── List Training Jobs ─────────────────────────────────────
  listJobs: protectedProcedure
    .input(z.object({
      modelId: z.number().optional(),
      status: z.string().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const params = input ?? { limit: 20, offset: 0 };
      let query = database.select().from(trainingJobs).orderBy(desc(trainingJobs.createdAt)).$dynamic();
      if (params.modelId) query = query.where(eq(trainingJobs.modelId, params.modelId));
      if (params.status) query = query.where(eq(trainingJobs.status, params.status as any));
      const jobs = await query.limit(params.limit).offset(params.offset);
      return { items: jobs, total: jobs.length };
    }),

  // ─── Get Training Job ───────────────────────────────────────
  getJob: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [job] = await database.select().from(trainingJobs).where(eq(trainingJobs.id, input.id)).limit(1);
      if (!job) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "trainingJob" }, "Training job not found");
      return job;
    }),

  // ─── Delete Training Job ────────────────────────────────────
  deleteJob: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [deleted] = await database.delete(trainingJobs).where(eq(trainingJobs.id, input.id)).returning({ id: trainingJobs.id });
      if (!deleted) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "trainingJob" }, "Training job not found");
      return { success: true, id: deleted.id };
    }),
});
