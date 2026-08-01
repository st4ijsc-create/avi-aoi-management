/**
 * IPC-CFX (IPC-2591) telemetry client — flag-gated, fail-safe AMQP 1.0 subscriber.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * INBOUND-ONLY (monitoring). This client SUBSCRIBES to CFX endpoints on an AMQP
 * 1.0 broker (via `rhea`), receives CFX JSON-envelope messages published by SMT
 * machines (mounters / reflow ovens / stencil printers), maps the
 * telemetry-relevant ones (UnitsProcessed / StationStateChanged / FaultOccurred /
 * ToolChanged) into `CanonicalSample[]`, and feeds them to the ONE unified
 * telemetry bus (`ingestTelemetry`, protocol 'other', meta.cfx = message name).
 * It sends NO commands — it is pure observation, NOT control.
 *
 * LIFECYCLE (mirrors the MTConnect poller / OT manager):
 *   • No-op unless CFX_ENABLED === "true" (default OFF).
 *   • Endpoints come from env CFX_ENDPOINTS (JSON array or CSV of
 *     {host,port,address,machineCode?,username?,password?,transport?}).
 *   • start() / stop() are idempotent. MOUNTED into server boot (G1.2, doc 44 W0-D):
 *     server/_core/index.ts calls startCfxClient() behind try/catch after the
 *     MTConnect bring-up, and stopCfxClient() on shutdown. Flag-OFF ⇒ no-op.
 *
 * RECONNECT / LINK-LOSS HONESTY: `rhea` owns automatic reconnection with backoff
 * (reconnect:true, initial/max delay configurable). We DON'T fake a connection —
 * per-endpoint stats expose the real connected/receiverOpen flags, the last error,
 * and message/sample counts, all driven by the transport's own events. When the
 * broker is down nothing is received → nothing is ingested (no fabricated data).
 *
 * TESTABILITY: the AMQP container is injectable (DI). The default lazily imports
 * `rhea` only when the flag engages, so the flag-OFF path never loads AMQP. Tests
 * inject a fake container (an EventEmitter) and drive `message` events directly —
 * no broker required.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { ingestTelemetry, type CanonicalSample } from "../telemetryBus";
import {
  parseCfxEnvelope,
  mapCfxToSamples,
  type CfxParseHints,
} from "./cfxMessages";

/** One CFX subscription target (one AMQP connection + one receiver link). */
export interface CfxEndpoint {
  host: string;
  port: number;
  /** The AMQP source address (queue/topic) to receive CFX messages from. */
  address: string;
  /** Optional device code override applied to every sample from this endpoint. */
  machineCode?: string;
  username?: string;
  password?: string;
  transport?: "tcp" | "tls";
}

/** Read-only per-endpoint status (honest — driven by real transport events). */
export interface CfxEndpointStats {
  host: string;
  port: number;
  address: string;
  machineCode: string | null;
  /** True after the AMQP `connection_open` (and false after disconnect/close). */
  connected: boolean;
  /** True after the receiver link opened. */
  receiverOpen: boolean;
  messagesReceived: number;
  /** Messages received but not a mapped/parseable CFX telemetry message. */
  messagesIgnored: number;
  samplesEmitted: number;
  lastMessageAt: string | null;
  lastError: string | null;
}

/** Minimal AMQP surface we depend on — satisfied by rhea's container/connection. */
export interface AmqpConnectionLike {
  open_receiver(options: unknown): unknown;
  close(): void;
  on(event: string, handler: (context: AmqpEventContextLike) => void): void;
}
export interface AmqpContainerLike {
  connect(options: unknown): AmqpConnectionLike;
}
/** The subset of rhea's EventContext we read. */
export interface AmqpEventContextLike {
  message?: {
    body?: unknown;
    subject?: string | null;
    application_properties?: Record<string, unknown> | null;
  } | null;
  reconnecting?: boolean;
  error?: unknown;
  [k: string]: unknown;
}

export interface CfxClientDeps {
  /** Injected AMQP container (tests / custom transports). Default: lazy `rhea`. */
  container?: AmqpContainerLike;
  /**
   * Sink for mapped samples. Default: the unified telemetry bus (`ingestTelemetry`).
   * Injected in tests to capture samples without a DB.
   */
  ingest?: (samples: CanonicalSample[]) => Promise<number> | void;
  /** Override endpoints (tests). Default: parsed from CFX_ENDPOINTS. */
  endpoints?: CfxEndpoint[];
}

const DEFAULT_PORT = 5672;

export function isCfxEnabled(): boolean {
  return process.env.CFX_ENABLED === "true";
}

function log(msg: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err != null ? String(err) : "";
  console.warn(`[CFX] ${msg}${detail ? `: ${detail}` : ""}`);
}

/**
 * Parse CFX_ENDPOINTS. Accepts a JSON array of objects, or a CSV where each item
 * (separated by ';' or newline) is `host|port|address|machineCode`. Pure + fail-safe.
 */
