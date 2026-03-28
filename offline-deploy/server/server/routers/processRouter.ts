import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

// Admin procedure - only admin users can access
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});

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
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Process not found' });
      }
      return process;
    }),

  // Create new process
  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
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
        throw new TRPCError({ code: 'CONFLICT', message: 'Process code already exists' });
      }
      
      const result = await db.createProcess({
        ...input,
        cycleTimeTarget: input.cycleTimeTarget?.toString(),
      });
      return result;
    }),

  // Update process
  update: adminProcedure
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
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Process not found' });
      }
      
      // Check if new code conflicts with another process
      if (rest.code && rest.code !== existing.code) {
        const codeExists = await db.getProcessByCode(rest.code);
        if (codeExists) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Process code already exists' });
        }
      }
      
      await db.updateProcess(id, {
        ...rest,
        cycleTimeTarget: cycleTimeTarget?.toString(),
      });
      return { success: true };
    }),

  // Delete process
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const existing = await db.getProcessById(input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Process not found' });
      }
      
      await db.deleteProcess(input.id);
      return { success: true };
    }),

  // Reorder processes
  reorder: adminProcedure
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

  // Create line process assignment
  createLineAssignment: adminProcedure
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
  updateLineAssignment: adminProcedure
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
  deleteLineAssignment: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteLineProcessAssignment(input.id);
      return { success: true };
    }),

  // Reorder line process assignments
  reorderLineAssignments: adminProcedure
    .input(z.object({
      lineId: z.number(),
      orderedIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      await db.reorderLineProcessAssignments(input.lineId, input.orderedIds);
      return { success: true };
    }),
});
