/**
 * Sprint G2.6a — DEFAULT_ROLE_PERMISSIONS mapping for the energy module.
 *
 *   - admin              : full (view/create/edit/delete/export)
 *   - supervisor (mgr)   : view/create/edit/export (no delete)
 *   - quality_inspector  : view/export only (no create/edit)
 *   - operator           : view + create (manual telemetry entry; no edit/delete)
 *   - maintenance/viewer : NO energy entry (denied by RBAC gate)
 *
 * Verified through getDefaultPermissionsForRole (static map, no DB).
 */
import { describe, it, expect } from "vitest";
import { permissionsRouter } from "./permissionsRouter";

const adminCtx = { user: { id: 1, role: "admin", name: "Admin" } } as any;
const caller = permissionsRouter.createCaller(adminCtx);

async function energy(role: string) {
  const perms = await caller.getDefaultPermissionsForRole({ role: role as any });
  return perms.find((p: any) => p.moduleName === "energy");
}

describe("energy role permissions", () => {
  it("admin → full energy", async () => {
    expect(await energy("admin")).toMatchObject({ category: "energy", canView: true, canCreate: true, canEdit: true, canDelete: true });
  });

  it("supervisor (manager) → view/create/edit/export, no delete", async () => {
    expect(await energy("supervisor")).toMatchObject({ canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true });
  });

  it("quality_inspector → view/export only", async () => {
    expect(await energy("quality_inspector")).toMatchObject({ canView: true, canCreate: false, canEdit: false, canDelete: false });
  });

  it("operator → view + create (manual telemetry), no edit/delete", async () => {
    expect(await energy("operator")).toMatchObject({ canView: true, canCreate: true, canEdit: false, canDelete: false });
  });

  it("maintenance / viewer have NO energy entry (denied)", async () => {
    expect(await energy("maintenance")).toBeUndefined();
    expect(await energy("viewer")).toBeUndefined();
  });

  it("getAvailableModules includes energy with i18n labels", async () => {
    const modules = await caller.getAvailableModules();
    const m = modules.find((x: any) => x.moduleName === "energy");
    expect(m).toBeDefined();
    expect(m).toMatchObject({ category: "energy", displayNameEn: expect.any(String), displayNameZh: expect.any(String) });
  });
});
