/**
 * Khối 7 (doc 16 §11.2 / §15 T1-b) — Hierarchical Scene Graph (factory → zone →
 * station/line → device).  Flag: TWIN_LIVE_ENABLED (read paths are not gated).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Assembles the ONE hierarchical scene description shared by sim AND viz (doc 16
 * §1.1 principle). Each node carries: id/kind, display label, live status (machine
 * operationStatus / robot status as a normalized PackML-ish state), position/bounds,
 * a resolved modelUri (from the T1-a registry), the device's active task (fleet
 * `tasks`), and its current normalized alarm (best-effort). The FE renders this
 * compact JSON; the WS gateway (T1-c) later pushes per-device DELTAS into it.
 *
 * Source of truth for HIERARCHY:
 *   factory(hierarchy.factories) → zones(fleet.zones, by factoryId)
 *                                → lines(hierarchy.production_lines via workshops)
 *                                  → stations(hierarchy.stations) → machines + robots
 * Zones and the line/station tree are PARALLEL groupings; the graph exposes BOTH a
 * `zones[]` grouping (fleet spatial) and a `lines[]` grouping (process), with devices
 * attached under stations. This keeps it useful for occupancy viz (zones) and process
 * viz (lines) without forcing one onto the other.
 *
 * Read-only + degrade-safe: returns an empty graph (no nodes) when the DB is absent.
 * NO device control, NO writes.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq, inArray, desc } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { factories, workshops, productionLines, stations, machines } from "../../../drizzle/schema";
import { robots, robotTelemetry } from "../../../drizzle/schema";
import { zones, tasks } from "../../../drizzle/schema";
import { colorForTwin } from "../digitalTwinService";
import { resolveModel } from "./modelRegistry";

/** Normalized PackML-ish state surfaced for a device (best-effort mapping). */
export type NormalizedState =
  | "running"
  | "idle"
  | "stopped"
  | "held"
  | "aborted"
  | "offline"
  | "estop"
  | "unknown";

export interface SceneAlarm {
  code: string;
  severity: "info" | "warning" | "critical";
  message?: string | null;
}

export interface DeviceNode {
  id: string; // e.g. "machine:12" / "robot:3"
  kind: "machine" | "robot";
  refId: number;
  code: string;
  name: string;
  stationId: number | null;
  state: NormalizedState;
  color: string;
  position: { x: number; y: number; z?: number } | null;
  bounds: Record<string, unknown> | null;
  modelUri: string | null;
  modelKind: string | null;
  activeTaskId: number | null;
  alarm: SceneAlarm | null;
  /**
   * doc 24 Wave-1 T1 — OPTIONAL articulation data (robots only, additive):
   *   • joints  — latest joint-angle vector from robot_telemetry.poseJson.joints
   *               (radians for revolute, mm for prismatic). null when the driver
   *               reports no joints → the FE renders the sliding block as before.
   *   • kinematicModelId — which sample kinematic model the joints index into
   *               (mirrors the server family mapping: arm/cobot → sample-arm-6dof,
   *               scara/agv → sample-scara). Lets the FE pick the matching FK chain.
   */
  joints: number[] | null;
  kinematicModelId: string | null;
}

export interface StationNode {
  id: string; // "station:5"
  refId: number;
  code: string;
  name: string;
  lineId: number;
  devices: DeviceNode[];
}

export interface LineNode {
  id: string; // "line:2"
  refId: number;
  code: string;
  name: string;
  workshopId: number;
  stations: StationNode[];
}

export interface ZoneNode {
  id: string; // "zone:7"
  refId: number;
  code: string;
  name: string;
  zoneType: string;
  maxConcurrentRobots: number;
  bounds: Record<string, unknown> | null;
}

export interface SceneGraph {
  factory: { id: number; code: string; name: string } | null;
  zones: ZoneNode[];
  lines: LineNode[];
  /** Flat device list (also nested under stations) for quick lookup / streaming. */
  devices: DeviceNode[];
  ts: number;
}

/** Map a machine operationStatus → normalized state. */
function machineState(status: string | null | undefined): NormalizedState {
  switch ((status ?? "").toLowerCase()) {
    case "running":
    case "active":
      return "running";
    case "idle":
      return "idle";
    case "stopped":
      return "stopped";
    case "error":
    case "fault":
      return "aborted";
    case "maintenance":
    case "held":
      return "held";
    case "offline":
      return "offline";
    default:
      return "unknown";
  }
}

