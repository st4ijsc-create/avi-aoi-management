/**
 * doc 40 W5 (MTX-12) — Universal Robots (UR) driver: wrap the existing UrsimClient
 * (URScript + Dashboard) as a first-class `RobotDriver` so a robots.vendor='ur' row
 * flows through the SAME registry → robotManager → robotCommandDispatcher (HITL /
 * dry-run) path as every other vendor. NO new dependency (UrsimClient is pure node:net).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY A BRIDGE (not a new driver): server/services/robot/ursim/ursimClient.ts already
 * speaks the three UR text interfaces correctly (primary/secondary 30001/30002 for
 * URScript, dashboard 29999 for load/play/stop/robotmode/programState/running). This
 * bridge only ADAPTS that client to the RobotDriver contract:
 *   • getState()  ← dashboard poll (robotmode / programState / running / safetystatus)
 *   • runJob()    → URScript over the secondary interface (gated; dry-run by default)
 *   • abort()     → dashboard `stop`
 *
 * HONESTY / NO-FAKE: connect() does a REAL dashboard reachability probe and throws when
 * URSim / the controller is unreachable (robotManager then logs "skipped"). runJob()
 * SELF-GUARDS: unless ROBOT_CONTROL_ENABLED=true it returns the URScript as INTENT
 * without opening the script socket (defence-in-depth behind the dispatcher gate).
 *
 * VALIDATION STATUS = 'assumed' (see robot/index.ts). The UR dashboard/URScript wire
 * formats are public + covered by mock-server unit tests (ursim.test.ts + this file's
 * test), but the end-to-end motion path is NOT yet validated on a real UR arm (HW-FAT).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { UrsimClient, UR_PORTS, type UrsimEndpoint } from "./ursim/ursimClient";
import { DeviceUnreachableError } from "../../_core/deviceErrors";
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth,
} from "./robotDriver";
import { abortThroughRunJob, AbortFence } from "./robotDriver";

/**
 * doc 81 Đợt 1B Task 5 fix round 1 (M5) — the UR Dashboard Server answers `stop` with the
 * literal "Stopped" on success and "Failed to execute: stop" otherwise (UR Dashboard Server
 * manual, command `stop`). Only the success literal counts as a confirmed stop.
 */
export function isUrStopConfirmed(reply: string): boolean {
  return /^Stopped\b/.test(String(reply ?? "").trim());
}

/**
 * The vendor key. 'ur' is NOT yet a member of the RobotVendor union / robotVendorEnum
 * (both in non-owned files — see this file's follow-up note). We register it via a cast;
 * the DB enum + union must gain 'ur' before a robots.vendor='ur' row can be stored.
 */
export const UR_VENDOR = "ur";

/** Parse "tcp://host:port" | "host:port" | "host" → {host, port?}. */
function parseHost(endpoint: string): { host: string; port?: number } {
  let s = String(endpoint ?? "").trim().replace(/^tcp:\/\//i, "");
  const idx = s.lastIndexOf(":");
  if (idx > 0) {
    const host = s.slice(0, idx);
    const port = Number(s.slice(idx + 1));
    if (host && Number.isFinite(port)) return { host, port };
  }
  return { host: s || "127.0.0.1" };
}

/**
 * doc 81 Đợt 1B Task 5 (R10b) — stable reason codes for a UR job refused BEFORE any socket.
 *   • ur_script_forbidden     — `params.script` (raw URScript) is never passed through: it
 *                               was an arbitrary-program channel via `robot.actuate`.
 *   • ur_home_param_forbidden — `params.home` from the caller used to become `movej(home)`,
 *                               i.e. an arbitrary joint target; home comes only from config.
 *   • ur_home_not_configured  — no valid `home` (6 finite joint values, rad) in the robot's
 *                               stored connectionOptions ⇒ no home move (the old default
 *                               all-zero pose is itself an unvalidated target).
 */
export type UrJobRefusalCode = "ur_script_forbidden" | "ur_home_param_forbidden" | "ur_home_not_configured";

export class UrJobRefusedError extends Error {
  constructor(readonly reasonCode: UrJobRefusalCode) {
    super(`${reasonCode}: UR job refused before any byte was sent`);
    this.name = "UrJobRefusedError";
  }
}

/** Parse a stored home pose: exactly 6 finite numbers, else undefined (= not configured). */
export function parseUrHome(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length !== 6) return undefined;
  const nums = value.map((n) => (typeof n === "number" ? n : Number.NaN));
  return nums.every((n) => Number.isFinite(n)) ? nums : undefined;
}

