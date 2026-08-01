/**
 * doc 24 Wave-3 / C3 — ConnectionSupervisor unit tests (vitest, mock drivers, NO hardware).
 *
 * Proves the supervisor acceptance matrix:
 *   (a) a driver that DROPS is reconnected with EXPONENTIAL BACKOFF (waits, retries).
 *   (b) primary-down PROMOTES the secondary; getActiveDriver() (what the dispatcher
 *       calls) resolves the NEW active driver; single-writer preserved (old dropped).
 *   (c) failover causes NO data loss beyond one cycle (telemetry resumes fast).
 *   (d) the supervisor NEVER throws to the host on any driver fault.
 * Flag OFF (legacy single-endpoint) + dispatch-resolution live in otManager.ha.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  OtDriver,
  OtProtocol,
  OtConnectionConfig,
  OtTagAddress,
  OtSample,
  OtSubscriptionHandle,
  OtCommandResult,
  OtHealth,
  OtWrite,
  OnOtSample,
} from "./otDriver";
import { ConnectionSupervisor, type EndpointConfig } from "./connectionSupervisor";

const TAGS: OtTagAddress[] = [{ tagKey: "t1", address: "addr1", dataType: "float" }];

/** A controllable mock driver — deterministic, no real I/O. */
class MockDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  connectCalls = 0;
  subscribeCalls = 0;
  disconnectCalls = 0;
  emitted = 0;
  /** Number of upcoming connect() calls that should throw. */
  failNext = 0;
  throwOnHealth = false;
  emitOnSubscribe = true;

  private onSample?: OnOtSample;
  private tags: OtTagAddress[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private counter = 0;

  constructor(readonly id = "d") {}

  async connect(_cfg: OtConnectionConfig): Promise<void> {
    this.connectCalls += 1;
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error(`connect fail (${this.id})`);
    }
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
    this.stopTimer();
  }
  isConnected(): boolean {
    return this.connected;
  }
  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    return tags.map((t) => this.mk(t));
  }
  async subscribe(tags: OtTagAddress[], onSample: OnOtSample, intervalMs = 1000): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error(`subscribe: not connected (${this.id})`);
    this.subscribeCalls += 1;
    this.onSample = onSample;
    this.tags = tags;
    if (this.emitOnSubscribe) this.tick();
    const timer = setInterval(() => this.tick(), intervalMs > 0 ? intervalMs : 1000);
    if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
    this.timer = timer;
    return {
      close: async () => {
        this.stopTimer();
      },
    };
  }
  async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  }
  async health(): Promise<OtHealth> {
    if (this.throwOnHealth) throw new Error(`health boom (${this.id})`);
    return { protocol: this.protocol, connected: this.connected };
  }

  /** TEST helper: simulate a link loss WITHOUT calling disconnect(). */
  drop(): void {
    this.connected = false;
    this.stopTimer();
  }
  private tick(): void {
    for (const t of this.tags) {
      void this.onSample?.(this.mk(t));
      this.emitted += 1;
    }
  }
  private mk(t: OtTagAddress): OtSample {
    return { tagKey: t.tagKey, raw: this.counter, value: this.counter++, quality: "good", timestamp: new Date() };
  }
  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** A driver whose EVERY method throws — to prove non-throwing supervision. */
class EvilDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  async connect(): Promise<void> {
    throw new Error("connect boom");
  }
  async disconnect(): Promise<void> {
    throw new Error("disconnect boom");
  }
  isConnected(): boolean {
    throw new Error("isConnected boom");
  }
  async readTags(): Promise<OtSample[]> {
    throw new Error("read boom");
  }
  async subscribe(): Promise<OtSubscriptionHandle> {
    throw new Error("subscribe boom");
  }
  async writeTags(): Promise<OtCommandResult[]> {
    throw new Error("write boom");
  }
  async health(): Promise<OtHealth> {
    throw new Error("health boom");
  }
}

function endpoints(...labels: Array<"primary" | "secondary">): EndpointConfig[] {
  return labels.map((label) => ({ label, connection: { endpoint: `${label}://host` } }));
}

