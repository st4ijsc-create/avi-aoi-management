/**
 * Phase 3 / doc 24 C4 — FANUC robot driver — REAL (framework-level) RMI client.
 *
 * Implements the FANUC **Robot Motion Interface (RMI)** — the R-30iB / R-30iB Plus
 * controller option that exposes a TCP socket speaking newline-terminated JSON
 * packets. This is the SECOND vendor (after Techman) wired end-to-end against the
 * RobotDriver contract; Mitsubishi (MELFA R3) + Delta (ASCII/TCP) are now real
 * drivers too (doc 24 Tier-2), leaving no NotImplemented robot vendor.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RMI WIRE PROTOCOL (as implemented here)
 *   • Transport: one TCP socket (default port 16001). Every packet is a single
 *     JSON object serialized to one line and terminated with CRLF ("\r\n"). The
 *     controller replies with one JSON line per request, echoing the packet's
 *     discriminator key. We frame on CR?LF and match responses to requests FIFO
 *     (requests are issued strictly sequentially — one await per send).
 *   • Packet categories (the top-level discriminator key):
 *       - "Communication" : FRC_Connect / FRC_Disconnect (session).
 *       - "Command"        : FRC_Initialize, FRC_Abort, FRC_GetStatus,
 *                            FRC_ReadPositionRegister, … (read + control verbs).
 *       - "Instruction"    : FRC_LinearMotion / FRC_JointMotion / … (MOTION; carry
 *                            a monotonic SequenceID). Sent ONLY on the gated path.
 *   • Handshake: FRC_Connect → (controller returns a MajorVersion/MinorVersion and
 *     optionally a dedicated motion PortNumber). We stay on the connect socket by
 *     default; `reconnectToMotionPort` re-opens on the returned PortNumber for
 *     controllers that require it.
 *
 * READ-MOSTLY: connect() performs FRC_Connect + a FRC_GetStatus probe only. It does
 *   NOT send FRC_Initialize — Initialize enables RMI remote-motion mode (an
 *   actuation-enabling step), so it is deferred to the gated live-motion path.
 *   getState() polls FRC_GetStatus + FRC_ReadPositionRegister (read only).
 *
 * ⚠️ MOTION STAYS GATED (defence-in-depth). runJob() is reached ONLY from
 *   robotCommandDispatcher (idempotency + HITL 2-eyes + mode gate). This driver
 *   ALSO self-guards: when ROBOT_CONTROL_ENABLED!=='true' it BUILDS the RMI
 *   instruction packet and returns it as dry-run INTENT without opening/writing any
 *   motion packet and without ever sending FRC_Initialize. No ungated actuation.
 *
 * ⚠️ HONESTY CAVEAT — VALIDATE AGAINST REAL HARDWARE. The status/mode decode
 *   (TPMode / RMIMotionStatus → mode/busy) and the instruction field mapping are
 *   reasonable RMI assumptions written WITHOUT a live R-30iB. Verify field names,
 *   value encodings, UFrame/UTool numbers and speed units against the controller's
 *   RMI manual before trusting live motion. Keep ROBOT_CONTROL_ENABLED=false until
 *   validated (dry-run builds the packet but sends nothing).
 * ──────────────────────────────────────────────────────────────────────────
 */
import { createConnection } from "node:net";
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth,
} from "../robotDriver";

/** RMI TCP port on R-30iB / R-30iB Plus controllers (configurable via endpoint/options). */
const DEFAULT_RMI_PORT = 16001;
/** Default group mask for FRC_Initialize (group 1). */
const DEFAULT_GROUP_MASK = 1;
/** Default position register read for the pose seam (PR[1]). */
const DEFAULT_POSITION_REGISTER = 1;

/** Cartesian pose registers as RMI reports them (X/Y/Z mm, W/P/R deg). */
export interface FanucCartesian {
  X: number; Y: number; Z: number; W: number; P: number; R: number;
}

// ── Pure packet builders (exported for wire-format unit tests) ───────────────

/** Session open. Controller replies with ErrorID + version (+ optional PortNumber). */
export function buildConnectPacket(): Record<string, unknown> {
  return { Communication: "FRC_Connect" };
}

/** Session close. */
export function buildDisconnectPacket(): Record<string, unknown> {
  return { Communication: "FRC_Disconnect" };
}

/** Enable RMI remote-motion mode. ACTUATION-ENABLING — only sent on the gated path. */
export function buildInitializePacket(groupMask: number = DEFAULT_GROUP_MASK): Record<string, unknown> {
  return { Command: "FRC_Initialize", GroupMask: groupMask };
}

/** Read controller/servo/program status. Read-only. */
export function buildGetStatusPacket(): Record<string, unknown> {
  return { Command: "FRC_GetStatus" };
}

