import { sql } from "drizzle-orm";
import type { CoDanhTinh } from "./_phamViNguoiXem";
import { ghiViTri } from "./_viTriPhamVi";
import { congEdge, congEdgeSuy, pvTrainStats } from "./_aiPhamVi";
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
import {
  createBatchJob,
  cancelBatchJob,
  getBatchJobProgress,
} from "../services/aiBatchEngine";
import {
  collectPerformanceSnapshot,
  getModelHealth,
  acknowledgeDriftAlert,
  resolveDriftAlert,
} from "../services/aiMonitoring";

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

// ─── Combined Advanced AI Router ──────────────────────────────
// Chỉ `batch` và `monitoring` được gắn. Các router training / abTest / edge đã GỠ HẲN (Pha 0 F0-2, 2026-11-04) — không còn mã "giữ để rollback".
export const aiAdvancedRouter = router({
  batch: batchRouter,
  monitoring: monitoringRouter,
});
