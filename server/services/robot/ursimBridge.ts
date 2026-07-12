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
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth,
} from "./robotDriver";

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
 * Translate a platform RobotJobSpec → a URScript program string. Conservative +
 * exported for unit testing of the exact wire text. `params.script` (raw URScript) is
 * passed through for 'custom'. Joint moves use movej; cartesian uses movel(p[...]).
 */
export function jobToUrscript(job: RobotJobSpec): string {
  const p = job.params ?? {};
  const a = Number(p.accel ?? 1.4);
  const v = Number(p.speed ?? 1.05);
  const wrap = (stmt: string) => `def prog():\n  ${stmt}\nend\n`;
  switch (job.jobType) {
    case "home": {
      const j = Array.isArray(p.home) ? (p.home as number[]) : [0, 0, 0, 0, 0, 0];
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
      return typeof p.script === "string" ? String(p.script) : wrap(`# no-op`);
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

  async connect(cfg: RobotConnectionConfig): Promise<void> {
    const { host, port } = parseHost(cfg.endpoint);
    const opts = cfg.options ?? {};
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
    if (!this.connected || !this.client) throw new Error("UrsimBridge: not connected");
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
    if (!this.connected) throw new Error("UrsimBridge: not connected");
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

    // Abort routes through the dashboard `stop` (not a script) when control is enabled.
    const urscript = jobToUrscript(job);

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
        return { ok: true, status: "done", detail: { jobType: "abort", dashboard: reply, sent: true } };
      }
      const res = await this.client.sendScript(urscript);
      return { ok: true, status: "done", detail: { jobType: job.jobType, urscript, ...res } };
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      this.lastError = msg;
      return { ok: false, status: "failed", error: msg };
    }
  }

  /** Best-effort abort via the dashboard `stop` (goes through the gated runJob path). */
  async abort(): Promise<void> {
    try {
      await this.runJob({ jobType: "abort" });
    } catch { /* best-effort */ }
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
