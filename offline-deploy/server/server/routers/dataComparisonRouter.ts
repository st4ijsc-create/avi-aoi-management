/**
 * Data Comparison Router
 * So sánh dữ liệu giữa các kỳ (week-over-week, month-over-month)
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { generateComparison, calculatePreviousPeriod } from "../services/dataComparisonService";
import type { ComparisonPeriod } from "../services/dataComparisonService";

export const dataComparisonRouter = router({
  /**
   * Compare two periods of data
   */
  compare: protectedProcedure
    .input(z.object({
      periodType: z.enum(["day", "week", "month", "quarter", "custom"]),
      currentStart: z.coerce.date(),
      currentEnd: z.coerce.date(),
      previousStart: z.coerce.date().optional(),
      previousEnd: z.coerce.date().optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      machineId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return generateComparison({
        periodType: input.periodType as ComparisonPeriod,
        currentStart: input.currentStart,
        currentEnd: input.currentEnd,
        previousStart: input.previousStart,
        previousEnd: input.previousEnd,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
        machineId: input.machineId,
      });
    }),

  /**
   * Quick comparison presets
   */
  quickCompare: protectedProcedure
    .input(z.object({
      preset: z.enum(["today_vs_yesterday", "this_week_vs_last_week", "this_month_vs_last_month", "this_quarter_vs_last_quarter"]),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const now = new Date();
      let currentStart: Date;
      let currentEnd: Date;
      let periodType: ComparisonPeriod;

      switch (input.preset) {
        case "today_vs_yesterday": {
          currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          currentEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
          periodType = "day";
          break;
        }
        case "this_week_vs_last_week": {
          const dayOfWeek = now.getDay();
          const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset, 0, 0, 0);
          currentEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
          periodType = "week";
          break;
        }
        case "this_month_vs_last_month": {
          currentStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
          currentEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
          periodType = "month";
          break;
        }
        case "this_quarter_vs_last_quarter": {
          const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
          currentStart = new Date(now.getFullYear(), quarterMonth, 1, 0, 0, 0);
          currentEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
          periodType = "quarter";
          break;
        }
      }

      return generateComparison({
        periodType,
        currentStart,
        currentEnd,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
      });
    }),

  /**
   * Get available comparison periods
   */
  getPresets: protectedProcedure.query(() => {
    return [
      { id: "today_vs_yesterday", label: "Hôm nay vs Hôm qua", icon: "calendar" },
      { id: "this_week_vs_last_week", label: "Tuần này vs Tuần trước", icon: "calendar-week" },
      { id: "this_month_vs_last_month", label: "Tháng này vs Tháng trước", icon: "calendar-month" },
      { id: "this_quarter_vs_last_quarter", label: "Quý này vs Quý trước", icon: "calendar-quarter" },
    ];
  }),
});
