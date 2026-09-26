/**
 * Phase 3 / doc 24 C4 — FANUC robot driver — REAL RMI client.
 *
 * Implements the FANUC **Remote Motion Interface (RMI)** — a controller option that
 * exposes a TCP socket speaking CRLF-terminated JSON packets. This is the SECOND
 * vendor (after Techman) wired end-to-end against the RobotDriver contract;
 * Mitsubishi (MELFA R3) + Delta (ASCII/TCP) are now real drivers too (doc 24
 * Tier-2), leaving no NotImplemented robot vendor.
 *
 * Wire format & command names below are VERIFIED against the FANUC manual
 * "RMI Operators Manual", B-84184EN/03 (section/page refs cited inline as
 * "[RMI §x.y.z p.N]", where p.N is the printed manual page number).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CONTROLLER PREREQUISITES  [RMI §1.2 p.1]
 *   • Hardware: an **R-30iB Plus** controller.
 *   • Software option: **Remote Motion Interface (R912)** loaded. (Not R632.)
 *   • Comms: Ethernet. Recommended controller software ≥ RMI MajorVersion 7.
 *   • Before FRC_Initialize the controller MUST be:  [RMI §2.3.1 p.9]
 *       1. Teach pendant DISABLED and controller in **AUTO mode** (GetStatus
 *          TPMode === 0 means TP disabled → RMI-usable),
 *       2. Ready to run (no servo/other errors — GetStatus ServoReady === 1),
 *       3. Selected TP program NOT RMI_MOVE (else ErrorID 7015/7004).
 *
 * RMI WIRE PROTOCOL
 *   • Every packet is a single JSON object on one line, terminated with CRLF
 *     ("\r\n").  [RMI §2.2.1 p.6 — all packet tables end "} \r\n"]. The controller
 *     replies with one JSON line per request; we frame on CR?LF and CORRELATE each reply
 *     to its request by the echoed "Communication"/"Command"/"Instruction" name (+
 *     "SequenceID" for an Instruction) — NOT FIFO (doc 81 Đợt 1B Task 5, ruling R12).
 *     ⚠ The echo of the packet name and of the SequenceID in every reply is an ASSUMPTION
 *     — to be confirmed at FAT (B-84184EN); an unmatched reply is discarded (fail-closed:
 *     the request times out, it never takes another request's reply).
 *   • Packet categories (top-level discriminator key)  [RMI §2, §2.3, §2.4]:
 *       - "Communication" : FRC_Connect / FRC_Disconnect (session lifecycle).
 *       - "Command"        : FRC_Initialize, FRC_Abort, FRC_GetStatus,
 *                            FRC_ReadCartesianPosition, … (immediate; not queued
 *                            into the TP program).
 *       - "Instruction"    : FRC_LinearMotion / FRC_JointMotionJRep / … (MOTION;
 *                            appended to the RMI_MOVE TP program; carry a
 *                            monotonically increasing SequenceID). Gated path only.
 *   • TWO-SOCKET HANDSHAKE (mandatory)  [RMI §2.2.1 p.6]: the remote device opens
 *     the well-known port **16001** and sends FRC_Connect. The reply carries
 *     ErrorID, **PortNumber**, MajorVersion, MinorVersion. The controller then
 *     AUTO-DISCONNECTS port 16001; ALL subsequent packets MUST use the returned
 *     PortNumber. So we ALWAYS close the 16001 socket and re-open on PortNumber —
 *     this is not optional. FRC_Connect is the ONLY packet ever sent on 16001.
 *
 * READ-MOSTLY: connect() performs the two-socket FRC_Connect handshake + a
 *   FRC_GetStatus probe only. It does NOT send FRC_Initialize — Initialize creates
 *   the running RMI_MOVE TP program (an actuation-enabling step), so it is deferred
 *   to the gated live-motion path. getState() polls FRC_GetStatus +
 *   FRC_ReadCartesianPosition (both read-only)  [RMI §2.3.7 p.14, §2.3.14 p.18].
 *
 * ⚠️ MOTION STAYS GATED (defence-in-depth). runJob() is reached ONLY from
 *   robotCommandDispatcher (idempotency + HITL 2-eyes + mode gate). This driver
 *   ALSO self-guards: when ROBOT_CONTROL_ENABLED!=='true' it BUILDS the RMI
 *   instruction packet and returns it as dry-run INTENT without opening/writing any
 *   motion packet and without ever sending FRC_Initialize. No ungated actuation.
 *   On the enabled path it first runs a status pre-check (ServoReady/TPMode; abort
 *   any already-running RMI) then FRC_Initialize, per the manual startup sequence
 *   [RMI §2.3.1 p.9].
 * ──────────────────────────────────────────────────────────────────────────
 */
