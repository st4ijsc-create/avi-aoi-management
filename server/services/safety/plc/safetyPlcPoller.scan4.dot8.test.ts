/**
 * doc 81 Đợt 8 task N fix scan 4 (security scan "safety-logic / stale identity mapping") — an event is attributed to the
 * CURRENT target and an edge never crosses an identity change:
 *   • the target (robot / station / line / factory / scope) is resolved from the CURRENT config row at RECORD time;
 *     changed since detection ⇒ recorded, NOT trusted, current target; deleted / disabled ⇒ recorded, NOT trusted, no target;
 *   • edge state is keyed by (config id + trust digest): a re-targeted / re-created (reused id) config starts a FRESH
 *     baseline (its held trip is reported to the new target, as a normal notice) — the old edge is never applied;
 *   • only non-identity edits (name, poll interval) carry the state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import type { SafetyPlcConfig, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import { SafetyPlcPoller } from "./safetyPlcPoller";
import { plcTrustDigest } from "./safetyPlcTrust";
import type { PollStateRow, PollStateStore } from "./safetyPlcPollerHealth";
import { OtReadSafetyPlcBackend, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import type { RecordSafetyEventInput } from "../safetyAuditService";

const LEADER = { acquire: async () => true, held: async () => true, release: async () => undefined };
function cfg(over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id: 1, code: "S4", name: "s4", vendor: "pilz", backend: "modbus", endpoint: "tcp://192.0.2.96:502",
    statusMap: { estop: { address: "coil:1" }, pollIntervalMs: 250 },
    robotId: 3, stationId: 11, lineId: 2, enabled: true, notes: null, scope: "factory", corporateCode: "C1", factoryId: 7,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  } as SafetyPlcConfig;
}
function scripted(c: SafetyPlcConfig, steps: SafetyPlcStatusSnapshot[]) {
  const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, c.statusMap as never, 500);
  let i = 0;
  (b as unknown as { readChecked: () => Promise<SafetyPlcCheckedRead> }).readChecked = async () => {
    const s = steps[Math.min(i++, steps.length - 1)];
    return { status: { estop: !!s.estop }, unreadable: [] };
  };
  return b;
}
function memStore() {
  const rows = new Map<number, PollStateRow>();
  const st: PollStateStore & { rows: Map<number, PollStateRow> } = {
    rows,
    async load(id) {
      const r = rows.get(id);
      return r ? JSON.parse(JSON.stringify(r)) : null;
    },
    async save(r) {
      rows.set(r.configId, JSON.parse(JSON.stringify(r)));
    },
    async list() {
      return [...rows.values()];
    },
    async claimStaleAlarm() {
      return false;
    },
  };
  return st;
}
type Rec = { door: string; input: RecordSafetyEventInput };
const pollers: SafetyPlcPoller[] = [];
let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined)];
});
afterEach(async () => {
  while (pollers.length) await pollers.pop()!.stop();
  quiet.forEach((q) => q.mockRestore());
});
/** db = what the config table says NOW (the poller's list AND the record-time lookup read it). */
function mk(db: { rows: SafetyPlcConfig[] }, steps: SafetyPlcStatusSnapshot[], store = memStore()) {
  const recs: Rec[] = [];
  const seam = (door: string) => async (input: RecordSafetyEventInput) => (recs.push({ door, input }), { ok: true, enabled: true });
  const backend = scripted(cfg(), steps);
  const p = new SafetyPlcPoller({
    loadConfigs: async () => db.rows.filter((c) => c.enabled),
    backendFor: () => ({ backend }),
    recordPlain: seam("plain"),
    recordTrusted: seam("trusted"),
    isTrustApproved: async () => true,
    leader: LEADER,
    state: store,
  });
  pollers.push(p);
  return { p, recs, store };
}

