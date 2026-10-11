/**
 * doc 81 Đợt 8 task N fix scan 3 (ruling R-8-c) — the SIMPLEST design that cannot lose a transition or report healthy
 * while blind: ONE durable row per config (safety_plc_poll_state) = the CONFIRMED edge state + last attempt / last decided
 * read. The edge advances only after the event is durably recorded; a restart / failover continues from the durable edge;
 * health is computed from enabled configs × durable rows (same answer on every instance; a missing row is STALE).
 * Unit part: an in-memory PollStateStore with the production semantics; the pg store is measured in the _test DB file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import type { SafetyPlcConfig, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import { SafetyPlcPoller } from "./safetyPlcPoller";
import { plcTrustDigest } from "./safetyPlcTrust";
import { evaluatePollerHealth, runPollerWatchdogOnce, configStaleAfterMs, type PollStateRow, type PollStateStore, type StaleAlarmLease } from "./safetyPlcPollerHealth";
import { OtReadSafetyPlcBackend, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import type { RecordSafetyEventInput } from "../safetyAuditService";

const LEADER = { acquire: async () => true, held: async () => true, release: async () => undefined };
function cfg(over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id: 1, code: "S3", name: "s3", vendor: "pilz", backend: "modbus", endpoint: "tcp://192.0.2.95:502",
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
/** In-memory store with the pg store's semantics (rows survive pollers; errors are throwable on demand). */
function memStore() {
  const rows = new Map<number, PollStateRow>();
  const st = {
    rows,
    down: false,
    async load(id: number) {
      if (st.down) throw new Error("db down");
      const r = rows.get(id);
      return r ? JSON.parse(JSON.stringify(r)) : null;
    },
    async save(r: Omit<PollStateRow, "staleAlarmEpisode">) {
      if (st.down) throw new Error("db down");
      rows.set(r.configId, { ...JSON.parse(JSON.stringify(r)), staleAlarmEpisode: rows.get(r.configId)?.staleAlarmEpisode ?? null });
    },
    async list() {
      if (st.down) throw new Error("db down");
      return [...rows.values()].map((r) => JSON.parse(JSON.stringify(r)));
    },
    // final wave N-R2 — the pg store's LEASE semantics: claim (lease) → confirm (done) / release
    claims: new Map<number, string>(),
    async claimStaleAlarm(id: number, episode: string) {
      if (st.down) return false;
      const r = rows.get(id);
      if (r?.staleAlarmEpisode === episode || st.claims.get(id) === episode) return false;
      st.claims.set(id, episode);
      if (!r) rows.set(id, { configId: id, link: "unknown", flags: {}, intervalMs: null, lastAttemptAt: null, lastOkAt: null, staleAlarmEpisode: null });
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

function mk(store: PollStateStore, c: SafetyPlcConfig, steps: Step[], rec: (i: RecordSafetyEventInput) => Promise<{ ok: boolean; enabled: boolean }>) {
  const p = new SafetyPlcPoller({
    loadConfigs: async () => [c],
    backendFor: () => ({ backend: scripted(c, steps) }),
    recordPlain: rec,
    recordTrusted: rec,
    isTrustApproved: async () => true,
    leader: LEADER,
    state: store,
  });
  pollers.push(p);
  return p;
}
async function polls(p: SafetyPlcPoller, n: number) {
  await p.refreshConfigs();
  for (let k = 0; k < n; k++) await p.pollNow(1);
}

describe("R-8-c — the edge state is DURABLE and advances only after the event is durably recorded", () => {
  it("★ failover / restart: a held e-stop is NOT re-sent as a new trip by the next poller; its release IS recorded", async () => {
    const store = memStore();
    const recs: string[] = [];
    const rec = async (i: RecordSafetyEventInput) => (recs.push(String(i.eventType)), { ok: true, enabled: true });
    await polls(mk(store, cfg(), [{ estop: true }], rec), 2);
    expect(recs).toEqual(["estop"]);
    await pollers.pop()!.stop(); // instance A goes away
    await polls(mk(store, cfg(), [{ estop: true }, { estop: true }, {}], rec), 3); // instance B
    expect(recs).toEqual(["estop", "estop_released"]);
  });

  it("★ crash while a release could not be recorded: the next poller still records it (the durable edge never advanced)", async () => {
    const store = memStore();
    const recs: string[] = [];
    let failing = false;
    const rec = async (i: RecordSafetyEventInput) => {
      if (failing) throw new Error("insert failed");
      recs.push(String(i.eventType));
      return { ok: true, enabled: true };
    };
    const a = mk(store, cfg(), [{ estop: true }, {}], rec);
    await a.refreshConfigs();
    await a.pollNow(1);
    failing = true;
    await a.pollNow(1); // release observed, NOT recorded
    expect(store.rows.get(1)?.flags.estop).toBe(true); // durable edge NOT advanced
    await pollers.pop()!.stop(); // crash: in-memory unconfirmed transitions are gone
    failing = false;
    await polls(mk(store, cfg(), [{}], rec), 1);
    expect(recs).toEqual(["estop", "estop_released"]);
  });

  it("★ partial drain then crash: press recorded, release NOT ⇒ the durable edge is the press (not the newer unrecorded state); the next poller records the release", async () => {
    const store = memStore();
    const recs: string[] = [];
    let mode: "down" | "releaseFails" | "up" = "down";
    const rec = async (i: RecordSafetyEventInput) => {
      if (mode === "down" || (mode === "releaseFails" && i.eventType === "estop_released")) throw new Error("insert failed");
      recs.push(String(i.eventType));
      return { ok: true, enabled: true };
    };
    const a = mk(store, cfg(), [{}, { estop: true }, {}, {}], rec);
    await a.refreshConfigs();
    for (let k = 0; k < 3; k++) await a.pollNow(1); // clear, press, release — both transitions queued (DB down)
    mode = "releaseFails";
    await a.pollNow(1); // press recorded, release fails
    expect(recs).toEqual(["estop"]);
    expect(store.rows.get(1)?.flags.estop).toBe(true); // durable = after the RECORDED press, not the unrecorded release
    await pollers.pop()!.stop(); // crash
    // re-pinned 2026-10-11 (doc 81 Đợt 8 final wave N-R3): stop() with a transition still queued now writes ONE
    // "plc_events_lost" marker (plain door) — the queued release is lost to THAT poller; the next one re-detects it.
    expect(recs).toEqual(["estop", "plc_events_lost"]);
    mode = "up";
    await polls(mk(store, cfg(), [{}], rec), 1);
    expect(recs).toEqual(["estop", "plc_events_lost", "estop_released"]);
  });

  it("★ durable state UNREADABLE ⇒ nothing is evaluated (no unknown-baseline guesses); once readable it continues from the row", async () => {
    const store = memStore();
    // fix scan 4: a durable edge is applied only to the identity it was written for
    await store.save({ configId: 1, link: "online", flags: { estop: true }, intervalMs: 250, lastAttemptAt: 1, lastOkAt: 1, identityDigest: plcTrustDigest(cfg()) });
    store.down = true;
    const recs: string[] = [];
    const rec = async (i: RecordSafetyEventInput) => (recs.push(String(i.eventType)), { ok: true, enabled: true });
    const p = mk(store, cfg(), [{ estop: true }], rec);
    await polls(p, 2);
    expect(recs).toEqual([]);
    store.down = false;
    await p.pollNow(1);
    expect(recs).toEqual([]); // held e-stop already durable ⇒ no new trip
  });

  it("the durable row carries last attempt / last decided read / interval; attempts are written even while the PLC is offline", async () => {
    const store = memStore();
    const rec = async () => ({ ok: true, enabled: true });
    await polls(mk(store, cfg(), [{}, "fail"], rec), 2);
    const r = store.rows.get(1)!;
    expect(r.link).toBe("offline");
    expect(r.intervalMs).toBe(250);
    expect(typeof r.lastAttemptAt).toBe("number");
    expect(typeof r.lastOkAt).toBe("number");
    expect(r.lastAttemptAt!).toBeGreaterThanOrEqual(r.lastOkAt!);
  });
});

describe("R-8-c — health from durable rows only (identical on every instance; missing ⇒ STALE)", () => {
  const now = 1_950_000_000_000;
  const enabled = [{ id: 1, code: "A", factoryId: 7 }, { id: 2, code: "B", factoryId: 7 }];
  const row = (id: number, at: number | null): PollStateRow => ({ configId: id, link: "online", flags: {}, intervalMs: 1000, lastAttemptAt: at, lastOkAt: at, staleAlarmEpisode: null });

  it("★ an ENABLED config with no durable row is STALE (never silently healthy)", () => {
    const h = evaluatePollerHealth(enabled, [row(1, now - 1000)], now, { enabled: true });
    expect(h.state).toBe("stale");
    expect(h.configs.find((c) => c.id === 2)).toMatchObject({ stale: true, lastAttemptAt: null });
  });

  it("all rows fresh ⇒ ok; lastPollAt = the newest attempt (what every instance reports)", () => {
    const h = evaluatePollerHealth(enabled, [row(1, now - 1000), row(2, now - 2000)], now, { enabled: true });
    expect(h).toMatchObject({ state: "ok", lastPollAt: now - 1000 });
  });

  it("a row older than 4 × max(interval, 15 s) ⇒ stale; unreadable rows ⇒ unknown; flags off ⇒ off; nothing enabled ⇒ no_config", () => {
    expect(evaluatePollerHealth(enabled, [row(1, now - 1000), row(2, now - configStaleAfterMs(1000) - 1)], now, { enabled: true }).state).toBe("stale");
    expect(evaluatePollerHealth(enabled, "error", now, { enabled: true }).state).toBe("unknown");
    expect(evaluatePollerHealth(enabled, [], now, { enabled: false }).state).toBe("off");
    expect(evaluatePollerHealth([], [], now, { enabled: true }).state).toBe("no_config");
  });

  it("★ a standby with NO poller memory computes the same health as the leader (rows are the only input)", async () => {
    const store = memStore();
    const rec = async () => ({ ok: true, enabled: true });
    await polls(mk(store, cfg(), [{}], rec), 1);
    const t = Date.now();
    const leaderView = evaluatePollerHealth([{ id: 1, code: "S3", factoryId: 7 }], await store.list(), t, { enabled: true });
    const standbyView = evaluatePollerHealth([{ id: 1, code: "S3", factoryId: 7 }], await store.list(), t, { enabled: true });
    expect(standbyView).toEqual(leaderView);
    expect(leaderView.state).toBe("ok");
  });

  it("★ watchdog: one 'plc_monitor_stale' per config episode (CAS on the durable row), across checks and instances", async () => {
    const store = memStore();
    await store.save({ configId: 1, link: "online", flags: {}, intervalMs: 1000, lastAttemptAt: now - 120_000, lastOkAt: now - 120_000 });
    const events: RecordSafetyEventInput[] = [];
    const rec = async (i: RecordSafetyEventInput) => (events.push(i), { ok: true, enabled: true });
    const run = (t: number) => runPollerWatchdogOnce({ store, listConfigs: async () => enabled, record: rec, now: () => t, enabled: () => true, startedAt: now - 600_000 });
    await run(now);
    await run(now + 5000);
    expect(events.map((e) => [e.eventType, (e.humanPosition as { plcConfigId?: number })?.plcConfigId])).toEqual([
      ["plc_monitor_stale", 1],
      ["plc_monitor_stale", 2], // never had a row ⇒ stale too
    ]);
    await store.save({ configId: 1, link: "online", flags: {}, intervalMs: 1000, lastAttemptAt: now - 100_000, lastOkAt: now - 100_000 }); // recovered, then stale again
    await run(now + 10_000);
    expect(events).toHaveLength(3);
  });

  it("watchdog with an unreadable store logs the blind state (no silent pass)", async () => {
    const store = memStore();
    store.down = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await runPollerWatchdogOnce({ store, listConfigs: async () => enabled, record: async () => ({ ok: true, enabled: true }), now: () => now, enabled: () => true, startedAt: now - 600_000 });
    expect(h.state).toBe("unknown");
    expect(err.mock.calls.some((c) => /UNKNOWN|cannot be read/i.test(String(c[0])))).toBe(true);
  });
});
