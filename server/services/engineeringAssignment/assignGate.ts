/**
 * doc 81 Đợt 3 Task 4 fix 1 (Ruling R-3-e) — CỔNG GIAO VIỆC theo loại mục = ĐÚNG cổng của đường sửa/duyệt thật:
 *   giấy phép (moduleGate) + SÀN VAI (+2FA) + bit quyền.
 *
 * Không chép luật: sàn vai và 2FA chạy CHÍNH `assertRoleFloor` / `assertTwoFactorForPrivileged` của `_core/trpc.ts` (thân kiểm
 * của `roleProcedure` / `require2FA`), trên CHÍNH hằng `ACTUATION_ROLES` (`actuationProcedure`) và `ECN_DECISION_ROLES`
 * (`ecnRouter#ecnDecisionProcedure`). Bit quyền = `checkPermission` (thân của `requirePermission`). Giấy phép = `moduleGate`
 * nguyên bản. Bảng `ASSIGN_ROLE_FLOORS` ở `shared/` chỉ cho client — `assignGate.test.ts` canh nó KHÔNG lệch hằng server.
 *
 * Mọi sàn ở đây đều loại `viewer`/`user` ⇒ bao trùm `writeProcedure` (sàn ghi tối thiểu).
 */
import { appError } from "../../_core/appError";
import { checkPermission } from "../../_core/accessControl";
import { moduleGate } from "../../_core/moduleGate";
import { ACTUATION_ROLES, assertRoleFloor, assertTwoFactorForPrivileged, type UserRole } from "../../_core/trpc";
import { ECN_DECISION_ROLES } from "../../routers/ecnRouter";
import { ASSIGNABLE, type AssignableEntityType, type AssignRoleFloor } from "@shared/engineeringAssignment";

type GateCtx = { user: { id: number; role: string; twoFactorEnabled?: boolean | null } };

/** Sàn vai THẬT phía server cho từng loại sàn (hằng của chính các router/thủ tục đích). */
export const SERVER_ROLE_FLOORS: Readonly<Record<AssignRoleFloor, { roles: readonly UserRole[]; twoFactor: boolean }>> = {
  // actuationProcedure = roleProcedure(...ACTUATION_ROLES).use(require2FA)
  actuation: { roles: ACTUATION_ROLES, twoFactor: true },
  // ecnDecisionProcedure = roleProcedure(...ECN_DECISION_ROLES) — KHÔNG chain require2FA (đúng như mã hiện tại).
  ecnDecision: { roles: ECN_DECISION_ROLES as readonly UserRole[], twoFactor: false },
};

/** Giấy phép của router thực thể — chạy CHÍNH middleware `moduleGate` (cùng nhánh cho qua / cùng lời từ chối). */
export async function requireLicense(ctx: GateCtx, type: AssignableEntityType): Promise<void> {
  await moduleGate(ASSIGNABLE[type].licenseModule)({ ctx: ctx as never, next: async () => undefined });
}

/**
 * Cổng GIAO / BỎ GIAO / đọc roster của một loại: giấy phép → sàn vai → 2FA → bit quyền sửa/duyệt. Thứ tự như chuỗi
 * middleware của thủ tục đích (`actuationProcedure.use(moduleGate).use(requirePermission)`): sàn vai trước bit quyền.
 */
export async function requireAssignGate(ctx: GateCtx, type: AssignableEntityType): Promise<void> {
  const def = ASSIGNABLE[type];
  const floor = SERVER_ROLE_FLOORS[def.roleFloor];
  assertRoleFloor(ctx.user, floor.roles);
  if (floor.twoFactor) assertTwoFactorForPrivileged(ctx.user);
  await requireLicense(ctx, type);
  const { module, action } = def.assignPerm;
  if (!(await checkPermission(ctx.user.id, ctx.user.role, module, action))) {
    const msg = `Bạn không có quyền ${action.replace("can", "").toLowerCase()} cho module "${module}"`;
    // `action` LITERAL từng nhánh (cổng appErrorParamsCoverage đòi khoá từ điển nhìn thấy được trong mã).
    if (action === "canCreate") throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "canCreate" }, msg);
    if (action === "canEdit") throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "canEdit" }, msg);
    throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "canView" }, msg);
  }
}