/** Read a position register PR[n]. Read-only. */
export function buildReadPositionRegisterPacket(registerNumber: number, group = 1): Record<string, unknown> {
  return { Command: "FRC_ReadPositionRegister", Group: group, RegisterNumber: registerNumber };
}

/** Stop/abort RMI motion (Command, not Instruction). */
export function buildAbortPacket(): Record<string, unknown> {
  return { Command: "FRC_Abort" };
}

/**
 * Translate a RobotJobSpec → a single RMI MOTION instruction packet (ASSUMED
 * field mapping — verify against the RMI manual). Cartesian params (x,y,z,…) →
 * FRC_LinearMotion; joint params → FRC_JointMotion. Exported for unit testing the
 * exact packet shape. This function NEVER sends anything — it only builds intent.
 */
export function buildFanucInstruction(job: RobotJobSpec, sequenceId: number): Record<string, unknown> {
  const p = job.params ?? {};
  const uTool = Number(p.uToolNumber ?? 1);
  const uFrame = Number(p.uFrameNumber ?? 1);
  const speedType = typeof p.speedType === "string" ? p.speedType : "mmSec";
  const speed = Number(p.speed ?? 50);
  const termType = typeof p.termType === "string" ? p.termType : "FINE";
  const configuration = {
    UToolNumber: uTool,
    UFrameNumber: uFrame,
    Front: 1, Up: 1, Left: 1, Flip: 1, Turn4: 0, Turn5: 0, Turn6: 0,
    ...(typeof p.configuration === "object" && p.configuration ? (p.configuration as Record<string, unknown>) : {}),
  };

  // Joint move (FRC_JointMotion): explicit joint angles in params.joints.
  if (Array.isArray(p.joints) || job.jobType === "home") {
    const raw = Array.isArray(p.joints) ? (p.joints as number[]) : [0, 0, 0, 0, 0, 0];
    const j = [0, 1, 2, 3, 4, 5].map((i) => Number(raw[i] ?? 0));
    return {
      Instruction: "FRC_JointMotion",
      SequenceID: sequenceId,
      Configuration: configuration,
      JointAngle: { J1: j[0], J2: j[1], J3: j[2], J4: j[3], J5: j[4], J6: j[5] },
      SpeedType: "Percent",
      Speed: Number(p.velPct ?? (job.jobType === "home" ? 20 : speed)),
      TermType: termType,
    };
  }

  // Cartesian move (FRC_LinearMotion): x,y,z (+ optional w,p,r) in params.
  const pos: FanucCartesian = {
    X: Number(p.x ?? 0), Y: Number(p.y ?? 0), Z: Number(p.z ?? 0),
    W: Number(p.w ?? p.rx ?? 0), P: Number(p.p ?? p.ry ?? 0), R: Number(p.r ?? p.rz ?? 0),
  };
  return {
    Instruction: "FRC_LinearMotion",
    SequenceID: sequenceId,
    Configuration: configuration,
    Position: pos,
    SpeedType: speedType,
    Speed: speed,
    TermType: termType,
  };
}

// ── Framing helpers (exported for tests) ─────────────────────────────────────

/** Serialize one RMI packet to its wire line (single-line JSON + CRLF). */
export function frameFanucPacket(pkt: Record<string, unknown>): string {
  return JSON.stringify(pkt) + "\r\n";
}

/**
 * Split a receive buffer into complete JSON packets, returning any partial tail.
 * Frames on CR?LF; malformed (non-JSON) lines are dropped (fail-safe).
 */
export function parseFanucFrames(buffer: string): { packets: Record<string, unknown>[]; rest: string } {
  const parts = buffer.split(/\r?\n/);
  const rest = parts.pop() ?? ""; // last element is the (possibly empty) incomplete tail
  const packets: Record<string, unknown>[] = [];
  for (const line of parts) {
    const t = line.trim();
    if (!t) continue;
    try {
      packets.push(JSON.parse(t));
    } catch {
      /* fail-safe: ignore non-JSON noise */
    }
  }
  return { packets, rest };
}

/** The discriminator value of an RMI packet (for logging / matching). */
function packetType(pkt: Record<string, unknown>): string {
  return String(pkt.Communication ?? pkt.Command ?? pkt.Instruction ?? "unknown");
}

type NetSocket = ReturnType<typeof createConnection>;

/**
 * Minimal RMI transport: one TCP socket, CRLF-framed JSON, FIFO request/response.
 * Requests are issued sequentially (one `await send()` at a time) so first-in
 * first-out matching is correct. Any socket error/close rejects all pending sends
 * (callers turn that into a failed job / thrown read — never a hang).
 */
