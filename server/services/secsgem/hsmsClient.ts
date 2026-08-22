/**
 * SECS/GEM Connectivity FRAMEWORK — HSMS client (SEMI E37, SECS-over-TCP).
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * This is a CONNECT/TEST skeleton, NOT a production HSMS driver. It implements:
 *   - the HSMS connection state machine (NOT_CONNECTED → CONNECTED → SELECTED),
 *   - the control-message exchange Select.req/rsp, Linktest.req/rsp, Separate.req,
 *   - the HSMS message FRAMING (4-byte length prefix + 10-byte header + body),
 *   over `node:net`. It is FAIL-SAFE and LAZY (no socket is opened unless the
 *   caller explicitly invokes connect()).
 *
 * A full, round-trippable SECS-II ITEM codec now exists (see secs2Codec.ts) and a
 * small set of standard S1 messages are built on it (see s1Messages.ts). The
 * client can therefore send a REAL S1F1 and parse a REAL S1F2 (probeOnline() — a
 * strictly read/monitor liveness+model probe; NO equipment-control/write path).
 *
 * The E30 Communication + Control STATE MODELS (gemStateModel.ts) are wired in as
 * an observable `GemStateMachine`: reaching HSMS SELECTED + a successful S1F13/
 * S1F14 establish-comms handshake drives Communication → COMMUNICATING, and
 * requestOnline() sends the standard S1F17 online request and, on an accepted
 * S1F18 (ONLACK), drives Control → ONLINE/REMOTE. The S1F17/F18 online-request
 * handshake is the ONLY equipment-control interaction and is flag-gated.
 *
 * What still needs validation against real equipment (or a vetted library):
 *   - the REST of GEM (SEMI E30): dynamic event/report linking (S2F33/F35/F37),
 *     spooling, alarms (S5), recipe (S7), the full T1–T8 timer set,
 *   - data-message correlation by System Bytes, retries, and multi-block.
 * Do NOT treat testConnection() success as GEM compliance — it proves only that
 * a TCP peer answered HSMS Select + Linktest (probeOnline() additionally proves a
 * SECS-II S1F1/S1F2 round-trip; establishCommunications()/requestOnline() drive
 * the E30 comm+control state models — still NOT full E30 GEM compliance).
 */
import net from "node:net";
import { encodeItem, decodeItem, type SecsMessage, type SecsItem } from "./secsMessages";
import { decodeItem as decodeSecs2Item, type Secs2Item } from "./secs2Codec";
import { DeviceUnreachableError } from "../../_core/deviceErrors";
import {
  encodeBody as encodeSecs2Body,
  s1f1,
  s1f13,
  s1f17,
  parseS1F2,
  parseS1F14,
  parseS1F18,
  type Secs2Message,
  type OnlineData,
} from "./s1Messages";
import {
  GemStateMachine,
  type GemStateListeners,
  type GemCommState,
  type GemControlState,
} from "./gemStateModel";
import {
  parseS5F1,
  parseS6F11,
  s5f2,
  s6f12,
  ACKC5,
  ACKC6,
  type LiveDispatchHandlers,
} from "./s5s6Messages";

/**
 * Master flag (default OFF). Read inline (not imported from secsGemRegistry) to
 * avoid a value-level import cycle hsmsClient ⇄ secsGemRegistry. Kept identical to
 * secsGemRegistry.isSecsGemEnabled() so gating stays consistent.
 */
function isSecsGemEnabled(): boolean {
  return process.env.SECS_GEM_ENABLED === "true";
}

/**
 * Live-dispatch sub-flag (default OFF). Gates the inbound message-dispatch loop
 * (enableLiveDispatch) that decodes UNSOLICITED S5F1 alarms / S6F11 events and
 * acks them. It is a strict superset gate on top of SECS_GEM_ENABLED: BOTH must
 * be true for the loop to attach. Read inline (no import) to mirror the other
 * flag helpers here and avoid a value-level import cycle.
 */
function isSecsGemLiveEnabled(): boolean {
  return process.env.SECS_GEM_LIVE_ENABLED === "true";
}

/** HSMS connection states (SEMI E37). */
export type HsmsState = "NOT_CONNECTED" | "CONNECTED" | "SELECTED" | "SEPARATED";

