/**
 * doc 81 Đợt 3 Task 4 (QĐ-3a) — `engineering.*`: GIAO VIỆC cho các mục chờ duyệt của tầng Kỹ thuật.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐƯỢC GIAO ≠ ĐƯỢC DUYỆT. Router này CHỈ ghi `engineering_assignments` (+ audit + thông báo). Không một
 *    cổng duyệt / maker-checker nào (ecn.transition, recipes.approve, interlock.approve, changeover.approve/
 *    reject, orchestration.resumeRun) đọc bảng ấy — lưới `engineeringAssignment.db.test.ts` đo trên chính
 *    các thủ tục duyệt rằng người được giao mà thiếu quyền vẫn bị từ chối, và tác giả tự giao cho mình vẫn
 *    bị SoD chặn.
 *
 * Cổng của từng loại lấy từ `shared/engineeringAssignment.ts` (danh sách DUY NHẤT; zod enum kiểm `entityType`):
 *   • giấy phép = module của router thực thể (`moduleGate` chạy NGUYÊN BẢN, cùng lời từ chối);
 *   • GIAO / BỎ GIAO = quyền sửa/duyệt của trang đó (`assignPerm`);
 *   • NGƯỜI ĐƯỢC GIAO phải tồn tại, đang hoạt động, và XEM được trang đích (`viewModules`, mọi module canView);
 *   • ĐỌC phân công (cột "Người được giao") = quyền xem trang đó.
 * Phạm vi tenant/nhà máy: GIỮ NHƯ THỰC THỂ — năm router thực thể không lọc theo nhà máy (nằm trong sổ nợ
 * `phamViDocBaseline.ts`), nên giao việc cũng chỉ mang cổng RBAC của chúng — không hẹp hơn, không rộng hơn.
 *
 * Mỗi lần giao / bỏ giao (trong MỘT giao dịch): 1 dòng `control_audit_log` + 1 dòng `notifications` cho người
 * được giao (hoặc người bị bỏ giao) với `actionUrl` = link sâu tới đúng mục. Giao lại A→B = bỏ giao A + giao B
 * (2 audit, 2 thông báo — mỗi người nhận đúng một). Chống đua: `expectedAssigneeUserId` (CAS, như
 * `ecn.transition#expectedStatus`) + chỉ mục UNIQUE `… WHERE active` (lượt thua ⇒ CONFLICT).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { appError } from "../_core/appError";
import { checkPermission, permissionHeldSql } from "../_core/accessControl";
import { moduleGate } from "../_core/moduleGate";
import { getDb } from "../db/connection";
import { engineeringAssignments, notifications, users } from "../../drizzle/schema";
import { recordAuditEvent } from "../services/audit/controlAuditService";
import { loadTarget, activeAssignmentOf, type DbOrTx } from "../services/engineeringAssignment/assignmentService";
import { ASSIGNABLE, ASSIGNABLE_ENTITY_TYPES, type AssignableEntityType } from "@shared/engineeringAssignment";

type Ctx = { user: { id: number; role: string; name?: string | null } };

const entityTypeInput = z.enum(ASSIGNABLE_ENTITY_TYPES);
const OP_ASSIGN = "assignEngineeringItem";
const OP_UNASSIGN = "unassignEngineeringItem";
/** Roster "Giao cho" — trần số người trả về (danh sách lọc phía client trong EntityPicker). */
const ROSTER_LIMIT = 300;

/** Giấy phép của router thực thể — chạy CHÍNH middleware `moduleGate` (cùng nhánh cho qua / cùng lời từ chối). */
async function requireLicense(ctx: Ctx, type: AssignableEntityType): Promise<void> {
  await moduleGate(ASSIGNABLE[type].licenseModule)({ ctx: ctx as never, next: async () => undefined });
}

/** Cổng GIAO/BỎ GIAO = quyền sửa/duyệt của trang (cùng hình dạng lỗi với `requirePermission`). */
async function requireAssignPermission(ctx: Ctx, type: AssignableEntityType): Promise<void> {
  const { module, action } = ASSIGNABLE[type].assignPerm;
  if (!(await checkPermission(ctx.user.id, ctx.user.role, module, action))) {
    const msg = `Bạn không có quyền ${action.replace("can", "").toLowerCase()} cho module "${module}"`;
    // `action` LITERAL từng nhánh (cổng appErrorParamsCoverage đòi khoá từ điển nhìn thấy được trong mã).
    if (action === "canCreate") throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "canCreate" }, msg);
    if (action === "canEdit") throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "canEdit" }, msg);
    throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "canView" }, msg);
  }
}

/** Xem được trang đích = MỌI module của `viewModules` có canView. */
async function canViewTarget(userId: number, role: string, type: AssignableEntityType): Promise<boolean> {
  for (const m of ASSIGNABLE[type].viewModules) {
    if (!(await checkPermission(userId, role, m, "canView"))) return false;
  }
  return true;
}

async function dbOrThrow() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
  return d;
}

