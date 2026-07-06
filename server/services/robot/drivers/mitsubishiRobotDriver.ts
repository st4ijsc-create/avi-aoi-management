/**
 * doc 24 Tier-2 (Connectivity) — Mitsubishi MELFA robot driver — REAL
 * (framework-level) command-channel client. Replaces the prior NotImplemented
 * scaffold. Wired end-to-end against the RobotDriver contract, following the exact
 * pattern of the FANUC RMI driver (server/services/robot/drivers/fanucDriver.ts):
 * a node:net TCP client, deterministic framing, a read-mostly connect(), a
 * status/pose getState(), and a gated runJob() that DRY-RUNS unless
 * ROBOT_CONTROL_ENABLED==='true'.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * MELFA WIRE PROTOCOL (as implemented here — the ASCII controller-command channel)
 *   MELFA CR750 / CR751 / CR800 controllers expose Ethernet functions on TCP/UDP
 *   ports configured via controller parameters CPRCE14–CPRCE19 (OPT11–OPT19),
 *   factory default 10000–10009 (Ethernet Function Instruction Manual BFP-A3379,
 *   §2.2 "Parameter list" p2-5; range 0–32767). This driver defaults to TCP 10001
 *   (a valid documented port) for the controller-communication / support-software
 *   command channel. Each request is one ASCII line:
 *
 *       <robotNo>;<slotNo>;<command>\r
 *
 *   e.g. `1;1;STATE`, `1;1;PPOSF`, `1;1;EXECMVS (100,200,300,180,0,180)(7,0)`.
 *   The controller answers with one CR-terminated ASCII line whose prefix encodes
 *   the result: `Qok<payload>` on success, `QeR<errNo>` / `Qer<errNo>` on error.
 *   Requests are issued strictly sequentially, so replies match FIFO (shared
 *   TcpLineClient).
 *
 *   Command verbs used:
 *     • OPEN=<name>  — acquire the communication line (session). READ-MOSTLY: it
 *                      declares this client; it does NOT take operation rights.
 *     • STATE        — read run/mode/error status. Read-only.
 *     • PPOSF        — read current Cartesian (XYZ + A/B/C) position. Read-only.
 *     • JPOSF        — read current joint angles. Read-only.
 *     • CNTLON       — take operation (control) rights.  ACTUATION-ENABLING.
 *     • SRVON        — servo power on.                    ACTUATION-ENABLING.
 *     • EXECMVS/EXECMOV — execute a MELFA-BASIC MVS (linear) / MOV (joint-interp)
 *                      motion statement.                  MOTION.
 *     • STOP         — halt the running motion (abort).
 *
 * READ-MOSTLY: connect() sends OPEN (session) + a STATE probe only. It does NOT
 *   send CNTLON or SRVON — those take control rights / energise the servos
 *   (actuation-enabling), so they are deferred to the gated live-motion path.
 *   getState() polls STATE + PPOSF (read only).
 *
 * ⚠️ MOTION STAYS GATED (defence-in-depth). runJob() is reached ONLY from
 *   robotCommandDispatcher (idempotency + HITL 2-eyes + mode gate). This driver
 *   ALSO self-guards: when ROBOT_CONTROL_ENABLED!=='true' it BUILDS the framed
 *   command and returns it as dry-run INTENT (`sent:false`) without writing any
 *   byte and without ever sending CNTLON/SRVON. No ungated actuation.
 *
 * ⚠️ HONESTY CAVEAT — TELEGRAM FORMAT IS NOT IN THIS MANUAL (verify vs support-SW).
 *   The Ethernet Function Instruction Manual (BFP-A3379) documents the PORTS and
 *   three channels — data-link (MELFA-BASIC OPEN/PRINT/INPUT, §3.2 p3-5),
 *   real-time external control (MXT over UDP, §3.3 p3-13) and the SLMP server
 *   (CR800 only, §3.5 p3-34) — but the "controller communication function"
 *   (§3.1 p3-2) DELEGATES its telegram format to the personal-computer support-
 *   software manual (§3.1.4 p3-3: "Refer to the instruction manual enclosed with
 *   the personal computer support software"). So the `<robotNo>;<slotNo>;<CMD>`
 *   line format, the OPEN/CNTLON/SRVON/EXEC verbs, the STATE run/mode decode, the
 *   PPOSF name;value pose parse and the `Qok`/`Qe` reply framing below follow the
 *   community / RT-ToolBox R3 convention — they are NOT verified against a
 *   Mitsubishi-published byte spec. MELFA STATE has no plain e-stop field, so
 *   `estop` is honestly left undefined. Keep ROBOT_CONTROL_ENABLED=false until
 *   validated on a live controller (dry-run builds the command but sends nothing).
 *
 * ⚠️ REAL-TIME MOTION uses a DIFFERENT documented channel: MXT (Move External)
 *   over UDP at the control cycle (~3.5 ms CR800 / ~7.1 ms CR750), a binary
 *   position-data packet — NOT this TCP line channel (§3.3.1/3.3.2 p3-15..3-20).
 *   This driver's TCP channel is for discrete supervisory commands only.
 *
 * ℹ️ VERIFIABLE STATE ALTERNATIVE (CR800): getState() could read robot devices via
 *   the built-in SLMP server (MC QnA-compatible 3E/4E frame) instead of the guessed
 *   STATE/PPOSF decode — params SLMPPORT (default 45237), SLMPCP (0=TCP,1=UDP),
 *   SLMPNWNO, SLMPNDID (§3.5.3-3.5.4 p3-34). This is a Mitsubishi-documented path;
 *   TODO if live state accuracy is required.
 * ──────────────────────────────────────────────────────────────────────────
 */
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth, RobotPose,
} from "../robotDriver";
import { TcpLineClient } from "./tcpLineClient";

