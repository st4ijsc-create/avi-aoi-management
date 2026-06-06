/**
 * Sprint F5a — Interlock rule router (ALERT-ONLY).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - create ALWAYS forces enabled=false, approvedBy=null, requiresHumanConfirm=true
 *     (a created rule can never auto-act until a human approves AND enables it).
 *   - approve is ADMIN-ONLY (sets approvedBy = ctx.user.id, approvedAt).
 *   - enable requires approvedBy != null (cannot enable an unapproved rule).
 *   - testEvaluate is a DRY-RUN: it reports whether the condition would fire and
 *     what the ALERT-ONLY outcome would be. It NEVER inserts events, raises Andon,
 *     or writes a command.
 * RBAC via module 'interlock':
 *   list/get/events/testEvaluate → canView
 *   create → canCreate ; update/enable/disable/resolveEvent → canEdit
 *   delete → canDelete ; approve → admin-only
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
import { interlockRules, interlockEvents } from "../../drizzle/schema";
import { evaluateCondition, deriveObserved, type ComparisonOperator, type InterlockSourceType } from "../services/interlock/ruleEvaluator";

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return db;
}

const scopeEnum = z.enum(["line", "station", "machine"]);
const sourceTypeEnum = z.enum(["spc_violation", "ng_rate", "process_result", "telemetry_tag", "cpk"]);
const operatorEnum = z.enum(["lt", "lte", "gt", "gte", "eq"]);
const actionEnum = z.enum(["alert", "block_downstream", "stop_line", "reduce_speed"]);

const ruleInput = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  scope: scopeEnum,
  lineId: z.number().int().positive().nullable().optional(),
  stationId: z.number().int().positive().nullable().optional(),
  machineId: z.number().int().positive().nullable().optional(),
  sourceType: sourceTypeEnum,
  sourceKey: z.string().max(128).nullable().optional(),
  comparisonOperator: operatorEnum,
  threshold: z.number().nullable().optional(),
  windowSize: z.number().int().positive().nullable().optional(),
  consecutiveCount: z.number().int().positive().nullable().optional(),
  windowSeconds: z.number().int().positive().nullable().optional(),
  action: actionEnum,
  targetMachineId: z.number().int().positive().nullable().optional(),
  targetAdapterId: z.number().int().positive().nullable().optional(),
  commandTag: z.string().max(128).nullable().optional(),
  cooldownSeconds: z.number().int().min(0).max(86400).default(300),
});

export const interlockRouter = router({
  list: protectedProcedure
    .use(requirePermission("interlock", "canView"))
    .query(async () => {
      const db = await getDb();
      return db.select().from(interlockRules).orderBy(desc(interlockRules.createdAt));
    }),

  get: protectedProcedure
    .use(requirePermission("interlock", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [row] = await db.select().from(interlockRules).where(eq(interlockRules.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Rule không tồn tại." });
      return row;
    }),

  create: protectedProcedure
    .use(requirePermission("interlock", "canCreate"))
    .input(ruleInput)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // SAFETY: a freshly-created rule is ALWAYS disabled, unapproved, HITL-gated.
      const [row] = await db
        .insert(interlockRules)
        .values({
          ...input,
          threshold: input.threshold != null ? String(input.threshold) : null,
          enabled: false,
          approvedBy: null,
          approvedAt: null,
          requiresHumanConfirm: true,
          createdBy: ctx.user.id,
        })
        .returning();
      return row;
    }),

  update: protectedProcedure
    .use(requirePermission("interlock", "canEdit"))
    .input(ruleInput.partial().extend({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const { id, threshold, ...rest } = input;
      const [existing] = await db.select().from(interlockRules).where(eq(interlockRules.id, id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Rule không tồn tại." });
      const patch: Record<string, unknown> = { ...rest, updatedAt: new Date(), updatedBy: ctx.user.id };
      if (threshold !== undefined) patch.threshold = threshold != null ? String(threshold) : null;
      const [row] = await db.update(interlockRules).set(patch).where(eq(interlockRules.id, id)).returning();
      return row;
    }),

  delete: protectedProcedure
    .use(requirePermission("interlock", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db.delete(interlockRules).where(eq(interlockRules.id, input.id));
      return { success: true };
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      // ADMIN-ONLY: approving a rule is a privileged safety decision.
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin được duyệt interlock rule." });
      }
      const db = await getDb();
      const [existing] = await db.select().from(interlockRules).where(eq(interlockRules.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Rule không tồn tại." });
      const [row] = await db
        .update(interlockRules)
        .set({ approvedBy: ctx.user.id, approvedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.user.id })
        .where(eq(interlockRules.id, input.id))
        .returning();
      return row;
    }),

  enable: protectedProcedure
    .use(requirePermission("interlock", "canEdit"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const [existing] = await db.select().from(interlockRules).where(eq(interlockRules.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Rule không tồn tại." });
      // SAFETY: cannot enable a rule that has not been approved.
      if (existing.approvedBy == null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Rule chưa được duyệt (approvedBy=null) — không thể bật." });
      }
      const [row] = await db
        .update(interlockRules)
        .set({ enabled: true, updatedAt: new Date(), updatedBy: ctx.user.id })
        .where(eq(interlockRules.id, input.id))
        .returning();
      return row;
    }),

  disable: protectedProcedure
    .use(requirePermission("interlock", "canEdit"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const [row] = await db
        .update(interlockRules)
        .set({ enabled: false, updatedAt: new Date(), updatedBy: ctx.user.id })
        .where(eq(interlockRules.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Rule không tồn tại." });
      return row;
    }),

  events: protectedProcedure
    .use(requirePermission("interlock", "canView"))
    .input(z.object({
      ruleId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      return db
        .select()
        .from(interlockEvents)
        .where(input?.ruleId ? eq(interlockEvents.ruleId, input.ruleId) : undefined)
        .orderBy(desc(interlockEvents.firedAt))
        .limit(input?.limit ?? 100);
    }),

  resolveEvent: protectedProcedure
    .use(requirePermission("interlock", "canEdit"))
    .input(z.object({ id: z.number().int().positive(), notes: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const [row] = await db
        .update(interlockEvents)
        .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: ctx.user.id, notes: input.notes })
        .where(eq(interlockEvents.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Event không tồn tại." });
      return row;
    }),

  /**
   * DRY-RUN evaluation against a supplied observed value (or series). Reports
   * whether the condition fires and the ALERT-ONLY outcome. NEVER writes
   * anything — no event, no Andon, no command.
   */
  testEvaluate: protectedProcedure
    .use(requirePermission("interlock", "canView"))
    .input(z.object({
      id: z.number().int().positive(),
      observedValue: z.number().optional(),
      series: z.array(z.number()).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [rule] = await db.select().from(interlockRules).where(eq(interlockRules.id, input.id)).limit(1);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Rule không tồn tại." });

      const observed = input.observedValue ?? deriveObserved(rule.sourceType as InterlockSourceType, { series: input.series, scalar: input.observedValue });
      const threshold = rule.threshold != null ? Number(rule.threshold) : null;
      const wouldFire = evaluateCondition(
        observed,
        rule.comparisonOperator as ComparisonOperator,
        threshold,
        rule.consecutiveCount,
        input.series,
      );

      let outcome: "none" | "alert_only" | "proposed" | "skipped" = "none";
      if (wouldFire) {
        if (rule.action === "alert") outcome = "alert_only";
        else outcome = rule.requiresHumanConfirm ? "proposed" : "skipped";
      }
      return {
        dryRun: true,
        wouldFire,
        observed,
        threshold,
        action: rule.action,
        outcome,
        enabled: rule.enabled,
        approved: rule.approvedBy != null,
        note: "DRY-RUN: no event/Andon/command was created (F5a alert-only).",
      };
    }),
});