import { createConnection } from "node:net";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth,
} from "../robotDriver";
import { abortThroughRunJob, AbortFence } from "../robotDriver";

/** Stable reason code: no RMI reply packet within the request timeout (outcome unknown). */
export const RMI_REPLY_TIMEOUT = "rmi_reply_timeout" as const;

/** doc 81 Đợt 1B Task 5 fix round 1 — RMI request timeout carries a reason code. */
export class FanucRmiTimeoutError extends Error {
  readonly reasonCode = RMI_REPLY_TIMEOUT;
  constructor(message: string) {
    super(message);
    this.name = "FanucRmiTimeoutError";
  }
}

/**
 * Well-known RMI "connect" port on R-30iB Plus controllers. FRC_Connect is sent
 * here; the controller then returns the actual session PortNumber to reconnect on
 * and drops this socket. [RMI §2.2.1 p.6]. Configurable via endpoint/options only
 * to support routers/NAT — it is not the session port.
 */
const DEFAULT_RMI_PORT = 16001;
/** Default group mask for FRC_Initialize — single group 1 (bit-field). [RMI §2.3.1 p.10] */
const DEFAULT_GROUP_MASK = 1;
/** Motion group used on read/motion packets (single-group system). [RMI §2.3.14 p.18] */
const DEFAULT_GROUP = 1;

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

/**
 * Create the running RMI_MOVE TP program (enables remote motion). ACTUATION-ENABLING
 * — only sent on the gated path. GroupMask is an unsigned-byte bit-field; if omitted
 * the controller defaults it to 1. [RMI §2.3.1 p.9-10]
 */
export function buildInitializePacket(groupMask: number = DEFAULT_GROUP_MASK): Record<string, unknown> {
  return { Command: "FRC_Initialize", GroupMask: groupMask };
}

/** Read controller/servo/program status. Read-only, works right after FRC_Connect. [RMI §2.3.7 p.14] */
export function buildGetStatusPacket(): Record<string, unknown> {
  return { Command: "FRC_GetStatus" };
}

/**
 * Read the CURRENT robot TCP Cartesian position (live; refreshed ~every 100 ms).
 * Reply carries Configuration + Position{X,Y,Z,W,P,R,Ext…} in the active UFrame.
 * This is the live pose seam for getState(). [RMI §2.3.14 p.18]
 */
export function buildReadCartesianPositionPacket(group = DEFAULT_GROUP): Record<string, unknown> {
  return { Command: "FRC_ReadCartesianPosition", Group: group };
}

/**
 * Read a STORED position register PR[n] (NOT the live robot pose — that is
 * FRC_ReadCartesianPosition). Kept for register inspection/tests. [RMI §2.3.18 p.21]
 */
export function buildReadPositionRegisterPacket(registerNumber: number, group = DEFAULT_GROUP): Record<string, unknown> {
  return { Command: "FRC_ReadPositionRegister", RegisterNumber: registerNumber, Group: group };
}

/**
 * Abort the running RMI_MOVE TP program (Command, not Instruction). Only valid while
 * RMI is running (RMIMotionStatus !== 0); the manual also requires an FRC_Abort (or
 * FRC_Disconnect) to end every RMI session so other TP programs can run. [RMI §2.3.2 p.11]
 */
export function buildAbortPacket(): Record<string, unknown> {
  return { Command: "FRC_Abort" };
}

