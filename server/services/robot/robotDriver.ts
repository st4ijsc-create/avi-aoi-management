/**
 * Phase 3 — Robotics framework: driver contract + value types.
 *
 * A `RobotDriver` abstracts ONE robot connection for ONE vendor (Fanuc,
 * Mitsubishi MELFA, Delta, Techman cobot, or `sim`). Only `sim` runs fully;
 * vendor drivers are scaffolds (connect throws "not installed") until the real
 * SDK/protocol library + hardware are wired. Motion commands (runJob) are gated
 * by robotCommandDispatcher (dry-run by default).
 */
export type RobotVendor = "fanuc" | "mitsubishi" | "delta" | "techman" | "sim";

export type RobotJobType = "move" | "pick_place" | "dispense" | "screw" | "home" | "abort" | "custom";

export interface RobotPose {
  joints?: number[];
  cartesian?: { x: number; y: number; z: number; rx?: number; ry?: number; rz?: number };
  frame?: string;
}

/** A snapshot of robot status (polled into robot_telemetry). */
export interface RobotState {
  mode?: string;        // auto / manual / teach
  busy?: boolean;
  estop?: boolean;
  pose?: RobotPose;
  payloadKg?: number;
  speedPct?: number;
  error?: string;
  // X1-a (doc 16 §5) — UDM/UEM extension fields. All OPTIONAL + best-effort: a driver
  // that has no value leaves them undefined (an honest NULL in robot_telemetry), never
  // fabricated. batteryPct is wired from the VDA5050 battery extraction for AGVs;
  // jointStates/firmwareVersion are SEAMS (only populated when a driver provides them).
  batteryPct?: number;                       // 0..100 charge %
  jointStates?: Array<Record<string, unknown>>; // per-joint pos/vel (seam)
  safetyZoneId?: number;                     // zone the device occupies (best-effort)
  firmwareVersion?: string;                  // device firmware (seam)
  timestamp: Date;
}

export interface RobotConnectionConfig {
  endpoint: string;
  options?: Record<string, unknown>;
  timeoutMs?: number;
}

/** A motion job request. `params` shape depends on jobType (poses, targets, …). */
export interface RobotJobSpec {
  jobType: RobotJobType;
  params?: Record<string, unknown>;
}

export interface RobotJobResult {
  ok: boolean;
  status: "done" | "failed";
  detail?: Record<string, unknown>;
  error?: string;
}

export interface RobotHealth {
  vendor: RobotVendor;
  connected: boolean;
  lastOkAt?: Date;
  lastError?: string;
  latencyMs?: number;
}

export interface RobotStateHandle {
  close(): Promise<void>;
}

export type OnRobotState = (state: RobotState) => void | Promise<void>;

/** Driver contract. One instance ↔ one robot connection. */
export interface RobotDriver {
  readonly vendor: RobotVendor;
  connect(cfg: RobotConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getState(): Promise<RobotState>;
  subscribeState(onState: OnRobotState, intervalMs?: number): Promise<RobotStateHandle>;
  runJob(job: RobotJobSpec): Promise<RobotJobResult>;
  abort(): Promise<void>;
  health(): Promise<RobotHealth>;
}

export type RobotDriverFactory = () => RobotDriver;
