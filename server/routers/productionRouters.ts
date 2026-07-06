import { moduleProcedure, moduleGate, writeProcedure, router } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_PRODUCTION (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_PRODUCTION");
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
      search: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
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

      // Doc 38 T-1 (P0 #4) — feeder-verify RUN-GATE. Transitioning an order to
      // in_progress IS the production-run start; block it (fail-closed) when
      // FEEDER_VERIFY_ENFORCED is ON and a feeder-bearing machine on the order's
      // line has an unverified/mismatched setup (wrong-part guard). Advisory no-op
      // when the flag is OFF. Read the order to resolve line + product when the
      // caller only sent { id, status }.
      if (data.status === "in_progress") {
        const order = await db.getProductionOrderById(id);
        const lineId = data.lineId ?? order?.lineId ?? null;
        const productModelId = data.productModelId ?? order?.productModelId ?? null;
        if (lineId != null) {
          const { assertLineSetupOkForRun } = await import("../services/feederVerifyService");
          const gate = await assertLineSetupOkForRun(lineId, productModelId);
          if (gate.blocked) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Cannot start production run: ${gate.reason}`,
            });
          }
        }
      }

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

  // Doc 38 Đợt Q — write floor (block read-only viewer/user) + keep the MOD_PRODUCTION
  // license gate. Creating a production order from a template is a write op.
  createFromTemplate: writeProcedure
    .use(moduleGate("MOD_PRODUCTION"))
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
        
        // Map to schedulable format.
        // BUG FIX (WS-4): production_orders has no quantity/endDate/estimatedHours
        // columns — the correct fields are targetQuantity / plannedEndDate /
        // completedQuantity. The old mapping produced NaN durations + lost
        // deadlines/lines, so SchedulableOrder fields were all wrong.
        const schedulableOrders = orders
          .filter((o: any) => o.status !== "completed" && o.status !== "cancelled")
          .map((o: any) => ({
            id: o.id,
            orderCode: o.orderCode,
            productName: `Product ${o.productModelId}`,
            lineId: o.lineId,
            lineName: lines.find((l: any) => l.id === o.lineId)?.name || `Line ${o.lineId}`,
            priority: o.priority ?? 3,
            targetQuantity: o.targetQuantity,
            actualQuantity: o.completedQuantity ?? 0,
            scheduledStartDate: o.plannedStartDate ? new Date(o.plannedStartDate) : null,
            scheduledEndDate: o.plannedEndDate ? new Date(o.plannedEndDate) : null,
            dueDate: o.plannedEndDate ? new Date(o.plannedEndDate) : null,
            status: o.status,
            dependencies: Array.isArray(o.dependencies) ? o.dependencies : [],
          }));

        const availableLines = lines.map((l: any) => ({
          id: l.id,
          name: l.name,
          maxConcurrent: l.maxConcurrentOrders ?? 1,
          capacityPerHour: l.capacityPerHour ?? null,
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

  // ============ WS-4: AUTO-SCHEDULE RUNS ============

  // Generate a DRAFT schedule run (resource leveling + blackout + shifts) and
  // persist it for audit. Does NOT touch production orders until applied.
  generateScheduleRun: adminProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      lineId: z.number().optional(),
      algorithm: z.enum(["fifo", "priority", "edf"]).default("priority"),
    }))
    .mutation(async ({ input, ctx }) => {
      const {
        scheduleFIFO, schedulePriority, scheduleEDF,
        buildScheduleRunPayload, explainScheduleWithAI,
      } = await import("../services/productionSchedulingService");

      const orders = await db.getProductionOrders(
        input.factoryId || input.lineId
          ? { factoryId: input.factoryId, lineId: input.lineId }
          : undefined,
      );
      const lines = await db.getProductionLines();
      const shiftConfigs = await db.getShiftConfigs(input.factoryId);

      const schedulableOrders = (orders as any[])
        .filter((o) => o.status !== "completed" && o.status !== "cancelled")
        .map((o) => ({
          id: o.id,
          orderCode: o.orderCode,
          productName: `Product ${o.productModelId}`,
          lineId: o.lineId,
          lineName: (lines as any[]).find((l) => l.id === o.lineId)?.name || `Line ${o.lineId}`,
          priority: o.priority ?? 3,
          targetQuantity: o.targetQuantity,
          actualQuantity: o.completedQuantity ?? 0,
          scheduledStartDate: o.plannedStartDate ? new Date(o.plannedStartDate) : null,
          scheduledEndDate: o.plannedEndDate ? new Date(o.plannedEndDate) : null,
          dueDate: o.plannedEndDate ? new Date(o.plannedEndDate) : null,
          status: o.status,
          dependencies: Array.isArray(o.dependencies) ? o.dependencies : [],
        }));

      const schedulableLines = (lines as any[]).map((l) => ({
        id: l.id,
        name: l.name,
        maxConcurrent: l.maxConcurrentOrders ?? 1,
        capacityPerHour: l.capacityPerHour ?? null,
      }));

      // Blackout windows from predicted maintenance (recommendedMaintenanceDate).
      const blackouts = await buildMaintenanceBlackouts(schedulableLines);

      const shifts = (shiftConfigs as any[])
        .filter((s) => s.isActive)
        .map((s) => ({ startHour: s.startHour, startMinute: s.startMinute, endHour: s.endHour, endMinute: s.endMinute }));

      const capacityByLine: Record<number, number | null> = {};
      for (const l of schedulableLines) capacityByLine[l.id] = l.capacityPerHour;

      const context = { capacityByLine, blackouts, shifts };
      const fn = input.algorithm === "fifo" ? scheduleFIFO : input.algorithm === "edf" ? scheduleEDF : schedulePriority;
      const result = fn(schedulableOrders, schedulableLines, context);
      const aiExplanation = await explainScheduleWithAI(result).catch(() => null);
      const payload = buildScheduleRunPayload(result, aiExplanation);

      const { id } = await db.createScheduleRun(
        {
          factoryId: input.factoryId ?? null,
          lineId: input.lineId ?? null,
          algorithm: result.algorithm,
          status: "DRAFT",
          kpiSummary: payload.kpiSummary,
          conflictCount: payload.conflictCount,
          createdBy: ctx.user.id,
        },
        payload.items,
      );

      return { runId: id, ...result, kpiSummary: payload.kpiSummary, aiExplanation };
    }),

  // G2.5a: Generate a DRAFT APS schedule run via CP-SAT (OR-Tools) with a
  // heuristic fallback. DRAFT-only — apply still goes through applyScheduleRun
  // (HITL). The solver is OFF by default (APS_SOLVER_ENABLED).
  generateApsScheduleRun: adminProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      lineId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { generateApsSchedule } = await import("../services/apsService");
      const { solverMode, payload, baseline, algorithm } = await generateApsSchedule({
        factoryId: input.factoryId,
        lineId: input.lineId,
      });

      const { id } = await db.createScheduleRun(
        {
          factoryId: input.factoryId ?? null,
          lineId: input.lineId ?? null,
          algorithm,
          status: "DRAFT",
          kpiSummary: payload.kpiSummary,
          conflictCount: payload.conflictCount,
          createdBy: ctx.user.id,
        },
        payload.items.map((it) => ({
          productionOrderId: it.productionOrderId,
          lineId: it.lineId,
          suggestedStart: it.suggestedStart,
          suggestedEnd: it.suggestedEnd,
          reason: it.reason,
          stationId: it.stationId,
          setupMinutes: it.setupMinutes,
          sequenceIndex: it.sequenceIndex,
        })),
      );

      return {
        runId: id,
        solverMode,
        algorithm,
        kpiSummary: payload.kpiSummary,
        baseline,
      };
    }),

  // G2.5b: Read-only KPI comparison APS vs FIFO vs Priority. Does NOT persist
  // any schedule run (no createScheduleRun) — pure compare for the HITL panel.
  compareScheduleKpi: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      lineId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      const { compareApsKpi } = await import("../services/apsService");
      return compareApsKpi({ factoryId: input?.factoryId, lineId: input?.lineId });
    }),

  applyScheduleRun: adminProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ input }) => {
      return db.applyScheduleRun(input.runId);
    }),

  dismissScheduleRun: adminProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ input }) => {
      await db.dismissScheduleRun(input.runId);
      return { success: true };
    }),

  listScheduleRuns: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      lineId: z.number().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listScheduleRuns(input);
    }),

  getScheduleRun: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getScheduleRunById(input.id);
    }),

  // Read-only what-if: simulate a disruption on one line.
  whatIf: protectedProcedure
    .input(z.object({
      lineId: z.number(),
      factoryId: z.number().optional(),
      algorithm: z.enum(["fifo", "priority", "edf"]).default("priority"),
      defectRatePct: z.number().min(0).max(100).optional(),
      extraDowntimeHours: z.number().min(0).max(720).optional(),
      capacityReductionPct: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      const { simulateWhatIf } = await import("../services/productionSchedulingService");

      const orders = await db.getProductionOrders(
        input.factoryId ? { factoryId: input.factoryId } : undefined,
      );
      const lines = await db.getProductionLines();
      const shiftConfigs = await db.getShiftConfigs(input.factoryId);

      const schedulableOrders = (orders as any[])
        .filter((o) => o.status !== "completed" && o.status !== "cancelled")
        .map((o) => ({
          id: o.id,
          orderCode: o.orderCode,
          productName: `Product ${o.productModelId}`,
          lineId: o.lineId,
          lineName: (lines as any[]).find((l) => l.id === o.lineId)?.name || `Line ${o.lineId}`,
          priority: o.priority ?? 3,
          targetQuantity: o.targetQuantity,
          actualQuantity: o.completedQuantity ?? 0,
          scheduledStartDate: o.plannedStartDate ? new Date(o.plannedStartDate) : null,
          scheduledEndDate: o.plannedEndDate ? new Date(o.plannedEndDate) : null,
          dueDate: o.plannedEndDate ? new Date(o.plannedEndDate) : null,
          status: o.status,
          dependencies: Array.isArray(o.dependencies) ? o.dependencies : [],
        }));

      const schedulableLines = (lines as any[]).map((l) => ({
        id: l.id,
        name: l.name,
        maxConcurrent: l.maxConcurrentOrders ?? 1,
        capacityPerHour: l.capacityPerHour ?? null,
      }));

      const shifts = (shiftConfigs as any[])
        .filter((s) => s.isActive)
        .map((s) => ({ startHour: s.startHour, startMinute: s.startMinute, endHour: s.endHour, endMinute: s.endMinute }));

      const capacityByLine: Record<number, number | null> = {};
      for (const l of schedulableLines) capacityByLine[l.id] = l.capacityPerHour;

      const algorithm = input.algorithm === "fifo" ? "FIFO" : input.algorithm === "edf" ? "EDF" : "Priority";
      return simulateWhatIf(
        {
          lineId: input.lineId,
          defectRatePct: input.defectRatePct,
          extraDowntimeHours: input.extraDowntimeHours,
          capacityReductionPct: input.capacityReductionPct,
        },
        schedulableOrders,
        schedulableLines,
        algorithm as any,
        { capacityByLine, shifts },
      );
    }),
});

/**
 * Build maintenance blackout windows from the latest machine_health_history
 * recommendedMaintenanceDate per machine, mapped to the machine's line.
 * Each window defaults to an 8h maintenance slot. Best-effort; empty on error.
 */
async function buildMaintenanceBlackouts(
  lines: Array<{ id: number }>,
): Promise<Array<{ lineId: number | null; machineId: number | null; start: Date; end: Date; reason: string }>> {
  try {
    const machinesWithHierarchy = await db.getMachinesWithHierarchy();
    const blackouts: Array<{ lineId: number | null; machineId: number | null; start: Date; end: Date; reason: string }> = [];
    const now = Date.now();
    for (const row of machinesWithHierarchy as any[]) {
      const machineId = row.machine?.id;
      const lineId = row.line?.id ?? null;
      if (!machineId) continue;
      // getMachineHealthHistory returns ascending by timestamp — take the last (latest).
      const history = await db.getMachineHealthHistory(machineId, "month", 500);
      const latest = (history as any[])[(history as any[]).length - 1];
      const recDate = latest?.recommendedMaintenanceDate;
      if (!recDate) continue;
      const start = new Date(recDate);
      if (start.getTime() < now) continue; // only future maintenance blocks the schedule
      const end = new Date(start.getTime() + 8 * 3600 * 1000);
      blackouts.push({ lineId, machineId, start, end, reason: "predicted-maintenance" });
    }
    return blackouts;
  } catch {
    return [];
  }
}

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