/** Map a robot registry status → normalized state. */
function robotState(status: string | null | undefined, busy?: boolean | null): NormalizedState {
  switch ((status ?? "").toLowerCase()) {
    case "estop":
      return "estop";
    case "offline":
      return "offline";
    case "error":
      return "aborted";
    case "idle":
      return busy ? "running" : "idle";
    case "running":
    case "busy":
      return "running";
    default:
      return busy ? "running" : "unknown";
  }
}

/** Pull a {x,y,z} position out of a robot pose JSON (VDA5050 / robotDriver shape). */
function poseToPosition(pose: Record<string, unknown> | null): { x: number; y: number; z?: number } | null {
  if (!pose) return null;
  const cart = pose.cartesian as { x?: number; y?: number; z?: number } | undefined;
  if (cart && typeof cart.x === "number" && typeof cart.y === "number") {
    return { x: cart.x, y: cart.y, z: typeof cart.z === "number" ? cart.z : undefined };
  }
  return null;
}

/**
 * doc 24 Wave-1 T1 — pull the joint-angle vector out of a robot pose JSON. The
 * robotDriver/VDA5050 shape carries joints at `poseJson.joints` (a number[] —
 * radians for revolute, mm for prismatic). Returns null when absent/malformed so a
 * robot without joint telemetry keeps rendering as the sliding block (backward-compat).
 */
function poseToJoints(pose: Record<string, unknown> | null): number[] | null {
  if (!pose) return null;
  const j = (pose as { joints?: unknown }).joints;
  if (Array.isArray(j) && j.length > 0 && j.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return j as number[];
  }
  return null;
}

/**
 * doc 24 Wave-1 T1 — map a robot `kind` → the sample kinematic-model id the FE FK
 * uses. MIRRORS the server's robotKindToKinematicFamily + resolveKinematicModel
 * (assetCockpitService.ts): arm/cobot → sample-arm-6dof (6-DOF UR-ish);
 * scara/agv/other → sample-scara (4-DOF). Kept identical so a joints vector renders
 * the same chain client- and server-side.
 */
function robotKindToKinematicModelId(kind: string | null | undefined): string {
  const k = (kind ?? "").toLowerCase();
  if (k === "cobot" || k === "arm") return "sample-arm-6dof";
  return "sample-scara";
}

/** Machine layout position (normalized 0..1) → a plain {x,y} (best-effort). */
function machinePosition(m: { layoutPositionX: unknown; layoutPositionY: unknown }): { x: number; y: number } | null {
  const x = m.layoutPositionX != null ? Number(m.layoutPositionX) : null;
  const y = m.layoutPositionY != null ? Number(m.layoutPositionY) : null;
  if (x == null || y == null || Number.isNaN(x) || Number.isNaN(y)) return null;
  return { x, y };
}

/**
 * Build the full scene graph for a factory. Read-only. Live status is merged from
 * machines.operationStatus + machine health (color) and the robot registry/telemetry.
 * Active tasks come from `tasks` (assignedDeviceId → robot). modelUri is resolved per
 * device through the T1-a registry (machine → by id, robot → by class "ROBOT").
 */
