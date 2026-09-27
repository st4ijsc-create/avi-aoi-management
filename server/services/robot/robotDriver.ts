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
  /**
   * doc 81 Đợt 1B Task 5 fix round 4 (ruling R13) — MOTION LOCK. Drivers with a persistent
   * transport session (MELFA / Delta / FANUC) set it on a peer drop and on any reset that leaves a
   * motion's outcome unknown; while set, MOTION jobs are refused before any byte is written even
   * once the transport is up again. It clears ONLY when a STOP is delivered and confirmed by the
   * driver, or when an authorised operator clears it (`robot.clearMotionLock`, audited). Optional:
   * one-shot-socket drivers (Techman / UR) and sim/AGV drivers have no session to lose.
   */
  getMotionLock?(): MotionLockState;
  /**
   * Fix round 5 — compare-and-clear: clears ONLY if `expectedGeneration` (the generation the
   * operator saw) still matches; otherwise throws {@link MotionLockConflictError} with the new state.
   */
  clearMotionLock?(input: { reason: string; userId: number; expectedGeneration: number }): MotionLockState;
  /**
   * Fix round 5 (c) — set the motion lock from outside the driver: the dispatcher calls it when its
   * own deadline makes a motion's outcome unknown, BEFORE it sends the stop. Drivers without a
   * lock (Techman / UR) simply do not implement it.
   */
  lockMotion?(reasonCode: string, detail?: string): void;
}

/** Snapshot of a driver's motion lock (also what the UI reads through robot.list `live`). */
export interface MotionLockState {
  locked: boolean;
  /** Reason code that set the lock (e.g. line_connection_closed, rmi_reply_timeout). */
  reasonCode?: string;
  detail?: string;
  /** ISO time the lock was set. */
  since?: string;
  /** Fix round 5 — increments on every unlocked→locked transition; the operator's clear must quote it. */
  generation?: number;
  clearedBy?: "stop_confirmed" | "operator";
  clearedAt?: string;
  clearedByUserId?: number;
  clearReason?: string;
}

/** Fix round 5 (c) — reason code the dispatcher locks with when ITS deadline made the outcome unknown. */
export const DISPATCH_DEADLINE_REASON_CODE = "dispatch_deadline_outcome_unknown" as const;

/** Fix round 5 — the operator's clear quoted a generation that is no longer current (a new link loss happened). */
export class MotionLockConflictError extends Error {
  readonly reasonCode = "motion_lock_changed" as const;
  constructor(readonly state: MotionLockState) {
    super(
      `motion_lock_changed: the motion lock changed while the clear was being confirmed — now generation ${state.generation ?? "?"}` +
        ` (${state.reasonCode ?? "link loss"} since ${state.since ?? "?"}); re-read the state before clearing`,
    );
    this.name = "MotionLockConflictError";
  }
}

/** Stable reason code: a motion job refused because the driver's motion lock is set. */
export const MOTION_LOCKED_REASON_CODE = "motion_locked_after_link_loss" as const;

export class RobotMotionLockedError extends Error {
  readonly reasonCode = MOTION_LOCKED_REASON_CODE;
  constructor(readonly lock: MotionLockState) {
    super(
      `${MOTION_LOCKED_REASON_CODE}: motion is locked since ${lock.since ?? "?"} (${lock.reasonCode ?? "link loss"}) — ` +
        "a confirmed STOP or an authorised operator must clear it before any motion is sent",
    );
    this.name = "RobotMotionLockedError";
  }
}

/**
 * doc 81 Đợt 1B Task 5 fix round 4 (R13) — per-driver motion lock. Separate from "transport up":
 * a read-only poll may re-establish the session, but motion stays refused until `clearByStop()`
 * (a STOP delivered AND confirmed by the driver) or `clearByOperator()` (audited tRPC mutation).
 * `lock()` keeps the FIRST cause while already locked (repeated link-loss events do not rewrite it).
 */
export class MotionLock {
  private state: MotionLockState = { locked: false, generation: 0 };
  private generation = 0;

