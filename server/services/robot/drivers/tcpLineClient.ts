/**
 * doc 24 Tier-2 (Connectivity) — shared line-oriented TCP transport.
 *
 * A minimal request/response TCP client for text (ASCII) protocols that terminate
 * each message with CR, LF, or CRLF. It is the transport shared by the Mitsubishi
 * (MELFA) and Delta robot drivers, mirroring the framing/timeout/fail-safe shape of
 * the FANUC RMI client (FanucRmiClient) — the difference is only that frames are
 * opaque text lines here (each driver parses its own protocol) instead of JSON.
 *
 *   • Transport: ONE TCP socket. Requests are issued strictly sequentially (one
 *     `await send()` at a time), so responses are matched to requests FIFO.
 *   • Framing: an incoming byte stream is split into complete lines on CR / LF /
 *     CRLF; the partial tail is buffered until the terminator arrives. Blank lines
 *     are dropped. Each complete line is delivered to the oldest pending request.
 *   • Fail-safe: a socket error/close rejects every pending request (the caller
 *     turns that into a failed job / thrown read — never a hang). Every request is
 *     bounded by a timeout.
 *
 * doc 81 Đợt 1B Task 5 (BE2 §L3b T4 / §3 S7) — WHY A TIMEOUT NOW DROPS THE SOCKET.
 * The FIFO match above has no request id: the line protocols carried here do not
 * give one we can trust (MELFA R3 `<robot>;<slot>;<cmd>` replies `Qok…`/`Qe…` with
 * no echo of the request; the Delta frame's seq belongs to a fabricated mock format).
 * Before this fix a timeout only removed the waiter, so the LATE reply of the
 * timed-out request was handed to the NEXT request (`B:MOVE` received `A:STOP`'s ack)
 * and every reply stayed one step behind forever. Chosen approach (no correlation id
 * ⇒ "drop and reconnect"): on a request timeout the socket is DESTROYED, every other
 * waiter on it is failed and its receive buffer is discarded; every socket handler is
 * bound to its own socket, so bytes that still arrive on the old connection are
 * ignored. The next `send()` transparently opens a NEW connection (running the
 * optional `onReconnect` session handshake, e.g. MELFA `OPEN=`) before writing.
 * `resetConnection()` does the same on demand — a driver's abort uses it so a STOP
 * never queues behind (and steals the reply of) an in-flight motion request.
 *
 * Fix round 4 (ruling R13) — TWO KINDS OF LINK LOSS, TWO RECONNECT RULES:
 *   • after a request TIMEOUT / `resetConnection()` (we dropped the socket ourselves) any
 *     send reconnects transparently — round-1 behaviour, unchanged;
 *   • after a PEER drop (close/error, idle or under a request) or a FAILED reconnect, only a
 *     PRIVILEGED send (`allowAfterPeerDrop`: the driver's STOP and its read-only polls) may
 *     reconnect; ordinary sends are refused before any byte until a privileged send has
 *     COMPLETED on the new connection. A failed reconnect is not terminal any more: the next
 *     privileged send (typically the next telemetry poll) tries again, so a robot that was
 *     unreachable for a while comes back without a server restart.
 *   Whether MOTION is allowed again once the transport is back is NOT decided here: that is
 *   the driver's motion lock (see robotDriver.ts MotionLock), fed by `onLinkLoss`.
 *
 * This module opens NO connection at import time (pure) and adds no dependency —
 * it uses only node:net, exactly like the FANUC and Techman drivers.
 */
import { createConnection } from "node:net";

type NetSocket = ReturnType<typeof createConnection>;

/** Stable reason code for a request that got no reply line in time. */
export const LINE_REPLY_TIMEOUT = "line_reply_timeout" as const;

/** Rejection of `send()` when no reply line arrives within `timeoutMs`. */
export class TcpLineTimeoutError extends Error {
  readonly reasonCode = LINE_REPLY_TIMEOUT;
  constructor(message: string) {
    super(message);
    this.name = "TcpLineTimeoutError";
  }
}

/** Stable reason code: the peer closed / the socket errored while a request was pending. */
export const LINE_CONNECTION_CLOSED = "line_connection_closed" as const;

/**
 * Rejection of pending `send()`s when the socket closes or errors under them (doc 81 Đợt 1B
 * Task 5 fix round 1): the command may already be executing — outcome unknown.
 */
export class TcpLineClosedError extends Error {
  readonly reasonCode = LINE_CONNECTION_CLOSED;
  constructor(message: string) {
    super(message);
    this.name = "TcpLineClosedError";
  }
}

