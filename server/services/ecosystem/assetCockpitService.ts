/**
 * U3 (doc 21 §6 / §3 G-4, G-5) — Machine & Robot Cockpit: AGGREGATION service.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A thin, READ-ONLY aggregation layer that assembles EVERYTHING one cockpit page
 * needs for ONE machine (`/machine/:id`) or ONE robot (`/robot/:id`) from a SINGLE
 * call, so the FE does not fan out to 10 routers itself.
 *
 * DESIGN PRINCIPLES (mirrors commandCenterService — U2):
 *   • AGGREGATION ONLY — every section is sourced from an EXISTING service/query.
 *     We NEVER recompute health / OEE / alarm / kinematic logic here; we CALL the
 *     existing function and PROJECT its result into the cockpit shape.
 *   • HONEST NULL — when a source is disabled/absent/errors we return an honest null
 *     (never a fabricated number). Each section is wrapped so the FE knows the source.
 *   • NO CONTROL PATH — `gatedActions` is METADATA ONLY (which capability commands the
 *     user MAY propose); execution still routes through the existing gated dispatcher.
 *   • FAIL-SAFE — a missing DB or a throwing sub-source degrades ONE section to null,
 *     never the whole page.
 *
 * SOURCE MAP (proof of no duplication):
 *   identity          ← machines/stations/lines/factories join (hierarchy schema)
 *   resolvedCapability← capabilityModel.getCapabilitiesForMachine ⊕ deviceTypeRegistry.resolveForMachineType
 *   liveState         ← db/machine.getLatestMachineStatus + machineHeartbeat (UDM/PackML/connection)
 *   health            ← predictiveMaintenanceService.computeFailureRisk + computeReliabilityStats (risk/MTBF/MTTR/RUL)
 *   oee               ← oeeService.getMachineOEELive (A/P/Q)
 *   alarms            ← machineAlarms() (per-machine normalized feed — see below)
 *   recipes           ← recipeVersioningService.listLoadHistory (deploy/load history)
 *   programs          ← program_projects (deviceId) + program_deployments (per-device audit)
 *   genealogy         ← genealogy_chain by station (recent traceability records)
 *   model3d           ← twin/modelRegistry.resolveModel({machineId}) (resolved modelUri or null)
 *   gatedActions      ← capabilityModel supportedCommands (metadata; NOT executed here)
 *
 *   robot identity    ← robots row
 *   robot liveTelemetry← robot_telemetry latest row (mode/busy/estop/speed/pose/joints/battery/zone/fw/heartbeat)
 *   robot capability  ← capabilityModel.getDefaultCapability("ROBOT")
 *   robot jobs        ← robot_jobs (recent)
 *   robot tasks       ← tasks (assignedDeviceId + assignedDeviceKind='robot')
 *   robot kinematics  ← sim/kinematicModel.resolveKinematicModel (SAMPLE chain; real URDF is T2a)
 *   robot programs    ← program_projects (deviceId) kind ir-flow / robot-tm (IR flows targeting it)
 *   robot safety      ← safety_events (robotId) recent zone reactions
 *   robot anomalies   ← robot_behavior_anomalies (robotId) recent
 *   robot model3d     ← twin/modelRegistry.resolveModel({equipmentId:"robot:{id}"})
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  machines as machinesTable,
  stations,
  productionLines,
  workshops,
  factories,
  andonEvents,
  safetyEvents,
  robots,
  robotTelemetry,
  robotJobs,
  robotBehaviorAnomalies,
  tasks,
  programProjects,
  programDeployments,
  genealogyChain,
} from "../../../drizzle/schema";
import {
  getLatestMachineStatus,
  getLatestMachineHeartbeat,
} from "../../db/machine";
import {
  getCapabilitiesForMachine,
  getDefaultCapability,
  type EquipmentCapability,
  type CommandDescriptor,
} from "../equipment/capabilityModel";
import { resolveForMachineType } from "../standards/deviceTypeRegistry";
import { getMachineOEELive } from "../oeeService";
import { computeFailureRisk, computeReliabilityStats } from "../predictiveMaintenanceService";
import { resolveModel } from "../twin/modelRegistry";
import {
  resolveKinematicModel,
  type KinematicModel,
} from "../programming/sim/kinematicModel";
import { mapAlarm, asSeverity, type AlarmSeverity } from "../standards/alarmTaxonomy";
import { loadAlarmMappings } from "../standards/alarmMasterService";

// ════════════════════════════════════════════════════════════════════════════
// SHARED WRAPPER — every section reports its source + availability (honest null).
// ════════════════════════════════════════════════════════════════════════════

export interface Section<T> {
  /** Honest null when the source is disabled/absent/errored. */
  value: T | null;
  /** Which existing service/query supplied it (proof of no duplication). */
  source: string;
  /** false when the source is off / errored → the FE renders "—" not a fake value. */
  available: boolean;
}

