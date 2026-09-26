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
import { appError } from "../_core/appError";
import { and, eq, desc } from "drizzle-orm";
import {
  router,
  moduleProcedure,
  moduleGate,
  actuationProcedure as actuationBase,
  adminProcedure as adminBase,
} from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
// Doc 37 P0-3 — gate every procedure in this OT-control router behind the
// MOD_OT_CONTROL license (flag LICENSE_MODULE_GATE_ENABLED, default OFF → no-op).
// Shadowing `protectedProcedure` keeps existing procedure definitions untouched;
// RBAC via `.use(requirePermission(...))` still composes on top.
const protectedProcedure = moduleProcedure("MOD_OT_CONTROL");
// Doc 54 Wave B (P1) — interlock rule writes are OT-control actuation surfaces:
// add a role-floor (admin/supervisor/engineer) + 2FA ON TOP of the per-user
// `interlock` bit, keeping the MOD_OT_CONTROL license gate. `approve` is a
// privileged safety decision → admin + 2FA (adminProcedure enforces 2FA,
// replacing the old inline `role !== "admin"` check that BYPASSED 2FA).
const actuationProcedure = actuationBase.use(moduleGate("MOD_OT_CONTROL"));
const adminProcedure = adminBase.use(moduleGate("MOD_OT_CONTROL"));
import { interlockRules, interlockEvents } from "../../drizzle/schema";
import { evaluateCondition, deriveObserved, type ComparisonOperator, type InterlockSourceType } from "../services/interlock/ruleEvaluator";
import { recordAuditEvent } from "../services/audit/controlAuditService";

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
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
  // ILK-05 (doc 80 Phụ lục D §7.4) — schema CÓ cột `commandValue` (jsonb) nên lưu
  // thật thay vì âm thầm bỏ (trước vá: input này không tồn tại trên router → luôn
  // insert null bất kể form nhập gì, trong khi UI ghi chú "được GHI NHẬN"). Chấp
  // nhận bất kỳ giá trị JSON nào (bool/number/string/object) — khớp cột jsonb.
  commandValue: z.unknown().nullable().optional(),
  cooldownSeconds: z.number().int().min(0).max(86400).default(300),
});

/** ILK-05 — true khi rule có ÍT NHẤT một đích lệnh (máy / adapter / tag). */
function hasTarget(v: { targetMachineId?: number | null; targetAdapterId?: number | null; commandTag?: string | null }): boolean {
  return v.targetMachineId != null || v.targetAdapterId != null || !!(v.commandTag && v.commandTag.length > 0);
}

