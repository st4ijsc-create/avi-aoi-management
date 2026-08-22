/**
 * Phase 3 — Techman (TM) cobot driver — REAL (framework-level) implementation.
 *
 * This is the first vendor robot driver wired end-to-end (per audit doc 07 §②:
 * "wire one real robot vendor to validate the dry-run→live path"). The other
 * vendor drivers (Fanuc RMI, Mitsubishi MELFA R3, Delta ASCII/TCP) are now wired
 * end-to-end too (doc 24 C4 + Tier-2).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * INTEGRATION APPROACH (TM Robot / TMflow)
 *   • TELEMETRY (read-only): TMflow runs a **Modbus TCP server** on the
 *     controller (default port 502). We read holding/input registers that
 *     expose robot state (running/error/e-stop flags, mode, speed, TCP/joint
 *     pose) and map them to the platform `RobotState` shape. We REUSE the
 *     modbus-serial lazy-load pattern from server/services/ot/drivers/modbusDriver.ts.
 *   • MOTION (commands): TM external motion uses an Ethernet **"Listen Node"** —
 *     a TCP socket inside a TMflow project that speaks the TMSCT / TMSTA
 *     string protocol. We build a TMSCT command string and (only when control
 *     is enabled) send it over a short-lived socket. The HITL + dry-run gating
 *     lives in robotCommandDispatcher; this driver's runJob() is reached ONLY
 *     from that dispatcher, and additionally self-guards (no socket unless
 *     ROBOT_CONTROL_ENABLED) as defence-in-depth.
 *
 * ⚠️⚠️ HONESTY CAVEAT — VALIDATE AGAINST REAL HARDWARE ⚠️⚠️
 *   The Modbus register map (MODBUS_REGISTERS below) and the TMSCT string
 *   format are *reasonable assumptions* written WITHOUT access to a live TM
 *   controller or the proprietary TMflow Modbus/Expression-Editor docs. The
 *   addresses, word counts, scaling and TMSCT script syntax MUST be verified
 *   and corrected against the actual TMflow "Modbus Slave" table and the
 *   project's Listen Node before this is trusted on real hardware. They are
 *   intentionally collected in a single editable table + helpers so a real
 *   deployment can fix them in one place. Until then, treat live motion as
 *   UNVALIDATED — keep ROBOT_CONTROL_ENABLED=false (dry-run).
 * ──────────────────────────────────────────────────────────────────────────
 */
import { createConnection } from "node:net";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth,
} from "../robotDriver";

/**
 * ─── TMflow Modbus register map (ASSUMED — EDIT FOR YOUR DEPLOYMENT) ────────
 * One editable table. Addresses are 0-based Modbus register numbers as the
 * modbus-serial client expects them (NOT the 4xxxx convention). `kind` selects
 * holding vs input registers; `words` is how many 16-bit registers to read.
 *
 * The defaults below are placeholders chosen to be plausible and self-consistent
 * for the decoders in this file; they are NOT taken from a real TM unit. Real
 * TMflow exposes a configurable "Modbus Slave" table — map these to whatever
 * coils/registers that project publishes.
 */
export const MODBUS_REGISTERS = {
  /** Controller "is running / in motion" flag (0/1). */
  running:   { addr: 7000, kind: "input" as const, words: 1 },
  /** Robot fault/error code (0 = no error). */
  errorCode: { addr: 7001, kind: "input" as const, words: 1 },
  /** Emergency-stop engaged flag (0/1). */
  estop:     { addr: 7002, kind: "input" as const, words: 1 },
  /**
   * Operating mode code. ASSUMED encoding: 0=auto/play, 1=manual/teach, 2=stop.
   * (TMflow distinguishes Auto vs Manual; confirm the published code.)
   */
  modeCode:  { addr: 7003, kind: "input" as const, words: 1 },
  /** Global speed/project-speed percentage (0..100). */
  speedPct:  { addr: 7004, kind: "input" as const, words: 1 },
  /**
   * 6 joint angles. ASSUMED encoding: signed int16, units = 0.01 degree
   * (i.e. divide raw by 100 to get degrees). 6 consecutive registers.
   */
  joints:    { addr: 7010, kind: "input" as const, words: 6 },
} as const;

