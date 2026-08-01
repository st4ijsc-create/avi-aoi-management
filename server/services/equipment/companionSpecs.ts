/**
 * doc 24 Wave-4 · C5 — OPC-UA COMPANION-SPEC TYPE MODELS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HONEST SCOPE (read this first): this is a METADATA / TYPE layer, **not** a live
 * OPC-UA stack. It models the information models of the key OPC-UA *companion
 * specifications* as self-contained TypeScript structures — a namespace URI plus a
 * set of typed nodes carrying their BrowseName, browse-path, OPC-UA data type and
 * ModellingRule (mandatory/optional). No `node-opcua` server is required to use it.
 *
 * A real driver (ot/drivers/opcuaDriver.ts) would INSTANTIATE these browse-paths
 * against a live address space (browse + read the Variable nodes); here we only carry
 * the SHAPE + the mapping onto the platform capability contract. So a machine can
 * DECLARE "supports the Machinery companion spec" and have its capability
 * {telemetry, states} DERIVED/validated from the spec (see capabilityModel.ts).
 *
 * The three specs modelled (the headline ones from doc 24 §P2):
 *   • OPC UA for Machinery  (OPC 40001-1) — MachineIdentification, MachineryItemState,
 *     common OperationCounters. Namespace http://opcfoundation.org/UA/Machinery/.
 *   • OPC UA for Robotics   (OPC 40010-1) — MotionDeviceSystem → MotionDevice → Axes,
 *     Controllers, SafetyStates. Namespace http://opcfoundation.org/UA/Robotics/.
 *   • Euromap 83 (injection moulding) — the SAME logical model as Euromap 77
 *     (OPC UA PlasticsRubber IMM2MES nodeset) carried over MQTT/JSON. Cycle/shot/
 *     mode/mould. See services/euromap/* for the read path.
 *
 * The state mapping (spec state model → the 17 PackML states) is a BEST-EFFORT
 * bridge, not a 1:1 standard mapping — PackML is a platform concept, the companion
 * specs carry their own state models (MachineryItemState / Robotics OperationalMode /
 * Euromap MachineMode). The mapping is documented per spec and marked as such.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { TelemetryDescriptor, CapabilityDataType } from "./capabilityModel";
import type { PackmlState } from "./packml";

/** The companion specs this metadata layer models. */
export type CompanionSpecId = "Machinery" | "Robotics" | "Euromap83";

/** OPC-UA built-in / common data type of a node (superset of what we map). */
export type OpcuaNodeDataType =
  | "Boolean"
  | "SByte"
  | "Byte"
  | "Int16"
  | "UInt16"
  | "Int32"
  | "UInt32"
  | "Int64"
  | "UInt64"
  | "Float"
  | "Double"
  | "String"
  | "DateTime"
  | "LocalizedText"
  | "Enumeration"
  | "Structure";

/** OPC-UA node class (we model Variables, Objects and Methods for browse metadata). */
export type OpcuaNodeClass = "Variable" | "Object" | "Method";

/**
 * ONE typed node in a companion-spec information model. This is the browse-path
 * metadata a real driver would instantiate against a live server's address space.
 */
export interface CompanionSpecNode {
  /** BrowseName (e.g. "MachineryItemState", "ActualCycle", "ActualPosition"). */
  browseName: string;
  /** Full browse path from the type/system root (ordered BrowseName segments). */
  browsePath: string[];
  nodeClass: OpcuaNodeClass;
  /** OPC-UA data type (Variable nodes only). */
  dataType?: OpcuaNodeDataType;
  /** ModellingRule: true when the spec makes the node Mandatory. */
  mandatory: boolean;
  description?: string;
  /** Allowed values for an Enumeration node (its state/mode symbols). */
  enumValues?: string[];
  /**
   * When this node maps onto a capability TELEMETRY channel, the derived descriptor.
   * Identity/config nodes (Manufacturer/Model/…) carry a telemetry too so the digital
   * thread can surface them; Object/Method nodes usually carry none.
   */
  telemetry?: TelemetryDescriptor;
}

