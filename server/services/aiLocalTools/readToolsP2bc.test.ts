/**
 * Phase P2 (groups B & C) — unit smoke tests for the 6 additional READ tools.
 *
 * Mirrors readToolsP2.test.ts: mock getDb + checkPermission + the schema
 * tables, then exercise each tool's RBAC gate, zod strictness, READ-ONLY
 * contract, the render-friendly `data.rows` shape, and (for the SENSITIVE
 * tools) the no-secret-leak guarantee — WITHOUT a real Postgres.
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
    productModels: t(["id", "code", "name", "category", "isActive", "deletedAt"]),
    bomDefinitions: t(["id", "productModelId", "code", "version", "status", "isActive", "deletedAt"]),
    bomLineItems: t(["id", "bomId", "componentCode", "componentName", "qtyPer", "unit", "refDesignator"]),
    rootCauseAnalysis: t(["id", "analysisType", "machineCode", "aiInsights", "topFactors", "createdAt"]),
    users: t(["id", "name", "role", "isActive", "lastSignedIn"]),
    userFactoryAssignments: t(["userId", "factoryCode"]),
    apiKeys: t(["id", "name", "keyPrefix", "scopes", "isActive", "createdAt", "lastUsedAt", "expiresAt"]),
    auditLogs: t(["id", "userId", "userName", "action", "entityType", "entityId", "entityName", "details", "createdAt"]),
    machineHealthHistory: t(["machineId", "machineCode", "healthScore", "predictedFailureRisk", "maintenanceUrgency", "recommendedMaintenanceDate", "timestamp"]),
    predictiveAlerts: t(["id", "machineId", "machineCode", "title", "severity", "status", "createdAt"]),
  };
});

import {
  listProducts,
  getRcaHistory,
  listUsersByRole,
  listApiKeys,
  getChangeHistory,
  getMachineHealth,
} from "./readToolsP2bc";

const ALL = [listProducts, getRcaHistory, listUsersByRole, listApiKeys, getChangeHistory, getMachineHealth];
const AUTH = { userId: 7, role: "admin" } as const;

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
  return {
    select: () => make(),
    selectDistinctOn: () => make(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockResolvedValue(fakeDb());
  checkPermissionMock.mockResolvedValue(true);
});

describe("P2bc read tools — READ-ONLY + RBAC contract", () => {
  it("each is a read tool with canView requiredPermission and no write surface", () => {
    const expectedModule: Record<string, string> = {
      list_products: "settings_products",
      get_rca_history: "analytics_root_cause",
      list_users_by_role: "admin_users",
      list_api_keys: "admin_system",
      get_change_history: "admin_system",
      get_machine_health: "machine_monitoring",
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
      // No data leaked on denial.
      expect((r.data as any).count ?? 0).toBe(0);
    }
    expect(checkPermissionMock).not.toHaveBeenCalled();
  });

  it("denies with no data when checkPermission returns false", async () => {
    checkPermissionMock.mockResolvedValue(false);
    const r = await listUsersByRole.handler!({ __authCtx: AUTH } as any);
    expect(r.note).toBe("PERMISSION_DENIED");
    expect(checkPermissionMock).toHaveBeenCalledWith(AUTH.userId, AUTH.role, "admin_users", "canView");
  });

  it("denial reaches a sensitive tool BEFORE any DB call (no getDb)", async () => {
    checkPermissionMock.mockResolvedValue(false);
    await listApiKeys.handler!({ __authCtx: AUTH } as any);
    expect(getDbMock).not.toHaveBeenCalled();
  });
});

describe("zod strictness", () => {
  it("rejects unknown keys / bad shapes; accepts valid args", () => {
    expect(listProducts.parameters.safeParse({ bogus: 1 }).success).toBe(false);
    expect(listProducts.parameters.safeParse({ productCode: "P-1", __authCtx: AUTH }).success).toBe(true);
    expect(getRcaHistory.parameters.safeParse({ machineCode: "AOI-01", __authCtx: AUTH }).success).toBe(true);
    expect(listUsersByRole.parameters.safeParse({ role: "admin", __authCtx: AUTH }).success).toBe(true);
    expect(listApiKeys.parameters.safeParse({ active: "yes" }).success).toBe(false);
    expect(getChangeHistory.parameters.safeParse({ sinceDays: 9999 }).success).toBe(false);
    expect(getChangeHistory.parameters.safeParse({ entityType: "user", sinceDays: 7 }).success).toBe(true);
    expect(getMachineHealth.parameters.safeParse({ limit: 999 }).success).toBe(false);
  });
});

describe("allow path returns documented shape + render-friendly rows", () => {
  it("list_products maps models and includes BOM when productCode given", async () => {
    // 1st query: models; 2nd: bom def; 3rd: bom line items.
    getDbMock.mockResolvedValue({
      select: (() => {
        let call = 0;
        return () => {
          call += 1;
          const rows =
            call === 1
              ? [{ id: 3, code: "P-1", name: "Board A", category: "PCB", isActive: true }]
              : call === 2
                ? [{ id: 9, code: "BOM-1" }]
                : [{ componentCode: "R100", componentName: "Resistor", qtyPer: "4", unit: "pcs", refDesignator: "R1,R2" }];
          const make = (): any => {
            const thenable: any = Promise.resolve(rows);
            thenable.from = () => make();
            thenable.where = () => make();
            thenable.orderBy = () => make();
            thenable.limit = () => Promise.resolve(rows);
            return thenable;
          };
          return make();
        };
      })(),
    });
    const r = await listProducts.handler!({ __authCtx: AUTH, productCode: "P-1" } as any);
    expect(r.type).toBe("product_list");
    expect(r.data.count).toBe(1);
    expect(r.data.items[0].code).toBe("P-1");
    expect(r.data.bomComponents[0].componentCode).toBe("R100");
    expect(r.data.rows[0]).toMatchObject({ label: expect.any(String), value: expect.any(String) });
  });

  it("get_rca_history derives root cause + action from aiInsights", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        {
          id: 1,
          analysisType: "DEFECT_SPIKE",
          machineCode: "AOI-01",
          aiInsights: {
            summary: "NG tăng đột biến",
            rootCauses: [{ cause: "Nozzle mòn", probability: 0.8 }],
            recommendations: [{ action: "Thay nozzle", priority: "high" }],
          },
          topFactors: [{ factor: "temperature" }],
          createdAt: new Date("2026-06-29T00:00:00Z"),
        },
      ]),
    );
    const r = await getRcaHistory.handler!({ __authCtx: AUTH } as any);
    expect(r.type).toBe("rca_history");
    expect(r.data.items[0].rootCause).toBe("Nozzle mòn");
    expect(r.data.items[0].action).toBe("Thay nozzle");
    expect(r.textSummary).toContain("Nozzle");
  });

  it("get_machine_health sorts worst health first + overlays alert count", async () => {
    getDbMock.mockResolvedValue({
      select: () => {
        // predictive_alerts query (returns active alerts)
        const rows = [
          { machineId: 5, machineCode: "SCR-02", title: "Bearing wear", severity: "HIGH", createdAt: new Date() },
        ];
        const make = (): any => {
          const thenable: any = Promise.resolve(rows);
          thenable.from = () => make();
          thenable.where = () => make();
          thenable.orderBy = () => make();
          thenable.limit = () => Promise.resolve(rows);
          return thenable;
        };
        return make();
      },
      selectDistinctOn: () => {
        const rows = [
          { machineId: 3, machineCode: "AOI-01", healthScore: 90, predictedFailureRisk: 10, maintenanceUrgency: "LOW", recommendedMaintenanceDate: null, timestamp: new Date() },
          { machineId: 5, machineCode: "SCR-02", healthScore: 40, predictedFailureRisk: 70, maintenanceUrgency: "HIGH", recommendedMaintenanceDate: null, timestamp: new Date() },
        ];
        const make = (): any => {
          const thenable: any = Promise.resolve(rows);
          thenable.from = () => make();
          thenable.where = () => make();
          thenable.orderBy = () => make();
          thenable.limit = () => Promise.resolve(rows);
          return thenable;
        };
        return make();
      },
    });
    const r = await getMachineHealth.handler!({ __authCtx: AUTH } as any);
    expect(r.type).toBe("machine_health");
    expect(r.data.items[0].machineCode).toBe("SCR-02"); // worst (40) first
    expect(r.data.items[0].activeAlertCount).toBe(1);
    expect(r.data.items[0].topAlert).toContain("Bearing wear");
  });

  it("returns DB_UNAVAILABLE note when getDb is null", async () => {
    getDbMock.mockResolvedValue(null);
    const r = await getChangeHistory.handler!({ __authCtx: AUTH } as any);
    expect(r.note).toBe("DB_UNAVAILABLE");
  });
});

describe("SENSITIVE tools never leak secrets", () => {
  it("list_users_by_role result carries NO password/secret/email fields", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([{ id: 1, name: "Alice", role: "admin", isActive: true, lastSignedIn: new Date("2026-06-29T00:00:00Z") }]),
    );
    const r = await listUsersByRole.handler!({ __authCtx: AUTH, role: "admin" } as any);
    const blob = JSON.stringify(r).toLowerCase();
    for (const secret of ["passwordhash", "password", "twofactorsecret", "two_factor", "openid", "@", "token"]) {
      expect(blob).not.toContain(secret);
    }
    // Documented meta fields present.
    expect(r.data.items[0]).toMatchObject({ id: 1, role: "admin", isActive: true });
    expect(Object.keys(r.data.items[0]).sort()).toEqual(["id", "isActive", "lastLogin", "name", "role"]);
  });

  it("list_api_keys result carries NO full key or hash", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        {
          id: 1,
          name: "edge-client",
          keyPrefix: "ak_3f9c",
          scopes: ["equipment:read"],
          isActive: true,
          createdAt: new Date("2026-06-01T00:00:00Z"),
          lastUsedAt: null,
          expiresAt: null,
        },
      ]),
    );
    const r = await listApiKeys.handler!({ __authCtx: AUTH } as any);
    const blob = JSON.stringify(r).toLowerCase();
    for (const secret of ["keyhash", "hash", "secret"]) {
      expect(blob).not.toContain(secret);
    }
    expect(r.data.items[0]).toMatchObject({ name: "edge-client", keyPrefix: "ak_3f9c", revoked: false });
    expect(Object.keys(r.data.items[0]).sort()).toEqual(
      ["createdAt", "expiresAt", "id", "keyPrefix", "lastUsedAt", "name", "revoked", "scopes"],
    );
  });
});