/** Bảng 0363 chưa áp (42P01) ⇒ lời từ chối có mã, không phải 500 thô. */
function rethrowStore(err: unknown, operation: string): never {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (err instanceof TRPCError) throw err;
  if (code === "42P01") {
    throw appError("PRECONDITION_FAILED", "OPERATION_FAILED", { operation, reason: "assignmentStoreMissing" }, "engineering_assignments chưa có (migration 0363 chưa áp)");
  }
  if (code === "23505") {
    throw appError("CONFLICT", "OPERATION_FAILED", { operation, reason: "assignmentChanged" }, "Mục vừa được giao bởi người khác — tải lại.");
  }
  throw err;
}

const TYPE_LABEL_VI: Record<AssignableEntityType, string> = {
  ecn: "ECN",
  recipe: "recipe",
  interlock_rule: "interlock rule",
  changeover: "yêu cầu đổi model",
  orchestration_run: "lần chạy orchestration",
};

/** Một dòng thông báo cho đúng một người — chèn THẲNG trong giao dịch (không qua tuỳ chọn tắt thông báo). */
async function notify(
  tx: DbOrTx,
  userId: number,
  kind: "assigned" | "unassigned",
  type: AssignableEntityType,
  entityId: number,
  label: string,
  deepLink: string,
  actor: { id: number; name?: string | null },
) {
  const by = actor.name?.trim() || `#${actor.id}`;
  await tx.insert(notifications).values({
    userId,
    type: "INFO",
    title: kind === "assigned" ? `Bạn được giao: ${label}` : `Đã bỏ giao: ${label}`,
    message: kind === "assigned"
      ? `${by} giao cho bạn ${TYPE_LABEL_VI[type]} chờ duyệt. Được giao không đổi quyền duyệt.`
      : `${by} đã bỏ giao ${TYPE_LABEL_VI[type]} này khỏi bạn.`,
    entityType: `engineering_${type}`,
    entityId,
    actionUrl: deepLink,
    priority: "NORMAL",
    metadata: { kind: "engineeringAssignment", action: kind, entityType: type, entityId, actorId: actor.id },
  });
}

