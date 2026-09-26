import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import * as db from "../db";
import { withDbErrors } from "../_core/dbErrors";
import { requirePermission } from "../_core/accessControl";

// doc 42 #15 — RBAC split-brain: quy trình là master-data của app "Quản lý dữ liệu".
// FE gate module `settings_factory`; BE phải khớp (không hardgate role==='admin').
// Admin luôn qua; user được cấp settings_factory qua RoleBuilder thao tác được.
const MODULE = "settings_factory";
const canCreate = protectedProcedure.use(requirePermission(MODULE, "canCreate"));
const canEdit = protectedProcedure.use(requirePermission(MODULE, "canEdit"));
const canDelete = protectedProcedure.use(requirePermission(MODULE, "canDelete"));

export const processRouter = router({
  // List all processes
  list: protectedProcedure
    .input(z.object({
      processType: z.enum(['SMT', 'DIP', 'ASSEMBLY', 'TESTING', 'PACKAGING', 'INSPECTION', 'OTHER']).optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getProcesses(input);
    }),

  // Get process by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const process = await db.getProcessById(input.id);
      if (!process) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'process' }, 'Process not found');
      }
      return process;
    }),

  // Create new process
  create: canCreate
    .input(z.object({
      code: z.string().min(1, 'Mã quy trình là bắt buộc').max(50),
      name: z.string().min(1, 'Tên quy trình là bắt buộc').max(255),
      description: z.string().optional(),
      processType: z.enum(['SMT', 'DIP', 'ASSEMBLY', 'TESTING', 'PACKAGING', 'INSPECTION', 'OTHER']).default('OTHER'),
      cycleTimeTarget: z.number().optional(),
      orderIndex: z.number().default(0),
      color: z.string().default('#3b82f6'),
      icon: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Check if code already exists
      const existing = await db.getProcessByCode(input.code);
      if (existing) {
        throw appError('CONFLICT', 'ENTITY_DUPLICATE', { entity: 'process' }, `Mã quy trình '${input.code}' đã tồn tại`);
      }

      const result = await withDbErrors(() => db.createProcess({
        ...input,
        cycleTimeTarget: input.cycleTimeTarget?.toString(),
      }), { conflictMessage: `Mã quy trình '${input.code}' đã tồn tại` });
      return result;
    }),

  // Update process
  update: canEdit
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      processType: z.enum(['SMT', 'DIP', 'ASSEMBLY', 'TESTING', 'PACKAGING', 'INSPECTION', 'OTHER']).optional(),
      cycleTimeTarget: z.number().optional(),
      orderIndex: z.number().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, cycleTimeTarget, ...rest } = input;
      
      // Check if process exists
      const existing = await db.getProcessById(id);
      if (!existing) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'process' }, 'Process not found');
      }
      
      // Check if new code conflicts with another process
      if (rest.code && rest.code !== existing.code) {
        const codeExists = await db.getProcessByCode(rest.code);
        if (codeExists) {
          throw appError('CONFLICT', 'ENTITY_DUPLICATE', { entity: 'process' }, `Mã quy trình '${rest.code}' đã tồn tại`);
        }
      }

      await withDbErrors(() => db.updateProcess(id, {
        ...rest,
        cycleTimeTarget: cycleTimeTarget?.toString(),
      }), { conflictMessage: 'Mã quy trình đã tồn tại' });
      return { success: true };
    }),

  // Delete process
  delete: canDelete
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const existing = await db.getProcessById(input.id);
      if (!existing) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'process' }, 'Process not found');
      }
      
      await db.deleteProcess(input.id);
      return { success: true };
    }),

  // Reorder processes
  reorder: canEdit
    .input(z.object({
      orderedIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      await db.reorderProcesses(input.orderedIds);
      return { success: true };
    }),

  // Get line process assignments
  getLineAssignments: protectedProcedure
    .input(z.object({ lineId: z.number() }))
    .query(async ({ input }) => {
      return db.getLineProcessAssignments(input.lineId);
    }),

  // doc 42 Đợt 4B (H2 #process→line) — assignments của MỘT quy trình (chọn quy
  // trình → xem nó được gán vào những dây chuyền/trạm nào). getLineProcessAssignments
  // đánh index theo lineId nên không phục vụ chiều này; join line + station để hiện
  // nhãn người-đọc thay vì raw id. Read-only (protectedProcedure, khớp getLineAssignments).
  getAssignmentsByProcess: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ input }) => {
      const database = await db.getDb();
      if (!database) return [];
      const { lineProcessAssignments } = await import("../../drizzle/schema/production");
      const { productionLines, stations } = await import("../../drizzle/schema/hierarchy");
      const { eq, asc } = await import("drizzle-orm");
      return database
        .select({
          id: lineProcessAssignments.id,
          lineId: lineProcessAssignments.lineId,
          lineName: productionLines.name,
          lineCode: productionLines.code,
          stationId: lineProcessAssignments.stationId,
          stationName: stations.name,
          stationCode: stations.code,
          orderIndex: lineProcessAssignments.orderIndex,
          cycleTimeTarget: lineProcessAssignments.cycleTimeTarget,
          isActive: lineProcessAssignments.isActive,
        })
        .from(lineProcessAssignments)
        .leftJoin(productionLines, eq(lineProcessAssignments.lineId, productionLines.id))
        .leftJoin(stations, eq(lineProcessAssignments.stationId, stations.id))
        .where(eq(lineProcessAssignments.processId, input.processId))
        .orderBy(asc(lineProcessAssignments.orderIndex));
    }),

  // Create line process assignment
  createLineAssignment: canCreate
    .input(z.object({
      lineId: z.number(),
      processId: z.number(),
      orderIndex: z.number().default(0),
      cycleTimeTarget: z.number().optional(),
      stationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { cycleTimeTarget, ...rest } = input;
      const result = await db.createLineProcessAssignment({
        ...rest,
        cycleTimeTarget: cycleTimeTarget?.toString(),
      });
      return result;
    }),

  // Update line process assignment
  updateLineAssignment: canEdit
    .input(z.object({
      id: z.number(),
      orderIndex: z.number().optional(),
      cycleTimeTarget: z.number().optional(),
      stationId: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, cycleTimeTarget, ...rest } = input;
      await db.updateLineProcessAssignment(id, {
        ...rest,
        cycleTimeTarget: cycleTimeTarget?.toString(),
      });
      return { success: true };
    }),

  // Delete line process assignment
  deleteLineAssignment: canDelete
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteLineProcessAssignment(input.id);
      return { success: true };
    }),

  // Reorder line process assignments
  reorderLineAssignments: canEdit
    .input(z.object({
      lineId: z.number(),
      orderedIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      await db.reorderLineProcessAssignments(input.lineId, input.orderedIds);
      return { success: true };
    }),
});
