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
 *   • fix 1 (R-3-e) — GIAO / BỎ GIAO / roster = ĐÚNG cổng của đường sửa/duyệt thật: sàn vai (+2FA) + giấy phép + bit
 *     quyền (`services/engineeringAssignment/assignGate.ts#requireAssignGate`, chạy chính thân kiểm của roleProcedure/
 *     require2FA/moduleGate/requirePermission);
 *   • NGƯỜI ĐƯỢC GIAO phải tồn tại, đang hoạt động, và XEM được trang đích (`viewModules`, mọi module canView) — fix 1:
 *     ba trường hợp trả MỘT lời từ chối chung (`assigneeInvalid`) để người giao không dò được trạng thái tài khoản;
 *   • ĐỌC phân công (cột "Người được giao") = quyền xem trang đó, CHỈ các id được hỏi, CHỈ phân công còn sống.
 * Phạm vi tenant/nhà máy: năm router thực thể không lọc theo nhà máy (nằm trong sổ nợ `phamViDocBaseline.ts`). doc 81 Đợt 5
 * H5 (mục 30): AI được giao thì có — roster và người được giao chỉ gồm người CÙNG ≥1 nhà máy với mục (mục không có nhà máy ⇒
 * với người giao); admin gọi ⇒ không đổi (`services/engineeringAssignment/rosterScope.ts`).
 * Fix round 1 — R-5-m: mục NGOÀI phạm vi người giao ≡ không tồn tại (NOT_FOUND, roster lẫn `assign`); MỘT luật người được
 * giao cho roster và `assign` (`assigneeRuleSql`; run: người được giao xem được MỌI đích không-DỪNG); người hợp lệ nhưng
 * ngoài luật ⇒ CÙNG lời từ chối `assigneeInvalid` (câu đã dịch nêu mọi trường hợp) — security scan: không lộ tài khoản
 * nhà máy khác. `assignments` / `unassign`: mục ngoài phạm vi người gọi ≡ không tồn tại.
 *
 * fix 1 (R-3-f) — phân công gắn với MỘT ĐỢT CHỜ DUYỆT (`pending_episode`; xem `assignmentService.ts#EPISODE_SQL`): mục
 * rời chờ duyệt ⇒ hết hiệu lực ngay ở mọi lượt đọc; hàng `active` đã chết bị TẮT ở lượt giao kế tiếp (audit `expire`).
 *
 * Mỗi lần giao / bỏ giao (trong MỘT giao dịch): 1 dòng `control_audit_log` + 1 dòng `notifications` cho người
 * được giao (hoặc người bị bỏ giao) với `actionUrl` = link sâu tới đúng mục. Giao lại A→B = bỏ giao A + giao B
 * (2 audit, 2 thông báo — mỗi người nhận đúng một). Thông báo BỎ GIAO không mang tên mục (fix 1 — người cũ có thể đã
 * mất quyền xem): chỉ loại + #id. Chống đua: `expectedAssigneeUserId` (CAS, như `ecn.transition#expectedStatus`) + chỉ
 * mục UNIQUE `… WHERE active` (lượt thua ⇒ CONFLICT).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { runIdVisibleTo, visibleRunIds } from "../services/orchestration/foe/foeEngine"; // doc 81 Đợt 5 task E fix 1
