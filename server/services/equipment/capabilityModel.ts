/**
 * Phase E0 — Factory Control Plane: EQUIPMENT CAPABILITY MODEL.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The canonical "Capability Contract" every machine exposes, REGARDLESS of vendor
 * or protocol: a typed set of {commands, params, telemetry, PackML states}. The
 * Unified API (E1) and Orchestration Engine (E2) program against THIS shape, not
 * against per-vendor drivers (docs/ECOSYSTEM/08 Part B trụ cột #1).
 *
 * It is DERIVED from what the existing write-tools/drivers already support:
 *   • command names mirror writeHandlers/machineControl.ts (start/stop/pause/
 *     reset/select_recipe/set_param/ack_alarm), the OT read/write tag path, the
 *     RobotDriver job verbs (move/pick_place/home/abort) and the vision ingest.
 *   • riskLevel + requiredPermission mirror the dispatcher's RBAC gates
 *     (machine_control/canCreate for high-risk, /canView for reads).
 *
 * RESOLUTION: a per-machineType DEFAULT profile, MERGED with the per-machine
 * `machines.capabilities` jsonb override (additive flags toggle commands/telemetry
 * on). Fail-safe: an unknown machineType → a minimal read-only profile, never throws.
 *
 * NO side-effects, NO control path. This module only DESCRIBES capability.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { PackmlState } from "./packml";
import type { MachineCapabilities } from "../../../drizzle/schema/hierarchy";
import { deriveCapabilityFromSpecs, type CompanionSpecId } from "./companionSpecs";

/** The machineType values (mirror drizzle machineTypeEnum). */
export type EquipmentClass =
  | "AVI"
  | "AOI"
  | "SPI"
  | "AXI"
  | "ICT"
  | "FCT"
  | "CMM"
  | "AUTOMATION"
  | "FEEDER"
  | "ASSEMBLY"
  | "SCREWDRIVE"
  | "DISPENSING"
  | "ICT_FUNC"
  | "ROBOT_TEST"
  | "PACKAGING"
  | "PALLETIZER"
  | "ROBOT"
  // ── doc 40 W5 (MTX-03) — SMT line machine classes ──
  | "MOUNTER"
  | "REFLOW"
  | "STENCIL_PRINTER"
  | "WAVE_SOLDER";

/**
 * How the unified EquipmentAdapter facade reaches the real driver/registry for a
 * machine. Maps 1:1 onto an existing registry (no new protocol logic) — see
 * equipmentAdapter.ts.
 */
export type AdapterKind =
  | "ot-opcua"
  | "ot-modbus"
  | "ot-s7"
  | "ot-mitsubishi-mc"
  | "ot-ethernet-ip"
  | "ot-stub"
  | "vision"
  | "robot"
  | "mtconnect"
  | "secsgem"
  | "vda5050"
  // I1 (doc 16 §6 / §15) — multi-vendor equipment integration FRAMEWORKS (flag
  // EQ_INTEG_ENABLED). Read-only monitoring by default; no real device attached.
  | "focas" // Fanuc CNC (FOCAS): NC functions / cycle count / alarms.
  | "euromap"; // Injection molding (Euromap 63/77/83): cycle / shot data / alarms.

/** Risk band of a command — drives HITL gating + RBAC (mirrors the dispatcher). */
export type RiskLevel = "read" | "low" | "high";

/** Logical data type of a telemetry value or a command parameter. */
export type CapabilityDataType = "bool" | "int" | "float" | "string" | "json" | "enum";

/**
 * A JSON-schema-ish descriptor for ONE command parameter. Deliberately a plain
 * data object (not a zod instance) so the whole capability profile is serialisable
 * over tRPC to the UI / Orchestration Studio. A zod schema can be built from this
 * at the call boundary (E1) — see `paramDescriptorToNote`.
 */
export interface ParamDescriptor {
  name: string;
  label: string;
  dataType: CapabilityDataType;
  required?: boolean;
  /** Allowed values for an `enum` dataType. */
  options?: Array<string | number>;
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
}

