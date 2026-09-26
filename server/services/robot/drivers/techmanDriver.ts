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
import { closeModbusClient } from "../../ot/drivers/boundedClose";
import {
  isTechmanScriptAllowed,
  isTechmanUnvalidatedConsoleVerb,
  TECHMAN_CONSOLE_VERB_UNVALIDATED,
  TECHMAN_SCRIPT_NOT_ALLOWLISTED,
} from "./techmanScriptAllowlist";
import type {
  RobotDriver, RobotVendor, RobotConnectionConfig, RobotState, RobotStateHandle,
  OnRobotState, RobotJobSpec, RobotJobResult, RobotHealth,
} from "../robotDriver";
import { abortThroughRunJob } from "../robotDriver";

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
 * TMSCT FRAME (TM Expression Editor & Listen Node manual):
 *   $TMSCT,<len>,<id>,<script>,*<checksum>\r\n
 *   - <len>     : byte length of the "<id>,<script>" data
 *   - <id>      : a transaction id (we use a monotonic counter); the reply echoes it
 *   - <script>  : TM script statement, e.g. "PTP(\"JPP\",j0,..,j5,vel,acc,0,false)"
 *   - <checksum>: XOR of EVERY byte BETWEEN `$` and `*` (neither included) — i.e. of
 *                 "TMSCT,<len>,<id>,<script>," — two-digit upper-hex.
 *   Manual example (the test oracle): $TMSCT,25,1,ChangeBase("RobotBase"),*08
 *
 * doc 81 Đợt 1B Task 4 — the checksum used to be computed over "<id>,<script>" only
 * (BE2 measured `…*7E` for the manual example instead of `*08`).
 *
 * We translate the platform RobotJobSpec into a single script statement; a `custom` job's
 * `params.script` must be in TECHMAN_SCRIPT_ALLOWLIST or this THROWS
 * (`tm_script_not_allowlisted`) — no frame is built for it.
 *
 * Exported for unit testing of the exact wire format.
 */
export function buildTmsct(job: RobotJobSpec, id: number): string {
  return frameTmsct(id, jobToScript(job));
}

/**
 * Frame ONE already-vetted script statement as a TMSCT command. Callers inside this module
 * only pass scripts produced by jobToScript (typed jobs or the allowlist); exported for the
 * wire-format oracle test against the TM manual example.
 */
export function frameTmsct(id: number, script: string): string {
  const data = `${id},${script}`;
  const body = `TMSCT,${Buffer.byteLength(data, "utf8")},${data},`;
  return `$${body}*${listenNodeChecksum(body)}\r\n`;
}

/**
 * Listen Node checksum: XOR of every byte of `betweenDollarAndStar` — the caller passes the
 * text strictly BETWEEN `$` and `*` (e.g. `TMSCT,25,1,ChangeBase("RobotBase"),`). Two-digit
 * upper-hex.
 */
export function listenNodeChecksum(betweenDollarAndStar: string): string {
  let x = 0;
  for (const b of Buffer.from(betweenDollarAndStar, "utf8")) x ^= b;
  return x.toString(16).toUpperCase().padStart(2, "0");
}

/** Stable reason codes for a Listen Node exchange that did NOT end in an accepted OK. */
export type TmReplyReasonCode =
  | "tm_script_error"
  | "tm_cperr"
  | "tm_reply_bad_checksum"
  | "tm_reply_id_mismatch"
  | "tm_reply_unexpected"
  | "tm_reply_malformed"
  | "tm_connection_closed"
  | "tm_reply_timeout"
  | "tm_socket_error";

export type TmReplyVerdict =
  | { ok: true; reply: string; warnings?: number[] }
  | { ok: false; reasonCode: TmReplyReasonCode; message: string; reply?: string; deviceErrorCode?: string };

/** Longest data field we are willing to buffer for one reply (a reply is short: "<id>,OK"). */
const MAX_REPLY_DATA_LEN = 4096;