/**
 * Translate a platform RobotJobSpec → a URScript program string. Conservative +
 * exported for unit testing of the exact wire text. Joint moves use movej; cartesian
 * uses movel(p[...]). Throws {@link UrJobRefusedError} for `params.script` /
 * `params.home` and for a home job without a configured home (`opts.home`, from the
 * robot's STORED connectionOptions — never from the job).
 */
export function jobToUrscript(job: RobotJobSpec, opts: { home?: number[] } = {}): string {
  const p = job.params ?? {};
  if (Object.prototype.hasOwnProperty.call(p, "script")) throw new UrJobRefusedError("ur_script_forbidden");
  if (Object.prototype.hasOwnProperty.call(p, "home")) throw new UrJobRefusedError("ur_home_param_forbidden");
  const a = Number(p.accel ?? 1.4);
  const v = Number(p.speed ?? 1.05);
  const wrap = (stmt: string) => `def prog():\n  ${stmt}\nend\n`;
  switch (job.jobType) {
    case "home": {
      const j = parseUrHome(opts.home);
      if (!j) throw new UrJobRefusedError("ur_home_not_configured");
      return wrap(`movej([${sixNums(j)}], a=${a}, v=${v})`);
    }
    case "move":
    case "pick_place":
    case "dispense":
    case "screw": {
      if (Array.isArray(p.cartesian)) {
        const c = (p.cartesian as number[]).slice(0, 6).map((n) => Number(n) || 0);
        while (c.length < 6) c.push(0);
        return wrap(`movel(p[${c.join(", ")}], a=${a}, v=${v})`);
      }
      const j = Array.isArray(p.joints) ? (p.joints as number[]) : [0, 0, 0, 0, 0, 0];
      return wrap(`movej([${sixNums(j)}], a=${a}, v=${v})`);
    }
    case "abort":
      // Abort is issued via the dashboard `stop` (see abort()); this script is a fallback.
      return wrap(`halt`);
    case "custom":
    default:
      return wrap(`# no-op`);
  }
}

function sixNums(arr: number[]): string {
  return [0, 1, 2, 3, 4, 5].map((i) => Number(arr[i] ?? 0)).join(", ");
}

/** Map a UR `robotmode` reply → a coarse mode string for RobotState.mode. */
function decodeRobotMode(reply: string): string {
  const m = /Robotmode:\s*(\w+)/i.exec(reply);
  const raw = (m ? m[1] : reply || "").toUpperCase();
  if (raw === "RUNNING") return "auto";
  if (raw === "IDLE") return "idle";
  if (raw.includes("POWER_OFF")) return "power_off";
  return raw ? raw.toLowerCase() : "unknown";
}

export class UrsimBridgeDriver implements RobotDriver {
  // 'ur' is not (yet) in RobotVendor — cast so the class satisfies the contract. The
  // DB enum + union follow-up is documented; robotManager treats vendor as opaque.
  readonly vendor: RobotVendor = UR_VENDOR as RobotVendor;

  private client: UrsimClient | null = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  /** Home pose from the robot's STORED config (connectionOptions.home), never from a job. */
  private home: number[] | undefined;
  private readonly fence = new AbortFence();

  async connect(cfg: RobotConnectionConfig): Promise<void> {
    const { host, port } = parseHost(cfg.endpoint);
    const opts = cfg.options ?? {};
    this.home = parseUrHome(opts.home);
    const endpoint: UrsimEndpoint = {
      host,
      dashboardPort: numOr(opts.dashboardPort, port ?? UR_PORTS.dashboard),
      scriptPort: numOr(opts.scriptPort, UR_PORTS.secondary),
      timeoutMs: cfg.timeoutMs ?? 5000,
    };
    const client = new UrsimClient(endpoint);
    // HONEST reachability probe — the dashboard must answer, else we do NOT claim connected.
    const p = await client.ping();
    if (!p.reachable) {
      this.lastError = p.error ?? "UR dashboard unreachable";
      throw new Error(`UrsimBridge: ${this.lastError}`);
    }
    this.client = client;
    this.connected = true;
    this.connectedAt = new Date();
    this.lastOkAt = new Date();
    this.lastError = undefined;
  }