/** ILK-05 — hành động khác 'alert' (stop_line/reduce_speed/block_downstream…) bắt buộc có đích. */
function assertTargetIfNotAlert(action: string, target: { targetMachineId?: number | null; targetAdapterId?: number | null; commandTag?: string | null }): void {
  if (action !== "alert" && !hasTarget(target)) {
    throw appError(
      "BAD_REQUEST",
      "FIELD_REQUIRED",
      { field: "target" },
      "Hành động khác 'alert' (dừng/giảm tốc/chặn) cần ít nhất một đích: targetMachineId, targetAdapterId hoặc commandTag.",
    );
  }
}

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
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "interlockRule" }, "Rule không tồn tại.");
      return row;
    }),

  create: actuationProcedure
    .use(requirePermission("interlock", "canCreate"))
    .input(ruleInput)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // ILK-05 — validate BEFORE writing anything.
      assertTargetIfNotAlert(input.action, input);
      // ILK-10 — rule insert + audit row: cùng một transaction.
      return db.transaction(async (tx) => {
        // SAFETY: a freshly-created rule is ALWAYS disabled, unapproved, HITL-gated.
        const [row] = await tx
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
        // Audit bất biến: tạo rule an toàn.
        await recordAuditEvent(tx, { entityType: "interlock_rule", entityId: row.id, action: "create", actorId: ctx.user.id, before: null, after: row });
        return row;
      });
    }),

  update: actuationProcedure
    .use(requirePermission("interlock", "canEdit"))
    .input(ruleInput.partial().extend({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const { id, threshold, ...rest } = input;
      // ILK-10 — SELECT/UPDATE/audit-INSERT trong CÙNG một transaction.
      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(interlockRules).where(eq(interlockRules.id, id)).limit(1);
        if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "interlockRule" }, "Rule không tồn tại.");

        // ILK-05 — merge patch lên existing rồi kiểm: một update KHÔNG được âm
        // thầm bỏ đích cuối cùng của một rule action khác 'alert'.
        const mergedAction = "action" in rest ? (rest.action as string) : existing.action;
        const mergedTargetMachineId = "targetMachineId" in rest ? rest.targetMachineId ?? null : existing.targetMachineId;
        const mergedTargetAdapterId = "targetAdapterId" in rest ? rest.targetAdapterId ?? null : existing.targetAdapterId;
        const mergedCommandTag = "commandTag" in rest ? rest.commandTag ?? null : existing.commandTag;
        assertTargetIfNotAlert(mergedAction, {
          targetMachineId: mergedTargetMachineId,
          targetAdapterId: mergedTargetAdapterId,
          commandTag: mergedCommandTag,
        });

        const patch: Record<string, unknown> = { ...rest, updatedAt: new Date(), updatedBy: ctx.user.id };
        if (threshold !== undefined) patch.threshold = threshold != null ? String(threshold) : null;

        // ILK-01 (MOC, doc 80 Phụ lục D §7.4) — sửa một rule ĐANG duyệt và/hoặc
        // ĐANG bật ⇒ mất hiệu lực duyệt: reset approvedBy/approvedAt=null + ép
        // enabled=false, TRONG CÙNG transaction với patch. Áp dụng cả khi patch
        // chỉ đổi trường không ảnh hưởng hành vi (name/description) — Đợt 0 chọn
        // phương án AN TOÀN thay vì tự phân loại "trường nào ảnh hưởng hành vi".
        let reason: string | null = null;
        if (existing.approvedBy != null || existing.enabled === true) {
          patch.approvedBy = null;
          patch.approvedAt = null;
          patch.enabled = false;
          reason = "sửa rule đã duyệt ⇒ cần duyệt lại";
        }

        const [row] = await tx.update(interlockRules).set(patch).where(eq(interlockRules.id, id)).returning();
        // Audit bất biến: sửa rule (before/after để truy vết cấu hình an toàn).
        await recordAuditEvent(tx, { entityType: "interlock_rule", entityId: id, action: "update", actorId: ctx.user.id, before: existing, after: row, reason });
        return row;
      });
    }),

  delete: actuationProcedure
    .use(requirePermission("interlock", "canDelete"))
    // ILK-03 — hard-delete một rule an toàn PHẢI có lý do (ghi vào sổ audit).
    .input(z.object({ id: z.number().int().positive(), reason: z.string().min(3) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // ILK-10 — audit + hard-delete trong CÙNG transaction (before-audit vẫn
      // đứng trước DELETE, nay atomically: cả hai cùng đậu hoặc cùng rollback).
      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(interlockRules).where(eq(interlockRules.id, input.id)).limit(1);
        if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "interlockRule" }, "Rule không tồn tại.");
        await recordAuditEvent(tx, { entityType: "interlock_rule", entityId: input.id, action: "delete", actorId: ctx.user.id, before: existing, after: null, reason: input.reason });
        await tx.delete(interlockRules).where(eq(interlockRules.id, input.id));
        return { success: true };
      });
    }),

  approve: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      // ADMIN-ONLY + 2FA: approving a rule is a privileged safety decision.
      // adminProcedure enforces role==='admin' AND twoFactorEnabled (doc 54 Wave B),
      // closing the old inline check that bypassed the 2FA requirement.
      const db = await getDb();
      // ILK-10 — SELECT/UPDATE/audit trong CÙNG transaction.
      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(interlockRules).where(eq(interlockRules.id, input.id)).limit(1);
        if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "interlockRule" }, "Rule không tồn tại.");
        // ILK-02 (SoD) — người duyệt KHÔNG được là người tạo (createdBy) hay
        // người sửa cuối (updatedBy) của rule — MOC đòi một cặp mắt độc lập.
        if (existing.createdBy === ctx.user.id || existing.updatedBy === ctx.user.id) {
          throw appError(
            "FORBIDDEN",
            "PERMISSION_DENIED",
            { action: "selfApproveInterlockRule" },
            "Tách biệt trách nhiệm (SoD): người tạo/sửa rule không được tự duyệt.",
          );
        }
        const [row] = await tx
          .update(interlockRules)
          .set({ approvedBy: ctx.user.id, approvedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.user.id })
          .where(eq(interlockRules.id, input.id))
          .returning();
        // Audit bất biến: duyệt rule (quyết định an toàn có đặc quyền).
        await recordAuditEvent(tx, { entityType: "interlock_rule", entityId: input.id, action: "approve", actorId: ctx.user.id, before: existing, after: row });
        return row;
      });
    }),

  enable: actuationProcedure
    .use(requirePermission("interlock", "canEdit"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // ILK-10 — SELECT/UPDATE/audit trong CÙNG transaction.
      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(interlockRules).where(eq(interlockRules.id, input.id)).limit(1);
        if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "interlockRule" }, "Rule không tồn tại.");
        // SAFETY: cannot enable a rule that has not been approved.
        if (existing.approvedBy == null) {
          throw appError("FORBIDDEN", "OPERATION_FAILED", { operation: "activateInterlockRule" }, "Rule chưa được duyệt (approvedBy=null) — không thể bật.");
        }
        const [row] = await tx
          .update(interlockRules)
          .set({ enabled: true, updatedAt: new Date(), updatedBy: ctx.user.id })
          .where(eq(interlockRules.id, input.id))
          .returning();
        // Audit bất biến: bật rule an toàn.
        await recordAuditEvent(tx, { entityType: "interlock_rule", entityId: input.id, action: "enable", actorId: ctx.user.id, before: existing, after: row });
        return row;
      });
    }),

  disable: actuationProcedure
    .use(requirePermission("interlock", "canEdit"))
    // ILK-03 — tắt một rule an toàn ĐANG BẬT PHẢI có lý do (ghi vào sổ audit).
    .input(z.object({ id: z.number().int().positive(), reason: z.string().min(3) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // ILK-10 — SELECT/UPDATE/audit trong CÙNG transaction.
      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(interlockRules).where(eq(interlockRules.id, input.id)).limit(1);
        if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "interlockRule" }, "Rule không tồn tại.");
        const [row] = await tx
          .update(interlockRules)
          .set({ enabled: false, updatedAt: new Date(), updatedBy: ctx.user.id })
          .where(eq(interlockRules.id, input.id))
          .returning();
        // Audit bất biến: tắt rule an toàn (reason bắt buộc — ILK-03).
        await recordAuditEvent(tx, { entityType: "interlock_rule", entityId: input.id, action: "disable", actorId: ctx.user.id, before: existing, after: row, reason: input.reason });
        return row;
      });
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

  resolveEvent: actuationProcedure
    .use(requirePermission("interlock", "canEdit"))
    // ILK-03 — xử lý xong một sự kiện interlock PHẢI có lý do (ghi vào sổ audit
    // + lưu làm ghi chú của sự kiện khi caller không tự truyền `notes` riêng).
    .input(z.object({ id: z.number().int().positive(), notes: z.string().max(2000).optional(), reason: z.string().min(3) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // ILK-10 — SELECT/UPDATE/audit trong CÙNG transaction.
      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(interlockEvents).where(eq(interlockEvents.id, input.id)).limit(1);
        if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "interlockEvent" }, "Event không tồn tại.");
        const [row] = await tx
          .update(interlockEvents)
          .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: ctx.user.id, notes: input.notes ?? input.reason })
          .where(eq(interlockEvents.id, input.id))
          .returning();
        // Audit bất biến: xử lý sự kiện interlock (trước đây KHÔNG audit — ILK-03).
        await recordAuditEvent(tx, { entityType: "interlock_event", entityId: input.id, action: "resolve", actorId: ctx.user.id, before: existing, after: row, reason: input.reason });
        return row;
      });
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
      if (!rule) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "interlockRule" }, "Rule không tồn tại.");

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
