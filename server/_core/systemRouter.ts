import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import {
  getSlowQueries,
  getQueryStats,
  getRecentQueries,
  analyzeQueryPatterns,
  clearMetricsHistory,
} from "../queryMonitor";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  // Query Monitoring APIs
  queryMonitoring: router({
    getSlowQueries: adminProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(50),
        })
      )
      .query(({ input }) => {
        return getSlowQueries(input.limit);
      }),

    getStats: adminProcedure
      .query(() => {
        return getQueryStats();
      }),

    getRecentQueries: adminProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(50),
        })
      )
      .query(({ input }) => {
        return getRecentQueries(input.limit);
      }),

    analyzePatterns: adminProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(50).default(20),
        })
      )
      .query(({ input }) => {
        return analyzeQueryPatterns(input.limit);
      }),

    clearHistory: adminProcedure
      .mutation(() => {
        clearMetricsHistory();
        return { success: true };
      }),
  }),

  // Backup/Restore APIs
  exportConfig: adminProcedure
    .input(
      z.object({
        categories: z.array(z.string()),
      })
    )
    .query(async ({ input }) => {
      const db = await import("../db");
      return db.exportSystemConfig(input.categories);
    }),

  importConfig: adminProcedure
    .input(
      z.object({
        data: z.record(z.string(), z.array(z.any())),
        categories: z.array(z.string()),
        overwrite: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await import("../db");
      const dataTyped = input.data as Record<string, any[]>;
      return db.importSystemConfig(dataTyped, input.categories, input.overwrite ?? false);
    }),
});
