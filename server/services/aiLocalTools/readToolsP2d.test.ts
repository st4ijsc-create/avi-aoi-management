/**
 * Phase P2 (group D) — unit smoke tests for the 4 additional READ tools.
 *
 * Mirrors readToolsP2bc.test.ts: mock getDb + checkPermission + the schema
 * tables, then exercise each tool's RBAC gate, zod strictness, READ-ONLY
 * contract, the render-friendly `data.rows` shape, and (for trace_genealogy)
 * the clarify-on-missing-required behaviour — WITHOUT a real Postgres.
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
    predictiveAlerts: t(["id", "alertType", "severity", "title", "machineCode", "confidenceScore", "status", "createdAt"]),
    genealogyChain: t(["id", "serialNumber", "parentSerial", "eventType", "stationCode", "lotCode", "recordedAt"]),
    energyReadings: t(["id", "machineId", "timestamp", "source", "value", "unit", "powerKw"]),
    enpiMetrics: t(["id", "machineId", "periodStart", "periodEnd", "totalKwh", "goodUnits", "energyPerUnit", "carbonKg"]),
    machines: t(["id", "code"]),
    processes: t(["id", "code", "name", "processType", "orderIndex", "cycleTimeTarget", "isActive"]),
    lineProcessAssignments: t(["id", "lineId", "processId", "orderIndex", "cycleTimeTarget", "stationId", "isActive"]),
    productionLines: t(["id", "code"]),
    productModels: t(["id", "code"]),
    lineProductAssignments: t(["id", "lineId", "productModelId", "isActive", "startDate"]),
  };
});

import { listAnomalies, traceGenealogy, getEnergyMetrics, getRouting } from "./readToolsP2d";

const ALL = [listAnomalies, traceGenealogy, getEnergyMetrics, getRouting];
const AUTH = { userId: 7, role: "admin" } as const;

/** Chainable fake db: every terminal (await, .limit()) resolves to `rows`. */
function fakeDb(rows: any[] = []) {
  const make = (): any => {
    const thenable: any = Promise.resolve(rows);
    thenable.from = () => make();
    thenable.leftJoin = () => make();
    thenable.innerJoin = () => make();
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

/** Fake db whose successive .select() calls return successive row-sets. */
function fakeDbSeq(sequences: any[][]) {
  let call = 0;
  const mk = (rows: any[]): any => {
    const make = (): any => {
      const thenable: any = Promise.resolve(rows);
      thenable.from = () => make();
      thenable.leftJoin = () => make();
      thenable.innerJoin = () => make();
      thenable.where = () => make();
      thenable.orderBy = () => make();
      thenable.limit = () => Promise.resolve(rows);
      return thenable;
    };
    return make();
  };
  return {
    select: () => {
      const rows = sequences[Math.min(call, sequences.length - 1)] ?? [];
      call += 1;
      return mk(rows);
    },
    selectDistinctOn: () => mk([]),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockResolvedValue(fakeDb());
  checkPermissionMock.mockResolvedValue(true);
});

describe("P2d read tools — READ-ONLY + RBAC contract", () => {
  it("each is a read tool with canView requiredPermission and no write surface", () => {
    const expectedModule: Record<string, string> = {
      list_anomalies: "analytics_root_cause",
      trace_genealogy: "mes_bom",
      get_energy_metrics: "energy",
      get_routing: "settings_products",
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
    const r = await listAnomalies.handler!({ __authCtx: AUTH } as any);
    expect(r.note).toBe("PERMISSION_DENIED");
    expect(checkPermissionMock).toHaveBeenCalledWith(AUTH.userId, AUTH.role, "analytics_root_cause", "canView");
  });

  it("denial reaches a tool BEFORE any DB call (no getDb)", async () => {
    checkPermissionMock.mockResolvedValue(false);
    await getEnergyMetrics.handler!({ __authCtx: AUTH } as any);
    expect(getDbMock).not.toHaveBeenCalled();
  });
});

describe("zod strictness", () => {
  it("rejects unknown keys / bad shapes; accepts valid args", () => {
    expect(listAnomalies.parameters.safeParse({ bogus: 1 }).success).toBe(false);
    expect(listAnomalies.parameters.safeParse({ machineCode: "AOI-01", severity: "HIGH", __authCtx: AUTH }).success).toBe(true);
    expect(traceGenealogy.parameters.safeParse({ serialNumber: "SN1", __authCtx: AUTH }).success).toBe(true);
    expect(traceGenealogy.parameters.safeParse({ lotId: "LOT-1", __authCtx: AUTH }).success).toBe(true);
    expect(getEnergyMetrics.parameters.safeParse({ sinceDays: 9999 }).success).toBe(false);
    expect(getEnergyMetrics.parameters.safeParse({ machineCode: "M-1", sinceDays: 30 }).success).toBe(true);
    expect(getRouting.parameters.safeParse({ limit: 999 }).success).toBe(false);
    expect(getRouting.parameters.safeParse({ lineCode: "L1", __authCtx: AUTH }).success).toBe(true);
  });
});

describe("allow path returns documented shape + render-friendly rows", () => {
  it("list_anomalies maps predictive-alert anomaly rows", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        {
          id: 11,
          alertType: "PATTERN_ANOMALY",
          severity: "HIGH",
          title: "Spike bất thường ở AOI-01",
          machineCode: "AOI-01",
          confidenceScore: "92.5",
          status: "ACTIVE",
          createdAt: new Date("2026-06-29T00:00:00Z"),
        },
      ]),
    );
    const r = await listAnomalies.handler!({ __authCtx: AUTH } as any);
    expect(r.type).toBe("anomaly_list");
    expect(r.data.count).toBe(1);
    expect(r.data.items[0].type).toBe("PATTERN_ANOMALY");
    expect(r.data.items[0].score).toBe(92.5);
    expect(r.data.rows[0]).toMatchObject({ label: expect.any(String), value: expect.any(String) });
  });

  it("trace_genealogy returns chain rows for a serial", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        {
          id: 1,
          serialNumber: "SN100",
          parentSerial: "SN001",
          eventType: "merge",
          stationCode: "ST-A",
          lotCode: "LOT-9",
          recordedAt: new Date("2026-06-29T01:02:03Z"),
        },
      ]),
    );
    const r = await traceGenealogy.handler!({ __authCtx: AUTH, serialNumber: "SN100" } as any);
    expect(r.type).toBe("genealogy_trace");
    expect(r.data.count).toBe(1);
    expect(r.data.serialNumber).toBe("SN100");
    expect(r.data.items[0].parentSerial).toBe("SN001");
    expect(r.data.rows[0]).toMatchObject({ label: expect.any(String), value: expect.any(String) });
  });

  it("get_energy_metrics sums kWh readings + includes ENPI", async () => {
    // 1st select: machine resolution skipped (no machineCode) → readings; 2nd: enpi.
    getDbMock.mockResolvedValue(
      fakeDbSeq([
        [
          { id: 1, machineId: 5, timestamp: new Date(), source: "electricity", value: "12.5", unit: "kWh", powerKw: "3.2" },
          { id: 2, machineId: 5, timestamp: new Date(), source: "electricity", value: "7.5", unit: "kWh", powerKw: "2.0" },
        ],
        [
          { id: 9, machineId: 5, periodStart: new Date(), periodEnd: new Date(), totalKwh: "20", goodUnits: 100, energyPerUnit: "0.2", carbonKg: "4.1" },
        ],
      ]),
    );
    const r = await getEnergyMetrics.handler!({ __authCtx: AUTH } as any);
    expect(r.type).toBe("energy_metrics");
    expect(r.data.totalKwh).toBe(20);
    expect(r.data.enpi[0].energyPerUnit).toBe(0.2);
    expect(r.data.rows.length).toBeGreaterThan(0);
  });

  it("get_routing returns generic process catalog when no line given", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        { orderIndex: 1, processCode: "SMT", processName: "SMT mount", processType: "ASSEMBLY", cycleTimeTarget: "12.5" },
        { orderIndex: 2, processCode: "AOI", processName: "AOI inspect", processType: "INSPECTION", cycleTimeTarget: null },
      ]),
    );
    const r = await getRouting.handler!({ __authCtx: AUTH } as any);
    expect(r.type).toBe("routing_steps");
    expect(r.data.count).toBe(2);
    expect(r.data.items[0].processCode).toBe("SMT");
    expect(r.data.rows[0]).toMatchObject({ label: expect.any(String), value: expect.any(String) });
  });

  it("returns DB_UNAVAILABLE note when getDb is null", async () => {
    getDbMock.mockResolvedValue(null);
    const r = await getEnergyMetrics.handler!({ __authCtx: AUTH } as any);
    expect(r.note).toBe("DB_UNAVAILABLE");
  });
});

describe("trace_genealogy clarifies when neither serial nor lot given", () => {
  it("returns MISSING_REQUIRED_ARG without touching the DB", async () => {
    const r = await traceGenealogy.handler!({ __authCtx: AUTH } as any);
    expect(r.note).toBe("MISSING_REQUIRED_ARG");
    expect(r.data.count).toBe(0);
    // Clarify happens AFTER RBAC (allow) but BEFORE any query.
    expect(getDbMock).not.toHaveBeenCalled();
    expect(r.textSummary.toLowerCase()).toMatch(/serial|lô|lot/);
  });
});
