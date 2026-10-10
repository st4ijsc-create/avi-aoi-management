/**
 * doc 81 Đợt 4 Task B3 (QĐ-4b) — "đặt lại phiên driver" đi qua đường nối lại SẴN CÓ, có hạn.
 *
 *   • ConnectionSupervisor.resetSession: hạ phiên đang chạy, mở phiên MỚI trên CÙNG endpoint (attemptCycle — không
 *     có đường nối lại thứ hai); đang có vòng nối lại / chưa nối ⇒ false; connect treo ⇒ trả trong hạn nối.
 *   • otManager.resetAdapterSession: HA ⇒ qua supervisor; legacy ⇒ đúng các bước của watchdog legacy.
 *
 * Driver giả MÔ HÌNH HOÁ PHIÊN: mỗi connect() mở phiên số mới; disconnect() đóng phiên và LÀM HỎNG mọi lệnh ghi còn
 * treo trên phiên đó (như socket bị huỷ). Oracle = số phiên + nhật ký ghi do driver giả tự giữ.
 * Treo đo bằng hạn giờ tường minh.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OtDriver, OtProtocol, OtConnectionConfig, OtTagAddress, OtSample, OtSubscriptionHandle, OtCommandResult, OtHealth, OtWrite } from "./otDriver";
import { ConnectionSupervisor } from "./connectionSupervisor";

const never = <T>() => new Promise<T>(() => undefined);
async function settleWithin<T>(p: Promise<T>, ms: number): Promise<{ settled: boolean; value?: T; elapsed: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<{ settled: false }>((r) => {
    timer = setTimeout(() => r({ settled: false }), ms);
  });
  try {
    const out = await Promise.race([p.then((value) => ({ settled: true as const, value })), guard]);
    return { ...out, elapsed: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

class SessionDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  session = 0;
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  /** connect() waits on this before succeeding (null = immediate). */
  connectGate: Promise<void> | null = null;
  /** fix scan (1) — disconnect() marks the session closed but never returns (a stuck close). */
  hangDisconnect = false;
  private hung: Array<{ session: number; reject: (e: Error) => void }> = [];
  async connect(_cfg: OtConnectionConfig): Promise<void> {
    this.connectCalls += 1;
    if (this.connectGate) await this.connectGate;
    this.session += 1;
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
    const s = this.session;
    for (const h of this.hung.filter((x) => x.session === s)) h.reject(new Error(`session ${s} closed`));
    this.hung = this.hung.filter((x) => x.session !== s);
    if (this.hangDisconnect) await never<void>();
  }
  isConnected(): boolean {
    return this.connected;
  }
  async readTags(_t: OtTagAddress[]): Promise<OtSample[]> {
    return [];
  }
  async subscribe(): Promise<OtSubscriptionHandle> {
    return { close: async () => undefined };
  }
  /** A write that never answers on its own (only a session close ends it). */
  writeTags(_w: OtWrite[]): Promise<OtCommandResult[]> {
    const session = this.session;
    return new Promise((_res, reject) => this.hung.push({ session, reject }));
  }
  async health(): Promise<OtHealth> {
    return { protocol: this.protocol, connected: this.connected };
  }
}

function makeSup(driver: SessionDriver, connectTimeoutMs = 400, disconnectTimeoutMs = 200) {
  return new ConnectionSupervisor({
    adapterId: 9,
    code: "B3",
    protocol: "stub",
    tags: [{ tagKey: "t", address: "a", dataType: "int" }],
    pollIntervalMs: 60_000,
    healthIntervalMs: 60_000,
    endpoints: [{ label: "primary", connection: { endpoint: "stub://x" } }],
    createDriver: () => driver,
    onSample: () => undefined,
    backoff: { initialMs: 50, maxMs: 100, factor: 2, jitter: 0 },
    linkLossFailThreshold: 1,
    connectTimeoutMs,
    disconnectTimeoutMs,
  });
}