/**
 * Length-framed parse of ONE Listen Node frame at the start of `buf` (latin1, so 1 char = 1
 * byte): `$<HEADER>,<len>,<data>,*<CS>` with an optional trailing `\r\n`.
 *   • "incomplete" — more bytes are needed;
 *   • "malformed"  — the bytes can never become a valid frame;
 *   • "frame"      — header/data/checksum (+ whether the checksum is right).
 * Exported for unit tests.
 */
export function parseListenNodeFrame(
  buf: string,
):
  | { kind: "incomplete" }
  | { kind: "malformed"; text: string }
  | { kind: "frame"; header: string; data: string; checksum: string; checksumOk: boolean; text: string } {
  const s = buf.replace(/^[\r\n\s]+/, "");
  if (s.length === 0) return { kind: "incomplete" };
  const head = /^\$([A-Za-z]+),(\d+),/.exec(s);
  if (!head) {
    // Still a plausible prefix of "$HEADER,LEN," ⇒ wait for more bytes; otherwise junk.
    return /^\$[A-Za-z]{0,16}(,\d{0,6})?$/.test(s) ? { kind: "incomplete" } : { kind: "malformed", text: s };
  }
  const len = Number(head[2]);
  if (!Number.isFinite(len) || len > MAX_REPLY_DATA_LEN) return { kind: "malformed", text: s };
  const dataStart = head[0].length;
  const tailStart = dataStart + len;
  if (s.length < tailStart + 4) return { kind: "incomplete" };
  const tail = s.slice(tailStart, tailStart + 4);
  if (!/^,\*[0-9A-Fa-f]{2}$/.test(tail)) return { kind: "malformed", text: s };
  const checksum = tail.slice(2).toUpperCase();
  let x = 0;
  // Checksum over the bytes strictly between `$` (index 0) and `*` (index tailStart + 1).
  for (let i = 1; i <= tailStart; i++) x ^= s.charCodeAt(i) & 0xff;
  const text = s.slice(0, tailStart + 4);
  return {
    kind: "frame",
    header: head[1].toUpperCase(),
    data: s.slice(dataStart, tailStart),
    checksum,
    checksumOk: x.toString(16).toUpperCase().padStart(2, "0") === checksum,
    text,
  };
}

/**
 * Classify ONE complete Listen Node frame against the id of the TMSCT we sent.
 * Only `$TMSCT,<len>,<sentId>,OK[;<line>…],*CS` with a correct checksum is accepted; every
 * other frame is a failure with a stable reason code (never `done`).
 * Exported for unit tests.
 */
export function classifyTmsctReply(
  frame: { header: string; data: string; checksumOk: boolean; text: string },
  sentId: number,
): TmReplyVerdict {
  const reply = frame.text;
  if (!frame.checksumOk) {
    return { ok: false, reasonCode: "tm_reply_bad_checksum", message: "TM reply checksum mismatch", reply };
  }
  if (frame.header === "CPERR") {
    return {
      ok: false,
      reasonCode: "tm_cperr",
      message: `TM communication error $CPERR ${frame.data}`,
      reply,
      deviceErrorCode: frame.data,
    };
  }
  if (frame.header !== "TMSCT") {
    return { ok: false, reasonCode: "tm_reply_unexpected", message: `unexpected TM frame $${frame.header}`, reply };
  }
  const comma = frame.data.indexOf(",");
  const id = comma >= 0 ? frame.data.slice(0, comma) : frame.data;
  const result = comma >= 0 ? frame.data.slice(comma + 1) : "";
  if (id !== String(sentId)) {
    return {
      ok: false,
      reasonCode: "tm_reply_id_mismatch",
      message: `TM reply id "${id}" does not match sent id ${sentId}`,
      reply,
    };
  }
  if (result === "OK") return { ok: true, reply };
  const okWarn = /^OK((?:;\d+)+)$/.exec(result);
  if (okWarn) {
    return { ok: true, reply, warnings: okWarn[1].slice(1).split(";").map(Number) };
  }
  if (/^ERROR(;|$)/.test(result)) {
    return { ok: false, reasonCode: "tm_script_error", message: `TM script rejected: ${result}`, reply };
  }
  return { ok: false, reasonCode: "tm_reply_unexpected", message: `unrecognised TMSCT result "${result}"`, reply };
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
      // doc 81 Đợt 1B Task 5 (R10a) — console start/reset/pause arrive as `custom` and would
      // default to ScriptExit() (TMflow then continues the flow, possibly with motion).
      // Refused until FAT validates them — even with an allowlisted script.
      if (isTechmanUnvalidatedConsoleVerb(p.command)) {
        throw new TechmanScriptRefusedError(TECHMAN_CONSOLE_VERB_UNVALIDATED);
      }
      // doc 81 Đợt 1B Task 4 — an explicit script passes ONLY if it is in the allowlist
      // (BE2 T1-G: any string used to go straight to the Listen Node).
      if (p.script !== undefined) {
        if (!isTechmanScriptAllowed(p.script)) {
          throw new TechmanScriptRefusedError();
        }
        return p.script;
      }
      return `ScriptExit()`;
  }
}