/** Scale applied to raw joint registers → degrees (see MODBUS_REGISTERS.joints). */
export const JOINT_SCALE = 0.01;
/** Modbus unit/slave id default for the TM controller. */
const DEFAULT_UNIT_ID = 1;
/** TMflow Modbus TCP server default port. */
const DEFAULT_MODBUS_PORT = 502;
/** TM Listen Node default TCP port (configured per TMflow project; verify). */
const DEFAULT_LISTEN_PORT = 5890;

/** Treat a signed 16-bit value (modbus-serial returns 0..65535). */
function toSignedInt16(v: number): number {
  return v > 0x7fff ? v - 0x10000 : v;
}

/**
 * Map an ASSUMED mode code → the human-readable mode string used by telemetry.
 * Editable alongside MODBUS_REGISTERS.modeCode encoding.
 */
function decodeMode(code: number): string {
  switch (code) {
    case 0: return "auto";
    case 1: return "manual";
    case 2: return "stop";
    default: return `mode${code}`;
  }
}

/**
 * Build a TMSCT command string for the TM Listen Node.
 *
 * ASSUMED TMSCT FRAME (verify against TMflow External Script docs):
 *   $TMSCT,<len>,<id>,<script>,*<checksum>\r\n
 *   - <len>   : byte length of the "<id>,<script>" payload
 *   - <id>    : a transaction id (we use a monotonic counter)
 *   - <script>: TM script statement(s), e.g. "PTP(\"JPP\",j0,..,j5,vel,acc,0,false)"
 *   - <checksum>: XOR of the payload bytes, two-digit upper-hex
 *
 * We translate the platform RobotJobSpec into a single script statement. This
 * mapping is deliberately conservative and MUST be aligned with the real
 * Listen Node project (the project decides which script commands it accepts).
 *
 * Exported for unit testing of the exact wire format.
 */
export function buildTmsct(job: RobotJobSpec, id: number): string {
  const script = jobToScript(job);
  const payload = `${id},${script}`;
  const checksum = xorChecksum(payload);
  return `$TMSCT,${payload.length},${payload},*${checksum}\r\n`;
}

/** XOR-checksum of payload bytes, two-digit upper-hex (ASSUMED — verify). */
export function xorChecksum(payload: string): string {
  let x = 0;
  for (let i = 0; i < payload.length; i++) x ^= payload.charCodeAt(i);
  return x.toString(16).toUpperCase().padStart(2, "0");
}

/** Translate a RobotJobSpec → a single TM script statement (ASSUMED syntax). */
function jobToScript(job: RobotJobSpec): string {
  const p = job.params ?? {};
  switch (job.jobType) {
    case "home":
      // Move to the project "Home" point (TM convention: a named point).
      return `PTP("JPP",0,0,0,0,0,0,35,200,0,false)`;
    case "move":
    case "pick_place":
    case "dispense":
    case "screw": {
      const j = Array.isArray(p.joints) ? (p.joints as number[]) : [0, 0, 0, 0, 0, 0];
      const jj = [0, 1, 2, 3, 4, 5].map((i) => Number(j[i] ?? 0));
      const vel = Number(p.velPct ?? 35);
      const acc = Number(p.accMs ?? 200);
      return `PTP("JPP",${jj.join(",")},${vel},${acc},0,false)`;
    }
    case "abort":
      return `StopAndClearBuffer()`;
    case "custom":
    default:
      // Pass an explicit TM script through if the caller provided one.
      return typeof p.script === "string" ? p.script : `ScriptExit()`;
  }
}

export class TechmanDriver implements RobotDriver {
  readonly vendor: RobotVendor = "techman";

  private mbClient: any = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  private listenHost = "127.0.0.1";
  private listenPort = DEFAULT_LISTEN_PORT;
  private timeoutMs = 5000;
  private unitId = DEFAULT_UNIT_ID;
  private tmsctSeq = 1;

