/**
 * VDA 5050 (v2) — typed JSON message models for AGV/AMR ↔ master-control.
 *
 * VDA 5050 is the open MQTT-based standard published by the VDA/VDMA for the
 * communication interface between an AGV (or fleet of AMRs) and a central
 * master-control / fleet-management system.
 *
 * TOPIC STRUCTURE (v2):
 *   <interfaceName>/v2/<manufacturer>/<serialNumber>/{order|instantActions|state|connection|visualization|factsheet}
 *
 *   Direction of each topic (from the AGV's point of view):
 *     - order            ← master-control PUBLISHES (drive/action graph)
 *     - instantActions   ← master-control PUBLISHES (immediate actions, e.g. stop)
 *     - state            → AGV PUBLISHES (full status, ~1 Hz / on change)
 *     - connection       → AGV PUBLISHES (online/offline/connectionbroken; LWT)
 *     - visualization    → AGV PUBLISHES (high-frequency pose only, optional)
 *     - factsheet        → AGV PUBLISHES (static capabilities, on request)
 *
 * ⚠ HONESTY / VALIDATION CAVEAT:
 *   These models are transcribed from the public VDA 5050 v2 JSON schema docs.
 *   Field names, units and the exact topic layout MUST be validated against a
 *   REAL AGV / fleet manager before going live — vendors differ in optional
 *   fields, operating-mode strings, and how `theta`/velocity are reported.
 *   This file is the read/command CONTRACT only; nothing here publishes.
 */