/**
 * ONE command a piece of equipment supports. `name` is the canonical command verb
 * (== the writeHandlers/robot job verb it routes to). riskLevel + requiredPermission
 * are the HITL/RBAC contract the dispatcher enforces — NOT bypassed here.
 */
export interface CommandDescriptor {
  /** Canonical command verb (e.g. "start", "select_recipe", "move", "read_tag"). */
  name: string;
  label: string;
  /** Parameter contract (empty for nullary commands like start/stop). */
  paramsSchema: ParamDescriptor[];
  /** 'read' (query), 'low' (param/ack edit), 'high' (motion/start/stop). */
  riskLevel: RiskLevel;
  /** RBAC tuple `${module}/${action}` the dispatcher requires (e.g. "machine_control/canCreate"). */
  requiredPermission: string;
  /** Optional PackML command this maps onto (for orchestration state planning). */
  packmlCommand?: string;
}

/** ONE telemetry value the equipment publishes (read-only). */
export interface TelemetryDescriptor {
  /** Canonical telemetry key (e.g. "yield", "ng_count", "mode", "pose"). */
  key: string;
  label: string;
  dataType: CapabilityDataType;
  unit?: string;
}

/** The fully-resolved Capability Contract for a machine / machineType. */
export interface EquipmentCapability {
  equipmentClass: EquipmentClass;
  /** The adapter kind that fulfils control/telemetry for this class (default). */
  adapterKind: AdapterKind;
  supportedCommands: CommandDescriptor[];
  telemetryTags: TelemetryDescriptor[];
  /** The PackML states this class can occupy (subset of the 17). */
  supportedStates: PackmlState[];
}

// ── reusable command building blocks (derived from writeHandlers/machineControl.ts) ──

const PERM_VIEW = "machine_monitoring/canView";
const PERM_CONTROL = "machine_control/canCreate";
const PERM_PARAM = "machine_control/canEdit";

const CMD_START: CommandDescriptor = {
  name: "start",
  label: "Start",
  paramsSchema: [],
  riskLevel: "high",
  requiredPermission: PERM_CONTROL,
  packmlCommand: "Start",
};
const CMD_STOP: CommandDescriptor = {
  name: "stop",
  label: "Stop",
  paramsSchema: [],
  riskLevel: "high",
  requiredPermission: PERM_CONTROL,
  packmlCommand: "Stop",
};
const CMD_PAUSE: CommandDescriptor = {
  name: "pause",
  label: "Pause / Hold",
  paramsSchema: [],
  riskLevel: "high",
  requiredPermission: PERM_CONTROL,
  packmlCommand: "Hold",
};
const CMD_RESET: CommandDescriptor = {
  name: "reset",
  label: "Reset",
  paramsSchema: [],
  riskLevel: "high",
  requiredPermission: PERM_CONTROL,
  packmlCommand: "Reset",
};
const CMD_ABORT: CommandDescriptor = {
  name: "abort",
  label: "Abort",
  paramsSchema: [],
  riskLevel: "high",
  requiredPermission: PERM_CONTROL,
  packmlCommand: "Abort",
};
const CMD_SELECT_RECIPE: CommandDescriptor = {
  name: "select_recipe",
  label: "Select recipe",
  paramsSchema: [
    { name: "recipeCode", label: "Recipe code", dataType: "string", required: true },
  ],
  riskLevel: "high",
  requiredPermission: PERM_CONTROL,
};
const CMD_SET_PARAM: CommandDescriptor = {
  name: "set_machine_param",
  label: "Set parameter",
  paramsSchema: [
    { name: "paramKey", label: "Parameter key", dataType: "string", required: true },
    { name: "paramValue", label: "Value", dataType: "string", required: true },
  ],
  riskLevel: "low",
  requiredPermission: PERM_PARAM,
};
const CMD_ACK_ALARM: CommandDescriptor = {
  name: "acknowledge_machine_alarm",
  label: "Acknowledge alarm",
  paramsSchema: [],
  riskLevel: "low",
  requiredPermission: PERM_PARAM,
};
const CMD_READ_TAG: CommandDescriptor = {
  name: "read_tag",
  label: "Read tag",
  paramsSchema: [{ name: "tagKey", label: "Tag key", dataType: "string", required: true }],
  riskLevel: "read",
  requiredPermission: PERM_VIEW,
};
const CMD_WRITE_TAG: CommandDescriptor = {
  name: "write_tag",
  label: "Write tag",
  paramsSchema: [
    { name: "tagKey", label: "Tag key", dataType: "string", required: true },
    { name: "value", label: "Value", dataType: "string", required: true },
  ],
  riskLevel: "high",
  requiredPermission: PERM_CONTROL,
};
// robot job verbs (mirror RobotDriver RobotJobType + robotCommandDispatcher)
const CMD_ROBOT_RUNJOB: CommandDescriptor = {
  name: "run_job",
  label: "Run robot job",
  paramsSchema: [
    {
      name: "jobType",
      label: "Job type",
      dataType: "enum",
      required: true,
      options: ["move", "pick_place", "dispense", "screw", "home", "abort", "custom"],
    },
  ],
  riskLevel: "high",
  requiredPermission: PERM_CONTROL,
  packmlCommand: "Start",
};
const CMD_ROBOT_ABORT: CommandDescriptor = {
  name: "abort",
  label: "Abort robot",
  paramsSchema: [],
  riskLevel: "high",
  requiredPermission: PERM_CONTROL,
  packmlCommand: "Abort",
};
// X1-e (doc 16 §5) — STANDARDIZED e-stop command descriptor. A high-risk command that
// declares the RBAC permission the dispatcher enforces (under FIELD_V2_ENABLED). This
// DESCRIBES the e-stop contract only; it opens NO new control path — an actual e-stop
// still routes through the existing gated dispatcher (and, per doc 16 §8, a real
// hardware-rated stop is the Safety PLC's job, deferred to S2). The command verb maps
// to the robot 'abort' job at the dispatcher boundary.
export const CMD_ESTOP: CommandDescriptor = {
  name: "e_stop",
  label: "Emergency stop",
  paramsSchema: [],
  riskLevel: "high",
  requiredPermission: PERM_CONTROL,
  packmlCommand: "Abort",
};

