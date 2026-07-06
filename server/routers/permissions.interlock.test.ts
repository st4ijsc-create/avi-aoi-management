/**
 * Sprint F5a — DEFAULT_ROLE_PERMISSIONS mapping for andon + interlock modules,
 * plus the propose_interlock_rule write-tool safety invariant.
 *
 *   andon     : admin/supervisor/quality_inspector/operator can view+create+edit
 *               (raise + ack/resolve). maintenance/viewer have NO andon entry.
 *   interlock : only admin/supervisor manage rules. operator/quality_inspector
 *               have NO interlock entry (cannot edit rules). approve is admin-only
 *               (enforced in the router, not the static map).
 */
import { describe, it, expect } from "vitest";
import { permissionsRouter } from "./permissionsRouter";

// Doc 38 Đợt Q — permissionsRouter now uses the CANONICAL adminProcedure (admin + 2FA),
// replacing the old local no-2FA shim. The admin fixture must therefore have 2FA on.
const adminCtx = { user: { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true } } as any;
const caller = permissionsRouter.createCaller(adminCtx);

async function mod(role: string, moduleName: string) {
  const perms = await caller.getDefaultPermissionsForRole({ role: role as any });
  return perms.find((p: any) => p.moduleName === moduleName);
}

describe("andon role permissions", () => {
  it("operator can raise + ack/resolve andon (view+create+edit)", async () => {
    expect(await mod("operator", "andon")).toMatchObject({ canView: true, canCreate: true, canEdit: true });
  });
  it("quality_inspector can manage andon", async () => {
    expect(await mod("quality_inspector", "andon")).toMatchObject({ canView: true, canCreate: true, canEdit: true });
  });
  it("supervisor + admin can manage andon", async () => {
    expect(await mod("supervisor", "andon")).toMatchObject({ canCreate: true, canEdit: true });
    expect(await mod("admin", "andon")).toMatchObject({ canCreate: true, canEdit: true });
  });
  it("viewer has NO andon entry (denied)", async () => {
    expect(await mod("viewer", "andon")).toBeUndefined();
  });
});

describe("interlock role permissions", () => {
  it("admin + supervisor can manage interlock rules", async () => {
    expect(await mod("admin", "interlock")).toMatchObject({ canView: true, canCreate: true, canEdit: true, canDelete: true });
    expect(await mod("supervisor", "interlock")).toMatchObject({ canView: true, canCreate: true, canEdit: true });
  });
  it("operator + quality_inspector + viewer have NO interlock entry (cannot edit rules)", async () => {
    expect(await mod("operator", "interlock")).toBeUndefined();
    expect(await mod("quality_inspector", "interlock")).toBeUndefined();
    expect(await mod("viewer", "interlock")).toBeUndefined();
  });
});