/** Stable reason code: the connection was reset (another request timed out / an abort preempted). */
export const LINE_CONNECTION_RESET = "line_connection_reset" as const;

/**
 * doc 81 Đợt 1B Task 5 fix round 3 — rejection of requests still in flight when the connection
 * is reset (e.g. a concurrent poll timed out while EXEC was pending): the command's bytes may
 * already have reached the robot ⇒ outcome unknown ⇒ the dispatcher sends a stop.
 */
export class TcpLineResetError extends Error {
  readonly reasonCode = LINE_CONNECTION_RESET;
  constructor(message: string) {
    super(message);
    this.name = "TcpLineResetError";
  }
}

/** Stable reason code: the send was refused before any byte (client down / peer dropped). */
export const LINE_NOT_CONNECTED = "line_not_connected" as const;

export class TcpLineNotConnectedError extends Error {
  readonly reasonCode = LINE_NOT_CONNECTED;
  constructor(message: string) {
    super(message);
    this.name = "TcpLineNotConnectedError";
  }
}

export interface TcpLineSendOptions {
  /**
   * Called immediately before the frame is written (after any transparent reconnect). Throw
   * to refuse the write — robot drivers pass their abort-epoch guard here so a job that was
   * fenced by abort() while waiting (e.g. in the reconnect window) never reaches the wire.
   */
  guard?: () => void;
  /**
   * doc 81 Đợt 1B Task 5 fix round 3 / fix round 4 — a PRIVILEGED send.
   *
   * After a PEER drop (or a failed reconnect) an ordinary send is refused before any byte
   * (TcpLineNotConnectedError, reasonCode line_not_connected). A send carrying this flag — the
   * driver passes it for its STOP frame AND for its read-only polls (ruling R13: a poll may
   * bring the transport back up) — re-establishes the connection through the same path as after
   * a timeout (running `onReconnect`, e.g. MELFA `OPEN=`) and then writes. Ordinary sends stay
   * refused until such a send has COMPLETED (handshake finished AND its own reply received) on
   * the new connection, so nothing can slip onto the fresh socket ahead of, or between, the
   * handshake and the STOP (fix round 4, N2). The handshake itself writes through a scoped
   * sender, not through this bypass.
   *
   * What this flag does NOT do (honest scope):
   *   • It is a TRANSPORT rule only. Whether MOTION may run again once the link is back is the
   *     driver's motion lock (MotionLock in robotDriver.ts): a motion job is refused there until
   *     a STOP is confirmed or an authorised operator clears the lock.
   *   • A user STOP issued through dispatchRobotJob({jobType:"abort"}) still does not bump the
   *     driver's abort fence, so a motion job that had already passed its checks before that
   *     STOP is not fenced by this layer. That item remains DEFERRED (task-5-report.md).
   */
  allowAfterPeerDrop?: boolean;
}

/**
 * What `onReconnect` receives: a sender scoped to the session handshake. It may write on the
 * fresh socket while the peer-drop refusal is still in force — ONLY for the frames the handshake
 * itself issues; no other caller gets that bypass (fix round 4, N2).
 */
export interface TcpLineHandshakeSender {
  send(frame: string, timeoutMs: number): Promise<string>;
}

export interface TcpLineClientOptions {
  /**
   * Session handshake run on a NEW connection after a timeout/reset/peer drop, BEFORE the
   * queued request is written (e.g. MELFA `OPEN=<client>`). Throwing fails the request; the
   * client then reports NOT connected until a later privileged send reconnects successfully.
   */
  onReconnect?: (client: TcpLineHandshakeSender) => Promise<void>;
  /**
   * Fix round 4 (R13) — called synchronously when the PEER closed/errored the socket (idle or
   * under a request) or when a reconnect attempt failed. Drivers set their motion lock here.
   * Never called for close() or for a reset we performed ourselves (timeout / abort preempt) —
   * those are reported to the caller of the affected send through its rejection reason code.
   */
  onLinkLoss?: (reasonCode: typeof LINE_CONNECTION_CLOSED, detail: string) => void;
}

/**
 * Split a receive buffer into complete text frames (each terminated by CR, LF, or
 * CRLF), returning the trailing partial line as `rest`. Blank frames are dropped.
 * Exported for unit testing the framing in isolation.
 */
export function splitLineFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split(/\r\n|\r|\n/);
  const rest = parts.pop() ?? ""; // last element is the (possibly empty) incomplete tail
  const frames: string[] = [];
  for (const line of parts) {
    const t = line.trim();
    if (t) frames.push(t);
  }
  return { frames, rest };
}