export function parseEndpoints(raw: string | undefined): CfxEndpoint[] {
  if (!raw || !raw.trim()) return [];
  const text = raw.trim();
  const out: CfxEndpoint[] = [];

  const push = (
    host: unknown,
    port: unknown,
    address: unknown,
    machineCode?: unknown,
    username?: unknown,
    password?: unknown,
    transport?: unknown,
  ) => {
    if (typeof host !== "string" || !host.trim()) return;
    if (typeof address !== "string" || !address.trim()) return;
    const p = Number(port);
    const ep: CfxEndpoint = {
      host: host.trim(),
      port: Number.isFinite(p) && p > 0 ? p : DEFAULT_PORT,
      address: address.trim(),
    };
    if (typeof machineCode === "string" && machineCode.trim()) ep.machineCode = machineCode.trim();
    if (typeof username === "string" && username.trim()) ep.username = username.trim();
    if (typeof password === "string" && password) ep.password = password;
    if (transport === "tls" || transport === "tcp") ep.transport = transport;
    out.push(ep);
  };

  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of arr) {
        if (it && typeof it === "object") {
          const o = it as Record<string, unknown>;
          push(o.host, o.port, o.address, o.machineCode, o.username, o.password, o.transport);
        }
      }
      return out;
    } catch (err) {
      log("parseEndpoints JSON failed, treating as CSV", err);
    }
  }

  for (const item of text.split(/[;\n]+/)) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const [host, port, address, machineCode] = trimmed.split("|").map((s) => s.trim());
    push(host, port, address, machineCode);
  }
  return out;
}

/**
 * The CFX telemetry client. Construct with optional DI, then start()/stop().
 * Instances are cheap; the module-level singleton (start/stopCfxClient) wraps one.
 */
export class CfxClient {
  private readonly deps: CfxClientDeps;
  private running = false;
  private connections: AmqpConnectionLike[] = [];
  private readonly stats = new Map<string, CfxEndpointStats>();

  constructor(deps: CfxClientDeps = {}) {
    this.deps = deps;
  }

  private key(ep: CfxEndpoint): string {
    return `${ep.host}:${ep.port}/${ep.address}`;
  }

  private ingest(samples: CanonicalSample[]): void {
    if (samples.length === 0) return;
    const sink = this.deps.ingest ?? ((s: CanonicalSample[]) => ingestTelemetry(s));
    try {
      const r = sink(samples);
      if (r && typeof (r as Promise<number>).catch === "function") {
        (r as Promise<number>).catch((err) => log("ingest failed", err));
      }
    } catch (err) {
      log("ingest threw", err);
    }
  }

  /** Handle one received AMQP message for a given endpoint. Never throws. */
  private handleMessage(ep: CfxEndpoint, ctx: AmqpEventContextLike): void {
    const st = this.stats.get(this.key(ep));
    if (st) {
      st.messagesReceived += 1;
      st.lastMessageAt = new Date().toISOString();
    }
    try {
      const msg = ctx.message ?? null;
      const hints: CfxParseHints = {
        subject: msg?.subject ?? null,
        applicationProperties: msg?.application_properties ?? null,
      };
      const env = parseCfxEnvelope(msg?.body, hints);
      if (!env) {
        if (st) st.messagesIgnored += 1;
        return;
      }
      const samples = mapCfxToSamples(env, { machineCode: ep.machineCode ?? env.source });
      if (samples.length === 0) {
        if (st) st.messagesIgnored += 1;
        return;
      }
      if (st) st.samplesEmitted += samples.length;
      this.ingest(samples);
    } catch (err) {
      if (st) st.lastError = err instanceof Error ? err.message : String(err);
      log("message handling failed", err);
    }
  }

  /** Lazily resolve the AMQP container (injected → rhea default). */
  private async resolveContainer(): Promise<AmqpContainerLike | null> {
    if (this.deps.container) return this.deps.container;
    try {
      const mod = (await import("rhea")) as unknown as { default?: AmqpContainerLike } & AmqpContainerLike;
      // rhea's default export IS the container instance (CJS `export =`).
      return (mod.default ?? mod) as AmqpContainerLike;
    } catch (err) {
      log("failed to load rhea AMQP library", err);
      return null;
    }
  }

