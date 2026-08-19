import { moduleProcedure, moduleGate, router } from "../_core/trpc";
import { adminProcedure as adminProcedureBase } from "./_shared";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import * as db from "../db";
import { getDb } from "../db/connection";
import { eq } from "drizzle-orm";
import { trainingJobs, trainingDatasets, edgeDeployments, abTestExperiments, abTestResults } from "../../drizzle/schema/ai";
import {
  createBatchJob,
  cancelBatchJob,
  getBatchJobProgress,
} from "../services/aiBatchEngine";
import {
  createTrainingJob,
  cancelTrainingJob,
  checkAutoRetrainTrigger,
  createDataset,
} from "../services/aiTrainingPipeline";
import {
  createExperiment,
  startExperiment,
  runABInference,
  submitABFeedback,
  getExperimentStats,
  concludeExperiment,
} from "../services/aiABTesting";
import {
  collectPerformanceSnapshot,
  getModelHealth,
  acknowledgeDriftAlert,
  resolveDriftAlert,
} from "../services/aiMonitoring";
import {
  createEdgeDeployment,
  packageModelForEdge,
  updateDeploymentStatus,
  recordHeartbeat,
  syncEdgeResults,
  getDeviceDeployments,
  checkStaleDeployments,
} from "../services/aiEdgeDeployment";

// ─── Batch Inference ──────────────────────────────────────────
const batchRouter = router({
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      modelId: z.number(),
      inputs: z.array(z.object({
        reference: z.string(),
        type: z.string().optional(),
        data: z.string().optional(),
      })).min(1).max(10000),
      concurrency: z.number().min(1).max(32).optional(),
      priority: z.number().min(0).max(10).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return createBatchJob({
        name: input.name,
        modelId: input.modelId,
        inputs: input.inputs,
        concurrency: input.concurrency,
        priority: input.priority,
        createdBy: ctx.user.id,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const job = await db.getBatchInferenceJob(input.id);
      if (!job) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "batchJob" }, "Batch job not found");
      return job;
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      modelId: z.number().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getBatchInferenceJobs(input ?? undefined);
    }),

  progress: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getBatchJobProgress(input.id);
    }),

  cancel: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return cancelBatchJob(input.id);
    }),

  items: protectedProcedure
    .input(z.object({
      batchJobId: z.number(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return db.getBatchInferenceItems(input.batchJobId, input.status);
    }),
});

// ─── Training Pipeline ────────────────────────────────────────
const trainingRouter = router({
  createJob: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      modelId: z.number(),
      targetVersion: z.string().min(1).max(50),
      datasetConfig: z.record(z.string(), z.unknown()).optional(),
      trainingConfig: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return createTrainingJob({
        name: input.name,
        modelId: input.modelId,
        targetVersion: input.targetVersion,
        datasetConfig: input.datasetConfig as any,
        trainingConfig: input.trainingConfig as any,
        createdBy: ctx.user.id,
      });
    }),

  getJob: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const job = await db.getTrainingJob(input.id);
      if (!job) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "trainingJob" }, "Training job not found");
      return job;
    }),

  listJobs: protectedProcedure
    .input(z.object({
      modelId: z.number().optional(),
      status: z.string().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getTrainingJobs(input ?? undefined);
    }),

  cancelJob: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return cancelTrainingJob(input.id);
    }),

  createDataset: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      modelId: z.number().optional(),
      description: z.string().optional(),
      productModelId: z.number().optional(),
      sourceType: z.string().optional(),
      filterConfig: z.record(z.string(), z.unknown()).optional(),
      splitConfig: z.object({
        train: z.number(),
        validation: z.number(),
        test: z.number(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return createDataset({
        name: input.name,
        modelId: input.modelId,
        description: input.description,
        productModelId: input.productModelId,
        sourceType: input.sourceType,
        filterConfig: input.filterConfig as any,
        splitConfig: input.splitConfig,
        createdBy: ctx.user.id,
      });
    }),

  listDatasets: protectedProcedure
    .input(z.object({
      modelId: z.number().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getTrainingDatasets(input ?? undefined);
    }),

  getDataStats: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      return db.getTrainingDataStats(input.modelId);
    }),

  checkAutoRetrain: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      return checkAutoRetrainTrigger(input.modelId);
    }),

  deleteJob: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [deleted] = await database.delete(trainingJobs).where(eq(trainingJobs.id, input.id)).returning({ id: trainingJobs.id });
      if (!deleted) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "trainingJob" }, "Training job not found");
      return { success: true, id: deleted.id };
    }),

  getDataset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [dataset] = await database.select().from(trainingDatasets).where(eq(trainingDatasets.id, input.id)).limit(1);
      if (!dataset) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "trainingDataset" }, "Training dataset not found");
      return dataset;
    }),

  deleteDataset: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [deleted] = await database.delete(trainingDatasets).where(eq(trainingDatasets.id, input.id)).returning({ id: trainingDatasets.id });
      if (!deleted) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "trainingDataset" }, "Training dataset not found");
      return { success: true, id: deleted.id };
    }),
});