interface Waiter {
  resolve: (v: string) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  /** A privileged send (STOP / poll): its completion ends the peer-drop state. */
  privileged: boolean;
}

/**
 * FIFO line client: write a fully-framed request string (terminator included) and
 * await the next complete response line. One socket, one in-flight-ordered queue.
 */
export class TcpLineClient {
  private socket: NetSocket | null = null;
  private rxBuf = "";
  private pending: Waiter[] = [];
  /** open() succeeded and close() has not been called (the logical session). */
  private connected = false;
  /** Endpoint of the last successful open(), used to reconnect after a timeout/reset/drop. */
  private endpoint: { host: string; port: number; timeoutMs: number } | null = null;
  /** true ⇒ no live socket (timeout / reset / peer drop / failed reconnect); an eligible send() reconnects. */
  private stale = false;
  private reconnecting: Promise<void> | null = null;
  /**
   * Fix round 3/4 — the PEER dropped the link, or a reconnect failed: only privileged sends may
   * reconnect; cleared when a privileged send completes on the new connection.
   */
  private peerDropped = false;

  constructor(
    private readonly name: string,
    private readonly opts: TcpLineClientOptions = {},
  ) {}

  /**
   * True after open() until close(), except while the link is LOST (peer drop / failed reconnect)
   * and no privileged send has completed on a new connection yet. A connection we dropped
   * ourselves on a request timeout still counts (re-established lazily by any send).
   */
  isConnected(): boolean {
    return this.connected && !this.peerDropped;
  }

  async open(host: string, port: number, timeoutMs: number): Promise<void> {
    this.endpoint = { host, port, timeoutMs };
    await this.connectSocket();
    this.stale = false;
  }

