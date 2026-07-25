/**
 * AI Report Generation Router
 * 
 * Endpoints for generating AI-powered quality and performance reports.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import {
  generateDailyQualitySummary,
  generateRCAReport,
  generateModelPerformanceReport,
  generateExecutiveSummary,
  generateReport,
} from "../services/aiReportGenerator";
// doc 69 W0-3 — factory-scope + per-user rate limit (security gap: NO ownership check
// existed against the calling user, and only the global/IP rate limiter guarded these
// expensive report-generation mutations). See server/_core/aiAnalyticsScope.ts.
import { enforceReportFactoryScope, enforceAiAnalyticsRateLimit } from "../_core/aiAnalyticsScope";

/**
 * doc 69 W0-3 — apply the per-user rate limit + factory-scope enforcement to a report
 * filter before it reaches the (user-unaware) aiReportGenerator service. See
 * server/_core/aiAnalyticsScope.ts `enforceReportFactoryScope` for the exact rule
 * (machineId REQUIRED for scoped/non-admin users — the service has no factory-level
 * filter to silently narrow to).
 */
async function applyReportScope(
  ctx: { user: TrpcContext["user"] },
  input: { machineId?: number; factoryId?: number },
): Promise<void> {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Login required" });
  }
  enforceAiAnalyticsRateLimit(ctx.user.id);
  await enforceReportFactoryScope({ user: ctx.user, machineId: input.machineId, factoryId: input.factoryId });
}

const reportParamsSchema = z.object({
  startDate: z.string().transform(s => new Date(s)),
  endDate: z.string().transform(s => new Date(s)),
  machineId: z.number().optional(),
  factoryId: z.number().optional(),
  language: z.enum(["en", "vi"]).default("en"),
});

export const aiReportRouter = router({
  /**
   * Generate a Daily Quality Summary.
   */
  dailySummary: protectedProcedure
    .input(reportParamsSchema)
    .mutation(async ({ input, ctx }) => {
      await applyReportScope(ctx, input);
      return generateDailyQualitySummary({
        ...input,
        reportType: "daily",
      });
    }),

  /**
   * Generate a Root Cause Investigation report.
   */
  rcaReport: protectedProcedure
    .input(reportParamsSchema.extend({
      triggerReason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await applyReportScope(ctx, input);
      return generateRCAReport({
        ...input,
        reportType: "rca",
      });
    }),

  /**
   * Generate Model Performance report.
   */
  modelPerformance: protectedProcedure
    .input(reportParamsSchema)
    .mutation(async ({ input, ctx }) => {
      await applyReportScope(ctx, input);
      return generateModelPerformanceReport({
        ...input,
        reportType: "model_performance",
      });
    }),

  /**
   * Generate Executive Summary (weekly/monthly).
   */
  executiveSummary: protectedProcedure
    .input(reportParamsSchema)
    .mutation(async ({ input, ctx }) => {
      await applyReportScope(ctx, input);
      return generateExecutiveSummary({
        ...input,
        reportType: "executive",
      });
    }),

  /**
   * Unified report generation endpoint.
   */
  generate: protectedProcedure
    .input(reportParamsSchema.extend({
      reportType: z.enum(["daily", "rca", "model_performance", "executive"]),
      triggerReason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await applyReportScope(ctx, input);
      return generateReport(input);
    }),
});
