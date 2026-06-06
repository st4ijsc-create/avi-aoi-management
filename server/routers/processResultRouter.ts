/**
 * Sprint F2 — Process Result tRPC router.
 *
 * `record` captures the OUTCOME of a generic process/station step from any
 * machine type (telemetry result, NOT a control command — there is no machine
 * actuation endpoint here). `listBySerial` reads them back.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { recordProcessResult } from "../services/processResultService";
import { listProcessResultsBySerial } from "../db/processResult";
import { MACHINE_TYPES } from "../constants/machineTypes";

const recordInput = z
  .object({
    serialNumber: z.string().min(1).max(128),
    machineId: z.number().int().positive(),
    stepType: z.string().min(1).max(64),
    result: z.enum(["pass", "fail", "warn", "skip"]),
    machineType: z.enum(MACHINE_TYPES).optional(),
    stationId: z.number().int().positive().optional(),
    lineCode: z.string().max(50).optional(),
    productionOrderCode: z.string().max(80).optional(),
    lotCode: z.string().max(80).optional(),
    metrics: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    recipeRef: z.string().max(128).optional(),
    measuredAt: z.coerce.date().optional(),
  })
  .strict();

export const processResultRouter = router({
  record: protectedProcedure
    .input(recordInput)
    .mutation(async ({ input, ctx }) => {
      const userId = (ctx as any)?.user?.id ?? null;
      return recordProcessResult(input, userId);
    }),

  listBySerial: protectedProcedure
    .input(
      z.object({
        serialNumber: z.string().min(1).max(128),
        limit: z.number().int().positive().max(5000).optional(),
      }),
    )
    .query(async ({ input }) => {
      return listProcessResultsBySerial(input.serialNumber, input.limit ?? 1000);
    }),
});
