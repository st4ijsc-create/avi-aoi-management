import { protectedProcedure, writeProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";
import { hangTheoNhaMay, caLamViecGhi } from "./_cauHinhPhamVi";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";

// ============ SHIFT CONFIG ROUTER ============
export const shiftConfigRouter = router({
  list: protectedProcedure
    .input(z.object({ factoryId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      // phạm vi người dùng (L9 2026-10-25): ca của nhà máy khác ẩn; ca toàn cục (factoryId NULL) dùng chung
      return db.getShiftConfigs(input?.factoryId, await idsTrongPhamVi("factory", phamViCua(ctx), { strict: true }));
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
    .mutation(async ({ input, ctx }) => {
      await hangTheoNhaMay(ctx, input.factoryId, "factory"); // phạm vi nhà máy (W13): ca mặc định toàn cục chỉ toàn quyền tạo
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
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await caLamViecGhi(ctx, id);
      await db.updateShiftConfig(id, data);
      return { success: true };
    }),

  delete: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await caLamViecGhi(ctx, input.id);
      await db.deleteShiftConfig(input.id);
      return { success: true };
    }),
});
