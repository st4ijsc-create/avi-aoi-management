/**
 * AI Inspection Analytics Router — Trend analysis, Pareto, forecasting, risk assessment
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { appError } from "../_core/appError";
import type { TrpcContext } from "../_core/context";
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
import { getCachedOrFetch } from "../services/cacheService";
// doc 69 W0-3 — factory-scope + per-user rate limit (security gap: NO ownership check
// existed against the calling user, and only the global/IP rate limiter guarded these
// expensive aggregations). See server/_core/aiAnalyticsScope.ts for the full rationale.
import { enforceAnalyticsFactoryScope, enforceAiAnalyticsRateLimit } from "../_core/aiAnalyticsScope";

// 5-minute TTL for analytics responses (ms)
const ANALYTICS_TTL_MS = 5 * 60 * 1000;

// Build cache key from period input + endpoint name + extras
function analyticsCacheKey(
  endpoint: string,
  input: { startDate: Date; endDate: Date; machineId?: number; factoryCode?: string; lineCode?: string; productModel?: string; machineType?: string },
  extras?: Record<string, unknown>,
): string {
  const base = [
    endpoint,
    input.startDate.toISOString(),
    input.endDate.toISOString(),
    input.machineId ?? "all",
    input.factoryCode ?? "all",
    input.lineCode ?? "all",
    input.productModel ?? "all",
    // doc 69 Wave 2 / A1 — machineType must be part of the cache key, otherwise a
    // filtered and an unfiltered request for the same period/machine/factory/line
    // would collide on the SAME cache entry and one would serve the other's data.
    input.machineType ?? "all",
  ].join(":");
  if (extras) {
    const extra = Object.entries(extras)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(",");
    return extra ? `analytics:${base}:${extra}` : `analytics:${base}`;
  }
  return `analytics:${base}`;
}

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
  // doc 69 Wave 2 / A1 — machineType as a first-class filter dimension (AOI/AVI/
  // SPI/...). Optional + additive: omitted → identical behavior to before this task.
  machineType: z.string().optional(),
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
    throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, "Login required");
  }

  const rolloutPercent = getRolloutPercent();
  if (user.role === "admin" || isInRollout(user.id, rolloutPercent)) {
    return next();
  }

  // Canary rollout theo TỪNG NGƯỜI DÙNG (không phải cờ tắt/bật toàn hệ thống) — dùng
  // PERMISSION_DENIED thay vì FEATURE_DISABLED để không nói sai "tính năng chưa bật
  // trên hệ thống này" trong khi những người dùng khác trong % rollout đang dùng bình
  // thường (đúng bài học Task 7 I-2 về 2FA cấp tài khoản vs cấp hệ thống).
  throw appError(
    "FORBIDDEN",
    "PERMISSION_DENIED",
    { action: "useAiAnalyticsCanary" },
    `AI Analytics is in canary rollout (${rolloutPercent}%).`,
  );
});

/**
 * doc 69 W0-3 — apply the per-user rate limit + factory-scope enforcement to an
 * analytics filter, BEFORE it reaches the (user-unaware) analytics service. Called as
 * the first line of every analytics procedure below rather than as a shared `.use()`
 * middleware, because `.input()` is attached per-endpoint (some endpoints `.extend()`
 * `periodInput` with extra fields) — running the check inside the resolver guarantees
 * it always sees the fully-PARSED input regardless of where `.input()` sits in that
 * endpoint's chain. Returns the input with `factoryCode` narrowed/validated; throws
 * FORBIDDEN (scope) or TOO_MANY_REQUESTS (rate limit) otherwise.
 */