export const engineeringAssignmentRouter = router({
  /** Giao (hoặc giao lại) một mục ĐANG CHỜ DUYỆT cho một người. */
  assign: protectedProcedure
    .input(z.object({
      entityType: entityTypeInput,
      entityId: z.number().int().positive(),
      assigneeUserId: z.number().int().positive(),
      /** Người được giao mà client ĐANG thấy (null = chưa giao) — lệch ⇒ CONFLICT (CAS). */
      expectedAssigneeUserId: z.number().int().positive().nullable(),
      note: z.string().trim().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const type = input.entityType;
      await requireLicense(ctx, type);
      await requireAssignPermission(ctx, type);
      const d = await dbOrThrow();

      const [assignee] = await d
        .select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive })
        .from(users).where(eq(users.id, input.assigneeUserId)).limit(1);
      if (!assignee) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, `User ${input.assigneeUserId} not found`);
      if (!assignee.isActive) {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "assigneeUserId", reason: "assigneeInactive" }, "Người được giao đã bị vô hiệu hoá.");
      }
      if (!(await canViewTarget(assignee.id, assignee.role, type))) {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "assigneeUserId", reason: "assigneeCannotView" }, "Người được giao không xem được trang của mục này.");
      }

      try {
        return await d.transaction(async (tx) => {
          const target = await loadTarget(tx, type, input.entityId, true);
          if (!target) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: ASSIGNABLE[type].errorEntity }, `${type} ${input.entityId} not found`);
          if (!target.pending) {
            throw appError("PRECONDITION_FAILED", "OPERATION_FAILED", { operation: OP_ASSIGN, reason: "assignTargetNotPending" }, "Chỉ giao được mục đang chờ duyệt.");
          }
          const current = await activeAssignmentOf(tx, type, input.entityId, true);
          const currentId = current?.assigneeUserId ?? null;
          if (currentId !== input.expectedAssigneeUserId) {
            throw appError("CONFLICT", "OPERATION_FAILED", { operation: OP_ASSIGN, reason: "assignmentChanged" }, "Người được giao đã đổi — tải lại.");
          }
          if (currentId === input.assigneeUserId) {
            throw appError("CONFLICT", "OPERATION_FAILED", { operation: OP_ASSIGN, reason: "alreadyAssignedToUser" }, "Mục đã được giao cho người này.");
          }
          const auditId = `${type}:${input.entityId}`;
          if (current) {
            // Giao lại = bỏ giao người cũ (1 audit + 1 thông báo cho người cũ) rồi giao người mới.
            await tx.update(engineeringAssignments).set({ active: false }).where(eq(engineeringAssignments.id, current.id));
            await recordAuditEvent(tx, {
              entityType: "engineering_assignment", entityId: auditId, action: "unassign", actorId: ctx.user.id,
              before: { assigneeUserId: current.assigneeUserId, assignmentId: current.id }, after: null, reason: "reassign",
            });
            await notify(tx, current.assigneeUserId, "unassigned", type, input.entityId, target.label, target.deepLink, ctx.user);
          }
          const [row] = await tx.insert(engineeringAssignments).values({
            entityType: type,
            entityId: input.entityId,
            assigneeUserId: assignee.id,
            assignedBy: ctx.user.id,
            note: input.note || null,
          }).returning();
          await recordAuditEvent(tx, {
            entityType: "engineering_assignment", entityId: auditId, action: "assign", actorId: ctx.user.id,
            before: current ? { assigneeUserId: current.assigneeUserId } : null,
            after: { assigneeUserId: assignee.id, assignmentId: row.id, note: row.note },
            reason: input.note || null,
          });
          await notify(tx, assignee.id, "assigned", type, input.entityId, target.label, target.deepLink, ctx.user);
          return { id: row.id, entityType: type, entityId: input.entityId, assigneeUserId: assignee.id, assigneeName: assignee.name ?? null };
        });
      } catch (err) {
        rethrowStore(err, OP_ASSIGN);
      }
    }),

  /** Bỏ giao — mục ở BẤT KỲ trạng thái nào (dọn phân công cũ). */
  unassign: protectedProcedure
    .input(z.object({
      entityType: entityTypeInput,
      entityId: z.number().int().positive(),
      expectedAssigneeUserId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const type = input.entityType;
      await requireLicense(ctx, type);
      await requireAssignPermission(ctx, type);
      const d = await dbOrThrow();
      try {
        return await d.transaction(async (tx) => {
          const current = await activeAssignmentOf(tx, type, input.entityId, true);
          if (!current || current.assigneeUserId !== input.expectedAssigneeUserId) {
            throw appError("CONFLICT", "OPERATION_FAILED", { operation: OP_UNASSIGN, reason: "assignmentChanged" }, "Người được giao đã đổi — tải lại.");
          }
          await tx.update(engineeringAssignments).set({ active: false }).where(eq(engineeringAssignments.id, current.id));
          await recordAuditEvent(tx, {
            entityType: "engineering_assignment", entityId: `${type}:${input.entityId}`, action: "unassign", actorId: ctx.user.id,
            before: { assigneeUserId: current.assigneeUserId, assignmentId: current.id }, after: null,
          });
          const target = await loadTarget(tx, type, input.entityId);
          await notify(
            tx, current.assigneeUserId, "unassigned", type, input.entityId,
            target?.label ?? `${type} #${input.entityId}`, target?.deepLink ?? "/engineering-home?scope=mine", ctx.user,
          );
          return { success: true as const };
        });
      } catch (err) {
        rethrowStore(err, OP_UNASSIGN);
      }
    }),

  /** Phân công ĐANG hiệu lực của một loại (cột "Người được giao") — ai xem được trang thì đọc được. */
  assignments: protectedProcedure
    .input(z.object({ entityType: entityTypeInput, entityIds: z.array(z.number().int().positive()).max(500).optional() }))
    .query(async ({ ctx, input }) => {
      const type = input.entityType;
      await requireLicense(ctx, type);
      if (!(await canViewTarget(ctx.user.id, ctx.user.role, type))) {
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "canView" }, "Bạn không có quyền xem mục này.");
      }
      const d = await dbOrThrow();
      if (input.entityIds && input.entityIds.length === 0) return [];
      try {
        return await d
          .select({
            entityId: engineeringAssignments.entityId,
            assigneeUserId: engineeringAssignments.assigneeUserId,
            // CHỈ tên hiển thị — không username/email/vai (khuôn `user.assignableTechnicians`).
            assigneeName: users.name,
            assignedAt: engineeringAssignments.assignedAt,
            note: engineeringAssignments.note,
          })
          .from(engineeringAssignments)
          .leftJoin(users, eq(users.id, engineeringAssignments.assigneeUserId))
          .where(and(
            eq(engineeringAssignments.entityType, type),
            eq(engineeringAssignments.active, true),
            input.entityIds ? inArray(engineeringAssignments.entityId, input.entityIds) : undefined,
          ))
          .limit(1000);
      } catch (err) {
        rethrowStore(err, OP_ASSIGN);
      }
    }),

  /**
   * Roster "Giao cho": người dùng ĐANG HOẠT ĐỘNG xem được trang đích (`viewModules`) — CHỈ `{id, name}`.
   * Chỉ người GIAO được mới đọc được (cùng cổng với `assign`, khuôn `user.assignableTechnicians`).
   */
  assignableUsers: protectedProcedure
    .input(z.object({ entityType: entityTypeInput }))
    .query(async ({ ctx, input }) => {
      const type = input.entityType;
      await requireLicense(ctx, type);
      await requireAssignPermission(ctx, type);
      const d = await dbOrThrow();
      const canView = ASSIGNABLE[type].viewModules.map((m) => permissionHeldSql(users.id, users.role, m, "canView"));
      return d
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.isActive, true), ...canView))
        .orderBy(asc(sql`coalesce(${users.name}, '')`), asc(users.id))
        .limit(ROSTER_LIMIT);
    }),
});

export const _internal = { canViewTarget, ROSTER_LIMIT };
