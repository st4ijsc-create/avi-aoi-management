/**
 * doc 81 Đợt 3 Task 4 (QĐ-3a) — tầng dữ liệu của "giao việc" Kỹ thuật + hộp "Của tôi".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * • `PENDING_WHERE` — điều kiện "CHỜ DUYỆT" của từng loại, DÙNG CHUNG với `oversight.pendingSummary`
 *   (cùng một vị từ cho "Chờ duyệt" và "Của tôi" — hai phạm vi không thể lệch nhau).
 * • `loadTarget` — đọc mục đích (có/không, đang chờ duyệt?, nhãn, link sâu) — KHOÁ HÀNG khi giao.
 * • `fetchMineCategory` — đếm + mẫu các mục ĐANG CHỜ DUYỆT mà phân công `active` trỏ tới người xem.
 * • doc 81 Đợt 3 Task 4 fix 1 (R-3-f) — phân công gắn với MỘT ĐỢT CHỜ DUYỆT (`pending_episode`). Chọn phương án
 *   "LỌC LƯỜI" của ruling, KHÔNG móc vào giao dịch đổi trạng thái: các đường rời "chờ duyệt" nằm rải ở ≥8 chỗ
 *   (ecnService.transition, recipes.approve/archive, interlock.approve/update, changeover.approve/reject/cancel, máy
 *   trạng thái orchestration…) và đổi các giao dịch ấy là đổi đường duyệt (GC3). Thay vào đó MỘT phân công chỉ
 *   "sống" khi: `active` ∧ mục ĐANG chờ duyệt (`PENDING_WHERE`) ∧ `pending_episode` = đợt chờ duyệt HIỆN TẠI
 *   (`EPISODE_SQL`). Mục được duyệt/từ chối/đóng ⇒ rời "Của tôi" và cột "Người được giao" NGAY (vế chờ duyệt); mục
 *   quay lại chờ duyệt ⇒ đợt mới ⇒ phân công cũ KHÔNG sống lại (vế đợt). Hàng `active` đã chết được TẮT thật ở lượt
 *   giao kế tiếp cho mục đó (audit `expire`, không thông báo) — nên giao lại không bao giờ vấp CONFLICT vì hàng cũ.
 *   Tên mục (samples) CHỈ khi `showNames` (luật HUB-02 của pendingSummary — quyền xem THẬT của trang đích).
 *
 * ⚠ ĐƯỢC GIAO ≠ ĐƯỢC DUYỆT: file này không được bất kỳ cổng duyệt / maker-checker nào gọi.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  engineeringChanges,
  machineRecipes,
  interlockRules,
  changeoverRequests,
  orchestrationRuns,
  machines,
  engineeringAssignments,
  controlAuditLog,
  users,
} from "../../../drizzle/schema";
import { assignmentDeepLink, type AssignableEntityType } from "@shared/engineeringAssignment";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Vị từ "chờ duyệt" — đúng các điều kiện `oversightRouter` đếm (ECN/recipe nháp/rule/changeover/run). */
export const PENDING_WHERE: Readonly<Record<AssignableEntityType, SQL>> = {
  ecn: inArray(engineeringChanges.status, ["submitted", "in_review"]),
  recipe: and(eq(machineRecipes.status, "draft"), isNull(machineRecipes.approvedBy)) as SQL,
  interlock_rule: isNull(interlockRules.approvedBy),
  changeover: eq(changeoverRequests.status, "pending"),
  orchestration_run: inArray(orchestrationRuns.status, ["held", "awaiting_confirm"]),
};

/**
 * Khoá ĐỢT CHỜ DUYỆT hiện tại của mục (so với `engineering_assignments.pending_episode` lúc giao):
 *   • ECN — `submittedAt` (mỗi lần gửi duyệt đặt lại; luồng hiện tại không cho quay lại chờ, khoá vẫn đúng nếu sau này cho);
 *   • recipe nháp / changeover — một phiên bản/yêu cầu không bao giờ quay lại chờ duyệt ⇒ hằng '';
 *   • interlock rule — số lần ĐÃ DUYỆT (dòng `approve` của `control_audit_log`, ghi CÙNG giao dịch với lượt duyệt):
 *     sửa rule đã duyệt ⇒ `approvedBy/approvedAt` bị xoá (ILK-01) ⇒ chờ duyệt lại với khoá MỚI;
 *     ⚠ rule được duyệt THẲNG trong CSDL (seed, không qua router) không sinh dòng audit ⇒ không tách đợt được;
 *   • orchestration run — fix 2: `pending_epoch` (bộ đếm do TRIGGER mig 0363 tăng ở MỌI lần run VÀO held/awaiting_confirm
 *     từ trạng thái không chờ — resume rồi rehydrate/edge giữ lại ĐÚNG bước cũ vẫn là đợt MỚI) + `currentStepId`. Cột KHÔNG
 *     khai trong drizzle schema (DB chưa áp 0363 không được hỏng `select().from(orchestrationRuns)`), nên đọc bằng SQL thô
 *     — chưa áp ⇒ 42703 ⇒ "Của tôi" degraded / giao trả `assignmentStoreMissing`.
 */