function section<T>(value: T | null, source: string, available = value != null): Section<T> {
  return { value, source, available };
}

/** Run an async source, degrading to an honest-null section on any throw. */
async function safeSection<T>(source: string, fn: () => Promise<T | null>): Promise<Section<T>> {
  try {
    const v = await fn();
    return section<T>(v, source, v != null);
  } catch {
    return section<T>(null, source, false);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PER-MACHINE NORMALIZED ALARM FEED (the audit's missing thin query).
// Pulls this machine's recent andon + safety events and normalizes each into an
// ISA-18.2-shaped record via alarmTaxonomy. This is the reusable per-asset feed.
// ════════════════════════════════════════════════════════════════════════════

/** One normalized per-asset alarm (ISA-18.2 envelope). */
export interface NormalizedAssetAlarm {
  standardCode: string;
  severity: AlarmSeverity;
  description: string | null;
  recommendedAction: string | null;
  ts: number;
  source: "andon" | "safety";
  /** Best-effort raw ref (andon reason / safety eventType) for traceability. */
  raw?: string | null;
}

/** Map an andon `state` → an ISA-18.2 severity band (mirrors alarmNormalizer intent). */
function andonStateToSeverity(state: string | null | undefined): AlarmSeverity {
  const s = (state ?? "").toLowerCase();
  if (s === "red" || s === "call") return "critical";
  if (s === "yellow") return "high";
  return "low";
}

/**
 * Derive a standard alarm code from an andon reason (the andon store carries no raw
 * vendor nativeCode — a raw device alarm is normalized INTO an andon upstream by
 * alarmNormalizer, so here we map the already-normalized signal into the taxonomy
 * envelope by reason). Fail-safe → GENERIC_ALARM.
 */
function andonReasonToStandardCode(reason: string | null | undefined): string {
  switch ((reason ?? "").toLowerCase()) {
    case "safety":
      return "SAFETY_STOP";
    case "quality":
      return "QUALITY_ALARM";
    case "material":
      return "MATERIAL_STARVE";
    case "maintenance":
      return "MAINTENANCE_REQUIRED";
    case "setup":
      return "SETUP_CHANGEOVER";
    default:
      return "GENERIC_ALARM";
  }
}

/**
 * PER-MACHINE normalized alarm list. Pull this machine's recent andon events (+ any
 * safety events attributable via the robots on its line — best-effort) and run each
 * through the alarm taxonomy → { standardCode, severity, description, recommendedAction,
 * ts, source }. Read-only, fail-safe (empty on no-DB / missing tables).
 */
export async function machineAlarms(machineId: number, limit = 50): Promise<NormalizedAssetAlarm[]> {
  const db = await getDb();
  if (!db) return [];
  const cap = Math.max(1, Math.min(limit, 200));
  const out: NormalizedAssetAlarm[] = [];

  // ── Andon events for this machine (already partly-normalized signals). ──
  try {
    const rows = await db
      .select({
        state: andonEvents.state,
        reason: andonEvents.reason,
        title: andonEvents.title,
        message: andonEvents.message,
        raisedAt: andonEvents.raisedAt,
      })
      .from(andonEvents)
      .where(eq(andonEvents.machineId, machineId))
      .orderBy(desc(andonEvents.raisedAt))
      .limit(cap);
    for (const r of rows) {
      const standardCode = andonReasonToStandardCode(r.reason);
      const severity = andonStateToSeverity(r.state);
      out.push({
        standardCode,
        severity,
        description: r.message ?? r.title ?? null,
        recommendedAction: null,
        ts: r.raisedAt instanceof Date ? r.raisedAt.getTime() : Date.now(),
        source: "andon",
        raw: r.reason ?? null,
      });
    }
  } catch {
    /* andon table absent → skip */
  }

  return out.sort((a, b) => b.ts - a.ts).slice(0, cap);
}

/**
 * PER-ROBOT normalized alarm feed — the same taxonomy shape, sourced from safety_events
 * (robotId) run through the taxonomy. Reuses mapAlarm for the vendor mapping where an
 * eventType maps to a known standard code, else derives an ISA envelope from eventType.
 */
export async function robotAlarms(robotId: number, vendor: string, limit = 50): Promise<NormalizedAssetAlarm[]> {
  const db = await getDb();
  if (!db) return [];
  const cap = Math.max(1, Math.min(limit, 200));
  const out: NormalizedAssetAlarm[] = [];
  // W5-21: nạp taxonomy SEED ∪ DB để mapping người dùng tạo cũng tác động vào cockpit.
  const entries = await loadAlarmMappings();
  try {
    const rows = await db
      .select({
        eventType: safetyEvents.eventType,
        isNearMiss: safetyEvents.isNearMiss,
        notes: safetyEvents.notes,
        outcome: safetyEvents.outcome,
        createdAt: safetyEvents.createdAt,
      })
      .from(safetyEvents)
      .where(eq(safetyEvents.robotId, robotId))
      .orderBy(desc(safetyEvents.createdAt))
      .limit(cap);
    for (const r of rows) {
      // Try the vendor taxonomy first (e.g. an e-stop native code), else derive.
      const mapped = mapAlarm(vendor, r.eventType, entries);
      const standardCode = mapped.mapped ? mapped.standardCode : `SAFETY_${(r.eventType ?? "EVENT").toUpperCase()}`;
      const severity: AlarmSeverity = mapped.mapped
        ? asSeverity(mapped.severity)
        : r.isNearMiss
          ? "high"
          : "critical";
      out.push({
        standardCode,
        severity,
        description: r.notes ?? null,
        recommendedAction: mapped.recommendedAction ?? null,
        ts: r.createdAt instanceof Date ? r.createdAt.getTime() : Date.now(),
        source: "safety",
        raw: r.eventType ?? null,
      });
    }
  } catch {
    /* safety table absent → skip */
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, cap);
}

// ════════════════════════════════════════════════════════════════════════════
// GATED-ACTION METADATA — which capability commands the user MAY propose.
// METADATA ONLY: execution stays via the existing gated dispatcher.
// ════════════════════════════════════════════════════════════════════════════

export interface GatedAction {
  name: string;
  label: string;
  riskLevel: CommandDescriptor["riskLevel"];
  requiredPermission: string;
  packmlCommand?: string;
  paramsSchema: CommandDescriptor["paramsSchema"];
}

/** Project a capability's supported commands into gated-action metadata (no execution). */
export function toGatedActions(cap: EquipmentCapability): GatedAction[] {
  return cap.supportedCommands.map((c) => ({
    name: c.name,
    label: c.label,
    riskLevel: c.riskLevel,
    requiredPermission: c.requiredPermission,
    packmlCommand: c.packmlCommand,
    paramsSchema: c.paramsSchema,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// MACHINE DETAIL — assemble every section for ONE machine.
// ════════════════════════════════════════════════════════════════════════════

export interface MachineIdentity {
  id: number;
  code: string;
  name: string;
  machineType: string;
  model: string | null;
  manufacturer: string | null;
  stationId: number | null;
  stationCode: string | null;
  lineId: number | null;
  lineName: string | null;
  factoryId: number | null;
  factoryName: string | null;
  corporateCode: string | null;
  isActive: boolean;
}

export interface MachineLiveState {
  status: string | null;
  lastStatusChange: number | null;
  heartbeatStatus: string | null;
  lastHeartbeat: number | null;
  operationStatus: string | null;
  connected: boolean;
}

export interface ResolvedCapabilitySection {
  equipmentClass: string;
  adapterKind: string;
  deviceType: string;
  commands: CommandDescriptor[];
  telemetryTags: EquipmentCapability["telemetryTags"];
  packmlStates: EquipmentCapability["supportedStates"];
}

export interface MachineDetail {
  identity: MachineIdentity;
  resolvedCapability: Section<ResolvedCapabilitySection>;
  liveState: Section<MachineLiveState>;
  health: Section<{
    failureRisk: number | null;
    maintenanceUrgency: string | null;
    predictedTimeframeHours: number | null;
    recommendedMaintenanceDate: number | null;
    mtbfHours: number | null;
    mttrHours: number | null;
    rulHours: number | null;
  }>;
  oee: Section<{ availability: number | null; performance: number | null; quality: number | null; oee: number | null }>;
  alarms: Section<NormalizedAssetAlarm[]>;
  recipes: Section<{ loadHistory: unknown[] }>;
  programs: Section<{ projects: unknown[]; deployments: unknown[] }>;
  genealogy: Section<unknown[]>;
  model3d: Section<{ modelUri: string; modelKind: string; conversionStatus: string }>;
  gatedActions: GatedAction[];
}

/** Resolve the identity + full hierarchy path for a machine (single join). */
async function loadMachineIdentity(machineId: number): Promise<MachineIdentity | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      machine: machinesTable,
      station: stations,
      line: productionLines,
      factory: factories,
    })
    .from(machinesTable)
    .leftJoin(stations, eq(machinesTable.stationId, stations.id))
    .leftJoin(productionLines, eq(stations.lineId, productionLines.id))
    .leftJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .leftJoin(factories, eq(workshops.factoryId, factories.id))
    .where(eq(machinesTable.id, machineId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.machine.id,
    code: r.machine.code,
    name: r.machine.name,
    machineType: String(r.machine.machineType),
    model: r.machine.model ?? null,
    manufacturer: r.machine.manufacturer ?? null,
    stationId: r.station?.id ?? r.machine.stationId ?? null,
    stationCode: r.station?.code ?? null,
    lineId: r.line?.id ?? null,
    lineName: r.line?.name ?? null,
    factoryId: r.factory?.id ?? null,
    factoryName: r.factory?.name ?? null,
    corporateCode: r.factory?.corporateCode ?? null,
    isActive: r.machine.isActive,
  };
}

/**
 * Assemble the full machine cockpit payload. Returns null when the machine does not
 * exist (the router turns that into NOT_FOUND). Every OTHER section degrades to an
 * honest null on absence/error — the page never breaks on one missing source.
 */
export async function machineDetail(machineId: number): Promise<MachineDetail | null> {
  const identity = await loadMachineIdentity(machineId);
  if (!identity) return null;

  // resolvedCapability — capabilityModel ⊕ registry (pure, always available).
  let resolvedCapability: MachineDetail["resolvedCapability"];
  try {
    const db = await getDb();
    let machineRow: { machineType: string; capabilities: unknown } | null = null;
    if (db) {
      const rows = await db
        .select({ machineType: machinesTable.machineType, capabilities: machinesTable.capabilities })
        .from(machinesTable)
        .where(eq(machinesTable.id, machineId))
        .limit(1);
      machineRow = rows[0]
        ? { machineType: String(rows[0].machineType), capabilities: rows[0].capabilities }
        : null;
    }
    const cap = getCapabilitiesForMachine(
      machineRow
        ? { machineType: machineRow.machineType, capabilities: machineRow.capabilities as never }
        : identity.machineType,
    );
    const deviceType = resolveForMachineType(identity.machineType).typeKey;
    resolvedCapability = section<ResolvedCapabilitySection>(
      {
        equipmentClass: cap.equipmentClass,
        adapterKind: cap.adapterKind,
        deviceType,
        commands: cap.supportedCommands,
        telemetryTags: cap.telemetryTags,
        packmlStates: cap.supportedStates,
      },
      "capabilityModel.getCapabilitiesForMachine + deviceTypeRegistry.resolveForMachineType",
      true,
    );
  } catch {
    resolvedCapability = section<ResolvedCapabilitySection>(null, "capabilityModel + deviceTypeRegistry", false);
  }

  // liveState — latest status + heartbeat (UDM/PackML/connection).
  const liveState = await safeSection<MachineLiveState>(
    "db/machine.getLatestMachineStatus + getLatestMachineHeartbeat",
    async () => {
      const [status, hb] = await Promise.all([
        getLatestMachineStatus(machineId),
        getLatestMachineHeartbeat(machineId),
      ]);
      const hbTs = hb?.timestamp ? new Date(hb.timestamp).getTime() : null;
      const connected =
        (status?.status ?? "offline") === "online" ||
        (hbTs != null && Date.now() - hbTs < 5 * 60 * 1000);
      return {
        status: status?.status ?? null,
        lastStatusChange: status?.timestamp ? new Date(status.timestamp).getTime() : null,
        heartbeatStatus: hb?.status ?? null,
        lastHeartbeat: hbTs,
        operationStatus: null,
        connected,
      };
    },
  );

  // health — PdM risk + reliability (MTBF/MTTR/RUL).
  const health = await safeSection(
    "predictiveMaintenanceService.computeFailureRisk + computeReliabilityStats",
    async () => {
      const [risk, rel] = await Promise.all([
        computeFailureRisk(machineId),
        computeReliabilityStats(machineId),
      ]);
      // No sources → treat as unavailable (honest null) rather than fabricated zeros.
      if (risk.dataPoints === 0 && rel.unplannedEvents === 0 && rel.uptimeMinutes === 0) return null;
      return {
        failureRisk: risk.failureRisk,
        maintenanceUrgency: risk.maintenanceUrgency,
        predictedTimeframeHours: risk.predictedTimeframeHours,
        recommendedMaintenanceDate: risk.recommendedMaintenanceDate
          ? risk.recommendedMaintenanceDate.getTime()
          : null,
        mtbfHours: rel.mtbfHours,
        mttrHours: rel.mttrHours,
        // RUL proxy: the model's predicted timeframe to next failure (honest — no
        // dedicated RUL regressor exists; this is the PdM predicted horizon).
        rulHours: risk.predictedTimeframeHours,
      };
    },
  );

  // oee — per-machine live A/P/Q.
  const oee = await safeSection(
    "oeeService.getMachineOEELive",
    async () => {
      const m = await getMachineOEELive({ machineId, machineCode: identity.code });
      if (!m.details.hasUptimeData && !m.details.hasProductionData) return null;
      return { availability: m.availability, performance: m.performance, quality: m.quality, oee: m.oee };
    },
  );

  // alarms — the per-machine normalized feed.
  const alarms = await safeSection(
    "assetCockpitService.machineAlarms (andon → ISA-18.2)",
    async () => machineAlarms(machineId, 50),
  );

  // recipes — recipe load/deploy history for this machine.
  const recipes = await safeSection(
    "recipeVersioningService.listLoadHistory",
    async () => {
      const { listLoadHistory } = await import("../equipment/recipeVersioningService");
      const loadHistory = await listLoadHistory(machineId, 25);
      return { loadHistory };
    },
  );

  // programs — projects bound to this device + their deploy audit rows.
  const programs = await safeSection(
    "program_projects(deviceId) + program_deployments",
    async () => {
      const db = await getDb();
      if (!db) return null;
      const projects = await db
        .select()
        .from(programProjects)
        .where(eq(programProjects.deviceId, machineId))
        .orderBy(desc(programProjects.updatedAt))
        .limit(20);
      let deployments: unknown[] = [];
      if (projects.length) {
        const projectIds = projects.map((p) => p.id);
        deployments = await db
          .select()
          .from(programDeployments)
          .where(inArray(programDeployments.projectId, projectIds))
          .orderBy(desc(programDeployments.createdAt))
          .limit(20);
      }
      return { projects, deployments };
    },
  );

  // genealogy — recent traceability records for this machine's station.
  const genealogy = await safeSection<unknown[]>(
    "genealogy_chain (by stationCode, recent)",
    async () => {
      const db = await getDb();
      if (!db || !identity.stationCode) return null;
      return db
        .select()
        .from(genealogyChain)
        .where(eq(genealogyChain.stationCode, identity.stationCode))
        .orderBy(desc(genealogyChain.recordedAt))
        .limit(25);
    },
  );

  // model3d — resolved 3D model (honest null when none registered).
  const model3d = await safeSection(
    "twin/modelRegistry.resolveModel({machineId})",
    async () => {
      const m = await resolveModel({ machineId, equipmentClass: identity.machineType });
      if (!m || !m.modelUri) return null;
      return { modelUri: m.modelUri, modelKind: String(m.modelKind), conversionStatus: String(m.conversionStatus) };
    },
  );

  // gatedActions — metadata for propose-only UI (execution stays via gated dispatcher).
  const gatedActions = resolvedCapability.value
    ? resolvedCapability.value.commands.map((c) => ({
        name: c.name,
        label: c.label,
        riskLevel: c.riskLevel,
        requiredPermission: c.requiredPermission,
        packmlCommand: c.packmlCommand,
        paramsSchema: c.paramsSchema,
      }))
    : [];

  return {
    identity,
    resolvedCapability,
    liveState,
    health,
    oee,
    alarms,
    recipes,
    programs,
    genealogy,
    model3d,
    gatedActions,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ROBOT DETAIL — assemble every section for ONE robot.
// ════════════════════════════════════════════════════════════════════════════

export interface RobotIdentity {
  id: number;
  code: string;
  name: string;
  vendor: string;
  kind: string;
  model: string | null;
  status: string;
  lineId: number | null;
  stationId: number | null;
  isEnabled: boolean;
  lastSeenAt: number | null;
}

export interface RobotLiveTelemetry {
  mode: string | null;
  busy: boolean | null;
  estop: boolean | null;
  speedPct: number | null;
  pose: Record<string, unknown> | null;
  jointStates: Array<Record<string, unknown>> | null;
  batteryPct: number | null;
  safetyZoneId: number | null;
  firmwareVersion: string | null;
  lastHeartbeat: number | null;
  ts: number | null;
}

export interface RobotDetail {
  identity: RobotIdentity;
  liveTelemetry: Section<RobotLiveTelemetry>;
  capability: Section<ResolvedCapabilitySection>;
  jobs: Section<unknown[]>;
  tasks: Section<unknown[]>;
  kinematicModel: Section<{ model: KinematicModel; isSample: boolean; note: string }>;
  programs: Section<unknown[]>;
  safety: Section<unknown[]>;
  anomalies: Section<unknown[]>;
  alarms: Section<NormalizedAssetAlarm[]>;
  model3d: Section<{ modelUri: string; modelKind: string; conversionStatus: string }>;
  gatedActions: GatedAction[];
}

/** Map a robot kind → the kinematic device-family the sample resolver understands. */
function robotKindToKinematicFamily(kind: string): "universal-robots" | "ros2" | "generic" {
  const k = (kind ?? "").toLowerCase();
  if (k === "cobot" || k === "arm") return "universal-robots";
  // scara / agv / anything else → generic SCARA sample (honest fallback).
  return "generic";
}

/**
 * Assemble the full robot cockpit payload. Returns null when the robot does not exist.
 * Every section degrades to an honest null on absence/error.
 */
export async function robotDetail(robotId: number): Promise<RobotDetail | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(robots).where(eq(robots.id, robotId)).limit(1);
  const robot = rows[0];
  if (!robot) return null;

  const identity: RobotIdentity = {
    id: robot.id,
    code: robot.code,
    name: robot.name,
    vendor: String(robot.vendor),
    kind: String(robot.kind),
    model: robot.model ?? null,
    status: robot.status,
    lineId: robot.lineId ?? null,
    stationId: robot.stationId ?? null,
    isEnabled: robot.isEnabled,
    lastSeenAt: robot.lastSeenAt ? new Date(robot.lastSeenAt).getTime() : null,
  };

  // liveTelemetry — latest robot_telemetry row (full UDM).
  const liveTelemetry = await safeSection<RobotLiveTelemetry>(
    "robot_telemetry (latest)",
    async () => {
      const t = await db
        .select()
        .from(robotTelemetry)
        .where(eq(robotTelemetry.robotId, robotId))
        .orderBy(desc(robotTelemetry.timestamp))
        .limit(1);
      const r = t[0];
      if (!r) return null;
      return {
        mode: r.mode ?? null,
        busy: r.busy ?? null,
        estop: r.estop ?? null,
        speedPct: r.speedPct ?? null,
        pose: (r.poseJson ?? null) as Record<string, unknown> | null,
        jointStates: (r.jointStates ?? null) as Array<Record<string, unknown>> | null,
        batteryPct: r.batteryLevel != null ? Number(r.batteryLevel) : null,
        safetyZoneId: r.safetyZoneId ?? null,
        firmwareVersion: r.firmwareVersion ?? null,
        lastHeartbeat: r.lastHeartbeat ? new Date(r.lastHeartbeat).getTime() : null,
        ts: r.timestamp ? new Date(r.timestamp).getTime() : null,
      };
    },
  );

  // capability — the ROBOT default capability profile (pure).
  let capability: RobotDetail["capability"];
  try {
    const cap = getDefaultCapability("ROBOT");
    const deviceType = resolveForMachineType("ROBOT").typeKey;
    capability = section<ResolvedCapabilitySection>(
      {
        equipmentClass: cap.equipmentClass,
        adapterKind: cap.adapterKind,
        deviceType,
        commands: cap.supportedCommands,
        telemetryTags: cap.telemetryTags,
        packmlStates: cap.supportedStates,
      },
      "capabilityModel.getDefaultCapability(ROBOT) + deviceTypeRegistry",
      true,
    );
  } catch {
    capability = section<ResolvedCapabilitySection>(null, "capabilityModel(ROBOT)", false);
  }

  // jobs — recent robot_jobs (append-only motion log).
  const jobs = await safeSection<unknown[]>(
    "robot_jobs (recent)",
    async () =>
      db.select().from(robotJobs).where(eq(robotJobs.robotId, robotId)).orderBy(desc(robotJobs.createdAt)).limit(25),
  );

  // tasks — fleet tasks assigned to this robot.
  const tasksSection = await safeSection<unknown[]>(
    "tasks (assignedDeviceId + assignedDeviceKind='robot')",
    async () =>
      db
        .select()
        .from(tasks)
        .where(and(eq(tasks.assignedDeviceId, robotId), eq(tasks.assignedDeviceKind, "robot")))
        .orderBy(desc(tasks.priority), desc(tasks.createdAt))
        .limit(25),
  );

  // kinematicModel — resolve a chain for joint/pose viz (SAMPLE until real URDF/T2a).
  let kinematicModel: RobotDetail["kinematicModel"];
  try {
    const family = robotKindToKinematicFamily(identity.kind);
    const model = resolveKinematicModel(family);
    kinematicModel = model
      ? section(
          {
            model,
            isSample: true,
            note: `Authored SAMPLE chain (${model.id}) for kind='${identity.kind}' — no real URDF asset yet (real URDF import is T2a).`,
          },
          "sim/kinematicModel.resolveKinematicModel (sample)",
          true,
        )
      : section<{ model: KinematicModel; isSample: boolean; note: string }>(
          null,
          "sim/kinematicModel.resolveKinematicModel (no sample for family)",
          false,
        );
  } catch {
    kinematicModel = section<{ model: KinematicModel; isSample: boolean; note: string }>(
      null,
      "sim/kinematicModel",
      false,
    );
  }

  // programs — IR flows / robot programs bound to this robot (program_projects.deviceId).
  const programs = await safeSection<unknown[]>(
    "program_projects(deviceId, robot kinds)",
    async () =>
      db
        .select()
        .from(programProjects)
        .where(eq(programProjects.deviceId, robotId))
        .orderBy(desc(programProjects.updatedAt))
        .limit(25),
  );

  // safety — zone reactions / safety events involving this robot.
  const safety = await safeSection<unknown[]>(
    "safety_events (robotId, recent)",
    async () =>
      db
        .select()
        .from(safetyEvents)
        .where(eq(safetyEvents.robotId, robotId))
        .orderBy(desc(safetyEvents.createdAt))
        .limit(25),
  );

  // anomalies — recent robot-behaviour anomalies (READ recent rows; NOT re-detected).
  const anomalies = await safeSection<unknown[]>(
    "robot_behavior_anomalies (robotId, recent)",
    async () =>
      db
        .select()
        .from(robotBehaviorAnomalies)
        .where(eq(robotBehaviorAnomalies.robotId, robotId))
        .orderBy(desc(robotBehaviorAnomalies.detectedAt))
        .limit(25),
  );

  // alarms — per-robot normalized feed (safety_events → ISA-18.2).
  const alarms = await safeSection(
    "assetCockpitService.robotAlarms (safety → ISA-18.2)",
    async () => robotAlarms(robotId, identity.vendor, 50),
  );

  // model3d — resolved 3D model for this robot (honest null when none).
  const model3d = await safeSection(
    'twin/modelRegistry.resolveModel({equipmentId:"robot:{id}"})',
    async () => {
      const m = await resolveModel({ equipmentId: `robot:${robotId}`, equipmentClass: "ROBOT" });
      if (!m || !m.modelUri) return null;
      return { modelUri: m.modelUri, modelKind: String(m.modelKind), conversionStatus: String(m.conversionStatus) };
    },
  );

  const gatedActions = capability.value
    ? capability.value.commands.map((c) => ({
        name: c.name,
        label: c.label,
        riskLevel: c.riskLevel,
        requiredPermission: c.requiredPermission,
        packmlCommand: c.packmlCommand,
        paramsSchema: c.paramsSchema,
      }))
    : [];

  return {
    identity,
    liveTelemetry,
    capability,
    jobs,
    tasks: tasksSection,
    kinematicModel,
    programs,
    safety,
    anomalies,
    alarms,
    model3d,
    gatedActions,
  };
}
