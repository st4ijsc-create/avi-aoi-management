/**
 * Phase B4.3 — Executive Report router.
 *
 * Read access to persisted AI executive summaries (shift/day/week) plus an
 * admin-only manual trigger to generate one on demand (for testing without
 * waiting for the cron scheduler). Generation/persistence logic lives in
 * services/aiExecutiveReport.ts; this router is a thin tRPC surface for the UI.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getExecutiveSummaries, runExecutiveReportNow } from "../services/aiExecutiveReport";
import { getExecutiveReportSchedulerStatus } from "../services/reportScheduler";

const periodEnum = z.enum(["shift", "day", "week"]);
const langEnum = z.enum(["vi", "en"]);

export const executiveReportRouter = router({
  /** List persisted executive summaries (latest first), optionally by period. */
  list: protectedProcedure
    .input(
      z
        .object({
          period: periodEnum.optional(),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return getExecutiveSummaries({ period: input?.period, limit: input?.limit ?? 20 });
    }),

  /** Latest single summary (optionally for a period). */
  latest: protectedProcedure
    .input(z.object({ period: periodEnum.optional() }).optional())
    .query(async ({ input }) => {
      const rows = await getExecutiveSummaries({ period: input?.period, limit: 1 });
      return rows[0] ?? null;
    }),

  /** Scheduler + flag status for dashboards. */
  schedulerStatus: protectedProcedure.query(() => getExecutiveReportSchedulerStatus()),

  /** Admin-only: generate + persist a report immediately (manual trigger / testing). */
  generateNow: adminProcedure
    .input(
      z
        .object({
          period: periodEnum.default("day"),
          lang: langEnum.optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      return runExecutiveReportNow(input?.period ?? "day", input?.lang);
    }),
});