export const EPISODE_SQL: Readonly<Record<AssignableEntityType, SQL>> = {
  ecn: sql`coalesce(to_char(${engineeringChanges.submittedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US'), '')`,
  recipe: sql`''`,
  interlock_rule: sql`(SELECT count(*) FROM ${controlAuditLog} WHERE ${controlAuditLog.entityType} = 'interlock_rule'
    AND ${controlAuditLog.entityId} = (${interlockRules.id})::text AND ${controlAuditLog.action} = 'approve')::text`,
  changeover: sql`''`,
  orchestration_run: sql`(${sql.raw('"orchestration_runs"."pending_epoch"')})::text || ':' || coalesce(${orchestrationRuns.currentStepId}, '')`,
};

const TABLE_ID = {
  ecn: engineeringChanges.id,
  recipe: machineRecipes.id,
  interlock_rule: interlockRules.id,
  changeover: changeoverRequests.id,
  orchestration_run: orchestrationRuns.id,
} as const;

export interface AssignTarget {
  id: number;
  pending: boolean;
  /** Nhãn hiển thị (mã/tên) — chỉ dùng cho thông báo tới người ĐÃ được kiểm quyền xem. */
  label: string;
  deepLink: string;
  /** Khoá đợt chờ duyệt hiện tại (`EPISODE_SQL`). */
  episode: string;
}

/**
 * Đọc mục đích. `lock` ⇒ `FOR SHARE` (giao trong giao dịch: mục không đổi trạng thái — vd bị duyệt — giữa lúc kiểm và lúc ghi; không chặn lượt đọc nào).
 * Trả `null` khi không có mục đó.
 */
export async function loadTarget(d: DbOrTx, type: AssignableEntityType, id: number, lock = false): Promise<AssignTarget | null> {
  const where = eq(TABLE_ID[type], id);
  const pendingCol = sql<boolean>`(${PENDING_WHERE[type]})`.as("pending");
  const episodeCol = sql<string>`${EPISODE_SQL[type]}`.as("episode");
  switch (type) {
    case "ecn": {
      const q = d.select({ id: engineeringChanges.id, ecnKey: engineeringChanges.ecnKey, title: engineeringChanges.title, pending: pendingCol, episode: episodeCol })
        .from(engineeringChanges).where(where).limit(1);
      const [r] = lock ? await q.for("share") : await q;
      return r ? { id: r.id, pending: r.pending === true, episode: String(r.episode ?? ""), label: `${r.ecnKey} · ${r.title}`, deepLink: assignmentDeepLink(type, { id: r.id }) } : null;
    }
    case "recipe": {
      const q = d.select({ id: machineRecipes.id, code: machineRecipes.code, name: machineRecipes.name, version: machineRecipes.version, pending: pendingCol, episode: episodeCol })
        .from(machineRecipes).where(where).limit(1);
      const [r] = lock ? await q.for("share") : await q;
      return r ? { id: r.id, pending: r.pending === true, episode: String(r.episode ?? ""), label: `${r.code} v${r.version} · ${r.name}`, deepLink: assignmentDeepLink(type, { id: r.id, code: r.code }) } : null;
    }
    case "interlock_rule": {
      const q = d.select({ id: interlockRules.id, name: interlockRules.name, pending: pendingCol, episode: episodeCol })
        .from(interlockRules).where(where).limit(1);
      const [r] = lock ? await q.for("share") : await q;
      return r ? { id: r.id, pending: r.pending === true, episode: String(r.episode ?? ""), label: r.name, deepLink: assignmentDeepLink(type, { id: r.id }) } : null;
    }
    case "changeover": {
      const q = d.select({ id: changeoverRequests.id, machineId: changeoverRequests.machineId, recipeId: changeoverRequests.recipeId, pending: pendingCol, episode: episodeCol })
        .from(changeoverRequests).where(where).limit(1);
      const [r] = lock ? await q.for("share") : await q;
      return r ? { id: r.id, pending: r.pending === true, episode: String(r.episode ?? ""), label: `#${r.id} · machine #${r.machineId} · recipe #${r.recipeId}`, deepLink: assignmentDeepLink(type, { id: r.id }) } : null;
    }
    case "orchestration_run": {
      const q = d.select({ id: orchestrationRuns.id, workflowRef: orchestrationRuns.workflowRef, pending: pendingCol, episode: episodeCol })
        .from(orchestrationRuns).where(where).limit(1);
      const [r] = lock ? await q.for("share") : await q;
      return r ? { id: r.id, pending: r.pending === true, episode: String(r.episode ?? ""), label: r.workflowRef ? `run #${r.id} · ${r.workflowRef}` : `run #${r.id}`, deepLink: assignmentDeepLink(type, { id: r.id }) } : null;
    }
  }
}

