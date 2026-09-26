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

export interface TcpLineSendOptions {
  /**
   * Called immediately before the frame is written (after any transparent reconnect). Throw
   * to refuse the write — robot drivers pass their abort-epoch guard here so a job that was
   * fenced by abort() while waiting (e.g. in the reconnect window) never reaches the wire.
   */
  guard?: () => void;
}

export interface TcpLineClientOptions {
  /**
   * Session handshake run on a NEW connection after a timeout/reset, BEFORE the
   * queued request is written (e.g. MELFA `OPEN=<client>`). Throwing fails the
   * request and marks the client disconnected.
   */
  onReconnect?: (client: TcpLineClient) => Promise<void>;
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

/**
 * FIFO line client: write a fully-framed request string (terminator included) and
 * await the next complete response line. One socket, one in-flight-ordered queue.
 */
export class TcpLineClient {
  private socket: NetSocket | null = null;
  private rxBuf = "";
  private pending: Array<{ resolve: (v: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
  private connected = false;
  /** Endpoint of the last successful open(), used to reconnect after a timeout/reset. */
  private endpoint: { host: string; port: number; timeoutMs: number } | null = null;
  /** true ⇒ the socket was dropped on purpose (timeout/reset); the next send() reconnects. */
  private stale = false;
  private reconnecting: Promise<void> | null = null;
  private handshaking = false;

  constructor(
    private readonly name: string,
    private readonly opts: TcpLineClientOptions = {},
  ) {}

  /**
   * Logically open: true after open() until close() or a failed reconnect. A connection
   * dropped by a timeout or by the peer still counts (it is re-established lazily).
   */
  isConnected(): boolean {
    return this.connected;
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
   * doc 81 Đợt 1B Task 5 fix round 2 — the peer closed / the socket errored. The client stays
   * LOGICALLY open but STALE: every pending request fails (line_connection_closed ⇒ outcome
   * unknown), and the next send() — typically the abort's STOP — reconnects first through the
   * same path as after a timeout (MELFA re-sends OPEN=). Only a failed reconnect makes the
   * client disconnected. (It used to go dead here, so the STOP could never be delivered.)
   */
  private dropByPeer(err: Error): void {
    this.socket = null;
    this.rxBuf = "";
    if (this.connected) this.stale = true;
    this.failAllPending(err);
  }

  private onData(buf: Buffer | string): void {
    this.rxBuf += Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
    const { frames, rest } = splitLineFrames(this.rxBuf);
    this.rxBuf = rest;
    for (const frame of frames) {
      const waiter = this.pending.shift();
      if (!waiter) continue; // unsolicited line with no pending request → ignore
      clearTimeout(waiter.timer);
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
    this.failAllPending(new Error(`${this.name} connection reset: ${reason}`));
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
            this.handshaking = true;
            try {
              await this.opts.onReconnect(this);
            } finally {
              this.handshaking = false;
            }
          }
        } catch (err) {
          // Could not re-establish the session ⇒ honest disconnected state.
          this.connected = false;
          const s = this.socket;
          this.socket = null;
          if (s) {
            try { s.destroy(); } catch { /* ignore */ }
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
  async send(frame: string, timeoutMs: number, sendOpts: TcpLineSendOptions = {}): Promise<string> {
    if (!this.connected) throw new Error(`${this.name}: not connected`);
    if (this.stale || (this.reconnecting && !this.handshaking)) {
      await this.reconnect();
    }
    return new Promise<string>((resolve, reject) => {
      const socket = this.socket;
      if (!socket || !this.connected) {
        reject(new Error(`${this.name}: not connected`));
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
      this.pending.push({ resolve, reject, timer });
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
    const s = this.socket;
    this.socket = null;
    if (s) {
      try { s.destroy(); } catch { /* ignore */ }
    }
  }
}
