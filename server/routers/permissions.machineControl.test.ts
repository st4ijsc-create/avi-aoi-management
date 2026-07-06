/**
 * Sprint F4a — DEFAULT_ROLE_PERMISSIONS mapping for the machine_control module.
 *
 * Convention (Phương án A): execute→canCreate, param/ack→canEdit, preview→canView.
 *   - admin       : full
 *   - supervisor  : view+create+edit (no delete)
 *   - maintenance : view+edit (canCreate:false → cannot execute start/stop/recipe)
 *   - operator / quality_inspector / viewer : NO machine_control entry (denied)
 *
 * Verified through the router's getDefaultPermissionsForRole query (static map,
 * no DB), invoked via an admin caller.
 */
import { describe, it, expect } from "vitest";
import { permissionsRouter } from "./permissionsRouter";

// Doc 38 Đợt Q — permissionsRouter now uses the CANONICAL adminProcedure (admin + 2FA),
// replacing the old local no-2FA shim. The admin fixture must therefore have 2FA on.
const adminCtx = { user: { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true } } as any;
const caller = permissionsRouter.createCaller(adminCtx);

async function mc(role: string) {
  const perms = await caller.getDefaultPermissionsForRole({ role: role as any });
  return perms.find((p: any) => p.moduleName === "machine_control");
}

describe("machine_control role permissions", () => {
  it("admin → full machine_control", async () => {
    expect(await mc("admin")).toMatchObject({ category: "machine_control", canView: true, canCreate: true, canEdit: true });
  });

  it("supervisor → view+create+edit, no delete", async () => {
    expect(await mc("supervisor")).toMatchObject({ canView: true, canCreate: true, canEdit: true, canDelete: false });
  });

  it("maintenance → view+edit but NOT create (cannot execute high-risk commands)", async () => {
    const m = await mc("maintenance");
    expect(m).toMatchObject({ canView: true, canEdit: true, canCreate: false });
  });

  it("operator / quality_inspector / viewer have NO machine_control entry (denied)", async () => {
    expect(await mc("operator")).toBeUndefined();
    expect(await mc("quality_inspector")).toBeUndefined();
    expect(await mc("viewer")).toBeUndefined();
  });
});
