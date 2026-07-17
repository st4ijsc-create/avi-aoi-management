/**
 * Sprint F2 — Process Result tRPC router.
 *
 * `record` captures the OUTCOME of a generic process/station step from any
 * machine type (telemetry result, NOT a control command — there is no machine
 * actuation endpoint here). `listBySerial` reads them back.
 *
 * doc 56 Đ3 — ProcessAnalytics: `stats`/`metricSeries`/`stepTypes` expose the
 * existing aggregate helpers to the UI (ProcessAnalytics page + MachineCockpit
 * tab). Gated by PROCESS_ANALYTICS_ENABLED — OFF returns empty results so the UI
 * degrades to an empty state instead of erroring (byte-identical: the two legacy
 * procedures above are untouched).
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { recordProcessResult } from "../services/processResultService";
import {
  listProcessResultsBySerial,
  aggregateProcessResultStats,
  getProcessMetricSeries,
  listActiveStepTypes,
} from "../db/processResult";
import { MACHINE_TYPES } from "../constants/machineTypes";

const recordInput = z
  .object({
    serialNumber: z.string().min(1).max(128),
    machineId: z.number().int().positive(),
    stepType: z.string().min(1).max(64),
    result: z.enum(["pass", "fail", "warn", "skip"]),
    machineType: z.enum(MACHINE_TYPES).optional(),
    stationId: z.number().int().positive().optional(),
    lineCode: z.string().max(50).optional(),
    productionOrderCode: z.string().max(80).optional(),
    lotCode: z.string().max(80).optional(),
    metrics: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    recipeRef: z.string().max(128).optional(),
    measuredAt: z.coerce.date().optional(),
  })
  .strict();

/** doc 56 Đ3 — analytics ship-dark until the flag is on. */
function processAnalyticsEnabled(): boolean {
  return process.env.PROCESS_ANALYTICS_ENABLED === "true";
}

const sinceFromDays = (days: number): Date =>
  new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 24 * 60 * 60 * 1000);

export const processResultRouter = router({
  record: protectedProcedure
    .input(recordInput)
    .mutation(async ({ input, ctx }) => {
      const userId = (ctx as any)?.user?.id ?? null;
      return recordProcessResult(input, userId);
    }),

  listBySerial: protectedProcedure
    .input(
      z.object({
        serialNumber: z.string().min(1).max(128),
        limit: z.number().int().positive().max(5000).optional(),
      }),
    )
    .query(async ({ input }) => {
      return listProcessResultsBySerial(input.serialNumber, input.limit ?? 1000);
    }),

  // ── doc 56 Đ3 — ProcessAnalytics reads (RBAC: any authenticated user) ──────
  stats: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive().optional(),
        serialNumber: z.string().max(128).optional(),
        stepType: z.string().max(64).optional(),
        sinceDays: z.number().int().positive().max(365).optional(),
      }),
    )
    .query(async ({ input }) => {
      if (!processAnalyticsEnabled()) return { pass: 0, fail: 0, warn: 0, skip: 0 };
      return aggregateProcessResultStats({
        machineId: input.machineId,
        serialNumber: input.serialNumber,
        stepType: input.stepType,
        since: sinceFromDays(input.sinceDays ?? 7),
      });
    }),

  metricSeries: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive().optional(),
        stepType: z.string().max(64).optional(),
        metricKey: z.string().min(1).max(64),
        sinceDays: z.number().int().positive().max(365).optional(),
        bucket: z.enum(["hour", "day"]).optional(),
      }),
    )
    .query(async ({ input }) => {
      if (!processAnalyticsEnabled()) return [];
      return getProcessMetricSeries({
        machineId: input.machineId,
        stepType: input.stepType,
        metricKey: input.metricKey,
        since: sinceFromDays(input.sinceDays ?? 7),
        bucket: input.bucket ?? "hour",
      });
    }),

  stepTypes: protectedProcedure
    .input(z.object({ machineType: z.string().max(40).optional() }).optional())
    .query(async ({ input }) => {
      if (!processAnalyticsEnabled()) return [];
      return listActiveStepTypes(input?.machineType);
    }),
});