describe("B3 — ConnectionSupervisor.resetSession", () => {
  it("★ connected ⇒ the hung write's session is closed (write rejected) and a NEW session is connected", async () => {
    const d = new SessionDriver();
    const sup = makeSup(d);
    await sup.start();
    expect(d.session).toBe(1);
    const hung = d.writeTags([]);
    const hungOutcome = hung.then(() => "resolved", (e: Error) => e.message);
    const r = await settleWithin(sup.resetSession("test reset"), 2000);
    expect(r).toMatchObject({ settled: true, value: true });
    expect(await hungOutcome).toBe("session 1 closed");
    expect(d.session).toBe(2);
    expect(sup.getActiveDriver()).toBe(d);
    expect(sup.status()).toMatchObject({ state: "connected", reconnects: 1, failovers: 0 });
    await sup.stop();
  });

  it("not connected yet / stopped ⇒ false, nothing touched", async () => {
    const d = new SessionDriver();
    const sup = makeSup(d);
    expect(await sup.resetSession("x")).toBe(false); // idle
    expect(d.connectCalls).toBe(0);
    await sup.start();
    await sup.stop();
    expect(await sup.resetSession("x")).toBe(false);
  });

  it("★ the new connect HANGS ⇒ resetSession returns false within disconnect + connect deadline (bounded)", async () => {
    const d = new SessionDriver();
    const sup = makeSup(d, 300);
    await sup.start();
    d.connectGate = never<void>();
    const r = await settleWithin(sup.resetSession("hang"), 1500);
    expect(r.settled).toBe(true);
    expect(r.value).toBe(false);
    expect(sup.getActiveDriver()).toBeUndefined(); // no stale session is offered
    expect(sup.resetBoundMs()).toBe(300);
    await sup.stop();
  });

  it("★ fix scan (1) COOPERATIVE: disconnect AND connect hang ⇒ resetSession gives up within ITS budget (resetBoundMs), all steps included", async () => {
    const d = new SessionDriver();
    const sup = makeSup(d, 300); // connect deadline 300 ms, disconnect timeout 200 ms
    await sup.start();
    d.hangDisconnect = true;
    let open!: () => void;
    d.connectGate = new Promise<void>((r) => (open = r));
    const budget = sup.resetBoundMs();
    expect(budget).toBe(300);
    const r = await settleWithin(sup.resetSession("hang both"), 2000);
    expect(r.value).toBe(false);
    expect(r.elapsed).toBeLessThanOrEqual(budget + 120); // the reset itself is over when its bound is
    expect(sup.status().state).toBe("failed");
    // A connect that lands AFTER the budget is never made active (the late-connect reaper closes it).
    const before = d.disconnectCalls;
    open();
    await new Promise((res) => setTimeout(res, 30));
    expect(d.disconnectCalls).toBeGreaterThan(before);
    await sup.stop();
  });

  it("fix scan (1) — a disconnect timeout LONGER than the budget still cannot push the reset past its budget", async () => {
    const d = new SessionDriver();
    const sup = makeSup(d, 300, 2000);
    await sup.start();
    d.hangDisconnect = true;
    d.connectGate = never<void>();
    const r = await settleWithin(sup.resetSession("long disconnect"), 3000);
    expect(r.value).toBe(false);
    expect(r.elapsed).toBeLessThanOrEqual(300 + 120);
    d.hangDisconnect = false;
    await sup.stop();
  });

  it("a reconnect cycle already running ⇒ false (single-flight, no stacked connect)", async () => {
    const d = new SessionDriver();
    const sup = makeSup(d);
    await sup.start();
    let open!: () => void;
    d.connectGate = new Promise<void>((r) => (open = r));
    const first = sup.resetSession("first");
    expect(await sup.resetSession("second")).toBe(false);
    open();
    expect(await first).toBe(true);
    expect(d.connectCalls).toBe(2); // start + ONE reset
    await sup.stop();
  });
});

describe("B3 — otManager.resetAdapterSession (existing reconnect paths)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function fixture(adapterId: number, driver: OtDriver) {
    return {
      adapterId,
      code: `A${adapterId}`,
      machineId: 5,
      protocol: "stub" as OtProtocol,
      connection: { endpoint: "primary://x" } as OtConnectionConfig,
      pollIntervalMs: 60_000,
      tags: [{ tagKey: "t", address: "a", dataType: "float" }] as OtTagAddress[],
      driver,
      backupConnection: undefined as OtConnectionConfig | undefined,
    };
  }

  it("★ legacy (HA off): the adapter's own driver gets a fresh session; getActiveDriver still resolves it", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    const d = new SessionDriver();
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [fixture(20, d)] }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined }));
    const ot = await import("./otManager");
    expect(await ot.startOt()).toBe(true);
    expect(d.session).toBe(1);
    const hung = d.writeTags([]).then(() => "resolved", (e: Error) => e.message);
    const r = await settleWithin(ot.resetAdapterSession(20, "B3 test"), 3000);
    expect(r.value).toEqual({ reset: true, via: "legacy" });
    expect(await hung).toBe("session 1 closed");
    expect(d.session).toBe(2);
    expect(ot.getActiveDriver(20)).toBe(d);
    expect(ot.getOtAdapterStatus(20)?.state).toBe("active");
    expect(ot.adapterSessionResetBoundMs(20)).toBe(ot.effectiveAdapterStartTimeoutMs({}));
    expect(await ot.resetAdapterSession(999, "x")).toMatchObject({ reset: false, via: "none" });
    await ot.stopOt();
  });

  it("★ fix scan (1) COOPERATIVE legacy: disconnect AND connect hang ⇒ resetAdapterSession gives up within the budget it is given", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    const d = new SessionDriver();
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [fixture(21, d)] }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined }));
    const ot = await import("./otManager");
    expect(await ot.startOt()).toBe(true);
    d.hangDisconnect = true;
    d.connectGate = never<void>();
    const r = await settleWithin(ot.resetAdapterSession(21, "hang both", 400), 3000);
    expect(r.settled).toBe(true);
    expect(r.value).toMatchObject({ reset: false, via: "legacy" });
    expect(r.elapsed).toBeLessThanOrEqual(400 + 150);
    expect(ot.getActiveDriver(21)).toBeUndefined();
    d.hangDisconnect = false;
    await ot.stopOt();
  });

  it("★ HA on: the reset goes through the supervisor (same driver, new session)", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_ENABLED", "true");
    const created: SessionDriver[] = [];
    vi.doMock("./driverRegistry", () => ({
      createDriver: () => {
        const m = new SessionDriver();
        created.push(m);
        return m;
      },
    }));
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [fixture(30, new SessionDriver())] }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined }));
    const ot = await import("./otManager");
    expect(await ot.startOt()).toBe(true);
    const [d] = created;
    expect(ot.getActiveDriver(30)).toBe(d);
    const hung = d.writeTags([]).then(() => "resolved", (e: Error) => e.message);
    const r = await settleWithin(ot.resetAdapterSession(30, "B3 test"), 3000);
    expect(r.value).toEqual({ reset: true, via: "supervisor" });
    expect(await hung).toBe("session 1 closed");
    expect(d.session).toBe(2);
    expect(ot.getActiveDriver(30)).toBe(d);
    expect(ot.getSupervisorStatus(30)).toMatchObject({ state: "connected", reconnects: 1 });
    await ot.stopOt();
  });
});