describe("scan 4 — the target is resolved at RECORD time from the current config row", () => {
  it("★ re-targeted between refreshes (robot 3 → 9, station 11 → 12): the trip goes to the NEW target, NOT trusted", async () => {
    const db = { rows: [cfg()] };
    const { p, recs } = mk(db, [{}, { estop: true }]);
    await p.refreshConfigs();
    await p.pollNow(1);
    db.rows = [cfg({ robotId: 9, stationId: 12 })]; // edited; the poller has not refreshed yet
    await p.pollNow(1);
    expect(recs).toHaveLength(1);
    expect(recs[0].door).toBe("plain");
    expect(recs[0].input).toMatchObject({ eventType: "estop", robotId: 9, stationId: 12 });
    expect(String(recs[0].input.notes)).toMatch(/changed since detection/);
  });

  it("★ deleted / disabled between refreshes: the trip is still recorded, NOT trusted, with NO target", async () => {
    for (const after of [[], [cfg({ enabled: false })]]) {
      const db = { rows: [cfg()] };
      const { p, recs } = mk(db, [{}, { estop: true }]);
      await p.refreshConfigs();
      await p.pollNow(1);
      db.rows = after as SafetyPlcConfig[];
      await p.pollNow(1);
      expect(recs.map((r) => [r.door, r.input.eventType, r.input.robotId, r.input.stationId, r.input.factoryId])).toEqual([["plain", "estop", null, null, null]]);
      expect(String(recs[0].input.notes)).toMatch(/deleted or disabled/);
      await pollers.pop()!.stop();
    }
  });

  it("★ the record-time lookup FAILS ⇒ nothing is recorded with a cached target; it stays queued and is recorded once resolvable", async () => {
    const recs: Rec[] = [];
    const seam = (door: string) => async (input: RecordSafetyEventInput) => (recs.push({ door, input }), { ok: true, enabled: true });
    let lookupDown = false;
    const db = { rows: [cfg()] };
    const backend = scripted(cfg(), [{}, { estop: true }]);
    const p = new SafetyPlcPoller({
      loadConfigs: async () => db.rows,
      loadConfig: async (id) => {
        if (lookupDown) throw new Error("db down");
        return db.rows.find((c) => c.id === id) ?? null;
      },
      backendFor: () => ({ backend }),
      recordPlain: seam("plain"),
      recordTrusted: seam("trusted"),
      isTrustApproved: async () => true,
      leader: LEADER,
      state: memStore(),
    });
    pollers.push(p);
    await p.refreshConfigs();
    await p.pollNow(1);
    lookupDown = true;
    db.rows = [cfg({ stationId: 12 })];
    await p.pollNow(1);
    expect(recs).toEqual([]);
    lookupDown = false;
    await p.pollNow(1);
    expect(recs.map((r) => [r.door, r.input.eventType, r.input.stationId])).toEqual([["plain", "estop", 12]]);
  });

  it("unchanged config ⇒ its own target, trusted door (control)", async () => {
    const db = { rows: [cfg()] };
    const { p, recs } = mk(db, [{}, { estop: true }]);
    await p.refreshConfigs();
    await p.pollNow(1);
    await p.pollNow(1);
    expect(recs.map((r) => [r.door, r.input.robotId, r.input.stationId])).toEqual([["trusted", 3, 11]]);
  });
});

describe("scan 4 — edge state is keyed by (config id + trust digest)", () => {
  it("★ a target change after refresh ⇒ FRESH baseline: the held e-stop is reported to the NEW target (plain), not swallowed", async () => {
    const db = { rows: [cfg()] };
    const { p, recs } = mk(db, [{ estop: true }]);
    await p.refreshConfigs();
    await p.pollNow(1);
    db.rows = [cfg({ stationId: 12 })];
    await p.refreshConfigs();
    await p.pollNow(1);
    expect(recs.map((r) => [r.door, r.input.eventType, r.input.stationId])).toEqual([
      ["trusted", "estop", 11],
      ["plain", "estop", 12],
    ]);
  });

  it("only a NON-identity edit (name, poll interval) carries the state: no new event", async () => {
    const db = { rows: [cfg()] };
    const { p, recs } = mk(db, [{ estop: true }]);
    await p.refreshConfigs();
    await p.pollNow(1);
    db.rows = [cfg({ name: "renamed", statusMap: { estop: { address: "coil:1" }, pollIntervalMs: 500 } })];
    await p.refreshConfigs();
    await p.pollNow(1);
    expect(recs).toHaveLength(1);
  });

  it("★ reused id: a durable row of ANOTHER identity is never applied — the new config's held trip is reported, no false 'released'", async () => {
    const store = memStore();
    const old = cfg();
    await store.save({ configId: 1, link: "online", flags: { estop: true }, intervalMs: 250, lastAttemptAt: 1, lastOkAt: 1, identityDigest: plcTrustDigest(old) });
    const recreated = cfg({ stationId: 40, lineId: 5, code: "S4-new" }); // same id, same endpoint / tags, another target
    const db = { rows: [recreated] };
    const a = mk(db, [{ estop: true }], store);
    await a.p.refreshConfigs();
    await a.p.pollNow(1);
    expect(a.recs.map((r) => [r.door, r.input.eventType, r.input.stationId])).toEqual([["plain", "estop", 40]]);
    await pollers.pop()!.stop();
    // the other way round: old edge says pressed, the new config reads clear ⇒ NOT "released"
    await store.save({ configId: 1, link: "online", flags: { estop: true }, intervalMs: 250, lastAttemptAt: 1, lastOkAt: 1, identityDigest: plcTrustDigest(old) });
    const b = mk(db, [{}], store);
    await b.p.refreshConfigs();
    await b.p.pollNow(1);
    expect(b.recs).toEqual([]);
  });

  it("the durable row carries the identity it was written for", async () => {
    const db = { rows: [cfg()] };
    const { p, store } = mk(db, [{}]);
    await p.refreshConfigs();
    await p.pollNow(1);
    expect(store.rows.get(1)?.identityDigest).toBe(plcTrustDigest(cfg()));
  });
});
