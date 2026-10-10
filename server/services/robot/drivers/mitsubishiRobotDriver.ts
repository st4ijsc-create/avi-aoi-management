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
 * ⚠️ HONESTY CAVEAT — THE TELEGRAM BELOW IS UNVERIFIED (NOT IN ANY PUBLISHED SPEC).
 *   Re-verified 2026-07 across the THREE supplied Mitsubishi manuals — the
 *   `<robotNo>;<slotNo>;<CMD>` line, the OPEN/CNTLON/SRVON/EXEC verbs, the STATE
 *   run/mode decode, the PPOSF name;value pose parse and the `Qok`/`QeR` reply
 *   framing appear in NONE of them:
 *     • Ethernet Function Instruction Manual BFP-A3379-G — documents the PORTS and
 *       channels (data-link OPEN/PRINT/INPUT §3.2; real-time external control MXT/UDP
 *       §3.3; SLMP server §3.5) but its "controller communication function" (§3.1)
 *       DELEGATES the telegram to the PC support-software manual (§3.1.4: "Refer to
 *       the instruction manual enclosed with the personal computer support software"
 *       — a proprietary "No-procedure" protocol, param COMDEV element = 0).
 *     • MELFA-Works Instruction Manual BFP-A8525-J — CAD/simulation link only; no
 *       command telegram.
 *     • CR800 Controller "Detailed explanations of functions and operations" —
 *       full-text searched: no `Qok`/`QeR`, no `CNTLON`, no `PPOSF`, no `<n>;<n>;`
 *       command line (`SRVON` appears only as the MELFA-BASIC program instruction).
 *   So the frame below follows the community / RT-ToolBox convention — it is NOT a
 *   Mitsubishi-published byte spec. MELFA STATE has no plain e-stop field, so `estop`
 *   is honestly left undefined. Keep ROBOT_CONTROL_ENABLED=false until validated on a
 *   live controller (dry-run builds the command but sends nothing).
 *
 * ✅ PRIMARY DOCUMENTED PATH — SLMP SERVER (CR800; use this for real state, not the
 *   unverified STATE/PPOSF decode above). The CR800 series supports the SLMP
 *   communication SERVER function (BFP-A3379-G §3.5 "SLMP Connection", p3-34):
 *     • Message format = MELSEC MC protocol, QnA-compatible **3E and 4E frame**
 *       (binary or ASCII) — §3.5.3.1 "SLMP Specifications".
 *     • Parameters §3.5.4 (p3-34): SLMPPORT default **45237** (range 1024–65535),
 *       SLMPCP (server protocol TCP/UDP), SLMPNWNO (network no. 1–239), SLMPNDID
 *       (station no. 1–120); communication procedure §3.5.5 (p3-35).
 *     • Robot devices are exposed as a FIXED device map readable/writable over SLMP:
 *       X/Y bit I/O, M internal relays, **D data registers (D0–D5119)**, SM/SD system
 *       relays/registers — CR800 detailed-functions manual §6.8.1 "Device list"
 *       (Tables 6-11 CR800-R / 6-12 CR800-D); "device ranges are fixed and cannot be
 *       changed". A robot program maps live status/position into agreed D registers.
 *   This is Mitsubishi-documented and matches an MC 3E/4E frame the codebase already
 *   models (see the SLMP Reference Manual). TODO(OT): implement getState() over SLMP
 *   (a small MC-3E client, no new dep — plain node:net) against a site D-register map,
 *   and treat that as the source of truth; the TCP line channel below is a fallback.
 *
 * ⚠️ REAL-TIME MOTION uses a DIFFERENT documented channel: MXT (Move External)
 *   over UDP at the control cycle (~3.5 ms CR800 / ~7.1 ms CR750), a binary
 *   position-data packet — NOT this TCP line channel (§3.3.1/3.3.2 p3-15..3-20).
 *   This driver's TCP channel is for discrete supervisory commands only.
 * ──────────────────────────────────────────────────────────────────────────
 */
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth, RobotPose,
} from "../robotDriver";
import type { MotionLockState } from "../robotDriver";
import { abortThroughRunJob, AbortFence, MotionLock, MOTION_OUTCOME_UNKNOWN_REASON_CODES } from "../robotDriver";
import { driverJob, isStopJob } from "../stopJob"; // doc 81 Đợt 1C residual round 2
import { TcpLineClient } from "./tcpLineClient";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";

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

