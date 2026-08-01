/**
 * W7-B (doc 27 §9 gap V2, Đợt 7 item 7.2) — read API over the harvested
 * operator-corrections ledger (measurement_corrections, migration 0188).
 *
 * READ-ONLY: writes happen only at the harvest sites inside
 * measurementResult.correctResult / inspection.confirmNTF (fail-open, additive).
 * Consumed by the QualityCockpit "Máy hay báo giả" card — complementary to
 * W5-A's FalseCallEscapePanel (that one reads inspection-row NTF flips only;
 * this one adds harvested corrections + agreement rate).
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getAgreementTrend,
  getMachineFalseCallSummary,
} from "../services/ai/measurementCorrectionsService";

const dateRangeInput = {
  // YYYY-MM-DD (cockpit scope) or full ISO strings both parse.
  startDate: z.string().min(1),
  endDate: z.string().min(1),
};

function parseRange(input: { startDate: string; endDate: string }) {
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  // Whole-day inclusive end for date-only strings (cockpit passes YYYY-MM-DD).
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) end.setHours(23, 59, 59, 999);
  return { start, end };
}

export const measurementCorrectionsRouter = router({
  /** Per-machine false-call / agreement summary, worst first ("Máy hay báo giả"). */
  machineFalseCallSummary: protectedProcedure
    .input(z.object({
      ...dateRangeInput,
      machineId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }))
    .query(async ({ input }) => {
      const { start, end } = parseRange(input);
      return getMachineFalseCallSummary({
        startDate: start,
        endDate: end,
        machineId: input.machineId,
        limit: input.limit,
      });
    }),

  /** Daily NG→cleared + harvested-corrections trend (factory-local days). */
  agreementTrend: protectedProcedure
    .input(z.object({
      ...dateRangeInput,
      machineId: z.number().int().positive().optional(),
    }))
    .query(async ({ input }) => {
      const { start, end } = parseRange(input);
      return getAgreementTrend({
        startDate: start,
        endDate: end,
        machineId: input.machineId,
      });
    }),
});
