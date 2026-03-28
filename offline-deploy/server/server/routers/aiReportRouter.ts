/**
 * AI Report Generation Router
 * 
 * Endpoints for generating AI-powered quality and performance reports.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import {
  generateDailyQualitySummary,
  generateRCAReport,
  generateModelPerformanceReport,
  generateExecutiveSummary,
  generateReport,
} from "../services/aiReportGenerator";

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
    .mutation(async ({ input }) => {
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
    .mutation(async ({ input }) => {
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
    .mutation(async ({ input }) => {
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
    .mutation(async ({ input }) => {
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
    .mutation(async ({ input }) => {
      return generateReport(input);
    }),
});