/**
 * doc 81 Đợt 1B final wave (item 4, F3 census) — bộ điều khiển MELFA trả lời LỖI (`Qe…`) cho một
 * lệnh: lớp có tên + `command` + `errorNo` thay cho `throw new Error`. Người nhận là runJob (→
 * RobotJobResult.error cho sổ robot_jobs) và connect/getState (→ lastError). CỐ Ý KHÔNG mang
 * `reasonCode`: nhánh catch của runJob đọc `err.reasonCode` để quyết định khoá chuyển động và
 * hình dạng `detail` — một lỗi-trả-lời của robot không phải kết cục-chưa-biết, nên kết quả giữ
 * đúng hình dạng cũ (byte-identical). Message giữ nguyên văn `MELFA <lệnh> failed: error <N>`.
 */
export class MelfaReplyError extends Error {
  readonly command: string;
  readonly errorNo: number | string | undefined;
  constructor(command: string, errorNo: number | string | undefined, context?: string) {
    super(`MELFA ${command} failed${context ? ` ${context}` : ""}: error ${errorNo ?? "?"}`);
    this.name = "MelfaReplyError";
    this.command = command;
    this.errorNo = errorNo;
  }
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
  private readonly fence = new AbortFence();
  /**
   * doc 81 Đợt 1B Task 5 fix round 4 (R13) — set on a peer drop (transport hook) and when a MOTION
   * job ends with an outcome-unknown reason code; cleared by a confirmed STOP or an operator.
   */
  private readonly motionLock = new MotionLock();

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