  async disconnect(): Promise<void> {
    // UrsimClient opens a socket per op (no persistent connection to tear down).
    this.client = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getState(): Promise<RobotState> {
    if (!this.connected || !this.client) throw new DeviceUnreachableError("ursimRobot");
    try {
      const [modeReply, running] = await Promise.all([
        this.client.robotMode(),
        this.client.isProgramRunning(),
      ]);
      // safetystatus is best-effort (older CB-series may not answer) — never fatal.
      let estop = false;
      try {
        const safety = await this.client.dashboard("safetystatus");
        estop = /EMERGENCY_STOP|PROTECTIVE_STOP/i.test(safety);
      } catch { /* leave estop=false (honest unknown) */ }
      this.lastOkAt = new Date();
      return {
        mode: decodeRobotMode(modeReply),
        busy: running,
        estop,
        timestamp: new Date(),
      };
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      throw err;
    }
  }

  async subscribeState(onState: OnRobotState, intervalMs = 5000): Promise<RobotStateHandle> {
    if (!this.connected) throw new DeviceUnreachableError("ursimRobot");
    const tick = async () => {
      try {
        const s = await this.getState();
        await onState(s);
      } catch {
        /* poll error recorded in lastError; never crash the loop */
      }
    };
    const timer = setInterval(() => void tick(), intervalMs > 0 ? intervalMs : 5000);
    if (typeof (timer as NodeJS.Timeout).unref === "function") (timer as NodeJS.Timeout).unref();
    return { close: async () => clearInterval(timer) };
  }

  /**
   * ⚠️ Reached ONLY via robotCommandDispatcher (HITL + mode gate). Self-guards: unless
   * ROBOT_CONTROL_ENABLED=true we return the URScript as intent WITHOUT sending it.
   */
  async runJob(job: RobotJobSpec): Promise<RobotJobResult> {
    if (!this.connected || !this.client) return { ok: false, status: "failed", error: "not connected" };
    // doc 81 Đợt 1B Task 5 fix round 1 — abort fence, checked inside sendScript after connect.
    const guard = this.fence.capture(job);

    // Abort routes through the dashboard `stop` (not a script) when control is enabled.
    let urscript: string;
    try {
      urscript = jobToUrscript(job, { home: this.home });
    } catch (err) {
      // doc 81 Đợt 1B Task 5 — refused BEFORE any socket, dry-run and live alike.
      if (err instanceof UrJobRefusedError) {
        this.lastError = err.message;
        return {
          ok: false,
          status: "failed",
          // data-raw-ok: chi tiết KỸ THUẬT cho kỹ sư (tham số nào bị từ chối), ĐI KÈM mã máy-đọc
          // detail.reasonCode (ur_script_forbidden / ur_home_param_forbidden…) để lớp trên/client
          // dịch; chuỗi gốc là bằng chứng truy nguyên trong robot_jobs.errorText.
          error: err.message,
          detail: { jobType: job.jobType, sent: false, reasonCode: err.reasonCode },
        };
      }
      throw err;
    }

    if (process.env.ROBOT_CONTROL_ENABLED !== "true") {
      return {
        ok: true,
        status: "done",
        detail: { dryRun: true, jobType: job.jobType, urscript, sent: false },
      };
    }

    try {
      if (job.jobType === "abort") {
        const reply = await this.client.stop();
        if (!isUrStopConfirmed(reply)) {
          const msg = `ur_stop_not_confirmed: dashboard replied "${reply}"`;
          this.lastError = msg;
          return { ok: false, status: "failed", error: msg, detail: { jobType: "abort", dashboard: reply, sent: true, reasonCode: "ur_stop_not_confirmed" } };
        }
        return { ok: true, status: "done", detail: { jobType: "abort", dashboard: reply, sent: true } };
      }
      const res = await this.client.sendScript(urscript, guard);
      return { ok: true, status: "done", detail: { jobType: job.jobType, urscript, ...res } };
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      this.lastError = msg;
      const reasonCode = (err as { reasonCode?: unknown })?.reasonCode;
      return {
        ok: false,
        status: "failed",
        error: msg,
        ...(typeof reasonCode === "string" ? { detail: { jobType: job.jobType, sent: false, reasonCode } } : {}),
      };
    }
  }

  /**
   * Abort via the dashboard `stop` (goes through the gated runJob path). doc 81 Đợt 1B
   * Task 5: a failed/unsent stop is SURFACED (throws), no longer swallowed.
   */
  async abort(): Promise<void> {
    this.fence.bump(); // FIRST: any job started before this abort can write nothing more
    await abortThroughRunJob((job) => this.runJob(job), "UR");
  }

  async health(): Promise<RobotHealth> {
    return {
      vendor: this.vendor,
      connected: this.connected,
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
    };
  }
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export const createUrsimBridge = (): RobotDriver => new UrsimBridgeDriver();
