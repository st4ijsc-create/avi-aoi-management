/**
 * doc 81 Đợt 9 Group U fix round 1 (review-groupU-report.md I2–I4, M1; ruling R-9-e) — against FAKE drivers / scripted
 * backends (the real node-opcua / Modbus paths are covered by the e2e files):
 *   • I2 — the publishing interval requested is ≤ 1 s whatever the poll interval; a server revising the publishing interval
 *     or the keep-alive window beyond the bounds DERIVED from the Đợt 8 stale bound ⇒ visible fallback; a silent
 *     subscription is declared dead within SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS (≤ a third of the smallest stale bound);
 *   • I4 — a stalled item under a live subscription is caught by the bounded verification read (confirmed one publishing
 *     interval later ⇒ lost + error read + re-subscribe; a failed read ⇒ the same); the optional PLC heartbeat tag: frozen /
 *     unreadable ⇒ undecidable ⇒ "plc_offline" (both modes; a subscription counts toggles it saw);
 *   • M1 — a slow refusal + the fallback read fit ONE budget (the poll stays decided — no offline/online flapping) and the
 *     failed attempt's session is released BEFORE the fallback opens one; a release that does not finish ⇒ no second session;
 *   • I3 / R-9-e — a set latch is persisted with "since when", cleared on reset, survives a restart, reaches health.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import type { OpcuaQueuedSink, OpcuaQueuedSubscription } from "../../ot/drivers/opcuaDriver";
import type { OtSample, OtTagAddress } from "../../ot/otDriver";
import {
  OpcuaSubscriptionSafetyPlcBackend,
  opcuaDeadAfterMs,
  SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS,
  SAFETY_PLC_OPCUA_MAX_KEEPALIVE_WINDOW_MS,
  SAFETY_PLC_OPCUA_VERIFY_MS,
  type QueuedSubscriptionDriver,
} from "./safetyPlcOpcuaSubscription";
import { SafetyPlcPoller } from "./safetyPlcPoller";
import { OtReadSafetyPlcBackend, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import { configStaleAfterMs, evaluatePollerHealth, type PollStateRow } from "./safetyPlcPollerHealth";
import type { RecordSafetyEventInput } from "../safetyAuditService";

const MAP = { estop: { address: "ns=1;s=ESTOP" }, zoneOccupied: { address: "ns=1;s=GUARD_OK", activeWhen: "falsy" as const } };
const good = (tagKey: string, value: unknown): OtSample => ({ tagKey, raw: value, value: value as never, quality: "good", timestamp: new Date() });

interface Fake extends QueuedSubscriptionDriver {
  sink: OpcuaQueuedSink | null;
  log: string[];
  opts: Array<{ publishingIntervalMs: number; queueSize: number }>;
  serverValues: Record<string, unknown>;
}
function fakeDriver(o: { publishing?: number; keepAlive?: number; subscribeDelayMs?: number; failSubscribe?: string; readFails?: boolean; disconnectHang?: boolean; hb?: boolean } = {}): Fake {
  const d: Fake = {
    sink: null,
    log: [],
    opts: [],
    serverValues: { estop: false, zoneOccupied: true },
    async connect() {
      d.log.push("connect");
    },
    async disconnect() {
      d.log.push("disconnect");
      if (o.disconnectHang) await new Promise(() => undefined);
    },
    async readTags(tags: OtTagAddress[]) {
      d.log.push("verify");
      if (o.readFails) throw new Error("BadSessionClosed");
      return tags.map((t) => good(t.tagKey, d.serverValues[t.tagKey]));
    },
    async subscribeQueued(tags, opts, sink) {
      d.log.push("subscribe");
      d.opts.push(opts);
      if (o.subscribeDelayMs) await new Promise((r) => setTimeout(r, o.subscribeDelayMs));
      if (o.failSubscribe) throw new Error(o.failSubscribe);
      d.sink = sink;
      queueMicrotask(() => {
        for (const t of tags) sink.onValue(t.tagKey, good(t.tagKey, t.tagKey === "heartbeat" ? 1 : d.serverValues[t.tagKey]), { overflow: false });
      });
      return {
        publishingIntervalMs: o.publishing ?? opts.publishingIntervalMs,
        maxKeepAliveCount: o.keepAlive ?? opts.maxKeepAliveCount,
        items: tags.map((t) => ({ tagKey: t.tagKey, ok: true, queueSize: opts.queueSize, samplingIntervalMs: opts.samplingIntervalMs })),
        close: async () => void d.log.push("close"),
      } satisfies OpcuaQueuedSubscription;
    },
  };
  return d;
}

let clock = 5_000_000;
const now = () => clock;
function backend(drivers: Fake[], o: { timeoutMs?: number; intervalMs?: number; map?: object } = {}) {
  let i = 0;
  const b = new OpcuaSubscriptionSafetyPlcBackend("opc.tcp://127.0.0.1:1", (o.map ?? MAP) as never, o.timeoutMs ?? 400, {
    intervalMs: o.intervalMs ?? 1000,
    createDriver: () => drivers[Math.min(i++, drivers.length - 1)],
    now,
  });
  const polls: string[] = [];
  (b as unknown as { readChecked: (x?: { timeoutMs?: number }) => Promise<unknown> }).readChecked = async (x) => {
    polls.push(`poll(${x?.timeoutMs ?? "-"})`);
    for (const d of drivers) d.log.push("pollRead");
    return { status: { estop: false, zoneOccupied: false }, unreadable: [] };
  };
  return { b, polls };
}

let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  clock = 5_000_000;
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined)];
});
afterEach(() => {
  quiet.forEach((q) => q.mockRestore());
  vi.restoreAllMocks();
});

describe("U fix 1 (I2) — the silence window is bounded by the Đợt 8 stale bound", () => {
  it("the bounds are derived from the stale bound: dead ≤ ⅓ of the smallest stale bound; keep-alive window fits twice + 1 s", () => {
    expect(configStaleAfterMs(0)).toBe(60_000);
    expect(SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS).toBe(20_000);
    expect(2 * SAFETY_PLC_OPCUA_MAX_KEEPALIVE_WINDOW_MS + 1000).toBeLessThanOrEqual(SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS);
    for (const [p, k] of [[1000, 3], [5000, 3], [60_000, 10]] as const) expect(opcuaDeadAfterMs(p, k)).toBeLessThanOrEqual(SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS);
    for (const interval of [250, 1000, 10_000, 60_000]) expect(SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS).toBeLessThan(configStaleAfterMs(interval));
  });

  it("★ a 10 s poll interval still requests a 1 s publishing interval (queue sized for it)", async () => {
    const d = fakeDriver();
    const { b } = backend([d], { intervalMs: 10_000 });
    expect((await b.readBatch()).mode).toBe("subscription");
    expect(d.opts[0]).toMatchObject({ publishingIntervalMs: 1000, queueSize: 24 });
  });

  it("★ the server revises the publishing interval to 5 s ⇒ refused ⇒ visible fallback", async () => {
    const r = await backend([fakeDriver({ publishing: 5000 })]).b.readBatch();
    expect(r.mode).toBe("poll_fallback");
    expect(r.modeReason).toMatch(/publishing interval to 5000 ms/);
  });

  it("★ the server revises the keep-alive window beyond the bound (1 s × 10) ⇒ refused; 1 s × 9 is accepted", async () => {
    const r = await backend([fakeDriver({ keepAlive: 10 })]).b.readBatch();
    expect(r.mode).toBe("poll_fallback");
    expect(r.modeReason).toMatch(/keep-alive window to 10000 ms/);
    expect((await backend([fakeDriver({ keepAlive: 9 })]).b.readBatch()).mode).toBe("subscription");
  });

  it("★ silent subscription with a 60 s poll interval ⇒ dead after 2 × (1 s × 3) + 1 s = 7 s (was 2 × 60 s × 3 + 1 s), never above 20 s", async () => {
    const d = fakeDriver();
    const { b } = backend([d, fakeDriver()], { intervalMs: 60_000 });
    await b.readBatch();
    clock += 6900;
    expect((await b.readBatch()).reads[0]).not.toHaveProperty("error");
    clock += 200;
    expect((await b.readBatch()).reads.at(-1)).toEqual({ error: expect.stringMatching(/subscription silent for 7100 ms .*bound 7000 ms/) });
    expect(opcuaDeadAfterMs(60_000, 3)).toBe(SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS); // even if a server granted 60 s: capped
  });
});

describe("U fix 1 (I4) — a stalled item under a live subscription is detected by the verification read", () => {
  it("★ the server reads ESTOP pressed but the subscription never said so: confirmed one publishing interval later ⇒ lost + error + re-subscribe", async () => {
    const d1 = fakeDriver();
    const d2 = fakeDriver();
    const { b } = backend([d1, d2]);
    await b.readBatch();
    d1.serverValues.estop = true; // the item stalled: no notification arrives
    clock += SAFETY_PLC_OPCUA_VERIFY_MS;
    d1.sink!.onAlive(); // keep-alives keep coming
    const first = await b.readBatch();
    expect(first.reads[0]).not.toHaveProperty("error"); // maybe in flight: look again one publishing interval later
    clock += 1500;
    d1.sink!.onAlive();
    const second = await b.readBatch();
    expect(second.reads.at(-1)).toEqual({ error: expect.stringMatching(/stalled: estop read differently/) });
    expect(second.lost).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(d1.log).toContain("disconnect");
    expect((await b.readBatch()).mode).toBe("subscription");
    expect(d2.log).toContain("subscribe");
  });

  it("a change in flight (the notification arrives before the second look) is NOT a stall", async () => {
    const d = fakeDriver();
    const { b } = backend([d]);
    await b.readBatch();
    d.serverValues.estop = true;
    clock += SAFETY_PLC_OPCUA_VERIFY_MS;
    d.sink!.onAlive();
    await b.readBatch();
    d.sink!.onValue("estop", good("estop", true), { overflow: false }); // the notification arrives
    clock += 1500;
    d.sink!.onAlive();
    const r = await b.readBatch();
    expect(r.reads.every((x) => !("error" in x))).toBe(true);
    expect(r.lost).toBe(0);
  });

  it("★ a failed verification read ⇒ error read + re-subscribe (fail closed)", async () => {
    const d = fakeDriver({ readFails: true });
    const { b } = backend([d, fakeDriver()]);
    await b.readBatch();
    clock += SAFETY_PLC_OPCUA_VERIFY_MS;
    d.sink!.onAlive();
    expect((await b.readBatch()).reads.at(-1)).toEqual({ error: expect.stringMatching(/verification read failed/) });
  });

  it("consistent verification ⇒ nothing; the next one is 10 s later", async () => {
    const d = fakeDriver();
    const { b } = backend([d]);
    await b.readBatch();
    clock += SAFETY_PLC_OPCUA_VERIFY_MS;
    d.sink!.onAlive();
    await b.readBatch();
    clock += 1000;
    d.sink!.onAlive();
    await b.readBatch();
    expect(d.log.filter((x) => x === "verify")).toHaveLength(1);
  });
});

describe("U fix 1 (M1) — retry + fallback fit one budget, never two sessions", () => {
  it("★ a server that refuses SLOWLY (≈ half the budget): the poll is still DECIDED (fallback read in the same budget), the attempt's session released first", async () => {
    const d = fakeDriver({ subscribeDelayMs: 150, failSubscribe: "BadTooManySubscriptions" });
    const { b, polls } = backend([d], { timeoutMs: 400 }); // budget 360: subscribe ≤ 180
    const t0 = Date.now();
    const r = await b.readBatch();
    expect(Date.now() - t0).toBeLessThan(400);
    expect(r.mode).toBe("poll_fallback");
    expect(r.reads[0]).not.toHaveProperty("error");
    expect(polls).toHaveLength(1);
    expect(d.log.indexOf("disconnect")).toBeGreaterThan(-1);
    expect(d.log.indexOf("disconnect")).toBeLessThan(d.log.indexOf("pollRead")); // released BEFORE the fallback session
  });

  it("★ the failed attempt's release does not finish ⇒ NO fallback read in that poll (no second session)", async () => {
    const d = fakeDriver({ failSubscribe: "refused", disconnectHang: true });
    const { b, polls } = backend([d], { timeoutMs: 400 });
    const r = await b.readBatch();
    expect(r.reads).toEqual([{ error: expect.stringMatching(/still closing — no second session/) }]);
    expect(polls).toHaveLength(0);
    const r2 = await b.readBatch(); // still not released ⇒ still no second session
    expect(r2.reads).toEqual([{ error: expect.stringMatching(/still closing/) }]);
    expect(polls).toHaveLength(0);
  });

  it("★ a HUNG subscribe attempt is cut at half the budget: the batch returns within the budget (the poller's race never drops it), no second session", async () => {
    const d = fakeDriver({ subscribeDelayMs: 60_000 });
    const { b, polls } = backend([d], { timeoutMs: 400 }); // budget 360 ⇒ the attempt gets 180
    const t0 = Date.now();
    const r = await b.readBatch();
    expect(Date.now() - t0).toBeLessThan(360);
    expect(r.mode).toBe("poll_fallback");
    expect(r.reads).toEqual([{ error: expect.stringMatching(/still closing — no second session/) }]); // the attempt has not settled
    expect(polls).toHaveLength(0);
  });

  it("the fallback read gets what is left of the budget (its connect bound), never the full read bound", async () => {
    const { b, polls } = backend([fakeDriver({ failSubscribe: "x" })], { timeoutMs: 1000 });
    await b.readBatch();
    const ms = Number(/poll\((\d+)\)/.exec(polls[0])?.[1]);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(900); // the 90 % budget, minus what the attempt used
  });
});

function cfg(over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id: 191, code: "FX1", name: "fx1", vendor: "pilz", backend: "modbus", endpoint: "tcp://127.0.0.1:1",
    statusMap: { estop: { address: "coil:1" }, estopLatch: { address: "discrete:3" }, heartbeat: { address: "holding:40010", maxSilentMs: 1000 } },
    robotId: 4, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 2, createdAt: new Date(), updatedAt: new Date(), ...over,
  } as SafetyPlcConfig;
}
type Step = { estop?: boolean; latch?: boolean; hb?: number | "bad" };
function scripted(c: SafetyPlcConfig, steps: Step[]) {
  const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, c.statusMap as never, 500);
  const asked: Array<Record<string, unknown> | undefined> = [];
  let i = 0;
  (b as unknown as { readChecked: (o?: Record<string, unknown>) => Promise<SafetyPlcCheckedRead> }).readChecked = async (o) => {
    asked.push(o);
    const s = steps[Math.min(i++, steps.length - 1)];
    const r: SafetyPlcCheckedRead = { status: { estop: s.estop === true }, unreadable: [] };
    if (o?.withLatch) r.latch = { estopLatch: s.latch === true, unreadable: false };
    if (o?.withHeartbeat) r.heartbeat = s.hb === "bad" || s.hb === undefined ? { unreadable: true } : { value: s.hb, unreadable: false };
    return r;
  };
  return { b, asked };
}
function mk(c: SafetyPlcConfig, steps: Step[], durable: PollStateRow | null = null) {
  const recs: Array<{ input: RecordSafetyEventInput }> = [];
  const saves: PollStateRow[] = [];
  const { b, asked } = scripted(c, steps);
  const p = new SafetyPlcPoller({
    loadConfigs: async () => [c],
    backendFor: () => ({ backend: b }),
    recordPlain: async (i) => (recs.push({ input: i }), { ok: true, enabled: true }),
    recordTrusted: async (i) => (recs.push({ input: i }), { ok: true, enabled: true }),
    isTrustApproved: async () => true,
    leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
    state: { load: async () => durable, save: async (r) => void saves.push(JSON.parse(JSON.stringify(r))), list: async () => [], claimStaleAlarm: async () => false },
  });
  return { p, recs, saves, asked };
}
const types = (recs: Array<{ input: RecordSafetyEventInput }>) => recs.map((r) => r.input.eventType);

describe("U fix 1 (I4) — the optional PLC heartbeat tag (a value frozen at the source)", () => {
  it("★ heartbeat keeps changing ⇒ normal; frozen beyond its bound ⇒ 'plc_offline' (reason names the heartbeat); changing again ⇒ back online", async () => {
    let t = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const { p, recs, asked } = mk(cfg(), [{ hb: 1 }, { hb: 2 }, { hb: 2 }, { hb: 2 }, { hb: 3 }, { hb: 4 }, { hb: 5 }]);
    await p.refreshConfigs();
    for (const dt of [0, 1000, 1000, 2500, 1000, 1000, 1000]) {
      t += dt;
      await p.pollNow(191);
    }
    expect(asked[0]).toMatchObject({ withHeartbeat: true, withLatch: true });
    expect(types(recs)).toEqual(["plc_offline", "plc_online"]);
    expect(String(recs[0].input.notes)).toMatch(/PLC heartbeat tag unchanged for 4 s \(bound 3 s\)/); // never below 3 poll intervals
  });

  it("heartbeat unreadable ⇒ 'plc_offline', never ok", async () => {
    const { p, recs } = mk(cfg(), [{ hb: 1 }, { hb: "bad" }]);
    await p.refreshConfigs();
    await p.pollNow(191);
    await p.pollNow(191);
    expect(types(recs)).toEqual(["plc_offline"]);
    expect(String(recs[0].input.notes)).toMatch(/heartbeat tag unreadable/);
  });

  it("no heartbeat mapped ⇒ not asked, never offline for it", async () => {
    const c = cfg({ statusMap: { estop: { address: "coil:1" } } as never });
    const { p, recs, asked } = mk(c, [{}, {}]);
    await p.refreshConfigs();
    await p.pollNow(191);
    await p.pollNow(191);
    expect(asked[0]).toBeUndefined();
    expect(recs).toEqual([]);
  });

  it("subscription mode: a heartbeat toggling back to the SAME value between polls still counts as alive (changes counted)", async () => {
    const d = fakeDriver();
    const map = { ...MAP, heartbeat: { address: "ns=1;s=HB", dataType: "bool" } };
    const { b } = backend([d], { map });
    const first = await b.readBatch();
    expect((first.reads.at(-1) as SafetyPlcCheckedRead).heartbeat).toMatchObject({ value: 1, unreadable: false });
    d.sink!.onValue("heartbeat", good("heartbeat", 2), { overflow: false });
    d.sink!.onValue("heartbeat", good("heartbeat", 1), { overflow: false });
    const r = await b.readBatch();
    expect(r.reads).toHaveLength(1); // heartbeat changes are liveness, not transitions
    expect((r.reads[0] as SafetyPlcCheckedRead).heartbeat).toEqual({ value: 1, unreadable: false, changes: 2 });
  });
});

describe("U fix 1 (I3 / R-9-e) — a set latch is persisted with 'since when' and reaches health", () => {
  it("★ latch rises ⇒ latchSetAt persisted (first value kept while set); reset ⇒ null", async () => {
    let t = 2_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const c = cfg({ statusMap: { estop: { address: "coil:1" }, estopLatch: { address: "discrete:3" } } as never });
    const { p, saves } = mk(c, [{}, { latch: true }, { latch: true }, {}]);
    await p.refreshConfigs();
    await p.pollNow(191);
    expect(saves.at(-1)?.latchSetAt).toBeNull();
    t += 1000;
    await p.pollNow(191);
    expect(saves.at(-1)?.latchSetAt).toBe(2_001_000);
    t += 6000;
    await p.pollNow(191);
    expect(saves.at(-1)?.latchSetAt).toBe(2_001_000);
    t += 1000;
    await p.pollNow(191);
    expect(saves.at(-1)?.latchSetAt).toBeNull();
  });

  it("a restart with the latch still set keeps its durable 'since'", async () => {
    const c = cfg({ statusMap: { estop: { address: "coil:1" }, estopLatch: { address: "discrete:3" } } as never });
    const { plcTrustDigest } = await import("./safetyPlcTrust");
    const durable: PollStateRow = { configId: 191, link: "online", flags: { estop: false, estopLatch: true }, intervalMs: 1000, lastAttemptAt: null, lastOkAt: null, identityDigest: plcTrustDigest(c), latchSetAt: 1234 };
    const { p, saves, recs } = mk(c, [{ latch: true }], durable);
    await p.refreshConfigs();
    await p.pollNow(191);
    expect(recs).toEqual([]);
    expect(saves.at(-1)?.latchSetAt).toBe(1234);
  });

  it("health: latchedConfigs + per-config latchSetAt; the state stays as before (a degradation, not blindness)", () => {
    const now = 10_000_000;
    const h = evaluatePollerHealth(
      [{ id: 1, code: "A", factoryId: null }, { id: 2, code: "B", factoryId: null }],
      [
        { configId: 1, link: "online", flags: { estopLatch: true }, intervalMs: 1000, lastAttemptAt: now, lastOkAt: now, latchSetAt: now - 5000 },
        { configId: 2, link: "online", flags: {}, intervalMs: 1000, lastAttemptAt: now, lastOkAt: now, latchSetAt: null },
      ],
      now,
      { enabled: true },
    );
    expect(h.state).toBe("ok");
    expect(h.latchedConfigs).toBe(1);
    expect(h.configs.map((c) => c.latchSetAt)).toEqual([now - 5000, null]);
  });
});
