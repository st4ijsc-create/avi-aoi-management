/**
 * W5-B1 (doc 44, gap G4.12) — NTF / false-call classifier router.
 *
 * NOT auto-registered. To expose it, add to server/routers.ts:
 *     import { ntfClassifierRouter } from "./routers/ntfClassifierRouter";
 *     // inside the root router map:
 *     ntfClassifier: ntfClassifierRouter,
 *
 * Training is on-demand + admin-gated (offline MLOps): it scans reviewed machine-NG
 * inspections, trains a candidate, and promotes it to ACTIVE only when it beats the
 * heuristic baseline (quality gate). Serving stays in ntfPredictorService behind
 * NTF_CLASSIFIER_ENABLED (default OFF) → heuristic fallback.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { desc } from "drizzle-orm";
import { getDb } from "../db/connection";
import { ntfClassifierModels } from "../../drizzle/schema";
import {
  trainNtfClassifier,
  getActiveNtfClassifier,
  FEATURE_SCHEMA,
} from "../services/ai/ntfClassifierService";
import { isNtfClassifierEnabled } from "../services/ai/ntfPredictorService";

export const ntfClassifierRouter = router({
  /** Feature-flag + active-model status (light — no weights). */
  status: protectedProcedure.query(async () => {
    const active = await getActiveNtfClassifier();
    return {
      enabled: isNtfClassifierEnabled(),
      featureSchema: FEATURE_SCHEMA,
      hasActiveModel: !!active,
      activeModel: active
        ? {
            id: active.model.id,
            version: active.model.version,
            metrics: active.model.metrics,
            baselineMetrics: active.model.baselineMetrics,
            gate: active.model.gate,
            classBalance: active.model.classBalance,
            labelDistribution: active.model.labelDistribution,
            activatedAt: active.model.activatedAt,
          }
        : null,
      // Serving uses the trained model only when BOTH the flag is on AND a model is active.
      servingTrained: isNtfClassifierEnabled() && !!active,
    };
  }),

  /** Train a candidate (admin). Promotes to ACTIVE only if the gate passes. */
  train: adminProcedure
    .input(
      z.object({
        machineId: z.number().int().positive().optional(),
        productModelId: z.number().int().positive().optional(),
        sinceDays: z.number().int().positive().max(3650).optional(),
        limit: z.number().int().positive().max(10000).optional(),
        gateMetric: z.enum(["f1", "accuracy"]).optional(),
        gateEpsilon: z.number().min(0).max(1).optional(),
        seed: z.number().int().optional(),
        activate: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        version: z.string().max(50).optional(),
      }).optional(),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await trainNtfClassifier({
        ...(input ?? {}),
        createdBy: (ctx as { user?: { id?: number } }).user?.id,
      });
      // Keep the response light — omit the artifact weight blob.
      const { artifact, ...rest } = result;
      return { ...rest, artifactStored: !!artifact };
    }),

  /** Recent trained models with their metrics (admin). */
  list: adminProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          id: ntfClassifierModels.id,
          version: ntfClassifierModels.version,
          status: ntfClassifierModels.status,
          sampleCount: ntfClassifierModels.sampleCount,
          labelDistribution: ntfClassifierModels.labelDistribution,
          metrics: ntfClassifierModels.metrics,
          baselineMetrics: ntfClassifierModels.baselineMetrics,
          gate: ntfClassifierModels.gate,
          classBalance: ntfClassifierModels.classBalance,
          activatedAt: ntfClassifierModels.activatedAt,
          createdAt: ntfClassifierModels.createdAt,
        })
        .from(ntfClassifierModels)
        .orderBy(desc(ntfClassifierModels.createdAt))
        .limit(input?.limit ?? 25);
    }),
});