// ─── A/B Testing ──────────────────────────────────────────────
const abTestRouter = router({
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      modelAId: z.number(),
      modelAVersion: z.string().min(1),
      modelBId: z.number(),
      modelBVersion: z.string().min(1),
      trafficSplitPercent: z.number().min(1).max(99).optional(),
      productModelId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return createExperiment({
        ...input,
        createdBy: ctx.user.id,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const exp = await db.getABTestExperiment(input.id);
      if (!exp) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "abTestExperiment" }, "A/B test experiment not found");
      return exp;
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      productModelId: z.number().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getABTestExperiments(input ?? undefined);
    }),

  start: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return startExperiment(input.id);
    }),

  runInference: protectedProcedure
    .input(z.object({
      experimentId: z.number(),
      imageBase64: z.string(),
      inputReference: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const imageBuffer = Buffer.from(input.imageBase64, "base64");
      return runABInference(input.experimentId, imageBuffer, input.inputReference ? { inputReference: input.inputReference } : undefined);
    }),

  submitFeedback: protectedProcedure
    .input(z.object({
      resultId: z.number(),
      feedbackType: z.enum(["CORRECT", "INCORRECT", "PARTIAL"]),
      isCorrect: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      return submitABFeedback(input.resultId, input.feedbackType, input.isCorrect);
    }),

  stats: protectedProcedure
    .input(z.object({ experimentId: z.number() }))
    .query(async ({ input }) => {
      return getExperimentStats(input.experimentId);
    }),

  conclude: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return concludeExperiment(input.id);
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      trafficSplit: z.record(z.string(), z.number()).optional(),
    }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const { id, ...updates } = input;
      const updateData: Record<string, unknown> = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.trafficSplit !== undefined) updateData.trafficSplit = updates.trafficSplit;
      const [updated] = await database.update(abTestExperiments).set(updateData).where(eq(abTestExperiments.id, id)).returning();
      if (!updated) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "abTestExperiment" }, "A/B test experiment not found");
      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      await database.delete(abTestResults).where(eq(abTestResults.experimentId, input.id));
      const [deleted] = await database.delete(abTestExperiments).where(eq(abTestExperiments.id, input.id)).returning({ id: abTestExperiments.id });
      if (!deleted) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "abTestExperiment" }, "A/B test experiment not found");
      return { success: true, id: deleted.id };
    }),
});