/** Thrown by jobToScript/buildTmsct for a `params.script` outside TECHMAN_SCRIPT_ALLOWLIST. */
export class TechmanScriptRefusedError extends Error {
  constructor(
    readonly reasonCode:
      | typeof TECHMAN_SCRIPT_NOT_ALLOWLISTED
      | typeof TECHMAN_CONSOLE_VERB_UNVALIDATED = TECHMAN_SCRIPT_NOT_ALLOWLISTED,
  ) {
    super(
      reasonCode === TECHMAN_CONSOLE_VERB_UNVALIDATED
        ? `${TECHMAN_CONSOLE_VERB_UNVALIDATED}: console start/reset/pause are not validated on Techman (would send ScriptExit())`
        : `${TECHMAN_SCRIPT_NOT_ALLOWLISTED}: params.script is not in TECHMAN_SCRIPT_ALLOWLIST`,
    );
    this.name = "TechmanScriptRefusedError";
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

    // doc 81 Đợt 1B Task 1 — hạ client cũ (nếu có) trước khi thay, không rò socket.
    if (this.mbClient) {
      const prev = this.mbClient;
      this.mbClient = null;
      this.connected = false;
      await closeModbusClient(prev);
    }
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
      // doc 81 Đợt 1B Task 1 — close(cb) của modbus-serial không gọi cb khi socket chưa
      // từng mở/đã đứt (BE1 §1.3) ⇒ đóng CÓ HẠN rồi destroy socket nền.
      await closeModbusClient(client);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.mbClient;
    this.mbClient = null;
    this.connected = false;
    // doc 81 Đợt 1B Task 1 — đóng có hạn (≤ DEFAULT_CLOSE_TIMEOUT_MS rồi destroy).
    await closeModbusClient(client);
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
    let command: string;
    try {
      command = buildTmsct(job, id);
    } catch (err) {
      // doc 81 Đợt 1B Task 4 — script outside the allowlist: refuse BEFORE any socket
      // (both dry-run and live), with a stable reason code.
      if (err instanceof TechmanScriptRefusedError) {
        this.lastError = err.message;
        return {
          ok: false,
          status: "failed",
          error: err.message,
          detail: { jobType: job.jobType, sent: false, reasonCode: err.reasonCode },
        };
      }
      throw err;
    }

    // Self-guard dry-run: never open the Listen Node socket unless enabled.
    if (process.env.ROBOT_CONTROL_ENABLED !== "true") {
      return {
        ok: true,
        status: "done",
        detail: { dryRun: true, jobType: job.jobType, tmsct: command, sent: false },
      };
    }

    // doc 81 Đợt 1B Task 4 — the reply is CLASSIFIED: only a checksum-valid
    // `$TMSCT,…,<id>,OK,*CS` for THIS id is `done`; ERROR / $CPERR / bad checksum / wrong id /
    // closed / silent ⇒ `failed` with a reason code (BE2 T1 B/C/D: all of them used to be `done`).
    const verdict = await this.sendListenNode(command, id);
    if (verdict.ok) {
      return {
        ok: true,
        status: "done",
        detail: {
          jobType: job.jobType,
          tmsct: command,
          sent: true,
          reply: verdict.reply,
          ...(verdict.warnings ? { warnings: verdict.warnings } : {}),
        },
      };
    }
    const error = `${verdict.reasonCode}: ${verdict.message}`;
    this.lastError = error;
    return {
      ok: false,
      status: "failed",
      error,
      detail: {
        jobType: job.jobType,
        tmsct: command,
        sent: true,
        reasonCode: verdict.reasonCode,
        ...(verdict.reply !== undefined ? { reply: verdict.reply } : {}),
        ...(verdict.deviceErrorCode !== undefined ? { deviceErrorCode: verdict.deviceErrorCode } : {}),
      },
    };
  }

