/**
 * W5-C (doc 27 A12) — role → default dashboard binding:
 *   • getMyEffectiveDashboard resolution PRECEDENCE: personal > role > none
 *     (a user who owns any custom dashboard NEVER receives the role default),
 *   • role binding resolves a template, or a PUBLIC custom dashboard,
 *     and degrades to 'none' when the target vanished / is private,
 *   • landingPath is returned regardless of source,
 *   • admin RBAC on listRoleDefaults/setRoleDefault/clearRoleDefault,
 *   • setRoleDefault validation: mutually-exclusive targets, existing +
 *     public targets only, landingPath must start with "/".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the whole db barrel (only the functions these endpoints call).
// vi.hoisted so the factory can reference the fns after vitest hoists vi.mock.
const mockDb = vi.hoisted(() => ({
  // trpc middleware audit trail (fire-and-forget) — inert here
  createAuditLog: vi.fn(async () => undefined),
  getRoleDashboardDefault: vi.fn(),
  listRoleDashboardDefaults: vi.fn(),
  upsertRoleDashboardDefault: vi.fn(),
  deleteRoleDashboardDefault: vi.fn(),
  getUserCustomDashboards: vi.fn(),
  getUserCustomDashboardById: vi.fn(),
  getDashboardTemplateById: vi.fn(),
}));
vi.mock("../db", () => mockDb);

import { dashboardWidgetRouter } from "./dashboardWidgetRouters";

const adminCtx = { user: { id: 1, role: "admin", name: "Admin" } } as any;
const operatorCtx = { user: { id: 7, role: "operator", name: "Op" } } as any;

const TEMPLATE = {
  id: 5, name: "Operator board", description: "desc",
  widgets: ["yield-chart"], layout: [{ i: "yield-chart", x: 0, y: 0, w: 4, h: 2 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.getRoleDashboardDefault.mockResolvedValue(null);
  mockDb.getUserCustomDashboards.mockResolvedValue([]);
  mockDb.getUserCustomDashboardById.mockResolvedValue(null);
  mockDb.getDashboardTemplateById.mockResolvedValue(null);
  mockDb.listRoleDashboardDefaults.mockResolvedValue([]);
  mockDb.upsertRoleDashboardDefault.mockImplementation(async (i: any) => ({ id: 1, ...i }));
  mockDb.deleteRoleDashboardDefault.mockResolvedValue(undefined);
});

describe("dashboardWidget.getMyEffectiveDashboard — resolution precedence", () => {
  const caller = dashboardWidgetRouter.createCaller(operatorCtx);

  it("PERSONAL wins even when a role default exists", async () => {
    mockDb.getUserCustomDashboards.mockResolvedValue([{ id: 99, name: "Mine" }]);
    mockDb.getRoleDashboardDefault.mockResolvedValue({
      role: "operator", dashboardTemplateId: TEMPLATE.id, customDashboardId: null, landingPath: "/andon",
    });
    const res = await caller.getMyEffectiveDashboard();
    expect(res.source).toBe("personal");
    expect(res.template).toBeNull();
    expect(res.customDashboardId).toBeNull();
    // landingPath still surfaces (it only affects the "/" redirect)
    expect(res.landingPath).toBe("/andon");
  });

  it("ROLE default (public custom dashboard) applies when the user owns none", async () => {
    mockDb.getRoleDashboardDefault.mockResolvedValue({
      role: "operator", dashboardTemplateId: null, customDashboardId: 42, landingPath: null,
    });
    mockDb.getUserCustomDashboardById.mockResolvedValue({ id: 42, isPublic: true, name: "Shared" });
    const res = await caller.getMyEffectiveDashboard();
    expect(res.source).toBe("role");
    expect(res.customDashboardId).toBe(42);
    expect(res.template).toBeNull();
  });

  it("ROLE default (template) applies when the user owns none", async () => {
    mockDb.getRoleDashboardDefault.mockResolvedValue({
      role: "operator", dashboardTemplateId: TEMPLATE.id, customDashboardId: null, landingPath: null,
    });
    mockDb.getDashboardTemplateById.mockResolvedValue(TEMPLATE);
    const res = await caller.getMyEffectiveDashboard();
    expect(res.source).toBe("role");
    expect(res.template).toMatchObject({ id: 5, name: "Operator board" });
    expect(res.customDashboardId).toBeNull();
  });

  it("degrades to the template when the bound dashboard went private", async () => {
    mockDb.getRoleDashboardDefault.mockResolvedValue({
      role: "operator", dashboardTemplateId: TEMPLATE.id, customDashboardId: 42, landingPath: null,
    });
    mockDb.getUserCustomDashboardById.mockResolvedValue({ id: 42, isPublic: false });
    mockDb.getDashboardTemplateById.mockResolvedValue(TEMPLATE);
    const res = await caller.getMyEffectiveDashboard();
    expect(res.source).toBe("role");
    expect(res.template).toMatchObject({ id: 5 });
  });

  it("NONE (global default) when no personal and no role binding", async () => {
    const res = await caller.getMyEffectiveDashboard();
    expect(res.source).toBe("none");
    expect(res.template).toBeNull();
    expect(res.customDashboardId).toBeNull();
    expect(res.landingPath).toBeNull();
  });

  it("NONE when the bound template row was deleted", async () => {
    mockDb.getRoleDashboardDefault.mockResolvedValue({
      role: "operator", dashboardTemplateId: 12345, customDashboardId: null, landingPath: null,
    });
    const res = await caller.getMyEffectiveDashboard();
    expect(res.source).toBe("none");
  });
});

describe("dashboardWidget role-default admin endpoints", () => {
  const admin = dashboardWidgetRouter.createCaller(adminCtx);
  const nonAdmin = dashboardWidgetRouter.createCaller(operatorCtx);

  it("non-admin is FORBIDDEN on list/set/clear", async () => {
    await expect(nonAdmin.listRoleDefaults()).rejects.toThrow(/FORBIDDEN|Admin/i);
    await expect(nonAdmin.setRoleDefault({ role: "operator", dashboardTemplateId: null, customDashboardId: null, landingPath: null }))
      .rejects.toThrow(/FORBIDDEN|Admin/i);
    await expect(nonAdmin.clearRoleDefault({ role: "operator" })).rejects.toThrow(/FORBIDDEN|Admin/i);
  });

  it("rejects setting BOTH a template and a custom dashboard", async () => {
    await expect(admin.setRoleDefault({
      role: "operator", dashboardTemplateId: 5, customDashboardId: 42, landingPath: null,
    })).rejects.toThrow(/not both/i);
  });

  it("rejects a missing template and a private dashboard", async () => {
    await expect(admin.setRoleDefault({
      role: "operator", dashboardTemplateId: 5, customDashboardId: null, landingPath: null,
    })).rejects.toThrow(/not found/i);

    mockDb.getUserCustomDashboardById.mockResolvedValue({ id: 42, isPublic: false });
    await expect(admin.setRoleDefault({
      role: "operator", dashboardTemplateId: null, customDashboardId: 42, landingPath: null,
    })).rejects.toThrow(/PUBLIC/i);
  });

  it("rejects a landingPath that does not start with '/'", async () => {
    await expect(admin.setRoleDefault({
      role: "operator", dashboardTemplateId: null, customDashboardId: null, landingPath: "andon",
    })).rejects.toThrow(/landingPath/i);
  });

  it("upserts with the admin's id and clears via delete", async () => {
    mockDb.getDashboardTemplateById.mockResolvedValue(TEMPLATE);
    await admin.setRoleDefault({
      role: "operator", dashboardTemplateId: 5, customDashboardId: null, landingPath: "/andon",
    });
    expect(mockDb.upsertRoleDashboardDefault).toHaveBeenCalledWith({
      role: "operator",
      dashboardTemplateId: 5,
      customDashboardId: null,
      landingPath: "/andon",
      updatedBy: 1,
    });

    await admin.clearRoleDefault({ role: "operator" });
    expect(mockDb.deleteRoleDashboardDefault).toHaveBeenCalledWith("operator");
  });
});
