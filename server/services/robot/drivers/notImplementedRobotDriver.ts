/**
 * Base for vendor robot drivers that are not yet wired to a real SDK/device.
 * `connect()` throws so the robotManager skips the robot without crashing.
 */
import type {
  RobotVendor, RobotDriver, RobotConnectionConfig, RobotState,
  RobotStateHandle, OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth,
} from "../robotDriver";
import { RobotAbortUnsupportedError } from "../robotDriver";
import { DeviceProtocolUnsupportedError, KHOA_THUC_THE_ROBOT } from "../../../_core/deviceErrors";

export class NotImplementedRobotDriver implements RobotDriver {
  constructor(
    public readonly vendor: RobotVendor,
    private readonly reason: string,
  ) {}

  async connect(_cfg: RobotConnectionConfig): Promise<void> {
    throw new DeviceProtocolUnsupportedError(KHOA_THUC_THE_ROBOT[this.vendor] ?? this.vendor, this.reason);
  }
  async disconnect(): Promise<void> {}
  isConnected(): boolean {
    return false;
  }
  async getState(): Promise<RobotState> {
    throw new DeviceProtocolUnsupportedError(KHOA_THUC_THE_ROBOT[this.vendor] ?? this.vendor, this.reason);
  }
  async subscribeState(_onState: OnRobotState, _intervalMs?: number): Promise<RobotStateHandle> {
    throw new DeviceProtocolUnsupportedError(KHOA_THUC_THE_ROBOT[this.vendor] ?? this.vendor, this.reason);
  }
  async runJob(_job: RobotJobSpec): Promise<RobotJobResult> {
    return { ok: false, status: "failed", error: `${this.vendor} driver not available: ${this.reason}` };
  }
  // doc 81 Đợt 1B Task 5 — no stop exists here; never pretend one was sent.
  async abort(): Promise<void> {
    throw new RobotAbortUnsupportedError(this.vendor);
  }
  async health(): Promise<RobotHealth> {
    return { vendor: this.vendor, connected: false, lastError: this.reason };
  }
}
