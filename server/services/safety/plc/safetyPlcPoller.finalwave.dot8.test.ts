/**
 * doc 81 Đợt 8 final wave — Group N re-review items on the background safety-PLC poller (unit part; the pg store is measured
 * in safetyPlcPollState.finalwave.dot8.db.test.ts):
 *   • N-R1 — health must NOT read "ok" while observed transitions are not recorded: the durable row carries the oldest
 *     unrecorded wait; beyond the stale bound ⇒ STALE + one alarm per episode;
 *   • N-R5 — staleness is computed on the clock the STORE reports (the DB's), not on the instance clock.
 * Oracle: an in-memory PollStateStore with the pg store's semantics; events are collected by fake record doors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import type { SafetyPlcConfig, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import { SafetyPlcPoller } from "./safetyPlcPoller";
import { evaluatePollerHealth, runPollerWatchdogOnce, configStaleAfterMs, type PollStateRow, type PollStateStore } from "./safetyPlcPollerHealth";
import { OtReadSafetyPlcBackend, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
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
    async claimStaleAlarm(id: number, episode: string) {
      const r = rows.get(id);
      if (r?.staleAlarmEpisode === episode) return false;
      rows.set(id, { configId: id, link: "unknown", flags: {}, intervalMs: null, lastAttemptAt: null, lastOkAt: null, ...r, staleAlarmEpisode: episode });
      return true;
    },
  };
  return st as typeof st & PollStateStore;
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