/**
 * Translate a RobotJobSpec → a single RMI MOTION instruction packet, VERIFIED
 * against the RMI manual. Field mapping:
 *   • Cartesian params (x,y,z,…) → FRC_LinearMotion: Configuration + Position
 *     {X,Y,Z,W,P,R}, SpeedType/Speed/TermType/TermValue. [RMI §2.4.7 p.28]
 *   • Explicit joint angles → FRC_JointMotionJRep ("joint representation"): a
 *     JointAngle{J1..J6} block and NO Configuration. [RMI §2.4.13 p.50]
 * NOTE: FRC_JointMotion (§2.4.9) takes a Cartesian Position, not joint angles —
 *   only the *JRep variant accepts JointAngle, which is why joint moves emit
 *   FRC_JointMotionJRep here. SpeedType strings are the manual's exact spellings:
 *   "mmSec"/"InchMin"/"Time"/"mSec" for linear [RMI §2.4.7 p.29]; "Percent"/"Time"/
 *   "mSec" for joint [RMI §2.4.9 p.39]. TermType is "FINE"|"CNT"|"CR"; TermValue is
 *   the CNT corner value 1-100 (ignored when FINE). [RMI §2.4.7 p.29]
 * Exported for unit testing the exact packet shape. NEVER sends anything.
 */