/** HSMS SType (control message type) — the values used by this skeleton. */
export const SType = {
  DATA: 0, // a SECS-II data message
  SELECT_REQ: 1,
  SELECT_RSP: 2,
  // DESELECT_REQ: 3, DESELECT_RSP: 4 — not implemented (skeleton)
  LINKTEST_REQ: 5,
  LINKTEST_RSP: 6,
  // REJECT_REQ: 7 — not implemented
  SEPARATE_REQ: 9,
} as const;

export interface HsmsConfig {
  host: string;
  port: number;
  /** T5 connect-separation / connect timeout (ms). Default 5000. */
  connectTimeoutMs?: number;
  /** T6 control-transaction timeout (ms) for Select/Linktest reply. Default 5000. */
  controlTimeoutMs?: number;
  /** Device ID placed in the HSMS header session-id field. Default 0. */
  deviceId?: number;
  /** Equipment MDLN + SOFTREV to send in S1F13 (establish comms). Optional. */
  modelName?: string;
  softRev?: string;
  /** GEM state-model change listeners (comm/control). Optional. */
  gemListeners?: GemStateListeners;
}

export interface HsmsTestResult {
  ok: boolean;
  state: HsmsState;
  selected: boolean;
  linktestOk: boolean;
  latencyMs?: number;
  error?: string;
  /** Always present: this framework does NOT certify GEM compliance. */
  caveat: string;
}

const HONESTY_CAVEAT =
  "FRAMEWORK skeleton: HSMS Select/Linktest only. Full SECS-II codec + GEM state " +
  "machine require validation against real equipment or a vetted SECS library. " +
  "An OPTIONAL live message-dispatch loop (enableLiveDispatch — decodes UNSOLICITED " +
  "S5F1 alarms + S6F11 events and acks S5F2/S6F12, MVP best-effort) exists but is " +
  "OFF by default: it requires SECS_GEM_LIVE_ENABLED=true (on top of SECS_GEM_ENABLED). " +
  "With the loop OFF there is NO alarm/data ingestion. Even with it ON, S5F1 alarms only " +
  "reach the Andon path when EQ_INTEG_ENABLED=true (adapterAlarmBridge). Do not treat " +
  "SECS_GEM_ENABLED alone as data/alarm ingestion.";

let SYSTEM_BYTES = 1;
function nextSystemBytes(): number {
  SYSTEM_BYTES = (SYSTEM_BYTES + 1) >>> 0 || 1;
  return SYSTEM_BYTES;
}

/**
 * Build a 10-byte HSMS message header (SEMI E37).
 * Layout: [SessionID hi/lo][Byte2][Byte3][PType][SType][SystemBytes 4].
 * For control messages Byte2/Byte3 carry control fields; for data messages
 * Byte2 = Stream (W-bit in high bit), Byte3 = Function.
 */
function buildHeader(opts: {
  sessionId: number;
  byte2: number;
  byte3: number;
  sType: number;
  systemBytes: number;
}): Buffer {
  const h = Buffer.alloc(10);
  h.writeUInt16BE(opts.sessionId & 0xffff, 0);
  h[2] = opts.byte2 & 0xff;
  h[3] = opts.byte3 & 0xff;
  h[4] = 0; // PType = SECS-II
  h[5] = opts.sType & 0xff;
  h.writeUInt32BE(opts.systemBytes >>> 0, 6);
  return h;
}

/** Frame a full HSMS message: [4-byte length][10-byte header][body]. */
export function frameHsms(header: Buffer, body: Buffer = Buffer.alloc(0)): Buffer {
  const len = header.length + body.length; // length covers header + body (NOT the 4 length bytes)
  const out = Buffer.alloc(4 + len);
  out.writeUInt32BE(len, 0);
  header.copy(out, 4);
  body.copy(out, 4 + header.length);
  return out;
}

/** Frame an HSMS control message (no body). */
export function frameControl(sessionId: number, sType: number, byte2 = 0, byte3 = 0): Buffer {
  return frameHsms(buildHeader({ sessionId, byte2, byte3, sType, systemBytes: nextSystemBytes() }));
}

/** Frame a SECS-II DATA message over HSMS from a SecsMessage. */
export function frameDataMessage(sessionId: number, msg: SecsMessage): Buffer {
  const body = encodeItem(msg.body);
  const byte2 = (msg.reply ? 0x80 : 0x00) | (msg.stream & 0x7f);
  const header = buildHeader({
    sessionId,
    byte2,
    byte3: msg.function & 0xff,
    sType: SType.DATA,
    systemBytes: nextSystemBytes(),
  });
  return frameHsms(header, body);
}

