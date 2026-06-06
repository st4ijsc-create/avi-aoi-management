/**
 * Sprint G2.4 — DEFAULT_ROLE_PERMISSIONS mapping for the mes_bom module.
 *
 *   - admin              : full (view/create/edit/delete)
 *   - supervisor (mgr)   : view/create/edit (no delete on definitions)
 *   - quality_inspector  : view/create/edit (no delete)
 *   - operator / maintenance / viewer : NO mes_bom entry (denied by RBAC gate)
 *
 * Verified through getDefaultPermissionsForRole (static map, no DB).
 */
import { describe, it, expect } from "vitest";
import { permissionsRouter } from "./permissionsRouter";

const adminCtx = { user: { id: 1, role: "admin", name: "Admin" } } as any;
const caller = permissionsRouter.createCaller(adminCtx);

async function bom(role: string) {
  const perms = await caller.getDefaultPermissionsForRole({ role: role as any });
  return perms.find((p: any) => p.moduleName === "mes_bom");
}

describe("mes_bom role permissions", () => {
  it("admin → full mes_bom", async () => {
    expect(await bom("admin")).toMatchObject({ category: "mes_bom", canView: true, canCreate: true, canEdit: true, canDelete: true });
  });

  it("supervisor (manager) → view/create/edit, no delete", async () => {
    expect(await bom("supervisor")).toMatchObject({ canView: true, canCreate: true, canEdit: true, canDelete: false });
  });

  it("quality_inspector → view/create/edit, no delete", async () => {
    expect(await bom("quality_inspector")).toMatchObject({ canView: true, canCreate: true, canEdit: true, canDelete: false });
  });

  it("operator / maintenance / viewer have NO mes_bom entry (denied)", async () => {
    expect(await bom("operator")).toBeUndefined();
    expect(await bom("maintenance")).toBeUndefined();
    expect(await bom("viewer")).toBeUndefined();
  });

  it("getAvailableModules includes mes_bom with i18n labels", async () => {
    const modules = await caller.getAvailableModules();
    const m = modules.find((x: any) => x.moduleName === "mes_bom");
    expect(m).toBeDefined();
    expect(m).toMatchObject({ category: "mes_bom", displayNameEn: expect.any(String), displayNameZh: expect.any(String) });
  });
});