// ── reusable telemetry building blocks ──
const T_YIELD: TelemetryDescriptor = { key: "yield", label: "Yield %", dataType: "float", unit: "%" };
const T_NG: TelemetryDescriptor = { key: "ng_count", label: "NG count", dataType: "int" };
const T_OK: TelemetryDescriptor = { key: "ok_count", label: "OK count", dataType: "int" };
const T_CYCLE: TelemetryDescriptor = { key: "cycle_time", label: "Cycle time", dataType: "float", unit: "s" };
const T_STATE: TelemetryDescriptor = { key: "state", label: "PackML state", dataType: "string" };
const T_MODE: TelemetryDescriptor = { key: "mode", label: "Mode", dataType: "string" };
const T_POSE: TelemetryDescriptor = { key: "pose", label: "Pose", dataType: "json" };
const T_ESTOP: TelemetryDescriptor = { key: "estop", label: "E-stop", dataType: "bool" };
const T_RESULT: TelemetryDescriptor = { key: "process_result", label: "Process result", dataType: "string" };
const T_TORQUE: TelemetryDescriptor = { key: "torque", label: "Torque", dataType: "float", unit: "Nm" };
const T_VOLUME: TelemetryDescriptor = { key: "dispense_volume", label: "Dispense volume", dataType: "float", unit: "mm3" };
// ── doc 40 W5 (MTX-03) — SMT line telemetry building blocks ──
// Mounter (chip-shooter / pick-and-place): throughput + placement quality.
const T_CPH: TelemetryDescriptor = { key: "cph", label: "Components / hour", dataType: "float", unit: "cph" };
const T_PICKUP_RATE: TelemetryDescriptor = { key: "pickup_rate", label: "Pickup success rate", dataType: "float", unit: "%" };
const T_PLACEMENT: TelemetryDescriptor = { key: "placement_count", label: "Placements", dataType: "int" };
// Reflow oven: per-zone temperatures (json array) + belt speed.
const T_ZONE_TEMPS: TelemetryDescriptor = { key: "zone_temps", label: "Zone temperatures", dataType: "json", unit: "degC" };
const T_CONVEYOR_SPEED: TelemetryDescriptor = { key: "conveyor_speed", label: "Conveyor speed", dataType: "float", unit: "mm/min" };
// Stencil printer: squeegee pressure/speed + print cycle time.
const T_SQUEEGEE_PRESSURE: TelemetryDescriptor = { key: "squeegee_pressure", label: "Squeegee pressure", dataType: "float", unit: "N" };
const T_SQUEEGEE_SPEED: TelemetryDescriptor = { key: "squeegee_speed", label: "Squeegee speed", dataType: "float", unit: "mm/s" };
const T_PRINT_CYCLE: TelemetryDescriptor = { key: "print_cycle_time", label: "Print cycle time", dataType: "float", unit: "s" };
// Wave/selective solder: solder-pot temperature + preheat.
const T_SOLDER_POT_TEMP: TelemetryDescriptor = { key: "solder_pot_temp", label: "Solder pot temp", dataType: "float", unit: "degC" };
const T_PREHEAT_TEMP: TelemetryDescriptor = { key: "preheat_temp", label: "Preheat temp", dataType: "float", unit: "degC" };
// X1-a (doc 16 §5) — UDM/UEM extension telemetry for robots/AMRs. Surfaced on the
// canonical model so the Unified Device Model exposes battery/joint/firmware/zone/
// heartbeat regardless of vendor. battery_level is populated for AGVs (VDA5050);
// joint_states/firmware_version are SEAMS (honest null until a driver provides them).
const T_BATTERY: TelemetryDescriptor = { key: "battery_level", label: "Battery", dataType: "float", unit: "%" };
const T_JOINTS: TelemetryDescriptor = { key: "joint_states", label: "Joint states", dataType: "json" };
const T_SAFETY_ZONE: TelemetryDescriptor = { key: "safety_zone_id", label: "Safety zone", dataType: "int" };
const T_FIRMWARE: TelemetryDescriptor = { key: "firmware_version", label: "Firmware", dataType: "string" };
const T_HEARTBEAT: TelemetryDescriptor = { key: "last_heartbeat", label: "Last heartbeat", dataType: "string" };
/** The shared UDM extension telemetry block for robot/AMR classes (X1-a). */
const UDM_ROBOT_TELEMETRY: TelemetryDescriptor[] = [T_BATTERY, T_JOINTS, T_SAFETY_ZONE, T_FIRMWARE, T_HEARTBEAT];