export async function buildSceneGraph(factoryId: number): Promise<SceneGraph> {
  const db = await getDb();
  const empty: SceneGraph = { factory: null, zones: [], lines: [], devices: [], ts: Date.now() };
  if (!db) return empty;

  const [factory] = await db.select().from(factories).where(eq(factories.id, factoryId)).limit(1);
  if (!factory) return empty;

  // Zones (fleet spatial grouping) for this factory.
  const zoneRows = await db.select().from(zones).where(eq(zones.factoryId, factoryId));
  const zoneNodes: ZoneNode[] = zoneRows.map((z) => ({
    id: `zone:${z.id}`,
    refId: z.id,
    code: z.code,
    name: z.name,
    zoneType: z.zoneType,
    maxConcurrentRobots: z.maxConcurrentRobots,
    bounds: z.bounds ?? null,
  }));

  // Process hierarchy: workshops → lines → stations → machines, scoped to the factory.
  const workshopRows = await db.select().from(workshops).where(eq(workshops.factoryId, factoryId));
  const workshopIds = workshopRows.map((w) => w.id);
  const lineRows = workshopIds.length
    ? await db.select().from(productionLines).where(inArray(productionLines.workshopId, workshopIds))
    : [];
  const lineIds = lineRows.map((l) => l.id);
  const stationRows = lineIds.length ? await db.select().from(stations).where(inArray(stations.lineId, lineIds)) : [];
  const stationIds = stationRows.map((s) => s.id);
  const machineRows = stationIds.length ? await db.select().from(machines).where(inArray(machines.stationId, stationIds)) : [];

  // Robots scoped to the factory's stations/lines (robots carry lineId/stationId).
  const robotRows = await db.select().from(robots);
  const factoryRobots = robotRows.filter(
    (r) => (r.stationId != null && stationIds.includes(r.stationId)) || (r.lineId != null && lineIds.includes(r.lineId)),
  );

  // Active tasks keyed by assigned robot device id (for activeTaskId).
  const openTasks = await db.select().from(tasks).where(inArray(tasks.status, ["assigned", "running"]));
  const taskByDevice = new Map<number, number>();
  for (const t of openTasks) if (t.assignedDeviceId != null && !taskByDevice.has(t.assignedDeviceId)) taskByDevice.set(t.assignedDeviceId, t.id);

  // Latest telemetry per factory robot (pose) — best-effort, one query per robot.
  const robotPose = new Map<number, Record<string, unknown> | null>();
  for (const r of factoryRobots) {
    const [tel] = await db
      .select()
      .from(robotTelemetry)
      .where(eq(robotTelemetry.robotId, r.id))
      .orderBy(desc(robotTelemetry.timestamp))
      .limit(1);
    robotPose.set(r.id, (tel?.poseJson ?? null) as Record<string, unknown> | null);
  }

  const devices: DeviceNode[] = [];

  // Machine device nodes.
  for (const m of machineRows) {
    const modelRow = await resolveModel({ machineId: m.id, equipmentClass: String(m.machineType) });
    devices.push({
      id: `machine:${m.id}`,
      kind: "machine",
      refId: m.id,
      code: m.code,
      name: m.name,
      stationId: m.stationId,
      state: machineState(m.operationStatus),
      color: colorForTwin(m.operationStatus, null),
      position: machinePosition(m),
      bounds: (m.layout ?? null) as Record<string, unknown> | null,
      modelUri: modelRow?.modelUri ?? null,
      modelKind: modelRow?.modelKind ?? null,
      activeTaskId: null, // machines are not allocated tasks in G1
      alarm: null,
      joints: null, // machines are not articulated
      kinematicModelId: null,
    });
  }

  // Robot device nodes.
  for (const r of factoryRobots) {
    const pose = robotPose.get(r.id) ?? null;
    const joints = poseToJoints(pose);
    const modelRow = await resolveModel({ equipmentId: String(r.id), equipmentClass: "ROBOT" });
    devices.push({
      id: `robot:${r.id}`,
      kind: "robot",
      refId: r.id,
      code: r.code,
      name: r.name,
      stationId: r.stationId,
      state: robotState(r.status, undefined),
      color: colorForTwin(r.status, null),
      position: poseToPosition(pose),
      bounds: null,
      modelUri: modelRow?.modelUri ?? null,
      modelKind: modelRow?.modelKind ?? null,
      activeTaskId: taskByDevice.get(r.id) ?? null,
      alarm: null,
      // T1 — carry joints + the matching kinematic-model id so the FE can articulate.
      joints,
      kinematicModelId: joints ? robotKindToKinematicModelId(r.kind) : null,
    });
  }

  // Nest devices under stations under lines.
  const devicesByStation = new Map<number, DeviceNode[]>();
  for (const d of devices) {
    if (d.stationId == null) continue;
    const arr = devicesByStation.get(d.stationId);
    if (arr) arr.push(d);
    else devicesByStation.set(d.stationId, [d]);
  }
  const stationsByLine = new Map<number, StationNode[]>();
  for (const s of stationRows) {
    const node: StationNode = {
      id: `station:${s.id}`,
      refId: s.id,
      code: s.code,
      name: s.name,
      lineId: s.lineId,
      devices: devicesByStation.get(s.id) ?? [],
    };
    const arr = stationsByLine.get(s.lineId);
    if (arr) arr.push(node);
    else stationsByLine.set(s.lineId, [node]);
  }
  const lineNodes: LineNode[] = lineRows.map((l) => ({
    id: `line:${l.id}`,
    refId: l.id,
    code: l.code,
    name: l.name,
    workshopId: l.workshopId,
    stations: stationsByLine.get(l.id) ?? [],
  }));

  return {
    factory: { id: factory.id, code: factory.code, name: factory.name },
    zones: zoneNodes,
    lines: lineNodes,
    devices,
    ts: Date.now(),
  };
}

