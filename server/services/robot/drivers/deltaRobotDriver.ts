/**
 * doc 24 Tier-2 (Connectivity) — Delta robot driver — HONEST DRY-RUN MOCK.
 * Wired end-to-end against the RobotDriver contract (same shape as the other
 * drivers: shared TcpLineClient, read-mostly connect(), status/pose getState(),
 * gated runJob() that DRY-RUNS unless ROBOT_CONTROL_ENABLED==='true').
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ THE WIRE FRAME BELOW IS A FABRICATED PLACEHOLDER — NOT A REAL PROTOCOL ⚠️⚠️
 *
 * Spec-verified 2026-07 against the supplied manuals. Findings:
 *
 * 1) `Delta-Robot-Controller-User-Manual.pdf` is a **HIWIN RCD-series robot
 *    controller** HARDWARE/INSTALL/SAFETY manual (models RCD401/RCD403, doc
 *    C05UE101-1809). "Delta Robot" in the title is the parallel/**delta MECHANISM
 *    type** — the spec page lists "Articulated / Delta / SCARA Robot" as supported
 *    kinematics — NOT the vendor "Delta Electronics". Vendor is HIWIN Technologies.
 *      • OS = HRSS (HIWIN Robot System Software); Positioning = PTP/CP; 4 axes
 *        (Specifications, ch.1 "Standard Specifications", p.10).
 *      • Programming is done ON the controller via Teach Pendant TP02 — "program
 *        edit, program management and motion position teaching" (ch.4 "Teach
 *        Pendant", p.33). No offline/host command language is exposed.
 *      • The ONLY communication interface documented is physical: "Communication
 *        interface: Ethernet ×2, USB" (Specifications table, p.10) and "5 LAN
 *        connector (CN6) — Ethernet signal transmitting" (Installation §2.1, p.16).
 *      • The manual has 6 chapters (1 Specifications · 2 Installation · 3 External
 *        I/O · 4 Teach Pendant · 5 Universal Stand · 6 Maintenance). It documents
 *        **NO host command protocol**: no Modbus map, no function codes, no register
 *        table, no ASCII command grammar, no TCP command port, no checksum, no
 *        baud/serial parameters. Full-text verified.
 *
 *    => There is NO documented host API to implement. The previous
 *    `@<seq>,<CMD>[,<arg>...]*<XX>\r\n` frame (start-of-frame `@`, echoed seq,
 *    verbs RDSTS/RDPOS/SERVO/MOVL/MOVJ/STOP, XOR checksum, default TCP port 5000)
 *    was INVENTED. It appears nowhere in any Delta/HIWIN document and MUST NOT be
 *    trusted on hardware. It is retained ONLY as a self-consistent dry-run mock so
 *    the RobotDriver contract stays exercised; every send is gated OFF.
 *
 * 2) `Delta-AS-Series-Users-Manual.pdf` IS a Delta Electronics device — the **AS
 *    Series (AS300) PLC** "Hardware and Operation Manual". Unlike the robot
 *    controller it is a real **Modbus TCP/RTU** device with a documented Function-
 *    Code set and device register map (Ethernet §2.2.1; Ethernet-link object §9.8).
 *    If a Delta AS300 PLC coordinates the robot cell, THAT is the real integration
 *    surface — reached via the existing OT Modbus path, NOT this ASCII mock.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HOW TO CONNECT FOR REAL (replace this mock; do NOT lift ROBOT_CONTROL_ENABLED
 * against this fabricated frame):
 *
 *   A) HIWIN RCD host control — obtain HIWIN's HRSS network/remote-command manual
 *      (this hardware manual does not cover it). HRSS exposes host motion/IO over
 *      the CN6 Ethernet link via HIWIN's own remote API (and, on configured units,
 *      a Modbus/TCP server). Transcribe the real verbs/registers there, then either
 *      keep TcpLineClient (if it is a documented ASCII channel) or route through the
 *      Modbus path below. Cite the exact HRSS manual pages when you do.
 *
 *   B) Delta AS300 PLC cell coordinator — use the existing OT Modbus driver
 *      `server/services/ot/drivers/modbusDriver.ts` (createModbusDriver →
 *      readTags/writeTags → readHoldingRegisters/writeRegister/writeRegisters) with
 *      the AS-series register map (Delta-AS-Series-Users-Manual.pdf). That is the
 *      correct home for register I/O — do NOT re-implement Modbus in this file.
 *
 * TODO(OT): pick path A or B once the real host-protocol manual/register map is
 *   available, then delete the fabricated frame functions below.
 *
 * READ-MOSTLY: connect() sends a single RDSTS probe. getState() polls RDSTS+RDPOS.
 *   (All against the mock frame — validate before trusting.)
 *
 * ⚠️ MOTION STAYS GATED (defence-in-depth). runJob() is reached ONLY from
 *   robotCommandDispatcher (idempotency + HITL 2-eyes + mode gate). This driver
 *   ALSO self-guards: when ROBOT_CONTROL_ENABLED!=='true' it BUILDS the framed
 *   command and returns it as dry-run INTENT (`sent:false`) without writing any
 *   byte and without ever sending SERVO,1. Keep ROBOT_CONTROL_ENABLED=false — the
 *   frame is unvalidated and fabricated.
 * ──────────────────────────────────────────────────────────────────────────
 */
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth, RobotPose,
} from "../robotDriver";
import { TcpLineClient } from "./tcpLineClient";

