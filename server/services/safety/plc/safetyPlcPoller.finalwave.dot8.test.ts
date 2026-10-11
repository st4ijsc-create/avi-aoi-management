/**
 * doc 81 Đợt 8 final wave — Group N re-review items on the background safety-PLC poller (unit part; the pg store is measured
 * in safetyPlcPollState.finalwave.dot8.db.test.ts):
 *   • N-R1 — health must NOT read "ok" while observed transitions are not recorded: the durable row carries the oldest
 *     unrecorded wait; beyond the stale bound ⇒ STALE + one alarm per episode;
 *   • N-R5 — staleness is computed on the clock the STORE reports (the DB's), not on the instance clock.
 *   • N-R2 — the watchdog leases an episode, records, then confirms (or releases on a failed / hung record ⇒ retried).
 *   • N-R3 — transitions still queued when their state is replaced / dropped (identity edit, leadership loss, disable,
 *     stop) leave ONE "plc_events_lost" marker.
 * Oracle: an in-memory PollStateStore with the pg store's semantics; events are collected by fake record doors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import type { SafetyPlcConfig, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import { SafetyPlcPoller, SAFETY_PLC_STATE_REFRESH_MS } from "./safetyPlcPoller";
import { evaluatePollerHealth, runPollerWatchdogOnce, configStaleAfterMs, SAFETY_PLC_WATCHDOG_RECORD_TIMEOUT_MS, type PollStateRow, type PollStateStore, type StaleAlarmLease } from "./safetyPlcPollerHealth";
import { OtReadSafetyPlcBackend, loadEnabledPlcConfig, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import type { RecordSafetyEventInput } from "../safetyAuditService";

const LEADER = { acquire: async () => true, held: async () => true, release: async () => undefined };
function cfg(over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id: 1, code: "FW", name: "fw", vendor: "pilz", backend: "modbus", endpoint: "tcp://192.0.2.96:502",
    statusMap: { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" }, pollIntervalMs: 250 },
    robotId: 3, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 7,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  } as SafetyPlcConfig;
}
type Step = SafetyPlcStatusSnapshot | "fail";
function scripted(c: SafetyPlcConfig, steps: Step[]) {
  const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, c.statusMap as never, 500);
  let i = 0;
  (b as unknown as { readChecked: () => Promise<SafetyPlcCheckedRead> }).readChecked = async () => {
    const s = steps[Math.min(i++, steps.length - 1)];
    if (s === "fail") throw new Error("ECONNREFUSED");
    return { status: { estop: !!s.estop, zoneOccupied: !!s.zoneOccupied }, unreadable: [] };
  };
  return b;
}
function memStore() {
  const rows = new Map<number, PollStateRow>();
  const st = {
    rows,
    saves: 0,
    async load(id: number) {
      const r = rows.get(id);
      return r ? JSON.parse(JSON.stringify(r)) : null;
    },
    async save(r: Omit<PollStateRow, "staleAlarmEpisode">) {
      st.saves += 1;
      rows.set(r.configId, { ...JSON.parse(JSON.stringify(r)), staleAlarmEpisode: rows.get(r.configId)?.staleAlarmEpisode ?? null });
    },
    async list() {
      return [...rows.values()].map((r) => JSON.parse(JSON.stringify(r)));
    },
    claims: new Map<number, string>(),
    async claimStaleAlarm(id: number, episode: string) {
      const r = rows.get(id);
      if (r?.staleAlarmEpisode === episode || st.claims.get(id) === episode) return false;
      st.claims.set(id, episode);
      return true;
    },
    async confirmStaleAlarm(id: number, episode: string) {
      if (st.claims.get(id) === episode) rows.set(id, { ...rows.get(id)!, staleAlarmEpisode: episode });
    },
    async releaseStaleAlarm(id: number, episode: string) {
      if (st.claims.get(id) === episode && rows.get(id)?.staleAlarmEpisode !== episode) st.claims.delete(id);
    },
  };
  return st as typeof st & PollStateStore & StaleAlarmLease;
}

const pollers: SafetyPlcPoller[] = [];
let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "error").mockImplementation(() => undefined)];
});
afterEach(async () => {
  while (pollers.length) await pollers.pop()!.stop();
  quiet.forEach((q) => q.mockRestore());
});

function mk(store: PollStateStore, c: SafetyPlcConfig, steps: Step[], rec: (i: RecordSafetyEventInput) => Promise<{ ok: boolean; enabled: boolean; message?: string }>) {
  const p = new SafetyPlcPoller({
    loadConfigs: async () => [c],
    backendFor: () => ({ backend: scripted(c, steps) }),
    recordPlain: rec as never,
    recordTrusted: rec as never,
    isTrustApproved: async () => true,
    leader: LEADER,
    state: store,
  });
  pollers.push(p);
  return p;
}
const ENABLED = [{ id: 1, code: "FW", factoryId: 7 }];

describe("final wave N-R1 — health is not 'ok' while observed transitions are NOT recorded", () => {
  it("★ inserts fail, state upsert succeeds ⇒ the row carries the wait; beyond the bound ⇒ STALE (reason: not recorded); before it ⇒ ok", async () => {
    const store = memStore();
    const p = mk(store, cfg(), [{ estop: true }], async () => ({ ok: false, enabled: true, message: "insert failed" }));
    await p.refreshConfigs();
    for (let k = 0; k < 3; k++) await p.pollNow(1);
    const row = store.rows.get(1)!;
    expect(row.lastAttemptAt).not.toBeNull(); // the chain is alive — the old health said "ok"
    expect(row.unrecordedSince).toEqual(expect.any(Number));
    expect(row.unrecordedCount).toBeGreaterThanOrEqual(1);
    const bound = configStaleAfterMs(250);
    const fresh = (t: number) => [{ ...row, lastAttemptAt: t }];
    expect(evaluatePollerHealth(ENABLED, fresh(row.unrecordedSince! + bound), row.unrecordedSince! + bound, { enabled: true }).state).toBe("ok");
    const later = row.unrecordedSince! + bound + 1;
    const h = evaluatePollerHealth(ENABLED, fresh(later), later, { enabled: true });
    expect(h.state).toBe("stale");
    expect(h.configs[0]).toMatchObject({ stale: true, unrecordedSince: row.unrecordedSince });
    expect(h.staleScopes).toEqual([{ configId: 1, episode: `cfg:1:unrec:${row.unrecordedSince}`, reason: expect.stringMatching(/NOT recorded/) }]);
  });

  it("the wait is cleared once everything is recorded (row: unrecordedSince null, count 0) ⇒ ok", async () => {
    const store = memStore();
    let failing = true;
    const p = mk(store, cfg(), [{ estop: true }], async () => (failing ? { ok: false, enabled: true } : { ok: true, enabled: true }));
    await p.refreshConfigs();
    await p.pollNow(1);
    expect(store.rows.get(1)!.unrecordedSince).toEqual(expect.any(Number));
    failing = false;
    await p.pollNow(1);
    expect(store.rows.get(1)).toMatchObject({ unrecordedSince: null, unrecordedCount: 0 });
    const r = store.rows.get(1)!;
    expect(evaluatePollerHealth(ENABLED, [r], r.lastAttemptAt! + configStaleAfterMs(250), { enabled: true }).state).toBe("ok");
  });

  it("the wait starts at the FIRST unrecorded transition and is not reset by later ones while still stuck", async () => {
    const store = memStore();
    const p = mk(store, cfg(), [{ estop: true }, { estop: true, zoneOccupied: true }, {}], async () => ({ ok: false, enabled: true }));
    await p.refreshConfigs();
    await p.pollNow(1);
    const first = store.rows.get(1)!.unrecordedSince;
    await new Promise((r) => setTimeout(r, 5));
    await p.pollNow(1);
    await p.pollNow(1);
    expect(store.rows.get(1)!.unrecordedSince).toBe(first);
    expect(store.rows.get(1)!.unrecordedCount).toBeGreaterThanOrEqual(2);
  });

  it("a NEW wait after a full drain starts at the new transition (an old, cleared wait is never reused)", async () => {
    const store = memStore();
    let failing = true;
    const p = mk(store, cfg(), [{ estop: true }, { estop: true }, {}, {}], async () => (failing ? { ok: false, enabled: true } : { ok: true, enabled: true }));
    await p.refreshConfigs();
    await p.pollNow(1); // estop queued, not recorded
    const first = store.rows.get(1)!.unrecordedSince!;
    failing = false;
    await p.pollNow(1); // recorded ⇒ cleared
    expect(store.rows.get(1)!.unrecordedSince).toBeNull();
    await new Promise((r) => setTimeout(r, 15));
    failing = true;
    await p.pollNow(1); // release queued, not recorded
    const second = store.rows.get(1)!.unrecordedSince!;
    expect(second).toBeGreaterThan(first);
  });

  it("★ the watchdog raises ONE 'plc_monitor_stale' alarm for the unrecorded episode (and not again for the same episode)", async () => {
    const store = memStore();
    const since = 1_000_000;
    store.rows.set(1, { configId: 1, link: "online", flags: { estop: true }, intervalMs: 250, lastAttemptAt: since + 600_000, lastOkAt: since + 600_000, unrecordedSince: since, unrecordedCount: 3 });
    const recs: RecordSafetyEventInput[] = [];
    const run = () => runPollerWatchdogOnce({ store, listConfigs: async () => ENABLED, record: async (i) => (recs.push(i), { ok: true, enabled: true }), now: () => since + 600_001, enabled: () => true, startedAt: 0 });
    expect((await run()).state).toBe("stale");
    await run();
    expect(recs.map((r) => r.eventType)).toEqual(["plc_monitor_stale"]);
    expect(recs[0].notes).toMatch(/NOT recorded/);
  });
});

describe("final wave N-R3 — unrecorded transitions dropped with their state leave an events-lost marker", () => {
  type Rec = { door: string; input: RecordSafetyEventInput };
  function harness(steps: Step[], opts: { leader?: { lead: boolean } } = {}) {
    const db = { rows: [cfg()] };
    const recs: Rec[] = [];
    let failing = true;
    const door = (name: string) => async (i: RecordSafetyEventInput) => {
      if (failing && i.eventType !== "plc_events_lost") return { ok: false, enabled: true };
      recs.push({ door: name, input: i });
      return { ok: true, enabled: true };
    };
    const lead = opts.leader ?? { lead: true };
    const p = new SafetyPlcPoller({
      loadConfigs: async () => db.rows,
      backendFor: (c) => ({ backend: scripted(c, steps) }),
      recordPlain: door("plain") as never,
      recordTrusted: door("trusted") as never,
      isTrustApproved: async () => true,
      leader: { acquire: async () => lead.lead, held: async () => lead.lead, release: async () => undefined },
      state: memStore(),
    });
    pollers.push(p);
    return { p, db, recs, lead, up: () => (failing = false) };
  }
  const lost = (r: Rec[]) => r.filter((x) => x.input.eventType === "plc_events_lost");

  it("★ identity edit (re-targeted) with a queued trip ⇒ the NEW state records ONE marker first (count, plain door, current target)", async () => {
    const h = harness([{ estop: true }]);
    await h.p.leaderCheckAndRefresh();
    await h.p.pollNow(1); // estop queued (insert failing)
    h.db.rows = [cfg({ robotId: 9 })]; // identity change ⇒ new state
    await h.p.refreshConfigs();
    h.up();
    await h.p.pollNow(1);
    const m = lost(h.recs);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ door: "plain", input: { robotId: 9 } });
    expect(m[0].input.notes).toMatch(/^1 safety-PLC transition/);
    expect(h.recs[0].input.eventType).toBe("plc_events_lost"); // first
  });

  it("★ leadership lost with a queued trip ⇒ ONE marker (plain door) for the config's target", async () => {
    const h = harness([{ estop: true }]);
    await h.p.leaderCheckAndRefresh();
    await h.p.pollNow(1);
    h.lead.lead = false;
    await h.p.leaderCheckAndRefresh();
    await Promise.resolve();
    const m = lost(h.recs);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ door: "plain", input: { robotId: 3, factoryId: 7 } });
    expect(m[0].input.notes).toMatch(/leadership/);
  });

  it("★ config disabled / deleted with a queued trip ⇒ ONE marker WITHOUT a target", async () => {
    const h = harness([{ estop: true }]);
    await h.p.leaderCheckAndRefresh();
    await h.p.pollNow(1);
    h.db.rows = [];
    await h.p.refreshConfigs();
    await Promise.resolve();
    const m = lost(h.recs);
    expect(m).toHaveLength(1);
    expect(m[0].input).toMatchObject({ robotId: null, stationId: null, lineId: null, factoryId: null, scope: null });
    expect(m[0].input.notes).toMatch(/disabled or deleted/);
  });

  it("nothing waiting ⇒ no marker on any drop", async () => {
    const h = harness([{}]);
    h.up();
    await h.p.leaderCheckAndRefresh();
    await h.p.pollNow(1);
    h.db.rows = [];
    await h.p.refreshConfigs();
    await h.p.stop();
    expect(lost(h.recs)).toHaveLength(0);
  });
});

describe("final wave N-R6 — DB load per poll / per event", () => {
  it("★ an UNCHANGED row is re-written at most every SAFETY_PLC_STATE_REFRESH_MS (liveness), a CHANGE is written at once", async () => {
    const store = memStore();
    let t = 1_000_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => t);
    try {
      const p = mk(store, cfg(), [{}, {}, {}, {}, {}, { estop: true }, { estop: true }], async () => ({ ok: true, enabled: true }));
      await p.refreshConfigs();
      for (let k = 0; k < 5; k++) {
        await p.pollNow(1);
        t += 250;
      }
      expect(store.saves).toBe(1); // 5 unchanged polls within 1.25 s ⇒ one write
      await p.pollNow(1); // e-stop recorded ⇒ the edge changed ⇒ written now
      expect(store.saves).toBe(2);
      expect(store.rows.get(1)!.flags.estop).toBe(true);
      t += SAFETY_PLC_STATE_REFRESH_MS;
      await p.pollNow(1); // unchanged, but the refresh period passed ⇒ liveness write
      expect(store.saves).toBe(3);
      expect(store.rows.get(1)!.lastAttemptAt).toBe(t);
    } finally {
      now.mockRestore();
    }
  });

  it("a FAILED save forces the next poll to write again (no skipped liveness after an error)", async () => {
    const store = memStore();
    let fail = true;
    const realSave = store.save.bind(store);
    store.save = async (r) => {
      store.saves += 1;
      if (fail) throw new Error("db down");
      return realSave(r);
    };
    const p = mk(store, cfg(), [{}], async () => ({ ok: true, enabled: true }));
    await p.refreshConfigs();
    await p.pollNow(1);
    fail = false;
    await p.pollNow(1);
    expect(store.saves).toBeGreaterThanOrEqual(2);
    expect(store.rows.get(1)).toBeDefined();
  });

  it("production wiring: the record-time config lookup is the ONE-row query (not a re-list of every enabled config)", () => {
    const p = new SafetyPlcPoller({ leader: LEADER, state: memStore() });
    expect((p as unknown as { deps: { loadConfig: unknown } }).deps.loadConfig).toBe(loadEnabledPlcConfig);
  });
});

describe("final wave N-R2 — the watchdog never loses an alarm to a failed record (lease → record → confirm / release)", () => {
  const staleRow = (): PollStateRow => ({ configId: 1, link: "online", flags: {}, intervalMs: 250, lastAttemptAt: 1_000, lastOkAt: 1_000 });
  const runWith = (store: PollStateStore & StaleAlarmLease, record: (i: RecordSafetyEventInput) => Promise<{ ok: boolean; enabled: boolean }>) =>
    runPollerWatchdogOnce({ store, listConfigs: async () => ENABLED, record: record as never, now: () => 10_000_000, enabled: () => true, startedAt: 0 });

  it("★ record returns {ok:false} ⇒ the episode is NOT done: the next check records it (exactly one success, then silence)", async () => {
    const store = memStore();
    store.rows.set(1, staleRow());
    let attempts = 0;
    const ok: string[] = [];
    const rec = async (i: RecordSafetyEventInput) => (++attempts === 1 ? { ok: false, enabled: true } : (ok.push(String(i.eventType)), { ok: true, enabled: true }));
    await runWith(store, rec);
    expect(ok).toEqual([]);
    await runWith(store, rec);
    await runWith(store, rec);
    expect(ok).toEqual(["plc_monitor_stale"]);
    expect(attempts).toBe(2);
  });

  it("record THROWS ⇒ released and retried", async () => {
    const store = memStore();
    store.rows.set(1, staleRow());
    let attempts = 0;
    const rec = async () => {
      if (++attempts === 1) throw new Error("audit chain lock timeout");
      return { ok: true, enabled: true };
    };
    await runWith(store, rec);
    await runWith(store, rec);
    expect(attempts).toBe(2);
    expect(store.rows.get(1)!.staleAlarmEpisode).toBe("cfg:1:1000");
  });

  it("record HANGS ⇒ bounded (treated as failed, released), the next check retries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const store = memStore();
      store.rows.set(1, staleRow());
      let attempts = 0;
      const rec = (): Promise<{ ok: boolean; enabled: boolean }> => (++attempts === 1 ? new Promise(() => undefined) : Promise.resolve({ ok: true, enabled: true }));
      const first = runWith(store, rec);
      await vi.advanceTimersByTimeAsync(SAFETY_PLC_WATCHDOG_RECORD_TIMEOUT_MS + 1);
      await first;
      expect(store.rows.get(1)!.staleAlarmEpisode ?? null).toBeNull();
      await runWith(store, rec);
      expect(attempts).toBe(2);
      expect(store.rows.get(1)!.staleAlarmEpisode).toBe("cfg:1:1000");
    } finally {
      vi.useRealTimers();
    }
  });

  it("★ scan 'alarm-integrity': {ok:false, enabled:false} is NOT a durable alarm ⇒ the episode is not marked handled", async () => {
    const store = memStore();
    store.rows.set(1, staleRow());
    let attempts = 0;
    const rec = async () => (attempts++, { ok: false, enabled: false });
    await runWith(store, rec);
    await runWith(store, rec);
    expect(attempts).toBe(2);
    expect(store.rows.get(1)!.staleAlarmEpisode ?? null).toBeNull();
  });
});

describe("final wave N-R5 — staleness on the store's (DB) clock, not the instance clock", () => {
  it("★ the watchdog judges with listAt().nowMs: a skewed instance clock cannot make a stale row fresh (or a fresh one stale)", async () => {
    const store = memStore();
    const dbNow = 50_000_000;
    store.rows.set(1, { configId: 1, link: "online", flags: {}, intervalMs: 250, lastAttemptAt: dbNow - 1000, lastOkAt: dbNow - 1000 });
    const withClock = Object.assign(store, { listAt: async () => ({ rows: await store.list(), nowMs: dbNow }) });
    const run = (instanceNow: number) => runPollerWatchdogOnce({ store: withClock, listConfigs: async () => ENABLED, record: async () => ({ ok: true, enabled: true }), now: () => instanceNow, enabled: () => true, startedAt: 0 });
    expect((await run(dbNow + 3_600_000)).state).toBe("ok"); // instance clock 1 h ahead: still fresh on the DB clock
    store.rows.set(1, { ...store.rows.get(1)!, lastAttemptAt: dbNow - configStaleAfterMs(250) - 1 });
    expect((await run(dbNow - 3_600_000)).state).toBe("stale"); // instance clock 1 h behind: still stale on the DB clock
  });
});
