/**
 * doc 81 Đợt 3 Task 4 (QĐ-3a) — DANH SÁCH DUY NHẤT các loại mục Kỹ thuật GIAO ĐƯỢC cho một người.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Một chỗ, hai bên đọc:
 *   • server — `engineering.assign/unassign` kiểm `entityType` bằng zod enum trên CHÍNH mảng này; cổng giao
 *     (quyền sửa/duyệt) + quyền XEM của người được giao + giấy phép đều lấy từ đây;
 *   • client — Hub "Của tôi" chỉ có các loại này; bộ chọn "Giao cho" biết ai bấm được.
 * Bảng `engineering_assignments` (mig 0363) CỐ Ý không có CHECK lặp lại danh sách (hai nguồn sẽ lệch).
 *
 * Phạm vi = các nhóm CHỜ DUYỆT của dải Hub (`PENDING_CATEGORIES` có `critical:false`): ECN · recipe nháp ·
 * interlock rule · changeover · orchestration run đang giữ. CR của Standards KHÔNG có trong dải ⇒ không có ở đây.
 *
 * ⚠ ĐƯỢC GIAO ≠ ĐƯỢC DUYỆT. Không cổng duyệt / maker-checker nào đọc danh sách này hay bảng phân công.
 * ════════════════════════════════════════════════════════════════════════════
 */

export const ASSIGNABLE_ENTITY_TYPES = ["ecn", "recipe", "interlock_rule", "changeover", "orchestration_run"] as const;
export type AssignableEntityType = (typeof ASSIGNABLE_ENTITY_TYPES)[number];

/** Khoá loại việc của `oversight.pendingSummary` / `PENDING_CATEGORIES` (client). */
export type AssignablePendingKey = "ecn" | "recipes" | "interlock" | "changeover" | "orchestration";

type PermAction = "canView" | "canCreate" | "canEdit";

export interface AssignableDef {
  type: AssignableEntityType;
  /** Nhóm của `pendingSummary` mà loại này thuộc về (Hub "Của tôi" đếm vào đúng nhóm này). */
  pendingKey: AssignablePendingKey;
  /**
   * Quyền SỬA/DUYỆT để được GIAO việc — đúng cổng client đang dùng cho nút quyết định của trang ấy
   * (server vẫn là tường thật của từng nút duyệt, không đổi).
   */
  assignPerm: { module: string; action: PermAction };
  /**
   * Người được giao phải XEM được trang đích: MỌI module ở đây cần `canView` (cổng route của trang + cổng
   * của danh sách chờ duyệt trên trang, khi hai cổng khác nhau).
   */
  viewModules: readonly string[];
  /** Giấy phép module của router thực thể (`moduleProcedure`/`moduleGate`). */
  licenseModule: "MOD_ENGINEERING" | "MOD_OT_CONTROL";
  /** Khoá thực thể của từ điển lỗi `errors.entity.*`. */
  errorEntity: string;
}

export const ASSIGNABLE: Readonly<Record<AssignableEntityType, AssignableDef>> = {
  // ecnRouter: MOD_ENGINEERING · xem = machine_control/canView · nút quyết định trên trang = machine_control/canEdit.
  ecn: {
    type: "ecn",
    pendingKey: "ecn",
    assignPerm: { module: "machine_control", action: "canEdit" },
    viewModules: ["machine_control"],
    licenseModule: "MOD_ENGINEERING",
    errorEntity: "ecn",
  },
  // machineRecipeRouter: MOD_OT_CONTROL · recipes.approve = machine_control/canEdit · /recipes = machine_control.
  recipe: {
    type: "recipe",
    pendingKey: "recipes",
    assignPerm: { module: "machine_control", action: "canEdit" },
    viewModules: ["machine_control"],
    licenseModule: "MOD_OT_CONTROL",
    errorEntity: "recipe",
  },
  // interlockRouter: MOD_OT_CONTROL · update/enable = interlock/canEdit (approve = admin) · /interlock-rules = interlock.
  interlock_rule: {
    type: "interlock_rule",
    pendingKey: "interlock",
    assignPerm: { module: "interlock", action: "canEdit" },
    viewModules: ["interlock"],
    licenseModule: "MOD_OT_CONTROL",
    errorEntity: "interlockRule",
  },
  // changeover.approve/reject = machine_control/canEdit · trang /product-changeover = machine_status, hàng đợi duyệt
  // trên trang (changeover.list) = machine_control/canView ⇒ cần CẢ HAI.
  changeover: {
    type: "changeover",
    pendingKey: "changeover",
    assignPerm: { module: "machine_control", action: "canEdit" },
    viewModules: ["machine_status", "machine_control"],
    licenseModule: "MOD_OT_CONTROL",
    errorEntity: "changeoverRequest",
  },
  // orchestrationRouter: MOD_ENGINEERING · resumeRun/abortRun = machine_control/canCreate · /orchestration-studio =
  // machine_control, listRuns = machine_monitoring ⇒ cần CẢ HAI.
  orchestration_run: {
    type: "orchestration_run",
    pendingKey: "orchestration",
    assignPerm: { module: "machine_control", action: "canCreate" },
    viewModules: ["machine_control", "machine_monitoring"],
    licenseModule: "MOD_ENGINEERING",
    errorEntity: "workflowRun",
  },
};

/** Các nhóm của Hub có phạm vi "Của tôi" (thứ tự = thứ tự `ASSIGNABLE_ENTITY_TYPES`). */
export const ASSIGNABLE_PENDING_KEYS: readonly AssignablePendingKey[] = ASSIGNABLE_ENTITY_TYPES.map((t) => ASSIGNABLE[t].pendingKey);

export function isAssignableEntityType(v: unknown): v is AssignableEntityType {
  return typeof v === "string" && (ASSIGNABLE_ENTITY_TYPES as readonly string[]).includes(v);
}

/**
 * Link sâu tới ĐÚNG mục (dùng cho `notifications.actionUrl`). Chỉ dùng tham số các trang ĐANG đọc:
 * ECN `?flyout=ecn&flyoutId=` · Recipes `?code=&tab=approval` · Interlock `?filter=pending&rule=` ·
 * Orchestration `?filter=pending&tab=approvals` · Changeover: trang không có tham số chọn yêu cầu ⇒ trang.
 */
export function assignmentDeepLink(type: AssignableEntityType, target: { id: number; code?: string | null }): string {
  switch (type) {
    case "ecn":
      return `/engineering-changes?flyout=ecn&flyoutId=${target.id}`;
    case "recipe":
      return target.code ? `/recipes?code=${encodeURIComponent(target.code)}&tab=approval` : "/recipes?filter=pending";
    case "interlock_rule":
      return `/interlock-rules?filter=pending&rule=${target.id}`;
    case "changeover":
      return "/product-changeover";
    case "orchestration_run":
      return "/orchestration-studio?filter=pending&tab=approvals";
  }
}
