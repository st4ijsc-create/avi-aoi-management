import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

// ============ ALERT ROUTER ============
export const alertRouter = router({
  list: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getAlertSettings(ctx.user.id);
    }),

  listAll: adminProcedure
    .query(async () => {
      return db.getAlertSettings();
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const alert = await db.getAlertSettingById(input.id);
      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert setting not found' });
      }
      // Only owner or admin can view
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      return alert;
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      alertType: z.enum(['yield_rate', 'ng_count', 'machine_status']),
      threshold: z.number(),
      comparisonOperator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq']).optional(),
      machineId: z.number().optional(),
      factoryId: z.number().optional(),
      notifyEmail: z.boolean().optional(),
      notifySms: z.boolean().optional(),
      notifyInApp: z.boolean().optional(),
      cooldownMinutes: z.number().min(5).max(1440).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.createAlertSetting({
        ...input,
        userId: ctx.user.id,
        threshold: String(input.threshold),
      });
      return result;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      threshold: z.number().optional(),
      comparisonOperator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq']).optional(),
      isActive: z.boolean().optional(),
      notifyEmail: z.boolean().optional(),
      notifySms: z.boolean().optional(),
      notifyInApp: z.boolean().optional(),
      cooldownMinutes: z.number().min(5).max(1440).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const alert = await db.getAlertSettingById(input.id);
      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert setting not found' });
      }
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      const { id, threshold, ...updateData } = input;
      await db.updateAlertSetting(id, {
        ...updateData,
        ...(threshold !== undefined ? { threshold: String(threshold) } : {}),
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const alert = await db.getAlertSettingById(input.id);
      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert setting not found' });
      }
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      await db.deleteAlertSetting(input.id);
      return { success: true };
    }),

  history: protectedProcedure
    .input(z.object({
      alertSettingId: z.number().optional(),
      limit: z.number().min(1).max(100).optional(),
    }))
    .query(async ({ input }) => {
      return db.getAlertHistory(input.alertSettingId, input.limit);
    }),

  // Cursor-based pagination for alert history
  historyCursor: protectedProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().min(1).max(200).optional(),
      direction: z.enum(['forward', 'backward']).optional(),
      alertSettingId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return db.getAlertHistoryCursor(input);
    }),

  acknowledge: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.acknowledgeAlert(input.id, ctx.user.id);
      return { success: true };
    }),

  // Test alert - send a test notification
  test: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const alert = await db.getAlertSettingById(input.id);
      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert setting not found' });
      }
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }

      // Send test notification to owner
      const { notifyOwner } = await import('../_core/notification');
      const success = await notifyOwner({
        title: `[Đang kiểm tra] ${alert.name}`,
        content: `Đây là thông báo kiểm tra cho cảnh báo "${alert.name}".\n\nLoại: ${alert.alertType}\nNgưỡng: ${alert.threshold}%`,
      });

      if (success) {
        // Log to history
        await db.createAlertHistory({
          alertSettingId: alert.id,
          triggeredValue: alert.threshold,
          message: `[TEST] Kiểm tra cảnh báo "${alert.name}"`,
          sentEmail: alert.notifyEmail,
          sentInApp: alert.notifyInApp,
        });
      }

      return { success };
    }),
});

