/**
 * doc 24 Wave-3 / C3 — OT CONNECTION SUPERVISOR (reconnect + dual-endpoint failover).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PROBLEM (the C3 audit gap): today `otManager` connects each adapter ONCE and
 * holds a single `active` entry. If the driver drops there is NO reconnect
 * supervisor and NO way to fail over to a backup endpoint — a device outage
 * silently ends telemetry for that adapter until a manual restart.
 *
 * FIX (additive, flag-gated by OT_CONN_HA_ENABLED, default OFF): wrap each
 * adapter's driver(s) in a supervisor that
 *   1) DETECTS a lost/unhealthy connection (health() polling + isConnected()),
 *   2) RECONNECTS with EXPONENTIAL BACKOFF + JITTER (bounded by a max delay),
 *   3) runs a per-adapter STATE MACHINE (connecting → connected ⇄ reconnecting
 *      → failed) with honest metrics + a status getter, and
 *   4) on recovery RE-SUBSCRIBES the monitored tags.
 *   5) DUAL-ENDPOINT FAILOVER: an adapter may declare a primary + secondary
 *      endpoint; on primary loss the supervisor PROMOTES the standby with ZERO
 *      backoff (immediate) so telemetry resumes within one cycle. Only ONE
 *      endpoint's driver is ever connected at a time (single-writer preserved):
 *      the newly-promoted driver is what `otManager.getActiveDriver` returns, so
 *      the command dispatcher resolves the current endpoint WITHOUT any change to
 *      its gates or its single-dispatch invariant.
 *
 * SAFETY / HONESTY:
 *   - Every driver call is wrapped; a driver fault NEVER throws to the host
 *     (preserves otManager's existing fail-safe-skip behaviour).
 *   - The supervisor produces NO data of its own; it only forwards samples the
 *     real driver delivered. Metrics count real events (attempts, reconnects,
 *     failovers, dropped detections) — never fabricated.
 *   - "hot-standby" here means the standby endpoint is PROMOTED IMMEDIATELY on
 *     failure (no backoff wait), NOT that a second live socket is held open — so
 *     device load is not doubled and single-writer semantics hold trivially.
 *
 * The OtDriver contract has no event channel, so disconnect DETECTION is by
 * polling isConnected()/health() on a bounded interval (drivers update their
 * health on read/write errors). This is cheap and deterministic.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type {
  OtDriver,
  OtConnectionConfig,
  OtTagAddress,
  OtSample,
  OtSubscriptionHandle,
  OnOtSample,
  OtProtocol,
} from "./otDriver";

/** Lifecycle state of a supervised adapter connection. */
export type SupervisorState =
  | "idle" // constructed, start() not called yet
  | "connecting" // initial connect attempt in progress (never connected yet)
  | "connected" // an endpoint is connected + subscribed (active)
  | "reconnecting" // lost/attempting recovery (backoff wait or connect in progress)
  | "failed" // a full endpoint cycle failed; waiting on backoff to retry
  | "stopped"; // stop() called — terminal

/** One endpoint the supervisor may connect to (primary or hot-standby secondary). */
export interface EndpointConfig {
  label: "primary" | "secondary";
  connection: OtConnectionConfig;
}

/** Bounded exponential-backoff-with-jitter parameters. */
export interface BackoffConfig {
  /** Base delay for the first retry (ms). */
  initialMs: number;
  /** Hard cap on any single backoff delay (ms). */
  maxMs: number;
  /** Exponential multiplier per consecutive failure (>= 1). */
  factor: number;
  /** Jitter fraction 0..1: delay ∈ [raw·(1-jitter), raw]. 0 = deterministic. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  initialMs: 500,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.5,
};

export interface SupervisorOptions {
  adapterId: number;
  code: string;
  protocol: OtProtocol;
  tags: OtTagAddress[];
  pollIntervalMs: number;
  /** 1 (primary only) or 2 (primary + secondary) endpoints, in preference order. */
  endpoints: EndpointConfig[];
  /** Factory for a fresh driver instance — ONE is created per endpoint up-front. */
  createDriver: () => OtDriver;
  /** Ingest callback (one per sample); forwarded exactly as the legacy path does. */
  onSample: OnOtSample;
  /** Health-poll interval (ms). Defaults to min(pollInterval, 2000), floored at 250. */
  healthIntervalMs?: number;
  /** Backoff parameters (defaults to DEFAULT_BACKOFF). */
  backoff?: Partial<BackoffConfig>;
}