/** The PackML state set a typical production cell can occupy (the full cube). */
const FULL_STATES: PackmlState[] = [
  "Idle",
  "Starting",
  "Execute",
  "Completing",
  "Complete",
  "Holding",
  "Held",
  "Suspending",
  "Suspended",
  "Unsuspending",
  "Unholding",
  "Aborting",
  "Aborted",
  "Clearing",
  "Stopping",
  "Stopped",
  "Resetting",
];
/** A minimal state set for read-only / simple devices. */
const SIMPLE_STATES: PackmlState[] = ["Idle", "Execute", "Held", "Stopped", "Aborted"];

const INSPECTION_COMMANDS: CommandDescriptor[] = [
  CMD_START,
  CMD_STOP,
  CMD_SELECT_RECIPE,
  CMD_ACK_ALARM,
];
const INSPECTION_TELEMETRY: TelemetryDescriptor[] = [T_YIELD, T_NG, T_OK, T_CYCLE, T_STATE];

const TEST_COMMANDS: CommandDescriptor[] = [CMD_START, CMD_STOP, CMD_RESET, CMD_SELECT_RECIPE, CMD_ACK_ALARM];
const TEST_TELEMETRY: TelemetryDescriptor[] = [T_RESULT, T_NG, T_OK, T_CYCLE, T_STATE];

const AUTOMATION_COMMANDS: CommandDescriptor[] = [
  CMD_START,
  CMD_STOP,
  CMD_PAUSE,
  CMD_RESET,
  CMD_SET_PARAM,
  CMD_ACK_ALARM,
];
const AUTOMATION_TELEMETRY: TelemetryDescriptor[] = [T_RESULT, T_CYCLE, T_STATE, T_MODE];