/**
 * Frame a SECS-II DATA message over HSMS from a `Secs2Message` (new codec).
 * HSMS data-header layout: byte2 = W-bit(0x80) | Stream(0x7f), byte3 = Function.
 */
export function frameSecs2Message(sessionId: number, msg: Secs2Message): Buffer {
  const body = encodeSecs2Body(msg);
  const byte2 = (msg.wbit ? 0x80 : 0x00) | (msg.stream & 0x7f);
  const header = buildHeader({
    sessionId,
    byte2,
    byte3: msg.streamFunction & 0xff,
    sType: SType.DATA,
    systemBytes: nextSystemBytes(),
  });
  return frameHsms(header, body);
}

/** Extract Stream / Function / W-bit from a parsed DATA frame's header bytes. */
export function frameStreamFunction(frame: ParsedHsmsFrame): { stream: number; function: number; wbit: boolean } {
  return { stream: frame.byte2 & 0x7f, function: frame.byte3 & 0xff, wbit: (frame.byte2 & 0x80) !== 0 };
}

/** A decoded inbound HSMS frame. */
export interface ParsedHsmsFrame {
  sessionId: number;
  byte2: number;
  byte3: number;
  sType: number;
  systemBytes: number;
  body: Buffer;
}

/**
 * Parse zero or more complete HSMS frames out of a rolling buffer.
 * Returns the parsed frames and the unconsumed remainder (partial frame).
 */
export function parseHsmsFrames(buf: Buffer): { frames: ParsedHsmsFrame[]; rest: Buffer } {
  const frames: ParsedHsmsFrame[] = [];
  let offset = 0;
  while (buf.length - offset >= 4) {
    const len = buf.readUInt32BE(offset);
    if (len < 10) {
      // Corrupt length — skip the 4 bytes to avoid an infinite loop (fail-safe).
      offset += 4;
      continue;
    }
    if (buf.length - offset - 4 < len) break; // incomplete — wait for more
    const header = buf.subarray(offset + 4, offset + 4 + 10);
    const body = buf.subarray(offset + 4 + 10, offset + 4 + len);
    frames.push({
      sessionId: header.readUInt16BE(0),
      byte2: header[2],
      byte3: header[3],
      sType: header[5],
      systemBytes: header.readUInt32BE(6),
      body: Buffer.from(body),
    });
    offset += 4 + len;
  }
  return { frames, rest: Buffer.from(buf.subarray(offset)) };
}

/** Decode the SECS-II body of a DATA frame into a SecsItem tree (legacy skeleton codec). */
export function decodeFrameBody(frame: ParsedHsmsFrame): SecsItem | null {
  if (frame.sType !== SType.DATA || frame.body.length === 0) return null;
  try {
    return decodeItem(frame.body);
  } catch {
    return null;
  }
}

/**
 * Decode the SECS-II body of a DATA frame into a `Secs2Item` tree using the full
 * SECS-II codec (secs2Codec). Returns null for control frames, empty bodies, or a
 * body that fails to decode (fail-safe — never throws to callers).
 */
export function decodeFrameBodySecs2(frame: ParsedHsmsFrame): Secs2Item | null {
  if (frame.sType !== SType.DATA || frame.body.length === 0) return null;
  try {
    return decodeSecs2Item(frame.body);
  } catch {
    return null;
  }
}

/**
 * Minimal HSMS active-mode client. Lazy: constructing it opens NOTHING.
 * `testConnection()` runs connect → Select → Linktest → Separate and reports.
 */
export class HsmsClient {
  private socket: net.Socket | null = null;
  private _state: HsmsState = "NOT_CONNECTED";
  private rx: Buffer = Buffer.alloc(0);
  /** E30 comm+control state models (pure reducers behind an observable holder). */
  private readonly gemState: GemStateMachine;

  // ── live inbound message-dispatch loop (flag-gated, OFF by default) ──────────
  /** True once enableLiveDispatch() has attached the loop. */
  private liveDispatchActive = false;
  /** Number of in-flight waitFrame() control transactions (see connect()). */
  private pendingWaits = 0;
  /** Independent rolling buffer for the dispatch listener (own copy of the stream). */
  private dispatchRx: Buffer = Buffer.alloc(0);
  /** The dispatch 'data' listener (kept so it can be removed on disable/teardown). */
  private dispatchOnData: ((d: Buffer) => void) | null = null;
  /** The handlers the loop routes inbound S5F1/S6F11 into. */
  private dispatchHandlers: LiveDispatchHandlers | null = null;
  /** The disposer returned by enableLiveDispatch (idempotent re-arm). */
  private liveDispatchDisposer: (() => void) | null = null;