export class FanucRmiClient {
  private socket: NetSocket | null = null;
  private rxBuf = "";
  private pending: Array<{ resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
  private connected = false;

  isConnected(): boolean {
    return this.connected;
  }

  open(host: string, port: number, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = createConnection({ host, port });
      this.socket = socket;

      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch { /* ignore */ }
        reject(new Error(`FANUC RMI connect timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof connectTimer.unref === "function") connectTimer.unref();

      socket.on("connect", () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        this.connected = true;
        resolve();
      });
      socket.on("data", (buf: Buffer) => this.onData(buf));
      socket.on("error", (err: Error) => {
        this.connected = false;
        this.failAllPending(err);
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          reject(err);
        }
      });
      socket.on("close", () => {
        this.connected = false;
        this.failAllPending(new Error("FANUC RMI socket closed"));
      });
    });
  }

  private onData(buf: Buffer | string): void {
    this.rxBuf += Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
    const { packets, rest } = parseFanucFrames(this.rxBuf);
    this.rxBuf = rest;
    for (const pkt of packets) {
      const waiter = this.pending.shift();
      if (!waiter) continue; // unsolicited packet with no pending request → ignore
      clearTimeout(waiter.timer);
      waiter.resolve(pkt);
    }
  }

  private failAllPending(err: Error): void {
    while (this.pending.length > 0) {
      const w = this.pending.shift()!;
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  /** Write one packet and await the next response line (FIFO), under a timeout. */
  send(pkt: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error("FANUC RMI: not connected"));
        return;
      }
      const timer = setTimeout(() => {
        // Drop this waiter from the queue on timeout.
        const idx = this.pending.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.pending.splice(idx, 1);
        reject(new Error(`FANUC RMI ${packetType(pkt)} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this.pending.push({ resolve, reject, timer });
      try {
        this.socket.write(frameFanucPacket(pkt));
      } catch (err) {
        const idx = this.pending.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.pending.splice(idx, 1);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  close(): void {
    this.failAllPending(new Error("FANUC RMI closing"));
    this.connected = false;
    if (this.socket) {
      try { this.socket.destroy(); } catch { /* ignore */ }
      this.socket = null;
    }
  }
}

/** Map an ASSUMED TPMode code → the human-readable mode string (verify vs RMI docs). */
function decodeTpMode(code: number): string {
  switch (code) {
    case 0: return "auto";
    case 1: return "t1";
    case 2: return "t2";
    default: return `mode${code}`;
  }
}

export class FanucDriver implements RobotDriver {
  readonly vendor: RobotVendor = "fanuc";

  private client: FanucRmiClient | null = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;

  private host = "127.0.0.1";
  private port = DEFAULT_RMI_PORT;
  private timeoutMs = 5000;
  private groupMask = DEFAULT_GROUP_MASK;
  private positionRegister = DEFAULT_POSITION_REGISTER;
  private reconnectToMotionPort = false;
  private version: { major?: number; minor?: number } = {};
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

  async connect(cfg: RobotConnectionConfig): Promise<void> {
    const opts = cfg.options ?? {};
    this.timeoutMs = cfg.timeoutMs ?? 5000;
    this.groupMask = typeof opts.groupMask === "number" ? opts.groupMask : DEFAULT_GROUP_MASK;
    this.positionRegister = typeof opts.positionRegister === "number" ? opts.positionRegister : DEFAULT_POSITION_REGISTER;
    this.reconnectToMotionPort = opts.reconnectToMotionPort === true;

    const defaultPort = typeof opts.port === "number" ? opts.port : DEFAULT_RMI_PORT;
    const { host, port } = this.parseEndpoint(cfg.endpoint, defaultPort);
    this.host = host;
    this.port = port;

    const client = new FanucRmiClient();
    try {
      await client.open(this.host, this.port, this.timeoutMs);

      // Session handshake.
      const connectResp = await client.send(buildConnectPacket(), this.timeoutMs);
      this.assertOk(connectResp, "FRC_Connect");
      this.version = { major: Number(connectResp.MajorVersion), minor: Number(connectResp.MinorVersion) };

      // Some controllers hand back a dedicated motion PortNumber; opt-in reconnect.
      const motionPort = Number(connectResp.PortNumber);
      if (this.reconnectToMotionPort && Number.isFinite(motionPort) && motionPort > 0 && motionPort !== this.port) {
        client.close();
        const client2 = new FanucRmiClient();
        await client2.open(this.host, motionPort, this.timeoutMs);
        this.port = motionPort;
        this.client = client2;
      } else {
        this.client = client;
      }

      // Read-only probe (does NOT enable motion). Confirms the controller answers.
      const status = await this.client.send(buildGetStatusPacket(), this.timeoutMs);
      this.assertOk(status, "FRC_GetStatus");

      this.connected = true;
      this.connectedAt = new Date();
      this.lastOkAt = new Date();
      this.lastError = undefined;
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      try { client.close(); } catch { /* ignore */ }
      try { this.client?.close(); } catch { /* ignore */ }
      this.client = null;
      this.connected = false;
      throw err;
    }
  }

  private assertOk(resp: Record<string, unknown>, label: string): void {
    const errorId = Number(resp?.ErrorID ?? 0);
    if (errorId !== 0) throw new Error(`${label} failed: RMI ErrorID ${errorId}`);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        // Best-effort graceful session close, then drop the socket.
        if (this.connected) {
          await this.client.send(buildDisconnectPacket(), this.timeoutMs).catch(() => undefined);
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
    if (!this.connected || !this.client) throw new Error("FanucDriver: not connected");
    try {
      const status = await this.client.send(buildGetStatusPacket(), this.timeoutMs);
      const errId = Number(status.ErrorID ?? 0);
      const tpMode = Number(status.TPMode ?? 0);
      const motion = Number(status.RMIMotionStatus ?? 0);
      const programStatus = Number(status.ProgramStatus ?? 0);

      let pose: RobotState["pose"];
      try {
        const pr = await this.client.send(buildReadPositionRegisterPacket(this.positionRegister), this.timeoutMs);
        pose = this.decodePose(pr);
      } catch (err) {
        // A position register read is best-effort; never fail the whole poll on it.
        this.lastError = (err as Error)?.message || String(err);
      }

      this.lastOkAt = new Date();
      return {
        mode: decodeTpMode(tpMode),
        busy: motion !== 0 || programStatus !== 0,
        // RMI GetStatus has no explicit e-stop flag → honest undefined (never fabricated).
        estop: undefined,
        pose,
        error: errId !== 0 ? `FANUC RMI error ${errId}` : undefined,
        firmwareVersion: this.version.major !== undefined ? `RMI ${this.version.major}.${this.version.minor ?? 0}` : undefined,
        timestamp: new Date(),
      };
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      throw err;
    }
  }

  /** Decode an FRC_ReadPositionRegister response → RobotPose (cartesian or joints). */
  private decodePose(pr: Record<string, unknown>): RobotState["pose"] | undefined {
    const posn = pr.Position as Partial<FanucCartesian> | undefined;
    if (posn && typeof posn === "object") {
      return {
        cartesian: {
          x: Number(posn.X ?? 0), y: Number(posn.Y ?? 0), z: Number(posn.Z ?? 0),
          rx: Number(posn.W ?? 0), ry: Number(posn.P ?? 0), rz: Number(posn.R ?? 0),
        },
        frame: "world",
      };
    }
    const ja = pr.JointAngle as Record<string, unknown> | undefined;
    if (ja && typeof ja === "object") {
      const joints = ["J1", "J2", "J3", "J4", "J5", "J6"].map((k) => Number(ja[k] ?? 0));
      return { joints, frame: "joint" };
    }
    return undefined;
  }

  async subscribeState(onState: OnRobotState, intervalMs = 5000): Promise<RobotStateHandle> {
    if (!this.connected) throw new Error("FanucDriver: not connected");
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
   * Self-guards (defence-in-depth): when ROBOT_CONTROL_ENABLED!=='true' we BUILD the
   * RMI instruction packet and return it as dry-run INTENT — no FRC_Initialize, no
   * write, no actuation. Only in the enabled branch do we send FRC_Initialize (which
   * enables RMI remote motion) followed by the motion instruction.
   */
  async runJob(job: RobotJobSpec): Promise<RobotJobResult> {
    if (!this.connected || !this.client) return { ok: false, status: "failed", error: "not connected" };

    const sequenceId = this.seq++;
    const packet = job.jobType === "abort"
      ? buildAbortPacket()
      : buildFanucInstruction(job, sequenceId);

    // Self-guard dry-run: never write a motion/abort packet unless control enabled.
    if (process.env.ROBOT_CONTROL_ENABLED !== "true") {
      return {
        ok: true,
        status: "done",
        detail: { dryRun: true, jobType: job.jobType, sequenceId, packet, sent: false },
      };
    }

    try {
      // FRC_Abort is a Command that needs no Initialize; motion instructions do.
      if (job.jobType !== "abort") {
        const init = await this.client.send(buildInitializePacket(this.groupMask), this.timeoutMs);
        this.assertOk(init, "FRC_Initialize");
      }
      const resp = await this.client.send(packet, this.timeoutMs);
      const errId = Number(resp.ErrorID ?? 0);
      if (errId !== 0) {
        return { ok: false, status: "failed", error: `RMI ErrorID ${errId}`, detail: { sequenceId, sent: true } };
      }
      this.lastOkAt = new Date();
      return { ok: true, status: "done", detail: { jobType: job.jobType, sequenceId, sent: true, reply: resp } };
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
      vendor: "fanuc",
      connected: this.isConnected(),
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
    };
  }
}

export const createFanucDriver = (): RobotDriver => new FanucDriver();
