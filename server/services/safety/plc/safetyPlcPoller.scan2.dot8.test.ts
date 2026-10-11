/**
 * doc 81 Đợt 8 task N fix scan 2 (security scan "fail-open state drift / safety monitoring blinding", ruling R-8-b): LOSS
 * OF MONITORING is itself a safety-relevant state — visible and fail-safe.
 *   (a) the leader persists a heartbeat (per config: last attempt / last decided read); ANY instance's watchdog turns "no
 *       heartbeat" / "no attempt within N × interval" into an explicit "monitoring stale" state and ONE alarm per episode
 *       (cluster-wide compare-and-set); no await of the poll chain is unbounded (a hung insert / approval lookup);
 *   (b) failed inserts never DROP transitions: a bounded per-config queue, oldest dropped on overflow, and ONE
 *       "events lost" marker recorded (first) when the DB is back;
 *   (c) carrying state across an edit never suppresses a NEW trip;
 *   (d) an unknown period followed by a trip still records the trip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import type { SafetyPlcConfig, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import { SafetyPlcPoller, SAFETY_PLC_EVENT_QUEUE_MAX } from "./safetyPlcPoller";
import {
  evaluatePollerHealth,
  runPollerWatchdogOnce,
  configStaleAfterMs,
  SAFETY_PLC_HEARTBEAT_STALE_MS,
  type PollerHeartbeat,
  type PollerHealthStore,
} from "./safetyPlcPollerHealth";
import { OtReadSafetyPlcBackend, type SafetyPlcBackendReader, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import type { RecordSafetyEventInput } from "../safetyAuditService";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LEADER = { acquire: async () => true, held: async () => true, release: async () => undefined };

function cfg(over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id: 1, code: "S2", name: "s2", vendor: "pilz", backend: "modbus", endpoint: "tcp://192.0.2.90:502",
    statusMap: { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" }, pollIntervalMs: 250 },
    robotId: 3, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 7,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  } as SafetyPlcConfig;
}
type Step = SafetyPlcStatusSnapshot | "fail";
function scripted(c: SafetyPlcConfig, steps: Step[]) {
  const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, c.statusMap as never, 500);
  const box = { i: 0, steps };
  (b as unknown as { readChecked: () => Promise<SafetyPlcCheckedRead> }).readChecked = async () => {
    const s = box.steps[Math.min(box.i++, box.steps.length - 1)];
    if (s === "fail") throw new Error("ECONNREFUSED");
    return { status: { estop: !!s.estop, zoneOccupied: !!s.zoneOccupied }, unreadable: [] };
  };
  return b;
}
function memStore(): PollerHealthStore & { hb: PollerHeartbeat | null; claims: Map<string, string>; writes: number } {
  const st = {
    hb: null as PollerHeartbeat | null,
    claims: new Map<string, string>(),
    writes: 0,
    async readHeartbeat() {
      return st.hb;
    },
    async writeHeartbeat(h: PollerHeartbeat) {
      st.writes += 1;
      st.hb = h;
    },
    async claimAlarm(scope: string, episode: string) {
      if (st.claims.get(scope) === episode) return false;
      st.claims.set(scope, episode);
      return true;
    },
  };
  return st;
}

const pollers: SafetyPlcPoller[] = [];
const ENV = ["SAFETY_PLC_POLLER_ENABLED", "SAFETY_PLC_ADAPTER_ENABLED", "SAFETY_AUDIT_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, { SAFETY_PLC_POLLER_ENABLED: "true", SAFETY_PLC_ADAPTER_ENABLED: "true", SAFETY_AUDIT_ENABLED: "true" });
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "error").mockImplementation(() => undefined)];
});
afterEach(async () => {
  while (pollers.length) await pollers.pop()!.stop();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  quiet.forEach((q) => q.mockRestore());
});

function mk(c: () => SafetyPlcConfig[], backend: (c: SafetyPlcConfig) => SafetyPlcBackendReader, extra: Record<string, unknown> = {}) {
  const recs: string[] = [];
  const ok = async (i: RecordSafetyEventInput) => (recs.push(String(i.eventType)), { ok: true, enabled: true });
  const p = new SafetyPlcPoller({
    loadConfigs: async () => c(),
    backendFor: (x) => ({ backend: backend(x) }),
    recordPlain: ok,
    recordTrusted: ok,
    isTrustApproved: async () => true,
    leader: LEADER,
    ...extra,
  });
  pollers.push(p);
  return { p, recs };
}

describe("(a) monitoring health — explicit 'stale', never 'healthy silence'", () => {
  const now = 1_900_000_000_000;
  const hb = (over: Partial<PollerHeartbeat> = {}): PollerHeartbeat => ({
    v: 1, at: now - 1000, instance: "i1",
    configs: [{ id: 1, code: "S2", factoryId: 7, intervalMs: 1000, since: now - 600_000, lastAttemptAt: now - 2000, lastOkAt: now - 2000, link: "online" }],
    ...over,
  });

  it("poller flag off ⇒ 'off'; heartbeat unreadable ⇒ 'unknown' (not ok)", () => {
    expect(evaluatePollerHealth(hb(), now, { enabled: false }).state).toBe("off");
    expect(evaluatePollerHealth("error", now, { enabled: true }).state).toBe("unknown");
  });

  it("★ no heartbeat at all ⇒ STALE (scope global, episode 'never')", () => {
    const h = evaluatePollerHealth(null, now, { enabled: true });
    expect(h.state).toBe("stale");
    expect(h.staleScopes).toEqual([expect.objectContaining({ scope: "global", episode: "never" })]);
  });

  it("★ heartbeat older than 3 refreshes ⇒ STALE (the leader stopped or hangs)", () => {
    const h = evaluatePollerHealth(hb({ at: now - SAFETY_PLC_HEARTBEAT_STALE_MS - 1 }), now, { enabled: true });
    expect(h.state).toBe("stale");
    expect(h.leaderAlive).toBe(false);
    expect(h.staleScopes[0]).toMatchObject({ scope: "global" });
  });

  it("★ fresh heartbeat but one config not attempted within 4 × max(interval, 15 s) ⇒ that config STALE", () => {
    const lim = configStaleAfterMs(1000);
    expect(lim).toBe(60_000);
    const h = evaluatePollerHealth(hb({ configs: [{ id: 1, code: "S2", factoryId: 7, intervalMs: 1000, since: now - 600_000, lastAttemptAt: now - lim - 1, lastOkAt: now - lim - 1, link: "online" }] }), now, { enabled: true });
    expect(h.state).toBe("stale");
    expect(h.configs[0].stale).toBe(true);
    expect(h.staleScopes).toEqual([expect.objectContaining({ scope: "config:1" })]);
  });

  it("a config never attempted since it was added counts from 'since'", () => {
    const h = evaluatePollerHealth(hb({ configs: [{ id: 2, code: "N", factoryId: 7, intervalMs: 1000, since: now - 120_000, lastAttemptAt: null, lastOkAt: null, link: "unknown" }] }), now, { enabled: true });
    expect(h.configs[0].stale).toBe(true);
  });

  it("all fresh ⇒ 'ok', leaderAlive", () => {
    const h = evaluatePollerHealth(hb(), now, { enabled: true });
    expect(h).toMatchObject({ state: "ok", leaderAlive: true, staleScopes: [] });
  });

  it("★ the leader WRITES the heartbeat (per-config last attempt / last decided read); a non-leader writes nothing", async () => {
    const store = memStore();
    const c = cfg();
    const { p } = mk(() => [c], () => scripted(c, [{}]), { health: store });
    expect(await p.leaderCheckAndRefresh()).toBe(true);
    await p.pollNow(1);
    await p.leaderCheckAndRefresh();
    expect(store.hb?.configs[0]).toMatchObject({ id: 1, code: "S2", factoryId: 7, link: "online" });
    expect(typeof store.hb?.configs[0].lastAttemptAt).toBe("number");
    expect(typeof store.hb?.configs[0].lastOkAt).toBe("number");
    const s2 = memStore();
    const nl = mk(() => [c], () => scripted(c, [{}]), { health: s2, leader: { acquire: async () => false, held: async () => false, release: async () => undefined } });
    await nl.p.leaderCheckAndRefresh();
    expect(s2.writes).toBe(0);
  });

  it("★ watchdog: a stale episode raises ONE 'plc_monitor_stale' alarm across checks and instances; a new episode alarms again", async () => {
    const store = memStore();
    store.hb = hb({ at: now - SAFETY_PLC_HEARTBEAT_STALE_MS - 5 });
    const events: RecordSafetyEventInput[] = [];
    const rec = async (i: RecordSafetyEventInput) => (events.push(i), { ok: true, enabled: true });
    for (let k = 0; k < 3; k++) await runPollerWatchdogOnce({ store, record: rec, now: () => now, enabled: () => true, startedAt: now - 300_000 });
    await runPollerWatchdogOnce({ store, record: rec, now: () => now + 1000, enabled: () => true, startedAt: now - 300_000 }); // "another instance"
    expect(events.map((e) => e.eventType)).toEqual(["plc_monitor_stale"]);
    expect(String(events[0].notes)).toMatch(/BLIND|not polled|stale/i);
    store.hb = hb({ at: now - SAFETY_PLC_HEARTBEAT_STALE_MS - 99_000 }); // a later, different episode
    await runPollerWatchdogOnce({ store, record: rec, now: () => now, enabled: () => true, startedAt: now - 300_000 });
    expect(events).toHaveLength(2);
  });

  it("watchdog grace: no heartbeat right after boot does not alarm until the grace elapsed", async () => {
    const store = memStore();
    const events: string[] = [];
    const rec = async (i: RecordSafetyEventInput) => (events.push(String(i.eventType)), { ok: true, enabled: true });
    await runPollerWatchdogOnce({ store, record: rec, now: () => now, enabled: () => true, startedAt: now - 5_000 });
    expect(events).toEqual([]);
    await runPollerWatchdogOnce({ store, record: rec, now: () => now, enabled: () => true, startedAt: now - 120_000 });
    expect(events).toEqual(["plc_monitor_stale"]);
  });

  it("★ a HUNG event insert does not stall the config's chain (bounded record): attempts keep advancing", async () => {
    const c = cfg();
    const { p } = mk(() => [c], () => scripted(c, [{ estop: true }]), {
      recordPlain: () => new Promise(() => undefined),
      recordTrusted: () => new Promise(() => undefined),
      recordTimeoutMs: 150,
    });
    await p.refreshConfigs();
    const t0 = Date.now();
    await p.pollNow(1);
    expect(Date.now() - t0).toBeLessThan(1500);
    const a1 = p.snapshot()[0].lastAttemptAt!;
    await sleep(10);
    await p.pollNow(1);
    expect(p.snapshot()[0].lastAttemptAt!).toBeGreaterThan(a1);
    expect(p.snapshot()[0].recordFailStreak).toBeGreaterThanOrEqual(2);
  });

  it("a HUNG approval lookup does not stall the chain either (⇒ not approved, plain door)", async () => {
    const c = cfg();
    const doors: string[] = [];
    const { p } = mk(() => [c], () => scripted(c, [{ estop: true }]), {
      isTrustApproved: () => new Promise(() => undefined),
      recordPlain: async () => (doors.push("plain"), { ok: true, enabled: true }),
      recordTrusted: async () => (doors.push("trusted"), { ok: true, enabled: true }),
      recordTimeoutMs: 150,
    });
    await p.refreshConfigs();
    await p.pollNow(1);
    expect(doors).toEqual(["plain"]);
  });
});

describe("(b) failed inserts never drop transitions", () => {
  it("★ DB down during press AND release ⇒ both recorded, in order, when the DB is back", async () => {
    const c = cfg();
    let down = true;
    const recs: string[] = [];
    const rec = async (i: RecordSafetyEventInput) => {
      if (down) throw new Error("db down");
      recs.push(String(i.eventType));
      return { ok: true, enabled: true };
    };
    const { p } = mk(() => [c], () => scripted(c, [{}, { estop: true }, {}, {}]), { recordPlain: rec, recordTrusted: rec });
    await p.refreshConfigs();
    for (let k = 0; k < 3; k++) await p.pollNow(1);
    down = false;
    await p.pollNow(1);
    expect(recs).toEqual(["estop", "estop_released"]);
  });

  it(`★ overflow (> ${"SAFETY_PLC_EVENT_QUEUE_MAX"}): the oldest are dropped and ONE 'plc_events_lost' marker (with the count) is recorded FIRST`, async () => {
    const c = cfg();
    let down = true;
    const recs: RecordSafetyEventInput[] = [];
    const rec = async (i: RecordSafetyEventInput) => {
      if (down) throw new Error("db down");
      recs.push(i);
      return { ok: true, enabled: true };
    };
    const steps: Step[] = [{}];
    // odd ⇒ the newest event (kept) and the 32nd (the one kept if the NEWEST were dropped) are of different types
    const flips = SAFETY_PLC_EVENT_QUEUE_MAX + 11;
    for (let k = 0; k < flips; k++) steps.push(k % 2 === 0 ? { estop: true } : {});
    steps.push(steps[steps.length - 1]);
    const { p } = mk(() => [c], () => scripted(c, steps), { recordPlain: rec, recordTrusted: rec });
    await p.refreshConfigs();
    for (let k = 0; k < flips + 1; k++) await p.pollNow(1);
    expect(p._sizesForTests().maxQueue).toBeLessThanOrEqual(SAFETY_PLC_EVENT_QUEUE_MAX);
    down = false;
    await p.pollNow(1);
    expect(recs[0].eventType).toBe("plc_events_lost");
    expect(String(recs[0].notes)).toMatch(/\b11\b/);
    expect(recs.slice(1)).toHaveLength(SAFETY_PLC_EVENT_QUEUE_MAX);
    expect(recs.filter((r) => r.eventType === "plc_events_lost")).toHaveLength(1);
    expect(recs.at(-1)!.eventType).toBe(flips % 2 === 0 ? "estop_released" : "estop");
  });
});

describe("(c)/(d) edge detection against the last CONFIRMED state", () => {
  it("★ carried state (only the interval changed) then a NEW trip ⇒ the trip is recorded", async () => {
    let c = cfg();
    const b = scripted(c, [{}, {}, { estop: true }]);
    const { p, recs } = mk(() => [c], () => b);
    await p.refreshConfigs();
    await p.pollNow(1);
    c = cfg({ statusMap: { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" }, pollIntervalMs: 500 } });
    await p.refreshConfigs();
    await p.pollNow(1);
    await p.pollNow(1);
    expect(recs).toEqual(["estop"]);
  });

  it("★ carried while pressed, released, pressed again ⇒ released + estop", async () => {
    let c = cfg();
    const b = scripted(c, [{ estop: true }, {}, { estop: true }]);
    const { p, recs } = mk(() => [c], () => b);
    await p.refreshConfigs();
    await p.pollNow(1);
    c = cfg({ name: "renamed" });
    await p.refreshConfigs();
    await p.pollNow(1);
    await p.pollNow(1);
    expect(recs).toEqual(["estop", "estop_released", "estop"]);
  });

  it("★ unknown (offline) period followed by a trip ⇒ offline, then the trip (immediately, even before 'online')", async () => {
    const c = cfg();
    const { p, recs } = mk(() => [c], () => scripted(c, ["fail", "fail", { estop: true }]));
    await p.refreshConfigs();
    for (let k = 0; k < 3; k++) await p.pollNow(1);
    expect(recs).toEqual(["plc_offline", "estop"]);
  });
});
