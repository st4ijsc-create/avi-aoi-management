/**
 * Pareto Analysis Router
 * API cho phân tích 80/20 defects
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { paretoByDefectType, paretoByMachine, paretoByLine, paretoByTimePeriod } from "../services/paretoAnalysisService";

export const paretoAnalysisRouter = router({
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
