/**
 * Phase 3 — Robotics framework: driver contract + value types.
 *
 * A `RobotDriver` abstracts ONE robot connection for ONE vendor (Fanuc,
 * Mitsubishi MELFA, Delta, Techman cobot, or `sim`). Only `sim` runs fully;
 * vendor drivers are scaffolds (connect throws "not installed") until the real
 * SDK/protocol library + hardware are wired. Motion commands (runJob) are gated
 * by robotCommandDispatcher (dry-run by default).
 */
// "vda5050" (AGV/AMR over the open VDA 5050 MQTT standard) is a first-class vendor
// as of doc 24 C4 (DB enum widened by migration 0161). Its driver lives under
// server/services/vda5050 and is registered into the driver registry on import.
export type RobotVendor = "fanuc" | "mitsubishi" | "delta" | "techman" | "sim" | "vda5050" | "ur";

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
  /**
   * Stop the robot's current motion. doc 81 Đợt 1B Task 5 — MUST surface failure:
   * resolves ONLY when the stop was sent and acknowledged; rejects with
   * {@link RobotAbortUnsupportedError} when the driver has no stop command, and with
   * any other error (typically {@link RobotAbortFailedError}) when the stop failed.
   * (It used to swallow every failure — the dispatcher's timeout path could not tell.)
   */
  abort(): Promise<void>;
  health(): Promise<RobotHealth>;
}

/** Driver has no stop/abort command at all (dispatcher records `abort_unsupported`). */
export class RobotAbortUnsupportedError extends Error {
  readonly reasonCode = "abort_unsupported" as const;
  constructor(vendor: string) {
    super(`abort_unsupported: ${vendor} driver has no stop/abort command`);
    this.name = "RobotAbortUnsupportedError";
  }
}

/** The stop/abort was attempted but not confirmed (dispatcher records `abort_failed`). */
export class RobotAbortFailedError extends Error {
  readonly reasonCode = "abort_failed" as const;
  constructor(message: string, readonly detail?: Record<string, unknown>) {
    super(message);
    this.name = "RobotAbortFailedError";
  }
}

/**
 * Shared abort for drivers whose stop is a gated `runJob({jobType:"abort"})`: runs it and
 * THROWS unless the stop really went out and was acknowledged (a `failed` verdict or a
 * dry-run intent is NOT a stop).
 */
export async function abortThroughRunJob(
  runJob: (job: RobotJobSpec) => Promise<RobotJobResult>,
  label: string,
): Promise<void> {
  const r = await runJob({ jobType: "abort" });
  if (!r.ok) {
    throw new RobotAbortFailedError(`${label} abort failed: ${r.error ?? "no reason given"}`, r.detail);
  }
  if (r.detail?.dryRun === true) {
    throw new RobotAbortFailedError(`${label} abort not sent (dry-run: ROBOT_CONTROL_ENABLED is not true)`, r.detail);
  }
}

/**
 * Driver-level failure reason codes that mean "the command may be executing on the robot,
 * outcome unknown" (reply never arrived / connection dropped mid-command). The dispatcher
 * treats them like its own deadline: it sends the driver's stop before recording `failed`.
 */
export const MOTION_OUTCOME_UNKNOWN_REASON_CODES: ReadonlySet<string> = new Set([
  "line_reply_timeout",     // TcpLineClient (MELFA / Delta): no reply line in time
  "line_connection_closed", // TcpLineClient: peer closed / socket error while a command was pending
  "rmi_reply_timeout",      // FANUC RMI: no reply packet in time
  "tm_reply_timeout",       // Techman Listen Node (Task 4 classification)
  "tm_connection_closed",   // Techman Listen Node closed before a complete reply
]);

/**
 * doc 81 Đợt 1B Task 5 fix round 1 — a job still running when abort() was called must not
 * put ANY further byte on the wire (the dispatcher abandons a timed-out runJob, but the
 * promise keeps going: FANUC GetStatus→Abort→Initialize→motion, Techman/UR connect phase,
 * MELFA/Delta reconnect window). Rejection reason of such a write.
 */
export class RobotJobFencedError extends Error {
  readonly reasonCode = "job_fenced_by_abort" as const;
  constructor() {
    super("job_fenced_by_abort: an abort was issued after this job started — no further bytes are sent");
    this.name = "RobotJobFencedError";
  }
}

/**
 * Abort epoch shared by every robot driver. `abort()` calls `bump()` FIRST (synchronously,
 * before its own stop goes out); `runJob()` calls `capture()` at its start and invokes the
 * returned guard immediately before every socket write — a changed epoch throws
 * {@link RobotJobFencedError}, so no motion byte can follow the stop.
 */
export class AbortFence {
  private epoch = 0;
  bump(): void {
    this.epoch++;
  }
  capture(): () => void {
    const at = this.epoch;
    return () => {
      if (this.epoch !== at) throw new RobotJobFencedError();
    };
  }
}

export type RobotDriverFactory = () => RobotDriver;
