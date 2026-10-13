/**
 * doc 81 Đợt 10 task D fix review 3 — security scan #73 on otManager.ts ("fail-open-state-drift"), the concrete paths:
 *   1. stopOt left the R-10-al "gateway on" flag set ⇒ a reconcile / NOTIFY attach after stopOt RE-STARTED a central session (polling,
 *      ingest, getActiveDriver ⇒ the dispatcher writes) on a gateway that had been stopped;
 *   2. a DETACH (the adapter moved to an edge node) that ran while an attach / start of that adapter was still CONNECTING could not see
 *      the session yet ⇒ the late connect registered it anyway: central kept polling and writing an EDGE-OWNED adapter (legacy path:
 *      the entry was re-listed in `active`; HA path: the supervisor was registered after the detach).
 * Mock drivers, no I/O.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OtDriver, OtProtocol, OtConnectionConfig, OtTagAddress, OtSubscriptionHandle, OtCommandResult, OtHealth, OtWrite, OnOtSample, OtSample } from "./otDriver";

const TAGS: OtTagAddress[] = [{ tagKey: "t", address: "a", dataType: "float" }];

class SlowDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  disconnectCalls = 0;
  subscriptions = 0;
  closed = 0;
  constructor(private readonly connectMs = 40) {}
  async connect(_c: OtConnectionConfig): Promise<void> {
    await new Promise((r) => setTimeout(r, this.connectMs));
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    return tags.map((t) => ({ tagKey: t.tagKey, raw: 0, value: 0, quality: "good", timestamp: new Date() }));
  }
  async subscribe(_t: OtTagAddress[], _s: OnOtSample, _i?: number): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error("not connected");
    this.subscriptions += 1;
    return { close: async () => void (this.closed += 1) };
  }
  async writeTags(w: OtWrite[]): Promise<OtCommandResult[]> {
    return w.map((x) => ({ tagKey: x.tagKey, ok: true }));
  }
  async health(): Promise<OtHealth> {
    return { protocol: this.protocol, connected: this.connected };
  }
}

const adapter = (id: number, driver: OtDriver) => ({
  adapterId: id,
  code: `A${id}`,
  machineId: 5,
  protocol: "stub" as OtProtocol,
  connection: { endpoint: "primary://x" } as OtConnectionConfig,
  pollIntervalMs: 1000,
  tags: TAGS,
  driver,
  backupConnection: undefined as OtConnectionConfig | undefined,
});

async function loadOt(adapters: unknown[], ha = false, created: SlowDriver[] = []) {
  vi.stubEnv("OT_GATEWAY_ENABLED", "true");
  if (ha) {
    vi.stubEnv("OT_CONN_HA_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_BACKOFF_JITTER", "0");
  }
  vi.doMock("./driverRegistry", () => ({
    createDriver: () => {
      const d = new SlowDriver();
      created.push(d);
      return d;
    },
  }));
  vi.doMock("./ingest", () => ({ ingestSample: async () => undefined }));
  vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => adapters }));
  return import("./otManager");
}

describe("scan #73 — otManager never keeps / re-starts a central session it no longer owns", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("★ stopOt turns the gateway OFF: a later attach (reconcile / NOTIFY) does not re-start a session", async () => {
    const ot = await loadOt([]);
    expect(await ot.startOt()).toBe(false); // 0 central adapters — the gateway is on (R-10-al)
    expect(ot.isOtGatewayOn()).toBe(true);
    await ot.stopOt();
    expect(ot.isOtGatewayOn()).toBe(false);
    const d = new SlowDriver(1);
    expect(await ot.attachOtAdapter(adapter(31, d) as any)).toBe(false);
    expect(ot.getActiveDriver(31)).toBeUndefined();
    expect(d.subscriptions).toBe(0);
  });

  it("★ legacy: a DETACH while the attach is still connecting ⇒ the late session is closed, never registered", async () => {
    const ot = await loadOt([]);
    await ot.startOt();
    const d = new SlowDriver(40);
    const attach = ot.attachOtAdapter(adapter(32, d) as any);
    await new Promise((r) => setTimeout(r, 5));
    await ot.detachOtAdapter(32); // the adapter moved to an edge node — central's session is not visible yet
    expect(await attach).toBe(false);
    expect(ot.getActiveDriver(32)).toBeUndefined(); // the dispatcher finds no driver ⇒ no central write
    expect(d.connected).toBe(false);
    await ot.stopOt();
  });

  it("★ legacy: a DETACH while startOt is still connecting that adapter ⇒ never listed", async () => {
    const d = new SlowDriver(40);
    const ot = await loadOt([adapter(33, d)]);
    const start = ot.startOt();
    await new Promise((r) => setTimeout(r, 5));
    await ot.detachOtAdapter(33);
    await start;
    expect(ot.getActiveDriver(33)).toBeUndefined();
    expect(d.connected).toBe(false);
    await ot.stopOt();
  });

  it("★ HA: a DETACH while the attach's supervisor is starting ⇒ the supervisor is stopped, never registered", async () => {
    const created: SlowDriver[] = [];
    const ot = await loadOt([], true, created);
    await ot.startOt();
    const attach = ot.attachOtAdapter(adapter(34, new SlowDriver(1)) as any);
    await new Promise((r) => setTimeout(r, 5));
    await ot.detachOtAdapter(34);
    expect(await attach).toBe(false);
    expect(ot.getActiveDriver(34)).toBeUndefined();
    expect(ot.getSupervisorStatus(34)).toBeUndefined();
    expect(created.every((d) => !d.connected)).toBe(true);
    await ot.stopOt();
  });
});