  lock(reasonCode: string, detail?: string): void {
    if (this.state.locked) return;
    this.generation++;
    this.state = { locked: true, reasonCode, detail, since: new Date().toISOString(), generation: this.generation };
  }

  clearByStop(): void {
    if (!this.state.locked) return;
    this.state = {
      locked: false,
      reasonCode: this.state.reasonCode,
      since: this.state.since,
      generation: this.generation,
      clearedBy: "stop_confirmed",
      clearedAt: new Date().toISOString(),
    };
  }

  /**
   * Fix round 5 — COMPARE-AND-CLEAR. `expectedGeneration` is the generation the operator saw when
   * they confirmed; a link loss that happened since (dialog open, audit write in flight) bumped it,
   * and that newer lock must not be erased by a decision taken about the older one.
   */
  clearByOperator(input: { reason: string; userId: number; expectedGeneration: number }): MotionLockState {
    if (this.state.locked && input.expectedGeneration !== this.generation) {
      throw new MotionLockConflictError(this.snapshot());
    }
    this.state = {
      locked: false,
      reasonCode: this.state.reasonCode,
      since: this.state.since,
      generation: this.generation,
      clearedBy: "operator",
      clearedAt: new Date().toISOString(),
      clearedByUserId: input.userId,
      clearReason: input.reason,
    };
    return this.snapshot();
  }

  isLocked(): boolean {
    return this.state.locked;
  }

  snapshot(): MotionLockState {
    return { ...this.state };
  }

  /**
   * Fix round 5 (b) — the per-write guard. Wraps the abort-fence guard and RE-CHECKS the lock right
   * before every socket write, so a motion job that passed the entry check cannot write once the lock
   * is set mid-job (the entry check alone left the window the reviewer traced). STOP jobs never throw.
   */
  guard(job: RobotJobSpec, inner: () => void): () => void {
    return () => {
      inner();
      if (this.state.locked && job.jobType !== "abort") throw new RobotMotionLockedError(this.snapshot());
    };
  }

  /** The RobotJobResult a driver returns for a MOTION job while locked; null when the job may proceed. */
  refusal(job: RobotJobSpec): RobotJobResult | null {
    if (!this.state.locked || job.jobType === "abort") return null;
    const err = new RobotMotionLockedError(this.snapshot());
    return {
      ok: false,
      status: "failed",
      // data-raw-ok: chi tiết KỸ THUẬT cho kỹ sư (vì sao/từ lúc nào khoá), ĐI KÈM mã máy-đọc
      // detail.reasonCode (robot_motion_locked) + motionLock để client dịch/hiển thị; chuỗi gốc
      // là bằng chứng truy nguyên trong robot_jobs.errorText.
      error: err.message,
      detail: { jobType: job.jobType, reasonCode: MOTION_LOCKED_REASON_CODE, motionLock: this.snapshot(), sent: false },
    };
  }
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
  "line_connection_reset",  // TcpLineClient: connection reset (e.g. a concurrent poll timed out) under a command
  "rmi_reply_timeout",      // FANUC RMI: no reply packet in time
  "rmi_connection_closed",  // FANUC RMI: socket dropped while a request was pending
  "rmi_session_reset",      // FANUC RMI: session reset (another request timed out) under a command
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
 * before its own stop goes out); `runJob()` calls `capture(job)` at its start and invokes the
 * returned guard immediately before every socket write — a changed epoch throws
 * {@link RobotJobFencedError}, so no motion byte can follow the stop.
 *
 * Fix round 2 — the invariant is "no MOTION byte after a STOP", so an `abort` job gets a
 * no-op guard: a second abort() must never fence the first abort's STOP.
 */
export class AbortFence {
  private epoch = 0;
  bump(): void {
    this.epoch++;
  }
  capture(job: RobotJobSpec): () => void {
    if (job.jobType === "abort") return () => undefined;
    const at = this.epoch;
    return () => {
      if (this.epoch !== at) throw new RobotJobFencedError();
    };
  }
}

export type RobotDriverFactory = () => RobotDriver;