/**
 * DEFAULT capability profile per machineType — sensible, derived from the existing
 * write-tools / drivers. Override per machine via `machines.capabilities` jsonb.
 *
 * NOTE (U4b): this table is the SEED for the data-driven capability registry below.
 * Every entry is registered via `registerCapabilityProfile` at module load, so
 * resolution reads the registry — this is a behaviour-preserving refactor. A new
 * equipment class registers its profile instead of editing this table (register-and-go).
 */
const DEFAULT_PROFILES: Record<EquipmentClass, EquipmentCapability> = {
  // ── Inspection cells (vision ingest + recipe select) ──
  AOI: { equipmentClass: "AOI", adapterKind: "vision", supportedCommands: INSPECTION_COMMANDS, telemetryTags: INSPECTION_TELEMETRY, supportedStates: FULL_STATES },
  AVI: { equipmentClass: "AVI", adapterKind: "vision", supportedCommands: INSPECTION_COMMANDS, telemetryTags: INSPECTION_TELEMETRY, supportedStates: FULL_STATES },
  SPI: { equipmentClass: "SPI", adapterKind: "vision", supportedCommands: INSPECTION_COMMANDS, telemetryTags: INSPECTION_TELEMETRY, supportedStates: FULL_STATES },
  AXI: { equipmentClass: "AXI", adapterKind: "vision", supportedCommands: INSPECTION_COMMANDS, telemetryTags: INSPECTION_TELEMETRY, supportedStates: FULL_STATES },
  CMM: { equipmentClass: "CMM", adapterKind: "mtconnect", supportedCommands: [CMD_START, CMD_STOP, CMD_SELECT_RECIPE], telemetryTags: [T_RESULT, T_CYCLE, T_STATE], supportedStates: FULL_STATES },

  // ── Electrical test cells (PLC tag control via OT) ──
  ICT: { equipmentClass: "ICT", adapterKind: "ot-opcua", supportedCommands: TEST_COMMANDS, telemetryTags: TEST_TELEMETRY, supportedStates: FULL_STATES },
  FCT: { equipmentClass: "FCT", adapterKind: "ot-opcua", supportedCommands: TEST_COMMANDS, telemetryTags: TEST_TELEMETRY, supportedStates: FULL_STATES },
  ICT_FUNC: { equipmentClass: "ICT_FUNC", adapterKind: "ot-opcua", supportedCommands: TEST_COMMANDS, telemetryTags: TEST_TELEMETRY, supportedStates: FULL_STATES },

  // ── General automation / assembly (PLC tag control) ──
  AUTOMATION: { equipmentClass: "AUTOMATION", adapterKind: "ot-opcua", supportedCommands: [...AUTOMATION_COMMANDS, CMD_READ_TAG, CMD_WRITE_TAG], telemetryTags: AUTOMATION_TELEMETRY, supportedStates: FULL_STATES },
  ASSEMBLY: { equipmentClass: "ASSEMBLY", adapterKind: "ot-opcua", supportedCommands: AUTOMATION_COMMANDS, telemetryTags: AUTOMATION_TELEMETRY, supportedStates: FULL_STATES },
  FEEDER: { equipmentClass: "FEEDER", adapterKind: "ot-modbus", supportedCommands: [CMD_START, CMD_STOP, CMD_ACK_ALARM], telemetryTags: [T_STATE, T_MODE], supportedStates: SIMPLE_STATES },
  SCREWDRIVE: { equipmentClass: "SCREWDRIVE", adapterKind: "ot-opcua", supportedCommands: AUTOMATION_COMMANDS, telemetryTags: [...AUTOMATION_TELEMETRY, T_TORQUE], supportedStates: FULL_STATES },
  DISPENSING: { equipmentClass: "DISPENSING", adapterKind: "ot-opcua", supportedCommands: AUTOMATION_COMMANDS, telemetryTags: [...AUTOMATION_TELEMETRY, T_VOLUME], supportedStates: FULL_STATES },
  PACKAGING: { equipmentClass: "PACKAGING", adapterKind: "ot-opcua", supportedCommands: AUTOMATION_COMMANDS, telemetryTags: AUTOMATION_TELEMETRY, supportedStates: FULL_STATES },

  // ── Robots / AGV (RobotDriver job verbs; ROBOT_TEST is a robotic test cell) ──
  // X1-a — robot classes carry the UDM extension telemetry (battery/joint/firmware/zone/heartbeat).
  ROBOT: { equipmentClass: "ROBOT", adapterKind: "robot", supportedCommands: [CMD_START, CMD_PAUSE, CMD_ROBOT_RUNJOB, CMD_ROBOT_ABORT, CMD_ESTOP], telemetryTags: [T_MODE, T_POSE, T_ESTOP, T_STATE, ...UDM_ROBOT_TELEMETRY], supportedStates: FULL_STATES },
  ROBOT_TEST: { equipmentClass: "ROBOT_TEST", adapterKind: "robot", supportedCommands: [CMD_START, CMD_STOP, CMD_ROBOT_RUNJOB, CMD_ROBOT_ABORT, CMD_ESTOP], telemetryTags: [T_MODE, T_POSE, T_RESULT, T_STATE, ...UDM_ROBOT_TELEMETRY], supportedStates: FULL_STATES },
  PALLETIZER: { equipmentClass: "PALLETIZER", adapterKind: "robot", supportedCommands: [CMD_START, CMD_PAUSE, CMD_ROBOT_RUNJOB, CMD_ROBOT_ABORT, CMD_ESTOP], telemetryTags: [T_MODE, T_POSE, T_ESTOP, T_STATE, ...UDM_ROBOT_TELEMETRY], supportedStates: FULL_STATES },

  // ── doc 40 W5 (MTX-03): SMT line cells (PLC tag control via OT; recipe-driven) ──
  // Mounter (chip-shooter): start/stop/pause/reset/select_recipe/ack; throughput + pickup quality.
  MOUNTER: { equipmentClass: "MOUNTER", adapterKind: "ot-opcua", supportedCommands: [...AUTOMATION_COMMANDS, CMD_SELECT_RECIPE], telemetryTags: [T_STATE, T_MODE, T_CPH, T_PICKUP_RATE, T_PLACEMENT, T_NG, T_CYCLE], supportedStates: FULL_STATES },
  // Reflow oven: recipe (thermal profile) select; zone temps + belt speed telemetry.
  REFLOW: { equipmentClass: "REFLOW", adapterKind: "ot-opcua", supportedCommands: [CMD_START, CMD_STOP, CMD_SELECT_RECIPE, CMD_SET_PARAM, CMD_ACK_ALARM], telemetryTags: [T_STATE, T_MODE, T_ZONE_TEMPS, T_CONVEYOR_SPEED], supportedStates: FULL_STATES },
  // Solder-paste stencil printer: recipe select; squeegee pressure/speed + cycle time.
  STENCIL_PRINTER: { equipmentClass: "STENCIL_PRINTER", adapterKind: "ot-opcua", supportedCommands: [...AUTOMATION_COMMANDS, CMD_SELECT_RECIPE], telemetryTags: [T_STATE, T_MODE, T_SQUEEGEE_PRESSURE, T_SQUEEGEE_SPEED, T_PRINT_CYCLE, T_CYCLE], supportedStates: FULL_STATES },
  // Wave / selective solder: solder-pot + preheat temps + belt speed.
  WAVE_SOLDER: { equipmentClass: "WAVE_SOLDER", adapterKind: "ot-opcua", supportedCommands: [CMD_START, CMD_STOP, CMD_SELECT_RECIPE, CMD_SET_PARAM, CMD_ACK_ALARM], telemetryTags: [T_STATE, T_MODE, T_SOLDER_POT_TEMP, T_PREHEAT_TEMP, T_CONVEYOR_SPEED], supportedStates: FULL_STATES },
};

