/**
 * Phase 3 — Simulated robot driver. Fully functional WITHOUT hardware.
 *
 * Produces deterministic state (a slowly moving pose, never e-stopped) and
 * "executes" motion jobs by returning success after a short delay. Used to E2E
 * the pipeline registry → state telemetry → job log before real robots arrive.
 */
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth,
} from "../robotDriver";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";

export class SimRobotDriver implements RobotDriver {
  readonly vendor: RobotVendor = "sim";
  private connected = false;
  private connectedAt: Date | null = null;
  private busy = false;

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
    this.busy = true;
    await new Promise((r) => setTimeout(r, 200));
    this.busy = false;
    return { ok: true, status: "done", detail: { jobType: job.jobType, simulated: true } };
  }

  async abort(): Promise<void> {
    this.busy = false;
  }

  async health(): Promise<RobotHealth> {
    return { vendor: "sim", connected: this.connected, lastOkAt: this.connectedAt ?? undefined };
  }
}

export const createSimRobotDriver = () => new SimRobotDriver();
