import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { requirePermission } from "../_core/accessControl";

// doc 42 #18 — RBAC split-brain: bố trí xưởng là master-data của "Quản lý dữ liệu".
// FE gate module `settings_factory`; BE khớp permission thay vì hardgate role==='admin'.
const MODULE = "settings_factory";
const canCreate = protectedProcedure.use(requirePermission(MODULE, "canCreate"));
const canEdit = protectedProcedure.use(requirePermission(MODULE, "canEdit"));
const canDelete = protectedProcedure.use(requirePermission(MODULE, "canDelete"));

export const layoutRouter = router({
  listByWorkshop: protectedProcedure
    .input(z.object({ workshopId: z.number() }))
    .query(async ({ input }) => {
      return db.getFactoryLayoutsByWorkshop(input.workshopId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const layout = await db.getFactoryLayoutById(input.id);
      if (!layout) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout not found' });
      }
      
      const positions = await db.getMachinePositionsByLayout(input.id);
      return { layout, positions };
    }),

  create: canCreate
    .input(z.object({
      workshopId: z.number(),
      name: z.string().min(1).max(255),
      layoutType: z.enum(["2D", "3D"]).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      layoutData: z.string().optional(),
      backgroundImageUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createFactoryLayout(input);
      return { id };
    }),

  update: canEdit
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      layoutType: z.enum(["2D", "3D"]).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      layoutData: z.string().optional(),
      backgroundImageUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const existing = await db.getFactoryLayoutById(id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout not found' });
      }
      await db.updateFactoryLayout(id, data);
      return { success: true };
    }),

  // doc 42 #17 — xoá layout (soft-delete). Trước đây thiếu procedure → không dọn được.
  delete: canDelete
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const existing = await db.getFactoryLayoutById(input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout not found' });
      }
      await db.deleteFactoryLayout(input.id);
      return { success: true };
    }),

  addMachinePosition: canEdit
    .input(z.object({
      layoutId: z.number(),
      machineId: z.number(),
      positionX: z.number(),
      positionY: z.number(),
      positionZ: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      rotation: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createMachinePosition(input);
      return { id };
    }),

  updateMachinePosition: canEdit
    .input(z.object({
      id: z.number(),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
      positionZ: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      rotation: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateMachinePosition(id, data);
      return { success: true };
    }),

  removeMachinePosition: canDelete
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteMachinePosition(input.id);
      return { success: true };
    }),
});