/** Header fields common to every VDA 5050 message. */
export interface Vda5050Header {
  /** Monotonically increasing per-topic message counter (per AGV, per topic). */
  headerId: number;
  /** ISO-8601 UTC timestamp, e.g. "2026-06-28T10:00:00.000Z". */
  timestamp: string;
  /** Protocol version string, e.g. "2.0.0". */
  version: string;
  /** AGV/fleet manufacturer (also a topic segment). */
  manufacturer: string;
  /** AGV serial number — unique per AGV (also a topic segment). */
  serialNumber: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDER  (master-control → AGV)
// ─────────────────────────────────────────────────────────────────────────────

/** A single action the AGV must execute (at a node or along an edge). */
export interface Vda5050Action {
  /** Action type, e.g. "pick", "drop", "startCharging", "wait". */
  actionType: string;
  /** Unique id for this action instance (used to correlate state.actionStates). */
  actionId: string;
  /** "NONE" | "SOFT" | "HARD" — how the AGV may block while running it. */
  blockingType: "NONE" | "SOFT" | "HARD";
  /** Optional human description. */
  actionDescription?: string;
  /** Free-form parameters, vendor/action specific. */
  actionParameters?: Array<{ key: string; value: string | number | boolean | unknown }>;
}

/** Target position attached to a node (map frame). */
export interface Vda5050NodePosition {
  x: number;
  y: number;
  /** Heading in radians (optional — set allowedDeviationTheta if relevant). */
  theta?: number;
  /** Map identifier the x/y/theta are expressed in. */
  mapId: string;
  allowedDeviationXY?: number;
  allowedDeviationTheta?: number;
  mapDescription?: string;
}

/** A node (waypoint) in the order graph. */
export interface Vda5050Node {
  nodeId: string;
  /** Sequence id; nodes and edges share one increasing sequence per order. */
  sequenceId: number;
  /** Whether the AGV may already traverse to/through this node. */
  released: boolean;
  nodePosition?: Vda5050NodePosition;
  actions: Vda5050Action[];
  nodeDescription?: string;
}

/** An edge (path) between two nodes in the order graph. */
export interface Vda5050Edge {
  edgeId: string;
  sequenceId: number;
  released: boolean;
  startNodeId: string;
  endNodeId: string;
  actions: Vda5050Action[];
  edgeDescription?: string;
  maxSpeed?: number;
  direction?: string;
}

/**
 * Order — the drive/action graph the AGV must execute.
 * orderId + orderUpdateId identify an order and its incremental updates.
 */
export interface Vda5050Order extends Vda5050Header {
  orderId: string;
  orderUpdateId: number;
  zoneSetId?: string;
  nodes: Vda5050Node[];
  edges: Vda5050Edge[];
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTANT ACTIONS  (master-control → AGV)
// ─────────────────────────────────────────────────────────────────────────────

/** Immediate, order-independent actions (e.g. cancelOrder, stop, startPause). */
export interface Vda5050InstantActions extends Vda5050Header {
  /** Field name is `actions` in v2 (was `instantActions` in v1). */
  actions: Vda5050Action[];
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE  (AGV → master-control)
// ─────────────────────────────────────────────────────────────────────────────

/** AGV pose on the map (reported in `state.agvPosition`). */
export interface Vda5050AgvPosition {
  x: number;
  y: number;
  /** Heading in radians. */
  theta: number;
  mapId: string;
  /** Whether the AGV currently has a valid localization. */
  positionInitialized: boolean;
  localizationScore?: number;
  deviationRange?: number;
  mapDescription?: string;
}

/** AGV velocity (`state.velocity`). */
export interface Vda5050Velocity {
  /** Linear velocity along robot x (m/s). */
  vx?: number;
  /** Linear velocity along robot y (m/s). */
  vy?: number;
  /** Angular velocity (rad/s). */
  omega?: number;
}

/** Battery info (`state.batteryState`). */
export interface Vda5050BatteryState {
  /** State of charge, 0–100 (%). */
  batteryCharge: number;
  /** Whether the AGV is currently charging. */
  charging: boolean;
  batteryVoltage?: number;
  batteryHealth?: number;
  /** Estimated remaining reach in metres. */
  reach?: number;
}

/** An error reported by the AGV (`state.errors[]`). */
export interface Vda5050Error {
  errorType: string;
  /** "WARNING" | "FATAL" — FATAL implies the AGV cannot proceed. */
  errorLevel: "WARNING" | "FATAL";
  errorDescription?: string;
  errorReferences?: Array<{ referenceKey: string; referenceValue: string }>;
}

/** Per-action execution status echoed back by the AGV. */
export interface Vda5050ActionState {
  actionId: string;
  actionType?: string;
  /** WAITING | INITIALIZING | RUNNING | PAUSED | FINISHED | FAILED. */
  actionStatus: string;
  resultDescription?: string;
}

/**
 * State — the AGV's full status snapshot (published ~1 Hz and on change).
 * `operatingMode` is the AGV's control mode; `driving`/`paused` reflect motion.
 */
export interface Vda5050State extends Vda5050Header {
  orderId: string;
  orderUpdateId: number;
  /** Node the AGV last reached (graph progress). */
  lastNodeId: string;
  lastNodeSequenceId: number;
  /** AUTOMATIC | SEMIAUTOMATIC | MANUAL | SERVICE | TEACHIN. */
  operatingMode: string;
  /** Whether the AGV is actively driving. */
  driving: boolean;
  /** Whether the AGV is paused. */
  paused?: boolean;
  /** Whether a new base (released graph) is requested. */
  newBaseRequest?: boolean;
  agvPosition?: Vda5050AgvPosition;
  velocity?: Vda5050Velocity;
  batteryState: Vda5050BatteryState;
  errors: Vda5050Error[];
  actionStates?: Vda5050ActionState[];
  /**
   * Safety state. `eStop`: "NONE" | "AUTOACK" | "MANUAL" | "REMOTE";
   * `fieldViolation`: protective field breached.
   */
  safetyState?: { eStop: string; fieldViolation: boolean };
  nodeStates?: Array<{ nodeId: string; sequenceId: number; released: boolean }>;
  edgeStates?: Array<{ edgeId: string; sequenceId: number; released: boolean }>;
  /** Whether all loads/handlers are reported. */
  loads?: Array<Record<string, unknown>>;
  information?: Array<{ infoType: string; infoLevel: string; infoDescription?: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION  (AGV → master-control; LWT)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connection — published by the AGV with retain; the broker re-publishes the
 * "CONNECTIONBROKEN" variant as the Last-Will when the AGV drops unexpectedly.
 */
export interface Vda5050Connection extends Vda5050Header {
  /** "ONLINE" | "OFFLINE" | "CONNECTIONBROKEN". */
  connectionState: "ONLINE" | "OFFLINE" | "CONNECTIONBROKEN";
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUALIZATION  (AGV → master-control; high-frequency pose, optional)
// ─────────────────────────────────────────────────────────────────────────────

export interface Vda5050Visualization extends Vda5050Header {
  agvPosition?: Vda5050AgvPosition;
  velocity?: Vda5050Velocity;
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTSHEET  (AGV → master-control; static capabilities, on request)
// ─────────────────────────────────────────────────────────────────────────────

export interface Vda5050Factsheet extends Vda5050Header {
  typeSpecification?: Record<string, unknown>;
  physicalParameters?: Record<string, unknown>;
  protocolLimits?: Record<string, unknown>;
  protocolFeatures?: Record<string, unknown>;
  agvGeometry?: Record<string, unknown>;
  loadSpecification?: Record<string, unknown>;
}

/** The VDA 5050 sub-topic names (v2). */
export type Vda5050Topic =
  | "order"
  | "instantActions"
  | "state"
  | "connection"
  | "visualization"
  | "factsheet";

/** Default interface name segment (configurable per deployment). */
export const VDA5050_DEFAULT_INTERFACE = "uagv";

/** Default protocol version we speak. */
export const VDA5050_VERSION = "2.0.0";

/**
 * Build the MQTT topic for an AGV sub-channel:
 *   <interfaceName>/v2/<manufacturer>/<serialNumber>/<topic>
 */
export function buildVda5050Topic(
  interfaceName: string,
  manufacturer: string,
  serialNumber: string,
  topic: Vda5050Topic,
): string {
  return `${interfaceName}/v2/${manufacturer}/${serialNumber}/${topic}`;
}
