/**
 * VDA 5050 — pure mapping helpers (no MQTT, no DB), so they are unit-testable.
 *
 *   - mapStateToRobotTelemetry : VDA 5050 `State` JSON → platform RobotState
 *   - mapConnectionToOnline    : VDA 5050 `Connection` → online/offline boolean
 *   - buildOrder               : a RobotJobSpec ("move") → a valid VDA 5050 Order
 *
 * ⚠ The field mapping below (operatingMode → mode, eStop strings, theta units)
 *   is transcribed from the public VDA 5050 v2 spec and MUST be validated
 *   against a real AGV. Treat as a starting contract, not ground truth.
 */
import type { RobotState } from "../robot/robotDriver";
import type {
  Vda5050State,
  Vda5050Connection,
  Vda5050Order,
  Vda5050Node,
  Vda5050Edge,
  Vda5050Action,
} from "./vda5050Messages";
import { VDA5050_VERSION } from "./vda5050Messages";

/** Map a VDA 5050 operatingMode → the platform's coarse mode string. */
export function mapOperatingMode(operatingMode: string | undefined): string | undefined {
  switch ((operatingMode || "").toUpperCase()) {
    case "AUTOMATIC":
    case "SEMIAUTOMATIC":
      return "auto";
    case "MANUAL":
    case "SERVICE":
      return "manual";
    case "TEACHIN":
      return "teach";
    default:
      return operatingMode ? operatingMode.toLowerCase() : undefined;
  }
}

/** True if the AGV's safetyState reports an active emergency stop. */
export function isEstopActive(state: Pick<Vda5050State, "safetyState">): boolean {
  const e = state.safetyState?.eStop;
  if (!e) return false;
  // "NONE" → not triggered; any other value (AUTOACK/MANUAL/REMOTE) → triggered.
  return e.toUpperCase() !== "NONE";
}

/**
 * Map a VDA 5050 `State` message → the platform `RobotState` (which the existing
 * robotIngest writes into robot_telemetry).
 *
 *   - pose       ← agvPosition x/y/theta (Cartesian, frame = mapId)
 *   - mode       ← operatingMode
 *   - busy       ← driving (and not paused)
 *   - estop      ← safetyState.eStop !== "NONE" OR a FATAL error present
 *   - speedPct   ← magnitude of velocity (heuristic; no max speed in State)
 *   - error      ← first error / fieldViolation summary
 *   - payloadKg  ← not in State (loads have no standardized mass field) → undefined
 *   - battery    ← surfaced in pose JSON so it is persisted with the snapshot
 */
export function mapStateToRobotTelemetry(state: Vda5050State): RobotState {
  const pos = state.agvPosition;
  const fatal = (state.errors || []).filter((e) => e.errorLevel === "FATAL");
  const estop = isEstopActive(state) || fatal.length > 0;

  // Speed: VDA 5050 State has no speedPct; derive a rough 0..100 from velocity if
  // present (vx/vy in m/s). This is a display hint only and must be validated.
  let speedPct: number | undefined;
  const vel = state.velocity;
  if (vel && (vel.vx != null || vel.vy != null)) {
    const speed = Math.hypot(vel.vx ?? 0, vel.vy ?? 0);
    // Assume a nominal 2 m/s max for the percentage hint; clamp 0..100.
    speedPct = Math.max(0, Math.min(100, Math.round((speed / 2) * 100)));
  }

  const errorText = buildErrorText(state);

  // X1-a (doc 16 §5) — wire the AGV battery charge % through onto the canonical
  // RobotState so robotIngest persists robot_telemetry.battery_level. VDA5050
  // batteryCharge is already a percentage (0..100). Also keep it in the pose JSON
  // (unchanged) so the existing fleet allocator's pose-battery reader keeps working.
  const battery = extractBattery(state);

  return {
    mode: mapOperatingMode(state.operatingMode),
    busy: !!state.driving && !state.paused,
    estop,
    pose: pos
      ? {
          cartesian: { x: pos.x, y: pos.y, z: 0, rz: pos.theta },
          frame: pos.mapId,
          ...(battery.charge != null ? { battery: { charge: battery.charge, charging: battery.charging } } : {}),
        } as RobotState["pose"]
      : undefined,
    // payload mass is not part of VDA 5050 State — left undefined.
    payloadKg: undefined,
    speedPct,
    // X1-a — surface battery % as a first-class UDM field (honest undefined when absent).
    batteryPct: typeof battery.charge === "number" ? battery.charge : undefined,
    error: errorText,
    timestamp: parseTimestamp(state.timestamp),
  };
}