  /**
   * Open a short-lived TCP socket to the TM Listen Node, send one TMSCT frame, read until
   * ONE complete length-framed reply arrives, classify it against `sentId`, then close.
   * Never rejects: every outcome is a TmReplyVerdict. Closed/silent/socket error before a
   * complete frame ⇒ failure verdict (never an implicit ack).
   *
   * NOTE: real Listen Node sessions are often long-lived and stream TMSTA
   * status; this one-shot send/ack keeps the dispatcher's per-job model.
   */
  private sendListenNode(command: string, sentId: number): Promise<TmReplyVerdict> {
    return new Promise<TmReplyVerdict>((resolve) => {
      const socket = createConnection({ host: this.listenHost, port: this.listenPort });
      let settled = false;
      let buf = "";
      const finish = (v: TmReplyVerdict) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.destroy(); } catch { /* ignore */ }
        resolve(v);
      };
      const timer = setTimeout(
        () =>
          finish({
            ok: false,
            reasonCode: "tm_reply_timeout",
            message: `no complete TM Listen Node reply within ${this.timeoutMs}ms`,
            ...(buf ? { reply: buf } : {}),
          }),
        this.timeoutMs,
      );
      if (typeof timer.unref === "function") timer.unref();

      socket.on("connect", () => socket.write(command));
      socket.on("data", (chunk: Buffer) => {
        buf += chunk.toString("latin1");
        const parsed = parseListenNodeFrame(buf);
        if (parsed.kind === "incomplete") return;
        if (parsed.kind === "malformed") {
          finish({ ok: false, reasonCode: "tm_reply_malformed", message: "malformed TM Listen Node reply", reply: parsed.text });
          return;
        }
        finish(classifyTmsctReply(parsed, sentId));
      });
      socket.on("error", (e: Error) => {
        finish({ ok: false, reasonCode: "tm_socket_error", message: e?.message || String(e) });
      });
      socket.on("close", () => {
        // Closed before a complete reply ⇒ NOT an ack (this used to resolve "" ⇒ done).
        finish({
          ok: false,
          reasonCode: "tm_connection_closed",
          message: "TM Listen Node closed the connection before a complete reply",
          ...(buf ? { reply: buf } : {}),
        });
      });
    });
  }

  /**
   * Abort: send `StopAndClearBuffer()` through the gated runJob path. doc 81 Đợt 1B Task 5
   * (R10c): the classified verdict is SURFACED — a `failed` reply (tm_reply_timeout,
   * tm_connection_closed, ERROR, …) throws RobotAbortFailedError instead of being discarded,
   * so the dispatcher's timeout path records abort_failed honestly.
   */
  async abort(): Promise<void> {
    await abortThroughRunJob((job) => this.runJob(job), "Techman");
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
