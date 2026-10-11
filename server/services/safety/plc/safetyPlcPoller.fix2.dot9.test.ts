/**
 * doc 81 Đợt 9 Group U fix round 2 (re-review-groupU-report.md N1–N5; security scans "fail-open-liveness",
 * "fail-open-state-drift"):
 *   • N1 — local liveness timers run on a MONOTONIC clock: with the WALL clock stepped back 10 min, a silent subscription and
 *     a frozen PLC heartbeat still go offline within their bounds (real time, production default clocks — no injected clock);
 *   • N3 — a verification read that comes back bad / uncertain / missing while the subscription shows a value ⇒ the item goes
 *     unknown at once (never the cached value) ⇒ error read ⇒ "plc_offline", never "released"; re-subscribe;
 *   • N2 — a driver that cannot verify (no read on the session) is refused (visible fallback), never silently unverified;
 *   • N5 — after a restart the first read is the heartbeat baseline and a frozen heartbeat goes offline at the first read
 *     after maxSilentMs (60 s poll interval: at 60 s, not 180 s).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import type { OpcuaQueuedSink, OpcuaQueuedSubscription } from "../../ot/drivers/opcuaDriver";
import type { OtSample, OtTagAddress } from "../../ot/otDriver";
import { OpcuaSubscriptionSafetyPlcBackend, opcuaDeadAfterMs, SAFETY_PLC_OPCUA_VERIFY_MS, type QueuedSubscriptionDriver } from "./safetyPlcOpcuaSubscription";
import { SafetyPlcPoller } from "./safetyPlcPoller";
import { OtReadSafetyPlcBackend, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import type { RecordSafetyEventInput } from "../safetyAuditService";

vi.setConfig({ testTimeout: 30_000 });
const MAP = { estop: { address: "ns=1;s=ESTOP" }, zoneOccupied: { address: "ns=1;s=GUARD_OK", activeWhen: "falsy" as const } };
const good = (tagKey: string, value: unknown): OtSample => ({ tagKey, raw: value, value: value as never, quality: "good", timestamp: new Date() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WALL_BACK = 10 * 60_000;

interface Fake extends QueuedSubscriptionDriver {
  sink: OpcuaQueuedSink | null;
  verifySample: (t: OtTagAddress) => OtSample;
  subscribes: number;
}
function fakeDriver(o: { noRead?: boolean } = {}): Fake {
  const d: Fake = {
    sink: null,
    subscribes: 0,
    verifySample: (t) => good(t.tagKey, t.tagKey === "zoneOccupied"),
    async connect() {},
    async disconnect() {},
    async subscribeQueued(tags, opts, sink) {
      d.subscribes += 1;
      d.sink = sink;
      queueMicrotask(() => {
        for (const t of tags) sink.onValue(t.tagKey, good(t.tagKey, t.tagKey === "zoneOccupied"), { overflow: false }); // estop false, guard clear
      });
      return {
        publishingIntervalMs: opts.publishingIntervalMs,
        maxKeepAliveCount: opts.maxKeepAliveCount,
        items: tags.map((t) => ({ tagKey: t.tagKey, ok: true, queueSize: opts.queueSize, samplingIntervalMs: opts.samplingIntervalMs })),
        close: async () => undefined,
      } satisfies OpcuaQueuedSubscription;
    },
  } as Fake;
  if (!o.noRead) d.readTags = async (tags: OtTagAddress[]) => tags.map((t) => d.verifySample(t));
  return d;
}

let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined)];
});
afterEach(() => {
  quiet.forEach((q) => q.mockRestore());
  vi.restoreAllMocks();
});

describe("U fix 2 (N1) — a WALL-clock step backwards never suspends liveness", () => {
  it("★ silent subscription (default monotonic clock): wall clock stepped back 10 min ⇒ still dead within its bound", async () => {
    const d = fakeDriver();
    // the wall clock is under the test's control from the start (a captured Date.now reference would see the step too)
    const realNow = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    // NO injected clock: the production default
    const b = new OpcuaSubscriptionSafetyPlcBackend("opc.tcp://127.0.0.1:1", MAP as never, 400, { intervalMs: 250, createDriver: () => d });
    expect((await b.readBatch()).mode).toBe("subscription");
    offset = -WALL_BACK; // the wall clock steps back 10 min
    const bound = opcuaDeadAfterMs(250, 3); // 2500 ms
    await sleep(bound + 200); // no data, no keep-alive
    expect((await b.readBatch()).reads.at(-1)).toEqual({ error: expect.stringMatching(/subscription silent/) });
    await b.close();
  });

  it("★ frozen PLC heartbeat (default monotonic clock): wall clock stepped back 10 min ⇒ still 'plc_offline' after maxSilentMs", async () => {
    const c = {
      id: 291, code: "FX2", name: "fx2", vendor: "pilz", backend: "modbus", endpoint: "tcp://127.0.0.1:1",
      statusMap: { estop: { address: "coil:1" }, heartbeat: { address: "holding:40010", maxSilentMs: 1000 }, pollIntervalMs: 250 },
      robotId: 4, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 2, createdAt: new Date(), updatedAt: new Date(),
    } as SafetyPlcConfig;
    const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, c.statusMap as never, 500);
    (b as unknown as { readChecked: () => Promise<SafetyPlcCheckedRead> }).readChecked = async () => ({ status: { estop: false }, unreadable: [], heartbeat: { value: 7, unreadable: false } });
    const recs: RecordSafetyEventInput[] = [];
    const p = new SafetyPlcPoller({
      loadConfigs: async () => [c],
      backendFor: () => ({ backend: b }),
      recordPlain: async (i) => (recs.push(i), { ok: true, enabled: true }),
      recordTrusted: async (i) => (recs.push(i), { ok: true, enabled: true }),
      isTrustApproved: async () => true,
      leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
      state: { load: async () => null, save: async () => undefined, list: async () => [], claimStaleAlarm: async () => false },
      // NO monoNow: the production default
    });
    await p.refreshConfigs();
    await p.pollNow(291);
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() - WALL_BACK);
    await sleep(1200);
    await p.pollNow(291);
    expect(recs.map((r) => r.eventType)).toEqual(["plc_offline"]);
    expect(String(recs[0].notes)).toMatch(/PLC heartbeat tag unchanged/);
    await p.stop();
  });
});

describe("U fix 2 (N3) — a non-decided verification read never keeps the cached value", () => {
  let clock = 9_000_000;
  const now = () => clock;
  for (const [label, sample] of [
    ["bad quality", (t: OtTagAddress) => ({ tagKey: t.tagKey, raw: undefined, value: null, quality: "bad", timestamp: new Date() }) as OtSample],
    ["uncertain", (t: OtTagAddress) => ({ ...good(t.tagKey, false), quality: "uncertain" }) as OtSample],
    ["unparseable", (t: OtTagAddress) => good(t.tagKey, "abc")],
  ] as const) {
    it(`★ ${label} estop on the verification read while the subscription shows 'released' ⇒ error read AT ONCE, lost, re-subscribe`, async () => {
      clock = 9_000_000;
      const d1 = fakeDriver();
      const d2 = fakeDriver();
      let i = 0;
      const b = new OpcuaSubscriptionSafetyPlcBackend("opc.tcp://127.0.0.1:1", MAP as never, 400, { intervalMs: 1000, createDriver: () => [d1, d2][Math.min(i++, 1)], now });
      await b.readBatch();
      d1.verifySample = (t) => (t.tagKey === "estop" ? sample(t) : good(t.tagKey, true));
      clock += SAFETY_PLC_OPCUA_VERIFY_MS;
      d1.sink!.onAlive();
      const r = await b.readBatch();
      expect(r.reads.at(-1)).toEqual({ error: expect.stringMatching(/verification read of estop not decided .* set unknown, re-baselined/) });
      expect(r.lost).toBe(1);
      expect((await b.readBatch()).mode).toBe("subscription");
      expect(d2.subscribes).toBe(1);
    });
  }

  it("★ at the poller: the cached 'released' is never reported once the fresh read is bad ⇒ 'plc_offline', no 'estop_released'", async () => {
    clock = 9_000_000;
    const d = fakeDriver();
    const c = { id: 292, code: "FX2B", name: "x", vendor: "sick", backend: "opcua", endpoint: "opc.tcp://127.0.0.1:1", statusMap: MAP, robotId: 4, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 2, createdAt: new Date(), updatedAt: new Date() } as SafetyPlcConfig;
    const b = new OpcuaSubscriptionSafetyPlcBackend(c.endpoint!, MAP as never, 400, { intervalMs: 1000, createDriver: () => d, now });
    const recs: string[] = [];
    const p = new SafetyPlcPoller({
      loadConfigs: async () => [c],
      backendFor: () => ({ backend: b }),
      recordPlain: async (i) => (recs.push(i.eventType), { ok: true, enabled: true }),
      recordTrusted: async (i) => (recs.push(i.eventType), { ok: true, enabled: true }),
      isTrustApproved: async () => true,
      leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
      state: { load: async () => null, save: async () => undefined, list: async () => [], claimStaleAlarm: async () => false },
    });
    await p.refreshConfigs();
    await p.pollNow(292);
    d.sink!.onValue("estop", good("estop", true), { overflow: false }); // pressed
    await p.pollNow(292);
    d.verifySample = (t) => (t.tagKey === "estop" ? { tagKey: t.tagKey, raw: undefined, value: null, quality: "bad", timestamp: new Date() } : good(t.tagKey, true));
    clock += SAFETY_PLC_OPCUA_VERIFY_MS;
    d.sink!.onAlive();
    await p.pollNow(292);
    expect(recs).toEqual(["estop", "plc_events_lost", "plc_offline"]);
    await p.stop();
  });
});

describe("U fix 2 (N2) — the verification read is always on", () => {
  it("a driver that cannot read on the session ⇒ subscription refused ⇒ visible fallback", async () => {
    const b = new OpcuaSubscriptionSafetyPlcBackend("opc.tcp://127.0.0.1:1", MAP as never, 400, { intervalMs: 1000, createDriver: () => fakeDriver({ noRead: true }) });
    (b as unknown as { readChecked: () => Promise<unknown> }).readChecked = async () => ({ status: { estop: false, zoneOccupied: false }, unreadable: [] });
    const r = await b.readBatch();
    expect(r.mode).toBe("poll_fallback");
    expect(r.modeReason).toMatch(/cannot verify the subscribed items/);
  });
});

describe("U fix 2 (N5) — after a restart a frozen heartbeat goes offline at the first read after maxSilentMs", () => {
  it("★ 60 s poll interval, maxSilentMs 10 s, heartbeat frozen since before the restart ⇒ offline at the 2nd read (60 s), not 180 s", async () => {
    let t = 0;
    const c = {
      id: 293, code: "FX2C", name: "x", vendor: "pilz", backend: "modbus", endpoint: "tcp://127.0.0.1:1",
      statusMap: { estop: { address: "coil:1" }, heartbeat: { address: "holding:40010", maxSilentMs: 10_000 }, pollIntervalMs: 60_000 },
      robotId: 4, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 2, createdAt: new Date(), updatedAt: new Date(),
    } as SafetyPlcConfig;
    const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, c.statusMap as never, 500);
    (b as unknown as { readChecked: () => Promise<SafetyPlcCheckedRead> }).readChecked = async () => ({ status: { estop: false }, unreadable: [], heartbeat: { value: 42, unreadable: false } });
    const recs: string[] = [];
    const p = new SafetyPlcPoller({
      loadConfigs: async () => [c],
      backendFor: () => ({ backend: b }),
      recordPlain: async (i) => (recs.push(i.eventType), { ok: true, enabled: true }),
      recordTrusted: async (i) => (recs.push(i.eventType), { ok: true, enabled: true }),
      isTrustApproved: async () => true,
      leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
      state: { load: async () => null, save: async () => undefined, list: async () => [], claimStaleAlarm: async () => false },
      monoNow: () => t,
    });
    await p.refreshConfigs();
    await p.pollNow(293); // the restart's first read = the baseline
    expect(recs).toEqual([]);
    t += 60_000;
    await p.pollNow(293);
    expect(recs).toEqual(["plc_offline"]);
    await p.stop();
  });
});