/** Snapshot of a supervisor for an internal health getter (future health endpoint). */
export interface SupervisorStatus {
  adapterId: number;
  code: string;
  protocol: OtProtocol;
  state: SupervisorState;
  /** True iff the active endpoint's driver reports connected right now. */
  connected: boolean;
  /** The endpoint string currently active (or null if none connected). */
  activeEndpoint: string | null;
  /** Which declared endpoint is active. */
  activeLabel: "primary" | "secondary" | null;
  /** How many endpoints are configured (1 = no failover; 2 = dual-endpoint). */
  endpointCount: number;
  /** Successful reconnections since start (excludes the initial connect). */
  reconnects: number;
  /** Times the active endpoint changed to a DIFFERENT endpoint (promotions). */
  failovers: number;
  /** Cumulative connect() attempts (all endpoints, all cycles). */
  attempts: number;
  /** Consecutive fully-failed cycles (drives the current backoff exponent). */
  consecutiveFailures: number;
  /** Samples forwarded to ingest since start. */
  samplesForwarded: number;
  /** Last error text observed on a connect/health fault (or null). */
  lastError: string | null;
  /** ISO time the active endpoint last connected (or null). */
  lastConnectedAt: string | null;
  /** ISO time of the last state transition. */
  lastStateChangeAt: string | null;
}

/** A configured endpoint + its (reused-across-reconnects) driver instance. */
interface RuntimeEndpoint {
  label: "primary" | "secondary";
  connection: OtConnectionConfig;
  driver: OtDriver;
}