describe("ConnectionSupervisor — C3", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // ── (a) reconnect with exponential backoff ─────────────────────────────────
  it("(a) reconnects a dropped driver with exponential backoff", async () => {
    const drv = new MockDriver("A");
    const sup = new ConnectionSupervisor({
      adapterId: 1,
      code: "ADP",
      protocol: "stub",
      tags: TAGS,
      pollIntervalMs: 1000,
      endpoints: endpoints("primary"),
      createDriver: () => drv,
      onSample: async () => {},
      healthIntervalMs: 50,
      backoff: { initialMs: 100, maxMs: 1000, factor: 2, jitter: 0 }, // jitter 0 = deterministic
    });

    await sup.start();
    expect(sup.status().state).toBe("connected");
    expect(drv.connectCalls).toBe(1);

    // Simulate a link loss + make the next TWO reconnects fail (then succeed).
    drv.drop();
    drv.failNext = 2;

    // Health tick (50ms) detects the drop → attempt #1 (fails) → schedule backoff(100ms).
    await vi.advanceTimersByTimeAsync(50);
    expect(sup.status().state).not.toBe("connected");
    expect(drv.connectCalls).toBe(2);

    // Still inside the first backoff window → NO new attempt (proves it waits).
    await vi.advanceTimersByTimeAsync(50); // t≈100 from drop; retry scheduled at detect+100 ≈ 150
    expect(drv.connectCalls).toBe(2);

    // Cross the 100ms backoff → attempt #2 (fails) → schedule backoff(200ms, exponential).
    await vi.advanceTimersByTimeAsync(60);
    expect(drv.connectCalls).toBe(3);
    expect(sup.status().state).not.toBe("connected");

    // Still inside the SECOND (longer) backoff window → no new attempt yet.
    await vi.advanceTimersByTimeAsync(150);
    expect(drv.connectCalls).toBe(3);

    // Cross the 200ms backoff → attempt #3 succeeds → connected again.
    await vi.advanceTimersByTimeAsync(100);
    expect(drv.connectCalls).toBe(4);
    expect(sup.status().state).toBe("connected");
    expect(sup.status().reconnects).toBe(1);

    await sup.stop();
  });

  // ── (b) primary-down promotes secondary; getActiveDriver resolves the new one ─
  it("(b) promotes the secondary on primary loss; getActiveDriver resolves it (single-writer)", async () => {
    const dq: MockDriver[] = [];
    const createDriver = () => {
      const m = new MockDriver(`d${dq.length}`);
      dq.push(m);
      return m;
    };
    const sup = new ConnectionSupervisor({
      adapterId: 2,
      code: "ADP2",
      protocol: "stub",
      tags: TAGS,
      pollIntervalMs: 1000,
      endpoints: endpoints("primary", "secondary"),
      createDriver,
      onSample: async () => {},
      healthIntervalMs: 100,
      backoff: { initialMs: 50, maxMs: 500, factor: 2, jitter: 0 },
    });

    await sup.start();
    const [primary, secondary] = dq;
    expect(sup.getActiveDriver()).toBe(primary);
    expect(sup.status().activeLabel).toBe("primary");

    // Primary link dies AND cannot re-establish; secondary is healthy.
    primary.drop();
    primary.failNext = 99;

    // One health tick detects the loss and promotes the secondary (immediate).
    await vi.advanceTimersByTimeAsync(100);

    const st = sup.status();
    expect(st.state).toBe("connected");
    expect(st.activeLabel).toBe("secondary");
    expect(st.failovers).toBe(1);
    // getActiveDriver (exactly what commandDispatcher resolves) is now the secondary.
    expect(sup.getActiveDriver()).toBe(secondary);
    expect(secondary.isConnected()).toBe(true);
    // Single-writer: the old (primary) endpoint was disconnected.
    expect(primary.disconnectCalls).toBeGreaterThan(0);
    expect(primary.isConnected()).toBe(false);

    await sup.stop();
  });

  // ── (c) failover causes no data loss beyond one cycle ──────────────────────
  it("(c) failover resumes telemetry within one cycle (no gap beyond one poll)", async () => {
    const dq: MockDriver[] = [];
    const createDriver = () => {
      const m = new MockDriver(`s${dq.length}`);
      dq.push(m);
      return m;
    };
    const received: unknown[] = [];
    const sup = new ConnectionSupervisor({
      adapterId: 3,
      code: "ADP3",
      protocol: "stub",
      tags: TAGS,
      pollIntervalMs: 1000,
      endpoints: endpoints("primary", "secondary"),
      createDriver,
      onSample: async (s: OtSample) => {
        received.push(s.value);
      },
      healthIntervalMs: 200, // detection latency < poll interval
      backoff: { initialMs: 50, maxMs: 500, factor: 2, jitter: 0 },
    });

    await sup.start();
    const [primary, secondary] = dq;
    // Primary emitted an initial sample on subscribe.
    expect(received.length).toBeGreaterThanOrEqual(1);
    // Let a couple of poll cycles flow on the primary.
    await vi.advanceTimersByTimeAsync(2000);
    const beforeFailover = received.length;
    expect(beforeFailover).toBeGreaterThan(1);

    // Primary drops; secondary takes over.
    primary.drop();
    primary.failNext = 99;

    // Within ONE detection interval (200ms < 1000ms poll) the secondary is
    // promoted AND emits immediately on subscribe → telemetry resumed with no gap
    // beyond one cycle.
    await vi.advanceTimersByTimeAsync(200);
    expect(sup.status().activeLabel).toBe("secondary");
    expect(received.length).toBeGreaterThan(beforeFailover); // resumed already
    expect(secondary.emitted).toBeGreaterThan(0);

    // And it keeps flowing on subsequent cycles.
    const afterPromote = received.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(received.length).toBeGreaterThan(afterPromote);

    await sup.stop();
  });

  // ── (d) supervisor never throws on driver faults ───────────────────────────
  it("(d) never throws when every driver method faults", async () => {
    const sup = new ConnectionSupervisor({
      adapterId: 4,
      code: "EVIL",
      protocol: "stub",
      tags: TAGS,
      pollIntervalMs: 500,
      endpoints: endpoints("primary"),
      createDriver: () => new EvilDriver(),
      onSample: async () => {},
      healthIntervalMs: 100,
      backoff: { initialMs: 50, maxMs: 200, factor: 2, jitter: 0 },
    });

    // start() must resolve (not reject) despite connect/subscribe/disconnect throwing.
    await expect(sup.start()).resolves.toBeUndefined();
    expect(sup.status().state).toBe("failed");
    expect(sup.status().connected).toBe(false);
    expect(sup.getActiveDriver()).toBeUndefined();

    // Advancing through several backoff + health cycles must not throw either (a
    // thrown error here would reject this await and fail the test).
    await vi.advanceTimersByTimeAsync(1000);
    expect(sup.status().state).toBe("failed");

    // stop() is non-throwing even though disconnect() throws.
    await expect(sup.stop()).resolves.toBeUndefined();
    expect(sup.status().state).toBe("stopped");
  });

  it("(d) a health() fault triggers reconnect without throwing to the host", async () => {
    const drv = new MockDriver("H");
    const sup = new ConnectionSupervisor({
      adapterId: 5,
      code: "HADP",
      protocol: "stub",
      tags: TAGS,
      pollIntervalMs: 1000,
      endpoints: endpoints("primary"),
      createDriver: () => drv,
      onSample: async () => {},
      healthIntervalMs: 100,
      backoff: { initialMs: 50, maxMs: 200, factor: 2, jitter: 0 },
    });

    await sup.start();
    expect(sup.status().state).toBe("connected");

    // health() now throws → detection treats the endpoint as unhealthy → reconnect.
    drv.throwOnHealth = true;
    await vi.advanceTimersByTimeAsync(150); // would reject here if a throw escaped
    // Recovered (connect still works) — reconnected at least once, no throw escaped.
    expect(sup.status().reconnects).toBeGreaterThanOrEqual(1);

    await sup.stop();
  });

  it("(d) a throwing ingest callback never breaks the subscription", async () => {
    const drv = new MockDriver("CB");
    let calls = 0;
    const sup = new ConnectionSupervisor({
      adapterId: 6,
      code: "CBADP",
      protocol: "stub",
      tags: TAGS,
      pollIntervalMs: 500,
      endpoints: endpoints("primary"),
      createDriver: () => drv,
      onSample: async () => {
        calls += 1;
        throw new Error("ingest boom");
      },
      healthIntervalMs: 200,
      backoff: { initialMs: 50, maxMs: 200, factor: 2, jitter: 0 },
    });

    await expect(sup.start()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1200); // would reject here if a throw escaped
    expect(calls).toBeGreaterThan(0); // callback fired
    expect(sup.status().state).toBe("connected"); // subscription survived the throws
    await sup.stop();
  });
});