export function buildFanucInstruction(job: RobotJobSpec, sequenceId: number): Record<string, unknown> {
  const p = job.params ?? {};
  const speed = Number(p.speed ?? 50);
  const termType = typeof p.termType === "string" ? p.termType : "FINE";
  const termValue = termType === "FINE" ? 0 : Number(p.termValue ?? 50);

  // Joint move (FRC_JointMotionJRep): explicit joint angles, joint representation.
  if (Array.isArray(p.joints) || job.jobType === "home") {
    const raw = Array.isArray(p.joints) ? (p.joints as number[]) : [0, 0, 0, 0, 0, 0];
    const j = [0, 1, 2, 3, 4, 5].map((i) => Number(raw[i] ?? 0));
    return {
      Instruction: "FRC_JointMotionJRep",
      SequenceID: sequenceId,
      JointAngle: { J1: j[0], J2: j[1], J3: j[2], J4: j[3], J5: j[4], J6: j[5] },
      SpeedType: "Percent",
      Speed: Number(p.velPct ?? (job.jobType === "home" ? 20 : speed)),
      TermType: termType,
      TermValue: termValue,
    };
  }

  // Cartesian move (FRC_LinearMotion): Configuration + Position{X,Y,Z,W,P,R}.
  const uTool = Number(p.uToolNumber ?? 1);
  const uFrame = Number(p.uFrameNumber ?? 1);
  const speedType = typeof p.speedType === "string" ? p.speedType : "mmSec";
  const configuration = {
    UToolNumber: uTool,
    UFrameNumber: uFrame,
    Front: 1, Up: 1, Left: 1, Flip: 1, Turn4: 0, Turn5: 0, Turn6: 0,
    ...(typeof p.configuration === "object" && p.configuration ? (p.configuration as Record<string, unknown>) : {}),
  };
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
    TermValue: termValue,
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

/** Stable reason code: the RMI socket closed / errored while a request was pending. */
export const RMI_CONNECTION_CLOSED = "rmi_connection_closed" as const;

/** doc 81 Đợt 1B Task 5 fix round 2 — RMI socket drop under a pending request (outcome unknown). */
export class FanucRmiClosedError extends Error {
  readonly reasonCode = RMI_CONNECTION_CLOSED;
  constructor(message: string) {
    super(message);
    this.name = "FanucRmiClosedError";
  }
}

/** Stable reason code: the RMI session was reset because another request timed out. */
export const RMI_SESSION_RESET = "rmi_session_reset" as const;

/** Fix round 3 — requests still pending when a timeout resets the session (outcome unknown). */
export class FanucRmiResetError extends Error {
  readonly reasonCode = RMI_SESSION_RESET;
  constructor(message: string) {
    super(message);
    this.name = "FanucRmiResetError";
  }
}

/** Stable reason code: refused before any byte (no client / session down). */
export const RMI_NOT_CONNECTED = "rmi_not_connected" as const;

export class FanucRmiNotConnectedError extends Error {
  readonly reasonCode = RMI_NOT_CONNECTED;
  constructor(message = "FANUC RMI: not connected") {
    super(message);
    this.name = "FanucRmiNotConnectedError";
  }
}

/**
 * Correlation key of an RMI packet: the echoed discriminator (`Communication` / `Command` /
 * `Instruction`) and, for an Instruction, its `SequenceID` (RMI B-84184EN: every response
 * echoes the packet name; instruction responses echo the SequenceID). Exported for tests.
 */
export function rmiReplyKey(pkt: Record<string, unknown>): string {
  if (typeof pkt.Communication === "string") return `C:${pkt.Communication}`;
  if (typeof pkt.Command === "string") return `K:${pkt.Command}`;
  if (typeof pkt.Instruction === "string") {
    return pkt.SequenceID != null ? `I:${pkt.Instruction}#${String(pkt.SequenceID)}` : `I:${pkt.Instruction}`;
  }
  return "?";
}

/**
 * Minimal RMI transport: one TCP socket, CRLF-framed JSON request/response.
 *
 * doc 81 Đợt 1B Task 5 fix round 2 (ruling R12) — replies are CORRELATED, not FIFO. Each
 * waiter carries the key of its request ({@link rmiReplyKey}); an incoming packet resolves the
 * OLDEST waiter with the same key. A packet matching no waiter is DISCARDED — never handed to
 * the next waiter (FIFO used to let a late FRC_Abort reply resolve FRC_Initialize and a late
 * motion reply resolve FRC_Abort ⇒ false "done" / false "abort_sent").
 *
 * Fix round 3 — a request TIMEOUT resets the whole session (socket destroyed, client marked
 * dropped, every other pending request rejected with rmi_session_reset). Its late reply can
 * then never reach a newer request of the same name (Commands carry no sequence id), and —
 * unlike the round-2 tombstone — one lost reply no longer leaves that key one step behind for
 * the rest of the session (every later STOP used to be recorded abort_failed). The driver
 * re-opens a session (FRC_Connect) for the next STOP.
 *
 * A socket error/close under us rejects every pending send with {@link FanucRmiClosedError}
 * (reasonCode rmi_connection_closed) and marks the client DROPPED, so the driver can open a
 * fresh RMI session (FRC_Connect again) to deliver a stop.
 */
export class FanucRmiClient {
  private socket: NetSocket | null = null;
  private rxBuf = "";
  private pending: Array<{
    key: string;
    resolve: (v: Record<string, unknown>) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private connected = false;
  private dropped = false;
  /** Count of reply packets discarded as stale/unmatched (observability + tests). */
  discarded = 0;

  isConnected(): boolean {
    return this.connected;
  }

  /** True when the PEER closed / the socket errored (not a local close()). */
  wasDropped(): boolean {
    return this.dropped;
  }

  open(host: string, port: number, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = createConnection({ host, port });
      this.socket = socket;
      this.rxBuf = "";
      this.dropped = false;
      const isCurrent = () => this.socket === socket;

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
      socket.on("data", (buf: Buffer) => {
        if (!isCurrent()) return;
        this.onData(buf);
      });
      socket.on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          reject(err);
        }
        if (!isCurrent()) return;
        this.drop(new FanucRmiClosedError(`FANUC RMI socket error: ${err?.message ?? String(err)}`));
      });
      socket.on("close", () => {
        if (!isCurrent()) return;
        this.drop(new FanucRmiClosedError("FANUC RMI socket closed"));
      });
    });
  }

  private drop(err: Error): void {
    const wasConnected = this.connected;
    const s = this.socket;
    this.connected = false;
    this.socket = null;
    this.rxBuf = "";
    if (wasConnected) this.dropped = true;
    this.failAllPending(err);
    if (s && !s.destroyed) {
      try { s.destroy(); } catch { /* ignore */ }
    }
  }

  private onData(buf: Buffer | string): void {
    this.rxBuf += Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
    const { packets, rest } = parseFanucFrames(this.rxBuf);
    this.rxBuf = rest;
    for (const pkt of packets) {
      const key = rmiReplyKey(pkt);
      const idx = this.pending.findIndex((w) => w.key === key);
      if (idx < 0) {
        this.discarded++; // matches no waiter ⇒ never handed to another request
        continue;
      }
      const [waiter] = this.pending.splice(idx, 1);
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

  /** Write one packet and await ITS response (correlated by key), under a timeout. */
  send(pkt: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new FanucRmiNotConnectedError());
        return;
      }
      const key = rmiReplyKey(pkt);
      const socket = this.socket;
      const timer = setTimeout(() => {
        const idx = this.pending.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.pending.splice(idx, 1);
        reject(new FanucRmiTimeoutError(`FANUC RMI ${packetType(pkt)} timeout after ${timeoutMs}ms`));
        // Fix round 3 — reset the session: the late reply dies with the old socket.
        if (this.socket === socket) {
          this.drop(new FanucRmiResetError(`FANUC RMI session reset: ${packetType(pkt)} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this.pending.push({ key, resolve, reject, timer });
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
    const s = this.socket;
    this.socket = null;
    if (s) {
      try { s.destroy(); } catch { /* ignore */ }
    }
  }
}

/**
 * Map GetStatus.TPMode → a human-readable mode. TPMode is a BOOLEAN teach-pendant
 * flag, not a 3-way T1/T2/AUTO selector: 0 = teach pendant DISABLED (controller in
 * AUTO/remote — the only state in which RMI operates), 1 = teach pendant ENABLED
 * (manual/teach). [RMI §2.3.7 p.14]
 */
function decodeTpMode(tpMode: number): string {
  return tpMode === 0 ? "auto" : "manual";
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
  private sessionPort = DEFAULT_RMI_PORT; // resolved from FRC_Connect PortNumber
  private timeoutMs = 5000;
  private groupMask = DEFAULT_GROUP_MASK;
  private group = DEFAULT_GROUP;
  /**
   * Escape hatch for lab/NAT setups where the returned PortNumber is not reachable
   * and FRC_Connect + traffic must share one port. Default false: honour the manual
   * two-socket flow (reconnect to the returned PortNumber). [RMI §2.2.1 p.6]
   */
  private skipPortReconnect = false;
  private version: { major?: number; minor?: number } = {};
  private seq = 1;
  private readonly fence = new AbortFence();
  private reopening: Promise<void> | null = null;

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
    this.group = typeof opts.group === "number" ? opts.group : DEFAULT_GROUP;
    this.skipPortReconnect = opts.skipPortReconnect === true;

    // The endpoint/options port is the well-known CONNECT port (16001), not the
    // session port — that is handed back by FRC_Connect. [RMI §2.2.1 p.6]
    const defaultPort = typeof opts.port === "number" ? opts.port : DEFAULT_RMI_PORT;
    const { host, port } = this.parseEndpoint(cfg.endpoint, defaultPort);
    this.host = host;
    this.port = port;

    try {
      await this.openSession();

      // Read-only probe on the session socket (does NOT enable motion). Also seeds the
      // instruction SequenceID from the controller when it tracks one. [RMI §2.3.7 p.14]
      const status = await this.rmi().send(buildGetStatusPacket(), this.timeoutMs);
      this.assertOk(status, "FRC_GetStatus");
      const nextSeq = Number(status.NextSequenceID);
      if (Number.isFinite(nextSeq) && nextSeq > 0) this.seq = nextSeq;

      this.connected = true;
      this.connectedAt = new Date();
      this.lastOkAt = new Date();
      this.lastError = undefined;
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      try { this.client?.close(); } catch { /* ignore */ }
      this.client = null;
      this.connected = false;
      throw err;
    }
  }

  /**
   * Open an RMI session: socket #1 on the connect port, FRC_Connect (the ONLY packet sent
   * there), then socket #2 on the returned session port. [RMI §2.2.1 p.6] Sets this.client.
   * Used by connect() and — fix round 2 — to re-open a session the peer dropped.
   */
  private async openSession(): Promise<void> {
    const connectClient = new FanucRmiClient();
    try {
      await connectClient.open(this.host, this.port, this.timeoutMs);
      const connectResp = await connectClient.send(buildConnectPacket(), this.timeoutMs);
      this.assertOk(connectResp, "FRC_Connect");
      this.version = { major: Number(connectResp.MajorVersion), minor: Number(connectResp.MinorVersion) };

      // Socket #2: the controller returns PortNumber and auto-drops port 16001, so we
      // MUST reconnect there for every subsequent packet. [RMI §2.2.1 p.6]
      const sessionPort = Number(connectResp.PortNumber);
      if (!this.skipPortReconnect && Number.isFinite(sessionPort) && sessionPort > 0) {
        connectClient.close(); // controller has already dropped this socket
        const sessionClient = new FanucRmiClient();
        await sessionClient.open(this.host, sessionPort, this.timeoutMs);
        this.sessionPort = sessionPort;
        this.client = sessionClient;
      } else {
        // Escape hatch (skipPortReconnect) or a controller that returned no port.
        this.sessionPort = this.port;
        this.client = connectClient;
      }
    } catch (err) {
      try { connectClient.close(); } catch { /* ignore */ }
      throw err;
    }
  }

  /** The current RMI client, or a coded refusal (never a non-null assertion). */
  private rmi(): FanucRmiClient {
    const c = this.client;
    if (!c) throw new FanucRmiNotConnectedError();
    return c;
  }

  /**
   * Replace a dropped / reset session with a fresh one. SINGLE-FLIGHT (fix round 3): concurrent
   * callers share one promise, so only ONE FRC_Connect runs and no client leaks. The old client
   * stays in place (dropped) until the new one is open — if re-opening fails, the next STOP
   * retries.
   */
  private reopenSession(): Promise<void> {
    if (!this.reopening) {
      this.reopening = (async () => {
        const old = this.client;
        await this.openSession();
        if (old && old !== this.client) {
          try { old.close(); } catch { /* ignore */ }
        }
      })().finally(() => {
        this.reopening = null;
      });
    }
    return this.reopening;
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
    if (!this.connected || !this.client) throw new DeviceUnreachableError("fanucRobot");
    try {
      const status = await this.client.send(buildGetStatusPacket(), this.timeoutMs);
      const errId = Number(status.ErrorID ?? 0);
      const tpMode = Number(status.TPMode ?? 0);
      // RMIMotionStatus: 1 = RMI running, 0 = not running. [RMI §2.3.7 p.14]
      const motion = Number(status.RMIMotionStatus ?? 0);

      let pose: RobotState["pose"];
      try {
        // Live TCP pose (not a stored register). [RMI §2.3.14 p.18]
        const cart = await this.client.send(buildReadCartesianPositionPacket(this.group), this.timeoutMs);
        pose = this.decodePose(cart);
      } catch (err) {
        // A pose read is best-effort; never fail the whole poll on it.
        this.lastError = (err as Error)?.message || String(err);
      }

      this.lastOkAt = new Date();
      return {
        mode: decodeTpMode(tpMode),
        busy: motion === 1,
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

  /**
   * Decode an FRC_ReadCartesianPosition (or FRC_ReadPositionRegister) response →
   * RobotPose. Both carry a Position{X,Y,Z,W,P,R} block; joint replies carry
   * JointAngle{J1..}. [RMI §2.3.14 p.18 / §2.3.18 p.21]
   */
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
    if (!this.connected) throw new DeviceUnreachableError("fanucRobot");
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
   * RMI instruction packet (FRC_LinearMotion for cartesian, FRC_JointMotionJRep for
   * joint targets) and return it as dry-run INTENT — no FRC_Initialize, no write, no
   * actuation. Only in the enabled branch do we run the manual startup sequence
   * (FRC_GetStatus pre-check → abort any running RMI → FRC_Initialize creates the
   * RMI_MOVE program) before sending the motion instruction. [RMI §2.3.1 p.9]
   */
  async runJob(job: RobotJobSpec): Promise<RobotJobResult> {
    if (!this.connected || (!this.client && !this.reopening)) {
      return { ok: false, status: "failed", error: "not connected", detail: { jobType: job.jobType, reasonCode: RMI_NOT_CONNECTED, sent: false } };
    }

    // doc 81 Đợt 1B Task 5 fix round 1 — abort fence: `guard()` runs right before EVERY send
    // below (FanucRmiClient.send writes synchronously), so once abort() has bumped the epoch
    // this job — possibly mid GetStatus→Abort→Initialize chain — sends nothing more.
    const guard = this.fence.capture(job);
    let sequenceId = this.seq++;
    let packet = job.jobType === "abort"
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
      // doc 81 Đợt 1B Task 5 fix round 2 — the peer dropped the RMI socket (e.g. mid-motion):
      // the session is gone, so open a NEW one (FRC_Connect again) before sending — this is
      // how the dispatcher's FRC_Abort still reaches the controller after a drop.
      //    Fix round 3 — ONLY a STOP re-opens the session; a motion job never runs on a session
      //    opened after a drop/reset it did not see (isConnected() is false ⇒ dispatcher gate 3
      //    refuses new motion; a motion job already in flight is refused here).
      if (this.reopening || this.rmi().wasDropped()) {
        if (job.jobType !== "abort") {
          throw new FanucRmiNotConnectedError("FANUC RMI: session dropped/reset — only a stop may re-open it");
        }
        await this.reopenSession();
      }
      // FRC_Abort is a Command that needs no Initialize; motion instructions do.
      if (job.jobType !== "abort") {
        // Manual startup pre-check before creating the RMI_MOVE program. [RMI §2.3.1 p.9]
        guard();
        const st = await this.rmi().send(buildGetStatusPacket(), this.timeoutMs);
        this.assertOk(st, "FRC_GetStatus");
        if (Number(st.ServoReady ?? 0) !== 1) {
          return { ok: false, status: "failed", error: "FANUC RMI: servo not ready (ServoReady!=1)", detail: { sequenceId } };
        }
        if (Number(st.TPMode ?? 0) !== 0) {
          // TPMode 0 = teach pendant disabled (AUTO/remote); 1 = TP enabled (manual). [RMI §2.3.7 p.14]
          return { ok: false, status: "failed", error: "FANUC RMI: controller not in AUTO/remote (TPMode!=0)", detail: { sequenceId } };
        }
        // If RMI is already running, abort it first so FRC_Initialize can succeed. [RMI §2.3.1 p.9]
        if (Number(st.RMIMotionStatus ?? 0) !== 0) {
          guard();
          // Fix round 3 — no longer swallowed: a TIMED-OUT pre-abort means the RMI state is
          // unknown (and the session is reset) ⇒ the job fails with rmi_reply_timeout and the
          // dispatcher sends a stop. An ErrorID reply (nothing to abort) still resolves.
          await this.rmi().send(buildAbortPacket(), this.timeoutMs);
        }
        guard();
        const init = await this.rmi().send(buildInitializePacket(this.groupMask), this.timeoutMs);
        this.assertOk(init, "FRC_Initialize");
        // FRC_Initialize recreates RMI_MOVE; sequence IDs restart at 1 (or the
        // controller's NextSequenceID). Rebuild the motion packet with the fresh,
        // consecutive SequenceID the freshly-created program expects. [RMI §2.4 p.28]
        const seedSeq = Number(init.NextSequenceID);
        this.seq = Number.isFinite(seedSeq) && seedSeq > 0 ? seedSeq : 1;
        sequenceId = this.seq++;
        packet = buildFanucInstruction(job, sequenceId);
      }
      guard();
      const resp = await this.rmi().send(packet, this.timeoutMs);
      const errId = Number(resp.ErrorID ?? 0);
      if (errId !== 0) {
        return { ok: false, status: "failed", error: `RMI ErrorID ${errId}`, detail: { sequenceId, sent: true } };
      }
      this.lastOkAt = new Date();
      return { ok: true, status: "done", detail: { jobType: job.jobType, sequenceId, sent: true, reply: resp } };
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      this.lastError = msg;
      // Keep the reason code (rmi_reply_timeout ⇒ the dispatcher sends a stop; a fenced job
      // reports job_fenced_by_abort).
      const reasonCode = (err as { reasonCode?: unknown })?.reasonCode;
      return {
        ok: false,
        status: "failed",
        error: msg,
        ...(typeof reasonCode === "string" ? { detail: { jobType: job.jobType, sequenceId, reasonCode } } : {}),
      };
    }
  }

  /**
   * FRC_Abort routed through the gated runJob path (dry-run unless enabled). doc 81 Đợt 1B
   * Task 5: a failed/unsent abort is SURFACED (throws), no longer swallowed.
   */
  async abort(): Promise<void> {
    this.fence.bump(); // FIRST: any job started before this abort can send nothing more
    await abortThroughRunJob((job) => this.runJob(job), "FANUC RMI");
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
