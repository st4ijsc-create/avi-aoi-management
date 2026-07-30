import { protectedProcedure, writeProcedure, router } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import * as db from "../db";
import { getDb } from "../db/connection";
import { and, eq, gte, sql } from "drizzle-orm";
import { alertSettings, dailyStatistics, machines } from "../../drizzle/schema";
import type { AlertSetting } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { sendAlertEmail } from "../services/emailService";
import { sendWebhookEvent } from "./webhookRouter";

// ============================================================================
// LEGACY ALERT-SETTINGS EVALUATOR (bug #1 fix)
//
// alertSettings (yield_rate / ng_count / machine_status / machine_offline) never
// had an evaluator — only the manual `test` button fired. This shared logic is
// used both by the scheduler (alertEvaluatorScheduler) and the test mutation.
// ============================================================================

export interface AlertBreach {
  breached: boolean;
  currentValue: number;
  message: string;
}

function compare(current: number, threshold: number, op: string | null | undefined): boolean {
  switch (op) {
    case "gt": return current > threshold;
    case "gte": return current >= threshold;
    case "lt": return current < threshold;
    case "lte": return current <= threshold;
    case "eq": return current === threshold;
    default: return current < threshold; // schema default is "lt"
  }
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Compute the current value for an alert setting and whether its threshold is
 * breached. Pure read — no notifications, no history. Reused by the scheduler
 * and the manual test endpoint so both agree on what "breached" means.
 */
export async function evaluateAlertSetting(alert: AlertSetting): Promise<AlertBreach> {
  const database = await getDb();
  if (!database) return { breached: false, currentValue: 0, message: "Database not available" };

  const threshold = Number(alert.threshold);
  const today = startOfToday();

  // Scope filter shared by the daily-statistics based rules.
  const scope = [gte(dailyStatistics.date, today)];
  if (alert.machineId != null) scope.push(eq(dailyStatistics.machineId, alert.machineId));
  if (alert.factoryId != null) scope.push(eq(dailyStatistics.factoryId, alert.factoryId));

  switch (alert.alertType) {
    case "yield_rate": {
      const [row] = await database
        .select({
          total: sql<number>`COALESCE(SUM(${dailyStatistics.totalCount}), 0)`,
          ok: sql<number>`COALESCE(SUM(${dailyStatistics.okCount}), 0)`,
        })
        .from(dailyStatistics)
        .where(and(...scope));
      const total = Number(row?.total ?? 0);
      const ok = Number(row?.ok ?? 0);
      const yieldRate = total > 0 ? (ok / total) * 100 : 100;
      const breached = total > 0 && compare(yieldRate, threshold, alert.comparisonOperator);
      return {
        breached,
        currentValue: yieldRate,
        message: `Yield ${yieldRate.toFixed(2)}% ${alert.comparisonOperator ?? "lt"} ngưỡng ${threshold}% (hôm nay, ${total} sản phẩm)`,
      };
    }

    case "ng_count": {
      const [row] = await database
        .select({ ng: sql<number>`COALESCE(SUM(${dailyStatistics.ngCount}), 0)` })
        .from(dailyStatistics)
        .where(and(...scope));
      const ngCount = Number(row?.ng ?? 0);
      const breached = compare(ngCount, threshold, alert.comparisonOperator ?? "gte");
      return {
        breached,
        currentValue: ngCount,
        message: `Số NG ${ngCount} ${alert.comparisonOperator ?? "gte"} ngưỡng ${threshold} (hôm nay)`,
      };
    }

    case "machine_status":
    case "machine_offline": {
      // Count machines that are offline (and, for machine_offline, stale beyond
      // the threshold in minutes). Breach when that count crosses the threshold.
      const machineScope = [eq(machines.isActive, true)];
      if (alert.machineId != null) machineScope.push(eq(machines.id, alert.machineId));

      const rows = await database
        .select({
          id: machines.id,
          syncMode: machines.syncMode,
          lastHeartbeat: machines.lastHeartbeat,
        })
        .from(machines)
        .where(and(...machineScope));

      const now = Date.now();
      const staleMs = (alert.alertType === "machine_offline" ? threshold : 0) * 60 * 1000;
      const offline = rows.filter((m) => {
        if (m.syncMode === "offline") return true;
        if (staleMs > 0 && m.lastHeartbeat) {
          return now - new Date(m.lastHeartbeat).getTime() >= staleMs;
        }
        return false;
      });
      const offlineCount = offline.length;

      if (alert.alertType === "machine_offline") {
        const breached = offlineCount > 0;
        return {
          breached,
          currentValue: offlineCount,
          message: `${offlineCount} máy offline > ${threshold} phút`,
        };
      }
      // machine_status: breach when offline-machine count crosses threshold.
      const breached = compare(offlineCount, threshold, alert.comparisonOperator ?? "gte");
      return {
        breached,
        currentValue: offlineCount,
        message: `${offlineCount} máy không hoạt động ${alert.comparisonOperator ?? "gte"} ngưỡng ${threshold}`,
      };
    }

    default:
      return { breached: false, currentValue: 0, message: `Unknown alert type: ${alert.alertType}` };
  }
}

/**
 * Dispatch the configured channels for a breached alert + write history. Shared
 * by scheduler and test. `isTest` only changes the message prefix and skips the
 * cooldown stamp.
 */
async function dispatchAlert(alert: AlertSetting, breach: AlertBreach, isTest = false): Promise<void> {
  const prefix = isTest ? "[TEST] " : "";
  const title = `${prefix}${alert.name}`;
  const content = `${prefix}${breach.message}`;

  if (alert.notifyInApp) {
    try {
      await notifyOwner({ title, content });
    } catch (err) {
      console.error(`[AlertEval] notifyOwner failed for #${alert.id}:`, (err as Error).message);
    }
  }
  if (alert.notifyEmail) {
    try {
      await sendAlertEmail({
        ruleName: alert.name,
        ruleType: alert.alertType,
        message: content,
        currentValue: breach.currentValue,
        thresholdValue: Number(alert.threshold),
      });
    } catch (err) {
      console.error(`[AlertEval] email failed for #${alert.id}:`, (err as Error).message);
    }
  }
  try {
    await sendWebhookEvent("alert.triggered", {
      source: "alert_settings",
      alertSettingId: alert.id,
      name: alert.name,
      alertType: alert.alertType,
      currentValue: breach.currentValue,
      threshold: Number(alert.threshold),
      message: breach.message,
      isTest,
    });
  } catch (err) {
    console.error(`[AlertEval] webhook failed for #${alert.id}:`, (err as Error).message);
  }

  await db.createAlertHistory({
    alertSettingId: alert.id,
    triggeredValue: String(breach.currentValue.toFixed(2)),
    message: content,
    sentEmail: alert.notifyEmail,
    sentInApp: alert.notifyInApp,
  });
}

/**
 * Scheduler entry point: evaluate every active alert setting, honour each rule's
 * cooldownMinutes (via lastTriggeredAt), and dispatch on breach. Returns the
 * number of alerts fired this cycle.
 */
export async function evaluateActiveAlertSettings(): Promise<number> {
  const database = await getDb();
  if (!database) return 0;

  const active = await database.select().from(alertSettings).where(eq(alertSettings.isActive, true));
  const now = new Date();
  let fired = 0;

  for (const alert of active) {
    try {
      // Cooldown: skip if last triggered within cooldownMinutes.
      if (alert.lastTriggeredAt) {
        const elapsedMin = (now.getTime() - new Date(alert.lastTriggeredAt).getTime()) / 60000;
        if (elapsedMin < (alert.cooldownMinutes ?? 60)) continue;
      }

      const breach = await evaluateAlertSetting(alert);
      if (!breach.breached) continue;

      await dispatchAlert(alert, breach, false);
      await db.updateAlertSetting(alert.id, { lastTriggeredAt: now });
      fired++;
    } catch (err) {
      console.error(`[AlertEval] error evaluating alert #${alert.id}:`, (err as Error).message);
    }
  }

  return fired;
}

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
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'alertSetting' }, 'Alert setting not found');
      }
      // Only owner or admin can view
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      return alert;
    }),

  // doc 54 Wave B — write-floor so read-only roles (viewer/user) can't create alerts.
  create: writeProcedure
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

  // doc 54 P1.4 (G1) — was bare protectedProcedure: `create` got write-floored in
  // Wave B but update/delete did not, so a read-only viewer owning an alert could
  // still rewire it. writeProcedure blocks read-only roles; ownership check kept below.
  update: writeProcedure
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
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'alertSetting' }, 'Alert setting not found');
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

  // doc 54 P1.4 (G1) — write-floor (see update above); ownership check retained.
  delete: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const alert = await db.getAlertSettingById(input.id);
      if (!alert) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'alertSetting' }, 'Alert setting not found');
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
      // doc 67 W3: lọc "chưa acknowledge" ở SERVER — không thì limit ăn vào các
      // bản đã-ack mới nhất và breach mở cũ rớt khỏi console (mất cảnh báo).
      onlyOpen: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      return db.getAlertHistory(input.alertSettingId, input.limit, input.onlyOpen);
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
      // doc 54 Wave B — mirror the owner-or-admin scope check used by update/delete.
      // `id` is an alert_history row; resolve its parent alert setting to find the
      // owner and reject anyone who is neither the owner nor an admin.
      const historyRow = await db.getAlertHistoryById(input.id);
      if (!historyRow) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'alert' }, 'Alert not found');
      }
      const alert = await db.getAlertSettingById(historyRow.alertSettingId);
      if (!alert) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'alertSetting' }, 'Alert setting not found');
      }
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      await db.acknowledgeAlert(input.id, ctx.user.id);
      return { success: true };
    }),

  // Test alert - send a test notification
  test: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const alert = await db.getAlertSettingById(input.id);
      if (!alert) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'alertSetting' }, 'Alert setting not found');
      }
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }

      // Reuse the shared evaluator so the test reflects the SAME breach logic
      // the scheduler uses, then dispatch through the same channels (notify +
      // email + webhook) and log history. isTest=true → prefixed + no cooldown.
      const breach = await evaluateAlertSetting(alert);
      await dispatchAlert(alert, breach, true);

      return { success: true, breached: breach.breached, currentValue: breach.currentValue, message: breach.message };
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

  // doc 54 Wave B — factory-wide thresholds: write-floor + settings_yield_thresholds gate.
  update: writeProcedure
    .use(requirePermission("settings_yield_thresholds", "canEdit"))
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
  // doc 54 Wave B — factory-wide thresholds: write-floor + settings_yield_thresholds gate.
  updateWithHistory: writeProcedure
    .use(requirePermission("settings_yield_thresholds", "canEdit"))
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
