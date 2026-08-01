/**
 * Pareto Analysis Router
 * API cho phân tích 80/20 defects
 */

import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_QUALITY (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_QUALITY");
import { paretoByDefectType, paretoByMachine, paretoByLine, paretoByTimePeriod } from "../services/paretoAnalysisService";
import { getDefectClassPareto } from "../services/aiInspectionAnalytics";
import { getPackageDefectPareto } from "../services/componentPackageAnalytics";
import { resolveFactoryDateWindow } from "../utils/kpi";

export const paretoAnalysisRouter = router({
  /**
   * Doc 27 gap A6 (W5-A) — Pareto by DEFECT CLASS (IPC-A-610 defect_catalog).
   * Complements (does NOT replace) byDefectType: that one groups by
   * measurement-point name ("where do we fail"); this one groups by
   * defectCatalogId ("what kind of defect"). Date-only strings are resolved
   * as FACTORY-local calendar days (utils/kpi.resolveFactoryDateWindow).
   * Response is shaped like the other Pareto endpoints (items/category/…)
   * so the existing Pareto UI renders it, plus class metadata + honest
   * unclassified count.
   */
  byDefectClass: protectedProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      topN: z.number().min(3).max(50).optional(),
    }))
    .query(async ({ input }) => {
      const window = resolveFactoryDateWindow(input.startDate, input.endDate);
      const result = await getDefectClassPareto({
        startDate: window.start,
        endDate: window.end,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
        machineId: input.machineId,
        productModelId: input.productModelId,
        topN: input.topN,
      });

      // Map to the ParetoAnalysisResult wire shape the Pareto UI consumes.
      let cumulativeCount = 0;
      const items = result.items.map((i) => {
        cumulativeCount += i.count;
        return {
          category: i.bucket === "class" ? `${i.code} — ${i.name}` : i.name,
          categoryId: i.defectCatalogId ?? undefined,
          count: i.count,
          percentage: i.percentage,
          cumulativeCount,
          cumulativePercentage: i.cumulativePercentage,
          // Class extras (additive — ignored by the generic renderer).
          code: i.code,
          severity: i.severity,
          ipcReference: i.ipcReference,
          bucket: i.bucket,
        };
      });
      const pareto80 = items.filter((i) => i.cumulativePercentage <= 80);
      if (pareto80.length < items.length && items[pareto80.length]) {
        pareto80.push(items[pareto80.length]);
      }
      return {
        items,
        totalDefects: result.totalDefects,
        pareto80Count: pareto80.length,
        pareto80Categories: pareto80.map((i) => i.category),
        analysisType: "defect_class",
        dateRange: { start: window.start, end: window.end },
        classifiedDefects: result.classifiedDefects,
        unclassifiedDefects: result.unclassifiedDefects,
      };
    }),

  /**
   * Doc 27 M12a / doc 29 §1.3 (W8-A) — Pareto by COMPONENT PACKAGE. Third cut of
   * the "defect type" tab: WHERE we fail (point) / WHAT KIND (IPC class) /
   * WHICH PACKAGE (this — BGA vs 0201 vs SOT-23 have different defect
   * profiles). Linkage: measurement_results → point_defs.componentCode →
   * materials.packageId → component_packages (0191). Results whose chain does
   * not resolve land in an honest UNLINKED bucket (never hidden), with a
   * breakdown of why. Wire shape mirrors the other Pareto endpoints so the
   * existing UI renders it.
   */
  byPackage: protectedProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      topN: z.number().min(3).max(50).optional(),
    }))
    .query(async ({ input }) => {
      const window = resolveFactoryDateWindow(input.startDate, input.endDate);
      const result = await getPackageDefectPareto({
        startDate: window.start,
        endDate: window.end,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
        machineId: input.machineId,
        productModelId: input.productModelId,
        topN: input.topN,
      });

      // Map to the ParetoAnalysisResult wire shape the Pareto UI consumes.
      let cumulativeCount = 0;
      const items = result.items.map((i) => {
        cumulativeCount += i.count;
        return {
          category: i.bucket === "package" && i.family ? `${i.code} (${i.family})` : i.code,
          categoryId: i.packageId ?? undefined,
          count: i.count,
          percentage: i.percentage,
          cumulativeCount,
          cumulativePercentage: i.cumulativePercentage,
          // Package extras (additive — ignored by the generic renderer).
          code: i.code,
          family: i.family,
          bucket: i.bucket,
        };
      });
      const pareto80 = items.filter((i) => i.cumulativePercentage <= 80);
      if (pareto80.length < items.length && items[pareto80.length]) {
        pareto80.push(items[pareto80.length]);
      }
      return {
        items,
        totalDefects: result.totalDefects,
        pareto80Count: pareto80.length,
        pareto80Categories: pareto80.map((i) => i.category),
        analysisType: "component_package",
        dateRange: { start: window.start, end: window.end },
        linkedDefects: result.linkedDefects,
        unlinkedDefects: result.unlinkedDefects,
        unlinkedBreakdown: result.unlinkedBreakdown,
      };
    }),

  /**
   * Pareto analysis by defect type
   */
  byDefectType: protectedProcedure
    .input(z.object({
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      machineId: z.number().optional(),
      limit: z.number().min(5).max(100).optional(),
    }))
    .query(({ input }) => paretoByDefectType(input)),

  /**
   * Pareto analysis by machine
   */
  byMachine: protectedProcedure
    .input(z.object({
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      limit: z.number().min(5).max(100).optional(),
    }))
    .query(({ input }) => paretoByMachine(input)),

  /**
   * Pareto analysis by production line
   */
  byLine: protectedProcedure
    .input(z.object({
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      limit: z.number().min(5).max(100).optional(),
    }))
    .query(({ input }) => paretoByLine(input)),

  /**
   * Pareto analysis by time period
   */
  byTimePeriod: protectedProcedure
    .input(z.object({
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      groupBy: z.enum(["hour", "shift", "day", "week"]),
      factoryId: z.number().optional(),
      machineId: z.number().optional(),
      limit: z.number().min(5).max(100).optional(),
    }))
    .query(({ input }) => paretoByTimePeriod(input)),
});