/**
 * MELFA controller-communication TCP port. Configurable via endpoint/options.
 * Default 10001 ∈ documented range 10000–10009 (Ethernet Function Instruction
 * Manual BFP-A3379 §2.2 p2-5; params CPRCE14–19 / OPT11–19; full range 0–32767).
 */
const DEFAULT_MELFA_PORT = 10001;
/** Default robot number / task slot in the `<robotNo>;<slotNo>;<cmd>` frame. */
const DEFAULT_ROBOT_NO = 1;
const DEFAULT_SLOT_NO = 1;
/** Default client name for the OPEN= session acquire. */
const DEFAULT_CLIENT_NAME = "AOICTRL";

/** Parsed MELFA reply: `Qok<payload>` → ok, `Qe…<n>` → error with a number. */
export interface MelfaReply {
  ok: boolean;
  errorNo?: number;
  payload: string;
}

// ── Pure framing / parsing (exported for wire-format unit tests) ─────────────

/**
 * Frame one MELFA command as `<robotNo>;<slotNo>;<command>\r`. This is the exact
 * bytes written to the socket. NEVER sends anything — only builds the line.
 */
export function frameMelfaCommand(
  command: string,
  robotNo: number = DEFAULT_ROBOT_NO,
  slotNo: number = DEFAULT_SLOT_NO,
): string {
  return `${robotNo};${slotNo};${command}\r`;
}

/**
 * Parse a MELFA reply line. Success replies start with `Qok` (case-insensitive);
 * error replies start with `Qe` (e.g. `QeR<code>`). Anything else is treated
 * leniently as an ok payload (real controllers vary) — verify against hardware.
 */
export function parseMelfaResponse(line: string): MelfaReply {
  const t = String(line).trim();
  const up = t.toUpperCase();
  if (up.startsWith("QOK")) return { ok: true, payload: t.slice(3) };
  if (up.startsWith("QE")) {
    const m = t.slice(2).match(/-?\d+/);
    return { ok: false, errorNo: m ? Number(m[0]) : undefined, payload: t.slice(2) };
  }
  return { ok: true, payload: t };
}

/** Map a MELFA operation-mode code → mode string (R3 convention — unverified; see HONESTY CAVEAT). */
export function decodeMelfaMode(code: number): string {
  switch (code) {
    case 0: return "auto";
    case 1: return "manual";
    case 2: return "teach";
    default: return `mode${code}`;
  }
}

/**
 * Decode a STATE payload → run/mode/error (R3 convention — unverified; see HONESTY
 * CAVEAT). Real MELFA STATE returns a richer structure; here the payload after
 * `Qok` is split on `;` or `,` and read positionally as `[runStatus, modeCode,
 * errorNo]`. Edit for your controller, or prefer the SLMP-server read path (§3.5).
 */
