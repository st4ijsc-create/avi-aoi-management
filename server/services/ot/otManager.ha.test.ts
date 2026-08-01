/**
 * doc 24 Wave-3 / C3 — otManager HA integration tests (vitest, mock drivers).
 *
 * Proves the manager-level acceptance for connection HA/failover:
 *   (b) OT_CONN_HA_ENABLED=true: primary loss PROMOTES the secondary AND
 *       getActiveDriver(adapterId) — the EXACT function commandDispatcher calls to
 *       resolve a connected driver — now returns the NEW active (secondary) driver.
 *       Proves failover reaches dispatch WITHOUT touching the dispatcher's gates.
 *   (e) FLAG OFF (default): legacy single-endpoint path runs exactly as before —
 *       no supervisor is created, getActiveDriver resolves the adapter's own driver.
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

const TAGS: OtTagAddress[] = [{ tagKey: "t", address: "a", dataType: "float" }];

/** Minimal controllable mock driver (deterministic, no I/O). */
class MockDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  failNext = 0;
  private onSample?: OnOtSample;
  private tags: OtTagAddress[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private c = 0;

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
    this.stop();
  }
  isConnected(): boolean {
    return this.connected;
  }
  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    return tags.map((t) => this.mk(t));
  }
  async subscribe(tags: OtTagAddress[], onSample: OnOtSample, intervalMs = 1000): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error(`subscribe: not connected (${this.id})`);
    this.onSample = onSample;
    this.tags = tags;
    this.mkEmit();
    const timer = setInterval(() => this.mkEmit(), intervalMs > 0 ? intervalMs : 1000);
    if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
    this.timer = timer;
    return { close: async () => this.stop() };
  }
  async writeTags(w: OtWrite[]): Promise<OtCommandResult[]> {
    return w.map((x) => ({ tagKey: x.tagKey, ok: true }));
  }
  async health(): Promise<OtHealth> {
    return { protocol: this.protocol, connected: this.connected };
  }
  drop(): void {
    this.connected = false;
    this.stop();
  }
  private mkEmit(): void {
    for (const t of this.tags) void this.onSample?.(this.mk(t));
  }
  private mk(t: OtTagAddress): OtSample {
    return { tagKey: t.tagKey, raw: this.c, value: this.c++, quality: "good", timestamp: new Date() };
  }
  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function adapterFixture(over: Record<string, unknown> = {}) {
  return {
    adapterId: 10,
    code: "A10",
    machineId: 5,
    protocol: "stub" as OtProtocol,
    connection: { endpoint: "primary://x" } as OtConnectionConfig,
    pollIntervalMs: 1000,
    tags: TAGS,
    driver: new MockDriver("legacy"),
    backupConnection: undefined as OtConnectionConfig | undefined,
    ...over,
  };
}

describe("otManager — C3 HA / failover", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("(b) primary loss promotes secondary → getActiveDriver resolves the new active driver", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_HEALTH_INTERVAL_MS", "100");
    vi.stubEnv("OT_CONN_HA_BACKOFF_MS", "50");
    vi.stubEnv("OT_CONN_HA_BACKOFF_JITTER", "0");

    const created: MockDriver[] = [];
    vi.doMock("./driverRegistry", () => ({
      createDriver: () => {
        const m = new MockDriver(`m${created.length}`);
        created.push(m);
        return m;
      },
    }));
    const received: unknown[] = [];
    vi.doMock("./ingest", () => ({
      ingestSample: async (_a: unknown, s: OtSample) => {
        received.push(s.value);
      },
    }));
    const adapter = adapterFixture({ backupConnection: { endpoint: "secondary://y" } as OtConnectionConfig });
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [adapter] }));

    const ot = await import("./otManager");
    const ok = await ot.startOt();
    expect(ok).toBe(true);
    expect(ot.isOtRunning()).toBe(true);
    expect(ot.isConnHaEnabled()).toBe(true);

    // supervisor made TWO drivers (primary + secondary).
    expect(created).toHaveLength(2);
    const [primary, secondary] = created;

    // Initially the dispatcher would resolve the PRIMARY driver.
    expect(ot.getActiveDriver(10)).toBe(primary);
    expect(ot.getSupervisorStatus(10)?.activeLabel).toBe("primary");

    // Primary link dies and cannot re-establish; secondary is healthy.
    primary.drop();
    primary.failNext = 99;

    // One health interval → detect + promote secondary (immediate hot-standby).
    await vi.advanceTimersByTimeAsync(100);

    // THE KEY ASSERTION: getActiveDriver (what commandDispatcher step-4 calls) now
    // resolves the promoted SECONDARY driver — failover reaches dispatch untouched.
    expect(ot.getActiveDriver(10)).toBe(secondary);
    const st = ot.getSupervisorStatus(10)!;
    expect(st.state).toBe("connected");
    expect(st.activeLabel).toBe("secondary");
    expect(st.failovers).toBe(1);
    // Single-writer: only one driver connected; the old primary was disconnected.
    expect(secondary.isConnected()).toBe(true);
    expect(primary.isConnected()).toBe(false);
    // Telemetry actually flowed through the manager's ingest wiring.
    expect(received.length).toBeGreaterThan(0);

    await ot.stopOt();
    expect(ot.isOtRunning()).toBe(false);
    expect(ot.listSupervisorStatuses()).toHaveLength(0);
  });

  it("(e) flag OFF → legacy single-endpoint path (no supervisor, adapter.driver used)", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    // OT_CONN_HA_ENABLED intentionally UNSET → default OFF.

    const legacy = new MockDriver("legacy");
    const adapter = adapterFixture({ adapterId: 20, driver: legacy });
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [adapter] }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => {} }));
    // The legacy path must NOT create drivers from the registry.
    vi.doMock("./driverRegistry", () => ({
      createDriver: () => {
        throw new Error("createDriver must not be called on the legacy path");
      },
    }));

    const ot = await import("./otManager");
    const ok = await ot.startOt();
    expect(ok).toBe(true);
    expect(ot.isOtRunning()).toBe(true);
    expect(ot.isConnHaEnabled()).toBe(false);

    // No supervisor exists; status getters are empty.
    expect(ot.listSupervisorStatuses()).toHaveLength(0);
    expect(ot.getSupervisorStatus(20)).toBeUndefined();

    // getActiveDriver resolves the adapter's OWN driver (legacy behaviour, unchanged).
    expect(ot.getActiveDriver(20)).toBe(legacy);
    expect(legacy.isConnected()).toBe(true);
    expect(ot.getActiveAdapter(20)?.adapterId).toBe(20);

    await ot.stopOt();
    expect(ot.isOtRunning()).toBe(false);
    expect(legacy.isConnected()).toBe(false); // disconnected on stop (legacy teardown)
  });

  it("(e) flag OFF: an un-implemented driver is still skipped without crashing", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    // HA off.
    const failing = adapterFixture({
      adapterId: 30,
      driver: {
        protocol: "opcua",
        connect: vi.fn().mockRejectedValue(new Error("opcua not implemented")),
        disconnect: vi.fn().mockResolvedValue(undefined),
        isConnected: () => false,
        subscribe: vi.fn(),
        readTags: vi.fn(),
        writeTags: vi.fn(),
        health: vi.fn(),
      } as unknown as OtDriver,
    });
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [failing] }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => {} }));
    vi.doMock("./driverRegistry", () => ({ createDriver: () => new MockDriver() }));

    const ot = await import("./otManager");
    const ok = await ot.startOt();
    expect(ok).toBe(true); // manager started; the failing adapter is skipped
    expect(ot.getActiveDriver(30)).toBeUndefined();
    await ot.stopOt();
  });
});