function errMsg(err: unknown): string {
  return (err as Error)?.message || String(err);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Supervises ONE adapter connection: reconnect with backoff + dual-endpoint
 * failover + a state machine. All public methods are non-throwing.
 */
export class ConnectionSupervisor {
  private readonly adapterId: number;
  private readonly code: string;
  private readonly protocol: OtProtocol;
  private readonly tags: OtTagAddress[];
  private readonly pollIntervalMs: number;
  private readonly onSample: OnOtSample;
  private readonly healthIntervalMs: number;
  private readonly backoff: BackoffConfig;

  private readonly endpoints: RuntimeEndpoint[];

  // ── mutable runtime state ──────────────────────────────────────────────────
  private state: SupervisorState = "idle";
  private activeIndex = -1; // index into endpoints of the connected endpoint (-1 = none)
  private activeHandle: OtSubscriptionHandle | null = null;

  private hasConnectedOnce = false;
  private cycleRunning = false;
  private stopped = false;

  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  // ── honest metrics ─────────────────────────────────────────────────────────
  private attempts = 0;
  private reconnects = 0;
  private failovers = 0;
  private consecutiveFailures = 0;
  private samplesForwarded = 0;
  private lastError: string | null = null;
  private lastConnectedAt: number | null = null;
  private lastStateChangeAt: number = Date.now();

  constructor(opts: SupervisorOptions) {
    this.adapterId = opts.adapterId;
    this.code = opts.code;
    this.protocol = opts.protocol;
    this.tags = opts.tags;
    this.pollIntervalMs = opts.pollIntervalMs > 0 ? opts.pollIntervalMs : 5000;
    this.onSample = opts.onSample;
    this.backoff = {
      initialMs: opts.backoff?.initialMs ?? DEFAULT_BACKOFF.initialMs,
      maxMs: opts.backoff?.maxMs ?? DEFAULT_BACKOFF.maxMs,
      factor: opts.backoff?.factor ?? DEFAULT_BACKOFF.factor,
      jitter: clamp01(opts.backoff?.jitter ?? DEFAULT_BACKOFF.jitter),
    };
    // Health poll must be <= the poll interval so a loss is detected within one
    // cycle (the failover requirement); floored only to avoid a busy loop.
    const desiredHealth = opts.healthIntervalMs ?? Math.min(this.pollIntervalMs, 2000);
    this.healthIntervalMs = Math.max(20, Math.min(desiredHealth, this.pollIntervalMs));

    if (!opts.endpoints || opts.endpoints.length === 0) {
      throw new Error(`ConnectionSupervisor "${opts.code}": at least one endpoint required`);
    }
    // ONE driver instance per endpoint, created up-front and REUSED across
    // reconnects (drivers create a fresh transport on each connect()).
    this.endpoints = opts.endpoints.map((e) => ({
      label: e.label,
      connection: e.connection,
      driver: opts.createDriver(),
    }));
  }

  // ── public API ───────────────────────────────────────────────────────────

  /**
   * Begin supervision: start the health loop and run the initial connect cycle
   * (primary first). Never throws — a failed initial connect schedules a retry.
   */
  async start(): Promise<void> {
    if (this.state !== "idle") return;
    this.startHealthLoop();
    await this.runReconnect(false);
  }

  /**
   * The currently-active connected driver, or undefined when not connected. This
   * is what otManager.getActiveDriver delegates to, so the command dispatcher
   * resolves the CURRENT endpoint. Returns undefined unless state==='connected'
   * AND the active driver still reports connected (dispatcher → ADAPTER_OFFLINE).
   */
  getActiveDriver(): OtDriver | undefined {
    if (this.state !== "connected") return undefined;
    const ep = this.endpoints[this.activeIndex];
    if (!ep) return undefined;
    try {
      return ep.driver.isConnected() ? ep.driver : undefined;
    } catch {
      return undefined;
    }
  }

  /** The endpoint string currently active (or undefined). */
  getActiveEndpoint(): string | undefined {
    const ep = this.endpoints[this.activeIndex];
    return ep?.connection.endpoint;
  }

  /** Non-throwing snapshot for a future health endpoint / UI. */
  status(): SupervisorStatus {
    const ep = this.endpoints[this.activeIndex];
    let connected = false;
    try {
      connected = this.state === "connected" && !!ep && ep.driver.isConnected();
    } catch {
      connected = false;
    }
    return {
      adapterId: this.adapterId,
      code: this.code,
      protocol: this.protocol,
      state: this.state,
      connected,
      activeEndpoint: ep?.connection.endpoint ?? null,
      activeLabel: ep?.label ?? null,
      endpointCount: this.endpoints.length,
      reconnects: this.reconnects,
      failovers: this.failovers,
      attempts: this.attempts,
      consecutiveFailures: this.consecutiveFailures,
      samplesForwarded: this.samplesForwarded,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt != null ? new Date(this.lastConnectedAt).toISOString() : null,
      lastStateChangeAt: new Date(this.lastStateChangeAt).toISOString(),
    };
  }

  /**
   * Stop supervision: clear timers, close the active subscription, and
   * disconnect every endpoint driver. Idempotent + non-throwing.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.setState("stopped");
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    await this.closeActiveHandle();
    for (const ep of this.endpoints) await this.safeDisconnect(ep);
    this.activeIndex = -1;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private setState(next: SupervisorState): void {
    if (this.state === next) return;
    this.state = next;
    this.lastStateChangeAt = Date.now();
  }

  private startHealthLoop(): void {
    const timer = setInterval(() => {
      void this.healthTick();
    }, this.healthIntervalMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    this.healthTimer = timer;
  }

  /**
   * One health probe of the ACTIVE endpoint. Only acts while 'connected' — during
   * reconnecting/failed a backoff-scheduled cycle already owns recovery. Never throws.
   */
  private async healthTick(): Promise<void> {
    try {
      if (this.stopped || this.state !== "connected") return;
      const ep = this.endpoints[this.activeIndex];
      if (!ep) return;
      let healthy = false;
      try {
        healthy = ep.driver.isConnected();
        if (healthy) {
          const h = await ep.driver.health();
          healthy = h.connected !== false;
        }
      } catch (err) {
        this.lastError = errMsg(err);
        healthy = false;
      }
      if (!healthy && this.state === "connected") {
        await this.onActiveLost();
      }
    } catch {
      // never throw to the host from a timer callback
    }
  }

  /** The active endpoint was detected down → promote standby / reconnect. */
  private async onActiveLost(): Promise<void> {
    if (this.stopped) return;
    this.setState("reconnecting");
    await this.closeActiveHandle();
    // preferOther=true → try the OTHER endpoint first (immediate hot-standby promote).
    await this.runReconnect(true);
  }

  /**
   * Run (at most) one reconnect cycle, then — if it failed — schedule the next
   * with exponential backoff. Single-flight (cycleRunning guard). Non-throwing.
   */
  private async runReconnect(preferOther: boolean): Promise<void> {
    if (this.stopped || this.cycleRunning) return;
    this.cycleRunning = true;
    try {
      const ok = await this.attemptCycle(preferOther);
      if (!ok && !this.stopped) {
        this.scheduleRetry(this.nextBackoffDelay());
      }
    } finally {
      this.cycleRunning = false;
    }
  }

  /**
   * Try to (re)connect+subscribe, walking endpoints in preference order. On the
   * FIRST success: mark it active, reset backoff, resume telemetry, and disconnect
   * the previously-active (different) endpoint to keep exactly one live connection.
   * On a full failure: bump consecutiveFailures + set 'failed'. Never throws.
   */
  private async attemptCycle(preferOther: boolean): Promise<boolean> {
    if (this.stopped) return false;
    const prevIndex = this.activeIndex;
    this.setState(this.hasConnectedOnce ? "reconnecting" : "connecting");

    for (const idx of this.tryOrder(preferOther)) {
      if (this.stopped) return false;
      const ep = this.endpoints[idx];
      this.attempts += 1;
      try {
        await this.connectAndSubscribe(ep);
        // ── success ──
        this.activeIndex = idx;
        this.consecutiveFailures = 0;
        this.lastError = null;
        this.lastConnectedAt = Date.now();
        const wasConnected = this.hasConnectedOnce;
        if (wasConnected) this.reconnects += 1;
        if (wasConnected && prevIndex >= 0 && prevIndex !== idx) {
          this.failovers += 1;
          // single-writer: drop the endpoint we just left (if still up).
          await this.safeDisconnect(this.endpoints[prevIndex]);
        }
        this.hasConnectedOnce = true;
        this.setState("connected");
        return true;
      } catch (err) {
        this.lastError = errMsg(err);
        await this.safeDisconnect(ep);
        // try the next endpoint in this cycle
      }
    }

    // no endpoint connected this cycle
    this.consecutiveFailures += 1;
    this.setState("failed");
    return false;
  }

  /** Endpoint indices to try: primary-first, or standby-first when promoting. */
  private tryOrder(preferOther: boolean): number[] {
    const n = this.endpoints.length;
    const all = Array.from({ length: n }, (_, i) => i);
    if (preferOther && n > 1) {
      const start = this.activeIndex >= 0 ? (this.activeIndex + 1) % n : 0;
      return [...all.slice(start), ...all.slice(0, start)];
    }
    return all;
  }

  /**
   * Connect an endpoint and subscribe its tags. Closes any prior active handle
   * first (the old endpoint is already down when we get here). Throws on any
   * connect/subscribe failure so attemptCycle can move to the next endpoint.
   */
  private async connectAndSubscribe(ep: RuntimeEndpoint): Promise<void> {
    await this.closeActiveHandle();
    // Ensure a clean slate: a stale-but-"connected" driver is disconnected first.
    try {
      if (ep.driver.isConnected()) await ep.driver.disconnect();
    } catch {
      // ignore — connect() below establishes a fresh transport
    }
    await ep.driver.connect(ep.connection);
    let handle: OtSubscriptionHandle;
    try {
      handle = await ep.driver.subscribe(this.tags, this.wrappedOnSample, this.pollIntervalMs);
    } catch (err) {
      await this.safeDisconnect(ep);
      throw err;
    }
    this.activeHandle = handle;
  }

  /** Forward one sample to ingest; a callback fault never breaks the poll loop. */
  private readonly wrappedOnSample = async (sample: OtSample): Promise<void> => {
    try {
      await this.onSample(sample);
      this.samplesForwarded += 1;
    } catch {
      // swallow — one bad sample must not kill the subscription
    }
  };

  private async closeActiveHandle(): Promise<void> {
    if (this.activeHandle) {
      const h = this.activeHandle;
      this.activeHandle = null;
      try {
        await h.close();
      } catch {
        // ignore
      }
    }
  }

  private async safeDisconnect(ep: RuntimeEndpoint): Promise<void> {
    try {
      await ep.driver.disconnect();
    } catch {
      // ignore
    }
  }

  private scheduleRetry(delayMs: number): void {
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const timer = setTimeout(() => {
      this.retryTimer = null;
      void this.runReconnect(true);
    }, delayMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    this.retryTimer = timer;
  }

  /** Exponential backoff with (equal-)jitter, bounded by maxMs. */
  private nextBackoffDelay(): number {
    const { initialMs, maxMs, factor, jitter } = this.backoff;
    const exp = Math.max(0, this.consecutiveFailures - 1);
    const raw = Math.min(maxMs, initialMs * Math.pow(factor, exp));
    const fixed = raw * (1 - jitter);
    const rand = raw * jitter * Math.random();
    return Math.round(fixed + rand);
  }
}
