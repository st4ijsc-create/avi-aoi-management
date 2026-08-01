/**
 * Doc 20 §3/§5 (I3a-2) — rosbridge v2 protocol client over WebSocket (pure JS).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A minimal client for the ROS 2 `rosbridge_server` WebSocket protocol (v2.0) — the
 * standard bridge that exposes ROS2 topics/services as JSON over WS with NO native ROS2
 * dependency (no rclnodejs, no DDS). We reuse the project's existing `ws` dep. This is a
 * pure TRANSPORT: subscribe (topic→telemetry) and publish/call_service (platform→ROS2).
 *
 * Protocol ops we speak (rosbridge JSON):
 *   { op:"advertise",  topic, type }
 *   { op:"unadvertise",topic }
 *   { op:"subscribe",  topic, type? }
 *   { op:"unsubscribe",topic }
 *   { op:"publish",    topic, msg }
 *   { op:"call_service", service, args, id }
 * Inbound we handle { op:"publish", topic, msg } (subscription data) and
 * { op:"service_response", id, values, result }.
 *
 * HONEST / NO-FAKE: connect() opens a real WS to ROSBRIDGE_URL. `rosbridge_server` +
 * ROS2 must be running (doc 20 §7 runbook). Unreachable → connect() REJECTS with a clear
 * error; the manager surfaces it and connects NOTHING. No message is ever fabricated.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type WebSocket from "ws";

export type Ros2Message = Record<string, unknown>;
export type Ros2MessageHandler = (topic: string, msg: Ros2Message) => void;

export interface RosbridgeOptions {
  url: string;
  /** Connect timeout (ms). Default 8000. */
  timeoutMs?: number;
  /**
   * WebSocket implementation injector (tests pass a mock `ws`). Default: lazy `ws`.
   * Must be a constructor compatible with the `ws` WebSocket (url) => instance.
   */
  wsFactory?: (url: string) => WebSocket;
}

interface PendingService {
  resolve: (values: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RosbridgeClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private lastError?: string;
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly wsFactory?: (url: string) => WebSocket;
  private readonly handlers = new Map<string, Set<Ros2MessageHandler>>();
  private readonly advertised = new Set<string>();
  private readonly pendingServices = new Map<string, PendingService>();
  private serviceSeq = 0;

  constructor(opts: RosbridgeOptions) {
    this.url = opts.url;
    this.timeoutMs = Math.max(500, opts.timeoutMs ?? 8000);
    this.wsFactory = opts.wsFactory;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLastError(): string | undefined {
    return this.lastError;
  }

  /** Open the WS. Rejects (honest) when rosbridge is unreachable. */
  async connect(): Promise<void> {
    if (this.connected) return;
    let factory = this.wsFactory;
    if (!factory) {
      // Lazy dynamic import so `ws` is only loaded when the bridge is actually used
      // (ESM project — no CommonJS `require` available).
      const mod = (await import("ws")) as unknown as { default: { new (u: string): WebSocket } };
      const WS = mod.default;
      factory = (url: string) => new WS(url);
    }
    const wsFactory = factory;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = wsFactory(this.url);
      } catch (err) {
        reject(new Error(`rosbridge ${this.url} connect failed: ${(err as Error)?.message ?? err}`));
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.lastError = "connect timeout";
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`rosbridge ${this.url} unreachable: connect timeout`));
      }, this.timeoutMs);
      if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();

      ws.on("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connected = true;
        resolve();
      });
      ws.on("message", (data: unknown) => this.onMessage(data));
      ws.on("error", (err: Error) => {
        this.lastError = err?.message ?? String(err);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`rosbridge ${this.url} unreachable: ${this.lastError}`));
      });
      ws.on("close", () => {
        this.connected = false;
      });
    });
  }

  private onMessage(data: unknown): void {
    let text: string;
    if (typeof data === "string") text = data;
    else if (data instanceof Buffer) text = data.toString("utf8");
    else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString("utf8");
    else text = String(data);

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return; // fail-safe: ignore non-JSON frames
    }
    const op = obj.op;
    if (op === "publish" && typeof obj.topic === "string") {
      const set = this.handlers.get(obj.topic);
      if (set) {
        const msg = (obj.msg ?? {}) as Ros2Message;
        for (const h of set) {
          try { h(obj.topic, msg); } catch (err) { console.error("[ROS2] handler error:", (err as Error)?.message ?? err); }
        }
      }
    } else if (op === "service_response" && typeof obj.id === "string") {
      const pending = this.pendingServices.get(obj.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingServices.delete(obj.id);
        if (obj.result === false) pending.reject(new Error(String(obj.values ?? "service call failed")));
        else pending.resolve(obj.values);
      }
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.ws || !this.connected) throw new Error("rosbridge not connected");
    this.ws.send(JSON.stringify(payload));
  }

  /** Subscribe to a ROS2 topic; the handler is invoked per inbound message. */
  subscribe(topic: string, type: string | undefined, handler: Ros2MessageHandler): void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
      const req: Record<string, unknown> = { op: "subscribe", topic };
      if (type) req.type = type;
      this.send(req);
    }
    set.add(handler);
  }

  unsubscribe(topic: string, handler?: Ros2MessageHandler): void {
    const set = this.handlers.get(topic);
    if (!set) return;
    if (handler) set.delete(handler);
    else set.clear();
    if (set.size === 0) {
      this.handlers.delete(topic);
      try { this.send({ op: "unsubscribe", topic }); } catch { /* ignore when closed */ }
    }
  }

  /** Advertise a topic before publishing (idempotent). */
  advertise(topic: string, type: string): void {
    if (this.advertised.has(topic)) return;
    this.send({ op: "advertise", topic, type });
    this.advertised.add(topic);
  }

  /** Publish a message to a ROS2 topic (advertises first if needed). */
  publish(topic: string, type: string, msg: Ros2Message): void {
    this.advertise(topic, type);
    this.send({ op: "publish", topic, msg });
  }

  /** Call a ROS2 service and await its response (used for action-like commands). */
  callService(service: string, args: Record<string, unknown>, timeoutMs = 10_000): Promise<unknown> {
    const id = `svc_${++this.serviceSeq}_${Date.now()}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingServices.delete(id);
        reject(new Error(`service "${service}" call timeout`));
      }, timeoutMs);
      if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
      this.pendingServices.set(id, { resolve, reject, timer });
      try {
        this.send({ op: "call_service", service, args, id });
      } catch (err) {
        clearTimeout(timer);
        this.pendingServices.delete(id);
        reject(err as Error);
      }
    });
  }

  async close(): Promise<void> {
    for (const p of this.pendingServices.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("rosbridge closing"));
    }
    this.pendingServices.clear();
    this.handlers.clear();
    this.advertised.clear();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
  }
}
