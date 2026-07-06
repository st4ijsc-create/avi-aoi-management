import { protectedProcedure, writeProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";

// ============ SHIFT CONFIG ROUTER ============
export const shiftConfigRouter = router({
  list: protectedProcedure
    .input(z.object({ factoryId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return db.getShiftConfigs(input?.factoryId);
    }),

  defaults: protectedProcedure
    .query(async () => {
      return db.getDefaultShiftConfigs();
    }),

  create: writeProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      name: z.string(),
      code: z.string(),
      startHour: z.number().min(0).max(23),
      startMinute: z.number().min(0).max(59).optional(),
      endHour: z.number().min(0).max(23),
      endMinute: z.number().min(0).max(59).optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      return db.createShiftConfig(input);
    }),

  update: writeProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      code: z.string().optional(),
      startHour: z.number().min(0).max(23).optional(),
      startMinute: z.number().min(0).max(59).optional(),
      endHour: z.number().min(0).max(23).optional(),
      endMinute: z.number().min(0).max(59).optional(),
      isActive: z.boolean().optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateShiftConfig(id, data);
      return { success: true };
    }),

  delete: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteShiftConfig(input.id);
      return { success: true };
    }),
});
