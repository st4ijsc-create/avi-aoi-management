/**
 * AI Edge Enhanced Router — Phase 4
 * 
 * Endpoints for model quantization, OTA updates, fleet management, and enhanced sync.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import {
  quantizeModel,
  getQuantizationOptions,
  initiateOTAUpdate,
  getOTAUpdateStatus,
  rollbackDevice,
  getFleetOverview,
  batchDeploy,
  compareDevicePerformance,
  getDeviceHealthHistory,
  syncWithConflictResolution,
  getSyncStatusSummary,
} from "../services/aiEdgeEnhanced";

export const aiEdgeEnhancedRouter = router({
  // ─── Quantization ──────────────────────────────────────────
  quantize: adminProcedure
    .input(z.object({
      modelId: z.number(),
      modelVersion: z.string().min(1),
      targetQuantization: z.enum(["fp32", "fp16", "int8"]),
      calibrationSamples: z.number().min(10).max(1000).optional(),
      validateAccuracy: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      return quantizeModel(input);
    }),

  quantizationOptions: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      modelVersion: z.string().min(1),
    }))
    .query(async ({ input }) => {
      return getQuantizationOptions(input.modelId, input.modelVersion);
    }),

  // ─── OTA Updates ───────────────────────────────────────────
  otaUpdate: adminProcedure
    .input(z.object({
      modelId: z.number(),
      modelVersion: z.string().min(1),
      targetDeviceIds: z.array(z.string()).optional(),
      targetDeviceGroup: z.string().optional(),
      rollbackOnAccuracyDrop: z.number().min(0).max(1).optional(),
      deltaUpdate: z.boolean().optional(),
      priority: z.enum(["low", "normal", "high", "critical"]).optional(),
    }))
    .mutation(async ({ input }) => {
      return initiateOTAUpdate(input);
    }),

  otaStatus: protectedProcedure
    .input(z.object({ updateId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getOTAUpdateStatus(input.updateId);
    }),

  rollback: adminProcedure
    .input(z.object({ deploymentId: z.number() }))
    .mutation(async ({ input }) => {
      return rollbackDevice(input.deploymentId);
    }),

  // ─── Fleet Management ──────────────────────────────────────
  fleetOverview: protectedProcedure
    .query(async () => {
      return getFleetOverview();
    }),

  batchDeploy: adminProcedure
    .input(z.object({
      modelId: z.number(),
      modelVersion: z.string().min(1),
      deviceIds: z.array(z.string().min(1)).min(1).max(100),
      deployConfig: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return batchDeploy({
        ...input,
        createdBy: ctx.user.id,
      });
    }),

  comparePerformance: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      since: z.string().datetime().optional().transform(s => s ? new Date(s) : undefined),
      limit: z.number().min(1).max(200).optional(),
    }))
    .query(async ({ input }) => {
      return compareDevicePerformance(input.modelId, {
        since: input.since,
        limit: input.limit,
      });
    }),

  deviceHealth: protectedProcedure
    .input(z.object({
      deviceId: z.string().min(1),
      days: z.number().min(1).max(90).optional(),
    }))
    .query(async ({ input }) => {
      return getDeviceHealthHistory(input.deviceId, input.days);
    }),

  // ─── Enhanced Sync ─────────────────────────────────────────
  syncWithConflictResolution: protectedProcedure
    .input(z.object({
      deploymentId: z.number(),
      results: z.array(z.object({
        inputReference: z.string(),
        predictions: z.unknown(),
        confidence: z.number().min(0).max(1),
        topLabel: z.string(),
        processingTimeMs: z.number(),
        inferredAt: z.string().datetime().transform(s => new Date(s)),
        inspectionId: z.number().optional(),
        localResultId: z.string().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      return syncWithConflictResolution(input.deploymentId, input.results);
    }),

  syncStatus: protectedProcedure
    .query(async () => {
      return getSyncStatusSummary();
    }),
});
