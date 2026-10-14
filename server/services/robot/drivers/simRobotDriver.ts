/**
 * Phase 3 — Simulated robot driver. Fully functional WITHOUT hardware.
 *
 * Produces deterministic state (a slowly moving pose, never e-stopped) and
 * "executes" motion jobs by returning success after a short delay. Used to E2E
 * the pipeline registry → state telemetry → job log before real robots arrive.
 *
 * doc 81 Đợt 12 task N (OWNER-SETUP B2) — a REAL motion lock (robotDriver.ts MotionLock, ruling R13), exposed through the
 * SAME optional interface as the session drivers (MELFA / Delta / FANUC): getMotionLock · clearMotionLock (compare-and-clear,
 * audited by the caller) · lockMotion · motionLockController. So robotManager restores / persists a sim robot's lock like any
 * other (central: robot_motion_locks; edge: the journal), an edge-owned sim robot can take the signed clear and move (it was
 * STOP-only: the edge answered `refused:no_driver`), and central can adopt and clear the `ownerChanged` relock of a sim robot
 * released from an edge. While locked a MOTION job is refused before anything is "sent"; a STOP is never refused (L-7) and a
 * DONE STOP (runJob abort / abort()) clears the lock — except an operator hold (M-5). One lock per driver instance (the one
 * motionLockController() returns). Unlocked, the sim behaves exactly as before.
 */
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth, MotionLockState,
} from "../robotDriver";
import { MotionLock } from "../robotDriver";
import { isStopJob } from "../stopJob";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";

export class SimRobotDriver implements RobotDriver {
  readonly vendor: RobotVendor = "sim";
  private connected = false;
  private connectedAt: Date | null = null;
  private busy = false;
  /** doc 81 Đợt 12 N — this robot's motion lock (see the header). */
  private readonly motionLock = new MotionLock();

  async connect(_cfg: RobotConnectionConfig): Promise<void> {
    this.connected = true;
    this.connectedAt = new Date();
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }

  private snapshot(): RobotState {
    const t = Date.now() / 1000;
    const joints = [0, 1, 2, 3, 4, 5].map((j) => Math.round(Math.sin(t * 0.1 + j) * 90 * 1e3) / 1e3);
    return {
      mode: "auto",
      busy: this.busy,
      estop: false,
      pose: { joints, frame: "base" },
      payloadKg: 0,
      speedPct: 50,
      timestamp: new Date(),
    };
  }

  async getState(): Promise<RobotState> {
    if (!this.connected) throw new DeviceUnreachableError("simRobot");
    return this.snapshot();
  }

  async subscribeState(onState: OnRobotState, intervalMs = 5000): Promise<RobotStateHandle> {
    if (!this.connected) throw new DeviceUnreachableError("simRobot");
    const timer = setInterval(() => {
      try {
        void onState(this.snapshot());
      } catch {
        /* ignore callback errors */
      }
    }, intervalMs > 0 ? intervalMs : 5000);
    if (typeof timer.unref === "function") timer.unref();
    return { close: async () => clearInterval(timer) };
  }

  async runJob(job: RobotJobSpec): Promise<RobotJobResult> {
    if (!this.connected) return { ok: false, status: "failed", error: "not connected" };
    // Đợt 12 N — MOTION LOCK: a motion is refused before anything is "sent"; a STOP never is (L-7).
    const refused = this.motionLock.refusal(job);
    if (refused) return refused;
    this.busy = true;
    await new Promise((r) => setTimeout(r, 200));
    this.busy = false;
    // Đợt 12 N — a STOP done by the (simulated) controller is a CONFIRMED STOP: it clears the lock (never an operator hold).
    if (isStopJob(job)) this.motionLock.clearByStop();
    return { ok: true, status: "done", detail: { jobType: job.jobType, simulated: true } };
  }

  async abort(): Promise<void> {
    this.busy = false;
    if (this.connected) this.motionLock.clearByStop(); // Đợt 12 N — a confirmed STOP
  }

  /** doc 81 Đợt 12 N — motion lock snapshot (dispatcher gate 3, robot.list `live`). */
  getMotionLock(): MotionLockState {
    return this.motionLock.snapshot();
  }

  /** doc 81 Đợt 12 N — operator compare-and-clear; the caller (robot.clearMotionLock / the edge's signed clear) audited it. */
  clearMotionLock(input: { reason: string; userId: number; expectedGeneration: number }): MotionLockState {
    return this.motionLock.clearByOperator(input);
  }

  /** doc 81 Đợt 12 N — the dispatcher locks here when ITS deadline made a motion's outcome unknown. */
  lockMotion(reasonCode: string, detail?: string): void {
    this.motionLock.lock(reasonCode, detail);
  }

  /** doc 81 Đợt 12 N — the lock itself (robotManager restores a persisted lock + attaches persistence; the edge seeds it). */
  motionLockController(): MotionLock {
    return this.motionLock;
  }

  async health(): Promise<RobotHealth> {
    return { vendor: "sim", connected: this.connected, lastOkAt: this.connectedAt ?? undefined };
  }
}

export const createSimRobotDriver = () => new SimRobotDriver();
