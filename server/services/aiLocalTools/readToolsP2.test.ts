/**
 * Phase P2 (group A) — unit smoke tests for the 4 high-priority READ tools.
 *
 * Mirrors analyticsTools.test.ts: mock getDb + checkPermission + the schema
 * tables, then exercise each tool's RBAC gate, zod strictness, READ-ONLY
 * contract, and the render-friendly `data.rows` shape WITHOUT a real Postgres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getDbMock = vi.fn();
vi.mock("../../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

// Schema tables → opaque sentinels (Drizzle calls go through the fake db below).
vi.mock("../../../drizzle/schema", () => {
  const col = (c: string) => ({ __c: c });
  const t = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, col(c)]));
  return {
    maintenanceWorkOrders: t([
      "id", "workOrderNumber", "title", "machineId", "machineCode", "priority",
      "status", "type", "assignedTo", "createdAt", "openedAt",
    ]),
    machines: t(["id", "code"]),
    alertHistory: t(["id", "message", "acknowledgedAt", "createdAt", "alertSettingId"]),
    alertSettings: t(["id", "alertType", "machineId"]),
    predictiveAlerts: t(["id", "alertType", "severity", "title", "machineCode", "acknowledgedAt", "createdAt", "status"]),
    measurementPointDefs: t(["id", "productModelId", "code", "name", "upperLimit", "lowerLimit", "nominalValue", "unit", "isActive", "deletedAt", "orderIndex"]),
    productModels: t(["id", "code"]),
    yieldAlertThresholds: t(["id", "metricType", "warningThreshold", "criticalThreshold", "targetValue", "isEnabled"]),
    machineRecipes: t(["id", "code", "name", "machineId", "machineType", "version", "status", "updatedAt"]),
  };
});

import { listWorkOrders, listActiveAlerts, listThresholds, listRecipes } from "./readToolsP2";

const ALL = [listWorkOrders, listActiveAlerts, listThresholds, listRecipes];
const AUTH = { userId: 7, role: "supervisor" } as const;

/** Chainable fake db: every terminal (await, .limit()) resolves to `rows`. */
function fakeDb(rows: any[] = []) {
  const make = (): any => {
    const thenable: any = Promise.resolve(rows);
    thenable.from = () => make();
    thenable.leftJoin = () => make();
    thenable.where = () => make();
    thenable.orderBy = () => make();
    thenable.limit = () => Promise.resolve(rows);
    return thenable;
  };
  return { select: () => make() };
}

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockResolvedValue(fakeDb());
  checkPermissionMock.mockResolvedValue(true);
});

describe("P2 read tools — READ-ONLY + RBAC contract", () => {
  it("each is a read tool with canView requiredPermission and no write surface", () => {
    const expectedModule: Record<string, string> = {
      list_work_orders: "machine_downtime",
      list_active_alerts: "mqtt_alerts",
      list_thresholds: "settings_measurement_points",
      list_recipes: "machine_control",
    };
    for (const t of ALL) {
      expect(t.kind).toBe("read");
      expect(t.preview).toBeUndefined();
      expect(t.execute).toBeUndefined();
      expect(typeof t.handler).toBe("function");
      expect(t.requiredPermission!.action).toBe("canView");
      expect(t.requiredPermission!.module).toBe(expectedModule[t.name]);
    }
  });
});

describe("RBAC gating (fail-safe)", () => {
  it("denies with no data when __authCtx is missing — checkPermission not called", async () => {
    for (const t of ALL) {
      const r = await t.handler!({} as any);
      expect(r.note).toBe("PERMISSION_DENIED");
    }
    expect(checkPermissionMock).not.toHaveBeenCalled();
  });

  it("denies with no data when checkPermission returns false", async () => {
    checkPermissionMock.mockResolvedValue(false);
    const r = await listWorkOrders.handler!({ __authCtx: AUTH } as any);
    expect(r.note).toBe("PERMISSION_DENIED");
    expect(checkPermissionMock).toHaveBeenCalledWith(AUTH.userId, AUTH.role, "machine_downtime", "canView");
  });
});

describe("zod strictness", () => {
  it("rejects unknown keys / bad enums; accepts valid args", () => {
    expect(listWorkOrders.parameters.safeParse({ status: "WRONG" }).success).toBe(false);
    expect(listWorkOrders.parameters.safeParse({ status: "open", __authCtx: AUTH }).success).toBe(true);
    expect(listActiveAlerts.parameters.safeParse({ bogus: 1 }).success).toBe(false);
    expect(listRecipes.parameters.safeParse({ machineCode: "M-1", __authCtx: AUTH }).success).toBe(true);
    expect(listThresholds.parameters.safeParse({ limit: 999 }).success).toBe(false);
  });
});

describe("allow path returns documented shape + render-friendly rows", () => {
  it("list_work_orders maps rows and builds {label,value} render rows", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        { id: 1, workOrderNumber: "WO-1", title: "Thay nozzle", machineId: 3, machineCode: "AOI-01", priority: 1, status: "OPEN", type: "CORRECTIVE", assignedTo: null, createdAt: new Date("2026-06-29T00:00:00Z") },
      ]),
    );
    const r = await listWorkOrders.handler!({ __authCtx: AUTH, limit: 10 } as any);
    expect(r.type).toBe("work_order_list");
    expect(r.data.count).toBe(1);
    expect(r.data.items[0].workOrderNumber).toBe("WO-1");
    expect(r.data.rows[0]).toMatchObject({ label: expect.any(String), value: expect.any(String) });
    expect(r.textSummary).toContain("WO-1");
  });

  it("list_recipes flags the active recipe", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        { id: 1, code: "R1", name: "Recipe 1", machineId: 3, machineType: "AOI", version: 2, status: "active", updatedAt: new Date("2026-06-29T00:00:00Z") },
        { id: 2, code: "R1", name: "Recipe 1", machineId: 3, machineType: "AOI", version: 1, status: "archived", updatedAt: new Date("2026-06-28T00:00:00Z") },
      ]),
    );
    const r = await listRecipes.handler!({ __authCtx: AUTH } as any);
    expect(r.type).toBe("recipe_list");
    expect(r.data.activeRecipe?.code).toBe("R1");
    expect(r.data.activeRecipe?.version).toBe(2);
  });

  it("returns DB_UNAVAILABLE note when getDb is null", async () => {
    getDbMock.mockResolvedValue(null);
    const r = await listThresholds.handler!({ __authCtx: AUTH } as any);
    expect(r.note).toBe("DB_UNAVAILABLE");
  });
});