export function decodeMelfaState(payload: string): { running: boolean; mode: string; errorNo: number } {
  const fields = String(payload).split(/[;,]/).map((s) => s.trim());
  const running = Number(fields[0] ?? 0) !== 0;
  const mode = decodeMelfaMode(Number(fields[1] ?? 0));
  const errorNo = Number(fields[2] ?? 0) || 0;
  return { running, mode, errorNo };
}

/**
 * Decode a PPOSF/JPOSF payload → RobotPose. R3-convention format (unverified; see
 * HONESTY CAVEAT): `name;value` pairs,
 * e.g. `X;+100.00;Y;+200.00;Z;+300.00;A;+180.00;B;+0.00;C;+90.00`. Cartesian
 * (X/Y/Z present) maps to pose.cartesian (rx=A, ry=B, rz=C); otherwise J1..J6 map
 * to pose.joints. Returns undefined when neither is present.
 */
export function decodeMelfaPosition(payload: string): RobotPose | undefined {
  const toks = String(payload).split(";").map((s) => s.trim());
  const map = new Map<string, number>();
  for (let i = 0; i + 1 < toks.length; i += 2) {
    const key = toks[i].toUpperCase();
    const val = Number(toks[i + 1]);
    if (key && Number.isFinite(val)) map.set(key, val);
  }
  if (map.has("X") || map.has("Y") || map.has("Z")) {
    return {
      cartesian: {
        x: map.get("X") ?? 0, y: map.get("Y") ?? 0, z: map.get("Z") ?? 0,
        rx: map.get("A") ?? 0, ry: map.get("B") ?? 0, rz: map.get("C") ?? 0,
      },
      frame: "world",
    };
  }
  const jointKeys = ["J1", "J2", "J3", "J4", "J5", "J6"];
  if (jointKeys.some((k) => map.has(k))) {
    return { joints: jointKeys.map((k) => map.get(k) ?? 0), frame: "joint" };
  }
  return undefined;
}

/**
 * Translate a RobotJobSpec → a single MELFA-BASIC motion statement prefixed with
 * `EXEC` (R3-convention syntax — unverified; see HONESTY CAVEAT). Joint params
 * → `EXECMOV J=(…)` (joint-interpolated to joint angles). Cartesian params →
 * `EXECMVS (x,y,z,a,b,c)(fl1,fl2)` (linear) or, when `interpolation==='joint'`,
 * `EXECMOV (…)`. Exported for unit testing; NEVER sends anything.
 */
export function buildMelfaMotion(job: RobotJobSpec): string {
  const p = job.params ?? {};

  // Joint move (MOV to explicit joint angles).
  if (Array.isArray(p.joints) || job.jobType === "home") {
    const raw = Array.isArray(p.joints) ? (p.joints as number[]) : [0, 0, 0, 0, 0, 0];
    const j = [0, 1, 2, 3, 4, 5].map((i) => Number(raw[i] ?? 0));
    return `EXECMOV J=(${j.join(",")})`;
  }

  // Cartesian move: linear (MVS) by default, joint-interpolated (MOV) on request.
  const x = Number(p.x ?? 0), y = Number(p.y ?? 0), z = Number(p.z ?? 0);
  const a = Number(p.a ?? p.rx ?? 0), b = Number(p.b ?? p.ry ?? 0), c = Number(p.c ?? p.rz ?? 0);
  const fl1 = Number(p.fl1 ?? 7), fl2 = Number(p.fl2 ?? 0);
  const verb = p.interpolation === "joint" ? "EXECMOV" : "EXECMVS";
  return `${verb} (${x},${y},${z},${a},${b},${c})(${fl1},${fl2})`;
}

export class MitsubishiDriver implements RobotDriver {
  readonly vendor: RobotVendor = "mitsubishi";

  private client: TcpLineClient | null = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;

  private host = "127.0.0.1";
  private port = DEFAULT_MELFA_PORT;
  private timeoutMs = 5000;
  private robotNo = DEFAULT_ROBOT_NO;
  private slotNo = DEFAULT_SLOT_NO;
  private clientName = DEFAULT_CLIENT_NAME;

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

