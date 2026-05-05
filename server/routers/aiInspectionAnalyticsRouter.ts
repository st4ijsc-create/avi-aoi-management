/**
 * AI Inspection Analytics Router — Trend analysis, Pareto, forecasting, risk assessment
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import {
  getDefectTrend,
  getDefectPareto,
  getMachinePerformance,
  forecastYield,
  getCorrelationAnalysis,
  assessRisks,
  getControlChart,
  getShiftAnalysis,
  getDefectHeatmap,
  generateComprehensiveReport,
} from "../services/aiInspectionAnalytics";

const DEFAULT_ROLLOUT_PERCENT = 100;

function getRolloutPercent(): number {
  const raw = process.env.AI_ANALYTICS_ROLLOUT_PERCENT;
  if (!raw) return DEFAULT_ROLLOUT_PERCENT;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_ROLLOUT_PERCENT;

  return Math.max(0, Math.min(100, Math.floor(parsed)));
}

function getUserBucket(userId: number): number {
  return Math.abs(userId) % 100;
}

function isInRollout(userId: number, rolloutPercent: number): boolean {
  if (rolloutPercent >= 100) return true;
  if (rolloutPercent <= 0) return false;
  return getUserBucket(userId) < rolloutPercent;
}

const periodInput = z.object({
  startDate: z.string().transform(s => new Date(s)),
  endDate: z.string().transform(s => new Date(s)),
  machineId: z.number().optional(),
  factoryCode: z.string().optional(),
  lineCode: z.string().optional(),
  productModel: z.string().optional(),
})
  .refine(
    (data) => {
      const diff = data.endDate.getTime() - data.startDate.getTime();
      const days = diff / (1000 * 60 * 60 * 24);
      return days <= 90; // MAX: 90 days to prevent OOM
    },
    { message: "Date range must be ≤ 90 days (MAX_RANGE_EXCEEDED)" }
  )
  .refine(
    (data) => data.startDate < data.endDate,
    { message: "startDate must be before endDate" }
  );

const analyticsRolloutProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const user = ctx.user;
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Login required" });
  }

  const rolloutPercent = getRolloutPercent();
  if (user.role === "admin" || isInRollout(user.id, rolloutPercent)) {
    return next();
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: `AI Analytics is in canary rollout (${rolloutPercent}%).`,
  });
});

export const aiInspectionAnalyticsRouter = router({
  rolloutStatus: protectedProcedure.query(({ ctx }) => {
    const rolloutPercent = getRolloutPercent();
    const userId = ctx.user?.id ?? 0;
    const bucket = getUserBucket(userId);
    const enabled = !!ctx.user && (ctx.user.role === "admin" || isInRollout(userId, rolloutPercent));

    return {
      enabled,
      rolloutPercent,
      userBucket: bucket,
      userRole: ctx.user?.role ?? null,
    };
  }),

  // ─── Trend Analysis ─────────────────────────────────
  defectTrend: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input, ctx }) => {
      const days = (input.endDate.getTime() - input.startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (days > 90) {
        console.warn(`[aiAnalyticsRouter] MAX_RANGE_EXCEEDED: User ${ctx.user?.id} requested ${days.toFixed(1)} days (max 90)`);
      }
      return getDefectTrend(input);
    }),

  // ─── Pareto Analysis ────────────────────────────────
  defectPareto: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input }) => {
      return getDefectPareto(input);
    }),

  // ─── Machine Performance Comparison ─────────────────
  machinePerformance: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input }) => {
      return getMachinePerformance(input);
    }),

  // ─── Yield Forecast ─────────────────────────────────
  yieldForecast: analyticsRolloutProcedure
    .input(periodInput.extend({
      horizonDays: z.number().min(1).max(30).optional(),
    }))
    .query(async ({ input }) => {
      const { horizonDays, ...params } = input;
      return forecastYield(params, horizonDays);
    }),

  // ─── Correlation Analysis ───────────────────────────
  correlations: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input }) => {
      return getCorrelationAnalysis(input);
    }),

  // ─── Risk Assessment ────────────────────────────────
  riskAssessment: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input }) => {
      return assessRisks(input);
    }),

  // ─── Control Chart (SPC) ────────────────────────────
  controlChart: analyticsRolloutProcedure
    .input(periodInput.extend({
      metric: z.enum(["yield", "defectRate", "cycleTime"]).optional(),
    }))
    .query(async ({ input }) => {
      const { metric, ...params } = input;
      return getControlChart(params, metric);
    }),

  // ─── Shift Analysis ─────────────────────────────────
  shiftAnalysis: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input }) => {
      return getShiftAnalysis(input);
    }),

  // ─── Defect Heatmap ─────────────────────────────────
  defectHeatmap: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input }) => {
      return getDefectHeatmap(input);
    }),

  // ─── Comprehensive Report ───────────────────────────
  comprehensiveReport: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input }) => {
      return generateComprehensiveReport(input);
    }),
});