async function applyAnalyticsScope<T extends { factoryCode?: string; machineId?: number; lineCode?: string }>(
  ctx: { user: TrpcContext["user"] },
  input: T,
): Promise<T> {
  if (!ctx.user) {
    throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, "Login required");
  }
  enforceAiAnalyticsRateLimit(ctx.user.id);
  const { factoryCode } = await enforceAnalyticsFactoryScope({
    user: ctx.user,
    factoryCode: input.factoryCode,
    machineId: input.machineId,
    lineCode: input.lineCode,
  });
  return { ...input, factoryCode };
}

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
      const scoped = await applyAnalyticsScope(ctx, input);
      const days = (scoped.endDate.getTime() - scoped.startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (days > 90) {
        console.warn(`[aiAnalyticsRouter] MAX_RANGE_EXCEEDED: User ${ctx.user?.id} requested ${days.toFixed(1)} days (max 90)`);
      }
      return getCachedOrFetch(analyticsCacheKey("defectTrend", scoped), () => getDefectTrend(scoped), ANALYTICS_TTL_MS);
    }),

  // ─── Pareto Analysis ────────────────────────────────
  defectPareto: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input, ctx }) => {
      const scoped = await applyAnalyticsScope(ctx, input);
      return getCachedOrFetch(analyticsCacheKey("defectPareto", scoped), () => getDefectPareto(scoped), ANALYTICS_TTL_MS);
    }),

  // ─── Machine Performance Comparison ─────────────────
  machinePerformance: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input, ctx }) => {
      const scoped = await applyAnalyticsScope(ctx, input);
      return getCachedOrFetch(analyticsCacheKey("machinePerformance", scoped), () => getMachinePerformance(scoped), ANALYTICS_TTL_MS);
    }),

  // ─── Yield Forecast ─────────────────────────────────
  yieldForecast: analyticsRolloutProcedure
    .input(periodInput.extend({
      horizonDays: z.number().min(1).max(30).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const { horizonDays, ...rest } = input;
      const params = await applyAnalyticsScope(ctx, rest);
      return getCachedOrFetch(
        analyticsCacheKey("yieldForecast", params, { horizonDays }),
        () => forecastYield(params, horizonDays),
        ANALYTICS_TTL_MS,
      );
    }),

  // ─── Correlation Analysis ───────────────────────────
  correlations: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input, ctx }) => {
      const scoped = await applyAnalyticsScope(ctx, input);
      // getCorrelationAnalysis already has internal cache; outer cache is no-op-cheap
      return getCachedOrFetch(analyticsCacheKey("correlations", scoped), () => getCorrelationAnalysis(scoped), ANALYTICS_TTL_MS);
    }),

  // ─── Risk Assessment ────────────────────────────────
  riskAssessment: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input, ctx }) => {
      const scoped = await applyAnalyticsScope(ctx, input);
      return getCachedOrFetch(analyticsCacheKey("riskAssessment", scoped), () => assessRisks(scoped), ANALYTICS_TTL_MS);
    }),

  // ─── Control Chart (SPC) ────────────────────────────
  controlChart: analyticsRolloutProcedure
    .input(periodInput.extend({
      metric: z.enum(["yield", "defectRate", "cycleTime"]).optional(),
      // Optional: when provided, real USL/LSL/nominal are looked up from the
      // measurement-point definition so Cpk reflects actual spec capability.
      // Omitted → no spec → cpk=null + cpkNote (we never fabricate spec limits).
      measurementPointDefId: z.number().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const { metric, measurementPointDefId, ...rest } = input;
      const params = await applyAnalyticsScope(ctx, rest);

      // Resolve real specification limits from the measurement-point definition.
      // (Same source as spcAdvancedRouter.capability — keeps Cpk consistent across modules.)
      let specLimits: { usl?: number; lsl?: number } | undefined;
      if (measurementPointDefId != null) {
        const { getDb } = await import("../db/connection");
        const database = await getDb();
        if (database) {
          const { measurementPointDefs } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const [pointDef] = await database
            .select()
            .from(measurementPointDefs)
            .where(eq(measurementPointDefs.id, measurementPointDefId));
          if (pointDef) {
            const usl = pointDef.upperLimit != null ? Number(pointDef.upperLimit) : undefined;
            const lsl = pointDef.lowerLimit != null ? Number(pointDef.lowerLimit) : undefined;
            if ((usl != null && Number.isFinite(usl)) || (lsl != null && Number.isFinite(lsl))) {
              specLimits = {
                usl: usl != null && Number.isFinite(usl) ? usl : undefined,
                lsl: lsl != null && Number.isFinite(lsl) ? lsl : undefined,
              };
            }
          }
        }
      }

      return getCachedOrFetch(
        analyticsCacheKey("controlChart", params, { metric, mp: measurementPointDefId }),
        () => getControlChart(params, metric, specLimits),
        ANALYTICS_TTL_MS,
      );
    }),

  // ─── Shift Analysis ─────────────────────────────────
  shiftAnalysis: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input, ctx }) => {
      const scoped = await applyAnalyticsScope(ctx, input);
      return getCachedOrFetch(analyticsCacheKey("shiftAnalysis", scoped), () => getShiftAnalysis(scoped), ANALYTICS_TTL_MS);
    }),

  // ─── Defect Heatmap ─────────────────────────────────
  defectHeatmap: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input, ctx }) => {
      const scoped = await applyAnalyticsScope(ctx, input);
      return getCachedOrFetch(analyticsCacheKey("defectHeatmap", scoped), () => getDefectHeatmap(scoped), ANALYTICS_TTL_MS);
    }),

  // ─── Comprehensive Report ───────────────────────────
  comprehensiveReport: analyticsRolloutProcedure
    .input(periodInput)
    .query(async ({ input, ctx }) => {
      const scoped = await applyAnalyticsScope(ctx, input);
      return getCachedOrFetch(analyticsCacheKey("comprehensiveReport", scoped), () => generateComprehensiveReport(scoped), ANALYTICS_TTL_MS);
    }),
});
