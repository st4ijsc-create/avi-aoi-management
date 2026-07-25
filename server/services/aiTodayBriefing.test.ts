/**
 * AI "Today" Briefing tests.
 *
 * Proves:
 *  - Role routing: each app role maps to the right briefing variant + payload shape
 *    (maintenance / operator / manager / quality / viewer).
 *  - Fail-safe: when a source throws, that section degrades (empty / omitted) and
 *    a soft warning is recorded — buildTodayBriefing NEVER throws.
 *  - Scope: a non-admin only composes over machines in their factory assignment;
 *    an empty assignment ⇒ no scoped machines ⇒ empty PdM/yield sections.
 *
 * All reuse services + DB are mocked (no real DB). The service imports its sources
 * dynamically, so we mock the module specifiers it `await import(...)`s.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Factory assignments per user (drives scope). ──
const getUserFactoryAssignments = vi.fn(async (_userId: number) => [] as Array<{ factoryCode: string }>);
vi.mock("../db/auth", () => ({
  getUserFactoryAssignments: (...a: any[]) => getUserFactoryAssignments(a[0]),
}));

// ── Machines with hierarchy (scope source). ──
const getMachinesWithHierarchy = vi.fn(async () => [] as any[]);
vi.mock("../db/hierarchy", () => ({
  getMachinesWithHierarchy: (...a: any[]) => getMachinesWithHierarchy(...a),
}));

// ── PdM risk. ──
const computeFailureRisk = vi.fn(async (_id: number) => ({
  failureRisk: 0,
  maintenanceUrgency: "LOW" as const,
  predictedTimeframe: null as string | null,
}));
vi.mock("./predictiveMaintenanceService", () => ({
  computeFailureRisk: (...a: any[]) => computeFailureRisk(a[0]),
}));

// ── Anomaly: real per-machine reader (server/routers/aiAnomalyRouter.readMachineStatuses).
// Default: no data for any requested machine (mirrors the real "no scored rows yet" case).
function defaultAnomalyStatuses(ids: number[]) {
  const out: Record<number, any> = {};
  for (const id of ids) {
    out[id] = {
      hasData: false,
      latestScore: null,
      latestThreshold: null,
      isAnomaly: false,
      latestAt: null,
      recent: { windowCount: 0, anomalyCount: 0, anomalyRate: 0 },
    };
  }
  return out;
}
const readMachineStatuses = vi.fn(async (ids: number[], _productModelId: number | null) =>
  defaultAnomalyStatuses(ids),
);
vi.mock("../routers/aiAnomalyRouter", () => ({
  readMachineStatuses: (...a: any[]) => readMachineStatuses(a[0], a[1]),
}));

// ── Yield trend. ──
const getYieldTrendData = vi.fn(async (_f: any) => [] as any[]);
vi.mock("../db/statistics", () => ({
  getYieldTrendData: (...a: any[]) => getYieldTrendData(a[0]),
}));

// ── Pareto top defect. ──
const paretoByDefectType = vi.fn(async (_f: any) => ({ items: [] as any[] }));
vi.mock("./paretoAnalysisService", () => ({
  paretoByDefectType: (...a: any[]) => paretoByDefectType(a[0]),
}));

// ── Open proposals count. ──
const countInbox = vi.fn(async (_u: any) => ({ count: 0 }));
vi.mock("./aiActionInbox", () => ({
  countInbox: (...a: any[]) => countInbox(a[0]),
}));

// ── OEE avg path: getDb + oeeMetrics + drizzle-orm (manager only). ──
const getDb = vi.fn(async () => null as any);
vi.mock("../db/connection", () => ({ getDb: (...a: any[]) => getDb(...a) }));
vi.mock("../../drizzle/schema", () => ({
  oeeMetrics: { timestamp: {}, machineCode: {}, oee: {} },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => a,
  gte: () => ({}),
  lte: () => ({}),
  inArray: () => ({}),
}));

import { buildTodayBriefing, briefingRoleOf } from "./aiTodayBriefing";

const ADMIN_MACHINES = [
  { machine: { id: 1, code: "M1", name: "Machine 1" }, factory: { code: "F1" } },
  { machine: { id: 2, code: "M2", name: "Machine 2" }, factory: { code: "F2" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  getUserFactoryAssignments.mockResolvedValue([]);
  getMachinesWithHierarchy.mockResolvedValue(ADMIN_MACHINES as any);
  computeFailureRisk.mockResolvedValue({ failureRisk: 0, maintenanceUrgency: "LOW", predictedTimeframe: null });
  readMachineStatuses.mockImplementation(async (ids: number[]) => defaultAnomalyStatuses(ids));
  getYieldTrendData.mockResolvedValue([]);
  paretoByDefectType.mockResolvedValue({ items: [] });
  countInbox.mockResolvedValue({ count: 0 });
  getDb.mockResolvedValue(null);
});

describe("briefingRoleOf — role collapse", () => {
  it("maps the 7 app roles to 4 briefing variants", () => {
    expect(briefingRoleOf("maintenance")).toBe("maintenance");
    expect(briefingRoleOf("operator")).toBe("operator");
    expect(briefingRoleOf("supervisor")).toBe("manager");
    expect(briefingRoleOf("admin")).toBe("manager");
    expect(briefingRoleOf("quality_inspector")).toBe("quality");
    expect(briefingRoleOf("viewer")).toBe("viewer");
    expect(briefingRoleOf("user")).toBe("viewer");
  });
});

describe("buildTodayBriefing — anomaly section reads the REAL per-machine reader (doc69 W0-5 item 1)", () => {
  // Regression fixture: this is exactly the shape the OLD source (getAnomalyStats →
  // getBankStats passthrough) actually returned — {totalVectors, distinctModelCodes,
  // profiles}. It has NEITHER `latestIsAnomaly`/`latestScore`/`maxScore` NOR
  // `isAnomaly`/`score`, so under the old tolerant read
  // (`!!(s?.latestIsAnomaly ?? s?.isAnomaly)`) this would ALWAYS resolve to `isAnomaly:
  // false` — the anomaly section could never surface a row, no matter what the DB held.
  // We don't need to replay that dead code path here (it's deleted); this block instead
  // proves the NEW source (readMachineStatuses) does surface a row when the DB says so.
  it("surfaces a machine flagged isAnomaly:true by the real reader (was structurally impossible before the fix)", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }, { factoryCode: "F2" }]);
    readMachineStatuses.mockImplementation(async (ids: number[]) => {
      const out = defaultAnomalyStatuses(ids);
      if (out[1]) {
        out[1] = {
          hasData: true,
          latestScore: 0.92,
          latestThreshold: 0.5,
          isAnomaly: true,
          latestAt: new Date("2026-07-25T00:00:00Z"),
          recent: { windowCount: 10, anomalyCount: 3, anomalyRate: 0.3 },
        };
      }
      return out;
    });

    const b = await buildTodayBriefing({ id: 20, role: "maintenance" }, "vi");
    const p = b.payload as any;
    expect(p.machinesNeedingAttention.length).toBe(1);
    expect(p.machinesNeedingAttention[0].machineCode).toBe("M1");
    expect(p.machinesNeedingAttention[0].anomaly).toBe(0.92);
    expect(b.severity).toBe("critical"); // score 0.92 ≥ 0.85 → critical
  });

  it("does NOT surface a row when the reader says isAnomaly:false, even with a positive score (no false positive)", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }, { factoryCode: "F2" }]);
    readMachineStatuses.mockImplementation(async (ids: number[]) => {
      const out = defaultAnomalyStatuses(ids);
      if (out[1]) out[1] = { ...out[1], hasData: true, latestScore: 0.1, isAnomaly: false };
      return out;
    });

    const b = await buildTodayBriefing({ id: 21, role: "maintenance" }, "vi");
    const p = b.payload as any;
    expect(p.machinesNeedingAttention).toEqual([]);
  });

  it("degrades to empty + warning (never throws) when the reader rejects", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }, { factoryCode: "F2" }]);
    readMachineStatuses.mockRejectedValue(new Error("anomaly reader boom"));

    const b = await buildTodayBriefing({ id: 22, role: "maintenance" }, "vi");
    const p = b.payload as any;
    expect(p.machinesNeedingAttention).toEqual([]);
    expect(b.warnings.some((w) => w.includes("anomaly unavailable"))).toBe(true);
  });
});

describe("buildTodayBriefing — role routing & shape", () => {
  it("maintenance → machinesNeedingAttention + openProposals + topActions", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }, { factoryCode: "F2" }]);
    computeFailureRisk.mockImplementation(async (id: number) => ({
      failureRisk: id === 1 ? 90 : 10,
      maintenanceUrgency: id === 1 ? "CRITICAL" : "LOW",
      predictedTimeframe: id === 1 ? "~3 days" : null,
    }));
    countInbox.mockResolvedValue({ count: 2 });

    const b = await buildTodayBriefing({ id: 5, role: "maintenance" }, "vi");
    expect(b.role).toBe("maintenance");
    const p = b.payload as any;
    expect(p.role).toBe("maintenance");
    expect(p.openProposals).toBe(2);
    // Only the high-risk machine surfaces (>= threshold).
    expect(p.machinesNeedingAttention.length).toBe(1);
    expect(p.machinesNeedingAttention[0].machineCode).toBe("M1");
    expect(p.machinesNeedingAttention[0].pdmRisk).toBe(90);
    expect(p.topActions.length).toBe(1);
    expect(b.severity).toBe("critical");
  });

  it("operator → myLineStatus + activeAlerts + anomalyMachines", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }, { factoryCode: "F2" }]);
    getYieldTrendData.mockResolvedValue([{ totalCount: 100, ngCount: 8 }]);
    const b = await buildTodayBriefing({ id: 6, role: "operator" }, "en");
    expect(b.role).toBe("operator");
    const p = b.payload as any;
    expect(p.role).toBe("operator");
    expect(p.myLineStatus).toHaveProperty("yield");
    expect(p.myLineStatus).toHaveProperty("ngCount");
    expect(Array.isArray(p.activeAlerts)).toBe(true);
    expect(Array.isArray(p.anomalyMachines)).toBe(true);
  });

  it("supervisor (manager) → shiftKpis + exceptions + topDefect + pdmRiskCount", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }, { factoryCode: "F2" }]);
    getYieldTrendData.mockResolvedValue([{ totalCount: 200, ngCount: 4 }]);
    paretoByDefectType.mockResolvedValue({ items: [{ category: "solder", count: 12, percentage: 40 }] });
    const b = await buildTodayBriefing({ id: 7, role: "supervisor" }, "vi");
    expect(b.role).toBe("manager");
    const p = b.payload as any;
    expect(p.role).toBe("manager");
    // non-admin sums per-machine: 2 scoped machines × {total:200, ng:4} ⇒ 400/8.
    expect(p.shiftKpis).toMatchObject({ throughput: 400 });
    expect(p.shiftKpis.yield).toBe(98); // (400-8)/400
    expect(p.topDefect).toMatchObject({ type: "solder", count: 12 });
    expect(typeof p.pdmRiskCount).toBe("number");
  });

  it("quality_inspector → read-only subset (yield/ngRate/ngCount/topDefect)", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }]);
    getYieldTrendData.mockResolvedValue([{ totalCount: 50, ngCount: 1 }]);
    const b = await buildTodayBriefing({ id: 8, role: "quality_inspector" }, "vi");
    expect(b.role).toBe("quality");
    const p = b.payload as any;
    expect(p.role).toBe("quality");
    expect(p).toHaveProperty("yield");
    expect(p).toHaveProperty("ngRate");
    expect(p).toHaveProperty("ngCount");
    expect(p).toHaveProperty("topDefect");
  });

  it("viewer/user → viewer subset", async () => {
    const b = await buildTodayBriefing({ id: 9, role: "user" }, "vi");
    expect(b.role).toBe("viewer");
    expect((b.payload as any).role).toBe("viewer");
  });
});

describe("buildTodayBriefing — fail-safe", () => {
  it("does NOT throw when a source throws; records a warning + omits that section", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }, { factoryCode: "F2" }]);
    computeFailureRisk.mockRejectedValue(new Error("pdm boom"));
    getYieldTrendData.mockRejectedValue(new Error("yield boom"));
    paretoByDefectType.mockRejectedValue(new Error("pareto boom"));

    const b = await buildTodayBriefing({ id: 10, role: "supervisor" }, "vi");
    // No throw → we got a briefing.
    expect(b.role).toBe("manager");
    const p = b.payload as any;
    expect(p.exceptions).toEqual([]);
    expect(p.topDefect).toBeNull();
    expect(p.shiftKpis.throughput).toBe(0);
    expect(b.warnings.length).toBeGreaterThan(0);
  });

  it("empty 'good news' state for maintenance when nothing needs attention", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }, { factoryCode: "F2" }]);
    // all risks low → no attention rows
    const b = await buildTodayBriefing({ id: 11, role: "maintenance" }, "en");
    const p = b.payload as any;
    expect(p.machinesNeedingAttention).toEqual([]);
    expect(b.severity).toBe("ok");
    expect(b.headline).toContain("All clear");
  });
});

describe("buildTodayBriefing — scope", () => {
  it("non-admin with NO assignment composes over zero machines (empty PdM/yield)", async () => {
    getUserFactoryAssignments.mockResolvedValue([]); // no factories
    computeFailureRisk.mockResolvedValue({ failureRisk: 99, maintenanceUrgency: "CRITICAL", predictedTimeframe: "soon" });

    const b = await buildTodayBriefing({ id: 12, role: "maintenance" }, "vi");
    const p = b.payload as any;
    // scope is empty ⇒ computeFailureRisk never reached ⇒ no attention rows.
    expect(computeFailureRisk).not.toHaveBeenCalled();
    expect(p.machinesNeedingAttention).toEqual([]);
  });

  it("non-admin scoped to F1 only composes over F1 machines", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }]);
    computeFailureRisk.mockResolvedValue({ failureRisk: 95, maintenanceUrgency: "CRITICAL", predictedTimeframe: "soon" });

    const b = await buildTodayBriefing({ id: 13, role: "maintenance" }, "vi");
    const p = b.payload as any;
    // Only M1 (factory F1) is in scope.
    expect(computeFailureRisk).toHaveBeenCalledTimes(1);
    expect(computeFailureRisk).toHaveBeenCalledWith(1);
    expect(p.machinesNeedingAttention.map((r: any) => r.machineCode)).toEqual(["M1"]);
  });

  it("admin composes over all machines (no scope restriction)", async () => {
    computeFailureRisk.mockResolvedValue({ failureRisk: 70, maintenanceUrgency: "HIGH", predictedTimeframe: null });
    const b = await buildTodayBriefing({ id: 1, role: "admin" }, "vi");
    // admin → manager variant; PdM evaluated for both machines.
    expect(b.role).toBe("manager");
    expect(computeFailureRisk).toHaveBeenCalledTimes(2);
  });
});
