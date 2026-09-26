/**
 * Alert Escalation Rules Router (doc 27 MB6 / migration 0186)
 *
 * Admin CRUD for alert_escalation_rules — the config consumed by the
 * mqttAlertScheduler escalation sweep (see server/mqttAlertScheduler.ts).
 *
 * RBAC: reads for any authenticated user; mutations restricted to
 * admin/supervisor (supervisorProcedure, 2FA-enforced) — escalation routing
 * decides who gets paged, so it is a privileged control.
 *
 * NOTE: web admin UI for these rules is deferred — API-only for now; the
 * mobile app only CONSUMES escalations (badge/filter), it does not edit rules.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { protectedProcedure, supervisorProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { alertEscalationRules, mqttConnectionAlerts, mqttAlertHistory, users } from "../../drizzle/schema";
import { desc, eq, isNotNull } from "drizzle-orm";

async function requireDb() {
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
  return db;
}

const severitySchema = z.enum(["info", "warning", "critical"]).nullable();

const ruleCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  severity: severitySchema.optional(), // null/omitted = any (conn alerts only when set)
  alertType: z.string().max(50).nullable().optional(), // null/omitted = any
  escalateAfterMin: z.number().int().min(1).max(24 * 60).default(15),
  notifyRoles: z.array(z.enum(["admin", "supervisor", "quality_inspector", "operator", "maintenance", "engineer", "viewer", "user"])).default([]),
  notifyUserIds: z.array(z.number().int().positive()).default([]),
  enabled: z.boolean().default(true),
});

export const alertEscalationRouter = router({
  // List all escalation rules (newest first)
  list: protectedProcedure.query(async () => {
    const db = await requireDb();
    return db.select().from(alertEscalationRules).orderBy(desc(alertEscalationRules.createdAt));
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db.select().from(alertEscalationRules).where(eq(alertEscalationRules.id, input.id)).limit(1);
      if (rows.length === 0) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "escalationRule" }, "Escalation rule not found");
      return rows[0];
    }),

  create: supervisorProcedure
    .input(ruleCreateSchema)
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [created] = await db.insert(alertEscalationRules).values({
        name: input.name,
        description: input.description ?? null,
        severity: input.severity ?? null,
        alertType: input.alertType ?? null,
        escalateAfterMin: input.escalateAfterMin,
        notifyRoles: input.notifyRoles,
        notifyUserIds: input.notifyUserIds,
        enabled: input.enabled,
        createdBy: ctx.user?.id ?? null,
      }).returning();
      return created;
    }),

  update: supervisorProcedure
    .input(ruleCreateSchema.partial().extend({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { id, ...rest } = input;
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (rest.name !== undefined) patch.name = rest.name;
      if (rest.description !== undefined) patch.description = rest.description ?? null;
      if (rest.severity !== undefined) patch.severity = rest.severity ?? null;
      if (rest.alertType !== undefined) patch.alertType = rest.alertType ?? null;
      if (rest.escalateAfterMin !== undefined) patch.escalateAfterMin = rest.escalateAfterMin;
      if (rest.notifyRoles !== undefined) patch.notifyRoles = rest.notifyRoles;
      if (rest.notifyUserIds !== undefined) patch.notifyUserIds = rest.notifyUserIds;
      if (rest.enabled !== undefined) patch.enabled = rest.enabled;

      const updated = await db.update(alertEscalationRules)
        .set(patch)
        .where(eq(alertEscalationRules.id, id))
        .returning({ id: alertEscalationRules.id });
      if (updated.length === 0) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "escalationRule" }, "Escalation rule not found");
      return { success: true };
    }),

  delete: supervisorProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const deleted = await db.delete(alertEscalationRules)
        .where(eq(alertEscalationRules.id, input.id))
        .returning({ id: alertEscalationRules.id });
      if (deleted.length === 0) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "escalationRule" }, "Escalation rule not found");
      return { success: true };
    }),

  toggle: supervisorProcedure
    .input(z.object({ id: z.number().int().positive(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const updated = await db.update(alertEscalationRules)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(alertEscalationRules.id, input.id))
        .returning({ id: alertEscalationRules.id });
      if (updated.length === 0) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "escalationRule" }, "Escalation rule not found");
      return { success: true };
    }),

  // ── W8-C (doc 27 §7 Đợt 6 leftover) — additions for the web admin UI ────────

  /**
   * Escalation ACTIVITY: recently escalated alerts from BOTH sources the sweep
   * claims (mqtt_connection_alerts + mqtt_alert_history), merged newest-first.
   * Read-only view for the admin section — escalatedAt is set exactly once by
   * the sweep, so this is an honest ledger of what actually paged people.
   */
  recentEscalations: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const limit = input?.limit ?? 50;

      const conn = await db
        .select({
          id: mqttConnectionAlerts.id,
          title: mqttConnectionAlerts.title,
          message: mqttConnectionAlerts.message,
          severity: mqttConnectionAlerts.severity,
          alertType: mqttConnectionAlerts.alertType,
          triggeredAt: mqttConnectionAlerts.triggeredAt,
          escalatedAt: mqttConnectionAlerts.escalatedAt,
          isAcknowledged: mqttConnectionAlerts.isAcknowledged,
          isResolved: mqttConnectionAlerts.isResolved,
        })
        .from(mqttConnectionAlerts)
        .where(isNotNull(mqttConnectionAlerts.escalatedAt))
        .orderBy(desc(mqttConnectionAlerts.escalatedAt))
        .limit(limit);

      const hist = await db
        .select({
          id: mqttAlertHistory.id,
          title: mqttAlertHistory.ruleName,
          message: mqttAlertHistory.message,
          alertType: mqttAlertHistory.ruleType,
          triggeredAt: mqttAlertHistory.triggeredAt,
          escalatedAt: mqttAlertHistory.escalatedAt,
          isResolved: mqttAlertHistory.isResolved,
        })
        .from(mqttAlertHistory)
        .where(isNotNull(mqttAlertHistory.escalatedAt))
        .orderBy(desc(mqttAlertHistory.escalatedAt))
        .limit(limit);

      const merged = [
        ...conn.map((r) => ({
          source: "conn" as const,
          id: r.id,
          title: r.title,
          message: r.message,
          severity: r.severity as string | null,
          alertType: r.alertType as string | null,
          triggeredAt: r.triggeredAt,
          escalatedAt: r.escalatedAt,
          isAcknowledged: r.isAcknowledged,
          isResolved: r.isResolved,
        })),
        ...hist.map((r) => ({
          source: "mqtt" as const,
          id: r.id,
          title: r.title,
          message: r.message,
          severity: null as string | null, // mqtt_alert_history has no severity column (honest)
          alertType: r.alertType as string | null,
          triggeredAt: r.triggeredAt,
          escalatedAt: r.escalatedAt,
          isAcknowledged: null as boolean | null, // history rows have no ack concept
          isResolved: r.isResolved,
        })),
      ]
        .sort((a, b) => (b.escalatedAt?.getTime() ?? 0) - (a.escalatedAt?.getTime() ?? 0))
        .slice(0, limit);

      return merged;
    }),

  /**
   * Minimal user directory for the notifyUserIds picker: id/name/username/role
   * of ACTIVE users only. supervisorProcedure — same privilege as editing rules
   * (user.list itself is admin-only, which would lock supervisors out of the form).
   */
  listNotifiableUsers: supervisorProcedure.query(async () => {
    const db = await requireDb();
    return db
      .select({ id: users.id, name: users.name, username: users.username, role: users.role })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(users.name);
  }),
});
