/**
 * doc 81 Đợt 3 Task 4 (QĐ-3a) — tầng dữ liệu của "giao việc" Kỹ thuật + hộp "Của tôi".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * • `PENDING_WHERE` — điều kiện "CHỜ DUYỆT" của từng loại, DÙNG CHUNG với `oversight.pendingSummary`
 *   (cùng một vị từ cho "Chờ duyệt" và "Của tôi" — hai phạm vi không thể lệch nhau).
 * • `loadTarget` — đọc mục đích (có/không, đang chờ duyệt?, nhãn, link sâu) — KHOÁ HÀNG khi giao.
 * • `fetchMineCategory` — đếm + mẫu các mục ĐANG CHỜ DUYỆT mà phân công `active` trỏ tới người xem.
 *   Tên mục (samples) CHỈ khi `showNames` (luật HUB-02 của pendingSummary — quyền xem THẬT của trang đích).
 *
 * ⚠ ĐƯỢC GIAO ≠ ĐƯỢC DUYỆT: file này không được bất kỳ cổng duyệt / maker-checker nào gọi.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  engineeringChanges,
  machineRecipes,
  interlockRules,
  changeoverRequests,
  orchestrationRuns,
  machines,
  engineeringAssignments,
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
}

/**
 * Đọc mục đích. `lock` ⇒ `FOR SHARE` (giao trong giao dịch: mục không đổi trạng thái — vd bị duyệt — giữa lúc kiểm và lúc ghi; không chặn lượt đọc nào).
 * Trả `null` khi không có mục đó.
 */
export async function loadTarget(d: DbOrTx, type: AssignableEntityType, id: number, lock = false): Promise<AssignTarget | null> {
  const where = eq(TABLE_ID[type], id);
  const pendingCol = sql<boolean>`(${PENDING_WHERE[type]})`.as("pending");
  switch (type) {
    case "ecn": {
      const q = d.select({ id: engineeringChanges.id, ecnKey: engineeringChanges.ecnKey, title: engineeringChanges.title, pending: pendingCol })
        .from(engineeringChanges).where(where).limit(1);
      const [r] = lock ? await q.for("share") : await q;
      return r ? { id: r.id, pending: r.pending === true, label: `${r.ecnKey} · ${r.title}`, deepLink: assignmentDeepLink(type, { id: r.id }) } : null;
    }
    case "recipe": {
      const q = d.select({ id: machineRecipes.id, code: machineRecipes.code, name: machineRecipes.name, version: machineRecipes.version, pending: pendingCol })
        .from(machineRecipes).where(where).limit(1);
      const [r] = lock ? await q.for("share") : await q;
      return r ? { id: r.id, pending: r.pending === true, label: `${r.code} v${r.version} · ${r.name}`, deepLink: assignmentDeepLink(type, { id: r.id, code: r.code }) } : null;
    }
    case "interlock_rule": {
      const q = d.select({ id: interlockRules.id, name: interlockRules.name, pending: pendingCol })
        .from(interlockRules).where(where).limit(1);
      const [r] = lock ? await q.for("share") : await q;
      return r ? { id: r.id, pending: r.pending === true, label: r.name, deepLink: assignmentDeepLink(type, { id: r.id }) } : null;
    }
    case "changeover": {
      const q = d.select({ id: changeoverRequests.id, machineId: changeoverRequests.machineId, recipeId: changeoverRequests.recipeId, pending: pendingCol })
        .from(changeoverRequests).where(where).limit(1);
      const [r] = lock ? await q.for("share") : await q;
      return r ? { id: r.id, pending: r.pending === true, label: `#${r.id} · machine #${r.machineId} · recipe #${r.recipeId}`, deepLink: assignmentDeepLink(type, { id: r.id }) } : null;
    }
    case "orchestration_run": {
      const q = d.select({ id: orchestrationRuns.id, workflowRef: orchestrationRuns.workflowRef, pending: pendingCol })
        .from(orchestrationRuns).where(where).limit(1);
      const [r] = lock ? await q.for("share") : await q;
      return r ? { id: r.id, pending: r.pending === true, label: r.workflowRef ? `run #${r.id} · ${r.workflowRef}` : `run #${r.id}`, deepLink: assignmentDeepLink(type, { id: r.id }) } : null;
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

/** Điều kiện nối: phân công `active` của loại `type`, trỏ tới `userId`, trên cột id của bảng thực thể. */
function mineJoin(type: AssignableEntityType, userId: number): SQL {
  return and(
    eq(engineeringAssignments.entityType, type),
    eq(engineeringAssignments.entityId, TABLE_ID[type]),
    eq(engineeringAssignments.active, true),
    eq(engineeringAssignments.assigneeUserId, userId),
  ) as SQL;
}

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
