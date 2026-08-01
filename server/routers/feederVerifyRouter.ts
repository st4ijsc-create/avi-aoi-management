/**
 * Doc 35 W4-C.1 — Feeder-setup verification router.
 *
 * Endpoints:
 *   - verifyScan   : record one (slot + reel) scan → returns match|mismatch.
 *   - listForSetup : verification history for a machine's setup.
 *   - setupStatus  : aggregated setup-complete / has-mismatch status (run-gate input).
 *   - runGate      : advisory/enforced run-gate check (never throws; honors FEEDER_VERIFY_ENFORCED).
 *
 * Recording works regardless of any flag. Enforcement (block run on mismatch) is
 * gated by FEEDER_VERIFY_ENFORCED (default OFF) inside feederVerifyService.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  verifyScan,
  listForSetup,
  getSetupStatus,
  assertSetupOkForRun,
} from "../services/feederVerifyService";

export const feederVerifyRouter = router({
  verifyScan: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive(),
        slotCode: z.string().max(40).optional(),
        scannedReel: z.string().max(128).optional(),
        scannedComponentCode: z.string().max(100).optional(),
        expectedComponentCode: z.string().max(100).optional(),
        lineId: z.number().int().positive().nullable().optional(),
        productModelId: z.number().int().positive().nullable().optional(),
        programId: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return verifyScan({ ...input, verifiedBy: ctx.user?.id ?? null });
    }),

  listForSetup: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive(),
        productModelId: z.number().int().positive().nullable().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }),
    )
    .query(async ({ input }) => {
      return listForSetup(input.machineId, { productModelId: input.productModelId, limit: input.limit });
    }),

  setupStatus: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive(),
        productModelId: z.number().int().positive().nullable().optional(),
      }),
    )
    .query(async ({ input }) => {
      return getSetupStatus(input.machineId, input.productModelId);
    }),

  runGate: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive(),
        productModelId: z.number().int().positive().nullable().optional(),
      }),
    )
    .query(async ({ input }) => {
      return assertSetupOkForRun(input.machineId, input.productModelId);
    }),
});