  /** Send one command, await the reply, and throw if it is a MELFA error. */
  private async command(cmd: string): Promise<MelfaReply> {
    if (!this.client) throw new Error("MitsubishiDriver: not connected");
    const reply = parseMelfaResponse(await this.client.send(frameMelfaCommand(cmd, this.robotNo, this.slotNo), this.timeoutMs));
    if (!reply.ok) throw new Error(`MELFA ${cmd.split(/[ (]/)[0]} failed: error ${reply.errorNo ?? "?"}`);
    return reply;
  }

  async connect(cfg: RobotConnectionConfig): Promise<void> {
    const opts = cfg.options ?? {};
    this.timeoutMs = cfg.timeoutMs ?? 5000;
    this.robotNo = typeof opts.robotNo === "number" ? opts.robotNo : DEFAULT_ROBOT_NO;
    this.slotNo = typeof opts.slotNo === "number" ? opts.slotNo : DEFAULT_SLOT_NO;
    this.clientName = typeof opts.clientName === "string" ? opts.clientName : DEFAULT_CLIENT_NAME;

    const defaultPort = typeof opts.port === "number" ? opts.port : DEFAULT_MELFA_PORT;
    const { host, port } = this.parseEndpoint(cfg.endpoint, defaultPort);
    this.host = host;
    this.port = port;

    const client = new TcpLineClient("MELFA R3");
    try {
      await client.open(this.host, this.port, this.timeoutMs);
      this.client = client;

      // Session acquire (declares this client; does NOT take control rights).
      await this.command(`OPEN=${this.clientName}`);
      // Read-only probe — confirms the controller answers (does NOT enable motion).
      await this.command("STATE");

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
      try {
        if (this.connected) {
          // Best-effort release of the communication line, then drop the socket.
          await this.client.send(frameMelfaCommand("CLOSE", this.robotNo, this.slotNo), this.timeoutMs).catch(() => undefined);
        }
      } catch { /* ignore */ }
      this.client.close();
      this.client = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && !!this.client?.isConnected();
  }

  async getState(): Promise<RobotState> {
    if (!this.connected || !this.client) throw new Error("MitsubishiDriver: not connected");
    try {
      const state = decodeMelfaState((await this.command("STATE")).payload);

      let pose: RobotPose | undefined;
      try {
        pose = decodeMelfaPosition((await this.command("PPOSF")).payload);
      } catch (err) {
        // Pose read is best-effort; never fail the whole poll on it.
        this.lastError = (err as Error)?.message || String(err);
      }

      this.lastOkAt = new Date();
      return {
        mode: state.mode,
        busy: state.running,
        // MELFA STATE exposes no plain e-stop flag → honest undefined (never fabricated).
        estop: undefined,
        pose,
        error: state.errorNo !== 0 ? `MELFA error ${state.errorNo}` : undefined,
        timestamp: new Date(),
      };
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      throw err;
    }
  }

  async subscribeState(onState: OnRobotState, intervalMs = 5000): Promise<RobotStateHandle> {
    if (!this.connected) throw new Error("MitsubishiDriver: not connected");
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
   * the framed MELFA command and return it as dry-run INTENT — no CNTLON, no SRVON,
   * no write, no actuation. Only in the enabled branch do we take control rights
   * (CNTLON), energise servos (SRVON), then send the EXEC motion statement.
   */
  async runJob(job: RobotJobSpec): Promise<RobotJobResult> {
    if (!this.connected || !this.client) return { ok: false, status: "failed", error: "not connected" };

    const isAbort = job.jobType === "abort";
    const motionCmd = isAbort ? "STOP" : buildMelfaMotion(job);
    const framed = frameMelfaCommand(motionCmd, this.robotNo, this.slotNo);

    // Self-guard dry-run: never write a command / enable servos unless control enabled.
    if (process.env.ROBOT_CONTROL_ENABLED !== "true") {
      return {
        ok: true,
        status: "done",
        detail: { dryRun: true, jobType: job.jobType, command: framed, sent: false },
      };
    }

    try {
      // Abort halts a running move and needs no servo-on; motion needs control+servo.
      if (!isAbort) {
        await this.command("CNTLON");
        await this.command("SRVON");
      }
      const reply = await this.command(motionCmd);
      this.lastOkAt = new Date();
      return { ok: true, status: "done", detail: { jobType: job.jobType, command: framed, sent: true, reply: reply.payload } };
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
      vendor: "mitsubishi",
      connected: this.isConnected(),
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
    };
  }
}

export const createMitsubishiRobotDriver = (): RobotDriver => new MitsubishiDriver();
