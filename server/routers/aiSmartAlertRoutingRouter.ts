/**
 * AI Smart Alert Routing Router
 *
 * Endpoints for intelligent alert routing, escalation management,
 * defect spike / yield drop detection, and routing statistics.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import {
  routeAlert,
  acknowledgeAlert,
  processAutoEscalation,
  detectDefectSpike,
  detectYieldDrop,
  getAlertRoutingStats,
  cleanupStaleAlerts,
} from "../services/aiSmartAlertRouter";

const alertTypeEnum = z.enum([
  "DEFECT_SPIKE",
  "YIELD_DROP",
  "MACHINE_FAILURE",
  "QUALITY_DEGRADATION",
  "PATTERN_ANOMALY",
]);

const severityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const aiSmartAlertRoutingRouter = router({
  /** Route a new smart alert to appropriate users */
  route: adminProcedure
    .input(
      z.object({
        type: alertTypeEnum,
        severity: severityEnum,
        message: z.string().min(1).max(2000),
        machineId: z.number().int().positive().optional(),
        factoryId: z.number().int().positive().optional(),
        productModelId: z.number().int().positive().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return routeAlert({
        type: input.type,
        severity: input.severity,
        message: input.message,
        machineId: input.machineId,
        factoryId: input.factoryId,
        productModelId: input.productModelId,
        data: (input.data as Record<string, unknown>) ?? {},
      });
    }),

  /** Acknowledge an alert */
  acknowledge: protectedProcedure
    .input(z.object({ alertId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const success = await acknowledgeAlert(input.alertId, userId);
      return { success };
    }),

  /** Detect defect spike on a machine */
  detectSpike: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive(),
        windowMinutes: z.number().int().min(5).max(480).default(30),
        spikeThreshold: z.number().min(1).max(10).default(2.0),
      })
    )
    .query(async ({ input }) => {
      const event = await detectDefectSpike(
        input.machineId,
        input.windowMinutes,
        input.spikeThreshold
      );
      return { detected: !!event, event };
    }),

  /** Detect yield drop at a factory */
  detectYieldDrop: protectedProcedure
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        dropThresholdPercent: z.number().min(1).max(50).default(5.0),
      })
    )
    .query(async ({ input }) => {
      const event = await detectYieldDrop(
        input.factoryId,
        input.dropThresholdPercent
      );
      return { detected: !!event, event };
    }),

  /** Process auto-escalation for unacknowledged alerts */
  processEscalation: adminProcedure.mutation(async () => {
    const escalatedCount = await processAutoEscalation();
    return { escalatedCount };
  }),

  /** Get alert routing statistics */
  stats: protectedProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(90).default(7),
      })
    )
    .query(async ({ input }) => {
      return getAlertRoutingStats(input.days);
    }),

  /** Cleanup stale in-memory alert entries */
  cleanup: adminProcedure.mutation(async () => {
    cleanupStaleAlerts();
    return { success: true };
  }),
});