/**
 * PURE — assemble a scene graph from already-loaded rows (no DB). Used by tests and
 * by callers that already hold the data. Mirrors buildSceneGraph's nesting + state
 * merge logic exactly so a test can verify zone→station→device nesting and the
 * live-status merge deterministically.
 */
export interface SceneGraphInputs {
  factory: { id: number; code: string; name: string };
  zones: Array<{ id: number; code: string; name: string; zoneType: string; maxConcurrentRobots: number; bounds?: Record<string, unknown> | null }>;
  lines: Array<{ id: number; code: string; name: string; workshopId: number }>;
  stations: Array<{ id: number; code: string; name: string; lineId: number }>;
  machines: Array<{ id: number; code: string; name: string; stationId: number; operationStatus?: string | null; modelUri?: string | null }>;
  robots: Array<{ id: number; code: string; name: string; stationId: number | null; status?: string | null; activeTaskId?: number | null; modelUri?: string | null; kind?: string | null; joints?: number[] | null }>;
}

export function assembleSceneGraph(inputs: SceneGraphInputs): SceneGraph {
  const devices: DeviceNode[] = [];
  for (const m of inputs.machines) {
    devices.push({
      id: `machine:${m.id}`,
      kind: "machine",
      refId: m.id,
      code: m.code,
      name: m.name,
      stationId: m.stationId,
      state: machineState(m.operationStatus),
      color: colorForTwin(m.operationStatus, null),
      position: null,
      bounds: null,
      modelUri: m.modelUri ?? null,
      modelKind: null,
      activeTaskId: null,
      alarm: null,
      joints: null,
      kinematicModelId: null,
    });
  }
  for (const r of inputs.robots) {
    const joints = r.joints && r.joints.length > 0 ? r.joints : null;
    devices.push({
      id: `robot:${r.id}`,
      kind: "robot",
      refId: r.id,
      code: r.code,
      name: r.name,
      stationId: r.stationId,
      state: robotState(r.status, undefined),
      color: colorForTwin(r.status, null),
      position: null,
      bounds: null,
      modelUri: r.modelUri ?? null,
      modelKind: null,
      activeTaskId: r.activeTaskId ?? null,
      alarm: null,
      joints,
      kinematicModelId: joints ? robotKindToKinematicModelId(r.kind) : null,
    });
  }
  const devicesByStation = new Map<number, DeviceNode[]>();
  for (const d of devices) {
    if (d.stationId == null) continue;
    const arr = devicesByStation.get(d.stationId);
    if (arr) arr.push(d);
    else devicesByStation.set(d.stationId, [d]);
  }
  const stationsByLine = new Map<number, StationNode[]>();
  for (const s of inputs.stations) {
    const node: StationNode = {
      id: `station:${s.id}`,
      refId: s.id,
      code: s.code,
      name: s.name,
      lineId: s.lineId,
      devices: devicesByStation.get(s.id) ?? [],
    };
    const arr = stationsByLine.get(s.lineId);
    if (arr) arr.push(node);
    else stationsByLine.set(s.lineId, [node]);
  }
  return {
    factory: inputs.factory,
    zones: inputs.zones.map((z) => ({
      id: `zone:${z.id}`,
      refId: z.id,
      code: z.code,
      name: z.name,
      zoneType: z.zoneType,
      maxConcurrentRobots: z.maxConcurrentRobots,
      bounds: z.bounds ?? null,
    })),
    lines: inputs.lines.map((l) => ({
      id: `line:${l.id}`,
      refId: l.id,
      code: l.code,
      name: l.name,
      workshopId: l.workshopId,
      stations: stationsByLine.get(l.id) ?? [],
    })),
    devices,
    ts: Date.now(),
  };
}