import { resolveUserFoeScope } from "../services/orchestration/foe/foeScope";
const foeScopeOf = (user: { id: number; role: string }) => resolveUserFoeScope({ id: user.id, role: String(user.role) });
import { and, asc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { appError } from "../_core/appError";
import { checkPermission, permissionHeldSql } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { engineeringAssignments, notifications, users } from "../../drizzle/schema";
import { recordAuditEvent } from "../services/audit/controlAuditService";
import {
  loadTarget,
  activeAssignmentOf,
  fetchLiveAssignments,
  type DbOrTx,
} from "../services/engineeringAssignment/assignmentService";
import { requireAssignGate, requireLicense } from "../services/engineeringAssignment/assignGate";
import { assigneeRuleSql, entityIdsInAssignerScope, resolveTargetForAssigner } from "../services/engineeringAssignment/rosterScope";
import { ASSIGNABLE, ASSIGNABLE_ENTITY_TYPES, assignmentDeepLink, type AssignableEntityType } from "@shared/engineeringAssignment";

const entityTypeInput = z.enum(ASSIGNABLE_ENTITY_TYPES);
const OP_ASSIGN = "assignEngineeringItem";
const OP_UNASSIGN = "unassignEngineeringItem";
/** Roster "Giao cho" — trần số người trả về (danh sách lọc phía client trong EntityPicker). Ghi chú chủ dự án. */
const ROSTER_LIMIT = 300;
/** Số id tối đa mỗi lượt đọc phân công (bảng của trang: ECN 200, run 25, rule/recipe/changeover nhỏ hơn). */
const MAX_IDS = 1000;

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
  if (code === "42P01" || code === "42703") {
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
    // doc 81 Đợt 3b final wave — khoá i18n + tham số: chuông dịch bằng t() theo ngôn ngữ người đọc; `title`/`message` tiếng
    // Việt ở trên chỉ còn là dự phòng (hàng cũ / khoá thiếu). Bỏ giao ⇒ `label` null (KHÔNG mang tên mục — như câu tiếng Việt).
    metadata: {
      kind: "engineeringAssignment", action: kind, entityType: type, entityId, actorId: actor.id,
      i18n: {
        title: kind === "assigned" ? "notifications.assignment.assignedTitle" : "notifications.assignment.unassignedTitle",
        message: kind === "assigned" ? "notifications.assignment.assignedMessage" : "notifications.assignment.unassignedMessage",
        params: { label: kind === "assigned" ? label : null, by, entityType: type, entityId },
      },
    },
  });
}