/**
 * FABRICATED default port for the mock ASCII channel — NOT a documented Delta/HIWIN
 * port (the RCD manual specifies no host command port; see header). Configurable.
 */
const DEFAULT_DELTA_PORT = 5000;

/** Parsed Delta reply. */
export interface DeltaReply {
  ok: boolean;
  seq?: number;
  cmd?: string;
  status?: string;
  fields: string[];
  errorCode?: number;
}

// ── Pure framing / parsing for the FABRICATED mock frame (exported for unit
//    tests only). None of this reflects a documented Delta/HIWIN protocol — see
//    the header. Delete when the real host API (path A) or Modbus map (path B) lands.
// ─────────────────────────────────────────────────────────────────────────────

/** XOR checksum of the mock frame body, two-digit upper-hex (FABRICATED — not real). */
export function deltaChecksum(body: string): string {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return x.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Frame one Delta command as `@<seq>,<CMD>[,<arg>...]*<XX>\r\n`. This is the exact
 * bytes written to the socket. NEVER sends anything — only builds the line.
 */
export function frameDeltaCommand(seq: number, cmd: string, args: Array<string | number> = []): string {
  const body = [seq, cmd, ...args].join(",");
  return `@${body}*${deltaChecksum(body)}\r\n`;
}

/**
 * Parse a Delta reply line `@<seq>,<CMD>,<STATUS>[,<field>...]*<XX>`. The checksum
 * suffix (and leading `@`) are stripped; STATUS `OK`→ok, anything else→error with
 * the first field read as the numeric error code. Lenient by design (verify vs HW).
 */
export function parseDeltaResponse(line: string): DeltaReply {
  let t = String(line).trim();
  if (t.startsWith("@")) t = t.slice(1);
  const star = t.lastIndexOf("*");
  if (star >= 0) t = t.slice(0, star); // drop checksum suffix (not re-verified here)
  const toks = t.split(",").map((s) => s.trim());
  const seq = Number(toks[0]);
  const cmd = toks[1];
  const status = toks[2];
  const fields = toks.slice(3);
  const ok = String(status ?? "").toUpperCase() === "OK";
  return {
    ok,
    seq: Number.isFinite(seq) ? seq : undefined,
    cmd,
    status,
    fields,
    errorCode: ok ? undefined : Number(fields[0] ?? NaN) || undefined,
  };
}

/** Map an ASSUMED Delta mode code → mode string (verify vs controller). */
export function decodeDeltaMode(code: number): string {
  switch (code) {
    case 0: return "auto";
    case 1: return "manual";
    case 2: return "teach";
    default: return `mode${code}`;
  }
}

/**
 * Decode RDSTS fields → status. ASSUMED positional CSV `[running, mode, error, estop]`.
 * Unlike MELFA STATE, this representative status frame DOES carry an e-stop flag.
 */
export function decodeDeltaStatus(fields: string[]): { running: boolean; mode: string; errorCode: number; estop: boolean | undefined } {
  const running = Number(fields[0] ?? 0) !== 0;
  const mode = decodeDeltaMode(Number(fields[1] ?? 0));
  const errorCode = Number(fields[2] ?? 0) || 0;
  const estop = fields.length > 3 ? Number(fields[3]) !== 0 : undefined;
  return { running, mode, errorCode, estop };
}

/**
 * Decode RDPOS fields → RobotPose. ASSUMED Cartesian axis order `[X, Y, Z, C]`
 * (4-DOF delta: X/Y/Z + end-rotation C→rz). Returns undefined when empty.
 */
export function decodeDeltaPosition(fields: string[]): RobotPose | undefined {
  if (!fields.length) return undefined;
  const n = fields.map((f) => Number(f));
  return {
    cartesian: { x: n[0] ?? 0, y: n[1] ?? 0, z: n[2] ?? 0, rz: n[3] ?? 0 },
    frame: "world",
  };
}

/**
 * Translate a RobotJobSpec → a Delta motion {cmd,args} (ASSUMED layout). Joint
 * params → `MOVJ,<j...>,<vel>`. Cartesian → `MOVL,<x>,<y>,<z>,<c>,<vel>` (linear)
 * or `MOVJ` when `interpolation==='joint'`. Exported for tests; builds only.
 */
export function buildDeltaMotion(job: RobotJobSpec): { cmd: string; args: Array<string | number> } {
  const p = job.params ?? {};
  const vel = Number(p.velPct ?? p.speed ?? 50);

  if (Array.isArray(p.joints)) {
    const j = (p.joints as number[]).map((v) => Number(v ?? 0));
    return { cmd: "MOVJ", args: [...j, vel] };
  }

  const x = Number(p.x ?? 0), y = Number(p.y ?? 0), z = Number(p.z ?? 0), c = Number(p.c ?? p.rz ?? 0);
  const cmd = p.interpolation === "joint" ? "MOVJ" : "MOVL";
  return { cmd, args: [x, y, z, c, vel] };
}

export class DeltaDriver implements RobotDriver {
  readonly vendor: RobotVendor = "delta";

  private client: TcpLineClient | null = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;

  private host = "127.0.0.1";
  private port = DEFAULT_DELTA_PORT;
  private timeoutMs = 5000;
  private seq = 1;

  /** Parse "tcp://host:port" | "host:port" | "host" → {host,port}. */
  private parseEndpoint(endpoint: string, defaultPort: number): { host: string; port: number } {
    const s = String(endpoint ?? "").trim().replace(/^tcp:\/\//i, "");
    const idx = s.lastIndexOf(":");
    if (idx > 0) {
      const host = s.slice(0, idx);
      const port = Number(s.slice(idx + 1));
      if (host && Number.isFinite(port)) return { host, port };
    }
    return { host: s || "127.0.0.1", port: defaultPort };
  }

  /** Send one command frame, await the reply, and throw if it is a Delta error. */
  private async command(cmd: string, args: Array<string | number> = []): Promise<DeltaReply> {
    if (!this.client) throw new Error("DeltaDriver: not connected");
    const frame = frameDeltaCommand(this.seq++, cmd, args);
    const reply = parseDeltaResponse(await this.client.send(frame, this.timeoutMs));
    if (!reply.ok) throw new Error(`Delta ${cmd} failed: error ${reply.errorCode ?? "?"}`);
    return reply;
  }

  async connect(cfg: RobotConnectionConfig): Promise<void> {
    const opts = cfg.options ?? {};
    this.timeoutMs = cfg.timeoutMs ?? 5000;

    const defaultPort = typeof opts.port === "number" ? opts.port : DEFAULT_DELTA_PORT;
    const { host, port } = this.parseEndpoint(cfg.endpoint, defaultPort);
    this.host = host;
    this.port = port;

    const client = new TcpLineClient("Delta ASCII");
    try {
      await client.open(this.host, this.port, this.timeoutMs);
      this.client = client;

      // Read-only probe — confirms the controller answers (does NOT enable motion).
      await this.command("RDSTS");

      this.connected = true;
      this.connectedAt = new Date();
      this.lastOkAt = new Date();
      this.lastError = undefined;
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      try { client.close(); } catch { /* ignore */ }
      this.client = null;
      this.connected = false;
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && !!this.client?.isConnected();
  }

  async getState(): Promise<RobotState> {
    if (!this.connected || !this.client) throw new Error("DeltaDriver: not connected");
    try {
      const status = decodeDeltaStatus((await this.command("RDSTS")).fields);

      let pose: RobotPose | undefined;
      try {
        pose = decodeDeltaPosition((await this.command("RDPOS")).fields);
      } catch (err) {
        // Pose read is best-effort; never fail the whole poll on it.
        this.lastError = (err as Error)?.message || String(err);
      }

      this.lastOkAt = new Date();
      return {
        mode: status.mode,
        busy: status.running,
        estop: status.estop,
        pose,
        error: status.errorCode !== 0 ? `Delta error ${status.errorCode}` : undefined,
        timestamp: new Date(),
      };
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      throw err;
    }
  }

  async subscribeState(onState: OnRobotState, intervalMs = 5000): Promise<RobotStateHandle> {
    if (!this.connected) throw new Error("DeltaDriver: not connected");
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
   * Self-guards (defence-in-depth): when ROBOT_CONTROL_ENABLED!=='true' we BUILD
   * the framed Delta command and return it as dry-run INTENT — no SERVO,1, no write,
   * no actuation. Only in the enabled branch do we energise servos (SERVO,1) then
   * send the MOVL/MOVJ instruction.
   */
  async runJob(job: RobotJobSpec): Promise<RobotJobResult> {
    if (!this.connected || !this.client) return { ok: false, status: "failed", error: "not connected" };

    const isAbort = job.jobType === "abort";
    const { cmd, args } = isAbort ? { cmd: "STOP", args: [] as Array<string | number> } : buildDeltaMotion(job);
    // Preview the exact bytes without consuming a live seq id (dry-run must not write).
    const framedPreview = frameDeltaCommand(this.seq, cmd, args);

    // Self-guard dry-run: never write a command / enable servos unless control enabled.
    if (process.env.ROBOT_CONTROL_ENABLED !== "true") {
      return {
        ok: true,
        status: "done",
        detail: { dryRun: true, jobType: job.jobType, command: framedPreview, sent: false },
      };
    }

    try {
      // Abort halts a running move and needs no servo-on; motion needs servo power.
      if (!isAbort) {
        await this.command("SERVO", [1]);
      }
      const reply = await this.command(cmd, args);
      this.lastOkAt = new Date();
      return { ok: true, status: "done", detail: { jobType: job.jobType, command: cmd, sent: true, reply: reply.fields } };
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      this.lastError = msg;
      return { ok: false, status: "failed", error: msg };
    }
  }

  /** Best-effort abort routed through the gated runJob path (dry-run unless enabled). */
  async abort(): Promise<void> {
    try {
      await this.runJob({ jobType: "abort" });
    } catch {
      /* ignore — abort is best-effort */
    }
  }

  async health(): Promise<RobotHealth> {
    return {
      vendor: "delta",
      connected: this.isConnected(),
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
    };
  }
}

export const createDeltaRobotDriver = (): RobotDriver => new DeltaDriver();