/** A fully-modelled OPC-UA companion specification (metadata only, no live server). */
export interface CompanionSpec {
  id: CompanionSpecId;
  title: string;
  /** OPC-UA namespace URI of the companion spec's nodeset. */
  namespaceUri: string;
  /** The companion-spec release version modelled here. */
  version: string;
  /** The typed nodes (browse-path metadata). */
  nodes: CompanionSpecNode[];
  /**
   * The PackML states a machine implementing this spec can occupy, derived best-effort
   * from the spec's own state model (documented in `stateMappingNote`).
   */
  supportedStates: PackmlState[];
  /** Human note on how the spec's state model was bridged onto PackML. */
  stateMappingNote: string;
  /** Honest-scope caveat (metadata/type layer, not a live OPC-UA driver). */
  caveat: string;
}

const METADATA_CAVEAT =
  "METADATA/TYPE layer only: browse-path + capability mapping for an OPC-UA companion " +
  "spec. No live OPC-UA server is attached and no telemetry is fabricated. A real " +
  "driver (opcuaDriver) instantiates these browse-paths against a machine's address space.";

// ── OPC-UA data type → capability data type (for validation / derivation) ──
const OPCUA_TO_CAPABILITY: Record<OpcuaNodeDataType, CapabilityDataType> = {
  Boolean: "bool",
  SByte: "int",
  Byte: "int",
  Int16: "int",
  UInt16: "int",
  Int32: "int",
  UInt32: "int",
  Int64: "int",
  UInt64: "int",
  Float: "float",
  Double: "float",
  String: "string",
  DateTime: "string",
  LocalizedText: "string",
  Enumeration: "enum",
  Structure: "json",
};

/** Map an OPC-UA data type onto the capability contract's logical data type. */
export function opcuaToCapabilityDataType(dt: OpcuaNodeDataType): CapabilityDataType {
  return OPCUA_TO_CAPABILITY[dt] ?? "string";
}