// ============ YIELD THRESHOLD ROUTER ============
export const yieldThresholdRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getYieldAlertThresholds();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getYieldAlertThresholdById(input.id);
    }),

  getByType: protectedProcedure
    .input(z.object({ metricType: z.enum(['FPY', 'FY', 'NTF', 'UPH']) }))
    .query(async ({ input }) => {
      return db.getYieldAlertThresholdByType(input.metricType);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      warningThreshold: z.number().optional(),
      criticalThreshold: z.number().optional(),
      targetValue: z.number().optional(),
      comparisonOperator: z.enum(['gt', 'lt', 'gte', 'lte']).optional(),
      isEnabled: z.boolean().optional(),
      notifyOnWarning: z.boolean().optional(),
      notifyOnCritical: z.boolean().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      // Convert numbers to strings for decimal fields
      const updateData: any = {};
      if (data.warningThreshold !== undefined) updateData.warningThreshold = String(data.warningThreshold);
      if (data.criticalThreshold !== undefined) updateData.criticalThreshold = String(data.criticalThreshold);
      if (data.targetValue !== undefined) updateData.targetValue = String(data.targetValue);
      if (data.comparisonOperator !== undefined) updateData.comparisonOperator = data.comparisonOperator;
      if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
      if (data.notifyOnWarning !== undefined) updateData.notifyOnWarning = data.notifyOnWarning;
      if (data.notifyOnCritical !== undefined) updateData.notifyOnCritical = data.notifyOnCritical;
      if (data.description !== undefined) updateData.description = data.description;
      
      await db.updateYieldAlertThreshold(id, updateData);
      return { success: true };
    }),

  getEnabled: protectedProcedure.query(async () => {
    return db.getEnabledYieldAlertThresholds();
  }),

  // History procedures
  getHistory: protectedProcedure
    .input(z.object({ limit: z.number().optional() }))
    .query(async ({ input }) => {
      return db.getAllYieldThresholdHistory(input.limit || 100);
    }),

  getHistoryByType: protectedProcedure
    .input(z.object({ 
      metricType: z.enum(['FPY', 'FY', 'NTF', 'UPH']),
      days: z.number().optional()
    }))
    .query(async ({ input }) => {
      return db.getYieldThresholdHistoryWithComparison(input.metricType, input.days || 30);
    }),

  getHistoryByThreshold: protectedProcedure
    .input(z.object({ thresholdId: z.number() }))
    .query(async ({ input }) => {
      return db.getYieldThresholdHistoryByThreshold(input.thresholdId);
    }),

  // Update with history tracking
  updateWithHistory: protectedProcedure
    .input(z.object({
      id: z.number(),
      warningThreshold: z.number().optional(),
      criticalThreshold: z.number().optional(),
      targetValue: z.number().optional(),
      comparisonOperator: z.enum(['gt', 'lt', 'gte', 'lte']).optional(),
      isEnabled: z.boolean().optional(),
      notifyOnWarning: z.boolean().optional(),
      notifyOnCritical: z.boolean().optional(),
      description: z.string().optional(),
      changeReason: z.string().optional(),
      actualValueAtChange: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, changeReason, actualValueAtChange, ...data } = input;
      
      // Get current threshold for history
      const current = await db.getYieldAlertThresholdById(id);
      if (!current) throw new Error('Threshold not found');

      // Create history record if thresholds changed
      if (data.warningThreshold !== undefined || data.criticalThreshold !== undefined || data.targetValue !== undefined) {
        await db.createYieldThresholdHistory({
          thresholdId: id,
          metricType: current.metricType,
          previousWarning: current.warningThreshold,
          newWarning: data.warningThreshold !== undefined ? String(data.warningThreshold) : current.warningThreshold,
          previousCritical: current.criticalThreshold,
          newCritical: data.criticalThreshold !== undefined ? String(data.criticalThreshold) : current.criticalThreshold,
          previousTarget: current.targetValue,
          newTarget: data.targetValue !== undefined ? String(data.targetValue) : current.targetValue,
          changeReason: changeReason || null,
          changedBy: ctx.user?.id || null,
          changedByName: ctx.user?.name || null,
          actualValueAtChange: actualValueAtChange !== undefined ? String(actualValueAtChange) : null,
        });
      }

      // Convert numbers to strings for decimal fields
      const updateData: any = {};
      if (data.warningThreshold !== undefined) updateData.warningThreshold = String(data.warningThreshold);
      if (data.criticalThreshold !== undefined) updateData.criticalThreshold = String(data.criticalThreshold);
      if (data.targetValue !== undefined) updateData.targetValue = String(data.targetValue);
      if (data.comparisonOperator !== undefined) updateData.comparisonOperator = data.comparisonOperator;
      if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
      if (data.notifyOnWarning !== undefined) updateData.notifyOnWarning = data.notifyOnWarning;
      if (data.notifyOnCritical !== undefined) updateData.notifyOnCritical = data.notifyOnCritical;
      if (data.description !== undefined) updateData.description = data.description;
      
      await db.updateYieldAlertThreshold(id, updateData);
      return { success: true };
    }),
});
