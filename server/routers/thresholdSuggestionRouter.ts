/**
 * P4.C G18 — ML auto-threshold tRPC router.
 *
 * Suggests LSL / USL / target for a measurement point from recent samples
 * using a hybrid percentile + parametric estimator with Bayesian shrinkage
 * toward existing limits. Read-only — does NOT mutate the MP definition.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import { suggestThresholds } from "../utils/thresholdSuggestion";

function toNum(x: unknown): number | null {
  if (x == null) return null;
  if (typeof x === "number") return isFinite(x) ? x : null;
  const n = Number(x);
  return isFinite(n) ? n : null;
}

export const thresholdSuggestionRouter = router({
  /** Suggest LSL/USL/target for a single measurement point. */
  suggestForPoint: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive(),
      windowSize: z.number().int().positive().max(20000).optional(),
      fromTs: z.date().optional(),
      toTs: z.date().optional(),
      priorWeight: z.number().min(0).max(1).optional(),
    }))
    .query(async ({ input }) => {
      const def = await db.getMeasurementPointDefById(input.pointDefId);
      if (!def) {
        throw new TRPCError({ code: "NOT_FOUND", message: `MP ${input.pointDefId} not found` });
      }
      const rows = await db.listMeasurementSamples({
        pointDefId: input.pointDefId,
        windowSize: input.windowSize ?? 500,
        fromTs: input.fromTs,
        toTs: input.toTs,
      });
      const values: number[] = [];
      for (const r of rows) {
        const v = toNum((r as any).value);
        if (v !== null) values.push(v);
      }
      const suggestion = suggestThresholds({
        values,
        currentNominal: toNum((def as any).nominalValue),
        currentLsl: toNum((def as any).lowerLimit),
        currentUsl: toNum((def as any).upperLimit),
        priorWeight: input.priorWeight,
      });
      return {
        pointDefId: input.pointDefId,
        code: (def as any).code ?? null,
        name: (def as any).name ?? null,
        unit: (def as any).unit ?? null,
        current: {
          nominal: toNum((def as any).nominalValue),
          lsl: toNum((def as any).lowerLimit),
          usl: toNum((def as any).upperLimit),
        },
        suggestion,
      };
    }),

  /** Batch suggest for many MPs (e.g. by product model). */
  suggestForProductModel: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      windowSize: z.number().int().positive().max(20000).optional(),
      priorWeight: z.number().min(0).max(1).optional(),
      minN: z.number().int().nonnegative().optional(),
    }))
    .query(async ({ input }) => {
      const defs = await db.getMeasurementPointDefsByProductModel(input.productModelId);
      const minN = input.minN ?? 10;
      const results: Array<any> = [];
      for (const def of defs) {
        const rows = await db.listMeasurementSamples({
          pointDefId: (def as any).id,
          windowSize: input.windowSize ?? 500,
        });
        const values: number[] = [];
        for (const r of rows) {
          const v = toNum((r as any).value);
          if (v !== null) values.push(v);
        }
        if (values.length < minN) continue;
        const suggestion = suggestThresholds({
          values,
          currentNominal: toNum((def as any).nominalValue),
          currentLsl: toNum((def as any).lowerLimit),
          currentUsl: toNum((def as any).upperLimit),
          priorWeight: input.priorWeight,
        });
        results.push({
          pointDefId: (def as any).id,
          code: (def as any).code ?? null,
          name: (def as any).name ?? null,
          unit: (def as any).unit ?? null,
          current: {
            nominal: toNum((def as any).nominalValue),
            lsl: toNum((def as any).lowerLimit),
            usl: toNum((def as any).upperLimit),
          },
          suggestion,
        });
      }
      return { productModelId: input.productModelId, count: results.length, items: results };
    }),
});