// ════════════════════════════════════════════════════════════════════════════
// OPC UA for Machinery (OPC 40001-1)
// ════════════════════════════════════════════════════════════════════════════
const MACHINERY_SPEC: CompanionSpec = {
  id: "Machinery",
  title: "OPC UA for Machinery",
  namespaceUri: "http://opcfoundation.org/UA/Machinery/",
  version: "1.03",
  stateMappingNote:
    "MachineryItemState_StateMachineType {NotAvailable, OutOfService, NotExecuting, " +
    "Executing} bridged onto PackML: Executing→Execute, NotExecuting→Idle, " +
    "OutOfService→Stopped, NotAvailable→Aborted (best-effort, not a normative mapping).",
  supportedStates: ["Idle", "Execute", "Held", "Stopped", "Aborted"],
  caveat: METADATA_CAVEAT,
  nodes: [
    // ── MachineIdentification (ISA-95 / OPC UA DI derived identity) ──
    {
      browseName: "Manufacturer",
      browsePath: ["Machines", "MachineIdentification", "Manufacturer"],
      nodeClass: "Variable",
      dataType: "LocalizedText",
      mandatory: true,
      description: "Manufacturer of the machinery item.",
      telemetry: { key: "manufacturer", label: "Manufacturer", dataType: "string" },
    },
    {
      browseName: "Model",
      browsePath: ["Machines", "MachineIdentification", "Model"],
      nodeClass: "Variable",
      dataType: "LocalizedText",
      mandatory: true,
      description: "Model name of the machinery item.",
      telemetry: { key: "model", label: "Model", dataType: "string" },
    },
    {
      browseName: "SerialNumber",
      browsePath: ["Machines", "MachineIdentification", "SerialNumber"],
      nodeClass: "Variable",
      dataType: "String",
      mandatory: true,
      description: "Unique serial number of the machinery item.",
      telemetry: { key: "serial_number", label: "Serial number", dataType: "string" },
    },
    {
      browseName: "ProductInstanceUri",
      browsePath: ["Machines", "MachineIdentification", "ProductInstanceUri"],
      nodeClass: "Variable",
      dataType: "String",
      mandatory: true,
      description: "Globally unique resource identifier of the machinery item instance.",
      telemetry: { key: "product_instance_uri", label: "Product instance URI", dataType: "string" },
    },
    {
      browseName: "YearOfConstruction",
      browsePath: ["Machines", "MachineIdentification", "YearOfConstruction"],
      nodeClass: "Variable",
      dataType: "UInt16",
      mandatory: false,
      description: "Year the machinery item was built.",
      telemetry: { key: "year_of_construction", label: "Year of construction", dataType: "int" },
    },
    {
      browseName: "SoftwareRevision",
      browsePath: ["Machines", "MachineIdentification", "SoftwareRevision"],
      nodeClass: "Variable",
      dataType: "String",
      mandatory: false,
      description: "Software/firmware revision of the machinery item.",
      telemetry: { key: "firmware_version", label: "Firmware", dataType: "string" },
    },
    // ── MachineryItemState (OPC 40001-1 state machine) ──
    {
      browseName: "MachineryItemState",
      browsePath: ["Machines", "MachineryBuildingBlocks", "MachineryItemState"],
      nodeClass: "Object",
      mandatory: false,
      description: "FiniteStateMachine describing the item's execution availability.",
    },
    {
      browseName: "CurrentState",
      browsePath: ["Machines", "MachineryBuildingBlocks", "MachineryItemState", "CurrentState"],
      nodeClass: "Variable",
      dataType: "LocalizedText",
      mandatory: true,
      description: "Current MachineryItemState value.",
      enumValues: ["NotAvailable", "OutOfService", "NotExecuting", "Executing"],
      telemetry: { key: "machinery_item_state", label: "Machinery item state", dataType: "string" },
    },
    // ── OperationCounters (Machinery common OperationCounterType) ──
    {
      browseName: "OperationDuration",
      browsePath: ["Machines", "MachineryBuildingBlocks", "OperationCounters", "OperationDuration"],
      nodeClass: "Variable",
      dataType: "Double",
      mandatory: false,
      description: "Cumulative duration the item has been operating (in Execute).",
      telemetry: { key: "operation_duration", label: "Operation duration", dataType: "float", unit: "s" },
    },
    {
      browseName: "PowerOnDuration",
      browsePath: ["Machines", "MachineryBuildingBlocks", "OperationCounters", "PowerOnDuration"],
      nodeClass: "Variable",
      dataType: "Double",
      mandatory: false,
      description: "Cumulative powered-on duration of the item.",
      telemetry: { key: "power_on_duration", label: "Power-on duration", dataType: "float", unit: "s" },
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// OPC UA for Robotics (OPC 40010-1)
// ════════════════════════════════════════════════════════════════════════════
const ROBOTICS_SPEC: CompanionSpec = {
  id: "Robotics",
  title: "OPC UA for Robotics (MotionDeviceSystem)",
  namespaceUri: "http://opcfoundation.org/UA/Robotics/",
  version: "1.00",
  stateMappingNote:
    "Robotics carries no PackML; the OperationalMode + SafetyStates (EmergencyStop/" +
    "ProtectiveStop) are bridged best-effort onto a controllable robot's PackML cube " +
    "(motion→Execute, protective-stop→Held, e-stop→Aborted, powered-idle→Idle).",
  supportedStates: [
    "Idle",
    "Starting",
    "Execute",
    "Holding",
    "Held",
    "Stopping",
    "Stopped",
    "Aborting",
    "Aborted",
    "Resetting",
  ],
  caveat: METADATA_CAVEAT,
  nodes: [
    // ── MotionDevice identity ──
    {
      browseName: "Manufacturer",
      browsePath: ["MotionDeviceSystem", "MotionDevices", "MotionDevice", "Manufacturer"],
      nodeClass: "Variable",
      dataType: "LocalizedText",
      mandatory: true,
      description: "Manufacturer of the motion device (robot).",
      telemetry: { key: "manufacturer", label: "Manufacturer", dataType: "string" },
    },
    {
      browseName: "Model",
      browsePath: ["MotionDeviceSystem", "MotionDevices", "MotionDevice", "Model"],
      nodeClass: "Variable",
      dataType: "LocalizedText",
      mandatory: true,
      description: "Model of the motion device.",
      telemetry: { key: "model", label: "Model", dataType: "string" },
    },
    {
      browseName: "SerialNumber",
      browsePath: ["MotionDeviceSystem", "MotionDevices", "MotionDevice", "SerialNumber"],
      nodeClass: "Variable",
      dataType: "String",
      mandatory: false,
      description: "Serial number of the motion device.",
      telemetry: { key: "serial_number", label: "Serial number", dataType: "string" },
    },
    {
      browseName: "MotionDeviceCategory",
      browsePath: ["MotionDeviceSystem", "MotionDevices", "MotionDevice", "MotionDeviceCategory"],
      nodeClass: "Variable",
      dataType: "Enumeration",
      mandatory: true,
      description: "Kinematic category of the motion device.",
      enumValues: [
        "OTHER",
        "ARTICULATED_ROBOT",
        "SCARA_ROBOT",
        "CARTESIAN_ROBOT",
        "SPHERICAL_ROBOT",
        "PARALLEL_ROBOT",
        "CYLINDRICAL_ROBOT",
        "DELTA_ROBOT",
      ],
      telemetry: { key: "motion_device_category", label: "Motion device category", dataType: "string" },
    },
    // ── Axis parameter set (per-axis; Axis_1 modelled as the representative) ──
    {
      browseName: "Axes",
      browsePath: ["MotionDeviceSystem", "MotionDevices", "MotionDevice", "Axes"],
      nodeClass: "Object",
      mandatory: true,
      description: "Folder of the motion device's axes.",
    },
    {
      browseName: "ActualPosition",
      browsePath: [
        "MotionDeviceSystem", "MotionDevices", "MotionDevice", "Axes", "Axis", "ParameterSet", "ActualPosition",
      ],
      nodeClass: "Variable",
      dataType: "Double",
      mandatory: true,
      description: "Actual position of an axis (deg for rotary, mm for linear).",
      telemetry: { key: "axis_actual_position", label: "Axis position", dataType: "float" },
    },
    {
      browseName: "ActualSpeed",
      browsePath: [
        "MotionDeviceSystem", "MotionDevices", "MotionDevice", "Axes", "Axis", "ParameterSet", "ActualSpeed",
      ],
      nodeClass: "Variable",
      dataType: "Double",
      mandatory: false,
      description: "Actual speed of an axis.",
      telemetry: { key: "axis_actual_speed", label: "Axis speed", dataType: "float" },
    },
    {
      browseName: "MotorTemperature",
      browsePath: [
        "MotionDeviceSystem", "MotionDevices", "MotionDevice", "Axes", "Axis", "ParameterSet", "MotorTemperature",
      ],
      nodeClass: "Variable",
      dataType: "Double",
      mandatory: false,
      description: "Motor temperature of an axis drive.",
      telemetry: { key: "motor_temperature", label: "Motor temperature", dataType: "float", unit: "degC" },
    },
    // ── Controller parameter set ──
    {
      browseName: "SpeedOverride",
      browsePath: ["MotionDeviceSystem", "Controllers", "Controller", "ParameterSet", "SpeedOverride"],
      nodeClass: "Variable",
      dataType: "Double",
      mandatory: false,
      description: "Global speed override applied by the controller.",
      telemetry: { key: "speed_override", label: "Speed override", dataType: "float", unit: "%" },
    },
    // ── SafetyStates ──
    {
      browseName: "EmergencyStop",
      browsePath: ["MotionDeviceSystem", "SafetyStates", "SafetyState", "EmergencyStop"],
      nodeClass: "Variable",
      dataType: "Boolean",
      mandatory: true,
      description: "True when the emergency stop is asserted.",
      telemetry: { key: "emergency_stop", label: "E-stop", dataType: "bool" },
    },
    {
      browseName: "OperationalMode",
      browsePath: ["MotionDeviceSystem", "SafetyStates", "SafetyState", "OperationalMode"],
      nodeClass: "Variable",
      dataType: "Enumeration",
      mandatory: false,
      description: "Operational (safety) mode of the motion device system.",
      enumValues: ["OTHER", "MANUAL_REDUCED_SPEED", "MANUAL_HIGH_SPEED", "AUTOMATIC", "AUTOMATIC_EXTERNAL"],
      telemetry: { key: "operational_mode", label: "Operational mode", dataType: "string" },
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// Euromap 83 (injection moulding — same model as Euromap 77 / OPC UA PlasticsRubber)
// ════════════════════════════════════════════════════════════════════════════
const EUROMAP83_SPEC: CompanionSpec = {
  id: "Euromap83",
  title: "Euromap 83 (injection moulding — PlasticsRubber IMM2MES)",
  namespaceUri: "http://www.euromap.org/euromap83/",
  version: "1.00",
  stateMappingNote:
    "Euromap MachineMode {MANUAL, SEMI_AUTOMATIC, AUTOMATIC, STOPPED, SETUP} bridged " +
    "onto PackML: AUTOMATIC→Execute, SEMI_AUTOMATIC→Execute, MANUAL/SETUP→Held, " +
    "STOPPED→Stopped (mirrors euromapAdapter.utilizationFromMode; best-effort).",
  supportedStates: ["Idle", "Execute", "Held", "Stopped", "Aborted"],
  caveat:
    METADATA_CAVEAT +
    " Euromap 83 carries the Euromap 77 data model over MQTT/JSON rather than OPC-UA; " +
    "see services/euromap/* for the transport-neutral read path.",
  nodes: [
    {
      browseName: "ActualCycleTime",
      browsePath: ["Machine", "Status", "ActualCycleTime"],
      nodeClass: "Variable",
      dataType: "Double",
      mandatory: true,
      description: "Duration of the last completed cycle (seconds).",
      // Reuses the platform-canonical cycle_time key so it aligns with T_CYCLE.
      telemetry: { key: "cycle_time", label: "Cycle time", dataType: "float", unit: "s" },
    },
    {
      browseName: "ShotCounter",
      browsePath: ["Machine", "Status", "ShotCounter"],
      nodeClass: "Variable",
      dataType: "UInt64",
      mandatory: true,
      description: "Cumulative shot / cycle counter.",
      telemetry: { key: "shot_counter", label: "Shot counter", dataType: "int" },
    },
    {
      browseName: "GoodPartsCounter",
      browsePath: ["Machine", "Status", "GoodPartsCounter"],
      nodeClass: "Variable",
      dataType: "UInt64",
      mandatory: false,
      description: "Cumulative good-parts counter.",
      telemetry: { key: "good_parts_counter", label: "Good parts", dataType: "int" },
    },
    {
      browseName: "MachineMode",
      browsePath: ["Machine", "Status", "MachineMode"],
      nodeClass: "Variable",
      dataType: "Enumeration",
      mandatory: true,
      description: "Operating mode of the injection-moulding machine.",
      enumValues: ["MANUAL", "SEMI_AUTOMATIC", "AUTOMATIC", "STOPPED", "SETUP"],
      telemetry: { key: "machine_mode", label: "Machine mode", dataType: "string" },
    },
    {
      browseName: "ActiveMould",
      browsePath: ["Machine", "Configuration", "ActiveMould"],
      nodeClass: "Variable",
      dataType: "String",
      mandatory: false,
      description: "Identifier of the active mould / recipe.",
      telemetry: { key: "active_mould", label: "Active mould", dataType: "string" },
    },
  ],
};

// ── registry ──────────────────────────────────────────────────────────────────
const COMPANION_SPECS: Record<CompanionSpecId, CompanionSpec> = {
  Machinery: MACHINERY_SPEC,
  Robotics: ROBOTICS_SPEC,
  Euromap83: EUROMAP83_SPEC,
};

/** Every companion-spec id this metadata layer models. */
export function listCompanionSpecIds(): CompanionSpecId[] {
  return Object.keys(COMPANION_SPECS) as CompanionSpecId[];
}

/** All modelled companion specs (deep enough for read-only inspection). */
export function listCompanionSpecs(): CompanionSpec[] {
  return listCompanionSpecIds().map((id) => COMPANION_SPECS[id]);
}

/** Narrow an arbitrary string to a known CompanionSpecId (fail-safe → null). */
export function asCompanionSpecId(raw: unknown): CompanionSpecId | null {
  return typeof raw === "string" && raw in COMPANION_SPECS ? (raw as CompanionSpecId) : null;
}

/** Get one companion spec by id, or undefined when unknown. */
export function getCompanionSpec(id: CompanionSpecId | string): CompanionSpec | undefined {
  const key = asCompanionSpecId(id);
  return key ? COMPANION_SPECS[key] : undefined;
}

/** The Variable nodes of a spec (the readable telemetry-bearing nodes). */
export function specVariableNodes(spec: CompanionSpec): CompanionSpecNode[] {
  return spec.nodes.filter((n) => n.nodeClass === "Variable");
}

/**
 * The telemetry channels a spec contributes (its telemetry-mapped nodes, de-duped by
 * key preserving spec order). This is the capability {telemetry} DERIVED from the spec.
 */
export function specTelemetry(spec: CompanionSpec): TelemetryDescriptor[] {
  const out: TelemetryDescriptor[] = [];
  const seen = new Set<string>();
  for (const n of spec.nodes) {
    if (n.telemetry && !seen.has(n.telemetry.key)) {
      seen.add(n.telemetry.key);
      out.push({ ...n.telemetry });
    }
  }
  return out;
}

/** The capability {telemetry, states} DERIVED from a set of declared companion specs. */
export interface DerivedSpecCapability {
  telemetry: TelemetryDescriptor[];
  states: PackmlState[];
  /** The spec ids that actually resolved (unknown ids are ignored, listed here). */
  resolvedSpecIds: CompanionSpecId[];
  unknownSpecIds: string[];
}

/**
 * Derive the union of {telemetry, states} contributed by the declared companion specs.
 * Pure + fail-safe: unknown ids are ignored (surfaced in `unknownSpecIds`), never throws.
 * De-dup: telemetry by key, states by value (both order-preserving across specs).
 */
export function deriveCapabilityFromSpecs(
  specIds: Array<CompanionSpecId | string> | null | undefined,
): DerivedSpecCapability {
  const telemetry: TelemetryDescriptor[] = [];
  const states: PackmlState[] = [];
  const resolvedSpecIds: CompanionSpecId[] = [];
  const unknownSpecIds: string[] = [];
  const seenKey = new Set<string>();
  const seenState = new Set<PackmlState>();

  for (const raw of Array.isArray(specIds) ? specIds : []) {
    const spec = getCompanionSpec(raw as string);
    if (!spec) {
      if (typeof raw === "string" && raw.trim()) unknownSpecIds.push(raw);
      continue;
    }
    if (!resolvedSpecIds.includes(spec.id)) resolvedSpecIds.push(spec.id);
    for (const t of specTelemetry(spec)) {
      if (!seenKey.has(t.key)) {
        seenKey.add(t.key);
        telemetry.push(t);
      }
    }
    for (const s of spec.supportedStates) {
      if (!seenState.has(s)) {
        seenState.add(s);
        states.push(s);
      }
    }
  }
  return { telemetry, states, resolvedSpecIds, unknownSpecIds };
}

/**
 * Validate that a subject (declared telemetry keys + states) COVERS the mandatory
 * telemetry a companion spec's Variable nodes require. Used to prove a machine's
 * resolved capability actually satisfies the spec it declares. Pure + fail-safe.
 */
export interface SpecConformance {
  specId: CompanionSpecId;
  pass: boolean;
  missingTelemetry: string[];
  missingStates: PackmlState[];
}

export function checkSpecConformance(
  spec: CompanionSpec,
  telemetryKeys: string[],
  states: PackmlState[],
): SpecConformance {
  const keySet = new Set(telemetryKeys);
  const stateSet = new Set(states);
  const missingTelemetry: string[] = [];
  for (const n of spec.nodes) {
    if (n.mandatory && n.telemetry && !keySet.has(n.telemetry.key)) {
      missingTelemetry.push(n.telemetry.key);
    }
  }
  const missingStates = spec.supportedStates.filter((s) => !stateSet.has(s));
  return {
    specId: spec.id,
    pass: missingTelemetry.length === 0 && missingStates.length === 0,
    missingTelemetry,
    missingStates,
  };
}