/** Nhãn TRUNG TÍNH cho thông báo bỏ giao (người cũ có thể đã mất quyền xem — không gửi tên/tiêu đề mục). */
const neutralLabel = (type: AssignableEntityType, entityId: number) => `${TYPE_LABEL_VI[type]} #${entityId}`;

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
      await requireAssignGate(ctx, type);
      const d = await dbOrThrow();
      const notFound = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: ASSIGNABLE[type].errorEntity }, `${type} ${input.entityId} not found`);

      // doc 81 Đợt 5 task E fix 1 (R-5-d) — an orchestration run outside the ASSIGNER's factory scope does not exist for them.
      // H fix 1 (R-5-m, M4) — the same for every type: missing or outside the assigner's scope ⇒ NOT_FOUND, FIRST (before
      // anything about the assignee), one answer for both.
      const runInScope = type !== "orchestration_run" || (await runIdVisibleTo(input.entityId, foeScopeOf(ctx.user)));
      const scoped = runInScope ? await resolveTargetForAssigner(d, ctx, type, input.entityId) : null;
      if (!scoped) throw notFound();

      const [assignee] = await d
        .select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive })
        .from(users).where(eq(users.id, input.assigneeUserId)).limit(1);
      // fix 1 — không tồn tại / vô hiệu hoá / không xem được trang ⇒ MỘT lời từ chối (không lộ trạng thái tài khoản).
      if (!assignee || !assignee.isActive || !(await canViewTarget(assignee.id, assignee.role, type))) {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "assigneeUserId", reason: "assigneeInvalid" }, "Người được giao không hợp lệ.");
      }
      // doc 81 Đợt 5 H5 + H fix 1 (I1) — the ONE assignee rule shared with the roster (`assigneeRuleSql`): factory rule, and
      // for a run: the assignee sees EVERY non-STOP target. Outside the rule ⇒ the SAME refusal as a missing / disabled /
      // non-viewing account (security scan: a distinct answer would reveal that an id is a live account of another factory);
      // the translated sentence says every case (errors.reason.assigneeInvalid, vi/en/zh).
      const outOfScope = () =>
        appError("BAD_REQUEST", "INVALID_VALUE", { field: "assigneeUserId", reason: "assigneeInvalid" }, "Người được giao không hợp lệ.");
      const assigneeRule = await assigneeRuleSql(d, ctx, type, input.entityId, scoped.factories);
      if (assigneeRule) {
        const [inRule] = await d.select({ id: users.id }).from(users).where(and(eq(users.id, assignee.id), assigneeRule)).limit(1);
        if (!inRule) throw outOfScope();
      }
      // E fix 1 (R-5-d, review #3) — defence in depth: the engine's own check (same rule as above, by construction + test).
      const assigneeSeesRun =
        type !== "orchestration_run" || (await runIdVisibleTo(input.entityId, foeScopeOf({ id: assignee.id, role: assignee.role })));
      if (!assigneeSeesRun) throw outOfScope();

      try {
        return await d.transaction(async (tx) => {
          const target = await loadTarget(tx, type, input.entityId, true);
          if (!target) throw notFound();
          if (!target.pending) {
            throw appError("PRECONDITION_FAILED", "OPERATION_FAILED", { operation: OP_ASSIGN, reason: "assignTargetNotPending" }, "Chỉ giao được mục đang chờ duyệt.");
          }
          const auditId = `${type}:${input.entityId}`;
          const active = await activeAssignmentOf(tx, type, input.entityId, true);
          // R-3-f — hàng active của một ĐỢT chờ duyệt đã qua: không còn sống ⇒ tắt (audit `expire`, không thông báo) và
          // coi như chưa giao — giao lại KHÔNG vấp CONFLICT vì phân công cũ, người cũ KHÔNG thấy lại mục.
          let current: typeof active | null = active;
          if (active && active.pendingEpisode !== target.episode) {
            await tx.update(engineeringAssignments).set({ active: false }).where(eq(engineeringAssignments.id, active.id));
            await recordAuditEvent(tx, {
              entityType: "engineering_assignment", entityId: auditId, action: "expire", actorId: ctx.user.id,
              before: { assigneeUserId: active.assigneeUserId, assignmentId: active.id, pendingEpisode: active.pendingEpisode },
              after: null, reason: "pendingEpisodeEnded",
            });
            current = null;
          }
          const currentId = current?.assigneeUserId ?? null;
          if (currentId !== input.expectedAssigneeUserId) {
            throw appError("CONFLICT", "OPERATION_FAILED", { operation: OP_ASSIGN, reason: "assignmentChanged" }, "Người được giao đã đổi — tải lại.");
          }
          if (currentId === input.assigneeUserId) {
            throw appError("CONFLICT", "OPERATION_FAILED", { operation: OP_ASSIGN, reason: "alreadyAssignedToUser" }, "Mục đã được giao cho người này.");
          }
          if (current) {
            // Giao lại = bỏ giao người cũ (1 audit + 1 thông báo TRUNG TÍNH cho người cũ) rồi giao người mới.
            await tx.update(engineeringAssignments).set({ active: false }).where(eq(engineeringAssignments.id, current.id));
            await recordAuditEvent(tx, {
              entityType: "engineering_assignment", entityId: auditId, action: "unassign", actorId: ctx.user.id,
              before: { assigneeUserId: current.assigneeUserId, assignmentId: current.id }, after: null, reason: "reassign",
            });
            await notify(tx, current.assigneeUserId, "unassigned", type, input.entityId, neutralLabel(type, input.entityId), target.deepLink, ctx.user);
          }
          const [row] = await tx.insert(engineeringAssignments).values({
            entityType: type,
            entityId: input.entityId,
            assigneeUserId: assignee.id,
            assignedBy: ctx.user.id,
            note: input.note || null,
            pendingEpisode: target.episode,
          }).returning();
          await recordAuditEvent(tx, {
            entityType: "engineering_assignment", entityId: auditId, action: "assign", actorId: ctx.user.id,
            before: current ? { assigneeUserId: current.assigneeUserId } : null,
            after: { assigneeUserId: assignee.id, assignmentId: row.id, note: row.note, pendingEpisode: row.pendingEpisode },
            reason: input.note || null,
          });
          await notify(tx, assignee.id, "assigned", type, input.entityId, target.label, target.deepLink, ctx.user);
          return { id: row.id, entityType: type, entityId: input.entityId, assigneeUserId: assignee.id, assigneeName: assignee.name ?? null };
        });
      } catch (err) {
        rethrowStore(err, OP_ASSIGN);
      }
    }),

  /** Bỏ giao một phân công CÒN SỐNG (mục đang chờ duyệt, đúng đợt). */
  unassign: protectedProcedure
    .input(z.object({
      entityType: entityTypeInput,
      entityId: z.number().int().positive(),
      expectedAssigneeUserId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const type = input.entityType;
      await requireAssignGate(ctx, type);
      const d = await dbOrThrow();
      // E fix 1 (R-5-d) — out of the caller's orchestration scope ⇒ the SAME refusal as a missing / changed target.
      // H fix 1 (R-5-m, security scan) — the same for every type: outside the assigner's factories ≡ missing.
      const runInScope = type !== "orchestration_run" || (await runIdVisibleTo(input.entityId, foeScopeOf(ctx.user)));
      const inScope = runInScope && (await resolveTargetForAssigner(d, ctx, type, input.entityId)) !== null;
      try {
        return await d.transaction(async (tx) => {
          const target = inScope ? await loadTarget(tx, type, input.entityId, true) : null;
          const current = inScope ? await activeAssignmentOf(tx, type, input.entityId, true) : null;
          const live = !!target && target.pending && !!current && current.pendingEpisode === target.episode;
          if (!live || current!.assigneeUserId !== input.expectedAssigneeUserId) {
            throw appError("CONFLICT", "OPERATION_FAILED", { operation: OP_UNASSIGN, reason: "assignmentChanged" }, "Người được giao đã đổi — tải lại.");
          }
          await tx.update(engineeringAssignments).set({ active: false }).where(eq(engineeringAssignments.id, current!.id));
          await recordAuditEvent(tx, {
            entityType: "engineering_assignment", entityId: `${type}:${input.entityId}`, action: "unassign", actorId: ctx.user.id,
            before: { assigneeUserId: current!.assigneeUserId, assignmentId: current!.id }, after: null,
          });
          await notify(
            tx, current!.assigneeUserId, "unassigned", type, input.entityId,
            neutralLabel(type, input.entityId), assignmentDeepLink(type, { id: input.entityId, code: null }), ctx.user,
          );
          return { success: true as const };
        });
      } catch (err) {
        rethrowStore(err, OP_UNASSIGN);
      }
    }),

  /**
   * Phân công CÒN SỐNG (R-3-f) của ĐÚNG các mục được hỏi (cột "Người được giao") — sắp theo id mục, không trần hàng
   * (≤ số id hỏi). Ai xem được trang thì đọc được.
   */
  assignments: protectedProcedure
    .input(z.object({ entityType: entityTypeInput, entityIds: z.array(z.number().int().positive()).max(MAX_IDS) }))
    .query(async ({ ctx, input }) => {
      const type = input.entityType;
      await requireLicense(ctx, type);
      if (!(await canViewTarget(ctx.user.id, ctx.user.role, type))) {
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "canView" }, "Bạn không có quyền xem mục này.");
      }
      if (input.entityIds.length === 0) return [];
      const d = await dbOrThrow();
      try {
        // E fix 1 (R-5-d) — orchestration runs outside the caller's scope have no assignment row for them.
        // H fix 1 (R-5-m, security scan) — the same for every type: an item outside the caller's factories has no assignment
        // row for them (no assignee NAME crosses factories); identical to a missing id (both simply absent).
        let ids = [...new Set(input.entityIds)];
        if (type !== "orchestration_run") {
          ids = await entityIdsInAssignerScope(d, ctx, type, ids);
          if (ids.length === 0) return [];
        }
        if (type === "orchestration_run") {
          const visible = await visibleRunIds(ids, foeScopeOf(ctx.user));
          ids = ids.filter((id) => visible.has(id));
          if (ids.length === 0) return [];
        }
        return await fetchLiveAssignments(d, type, ids);
      } catch (err) {
        rethrowStore(err, OP_ASSIGN);
      }
    }),

  /**
   * Roster "Giao cho": người dùng ĐANG HOẠT ĐỘNG xem được trang đích (`viewModules`) — CHỈ `{id, name}`.
   * Chỉ người GIAO được mới đọc được (cùng cổng với `assign`, khuôn `user.assignableTechnicians`).
   *
   * doc 81 Đợt 4 Task C6 — vượt trần 300:
   *   • `search`: lọc theo TÊN (`ILIKE`, không phân biệt hoa thường) với `%`, `_`, `\` được THOÁT ⇒ người dùng gõ
   *     chữ nào tìm đúng chữ đó (không phải ký tự đại diện). Chỉ tên — đúng thứ roster vẫn trả, không dò email.
   *   • `selectedId`: người đang được chọn LUÔN có trong kết quả kể cả khi ngoài trần / ngoài search — NHƯNG chỉ khi
   *     người đó qua CÙNG bộ lọc (đang hoạt động + xem được trang): một id tuỳ ý không được biến roster thành chỗ dò
   *     tên người ngoài (fail-closed; người được giao đã mất quyền vẫn hiện ở client từ hàng phân công).
   *   • `truncated`: còn người hợp lệ ngoài trần ⇒ true (đọc trần + 1) — UI nói "gõ để thu hẹp".
   *
   * doc 81 Đợt 5 H5 (mục 30) — `entityId` (mục đang giao): chỉ người CÙNG ≥1 nhà máy với mục; mục không có nhà máy / không
   * gửi ⇒ cùng ≥1 nhà máy với người giao. Admin gọi ⇒ không lọc. Cùng bộ lọc cho `selectedId`.
   * H fix 1 — R-5-m: mục không tồn tại / ngoài phạm vi người giao ⇒ NOT_FOUND (một câu trả lời); luật người được giao là
   * `assigneeRuleSql` — CÙNG hàm với `assign` (run: người xem được mọi đích không-DỪNG).
   */
  assignableUsers: protectedProcedure
    .input(z.object({
      entityType: entityTypeInput,
      entityId: z.number().int().positive().optional(),
      search: z.string().trim().max(100).optional(),
      selectedId: z.number().int().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const type = input.entityType;
      await requireAssignGate(ctx, type);
      const d = await dbOrThrow();
      const canView = ASSIGNABLE[type].viewModules.map((m) => permissionHeldSql(users.id, users.role, m, "canView"));
      // R-5-d / R-5-m — mục KHÔNG TỒN TẠI hoặc NGOÀI phạm vi người giao ⇒ NOT_FOUND Y HỆT nhau (cùng mã, cùng câu, cùng điểm
      // ném — như `assign`): không lộ sự tồn tại, không trả người nào. Run: luật của E; bốn loại còn lại: mọi nhà máy của mục
      // ⊆ phạm vi người giao.
      let scoped: { factories: number[] } | null | undefined;
      if (input.entityId != null) {
        const runVisible = type !== "orchestration_run" || (await runIdVisibleTo(input.entityId, foeScopeOf(ctx.user)));
        scoped = runVisible ? await resolveTargetForAssigner(d, ctx, type, input.entityId) : null;
        if (!scoped) {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: ASSIGNABLE[type].errorEntity }, `${type} ${input.entityId} not found`);
        }
      }
      const assigneeRule = await assigneeRuleSql(d, ctx, type, input.entityId, scoped?.factories);
      const hopLe = [eq(users.isActive, true), ...canView, ...(assigneeRule ? [assigneeRule] : [])];
      const search = input.search?.trim() ?? "";
      const timTen = search
        ? sql`coalesce(${users.name}, '') ILIKE ${`%${thoatLike(search)}%`} ESCAPE '\\'`
        : undefined;
      const rows = await d
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(...hopLe, timTen))
        .orderBy(asc(sql`coalesce(${users.name}, '')`), asc(users.id))
        .limit(ROSTER_LIMIT + 1);
      const truncated = rows.length > ROSTER_LIMIT;
      const list = truncated ? rows.slice(0, ROSTER_LIMIT) : rows;
      if (input.selectedId != null && !list.some((u) => u.id === input.selectedId)) {
        const [sel] = await d
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(and(eq(users.id, input.selectedId), ...hopLe))
          .limit(1);
        if (sel) list.unshift(sel);
      }
      return { users: list, truncated };
    }),
});

/** doc 81 Đợt 4 C6 — thoát ký tự đại diện của LIKE (`\` trước, rồi `%`, `_`) cho `ESCAPE '\'`. */
function thoatLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const _internal = { canViewTarget, ROSTER_LIMIT, thoatLike };
