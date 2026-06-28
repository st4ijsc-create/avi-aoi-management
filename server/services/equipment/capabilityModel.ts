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
  | "ROBOT";

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
  | "vda5050";

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
  ROBOT: { equipmentClass: "ROBOT", adapterKind: "robot", supportedCommands: [CMD_START, CMD_PAUSE, CMD_ROBOT_RUNJOB, CMD_ROBOT_ABORT], telemetryTags: [T_MODE, T_POSE, T_ESTOP, T_STATE], supportedStates: FULL_STATES },
  ROBOT_TEST: { equipmentClass: "ROBOT_TEST", adapterKind: "robot", supportedCommands: [CMD_START, CMD_STOP, CMD_ROBOT_RUNJOB, CMD_ROBOT_ABORT], telemetryTags: [T_MODE, T_POSE, T_RESULT, T_STATE], supportedStates: FULL_STATES },
  PALLETIZER: { equipmentClass: "PALLETIZER", adapterKind: "robot", supportedCommands: [CMD_START, CMD_PAUSE, CMD_ROBOT_RUNJOB, CMD_ROBOT_ABORT], telemetryTags: [T_MODE, T_POSE, T_ESTOP, T_STATE], supportedStates: FULL_STATES },
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

/** The default profile for a machineType (deep-cloned so callers can't mutate the table). */
export function getDefaultCapability(machineType: string): EquipmentCapability {
  const base = DEFAULT_PROFILES[machineType as EquipmentClass];
  return cloneCapability(base ?? fallbackProfile(machineType));
}

/** All machineType → default profiles (read-only view, for discovery/UI). */
export function listDefaultProfiles(): EquipmentCapability[] {
  return (Object.keys(DEFAULT_PROFILES) as EquipmentClass[]).map((k) => cloneCapability(DEFAULT_PROFILES[k]));
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
