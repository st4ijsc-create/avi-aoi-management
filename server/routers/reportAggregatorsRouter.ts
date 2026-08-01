/**
 * Report Aggregators Router (Wave R1, doc 32 §4).
 * ============================================================================
 * tRPC surface for the report data-layer helpers added in
 * server/db/reportAggregators.ts — the "defect analysis", "yield by product"
 * and "yield trend by week" data sources the reporting audit (doc 32 §1.4)
 * flagged as missing. Consumed by later waves (R3 external/mobile report path,
 * R4 web report pages) and directly queryable now.
 *
 * Date-only UI strings ("YYYY-MM-DD") are resolved as FACTORY-local calendar
 * days via utils/kpi.resolveFactoryDateWindow so windows never shift by the
 * factory's UTC offset (doc 27 gap A2).
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { resolveFactoryDateWindow } from "../utils/kpi";
import {
  getDefectParetoByCategory,
  getYieldByProduct,
  getYieldTrendByWeek,
} from "../db/reportAggregators";

const windowInput = {
  startDate: z.string(),
  endDate: z.string(),
  factoryId: z.number().optional(),
  workshopId: z.number().optional(),
  lineId: z.number().optional(),
  machineId: z.number().optional(),
  productModelId: z.number().optional(),
};

export const reportAggregatorsRouter = router({
  /**
   * Defect Pareto rolled up by defect_catalog dimension (category | severity |
   * ipcSection). Complements paretoAnalysis.byDefectClass (individual class) —
   * this is the KIND-of-defect rollup a management defect-analysis report wants.
   * NG rows without a defectCatalogId land in an honest UNCLASSIFIED bucket.
   */
  defectParetoByCategory: protectedProcedure
    .input(
      z.object({
        ...windowInput,
        dimension: z.enum(["category", "severity", "ipcSection"]).optional(),
        topN: z.number().min(3).max(50).optional(),
      }),
    )
    .query(async ({ input }) => {
      const w = resolveFactoryDateWindow(input.startDate, input.endDate);
      return getDefectParetoByCategory({
        startDate: w.start,
        endDate: w.end,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
        machineId: input.machineId,
        productModelId: input.productModelId,
        dimension: input.dimension,
        topN: input.topN,
      });
    }),

  /** Per-product output + canonical final yield over the window. */
  yieldByProduct: protectedProcedure
    .input(z.object(windowInput))
    .query(async ({ input }) => {
      const w = resolveFactoryDateWindow(input.startDate, input.endDate);
      return getYieldByProduct({
        startDate: w.start,
        endDate: w.end,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
        machineId: input.machineId,
        productModelId: input.productModelId,
      });
    }),

  /** Yield trend bucketed by ISO week in the factory timezone. */
  yieldTrendByWeek: protectedProcedure
    .input(z.object(windowInput))
    .query(async ({ input }) => {
      const w = resolveFactoryDateWindow(input.startDate, input.endDate);
      return getYieldTrendByWeek({
        startDate: w.start,
        endDate: w.end,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
        machineId: input.machineId,
        productModelId: input.productModelId,
      });
    }),
});