/** Compose a single error string from errors + safety field violation. */
export function buildErrorText(state: Vda5050State): string | undefined {
  const parts: string[] = [];
  for (const e of state.errors || []) {
    parts.push(`[${e.errorLevel}] ${e.errorType}${e.errorDescription ? `: ${e.errorDescription}` : ""}`);
  }
  if (state.safetyState?.fieldViolation) parts.push("safety field violation");
  return parts.length ? parts.join("; ") : undefined;
}

/** Battery/charge info pulled out so callers can persist or display it. */
export function extractBattery(state: Vda5050State): {
  charge?: number;
  charging?: boolean;
  voltage?: number;
} {
  const b = state.batteryState;
  if (!b) return {};
  return { charge: b.batteryCharge, charging: b.charging, voltage: b.batteryVoltage };
}

/** Connection → online boolean. Only "ONLINE" counts as online. */
export function mapConnectionToOnline(conn: Pick<Vda5050Connection, "connectionState">): boolean {
  return conn.connectionState === "ONLINE";
}

function parseTimestamp(ts: string | undefined): Date {
  if (!ts) return new Date();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? new Date() : d;
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDER builder
// ─────────────────────────────────────────────────────────────────────────────

let headerCounter = 0;
/** Per-process header id source (real deployments persist this per AGV/topic). */
export function nextHeaderId(): number {
  headerCounter += 1;
  return headerCounter;
}

export interface BuildOrderInput {
  manufacturer: string;
  serialNumber: string;
  orderId: string;
  orderUpdateId?: number;
  /** Target waypoints in map coordinates. First node is the AGV's current spot. */
  nodes: Array<{ nodeId: string; x: number; y: number; theta?: number; mapId: string; actions?: Vda5050Action[] }>;
  /** Optional explicit edges; if omitted, edges are auto-chained between nodes. */
  edges?: Vda5050Edge[];
  version?: string;
  headerId?: number;
  timestamp?: string;
}

/**
 * Build a syntactically valid VDA 5050 v2 `Order` from a simple node list.
 * All nodes/edges are `released: true` (eager release). For a real fleet you
 * typically release only the "base" portion and stream "horizon" updates — that
 * nuance is intentionally out of scope for this framework scaffold.
 */
export function buildOrder(input: BuildOrderInput): Vda5050Order {
  let seq = 0;
  const nodes: Vda5050Node[] = input.nodes.map((n) => ({
    nodeId: n.nodeId,
    sequenceId: seq++,
    released: true,
    nodePosition: { x: n.x, y: n.y, theta: n.theta, mapId: n.mapId },
    actions: n.actions ?? [],
  }));

  // Auto-chain edges between consecutive nodes when not supplied.
  let edges: Vda5050Edge[];
  if (input.edges) {
    edges = input.edges;
  } else {
    edges = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        edgeId: `${nodes[i].nodeId}->${nodes[i + 1].nodeId}`,
        sequenceId: seq++,
        released: true,
        startNodeId: nodes[i].nodeId,
        endNodeId: nodes[i + 1].nodeId,
        actions: [],
      });
    }
  }

  return {
    headerId: input.headerId ?? nextHeaderId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    version: input.version ?? VDA5050_VERSION,
    manufacturer: input.manufacturer,
    serialNumber: input.serialNumber,
    orderId: input.orderId,
    orderUpdateId: input.orderUpdateId ?? 0,
    nodes,
    edges,
  };
}

/**
 * Translate a platform RobotJobSpec into the node list for an Order.
 * Supports jobType "move" with params { nodes: [...] } or a single { x, y, theta, mapId }.
 * Returns null when the job cannot be expressed as a VDA 5050 order.
 */
export function jobToOrderNodes(
  params: Record<string, unknown> | undefined,
): BuildOrderInput["nodes"] | null {
  if (!params) return null;
  if (Array.isArray(params.nodes)) {
    const out: BuildOrderInput["nodes"] = [];
    for (const raw of params.nodes as Array<Record<string, unknown>>) {
      if (typeof raw?.x !== "number" || typeof raw?.y !== "number") return null;
      out.push({
        nodeId: String(raw.nodeId ?? `n${out.length}`),
        x: raw.x,
        y: raw.y,
        theta: typeof raw.theta === "number" ? raw.theta : undefined,
        mapId: String(raw.mapId ?? "map"),
      });
    }
    return out.length ? out : null;
  }
  if (typeof params.x === "number" && typeof params.y === "number") {
    return [
      {
        nodeId: "target",
        x: params.x,
        y: params.y,
        theta: typeof params.theta === "number" ? params.theta : undefined,
        mapId: String(params.mapId ?? "map"),
      },
    ];
  }
  return null;
}
