import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const productionOrderRouter = router({
  list: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      status: z.string().optional(),
      companyCode: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getProductionOrders(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getProductionOrderById(input.id);
    }),

  getByCode: protectedProcedure
    .input(z.object({ orderCode: z.string() }))
    .query(async ({ input }) => {
      return db.getProductionOrderByCode(input.orderCode);
    }),

  create: adminProcedure
    .input(z.object({
      orderCode: z.string().min(1).max(100),
      companyCode: z.string().min(1).max(50),
      factoryId: z.number(),
      workshopId: z.number(),
      lineId: z.number(),
      productModelId: z.number(),
      targetQuantity: z.number().min(1),
      priority: z.number().optional(),
      plannedStartDate: z.date().optional(),
      plannedEndDate: z.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createProductionOrder({
        ...input,
        createdBy: ctx.user.id,
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      orderCode: z.string().min(1).max(100).optional(),
      companyCode: z.string().min(1).max(50).optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      productModelId: z.number().optional(),
      targetQuantity: z.number().min(1).optional(),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'paused']).optional(),
      priority: z.number().optional(),
      plannedStartDate: z.date().optional(),
      plannedEndDate: z.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateProductionOrder(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteProductionOrder(input.id);
      return { success: true };
    }),

  // Reschedule production order (drag-drop from Gantt chart)
  // Check for schedule overlap
  checkScheduleOverlap: protectedProcedure
    .input(z.object({
      lineId: z.number(),
      startDate: z.date(),
      endDate: z.date(),
      excludeOrderId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const orders = await db.getProductionOrders({ lineId: input.lineId });
      
      const overlappingOrders = orders.filter(order => {
        // Skip the order being rescheduled
        if (input.excludeOrderId && order.id === input.excludeOrderId) {
          return false;
        }
        
        // Skip cancelled orders
        if (order.status === 'cancelled') {
          return false;
        }
        
        // Check for date overlap
        const orderStart = order.plannedStartDate ? new Date(order.plannedStartDate) : null;
        const orderEnd = order.plannedEndDate ? new Date(order.plannedEndDate) : null;
        
        if (!orderStart || !orderEnd) {
          return false;
        }
        
        // Overlap exists if: newStart < existingEnd AND newEnd > existingStart
        return input.startDate < orderEnd && input.endDate > orderStart;
      });
      
      return {
        hasOverlap: overlappingOrders.length > 0,
        overlappingOrders: overlappingOrders.map(o => ({
          id: o.id,
          orderCode: o.orderCode,
          plannedStartDate: o.plannedStartDate,
          plannedEndDate: o.plannedEndDate,
          status: o.status,
        })),
      };
    }),

  reschedule: adminProcedure
    .input(z.object({
      id: z.number(),
      scheduledStartDate: z.date(),
      scheduledEndDate: z.date(),
      lineId: z.number().optional(),
      forceOverride: z.boolean().optional(), // Allow override overlap
    }))
    .mutation(async ({ input, ctx }) => {
      const order = await db.getProductionOrderById(input.id);
      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Production order not found' });
      }

      const targetLineId = input.lineId || order.lineId;

      // Get line info for capacity check
      const lines = await db.getProductionLines();
      const targetLine = lines.find(l => l.id === targetLineId);
      if (!targetLine) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Production line not found' });
      }

      // Check for overlap unless force override is set
      if (!input.forceOverride) {
        const orders = await db.getProductionOrders({ lineId: targetLineId });
        
        const overlappingOrders = orders.filter(o => {
          if (o.id === input.id || o.status === 'cancelled') return false;
          
          const oStart = o.plannedStartDate ? new Date(o.plannedStartDate) : null;
          const oEnd = o.plannedEndDate ? new Date(o.plannedEndDate) : null;
          
          if (!oStart || !oEnd) return false;
          
          return input.scheduledStartDate < oEnd && input.scheduledEndDate > oStart;
        });
        
        if (overlappingOrders.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Lịch trùng với ${overlappingOrders.length} lệnh sản xuất khác: ${overlappingOrders.map(o => o.orderCode).join(', ')}. Sử dụng forceOverride=true để bỏ qua.`,
          });
        }

        // Capacity validation - check max concurrent orders
        const maxConcurrent = targetLine.maxConcurrentOrders || 1;
        const concurrentOrders = orders.filter(o => {
          if (o.id === input.id || o.status === 'cancelled' || o.status === 'completed') return false;
          
          const oStart = o.plannedStartDate ? new Date(o.plannedStartDate) : null;
          const oEnd = o.plannedEndDate ? new Date(o.plannedEndDate) : null;
          
          if (!oStart || !oEnd) return false;
          
          // Check if order overlaps with new schedule
          return input.scheduledStartDate < oEnd && input.scheduledEndDate > oStart;
        });

        if (concurrentOrders.length >= maxConcurrent) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Dây chuyền ${targetLine.name} chỉ hỗ trợ tối đa ${maxConcurrent} lệnh cùng lúc. Hiện đã có ${concurrentOrders.length} lệnh trong khoảng thời gian này. Sử dụng forceOverride=true để bỏ qua.`,
          });
        }

        // Capacity validation - check production capacity
        if (targetLine.capacityPerHour && order.targetQuantity) {
          const durationHours = (input.scheduledEndDate.getTime() - input.scheduledStartDate.getTime()) / (1000 * 60 * 60);
          const maxCapacity = targetLine.capacityPerHour * durationHours;
          
          if (order.targetQuantity > maxCapacity) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: `Số lượng ${order.targetQuantity} vượt quá năng lực dây chuyền (${Math.floor(maxCapacity)} sản phẩm trong ${durationHours.toFixed(1)} giờ với ${targetLine.capacityPerHour} sp/giờ). Sử dụng forceOverride=true để bỏ qua.`,
            });
          }
        }
      }

      const updateData: Record<string, unknown> = {
        plannedStartDate: input.scheduledStartDate,
        plannedEndDate: input.scheduledEndDate,
      };

      // If line changed, also update workshopId from the new line
      if (input.lineId && input.lineId !== order.lineId) {
        const newLine = lines.find(l => l.id === input.lineId);
        if (!newLine) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Production line not found' });
        }
        updateData.lineId = input.lineId;
        updateData.workshopId = newLine.workshopId;
      }

      await db.updateProductionOrder(input.id, updateData);

      // Log the reschedule action
      await db.createAuditLog({
        userId: ctx.user.id,
        action: 'reschedule_production_order',
        entityType: 'production_order',
        entityId: input.id,
        entityName: order.orderCode,
        details: {
          oldStartDate: order.plannedStartDate,
          oldEndDate: order.plannedEndDate,
          oldLineId: order.lineId,
          newStartDate: input.scheduledStartDate,
          newEndDate: input.scheduledEndDate,
          newLineId: input.lineId || order.lineId,
          forceOverride: input.forceOverride || false,
        },
      });

      return { success: true };
    }),

  // Order Templates
  listTemplates: protectedProcedure
    .input(z.object({ factoryId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return db.listOrderTemplates(input?.factoryId);
    }),

  getTemplate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getOrderTemplate(input.id);
    }),

  createTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      productModelId: z.number().optional(),
      defaultTargetQuantity: z.number().default(1000),
      defaultPriority: z.number().default(0),
      defaultNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.createOrderTemplate({ ...input, createdBy: ctx.user.id });
    }),

  updateTemplate: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      productModelId: z.number().optional(),
      defaultTargetQuantity: z.number().optional(),
      defaultPriority: z.number().optional(),
      defaultNotes: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateOrderTemplate(id, data);
      return { success: true };
    }),

  deleteTemplate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteOrderTemplate(input.id);
      return { success: true };
    }),

  createFromTemplate: protectedProcedure
    .input(z.object({
      templateId: z.number(),
      orderCode: z.string().min(1),
      lineId: z.number(),
      targetQuantity: z.number().optional(),
      priority: z.number().optional(),
      notes: z.string().optional(),
      scheduledStartDate: z.date().optional(),
      scheduledEndDate: z.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const template = await db.getOrderTemplate(input.templateId);
      if (!template) throw new Error('Template not found');

      const orderData = {
        orderCode: input.orderCode,
        companyCode: 'DEFAULT',
        factoryId: template.factoryId || 1,
        workshopId: template.workshopId || 1,
        lineId: input.lineId,
        productModelId: template.productModelId || 1,
        targetQuantity: input.targetQuantity || template.defaultTargetQuantity,
        priority: input.priority ?? template.defaultPriority,
        notes: input.notes || template.defaultNotes,
        plannedStartDate: input.scheduledStartDate,
        plannedEndDate: input.scheduledEndDate,
        status: 'pending' as const,
      };

      const id = await db.createProductionOrder(orderData);
      return { id };
    }),

  // WIP Tracking
  getWIPStatus: protectedProcedure
    .input(z.object({ factoryId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return db.getWIPStatus(input?.factoryId);
    }),

  getWIPByLine: protectedProcedure
    .input(z.object({ lineId: z.number() }))
    .query(async ({ input }) => {
      return db.getWIPByLine(input.lineId);
    }),

  // Scheduling Optimization
  optimizeSchedule: protectedProcedure
    .input(z.object({ 
      factoryId: z.number(),
      algorithm: z.enum(["fifo", "priority", "edf"]).optional().default("priority"),
    }))
    .mutation(async ({ input }) => {
      try {
        // Try advanced scheduling with algorithm
        const { scheduleFIFO, schedulePriority, scheduleEDF } = await import("../services/productionSchedulingService");
        
        // Get orders and lines from database
        const orders = await db.getProductionOrders();
        const lines = await db.getProductionLines();
        
        // Map to schedulable format
        const schedulableOrders = orders
          .filter((o: any) => o.status !== "completed" && o.status !== "cancelled")
          .map((o: any) => ({
            id: o.id,
            productModelId: o.productModelId,
            productName: o.productName || `Product ${o.productModelId}`,
            quantity: o.quantity,
            priority: o.priority || 3,
            deadline: o.endDate ? new Date(o.endDate) : undefined,
            assignedLineId: o.lineId || undefined,
            estimatedDuration: o.estimatedHours || Math.ceil(o.quantity / 100),
            dependencies: [],
            status: o.status,
          }));

        const availableLines = lines.map((l: any) => ({
          id: l.id,
          name: l.name,
          capacity: 1,
          capabilities: [],
        }));

        let result;
        switch (input.algorithm) {
          case "fifo":
            result = scheduleFIFO(schedulableOrders, availableLines);
            break;
          case "edf":
            result = scheduleEDF(schedulableOrders, availableLines);
            break;
          case "priority":
          default:
            result = schedulePriority(schedulableOrders, availableLines);
            break;
        }

        return result;
      } catch (e) {
        // Fallback to original db-level optimization
        return db.optimizeSchedule(input.factoryId);
      }
    }),

  applyScheduleSuggestion: adminProcedure
    .input(z.object({
      orderId: z.number(),
      suggestedLineId: z.number(),
      suggestedStartDate: z.date(),
      suggestedEndDate: z.date(),
      reason: z.string(),
      score: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.applyScheduleSuggestion(input);
      return { success: true };
    }),
});

// ============ LINE STAGE ROUTER ============
export const lineStageRouter = router({
  list: protectedProcedure
    .input(z.object({ lineId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return db.getLineStages(input?.lineId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getLineStageById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      lineId: z.number(),
      code: z.string().min(1).max(20),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      orderIndex: z.number().optional(),
      stationId: z.number().optional(),
      cycleTimeTarget: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createLineStage(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(20).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      orderIndex: z.number().optional(),
      stationId: z.number().optional(),
      cycleTimeTarget: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateLineStage(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteLineStage(input.id);
      return { success: true };
    }),

  reorder: adminProcedure
    .input(z.object({
      lineId: z.number(),
      stageIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      await db.reorderLineStages(input.lineId, input.stageIds);
      return { success: true };
    }),
});

// ============ LINE PRODUCT ASSIGNMENT ROUTER ============
export const lineProductAssignmentRouter = router({
  list: protectedProcedure
    .input(z.object({
      lineId: z.number().optional(),
      productModelId: z.number().optional(),
      productionOrderId: z.number().optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getLineProductAssignments(input);
    }),

  create: adminProcedure
    .input(z.object({
      lineId: z.number(),
      productModelId: z.number(),
      productionOrderId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createLineProductAssignment(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      lineId: z.number().optional(),
      productModelId: z.number().optional(),
      productionOrderId: z.number().optional(),
      isActive: z.boolean().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateLineProductAssignment(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteLineProductAssignment(input.id);
      return { success: true };
    }),
});