// ─── Monitoring & Drift Detection ─────────────────────────────
const monitoringRouter = router({
  collectSnapshot: adminProcedure
    .input(z.object({
      modelId: z.number(),
      modelVersion: z.string(),
      periodStart: z.string().datetime(),
      periodEnd: z.string().datetime(),
    }))
    .mutation(async ({ input }) => {
      return collectPerformanceSnapshot({
        modelId: input.modelId,
        modelVersion: input.modelVersion,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
      });
    }),

  health: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      modelVersion: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return getModelHealth(input.modelId, input.modelVersion);
    }),

  snapshots: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      modelVersion: z.string().optional(),
      lastNDays: z.number().min(1).max(365).optional(),
    }))
    .query(async ({ input }) => {
      return db.getPerformanceSnapshots(input.modelId, input.modelVersion, input.lastNDays);
    }),

  alerts: protectedProcedure
    .input(z.object({
      modelId: z.number().optional(),
      severity: z.string().optional(),
      acknowledged: z.boolean().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getDriftAlerts(input ?? undefined);
    }),

  acknowledgeAlert: adminProcedure
    .input(z.object({ alertId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      return acknowledgeDriftAlert(input.alertId, ctx.user.id);
    }),

  resolveAlert: adminProcedure
    .input(z.object({ alertId: z.number() }))
    .mutation(async ({ input }) => {
      return resolveDriftAlert(input.alertId);
    }),
});

// ─── Edge Deployment ──────────────────────────────────────────
const edgeRouter = router({
  create: adminProcedure
    .input(z.object({
      modelId: z.number(),
      modelVersion: z.string().min(1),
      deviceId: z.string().min(1).max(255),
      deviceName: z.string().min(1).max(255),
      deviceType: z.string().max(100).optional(),
      machineId: z.number().optional(),
      deployConfig: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return createEdgeDeployment({
        ...input,
        createdBy: ctx.user.id,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const dep = await db.getEdgeDeployment(input.id);
      if (!dep) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "edgeDeployment" }, "Edge deployment not found");
      return dep;
    }),

  list: protectedProcedure
    .input(z.object({
      modelId: z.number().optional(),
      status: z.string().optional(),
      machineId: z.number().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getEdgeDeployments(input ?? undefined);
    }),

  packageModel: adminProcedure
    .input(z.object({ deploymentId: z.number() }))
    .mutation(async ({ input }) => {
      return packageModelForEdge(input.deploymentId);
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      deploymentId: z.number(),
      status: z.string(),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return updateDeploymentStatus(input.deploymentId, input.status as any, input.errorMessage);
    }),

  heartbeat: protectedProcedure
    .input(z.object({
      deploymentId: z.number(),
      pendingResults: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      return recordHeartbeat(input.deploymentId, input.pendingResults);
    }),

  syncResults: protectedProcedure
    .input(z.object({
      deploymentId: z.number(),
      results: z.array(z.object({
        inputReference: z.string(),
        predictions: z.record(z.string(), z.unknown()),
        confidence: z.number(),
        topLabel: z.string(),
        processingTimeMs: z.number(),
        inferredAt: z.string().datetime(),
      })),
    }))
    .mutation(async ({ input }) => {
      return syncEdgeResults(input.deploymentId, input.results.map(r => ({
        ...r,
        inferredAt: new Date(r.inferredAt),
      })));
    }),

  deviceDeployments: protectedProcedure
    .input(z.object({ deviceId: z.string() }))
    .query(async ({ input }) => {
      return getDeviceDeployments(input.deviceId);
    }),

  staleDeployments: protectedProcedure
    .input(z.object({ thresholdMinutes: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return checkStaleDeployments(input?.thresholdMinutes);
    }),

  inferenceResults: protectedProcedure
    .input(z.object({
      deploymentId: z.number().optional(),
      deviceId: z.string().optional(),
      synced: z.boolean().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getEdgeInferenceResults(input ?? undefined);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [deleted] = await database.delete(edgeDeployments).where(eq(edgeDeployments.id, input.id)).returning({ id: edgeDeployments.id });
      if (!deleted) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "edgeDeployment" }, "Edge deployment not found");
      return { success: true, id: deleted.id };
    }),
});

// ─── Combined Advanced AI Router ──────────────────────────────
// DISABLED (local-AI migration): training, abTest, edge sub-routers no longer registered.
// Kept in source for rollback; only `batch` and `monitoring` are exposed.
export const aiAdvancedRouter = router({
  batch: batchRouter,
  // training: trainingRouter,
  // abTest: abTestRouter,
  monitoring: monitoringRouter,
  // edge: edgeRouter,
});

// Suppress unused-binding warnings for retained code blocks.
void trainingRouter; void abTestRouter; void edgeRouter;
