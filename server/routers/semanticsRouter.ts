/**
 * Semantics router — doc 44 Batch W2-A4 (gaps G2.14 + G2.15).
 * SYNAPSE Tầng 2 §9 (Semantic Layer) + §10.2 (MetricResult).
 *
 * READ-ONLY thin layer over server/services/semantics/metricRegistry:
 *   • list    — every governed metric definition (as-code, versioned in
 *               contracts/metrics/*.yaml)
 *   • get     — one full definition (formula + declared lineage inputs)
 *   • compute — MetricResult through the ONE canonical implementation,
 *               always stamped with definition_version ("OEE@v1")
 *
 * compute windows are capped at 90 days (registry delegates to live/rollup
 * paths — anything larger belongs to the reporting mart). Honest registry
 * errors (UNSUPPORTED_SCOPE / SCOPE_ID_REQUIRED / WINDOW_NOT_SUPPORTED) map to
 * BAD_REQUEST; unknown metric → NOT_FOUND. No writes anywhere.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import {
  listMetrics,
  getDefinition,
  computeMetric,
  MetricComputeError,
} from "../services/semantics/metricRegistry";

const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const computeInput = z
  .object({
    metric: z.string().trim().min(1).max(100),
    scope: z.string().trim().min(1).max(50),
    scopeId: z.number().int().positive().optional(),
    from: z.date(),
    to: z.date(),
  })
  .refine((v) => v.to.getTime() > v.from.getTime(), {
    message: "`to` must be after `from`",
  })
  .refine((v) => v.to.getTime() - v.from.getTime() <= MAX_WINDOW_MS, {
    message: "window must be at most 90 days",
  });

export const semanticsRouter = router({
  /** Governed metric catalogue: [{metric, version, scope, formula, inputs, definition_version}]. */
  list: protectedProcedure.query(() => listMetrics()),

  /** One full definition (adds implementation pointer + notes + lineage). */
  get: protectedProcedure
    .input(z.object({ metric: z.string().trim().min(1).max(100) }))
    .query(({ input }) => {
      const def = getDefinition(input.metric);
      if (!def) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "metricDefinition" }, `Unknown metric "${input.metric}" — see semantics.list`);
      }
      return def;
    }),

  /** Compute a metric via its canonical implementation → MetricResult (§10.2). */
  compute: protectedProcedure.input(computeInput).query(async ({ input }) => {
    try {
      return await computeMetric(input.metric, {
        scope: input.scope,
        scopeId: input.scopeId,
        from: input.from,
        to: input.to,
      });
    } catch (e) {
      if (e instanceof MetricComputeError) {
        throw appError(e.code === "METRIC_NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST", "OPERATION_FAILED", { operation: "computeMetric" }, e.message);
      }
      throw e;
    }
  }),
});
