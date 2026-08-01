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
 *     bounded by a timeout that removes the waiter from the FIFO queue.
 *
 * This module opens NO connection at import time (pure) and adds no dependency —
 * it uses only node:net, exactly like the FANUC and Techman drivers.
 */
import { createConnection } from "node:net";

type NetSocket = ReturnType<typeof createConnection>;

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

  constructor(private readonly name: string) {}

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
        reject(new Error(`${this.name} connect timeout after ${timeoutMs}ms`));
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
        this.failAllPending(new Error(`${this.name} socket closed`));
      });
    });
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

  /** Write one fully-framed line (terminator already included) and await the next reply line. */
  send(frame: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error(`${this.name}: not connected`));
        return;
      }
      const timer = setTimeout(() => {
        const idx = this.pending.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.pending.splice(idx, 1);
        reject(new Error(`${this.name} request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this.pending.push({ resolve, reject, timer });
      try {
        this.socket.write(frame);
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
    if (this.socket) {
      try { this.socket.destroy(); } catch { /* ignore */ }
      this.socket = null;
    }
  }
}