/** Phân công ĐANG hiệu lực của một mục (tối đa một — chỉ mục duy nhất có điều kiện). */
export async function activeAssignmentOf(d: DbOrTx, type: AssignableEntityType, id: number, lock = false) {
  const q = d.select().from(engineeringAssignments)
    .where(and(eq(engineeringAssignments.entityType, type), eq(engineeringAssignments.entityId, id), eq(engineeringAssignments.active, true)))
    .limit(1);
  const [r] = lock ? await q.for("update") : await q;
  return r ?? null;
}

/** Một mục mẫu của Hub (cùng hình dạng `SampleItem` của oversightRouter). */
export interface MineSample { id: number; label: string; hint?: string }
export interface MineCategory { count: number; samples: MineSample[]; degraded: boolean }

/**
 * Điều kiện nối của phân công SỐNG (R-3-f): `active` + đúng loại/mục + ĐÚNG đợt chờ duyệt hiện tại; `userId` (tuỳ chọn)
 * = chỉ phân công trỏ tới người ấy. Luôn đi KÈM `PENDING_WHERE[type]` ở mệnh đề WHERE.
 */
export function liveJoin(type: AssignableEntityType, userId?: number): SQL {
  return and(
    eq(engineeringAssignments.entityType, type),
    eq(engineeringAssignments.entityId, TABLE_ID[type]),
    eq(engineeringAssignments.active, true),
    sql`${engineeringAssignments.pendingEpisode} = ${EPISODE_SQL[type]}`,
    userId != null ? eq(engineeringAssignments.assigneeUserId, userId) : undefined,
  ) as SQL;
}
const mineJoin = (type: AssignableEntityType, userId: number) => liveJoin(type, userId);

const COUNT = sql<number>`count(*)::int`;

/**
 * Hộp "Của tôi" của MỘT loại: đếm + (khi `showNames`) tối đa 5 mẫu, mới giao trước. Lỗi (bảng 0363 chưa áp,
 * DB rớt…) ⇒ `degraded:true`, KHÔNG throw — đúng luật fail-safe từng nhánh của pendingSummary.
 */
