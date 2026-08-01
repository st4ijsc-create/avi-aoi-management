/**
 * U2 (doc 21 §6 / §3 G-3) — Ecosystem Command Center aggregation tests.
 *
 * Covers (mostly DB-free via pure helpers; DB paths mocked):
 *   • status roll-up: a DOWN machine makes its station/line/factory down; a warn
 *     propagates; empty → unknown; WORST-of-children semantics.
 *   • device-type resolution is REGISTRY-DRIVEN (a machineType resolves to its seed
 *     type; an unknown type falls back to the base — so a new type auto-appears).
 *   • factory subtree assembly nests line→station→{machine,robot} + injects real
 *     alarm counts + rolls status up + sums counts.
 *   • recentAlerts maps andon + safety rows into the U1 envelope shape.
 *   • kpiSummary aggregates OEE + honest-nulls a disabled/absent source.
 *   • the live-vs-poll status field reflects ECOSYSTEM_EVENTS_ENABLED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SceneGraph } from "../twin/sceneGraph";

// ── Mock getDb so DB-bound functions are deterministic (routed by table marker). ──
let dbRows: Record<string, any[]> = {};
let dbPresent = true;
function terminal(rows: any[]): any {
  return {
    where: (..._a: any[]) => terminal(rows),
    orderBy: (..._a: any[]) => terminal(rows),
    limit: async (_n: number) => rows,
    groupBy: (..._a: any[]) => terminal(rows),
    then: (resolve: (v: any[]) => void) => resolve(rows),
  };
}
function makeDb() {
  return {
    select: (_cols?: any) => ({
      from: (t: any) => {
        const name = t?.[Symbol.for("drizzle:Name")] ?? t?._?.name ?? t?.name ?? "";
        // fall back: use a tag stashed by our test tables
        const key = (t && t.__key) || name;
        return terminal(dbRows[key] ?? []);
      },
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: async () => (dbPresent ? makeDb() : null) }));

// ── Tag drizzle tables so the fake db can route by key. We import the REAL schema
//    objects and stamp a __key the fake reads. (Real drizzle names also handled.) ──
vi.mock("../../../drizzle/schema", async (orig) => {
  const mod: any = await (orig as any)();
  const tag = (obj: any, key: string) => (obj ? Object.assign(obj, { __key: key }) : obj);
  tag(mod.factories, "factories");
  tag(mod.machines, "machines");
  tag(mod.andonEvents, "andon");
  tag(mod.safetyEvents, "safety");
  tag(mod.sites, "sites");
  tag(mod.siteKpiRollup, "siteKpiRollup");
  tag(mod.tasks, "tasks");
  tag(mod.robots, "robots");
  tag(mod.wipTracking, "wipTracking");
  return mod;
});

// ── Mock the reused services so kpiSummary is deterministic. ──
const getAllMachinesOEELive = vi.fn(async () => [] as any[]);
vi.mock("../oeeService", () => ({ getAllMachinesOEELive: () => getAllMachinesOEELive() }));
const countInbox = vi.fn(async (_u: any) => ({ count: 0 }));
vi.mock("../aiActionInbox", () => ({ countInbox: (u: any) => countInbox(u) }));

// buildSceneGraph is only used by buildHierarchy; mock so no real DB scene assembly runs.
const buildSceneGraph = vi.fn(async (_factoryId: number): Promise<SceneGraph> => emptyGraph());
vi.mock("../twin/sceneGraph", async (orig) => {
  const mod: any = await (orig as any)();
  return { ...mod, buildSceneGraph: (id: number) => buildSceneGraph(id) };
});

function emptyGraph(): SceneGraph {
  return { factory: null, zones: [], lines: [], devices: [], ts: Date.now() };
}

import {
  deviceStatus,
  rollUpStatus,
  sumCounts,
  resolveDeviceType,
  projectDevice,
  assembleFactorySubtree,
  siteFreshnessToStatus,
  andonToSeed,
  safetyToSeed,
  andonSeverity,
  aggregateOee,
  commandCenterStatus,
  buildKpiSummary,
  buildRecentAlerts,
  buildHierarchy,
  type NodeStatus,
} from "./commandCenterService";
import type { DeviceNode } from "../twin/sceneGraph";

beforeEach(() => {
  dbRows = {};
  dbPresent = true;
  getAllMachinesOEELive.mockResolvedValue([]);
  countInbox.mockResolvedValue({ count: 0 });
  buildSceneGraph.mockResolvedValue(emptyGraph());
  delete process.env.ECOSYSTEM_EVENTS_ENABLED;
});
afterEach(() => vi.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════
describe("status roll-up (worst-of children)", () => {
  it("maps normalized device states to coarse status", () => {
    expect(deviceStatus("running")).toBe("ok");
    expect(deviceStatus("idle")).toBe("idle");
    expect(deviceStatus("held")).toBe("warn");
    expect(deviceStatus("aborted")).toBe("down");
    expect(deviceStatus("estop")).toBe("down");
    expect(deviceStatus("offline")).toBe("down");
    expect(deviceStatus("unknown")).toBe("unknown");
  });

  it("rolls the WORST child status up", () => {
    expect(rollUpStatus(["ok", "ok", "down"])).toBe("down");
    expect(rollUpStatus(["ok", "warn"])).toBe("warn");
    expect(rollUpStatus(["ok", "idle"])).toBe("idle");
    expect(rollUpStatus(["ok", "ok"])).toBe("ok");
    expect(rollUpStatus([])).toBe("unknown");
  });

  it("sums counts across children", () => {
    expect(
      sumCounts([
        { activeAlarms: 1, activeTasks: 2, offline: 0 },
        { activeAlarms: 3, activeTasks: 0, offline: 1 },
      ]),
    ).toEqual({ activeAlarms: 4, activeTasks: 2, offline: 1 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("device-type resolution is registry-driven", () => {
  it("resolves a known machineType to its seed type key", () => {
    // AOI is seeded from capabilityModel DEFAULT_PROFILES → registry typeKey "AOI".
    expect(resolveDeviceType("AOI")).toBe("AOI");
    expect(resolveDeviceType("ROBOT")).toBe("ROBOT");
  });

  it("falls back to the Equipment base for an unknown/new type (never throws)", () => {
    expect(resolveDeviceType("A_BRAND_NEW_TYPE")).toBe("Equipment");
    expect(resolveDeviceType(null)).toBe("Equipment");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("factory subtree assembly", () => {
  const machineDevice = (id: number, stationId: number, state: DeviceNode["state"]): DeviceNode => ({
    id: `machine:${id}`, kind: "machine", refId: id, code: `M${id}`, name: `M${id}`,
    stationId, state, color: "", position: null, bounds: null, modelUri: null, modelKind: null, activeTaskId: null, alarm: null,
  });
  const robotDevice = (id: number, stationId: number, state: DeviceNode["state"], taskId: number | null): DeviceNode => ({
    id: `robot:${id}`, kind: "robot", refId: id, code: `R${id}`, name: `R${id}`,
    stationId, state, color: "", position: null, bounds: null, modelUri: null, modelKind: null, activeTaskId: taskId, alarm: null,
  });

  function graphWith(devices: DeviceNode[]): SceneGraph {
    return {
      factory: { id: 1, code: "F1", name: "Factory 1" },
      zones: [],
      lines: [
        { id: "line:1", refId: 1, code: "L1", name: "Line 1", workshopId: 1, stations: [
          { id: "station:1", refId: 1, code: "S1", name: "Station 1", lineId: 1, devices: devices.filter((d) => d.stationId === 1) },
        ] },
      ],
      devices,
      ts: Date.now(),
    };
  }

  it("nests line→station→{machine,robot}, resolves types, rolls status up", () => {
    const graph = graphWith([machineDevice(10, 1, "running"), robotDevice(20, 1, "running", 5)]);
    const machineTypes = new Map<number, string>([[10, "AOI"]]);
    const factory = assembleFactorySubtree({ id: 1, code: "F1", name: "Factory 1" }, graph, machineTypes, new Map());

    expect(factory.kind).toBe("factory");
    const line = factory.children![0];
    const station = line.children![0];
    expect(station.children!.map((c) => c.id).sort()).toEqual(["machine:10", "robot:20"]);
    const machine = station.children!.find((c) => c.id === "machine:10")!;
    expect(machine.deviceType).toBe("AOI"); // registry-resolved
    const robot = station.children!.find((c) => c.id === "robot:20")!;
    expect(robot.counts.activeTasks).toBe(1); // active task counted
    expect(factory.status).toBe("ok"); // all running
  });

  it("a DOWN machine makes its station/line/factory DOWN (roll-up)", () => {
    const graph = graphWith([machineDevice(10, 1, "running"), machineDevice(11, 1, "aborted")]);
    const machineTypes = new Map<number, string>([[10, "AOI"], [11, "AOI"]]);
    const factory = assembleFactorySubtree({ id: 1, code: "F1", name: "Factory 1" }, graph, machineTypes, new Map());
    expect(factory.status).toBe("down");
    expect(factory.children![0].status).toBe("down"); // line
    expect(factory.children![0].children![0].status).toBe("down"); // station
  });

  it("injects real alarm counts and warns the leaf when alarms present", () => {
    const graph = graphWith([machineDevice(10, 1, "running")]);
    const machineTypes = new Map<number, string>([[10, "AOI"]]);
    const alarms = new Map<number, number>([[10, 2]]); // 2 active alarms on machine 10
    const factory = assembleFactorySubtree({ id: 1, code: "F1", name: "Factory 1" }, graph, machineTypes, alarms);
    const machine = factory.children![0].children![0].children![0];
    expect(machine.counts.activeAlarms).toBe(2);
    expect(machine.status).toBe("warn"); // running but alarmed → warn
    expect(factory.counts.activeAlarms).toBe(2); // summed up
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("alert mappers → U1 envelope", () => {
  it("maps an andon row into the envelope shape", () => {
    const seed = andonToSeed({ id: 7, state: "red", title: "E-stop pressed", message: "op", machineId: 12, lineId: 3, stationId: 4, raisedAt: new Date(1000) });
    expect(seed.kind).toBe("andon");
    expect(seed.severity).toBe("critical");
    expect(seed.scope).toEqual({ machineId: 12, lineId: 3 });
    expect(seed.title).toBe("E-stop pressed");
    expect(seed.ts).toBe(1000);
  });

  it("maps a safety row (near-miss=high, else critical)", () => {
    const nm = safetyToSeed({ id: 1, eventType: "intrusion", robotId: 9, lineId: 2, isNearMiss: true, createdAt: new Date(2000) });
    expect(nm.kind).toBe("safety");
    expect(nm.severity).toBe("high");
    expect(nm.scope).toEqual({ robotId: 9, lineId: 2 });
    const crit = safetyToSeed({ id: 2, eventType: "collision", isNearMiss: false, createdAt: new Date(3000) });
    expect(crit.severity).toBe("critical");
  });

  it("andonSeverity maps state buckets", () => {
    expect(andonSeverity("red")).toBe("critical");
    expect(andonSeverity("call")).toBe("critical");
    expect(andonSeverity("yellow")).toBe("high");
    expect(andonSeverity("green")).toBe("info");
  });

  it("siteFreshnessToStatus maps federation freshness", () => {
    expect(siteFreshnessToStatus("ok")).toBe("ok");
    expect(siteFreshnessToStatus("stale")).toBe("warn");
    expect(siteFreshnessToStatus("down")).toBe("down");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("buildRecentAlerts", () => {
  it("normalizes andon + safety stores into envelope seeds, newest first", async () => {
    dbRows.andon = [{ id: 1, state: "red", title: "A", message: null, machineId: 5, lineId: null, stationId: null, raisedAt: new Date(5000) }];
    dbRows.safety = [{ id: 2, eventType: "intrusion", robotId: 3, lineId: null, stationId: null, isNearMiss: true, outcome: null, createdAt: new Date(9000) }];
    const alerts = await buildRecentAlerts({ limit: 10 });
    expect(alerts).toHaveLength(2);
    expect(alerts[0].ts).toBe(9000); // safety newer → first
    expect(alerts[0].kind).toBe("safety");
    expect(alerts[1].kind).toBe("andon");
  });

  it("degrades to [] when the DB is absent", async () => {
    dbPresent = false;
    expect(await buildRecentAlerts()).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("aggregateOee", () => {
  it("means the non-null factors, ignoring nulls", () => {
    const r = aggregateOee([
      { availability: 90, performance: 80, quality: 100, oee: 72 },
      { availability: 70, performance: null, quality: 50, oee: null },
    ]);
    expect(r.a).toBe(80); // (90+70)/2
    expect(r.p).toBe(80); // only one non-null
    expect(r.q).toBe(75);
    expect(r.oee).toBe(72);
  });

  it("returns null when all factors are null", () => {
    expect(aggregateOee([{ availability: null, performance: null, quality: null, oee: null }]).oee).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("buildKpiSummary — aggregation + honest nulls", () => {
  const user = { id: 1, role: "admin", name: "T" };

  it("aggregates OEE from oeeService + AI insight count from aiActionInbox", async () => {
    getAllMachinesOEELive.mockResolvedValue([{ availability: 80, performance: 90, quality: 100, oee: 72 }]);
    countInbox.mockResolvedValue({ count: 4 });
    dbRows.tasks = [{ status: "pending" }, { status: "running" }];
    dbRows.robots = [{ status: "idle" }, { status: "offline" }];
    dbRows.wipTracking = [{ id: 1 }, { id: 2 }, { id: 3 }];
    dbRows.andon = [{ state: "red" }, { state: "yellow" }];
    dbRows.safety = [];
    dbRows.sites = [];

    const s = await buildKpiSummary(user);
    expect(s.oee.available).toBe(true);
    expect(s.oee.value!.oee).toBe(72);
    expect(s.oee.source).toContain("oeeService");
    expect(s.aiInsights.value!.count).toBe(4);
    expect(s.fleet.value).toEqual({ tasksPending: 1, tasksRunning: 1, robotsOnline: 1 });
    expect(s.wip.value!.count).toBe(3);
    expect(s.alarms.value).toEqual({ critical: 1, high: 1, total: 2 });
  });

  it("honest-nulls OEE when the source returns nothing (available:false)", async () => {
    getAllMachinesOEELive.mockResolvedValue([]);
    const s = await buildKpiSummary(user);
    expect(s.oee.available).toBe(false);
    expect(s.oee.value).toBeNull();
  });

  it("energy is honest-null (no estate total rollup exists)", async () => {
    const s = await buildKpiSummary(user);
    expect(s.energy.available).toBe(false);
    expect(s.energy.value).toBeNull();
    expect(s.energy.source).toContain("no estate total");
  });

  it("honest-nulls everything DB-bound when the DB is absent", async () => {
    dbPresent = false;
    const s = await buildKpiSummary(user);
    expect(s.wip.available).toBe(false);
    expect(s.alarms.available).toBe(false);
    expect(s.fleet.available).toBe(false);
    expect(s.sites.available).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("live-vs-poll status field", () => {
  it("reports polling by default, live when ECOSYSTEM_EVENTS_ENABLED", () => {
    delete process.env.ECOSYSTEM_EVENTS_ENABLED;
    expect(commandCenterStatus()).toEqual({ liveAlertsEnabled: false, mode: "polling" });
    process.env.ECOSYSTEM_EVENTS_ENABLED = "true";
    expect(commandCenterStatus()).toEqual({ liveAlertsEnabled: true, mode: "live" });
    delete process.env.ECOSYSTEM_EVENTS_ENABLED;
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("buildHierarchy — synthetic local site when federation absent", () => {
  it("wraps local factories in a synthetic LOCAL site (no sites registry)", async () => {
    dbRows.factories = [{ id: 1, code: "F1", name: "Factory 1", isActive: true, corporateCode: null }];
    dbRows.machines = [{ id: 10, machineType: "AOI" }];
    dbRows.andon = [];
    dbRows.sites = []; // no federation
    buildSceneGraph.mockResolvedValue({
      factory: { id: 1, code: "F1", name: "Factory 1" }, zones: [],
      lines: [{ id: "line:1", refId: 1, code: "L1", name: "Line 1", workshopId: 1, stations: [
        { id: "station:1", refId: 1, code: "S1", name: "S1", lineId: 1, devices: [
          { id: "machine:10", kind: "machine", refId: 10, code: "M10", name: "M10", stationId: 1, state: "running", color: "", position: null, bounds: null, modelUri: null, modelKind: null, activeTaskId: null, alarm: null },
        ] },
      ] }],
      devices: [], ts: Date.now(),
    });

    const { sites } = await buildHierarchy();
    expect(sites).toHaveLength(1);
    expect(sites[0].id).toBe("site:local");
    expect(sites[0].kind).toBe("site");
    expect(sites[0].children![0].id).toBe("factory:1");
    expect(sites[0].children![0].children![0].children![0].children![0].deviceType).toBe("AOI");
  });

  it("degrades to no sites when the DB is absent", async () => {
    dbPresent = false;
    expect(await buildHierarchy()).toEqual({ sites: [] });
  });
});