  constructor(private readonly cfg: HsmsConfig) {
    this.gemState = new GemStateMachine(cfg.gemListeners);
  }

  get state(): HsmsState {
    return this._state;
  }

  /** Current E30 Communication State (DISABLED … COMMUNICATING). */
  get commState(): GemCommState {
    return this.gemState.commState;
  }

  /** Current E30 Control State (EQUIPMENT_OFFLINE … ONLINE_REMOTE). */
  get controlState(): GemControlState {
    return this.gemState.controlState;
  }

  /** Open the TCP connection (T5/connect timeout). Fail-safe: rejects, never throws sync. */
  connect(): Promise<void> {
    const timeoutMs = this.cfg.connectTimeoutMs ?? 5000;
    return new Promise<void>((resolve, reject) => {
      const sock = net.connect({ host: this.cfg.host, port: this.cfg.port });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`HSMS connect timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof (timer as NodeJS.Timeout).unref === "function") (timer as NodeJS.Timeout).unref();

      sock.once("connect", () => {
        clearTimeout(timer);
        this.socket = sock;
        this._state = "CONNECTED";
        sock.on("data", (d) => {
          // When a live-dispatch loop owns the stream AND no control transaction
          // is pending, leave this.rx empty: the dispatch listener has its OWN
          // buffer (dispatchRx) that already received this same chunk, so unsolicited
          // S5/S6 traffic cannot grow this.rx unbounded between control transactions.
          // With the loop OFF (default) this guard is inert and behaviour is unchanged.
          if (this.liveDispatchActive && this.pendingWaits === 0) return;
          this.rx = Buffer.concat([this.rx, d]);
        });
        sock.on("error", () => {
          /* surfaced via pending promises / state */
        });
        resolve();
      });
      sock.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** Wait for the first inbound frame matching `predicate`, or reject on timeout. */
  private waitFrame(predicate: (f: ParsedHsmsFrame) => boolean, timeoutMs: number): Promise<ParsedHsmsFrame> {
    return new Promise<ParsedHsmsFrame>((resolve, reject) => {
      const sock = this.socket;
      if (!sock) return reject(new Error("HSMS not connected"));
      // Mark a control transaction in-flight so the base 'data' handler keeps
      // buffering into this.rx even while a live-dispatch loop is attached.
      this.pendingWaits++;
      const deadline = Date.now() + timeoutMs;
      const tryParse = () => {
        const { frames, rest } = parseHsmsFrames(this.rx);
        this.rx = rest;
        for (const f of frames) {
          if (predicate(f)) {
            cleanup();
            return resolve(f);
          }
        }
        if (Date.now() > deadline) {
          cleanup();
          return reject(new Error(`HSMS control timeout after ${timeoutMs}ms`));
        }
      };
      const onData = () => tryParse();
      const poll = setInterval(tryParse, 25);
      if (typeof (poll as NodeJS.Timeout).unref === "function") (poll as NodeJS.Timeout).unref();
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        this.pendingWaits = Math.max(0, this.pendingWaits - 1);
        clearInterval(poll);
        sock.off("data", onData);
      };
      sock.on("data", onData);
      tryParse();
    });
  }

  private send(frame: Buffer): void {
    if (!this.socket) throw new DeviceUnreachableError("hsms");
    this.socket.write(frame);
  }

  /** Send Select.req and await Select.rsp → transition to SELECTED. */
  async select(): Promise<void> {
    if (this._state !== "CONNECTED") throw new Error(`select() requires CONNECTED, got ${this._state}`);
    const sessionId = this.cfg.deviceId ?? 0;
    this.send(frameControl(sessionId, SType.SELECT_REQ));
    await this.waitFrame((f) => f.sType === SType.SELECT_RSP, this.cfg.controlTimeoutMs ?? 5000);
    this._state = "SELECTED";
  }

  /** Send Linktest.req and await Linktest.rsp. Requires SELECTED (or CONNECTED). */
  async linktest(): Promise<void> {
    if (this._state === "NOT_CONNECTED" || this._state === "SEPARATED") {
      throw new Error(`linktest() requires an open connection, got ${this._state}`);
    }
    const sessionId = this.cfg.deviceId ?? 0;
    this.send(frameControl(sessionId, SType.LINKTEST_REQ));
    await this.waitFrame((f) => f.sType === SType.LINKTEST_RSP, this.cfg.controlTimeoutMs ?? 5000);
  }

  /**
   * READ/MONITOR ONLY — send S1F1 (Are You There) and parse the S1F2 (On Line
   * Data) reply, using the full SECS-II codec. This is a liveness + model probe;
   * it opens NO equipment-control/write path (no S2F41 host command, no recipe or
   * parameter write). Requires SELECTED. Flag-gated: throws if SECS/GEM is
   * disabled, so no real S1F1 is ever emitted with the flag OFF.
   *
   * Returns the equipment's { modelName, softRev } on success. On some equipment
   * S1F2 carries an empty list; the strings are then empty but the probe still
   * succeeds (the point is that the peer answered a real SECS-II data message).
   */
  async probeOnline(): Promise<OnlineData> {
    if (!isSecsGemEnabled()) {
      throw new Error("SECS/GEM framework is disabled (set SECS_GEM_ENABLED=true to enable).");
    }
    if (this._state !== "SELECTED") throw new Error(`probeOnline() requires SELECTED, got ${this._state}`);
    const sessionId = this.cfg.deviceId ?? 0;
    // Send a real, codec-encoded S1F1 (empty-list body, W-bit set).
    this.send(frameSecs2Message(sessionId, s1f1()));
    // Await the S1F2 reply (Stream 1, Function 2, DATA sType).
    const reply = await this.waitFrame((f) => {
      if (f.sType !== SType.DATA) return false;
      const sf = frameStreamFunction(f);
      return sf.stream === 1 && sf.function === 2;
    }, this.cfg.controlTimeoutMs ?? 5000);
    const body = decodeFrameBodySecs2(reply);
    const online = body ? parseS1F2(body) : null;
    if (!online) throw new Error("probeOnline: S1F2 body was not a decodable list");
    return online;
  }

  /**
   * READ/MONITOR — establish communications via the S1F13/S1F14 handshake and
   * drive the E30 Communication State model to COMMUNICATING on success.
   *
   * Sequence: mark comms ENABLE → enter WAIT_DELAY (equipment-initiated attempt)
   * → send a real, codec-encoded S1F13 (with the configured MDLN/SOFTREV) → await
   * the S1F14 reply. On COMMACK=accepted the model transitions to COMMUNICATING
   * (onCommEstablished fires); on denial the model falls back to NOT_COMMUNICATING
   * and this rejects. Requires SELECTED. Flag-gated: throws when SECS/GEM is
   * disabled so NO real S1F13 is emitted with the flag OFF.
   */
  async establishCommunications(): Promise<GemCommState> {
    if (!isSecsGemEnabled()) {
      throw new Error("SECS/GEM framework is disabled (set SECS_GEM_ENABLED=true to enable).");
    }
    if (this._state !== "SELECTED") throw new Error(`establishCommunications() requires SELECTED, got ${this._state}`);
    const sessionId = this.cfg.deviceId ?? 0;
    const data: OnlineData = { modelName: this.cfg.modelName ?? "", softRev: this.cfg.softRev ?? "" };

    // Drive the comm FSM: ENABLE (→ NOT_COMMUNICATING) then begin the attempt.
    this.gemState.dispatchComm("ENABLE");
    this.gemState.dispatchComm("ENTER_WAIT_DELAY");

    this.send(frameSecs2Message(sessionId, s1f13(data)));
    let reply: ParsedHsmsFrame;
    try {
      reply = await this.waitFrame((f) => {
        if (f.sType !== SType.DATA) return false;
        const sf = frameStreamFunction(f);
        return sf.stream === 1 && sf.function === 14;
      }, this.cfg.controlTimeoutMs ?? 5000);
    } catch (err) {
      // T-comm-style timeout: fall back so the caller may retry.
      this.gemState.dispatchComm("COMM_TIMEOUT");
      throw err;
    }

    const body = decodeFrameBodySecs2(reply);
    const ack = body ? parseS1F14(body) : null;
    if (ack && ack.accepted) {
      this.gemState.dispatchComm("COMM_ESTABLISHED");
    } else {
      this.gemState.dispatchComm("COMM_FAIL");
      throw new Error(`establishCommunications: S1F14 COMMACK not accepted (${ack ? ack.commack : "undecodable body"})`);
    }
    return this.gemState.commState;
  }

  /**
   * Standard ONLINE-request handshake — the ONLY equipment-control interaction in
   * this framework. Sends S1F17 (Request ON-LINE) and, on an accepted S1F18
   * (ONLACK accepted or already-online), drives the E30 Control State model to
   * ONLINE (default sub-state REMOTE). It sends NO recipe/parameter/host-command;
   * it only asks the equipment to accept online/remote control.
   *
   * Requires SELECTED and COMMUNICATING (comms must be established first). The
   * control FSM transitions EQUIPMENT_OFFLINE → ATTEMPT_ONLINE → ONLINE_REMOTE.
   * Flag-gated: throws when SECS/GEM is disabled so NO real S1F17 is emitted.
   */
  async requestOnline(): Promise<GemControlState> {
    if (!isSecsGemEnabled()) {
      throw new Error("SECS/GEM framework is disabled (set SECS_GEM_ENABLED=true to enable).");
    }
    if (this._state !== "SELECTED") throw new Error(`requestOnline() requires SELECTED, got ${this._state}`);
    if (this.gemState.commState !== "COMMUNICATING") {
      throw new Error(`requestOnline() requires COMMUNICATING comms, got ${this.gemState.commState}`);
    }
    const sessionId = this.cfg.deviceId ?? 0;

    // Drive the control FSM: begin the online attempt, then send S1F17.
    this.gemState.dispatchControl("REQUEST_ONLINE");
    this.send(frameSecs2Message(sessionId, s1f17()));
    let reply: ParsedHsmsFrame;
    try {
      reply = await this.waitFrame((f) => {
        if (f.sType !== SType.DATA) return false;
        const sf = frameStreamFunction(f);
        return sf.stream === 1 && sf.function === 18;
      }, this.cfg.controlTimeoutMs ?? 5000);
    } catch (err) {
      // No S1F18 in time: abandon the attempt (host-offline fallback).
      this.gemState.dispatchControl("ONLINE_DENIED");
      throw err;
    }

    const body = decodeFrameBodySecs2(reply);
    const ack = body ? parseS1F18(body) : null;
    if (ack && ack.online) {
      this.gemState.dispatchControl("ONLINE_ACCEPTED");
    } else {
      this.gemState.dispatchControl("ONLINE_DENIED");
      throw new Error(`requestOnline: S1F18 ONLACK denied (${ack ? ack.onlack : "undecodable body"})`);
    }
    return this.gemState.controlState;
  }

  /** Is the live inbound message-dispatch loop currently attached? */
  get liveDispatch(): boolean {
    return this.liveDispatchActive;
  }

  /**
   * LIVE INBOUND MESSAGE-DISPATCH LOOP (doc 37 P0-6) — attach a passive listener
   * that decodes UNSOLICITED equipment-initiated primaries and acknowledges them:
   *   - S5F1 Alarm Report Send   → parseS5F1 → handlers.onAlarm → reply S5F2 (ACKC5)
   *   - S6F11 Event Report Send  → parseS6F11 → handlers.onEvent → reply S6F12 (ACKC6)
   * Any other inbound frame is ignored (MVP). The loop uses its OWN rolling buffer
   * (dispatchRx) fed by a dedicated 'data' listener, so it never competes with the
   * request/reply waitFrame() path for control replies (S1F2/F14/F18, S2F42, …).
   *
   * Flag-gated: requires BOTH SECS_GEM_ENABLED and SECS_GEM_LIVE_ENABLED — throws
   * otherwise, so NO listener is attached with either flag OFF (the loop is a strict
   * no-op when disabled). Intended to be called AFTER establishCommunications() on a
   * real bring-up. Returns a disposer (idempotent). Handler exceptions are swallowed
   * (fail-safe) and the protocol ack is still sent.
   */
  enableLiveDispatch(handlers: LiveDispatchHandlers): () => void {
    if (!isSecsGemEnabled()) {
      throw new Error("SECS/GEM framework is disabled (set SECS_GEM_ENABLED=true to enable).");
    }
    if (!isSecsGemLiveEnabled()) {
      throw new Error("SECS/GEM live dispatch is disabled (set SECS_GEM_LIVE_ENABLED=true to enable).");
    }
    const sock = this.socket;
    if (!sock) throw new Error("enableLiveDispatch() requires an open connection");
    if (this.liveDispatchActive) return this.liveDispatchDisposer ?? (() => this.disableLiveDispatch());

    this.dispatchHandlers = handlers;
    this.liveDispatchActive = true;
    const onData = (d: Buffer) => {
      this.dispatchRx = Buffer.concat([this.dispatchRx, d]);
      const { frames, rest } = parseHsmsFrames(this.dispatchRx);
      this.dispatchRx = rest;
      for (const f of frames) void this.routeInbound(f);
    };
    this.dispatchOnData = onData;
    sock.on("data", onData);
    const disposer = () => this.disableLiveDispatch();
    this.liveDispatchDisposer = disposer;
    return disposer;
  }

  /** Detach the live dispatch loop (idempotent). Called on separate()/destroy(). */
  disableLiveDispatch(): void {
    if (this.dispatchOnData && this.socket) this.socket.off("data", this.dispatchOnData);
    this.dispatchOnData = null;
    this.dispatchHandlers = null;
    this.dispatchRx = Buffer.alloc(0);
    this.liveDispatchActive = false;
    this.liveDispatchDisposer = null;
  }

  /**
   * Route ONE decoded inbound frame from the live-dispatch loop. Only DATA frames
   * for S5F1 / S6F11 are handled; everything else is ignored. Fail-safe: never
   * throws into the socket 'data' path, and always sends the protocol ack when the
   * inbound primary requested a reply (W-bit).
   */
  private async routeInbound(frame: ParsedHsmsFrame): Promise<void> {
    if (frame.sType !== SType.DATA) return;
    const sf = frameStreamFunction(frame);
    const sessionId = this.cfg.deviceId ?? 0;
    try {
      if (sf.stream === 5 && sf.function === 1) {
        const body = decodeFrameBodySecs2(frame);
        const alarm = body ? parseS5F1(body) : null;
        if (alarm) await this.dispatchHandlers?.onAlarm?.(alarm);
        if (sf.wbit) this.send(frameSecs2Message(sessionId, s5f2(ACKC5.ACCEPTED)));
      } else if (sf.stream === 6 && sf.function === 11) {
        const body = decodeFrameBodySecs2(frame);
        const event = body ? parseS6F11(body) : null;
        if (event) await this.dispatchHandlers?.onEvent?.(event);
        if (sf.wbit) this.send(frameSecs2Message(sessionId, s6f12(ACKC6.ACCEPTED)));
      }
      // Other unsolicited primaries: ignored (MVP) — no ack fabricated.
    } catch {
      /* fail-safe — a handler/decode error must never crash the socket loop */
    }
  }

  /** Send Separate.req and close (no reply expected). Always fail-safe. */
  async separate(): Promise<void> {
    try {
      if (this.socket && (this._state === "SELECTED" || this._state === "CONNECTED")) {
        this.send(frameControl(this.cfg.deviceId ?? 0, SType.SEPARATE_REQ));
      }
    } catch {
      /* ignore — we are tearing down */
    }
    this._state = "SEPARATED";
    // Connection down → comms lost; the FSM falls back so a re-connect re-establishes.
    this.gemState.dispatchComm("DISABLE");
    this.gemState.dispatchControl("GO_OFFLINE");
    this.disableLiveDispatch();
    this.socket?.destroy();
    this.socket = null;
  }

  /** Force-close without a Separate.req. */
  destroy(): void {
    this.disableLiveDispatch();
    this.socket?.destroy();
    this.socket = null;
    this._state = "NOT_CONNECTED";
  }

  /**
   * One-shot honest health probe: connect → Select → Linktest → Separate.
   * NEVER throws — returns a structured result with the GEM-compliance caveat.
   */
  async testConnection(): Promise<HsmsTestResult> {
    const start = Date.now();
    let selected = false;
    let linktestOk = false;
    try {
      await this.connect();
      await this.select();
      selected = true;
      await this.linktest();
      linktestOk = true;
      await this.separate();
      return {
        ok: true,
        state: this._state,
        selected,
        linktestOk,
        latencyMs: Date.now() - start,
        caveat: HONESTY_CAVEAT,
      };
    } catch (err) {
      await this.separate().catch(() => undefined);
      return {
        ok: false,
        state: this._state,
        selected,
        linktestOk,
        latencyMs: Date.now() - start,
        error: (err as Error)?.message ?? String(err),
        caveat: HONESTY_CAVEAT,
      };
    }
  }
}

export { HONESTY_CAVEAT };