export async function fetchMineCategory(d: Db, type: AssignableEntityType, userId: number, showNames: boolean): Promise<MineCategory> {
  try {
    const join = mineJoin(type, userId);
    const where = PENDING_WHERE[type];
    const order = desc(engineeringAssignments.assignedAt);
    switch (type) {
      case "ecn": {
        const [{ c }] = await d.select({ c: COUNT }).from(engineeringChanges).innerJoin(engineeringAssignments, join).where(where);
        const rows = showNames
          ? await d.select({ id: engineeringChanges.id, ecnKey: engineeringChanges.ecnKey, title: engineeringChanges.title, status: engineeringChanges.status })
              .from(engineeringChanges).innerJoin(engineeringAssignments, join).where(where).orderBy(order).limit(5)
          : [];
        return { count: c ?? 0, degraded: false, samples: rows.map((r) => ({ id: r.id, label: `${r.ecnKey} · ${r.title}`, hint: r.status })) };
      }
      case "recipe": {
        const [{ c }] = await d.select({ c: COUNT }).from(machineRecipes).innerJoin(engineeringAssignments, join).where(where);
        const rows = showNames
          ? await d.select({ id: machineRecipes.id, code: machineRecipes.code, name: machineRecipes.name, version: machineRecipes.version })
              .from(machineRecipes).innerJoin(engineeringAssignments, join).where(where).orderBy(order).limit(5)
          : [];
        return { count: c ?? 0, degraded: false, samples: rows.map((r) => ({ id: r.id, label: `${r.code} · ${r.name}`, hint: `v${r.version}` })) };
      }
      case "interlock_rule": {
        const [{ c }] = await d.select({ c: COUNT }).from(interlockRules).innerJoin(engineeringAssignments, join).where(where);
        const rows = showNames
          ? await d.select({ id: interlockRules.id, name: interlockRules.name, action: interlockRules.action })
              .from(interlockRules).innerJoin(engineeringAssignments, join).where(where).orderBy(order).limit(5)
          : [];
        return { count: c ?? 0, degraded: false, samples: rows.map((r) => ({ id: r.id, label: r.name, hint: r.action })) };
      }
      case "changeover": {
        const [{ c }] = await d.select({ c: COUNT }).from(changeoverRequests).innerJoin(engineeringAssignments, join).where(where);
        const rows = showNames
          ? await d.select({
                id: changeoverRequests.id,
                machineName: machines.name,
                machineCode: machines.code,
                recipeCode: machineRecipes.code,
                recipeVersion: machineRecipes.version,
              })
              .from(changeoverRequests)
              .innerJoin(engineeringAssignments, join)
              .leftJoin(machines, eq(changeoverRequests.machineId, machines.id))
              .leftJoin(machineRecipes, eq(changeoverRequests.recipeId, machineRecipes.id))
              .where(where).orderBy(order).limit(5)
          : [];
        return {
          count: c ?? 0,
          degraded: false,
          samples: rows.map((r) => ({
            id: r.id,
            label: r.machineName ?? r.machineCode ?? `#${r.id}`,
            hint: r.recipeCode != null ? `${r.recipeCode} v${r.recipeVersion}` : undefined,
          })),
        };
      }
      case "orchestration_run": {
        const [{ c }] = await d.select({ c: COUNT }).from(orchestrationRuns).innerJoin(engineeringAssignments, join).where(where);
        const rows = showNames
          ? await d.select({ id: orchestrationRuns.id, workflowRef: orchestrationRuns.workflowRef, status: orchestrationRuns.status, currentStepId: orchestrationRuns.currentStepId })
              .from(orchestrationRuns).innerJoin(engineeringAssignments, join).where(where).orderBy(order).limit(5)
          : [];
        return {
          count: c ?? 0,
          degraded: false,
          samples: rows.map((r) => ({ id: r.id, label: r.workflowRef ?? `run #${r.id}`, hint: r.currentStepId ? `${r.status} · ${r.currentStepId}` : r.status })),
        };
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[oversight] mine ${type} count failed:`, err instanceof Error ? err.message : err);
    return { count: 0, samples: [], degraded: true };
  }
}

/** Một phân công SỐNG cho cột "Người được giao" — chỉ tên hiển thị (không username/email/vai). */
export interface LiveAssignmentRow {
  entityId: number;
  assigneeUserId: number;
  assigneeName: string | null;
  assignedAt: Date;
  note: string | null;
}

const ENTITY_TABLE = {
  ecn: engineeringChanges,
  recipe: machineRecipes,
  interlock_rule: interlockRules,
  changeover: changeoverRequests,
  orchestration_run: orchestrationRuns,
} as const;

/**
 * doc 81 Đợt 3 Task 4 fix 1 (R-3-f) — phân công SỐNG của ĐÚNG các mục được hỏi (`entityIds`), sắp theo id mục. Không
 * trần hàng: số hàng ≤ số id được hỏi (mỗi mục tối đa một phân công active — chỉ mục UNIQUE).
 */
export async function fetchLiveAssignments(d: Db, type: AssignableEntityType, entityIds: number[]): Promise<LiveAssignmentRow[]> {
  if (entityIds.length === 0) return [];
  const T = ENTITY_TABLE[type] as typeof engineeringChanges;
  const idCol = TABLE_ID[type];
  return d
    .select({
      entityId: engineeringAssignments.entityId,
      assigneeUserId: engineeringAssignments.assigneeUserId,
      assigneeName: users.name,
      assignedAt: engineeringAssignments.assignedAt,
      note: engineeringAssignments.note,
    })
    .from(T)
    .innerJoin(engineeringAssignments, liveJoin(type))
    .leftJoin(users, eq(users.id, engineeringAssignments.assigneeUserId))
    .where(and(PENDING_WHERE[type], inArray(idCol, entityIds)))
    .orderBy(asc(engineeringAssignments.entityId));
}