/** A minimal, read-only fallback profile for an unknown/unmodelled machineType. */
function fallbackProfile(equipmentClass: string): EquipmentCapability {
  return {
    equipmentClass: (equipmentClass as EquipmentClass) ?? "AUTOMATION",
    adapterKind: "ot-stub",
    supportedCommands: [CMD_READ_TAG],
    telemetryTags: [T_STATE],
    supportedStates: SIMPLE_STATES,
  };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * U4b (doc 21 §6 / G-8) — DATA-DRIVEN capability-profile registry.
 *
 * `DEFAULT_PROFILES` is the SEED; every class is registered through
 * `registerCapabilityProfile` at module load, so resolution reads the registry and
 * is IDENTICAL to the old table lookup (behaviour-preserving). A new equipment class
 * registers its profile instead of editing the table (register-and-go). The
 * `EquipmentClass` union is retained for compile-time exhaustiveness.
 * ════════════════════════════════════════════════════════════════════════════
 */
const profileRegistry = new Map<string, EquipmentCapability>();

/**
 * Register (or override) the DEFAULT capability profile for an equipment class.
 * Register-and-go: a new class needs only this call — no edit to `DEFAULT_PROFILES`.
 */
export function registerCapabilityProfile(equipmentClass: EquipmentClass | string, profile: EquipmentCapability): void {
  profileRegistry.set(equipmentClass, profile);
}

// ── Seed the registry with every existing class (parity with the old table). ──
for (const cls of Object.keys(DEFAULT_PROFILES) as EquipmentClass[]) {
  registerCapabilityProfile(cls, DEFAULT_PROFILES[cls]);
}

/** The registered default profile for a class, or undefined if none. */
function lookupProfile(equipmentClass: string): EquipmentCapability | undefined {
  return profileRegistry.get(equipmentClass);
}

/** The default profile for a machineType (deep-cloned so callers can't mutate the table). */
export function getDefaultCapability(machineType: string): EquipmentCapability {
  const base = lookupProfile(machineType);
  return cloneCapability(base ?? fallbackProfile(machineType));
}

/** All machineType → default profiles (read-only view, for discovery/UI). */
export function listDefaultProfiles(): EquipmentCapability[] {
  return [...profileRegistry.values()].map((c) => cloneCapability(c));
}

/** Every registered equipment class (register-and-go view). */
export function listCapabilityClasses(): string[] {
  return [...profileRegistry.keys()];
}

function cloneCapability(c: EquipmentCapability): EquipmentCapability {
  return {
    equipmentClass: c.equipmentClass,
    adapterKind: c.adapterKind,
    supportedCommands: c.supportedCommands.map((cmd) => ({
      ...cmd,
      paramsSchema: cmd.paramsSchema.map((p) => ({ ...p })),
    })),
    telemetryTags: c.telemetryTags.map((t) => ({ ...t })),
    supportedStates: [...c.supportedStates],
  };
}

/**
 * Per-machine override knobs read from `machines.capabilities` jsonb. The well-known
 * flags toggle commands/telemetry on/off; an explicit `adapterKind` / `extraCommands`
 * / `extraTelemetry` / `disabledCommands` override the default profile. Open-ended
 * (MachineCapabilities is `[k:string]:unknown`) so unknown keys are ignored safely.
 */
export interface CapabilityOverride extends MachineCapabilities {
  /** Force a specific adapter kind (e.g. a vision AOI driven by a PLC over OPC-UA). */
  adapterKind?: AdapterKind;
  /** Extra commands to ADD to the default set (e.g. a custom verb). */
  extraCommands?: CommandDescriptor[];
  /** Extra telemetry keys to ADD. */
  extraTelemetry?: TelemetryDescriptor[];
  /** Command names to REMOVE from the default set. */
  disabledCommands?: string[];
  /**
   * C5 (doc 24 Wave-4) — OPC-UA COMPANION SPECS this machine's server implements
   * (e.g. ["Machinery","Robotics"]). Their spec-derived telemetry channels + PackML
   * states are UNIONED into the capability (additive; unknown ids ignored). This is a
   * metadata/type derivation — see companionSpecs.ts (no live OPC-UA server needed).
   */
  companionSpecs?: Array<CompanionSpecId | string>;
}

/**
 * Merge a machineType default with a per-machine override. Pure + fail-safe: an
 * undefined/garbage override returns the default unchanged.
 *
 * Merge rules:
 *   • adapterKind override wins if a valid AdapterKind.
 *   • capability flags ADD canonical commands/telemetry (hasRecipe → select_recipe,
 *     canMeasureTorque → torque telemetry, canMeasureDispenseVolume → volume, …).
 *   • extraCommands/extraTelemetry are appended (de-duped by name/key).
 *   • disabledCommands are filtered out last.
 */
export function mergeCapability(
  base: EquipmentCapability,
  override?: CapabilityOverride | null,
): EquipmentCapability {
  const merged = cloneCapability(base);
  if (!override || typeof override !== "object") return merged;

  if (typeof override.adapterKind === "string") {
    merged.adapterKind = override.adapterKind;
  }

  const addCommand = (cmd: CommandDescriptor) => {
    if (!merged.supportedCommands.some((c) => c.name === cmd.name)) {
      merged.supportedCommands.push({ ...cmd, paramsSchema: cmd.paramsSchema.map((p) => ({ ...p })) });
    }
  };
  const addTelemetry = (t: TelemetryDescriptor) => {
    if (!merged.telemetryTags.some((x) => x.key === t.key)) merged.telemetryTags.push({ ...t });
  };

  // well-known capability flags → canonical commands/telemetry
  if (override.hasRecipe === true) addCommand(CMD_SELECT_RECIPE);
  if (override.canMeasureTorque === true) addTelemetry(T_TORQUE);
  if (override.canMeasureDispenseVolume === true) addTelemetry(T_VOLUME);
  if (override.emitsProcessResult === true) addTelemetry(T_RESULT);
  if (override.cycleTimeTracked === true) addTelemetry(T_CYCLE);

  if (Array.isArray(override.extraCommands)) {
    for (const c of override.extraCommands) if (c && typeof c.name === "string") addCommand(c);
  }
  if (Array.isArray(override.extraTelemetry)) {
    for (const t of override.extraTelemetry) if (t && typeof t.key === "string") addTelemetry(t);
  }

  // C5 — companion-spec sourcing: a machine declaring OPC-UA companion spec(s) gets the
  // spec-derived telemetry channels + PackML states UNIONED in (additive, backward-compat;
  // unknown spec ids are ignored). Metadata derivation — no live OPC-UA server needed.
  if (Array.isArray(override.companionSpecs) && override.companionSpecs.length) {
    const derived = deriveCapabilityFromSpecs(override.companionSpecs);
    for (const t of derived.telemetry) addTelemetry(t);
    for (const s of derived.states) {
      if (!merged.supportedStates.includes(s)) merged.supportedStates.push(s);
    }
  }

  if (Array.isArray(override.disabledCommands) && override.disabledCommands.length) {
    const disabled = new Set(override.disabledCommands);
    merged.supportedCommands = merged.supportedCommands.filter((c) => !disabled.has(c.name));
  }
  return merged;
}

/** A machine row shape this resolver needs (subset of drizzle `Machine`). */
export interface MachineLike {
  machineType: string;
  capabilities?: MachineCapabilities | null;
}

/**
 * Resolve the EquipmentCapability for a machine: default(machineType) ⊕ jsonb override.
 * Fail-safe: a null/garbage machine → a minimal read-only profile; never throws.
 *
 * Accepts EITHER a machine-like object (machineType + capabilities) OR a bare
 * machineType string (defaults only, no override). The DB-bound by-id resolution
 * lives in equipmentRouter (which has db access) — this stays pure.
 */
export function getCapabilitiesForMachine(machine: MachineLike | string | null | undefined): EquipmentCapability {
  if (typeof machine === "string") {
    return getDefaultCapability(machine);
  }
  if (!machine || typeof machine.machineType !== "string") {
    return fallbackProfile("AUTOMATION");
  }
  const base = getDefaultCapability(machine.machineType);
  return mergeCapability(base, (machine.capabilities ?? null) as CapabilityOverride | null);
}
