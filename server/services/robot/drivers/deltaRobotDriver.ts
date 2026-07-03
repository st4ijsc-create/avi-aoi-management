/**
 * doc 24 Tier-2 (Connectivity) — Delta robot driver — REAL (framework-level)
 * ASCII/TCP command client. Replaces the prior NotImplemented scaffold. Wired
 * end-to-end against the RobotDriver contract, following the exact pattern of the
 * FANUC RMI driver (server/services/robot/drivers/fanucDriver.ts): a node:net TCP
 * client (shared TcpLineClient), deterministic framing, a read-mostly connect(), a
 * status/pose getState(), and a gated runJob() that DRY-RUNS unless
 * ROBOT_CONTROL_ENABLED==='true'.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DELTA WIRE PROTOCOL (REPRESENTATIVE "assumed shape" — clearly labelled)
 *   Delta Electronics industrial robots (DRV/DRA parallel-delta + SCARA) are
 *   commanded in the field over DMCNET (fieldbus), Modbus TCP, or a controller
 *   ASCII/TCP command channel. The exact ASCII command grammar is proprietary and
 *   not publicly pinned down, so — like the Techman TMSCT and the Koh-Young
 *   "assumed representative shape" — this driver implements a CLEAN, SELF-CONSISTENT
 *   ASCII/TCP line protocol modelled on common industrial ASCII framing. It is a
 *   faithful *shape* to be validated/replaced against the real controller, NOT a
 *   transcription of Delta's documented protocol. Constraint honoured: raw TCP via
 *   node:net, no Modbus/fieldbus dependency.
 *
 *   Frame (request and response), terminated by CRLF:
 *
 *       @<seq>,<CMD>[,<arg>...]*<XX>\r\n
 *
 *     • `@`      start-of-frame
 *     • `<seq>`  monotonic transaction id (echoed in the reply)
 *     • `<CMD>`  verb: RDSTS (read status), RDPOS (read pose), SERVO (servo on/off),
 *                MOVL (linear), MOVJ (joint), STOP (halt)
 *     • `*<XX>`  XOR checksum of the body (everything between `@` and `*`), 2-hex
 *
 *   Reply body: `<seq>,<CMD>,<STATUS>[,<field>...]` where STATUS is `OK` or `ERR`
 *   (an ERR reply carries the error code as the first field). Requests are issued
 *   strictly sequentially, so replies match FIFO (shared TcpLineClient).
 *
 * READ-MOSTLY: connect() sends a single RDSTS probe (read-only). It does NOT send
 *   SERVO,1 — energising servos is actuation-enabling and is deferred to the gated
 *   live-motion path. getState() polls RDSTS + RDPOS (read only).
 *
 * ⚠️ MOTION STAYS GATED (defence-in-depth). runJob() is reached ONLY from
 *   robotCommandDispatcher (idempotency + HITL 2-eyes + mode gate). This driver
 *   ALSO self-guards: when ROBOT_CONTROL_ENABLED!=='true' it BUILDS the framed
 *   command and returns it as dry-run INTENT (`sent:false`) without writing any
 *   byte and without ever sending SERVO,1. No ungated actuation.
 *
 * ⚠️ HONESTY CAVEAT — VALIDATE FIELD/MODE MAPPING AGAINST REAL HARDWARE. The frame
 *   grammar, checksum, RDSTS field order (running/mode/error/estop), RDPOS axis
 *   order (X/Y/Z/C for a 4-DOF delta) and MOVL/MOVJ argument layout are a
 *   representative assumed shape, NOT Delta's published protocol. Verify and replace
 *   every verb/field against the real controller manual before trusting live motion.
 *   Keep ROBOT_CONTROL_ENABLED=false until validated (dry-run builds the command but
 *   sends nothing).
 * ──────────────────────────────────────────────────────────────────────────
 */
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth, RobotPose,
} from "../robotDriver";
import { TcpLineClient } from "./tcpLineClient";

/** Delta ASCII/TCP command-channel port (representative default; configurable). */
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

// ── Pure framing / parsing (exported for wire-format unit tests) ─────────────

/** XOR checksum of the frame body, two-digit upper-hex (representative). */
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
