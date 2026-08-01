/**
 * U3 (doc 21 §6 / §3 G-4, G-5) — Machine & Robot Cockpit aggregation tests.
 *
 * Covers (underlying services mocked; DB routed by table key):
 *   • machineDetail ASSEMBLES all sections (identity/capability/live/health/oee/
 *     alarms/recipes/programs/genealogy/model3d/gatedActions) and HONEST-NULLS a
 *     disabled source (a throwing/absent sub-source → available:false, not fabricated).
 *   • robotDetail assembles all sections and RESOLVES a kinematic chain (SAMPLE when
 *     no real URDF exists) — isSample:true, honest note.
 *   • machineAlarms NORMALIZES raw andon rows → ISA-18.2 { standardCode, severity, … }.
 *   • gatedActions is METADATA ONLY (mirrors capability commands; no execution).
 *   • NOT_FOUND semantics: a missing machine/robot → null (router turns into NOT_FOUND).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake DB routed by a __key tag stamped on each drizzle table. Supports the
//    join/where/orderBy/limit chain used by the service (thenable + awaitable). ──
let dbRows: Record<string, any[]> = {};
let dbPresent = true;

function terminal(rows: any[]): any {
  const t: any = {
    leftJoin: () => t,
    innerJoin: () => t,
    where: () => t,
    orderBy: () => t,
    limit: async (_n: number) => rows,
    then: (resolve: (v: any[]) => void) => resolve(rows),
  };
  return t;
}
function makeDb() {
  return {
    select: (_cols?: any) => ({
      from: (tbl: any) => terminal(dbRows[(tbl && tbl.__key) || ""] ?? []),
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: async () => (dbPresent ? makeDb() : null) }));

// ── Tag the real schema tables so the fake db routes by key. ──
vi.mock("../../../drizzle/schema", async (orig) => {
  const mod: any = await (orig as any)();
  const tag = (obj: any, key: string) => (obj ? Object.assign(obj, { __key: key }) : obj);
  tag(mod.machines, "machines");
  tag(mod.stations, "stations");
  tag(mod.productionLines, "lines");
  tag(mod.workshops, "workshops");
  tag(mod.factories, "factories");
  tag(mod.andonEvents, "andon");
  tag(mod.safetyEvents, "safety");
  tag(mod.robots, "robots");
  tag(mod.robotTelemetry, "robotTelemetry");
  tag(mod.robotJobs, "robotJobs");
  tag(mod.robotBehaviorAnomalies, "robotAnomalies");
  tag(mod.tasks, "tasks");
  tag(mod.programProjects, "programProjects");
  tag(mod.programDeployments, "programDeployments");
  tag(mod.genealogyChain, "genealogy");
  return mod;
});

// ── Mock db/machine live-status helpers. ──
const getLatestMachineStatus = vi.fn(async (_id: number): Promise<any> => ({ status: "online", timestamp: new Date() }));
const getLatestMachineHeartbeat = vi.fn(async (_id: number): Promise<any> => ({ status: "running", timestamp: new Date() }));
vi.mock("../../db/machine", () => ({
  getLatestMachineStatus: (id: number) => getLatestMachineStatus(id),
  getLatestMachineHeartbeat: (id: number) => getLatestMachineHeartbeat(id),
}));

// ── Mock OEE + PdM + model registry + recipe history. Toggled per-test. ──
const getMachineOEELive = vi.fn(async (_p: any): Promise<any> => ({
  availability: 0.9, performance: 0.8, quality: 0.95, oee: 0.68,
  details: { hasUptimeData: true, hasProductionData: true },
}));
vi.mock("../oeeService", () => ({ getMachineOEELive: (p: any) => getMachineOEELive(p) }));

const computeFailureRisk = vi.fn(async (_id: number): Promise<any> => ({
  failureRisk: 42, maintenanceUrgency: "MEDIUM", predictedTimeframeHours: 72,
  recommendedMaintenanceDate: new Date(), dataPoints: 10,
}));
const computeReliabilityStats = vi.fn(async (_id: number): Promise<any> => ({
  mtbfHours: 120, mttrHours: 3, unplannedEvents: 2, uptimeMinutes: 5000,
}));
vi.mock("../predictiveMaintenanceService", () => ({
  computeFailureRisk: (id: number) => computeFailureRisk(id),
  computeReliabilityStats: (id: number) => computeReliabilityStats(id),
}));

const resolveModel = vi.fn(async (_t: any): Promise<any> => null);
vi.mock("../twin/modelRegistry", () => ({ resolveModel: (t: any) => resolveModel(t) }));

const listLoadHistory = vi.fn(async (_id: number, _l?: number): Promise<any[]> => [{ action: "load", recipeCode: "R1" }]);
vi.mock("../equipment/recipeVersioningService", () => ({ listLoadHistory: (id: number, l?: number) => listLoadHistory(id, l) }));

import {
  machineDetail,
  robotDetail,
  machineAlarms,
  robotAlarms,
} from "./assetCockpitService";

beforeEach(() => {
  dbPresent = true;
  dbRows = {};
  vi.clearAllMocks();
  // sensible default identity rows
  dbRows["machines"] = [
    { // identity join shape (machine/station/line/factory) + flat cols for the
      // capability sub-select ({ machineType, capabilities }) — same fake row serves both.
      machineType: "AOI",
      capabilities: null,
      machine: { id: 7, code: "M-7", name: "AOI 7", machineType: "AOI", model: "X", manufacturer: "Acme", stationId: 3, isActive: true, capabilities: null },
      station: { id: 3, code: "ST-3", lineId: 2 }, line: { id: 2, name: "Line 2", workshopId: 5 }, factory: { id: 9, name: "F9", corporateCode: "CORP" } },
  ];
  dbRows["robots"] = [
    { id: 4, code: "R-4", name: "Cobot 4", vendor: "universal_robots", kind: "cobot", model: "UR5", status: "idle", lineId: 2, stationId: 3, isEnabled: true, lastSeenAt: new Date() },
  ];
  // restore default mock impls (clearAllMocks wipes impls)
  getLatestMachineStatus.mockResolvedValue({ status: "online", timestamp: new Date() });
  getLatestMachineHeartbeat.mockResolvedValue({ status: "running", timestamp: new Date() });
  getMachineOEELive.mockResolvedValue({ availability: 0.9, performance: 0.8, quality: 0.95, oee: 0.68, details: { hasUptimeData: true, hasProductionData: true } });
  computeFailureRisk.mockResolvedValue({ failureRisk: 42, maintenanceUrgency: "MEDIUM", predictedTimeframeHours: 72, recommendedMaintenanceDate: new Date(), dataPoints: 10 });
  computeReliabilityStats.mockResolvedValue({ mtbfHours: 120, mttrHours: 3, unplannedEvents: 2, uptimeMinutes: 5000 });
  resolveModel.mockResolvedValue(null);
  listLoadHistory.mockResolvedValue([{ action: "load", recipeCode: "R1" }]);
});

describe("machineDetail — assembly", () => {
  it("assembles every section from its own source (proof of aggregation)", async () => {
    dbRows["andon"] = [{ state: "red", reason: "maintenance", title: "Fault", message: "Motor overtemp", raisedAt: new Date() }];
    dbRows["programProjects"] = [{ id: 11, deviceId: 7, code: "P1" }];
    dbRows["programDeployments"] = [{ id: 21, projectId: 11 }];
    dbRows["genealogy"] = [{ id: 1, serialNumber: "SN1", stationCode: "ST-3" }];

    const d = await machineDetail(7);
    expect(d).not.toBeNull();
    expect(d!.identity.code).toBe("M-7");
    expect(d!.identity.corporateCode).toBe("CORP");
    expect(d!.identity.factoryName).toBe("F9");

    // resolvedCapability from capabilityModel + registry
    expect(d!.resolvedCapability.available).toBe(true);
    expect(d!.resolvedCapability.value!.equipmentClass).toBe("AOI");
    expect(d!.resolvedCapability.value!.deviceType).toBeTruthy();
    expect(d!.resolvedCapability.source).toContain("capabilityModel");

    // liveState from db/machine
    expect(d!.liveState.available).toBe(true);
    expect(d!.liveState.value!.connected).toBe(true);

    // health from PdM
    expect(computeFailureRisk).toHaveBeenCalledWith(7);
    expect(d!.health.value!.mtbfHours).toBe(120);
    expect(d!.health.value!.rulHours).toBe(72);

    // oee from oeeService
    expect(getMachineOEELive).toHaveBeenCalled();
    expect(d!.oee.value!.oee).toBe(0.68);

    // alarms normalized
    expect(d!.alarms.available).toBe(true);
    expect(d!.alarms.value![0].standardCode).toBe("MAINTENANCE_REQUIRED");

    // recipes / programs / genealogy from their tables
    expect(d!.recipes.value!.loadHistory.length).toBe(1);
    expect(d!.programs.value!.projects.length).toBe(1);
    expect(d!.programs.value!.deployments.length).toBe(1);
    expect(d!.genealogy.value!.length).toBe(1);

    // model3d honest-null (resolveModel returned null)
    expect(d!.model3d.available).toBe(false);
    expect(d!.model3d.value).toBeNull();

    // gatedActions = capability command metadata (has the AOI start command)
    expect(d!.gatedActions.some((a) => a.name === "start")).toBe(true);
    expect(d!.gatedActions.every((a) => typeof a.requiredPermission === "string")).toBe(true);
  });

  it("HONEST-NULLS a disabled/throwing source (health) without breaking the page", async () => {
    computeFailureRisk.mockRejectedValueOnce(new Error("PdM disabled"));
    const d = await machineDetail(7);
    expect(d).not.toBeNull();
    expect(d!.health.available).toBe(false);
    expect(d!.health.value).toBeNull();
    // other sections still assemble
    expect(d!.oee.available).toBe(true);
  });

  it("honest-nulls OEE when there is no uptime/production data (not a fake 0)", async () => {
    getMachineOEELive.mockResolvedValueOnce({ availability: null, performance: null, quality: null, oee: null, details: { hasUptimeData: false, hasProductionData: false } });
    const d = await machineDetail(7);
    expect(d!.oee.available).toBe(false);
    expect(d!.oee.value).toBeNull();
  });

  it("returns null for a missing machine (→ NOT_FOUND at the router)", async () => {
    dbRows["machines"] = [];
    const d = await machineDetail(999);
    expect(d).toBeNull();
  });
});

describe("machineAlarms — per-machine ISA-18.2 normalization", () => {
  it("normalizes raw andon rows into the taxonomy envelope", async () => {
    dbRows["andon"] = [
      { state: "red", reason: "safety", title: "E-stop", message: "guard open", raisedAt: new Date(1000) },
      { state: "yellow", reason: "quality", title: "Reject spike", message: null, raisedAt: new Date(2000) },
    ];
    const alarms = await machineAlarms(7);
    expect(alarms.length).toBe(2);
    // newest first
    expect(alarms[0].standardCode).toBe("QUALITY_ALARM");
    expect(alarms[0].severity).toBe("high");
    expect(alarms[1].standardCode).toBe("SAFETY_STOP");
    expect(alarms[1].severity).toBe("critical");
    // shape contract
    for (const a of alarms) {
      expect(a).toHaveProperty("standardCode");
      expect(a).toHaveProperty("severity");
      expect(a).toHaveProperty("ts");
      expect(a.source).toBe("andon");
    }
  });

  it("returns [] when no DB (fail-safe)", async () => {
    dbPresent = false;
    expect(await machineAlarms(7)).toEqual([]);
  });
});

describe("robotDetail — assembly + kinematic resolution", () => {
  it("assembles sections and resolves a SAMPLE kinematic chain (no real URDF)", async () => {
    dbRows["robotTelemetry"] = [{ mode: "auto", busy: true, estop: false, speedPct: 50, poseJson: { cartesian: { x: 1, y: 2, z: 3 } }, jointStates: [{ p: 0 }], batteryLevel: "88.5", safetyZoneId: 2, firmwareVersion: "1.2.3", lastHeartbeat: new Date(), timestamp: new Date() }];
    dbRows["robotJobs"] = [{ id: 1, robotId: 4, jobType: "move" }];
    dbRows["tasks"] = [{ id: 5, assignedDeviceId: 4, assignedDeviceKind: "robot" }];
    dbRows["programProjects"] = [{ id: 3, deviceId: 4, kind: "robot-tm" }];
    dbRows["safety"] = [{ id: 8, robotId: 4, eventType: "estop", isNearMiss: false, createdAt: new Date() }];
    dbRows["robotAnomalies"] = [{ id: 2, robotId: 4, kind: "grip_force", score: "3.2" }];

    const d = await robotDetail(4);
    expect(d).not.toBeNull();
    expect(d!.identity.code).toBe("R-4");
    expect(d!.identity.vendor).toBe("universal_robots");

    // live telemetry — full UDM decoded
    expect(d!.liveTelemetry.available).toBe(true);
    expect(d!.liveTelemetry.value!.batteryPct).toBe(88.5);
    expect(d!.liveTelemetry.value!.jointStates!.length).toBe(1);
    expect(d!.liveTelemetry.value!.estop).toBe(false);

    // capability from ROBOT profile
    expect(d!.capability.value!.equipmentClass).toBe("ROBOT");
    expect(d!.gatedActions.some((a) => a.name === "e_stop")).toBe(true);

    // kinematic — SAMPLE chain (cobot → universal-robots 6-DOF)
    expect(d!.kinematicModel.available).toBe(true);
    expect(d!.kinematicModel.value!.isSample).toBe(true);
    expect(d!.kinematicModel.value!.model.dof).toBe(6);
    expect(d!.kinematicModel.value!.note).toMatch(/SAMPLE/i);

    // jobs/tasks/programs/safety/anomalies assembled
    expect(d!.jobs.value!.length).toBe(1);
    expect(d!.tasks.value!.length).toBe(1);
    expect(d!.programs.value!.length).toBe(1);
    expect(d!.safety.value!.length).toBe(1);
    expect(d!.anomalies.value!.length).toBe(1);

    // per-robot alarms normalized from safety
    expect(d!.alarms.value!.length).toBe(1);
    expect(d!.alarms.value![0].source).toBe("safety");
    expect(d!.alarms.value![0].standardCode).toContain("ESTOP");
  });

  it("resolves the GENERIC (SCARA) sample for a scara/agv kind", async () => {
    dbRows["robots"] = [{ id: 6, code: "R-6", name: "AGV", vendor: "sim", kind: "agv", model: null, status: "idle", lineId: null, stationId: null, isEnabled: true, lastSeenAt: null }];
    const d = await robotDetail(6);
    expect(d!.kinematicModel.value!.model.dof).toBe(4); // SCARA sample
  });

  it("honest-nulls liveTelemetry when there is no telemetry row", async () => {
    dbRows["robotTelemetry"] = [];
    const d = await robotDetail(4);
    expect(d!.liveTelemetry.available).toBe(false);
    expect(d!.liveTelemetry.value).toBeNull();
  });

  it("returns null for a missing robot (→ NOT_FOUND at the router)", async () => {
    dbRows["robots"] = [];
    expect(await robotDetail(999)).toBeNull();
  });
});

describe("robotAlarms — per-robot safety → ISA-18.2", () => {
  it("derives a SAFETY_ standard code when no vendor mapping matches", async () => {
    dbRows["safety"] = [{ eventType: "intrusion", isNearMiss: true, notes: "human near", outcome: "speed_reduce", createdAt: new Date() }];
    const alarms = await robotAlarms(4, "sim");
    expect(alarms.length).toBe(1);
    expect(alarms[0].standardCode).toBe("SAFETY_INTRUSION");
    expect(alarms[0].severity).toBe("high"); // near-miss
    expect(alarms[0].source).toBe("safety");
  });
});
