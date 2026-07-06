/**
 * JSON-lines-over-stdio transport — SYNAPSE §6.4.3 (doc 33 §11 · P4 completion).
 *
 * The concrete plugin IPC wire the supervisor's docstring names ("JSON-lines-over-stdio now;
 * gRPC/unix-socket later"). Frames a request/response protocol over a child's stdin/stdout: each
 * message is a single line of JSON terminated by "\n"; responses are correlated to requests by a
 * monotonic id. Pure over injected streams → testable with in-memory PassThrough pairs (no process).
 *
 * Protocol: request  { id, method, params? }  →  response { id, result? , error? }.
 */
import type { Readable, Writable } from "node:stream";

export interface JsonLineRequest {
  id: number;
  method: string;
  params?: unknown;
}
export interface JsonLineResponse {
  id: number;
  result?: unknown;
  error?: string;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class StdioTransport {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private buf = "";
  private closed = false;

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
    private readonly opts: { timeoutMs?: number } = {},
  ) {
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => this.onData(String(chunk)));
    stdout.on("close", () => this.failAll("sidecar stdout closed"));
    stdout.on("error", () => this.failAll("sidecar stdout error"));
  }

  /** Parse newline-delimited JSON responses, dispatching each to its pending request. */
  private onData(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg: JsonLineResponse;
      try {
        msg = JSON.parse(line) as JsonLineResponse;
      } catch {
        continue; // ignore a malformed line rather than tearing down the channel
      }
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    }
  }

  /** Send a request, resolving with its result (rejects on sidecar error, timeout, or close). */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error("transport closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params } satisfies JsonLineRequest) + "\n";
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = this.opts.timeoutMs ?? 5000;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`sidecar request timeout: ${method}`));
      }, timeoutMs);
      if (typeof (timer as NodeJS.Timeout).unref === "function") (timer as NodeJS.Timeout).unref();
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.stdin.write(payload);
    });
  }

  private failAll(reason: string): void {
    for (const [, p] of this.pending) p.reject(new Error(reason));
    this.pending.clear();
  }

  /** Number of in-flight requests (for tests/metrics). */
  inFlight(): number {
    return this.pending.size;
  }

  /** Reject all in-flight requests and stop accepting new ones. */
  close(): void {
    this.closed = true;
    this.failAll("transport closed");
  }
}
