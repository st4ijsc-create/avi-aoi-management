/**
 * B2 — AI Confidence Calibration Router.
 *
 * computeCalibration  (mutation): collect reviewed samples → ECE/MCE/Brier + reliability
 *                                 diagram (+ optional temperature fit) → persist a report.
 * getCalibration / getLatestCalibration / listCalibration (queries): read stored reports.
 *
 * Offline-first (internal Postgres only). Writing a report NEVER changes inference
 * behaviour; temperature stays opt-in via the model's postprocessConfig.temperatureScale.
 */
import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import {
  computeECE,
  fitTemperature,
  collectCalibrationSamples,
} from "../services/aiCalibration";
import {
  createCalibrationReport,
  getCalibrationReport,
  getLatestCalibrationReport,
  listCalibrationReports,
} from "../db";

export const aiCalibrationRouter = router({
  /**
   * Compute calibration metrics for a model over a period/scope and store a report.
   * Returns the persisted report, or { sampleCount: 0, report: null } when there are no
   * reviewed samples (fail-safe — nothing written).
   */
  computeCalibration: adminProcedure
    .input(
      z.object({
        modelId: z.number().int().positive(),
        modelVersion: z.string().max(50).optional(),
        periodStart: z.coerce.date(),
        periodEnd: z.coerce.date(),
        machineId: z.number().int().positive().optional(),
        productModelId: z.number().int().positive().optional(),
        numBins: z.number().int().min(2).max(50).default(10),
        fitTemperature: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const samples = await collectCalibrationSamples({
        modelId: input.modelId,
        period: { start: input.periodStart, end: input.periodEnd },
        scope: { machineId: input.machineId, productModelId: input.productModelId },
      });

      if (!samples || samples.length === 0) {
        return { sampleCount: 0, report: null as null } as const;
      }

      const eceResult = computeECE(samples, input.numBins);

      let temperature: number | undefined;
      let eceAfterTemp: number | undefined;
      let temperatureApproximate = false;
      if (input.fitTemperature) {
        const fit = fitTemperature(samples, { bins: input.numBins });
        if (fit) {
          temperature = fit.temperature;
          eceAfterTemp = fit.eceAfter;
          temperatureApproximate = fit.approximate;
        }
      }

      const report = await createCalibrationReport({
        modelId: input.modelId,
        modelVersion: input.modelVersion ?? null,
        machineId: input.machineId ?? null,
        productModelId: input.productModelId ?? null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        sampleCount: eceResult.sampleCount,
        ece: eceResult.ece.toFixed(6),
        mce: eceResult.mce.toFixed(6),
        brierScore: eceResult.brierScore.toFixed(6),
        temperature: temperature != null ? temperature.toFixed(4) : null,
        eceAfterTemp: eceAfterTemp != null ? eceAfterTemp.toFixed(6) : null,
        numBins: input.numBins,
        reliabilityBins: eceResult.reliabilityBins,
        metadata: {
          temperatureMethod: temperature != null ? "binary-confidence-approx" : null,
          temperatureApproximate,
        },
        createdBy: ctx.user.id,
      });

      return { sampleCount: eceResult.sampleCount, report } as const;
    }),

  getCalibration: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getCalibrationReport(input.id)),

  getLatestCalibration: protectedProcedure
    .input(z.object({ modelId: z.number().int().positive() }))
    .query(({ input }) => getLatestCalibrationReport(input.modelId)),

  listCalibration: protectedProcedure
    .input(
      z.object({
        modelId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(({ input }) =>
      listCalibrationReports({ modelId: input.modelId, limit: input.limit, offset: input.offset }),
    ),
});