  /** Lazy-load modbus-serial (optional dep). Returns the ctor or null. */
  private async loadModbus(): Promise<any> {
    const pkg = "modbus-serial";
    const mod: any = await import(pkg).catch(() => null);
    if (!mod) return null;
    return mod.default ?? mod;
  }

  /** Parse "tcp://host:port" | "host:port" | "host" → {host,port}. */
  private parseEndpoint(endpoint: string, defaultPort: number): { host: string; port: number } {
    let s = String(endpoint ?? "").trim().replace(/^tcp:\/\//i, "");
    const idx = s.lastIndexOf(":");
    if (idx > 0) {
      const host = s.slice(0, idx);
      const port = Number(s.slice(idx + 1));
      if (host && Number.isFinite(port)) return { host, port };
    }
    return { host: s || "127.0.0.1", port: defaultPort };
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms)),
    ]);
  }

  async connect(cfg: RobotConnectionConfig): Promise<void> {
    const ModbusRTU = await this.loadModbus();
    if (!ModbusRTU) {
      // Degrade gracefully — robotManager logs "skipped" and never crashes.
      throw new Error("modbus-serial not installed");
    }
    const opts = cfg.options ?? {};
    this.timeoutMs = cfg.timeoutMs ?? 5000;
    this.unitId = typeof opts.unitId === "number" ? opts.unitId : DEFAULT_UNIT_ID;

    const mbPort = typeof opts.port === "number" ? opts.port : DEFAULT_MODBUS_PORT;
    const { host, port } = this.parseEndpoint(cfg.endpoint, mbPort);

    // Listen Node target: defaults to same host, configurable via options.
    this.listenHost = typeof opts.listenHost === "string" ? opts.listenHost : host;
    this.listenPort = typeof opts.listenPort === "number" ? opts.listenPort : DEFAULT_LISTEN_PORT;

    const client = new ModbusRTU();
    try {
      await this.withTimeout(client.connectTCP(host, { port }), this.timeoutMs, "TM modbus connectTCP");
      client.setID(this.unitId);
      if (typeof client.setTimeout === "function") client.setTimeout(this.timeoutMs);

      // Probe a known register to confirm the controller actually responds.
      await this.readReg(client, MODBUS_REGISTERS.running);

      this.mbClient = client;
      this.connected = true;
      this.connectedAt = new Date();
      this.lastOkAt = new Date();
      this.lastError = undefined;
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      try {
        if (typeof client.close === "function") {
          await new Promise<void>((resolve) => client.close(() => resolve()));
        }
      } catch { /* ignore */ }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.mbClient && typeof this.mbClient.close === "function") {
      try {
        await new Promise<void>((resolve) => this.mbClient.close(() => resolve()));
      } catch { /* ignore */ }
    }
    this.mbClient = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Read one MODBUS_REGISTERS entry → number[] of raw words. */
  private async readReg(
    client: any,
    reg: { addr: number; kind: "input" | "holding"; words: number },
  ): Promise<number[]> {
    const res = reg.kind === "holding"
      ? await client.readHoldingRegisters(reg.addr, reg.words)
      : await client.readInputRegisters(reg.addr, reg.words);
    return Array.isArray(res?.data) ? res.data : [];
  }

  async getState(): Promise<RobotState> {
    if (!this.connected || !this.mbClient) throw new DeviceUnreachableError("techmanRobot");
    try {
      const [running] = await this.readReg(this.mbClient, MODBUS_REGISTERS.running);
      const [errorCode] = await this.readReg(this.mbClient, MODBUS_REGISTERS.errorCode);
      const [estop] = await this.readReg(this.mbClient, MODBUS_REGISTERS.estop);
      const [modeCode] = await this.readReg(this.mbClient, MODBUS_REGISTERS.modeCode);
      const [speedPct] = await this.readReg(this.mbClient, MODBUS_REGISTERS.speedPct);
      const jointWords = await this.readReg(this.mbClient, MODBUS_REGISTERS.joints);

      const joints = jointWords.map((w) => Math.round(toSignedInt16(w) * JOINT_SCALE * 1e3) / 1e3);
      const err = Number(errorCode ?? 0);

      this.lastOkAt = new Date();
      return {
        mode: decodeMode(Number(modeCode ?? 0)),
        busy: Boolean(running),
        estop: Boolean(estop),
        pose: { joints, frame: "base" },
        speedPct: Number(speedPct ?? 0),
        error: err !== 0 ? `TM error ${err}` : undefined,
        timestamp: new Date(),
      };
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      throw err;
    }
  }

  async subscribeState(onState: OnRobotState, intervalMs = 5000): Promise<RobotStateHandle> {
    if (!this.connected) throw new DeviceUnreachableError("techmanRobot");
    const tick = async () => {
      try {
        const s = await this.getState();
        await onState(s);
      } catch {
        /* poll error already recorded in lastError; never crash the loop */
      }
    };
    const timer = setInterval(() => void tick(), intervalMs > 0 ? intervalMs : 5000);
    if (typeof (timer as NodeJS.Timeout).unref === "function") (timer as NodeJS.Timeout).unref();
    return { close: async () => clearInterval(timer) };
  }

  /**
   * ⚠️ Reached ONLY via robotCommandDispatcher (HITL + idempotency + mode gate).
   * The dispatcher already refuses to call runJob unless ROBOT_CONTROL_ENABLED;
   * we self-guard here too (defence-in-depth): when control is NOT enabled we
   * build the TMSCT string and return it as intent WITHOUT opening any socket.
   */
  async runJob(job: RobotJobSpec): Promise<RobotJobResult> {
    if (!this.connected) return { ok: false, status: "failed", error: "not connected" };

    const id = this.tmsctSeq++;
    const command = buildTmsct(job, id);

    // Self-guard dry-run: never open the Listen Node socket unless enabled.
    if (process.env.ROBOT_CONTROL_ENABLED !== "true") {
      return {
        ok: true,
        status: "done",
        detail: { dryRun: true, jobType: job.jobType, tmsct: command, sent: false },
      };
    }

    try {
      const reply = await this.sendListenNode(command);
      return { ok: true, status: "done", detail: { jobType: job.jobType, tmsct: command, sent: true, reply } };
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      this.lastError = msg;
      return { ok: false, status: "failed", error: msg };
    }
  }

  /**
   * Open a short-lived TCP socket to the TM Listen Node, send one TMSCT frame,
   * await the first reply line (TMSTA/$TMSCT ack), then close. Fail-safe: any
   * socket/timeout error rejects (caller turns it into a failed job result).
   *
   * NOTE: real Listen Node sessions are often long-lived and stream TMSTA
   * status; this one-shot send/ack is sufficient to validate the live path and
   * keeps the dispatcher's per-job model. Adapt for production as needed.
   */
  private sendListenNode(command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: this.listenHost, port: this.listenPort });
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch { /* ignore */ }
        fn();
      };
      const timer = setTimeout(
        () => done(() => reject(new Error(`TM Listen Node timeout after ${this.timeoutMs}ms`))),
        this.timeoutMs,
      );
      if (typeof timer.unref === "function") timer.unref();

      socket.on("connect", () => socket.write(command));
      socket.on("data", (buf) => {
        clearTimeout(timer);
        done(() => resolve(buf.toString("ascii").trim()));
      });
      socket.on("error", (e) => {
        clearTimeout(timer);
        done(() => reject(e));
      });
      socket.on("close", () => {
        clearTimeout(timer);
        // Closed before any data → treat as acked-with-no-reply (best effort).
        done(() => resolve(""));
      });
    });
  }

  /** Best-effort abort: send a stop script through the gated runJob path. */
  async abort(): Promise<void> {
    try {
      await this.runJob({ jobType: "abort" });
    } catch {
      /* ignore — abort is best-effort */
    }
  }

  async health(): Promise<RobotHealth> {
    return {
      vendor: "techman",
      connected: this.connected,
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
    };
  }
}

export const createTechmanDriver = (): RobotDriver => new TechmanDriver();