  private connectSocket(): Promise<void> {
    const ep = this.endpoint;
    if (!ep) return Promise.reject(new Error(`${this.name}: not opened`));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = createConnection({ host: ep.host, port: ep.port });
      this.socket = socket;
      this.rxBuf = "";
      // Every handler is bound to THIS socket: once it is replaced/dropped, its late
      // bytes/events must not touch the current request queue (T4).
      const isCurrent = () => this.socket === socket;

      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch { /* ignore */ }
        reject(new Error(`${this.name} connect timeout after ${ep.timeoutMs}ms`));
      }, ep.timeoutMs);
      if (typeof connectTimer.unref === "function") connectTimer.unref();

      socket.on("connect", () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        this.connected = true;
        resolve();
      });
      socket.on("data", (buf: Buffer) => {
        if (!isCurrent()) return; // reply from a dropped connection ⇒ discard
        this.onData(buf);
      });
      socket.on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          reject(err);
        }
        if (!isCurrent()) return;
        this.dropByPeer(new TcpLineClosedError(`${this.name} socket error: ${err?.message ?? String(err)}`));
      });
      socket.on("close", () => {
        if (!isCurrent()) return;
        this.dropByPeer(new TcpLineClosedError(`${this.name} socket closed`));
      });
    });
  }

  /**
   * doc 81 Đợt 1B Task 5 fix round 2/3/4 — the peer closed / the socket errored. The client stays
   * LOGICALLY open: every pending request fails (line_connection_closed ⇒ outcome unknown), the
   * driver is told (`onLinkLoss` ⇒ motion lock), and the client reports NOT connected until a
   * privileged send (STOP / read-only poll) has re-established the session.
   */
  private dropByPeer(err: TcpLineClosedError): void {
    this.socket = null;
    this.rxBuf = "";
    if (this.connected) {
      this.stale = true;
      this.peerDropped = true;
      this.notifyLinkLoss(err.message);
    }
    this.failAllPending(err);
  }

  private notifyLinkLoss(detail: string): void {
    try {
      this.opts.onLinkLoss?.(LINE_CONNECTION_CLOSED, detail);
    } catch {
      /* a driver hook must never break the transport */
    }
  }

  private onData(buf: Buffer | string): void {
    this.rxBuf += Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
    const { frames, rest } = splitLineFrames(this.rxBuf);
    this.rxBuf = rest;
    for (const frame of frames) {
      const waiter = this.pending.shift();
      if (!waiter) continue; // unsolicited line with no pending request → ignore
      clearTimeout(waiter.timer);
      // Fix round 4 — a PRIVILEGED send completed on the current (new) connection: the link is back.
      if (waiter.privileged && this.peerDropped) this.peerDropped = false;
      waiter.resolve(frame);
    }
  }

  private failAllPending(err: Error): void {
    while (this.pending.length > 0) {
      const w = this.pending.shift()!;
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  /** Number of requests written and still awaiting their reply line. */
  inFlight(): number {
    return this.pending.length;
  }

  /**
   * Drop the current socket WITHOUT closing the client: fail every in-flight request,
   * discard buffered bytes, ignore anything the old socket still delivers, and make the
   * next send() open a fresh connection. Used after a request timeout (T4) and by a
   * driver's abort so a STOP is never matched against an older in-flight request.
   */
  resetConnection(reason: string): void {
    const old = this.socket;
    this.socket = null;
    this.rxBuf = "";
    if (this.connected) this.stale = true;
    this.failAllPending(new TcpLineResetError(`${this.name} connection reset: ${reason}`));
    if (old) {
      try { old.destroy(); } catch { /* ignore */ }
    }
  }

  private reconnect(): Promise<void> {
    if (!this.reconnecting) {
      this.reconnecting = (async () => {
        try {
          await this.connectSocket();
          this.stale = false;
          if (this.opts.onReconnect) {
            // The handshake writes through a SCOPED sender: only its own frames bypass the
            // peer-drop refusal; `peerDropped` stays set until a privileged send completes.
            await this.opts.onReconnect({ send: (frame, timeoutMs) => this.write(frame, timeoutMs, {}, true) });
          }
        } catch (err) {
          // Could not re-establish the session. Fix round 4: NOT terminal — the link is reported
          // lost (isConnected() false, ordinary sends refused) and the next PRIVILEGED send
          // (typically the next telemetry poll, or a STOP) tries again.
          this.stale = true;
          const s = this.socket;
          this.socket = null;
          if (s) {
            try { s.destroy(); } catch { /* ignore */ }
          }
          if (this.connected) {
            this.peerDropped = true;
            this.notifyLinkLoss(`${this.name} reconnect failed: ${(err as Error)?.message ?? String(err)}`);
          }
          throw err;
        }
      })().finally(() => {
        this.reconnecting = null;
      });
    }
    return this.reconnecting;
  }

  /** Write one fully-framed line (terminator already included) and await the next reply line. */
  send(frame: string, timeoutMs: number, sendOpts: TcpLineSendOptions = {}): Promise<string> {
    return this.write(frame, timeoutMs, sendOpts, false);
  }

  private async write(frame: string, timeoutMs: number, sendOpts: TcpLineSendOptions, handshake: boolean): Promise<string> {
    if (!this.connected) throw new TcpLineNotConnectedError(`${this.name}: not connected`);
    const privileged = sendOpts.allowAfterPeerDrop === true;
    if (this.peerDropped && !privileged && !handshake) {
      throw new TcpLineNotConnectedError(
        `${this.name}: link lost (peer dropped the connection) — only a stop or a read-only poll may reconnect`,
      );
    }
    // A handshake frame never waits for (or starts) a reconnect: it IS the reconnect. Every other
    // send waits for the in-progress reconnect, so it is written strictly after the handshake.
    if (!handshake && (this.stale || this.reconnecting)) {
      await this.reconnect();
    }
    return new Promise<string>((resolve, reject) => {
      const socket = this.socket;
      if (!socket || !this.connected) {
        reject(new TcpLineNotConnectedError(`${this.name}: not connected`));
        return;
      }
      try {
        sendOpts.guard?.();
      } catch (err) {
        reject(err as Error); // refused BEFORE any byte is written
        return;
      }
      const timer = setTimeout(() => {
        const idx = this.pending.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.pending.splice(idx, 1);
        reject(new TcpLineTimeoutError(`${this.name} request timeout after ${timeoutMs}ms`));
        // T4: the late reply would otherwise be handed to the next request — drop this
        // connection (and anything still queued on it); the next send() reconnects.
        if (this.socket === socket) this.resetConnection(`request timeout after ${timeoutMs}ms`);
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this.pending.push({ resolve, reject, timer, privileged });
      try {
        socket.write(frame);
      } catch (err) {
        const idx = this.pending.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.pending.splice(idx, 1);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  close(): void {
    this.failAllPending(new Error(`${this.name} closing`));
    this.connected = false;
    this.stale = false;
    this.peerDropped = false;
    const s = this.socket;
    this.socket = null;
    if (s) {
      try { s.destroy(); } catch { /* ignore */ }
    }
  }
}