  /**
   * Send one command, await the reply, and throw if it is a MELFA error. `privileged` = the frame
   * may re-establish the transport after a peer drop (fix round 3: the STOP; fix round 4 / R13:
   * also the read-only polls STATE/PPOSF). Motion frames are never privileged.
   */
  private async command(cmd: string, guard?: () => void, privileged = false): Promise<MelfaReply> {
    if (!this.client) throw new DeviceUnreachableError("mitsubishiRobot");
    const reply = parseMelfaResponse(
      await this.client.send(frameMelfaCommand(cmd, this.robotNo, this.slotNo), this.timeoutMs, { guard, allowAfterPeerDrop: privileged }),
    );
    if (!reply.ok) throw new MelfaReplyError(cmd.split(/[ (]/)[0], reply.errorNo);
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

    // doc 81 Đợt 1B Task 5 — after a timeout/abort the transport opens a NEW TCP connection
    // (T4 fix); the controller treats it as a new session, so re-declare the client with
    // OPEN= before the queued command (BFP-A3379 R3: OPEN precedes any other command).
    const client = new TcpLineClient("MELFA R3", {
      onReconnect: async (c) => {
        const r = parseMelfaResponse(
          await c.send(frameMelfaCommand(`OPEN=${this.clientName}`, this.robotNo, this.slotNo), this.timeoutMs),
        );
        if (!r.ok) throw new MelfaReplyError("OPEN", r.errorNo, "on reconnect");
      },
      // Fix round 4 (R13) — a peer drop (idle or under a command) locks motion until a STOP is
      // confirmed or an operator clears it; a later poll may bring the transport back regardless.
      onLinkLoss: (reasonCode, detail) => this.motionLock.lock(reasonCode, detail),
    });
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
    if (!this.connected || !this.client) throw new DeviceUnreachableError("mitsubishiRobot");
    try {
      // Read-only polls are PRIVILEGED (fix round 4 / R13): after a peer drop they re-open the
      // session (OPEN= again) so telemetry recovers on its own; motion stays behind the lock.
      const state = decodeMelfaState((await this.command("STATE", undefined, true)).payload);

      let pose: RobotPose | undefined;
      try {
        pose = decodeMelfaPosition((await this.command("PPOSF", undefined, true)).payload);
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
    if (!this.connected) throw new DeviceUnreachableError("mitsubishiRobot");
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
    // doc 81 Đợt 1C residual round 2 (R-1C-m, layer b) — ONE shared classifier: a STOP in ANY spelling
    // (abort / stop / e_stop, any case) becomes the canonical abort with NO params, so this driver sends only its
    // fixed stop primitive — even when a caller bypasses the dispatcher's own canonicalisation.
    job = driverJob(job);
    if (!this.connected || !this.client) return { ok: false, status: "failed", error: "not connected" };
    // Fix round 4 (R13) — MOTION LOCK: a motion job is refused here, before the dry-run branch and
    // before any byte, while the lock is set (peer drop / outcome-unknown motion). A STOP passes.
    const refused = this.motionLock.refusal(job);
    if (refused) return refused;
    // doc 81 Đợt 1B Task 5 fix round 1 — abort fence: checked right before EVERY write
    // (inside TcpLineClient.send, after any reconnect), so nothing follows a STOP.
    // Fix round 5 (b) — the same guard RE-CHECKS the motion lock, so a lock set mid-job stops the
    // next write (SRVON / EXEC) even though the entry check above already passed.
    const guard = this.motionLock.guard(job, this.fence.capture(job));

    const isAbort = isStopJob(job);
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
        await this.command("CNTLON", guard);
        await this.command("SRVON", guard);
      }
      // Fix round 3/4 — the STOP is privileged (may reconnect after a peer drop); motion is not.
      const reply = await this.command(motionCmd, guard, isAbort);
      this.lastOkAt = new Date();
      // Fix round 4 (R13) — a STOP delivered AND acknowledged (Qok) is the only automatic way out
      // of the motion lock. (A dry-run "abort" never reaches this line.)
      if (isAbort) this.motionLock.clearByStop();
      return { ok: true, status: "done", detail: { jobType: job.jobType, command: framed, sent: true, reply: reply.payload } };
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      this.lastError = msg;
      // doc 81 Đợt 1B Task 5 — keep the transport's reason code (e.g. line_reply_timeout ⇒
      // the command may be executing; the dispatcher then sends a stop).
      const reasonCode = (err as { reasonCode?: unknown })?.reasonCode;
      // Fix round 4 (R13) — a MOTION whose outcome is unknown (timeout / reset / close under it)
      // locks further motion until that stop is confirmed (or an operator clears the lock).
      if (!isAbort && typeof reasonCode === "string" && MOTION_OUTCOME_UNKNOWN_REASON_CODES.has(reasonCode)) {
        this.motionLock.lock(reasonCode, msg);
      }
      return {
        ok: false,
        status: "failed",
        error: msg,
        ...(typeof reasonCode === "string" ? { detail: { jobType: job.jobType, reasonCode } } : {}),
      };
    }
  }

  /**
   * Abort routed through the gated runJob path (dry-run unless enabled). doc 81 Đợt 1B
   * Task 5: an in-flight request is PREEMPTED first (connection renewed) so its late reply
   * can never be taken as the STOP's ack, and a failed/unsent STOP is SURFACED (throws)
   * instead of swallowed — the dispatcher records abort_failed.
   */
  async abort(): Promise<void> {
    this.fence.bump(); // FIRST: any job started before this abort can write nothing more
    if (this.client && this.client.inFlight() > 0) this.client.resetConnection("abort preempts in-flight request");
    await abortThroughRunJob((job) => this.runJob(job), "MELFA");
  }

  /** Fix round 4 (R13) — motion lock snapshot (dispatcher gate 3, robot.list `live`). */
  getMotionLock(): MotionLockState {
    return this.motionLock.snapshot();
  }

  /** Fix round 4/5 — operator compare-and-clear; the caller (robot.clearMotionLock) has already audited it. */
  clearMotionLock(input: { reason: string; userId: number; expectedGeneration: number }): MotionLockState {
    return this.motionLock.clearByOperator(input);
  }

  /** Fix round 5 (c) — the dispatcher locks here when ITS deadline made a motion's outcome unknown. */
  lockMotion(reasonCode: string, detail?: string): void {
    this.motionLock.lock(reasonCode, detail);
  }

  /** doc 81 Đợt 4 Task B4 — the lock itself (robotManager restores a persisted lock + attaches persistence). */
  motionLockController(): MotionLock {
    return this.motionLock;
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