  private connectEndpoint(container: AmqpContainerLike, ep: CfxEndpoint): void {
    const k = this.key(ep);
    let conn: AmqpConnectionLike;
    try {
      conn = container.connect({
        host: ep.host,
        port: ep.port,
        transport: ep.transport ?? "tcp",
        username: ep.username,
        password: ep.password,
        reconnect: true, // rhea owns backoff/reconnect (link-loss honesty)
        initial_reconnect_delay: 1000,
        max_reconnect_delay: 30000,
      });
    } catch (err) {
      const st = this.stats.get(k);
      if (st) st.lastError = err instanceof Error ? err.message : String(err);
      log(`connect ${k} failed`, err);
      return;
    }

    conn.on("connection_open", () => {
      const st = this.stats.get(k);
      if (st) {
        st.connected = true;
        st.lastError = null;
      }
      log(`connected ${k}`);
    });
    conn.on("connection_close", () => {
      const st = this.stats.get(k);
      if (st) {
        st.connected = false;
        st.receiverOpen = false;
      }
    });
    conn.on("disconnected", (ctx) => {
      const st = this.stats.get(k);
      if (st) {
        st.connected = false;
        st.receiverOpen = false;
        st.lastError = ctx?.error
          ? ctx.error instanceof Error
            ? ctx.error.message
            : String(ctx.error)
          : "disconnected";
      }
      // Honest link-loss log: reconnecting=true means rhea will retry.
      log(`disconnected ${k} (reconnecting=${ctx?.reconnecting !== false})`);
    });
    conn.on("connection_error", (ctx) => {
      const st = this.stats.get(k);
      if (st) st.lastError = String(ctx?.error ?? "connection_error");
    });
    conn.on("receiver_open", () => {
      const st = this.stats.get(k);
      if (st) st.receiverOpen = true;
    });
    conn.on("receiver_error", (ctx) => {
      const st = this.stats.get(k);
      if (st) st.lastError = String(ctx?.error ?? "receiver_error");
    });
    conn.on("message", (ctx) => this.handleMessage(ep, ctx));

    try {
      conn.open_receiver(ep.address);
    } catch (err) {
      const st = this.stats.get(k);
      if (st) st.lastError = err instanceof Error ? err.message : String(err);
      log(`open_receiver ${k} failed`, err);
    }

    this.connections.push(conn);
  }

  /**
   * Start subscribing. Returns false when the flag is off or no endpoint is
   * configured. Idempotent. When DI supplies endpoints/container the flag is
   * bypassed for testing ONLY if endpoints are explicitly injected.
   */
  async start(): Promise<boolean> {
    if (this.running) return true;

    const endpoints = this.deps.endpoints ?? parseEndpoints(process.env.CFX_ENDPOINTS);
    // Flag gate: skip when disabled UNLESS endpoints were explicitly injected (tests).
    if (!this.deps.endpoints && !isCfxEnabled()) {
      console.log("[CFX] disabled (set CFX_ENABLED=true to enable)");
      return false;
    }
    if (endpoints.length === 0) {
      console.log("[CFX] no endpoints configured (set CFX_ENDPOINTS) — nothing to start");
      return false;
    }

    const container = await this.resolveContainer();
    if (!container) {
      log("no AMQP container available — not started");
      return false;
    }

    for (const ep of endpoints) {
      const k = this.key(ep);
      this.stats.set(k, {
        host: ep.host,
        port: ep.port,
        address: ep.address,
        machineCode: ep.machineCode ?? null,
        connected: false,
        receiverOpen: false,
        messagesReceived: 0,
        messagesIgnored: 0,
        samplesEmitted: 0,
        lastMessageAt: null,
        lastError: null,
      });
      this.connectEndpoint(container, ep);
      console.log(`[CFX] subscribing ${k}${ep.machineCode ? ` → ${ep.machineCode}` : ""}`);
    }

    this.running = true;
    console.log(`[CFX] started — ${endpoints.length} endpoint(s)`);
    return true;
  }

  /** Stop: close every connection. Idempotent. */
  stop(): void {
    while (this.connections.length > 0) {
      const c = this.connections.pop()!;
      try {
        c.close();
      } catch (err) {
        log("close failed", err);
      }
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Snapshot of per-endpoint stats (for an optional status router). */
  getStats(): { running: boolean; enabled: boolean; endpoints: CfxEndpointStats[] } {
    return {
      running: this.running,
      enabled: isCfxEnabled(),
      endpoints: Array.from(this.stats.values()).map((s) => ({ ...s })),
    };
  }
}

// ── Module-level singleton (mirrors startMtconnectPoller / stop) ─────────────
let singleton: CfxClient | null = null;

/**
 * Start the shared CFX client. Mounted into server boot (server/_core/index.ts,
 * G1.2 doc 44 W0-D) — gated by CFX_ENABLED (default OFF) so boot stays a no-op
 * until the operator opts in. Safe to also call explicitly (idempotent).
 */
export async function startCfxClient(deps?: CfxClientDeps): Promise<boolean> {
  if (!singleton) singleton = new CfxClient(deps);
  return singleton.start();
}

/** Stop the shared CFX client. Idempotent. */
export function stopCfxClient(): void {
  singleton?.stop();
}

/** Status of the shared CFX client (safe before start()). */
export function getCfxStats(): { running: boolean; enabled: boolean; endpoints: CfxEndpointStats[] } {
  return singleton?.getStats() ?? { running: false, enabled: isCfxEnabled(), endpoints: [] };
}
