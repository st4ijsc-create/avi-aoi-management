/**
 * doc 81 Đợt 8 task N fix 1 — review M1 / M2 / M4 / M5 of the background safety-PLC poller.
 *   M1 a config edit does not re-send a held e-stop as a new trusted event: state is CARRIED when the read identity
 *      (backend, endpoint, tag map) is unchanged; otherwise the state is a RE-BASELINE (its first decided read is plain);
 *   M2 no `estop_released` while the PLC is offline / unknown (held until online is confirmed — not dropped);
 *   M4 one instance polls: without leadership nothing is read; losing it drops every state (fake gate here; the real
 *      advisory-lock gate is measured on the _test DB below);
 *   M5 failed event inserts back off (no 4 retries/s per config while the DB is down).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.hoisted(() => {
  // N fix 1 (M7) — sdk.ts complains at IMPORT time when OAUTH_SERVER_URL is unset; a local dummy keeps stderr clean (never called).
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import postgres from "postgres";
import type { SafetyPlcConfig, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import { SafetyPlcPoller } from "./safetyPlcPoller";
import { pgPollerLeaderGate, type PollerLeaderGate } from "./safetyPlcPollerLeader";
import { OtReadSafetyPlcBackend, type SafetyPlcBackendReader, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import type { RecordSafetyEventInput } from "../safetyAuditService";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAP = { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" } };

function cfg(over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id: 1,
    code: "FX1",
    name: "fix1",
    vendor: "pilz",
    backend: "modbus",
    endpoint: "tcp://192.0.2.70:502",
    statusMap: { ...MAP, pollIntervalMs: 250 },
    robotId: 3,
    stationId: null,
    lineId: null,
    enabled: true,
    notes: null,
    scope: null,
    corporateCode: null,
    factoryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as SafetyPlcConfig;
}

type Step = SafetyPlcStatusSnapshot | "fail" | { partial: SafetyPlcStatusSnapshot; unreadable: Array<keyof SafetyPlcStatusSnapshot> };
/** The adapter's REAL read class with a scripted readChecked (no network); counts reads. */
function scripted(c: SafetyPlcConfig, steps: Step[]) {
  const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, c.statusMap as never, 500);
  const box = { reads: 0, steps };
  (b as unknown as { readChecked: () => Promise<SafetyPlcCheckedRead> }).readChecked = async () => {
    const s = box.steps[Math.min(box.reads++, box.steps.length - 1)];
    if (s === "fail") throw new Error("ECONNREFUSED");
    if ("partial" in s) return { status: { estop: !!s.partial.estop, zoneOccupied: !!s.partial.zoneOccupied }, unreadable: s.unreadable } as SafetyPlcCheckedRead;
    return { status: { estop: !!s.estop, zoneOccupied: !!s.zoneOccupied }, unreadable: [] };
  };
  return { b, box };
}

const LEADER: PollerLeaderGate = { acquire: async () => true, held: async () => true, release: async () => undefined };
type Rec = { door: string; input: RecordSafetyEventInput };
function mk(cfgs: () => SafetyPlcConfig[], backendFor: (c: SafetyPlcConfig) => SafetyPlcBackendReader, extra: Record<string, unknown> = {}) {
  const recs: Rec[] = [];
  const seam = (door: string) => async (input: RecordSafetyEventInput) => (recs.push({ door, input }), { ok: true, enabled: true });
  const p = new SafetyPlcPoller({
    loadConfigs: async () => cfgs(),
    backendFor: (c) => ({ backend: backendFor(c) }),
    recordPlain: seam("plain"),
    recordTrusted: seam("trusted"),
    isTrustApproved: async () => true,
    leader: LEADER,
    state: { load: async () => null, save: async () => undefined, list: async () => [], claimStaleAlarm: async () => false },
    ...extra,
  });
  pollers.push(p);
  return { p, recs, types: () => recs.map((r) => `${r.door}:${r.input.eventType}`) };
}

const pollers: SafetyPlcPoller[] = [];
const ENV = ["SAFETY_PLC_POLLER_ENABLED", "SAFETY_PLC_ADAPTER_ENABLED", "SAFETY_AUDIT_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, { SAFETY_PLC_POLLER_ENABLED: "true", SAFETY_PLC_ADAPTER_ENABLED: "true", SAFETY_AUDIT_ENABLED: "true" });
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined)];
});
afterEach(async () => {
  while (pollers.length) await pollers.pop()!.stop();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  quiet.forEach((q) => q.mockRestore());
});

describe("M1 — an edit does not re-send a held e-stop as a new trusted event", () => {
  // Re-pinned 2026-10-11 (fix scan 4, "stale identity mapping"): a BINDING change is an identity change ⇒ fresh baseline
  // (the held e-stop is reported to the new target as a normal notice) — only interval / name edits carry the state.
  it("★ only the poll interval / name changed ⇒ state carried; a binding change ⇒ re-baseline (plain)", async () => {
    let c = cfg();
    const { b } = scripted(c, [{ estop: true }]);
    const { p, types } = mk(() => [c], () => b);
    await p.refreshConfigs();
    await p.pollNow(1);
    expect(types()).toEqual(["trusted:estop"]);
    for (const over of [{ statusMap: { ...MAP, pollIntervalMs: 400 } }, { name: "renamed" }] as Array<Partial<SafetyPlcConfig>>) {
      c = cfg(over);
      await p.refreshConfigs();
      await p.pollNow(1);
      await p.pollNow(1);
    }
    expect(types()).toEqual(["trusted:estop"]);
    c = cfg({ name: "renamed", robotId: 4 });
    await p.refreshConfigs();
    await p.pollNow(1);
    expect(types()).toEqual(["trusted:estop", "plain:estop"]);
  });

  it("★ endpoint / tag map changed ⇒ RE-BASELINE: the held e-stop is recorded, but through the PLAIN door; later transitions are trusted again", async () => {
    let c = cfg();
    const first = scripted(c, [{ estop: true }]);
    const second = { cur: scripted(cfg({ endpoint: "tcp://192.0.2.71:502" }), [{ estop: true }, { estop: true }, {}, { estop: true }]) };
    const { p, types, recs } = mk(() => [c], (x) => (x.endpoint === c.endpoint && x.endpoint === "tcp://192.0.2.71:502" ? second.cur.b : first.b));
    await p.refreshConfigs();
    await p.pollNow(1);
    c = cfg({ endpoint: "tcp://192.0.2.71:502" });
    await p.refreshConfigs();
    for (let k = 0; k < 4; k++) await p.pollNow(1);
    expect(types()).toEqual(["trusted:estop", "plain:estop", "trusted:estop_released", "trusted:estop"]);
    expect(String(recs[1].input.notes)).toMatch(/re-baseline/);
  });

  it("a tag-map change (activeWhen) is a re-baseline too", async () => {
    let c = cfg();
    const { b } = scripted(c, [{ estop: true }]);
    const { p, types } = mk(() => [c], () => b);
    await p.refreshConfigs();
    await p.pollNow(1);
    c = cfg({ statusMap: { estop: { address: "coil:1", activeWhen: "falsy" }, zoneOccupied: { address: "coil:2" }, pollIntervalMs: 250 } });
    await p.refreshConfigs();
    await p.pollNow(1);
    expect(types()).toEqual(["trusted:estop", "plain:estop"]);
  });
});

describe("M2 — no 'estop_released' while the PLC is offline / unknown", () => {
  it("★ pressed → offline → first clean read says released ⇒ nothing until online is confirmed; then online + released", async () => {
    const c = cfg();
    const { b } = scripted(c, [{ estop: true }, "fail", {}, {}]);
    const { p, types } = mk(() => [c], () => b);
    await p.refreshConfigs();
    await p.pollNow(1);
    await p.pollNow(1);
    await p.pollNow(1);
    expect(types()).toEqual(["trusted:estop", "trusted:plc_offline"]);
    await p.pollNow(1);
    expect(types()).toEqual(["trusted:estop", "trusted:plc_offline", "trusted:plc_online", "trusted:estop_released"]);
  });

  it("a partial read (another tag unreadable) never releases the e-stop", async () => {
    const c = cfg();
    const { b } = scripted(c, [{ estop: true }, { partial: { estop: false }, unreadable: ["zoneOccupied"] }]);
    const { p, types } = mk(() => [c], () => b);
    await p.refreshConfigs();
    for (let k = 0; k < 3; k++) await p.pollNow(1);
    expect(types()).toEqual(["trusted:estop", "trusted:plc_offline"]);
  });
});

describe("M5 — failed event inserts back off", () => {
  it("★ the DB is down (every record throws): an e-stop held for 1.7 s is retried ≤ 3 times, not every 250 ms", async () => {
    const c = cfg();
    const { b, box } = scripted(c, [{ estop: true }]);
    const tries = { n: 0 };
    const failing = async () => {
      tries.n += 1;
      throw new Error("db down");
    };
    const { p } = mk(() => [c], () => b, { recordPlain: failing, recordTrusted: failing });
    expect(p.start()).toBe(true);
    await sleep(1700);
    expect(tries.n).toBeGreaterThanOrEqual(2);
    expect(tries.n).toBeLessThanOrEqual(3);
    expect(box.reads).toBeLessThanOrEqual(3);
  });

  it("records succeed again ⇒ the transition is recorded (never lost) and the interval returns", async () => {
    const c = cfg();
    const { b } = scripted(c, [{ estop: true }]);
    let down = true;
    const recs: string[] = [];
    const rec = async (i: RecordSafetyEventInput) => {
      if (down) throw new Error("db down");
      recs.push(String(i.eventType));
      return { ok: true, enabled: true };
    };
    const { p } = mk(() => [c], () => b, { recordPlain: rec, recordTrusted: rec });
    await p.refreshConfigs();
    await p.pollNow(1);
    await p.pollNow(1);
    expect(p.snapshot()[0].recordFailStreak).toBeGreaterThanOrEqual(2);
    down = false;
    await p.pollNow(1);
    expect(recs).toEqual(["estop"]);
    expect(p.snapshot()[0].recordFailStreak).toBe(0);
  });
});

describe("M4 — one instance polls (leader gate)", () => {
  it("★ not the leader ⇒ start() schedules nothing and reads nothing", async () => {
    const c = cfg();
    const { b, box } = scripted(c, [{}]);
    const { p } = mk(() => [c], () => b, { leader: { acquire: async () => false, held: async () => false, release: async () => undefined } });
    expect(p.start()).toBe(true);
    await sleep(600);
    expect(box.reads).toBe(0);
    expect(p.snapshot()).toEqual([]);
  });

  it("★ leadership lost at a check ⇒ every state dropped, reads stop; regained ⇒ polling resumes", async () => {
    const c = cfg();
    const { b, box } = scripted(c, [{}]);
    const state = { leader: true };
    const gate: PollerLeaderGate = { acquire: async () => state.leader, held: async () => state.leader, release: async () => undefined };
    const { p } = mk(() => [c], () => b, { leader: gate });
    expect(p.start()).toBe(true);
    await sleep(600);
    expect(box.reads).toBeGreaterThanOrEqual(1);
    state.leader = false;
    expect(await p.leaderCheckAndRefresh()).toBe(false);
    expect(p.snapshot()).toEqual([]);
    const n = box.reads;
    await sleep(600);
    expect(box.reads).toBe(n);
    state.leader = true;
    expect(await p.leaderCheckAndRefresh()).toBe(true);
    await sleep(600);
    expect(box.reads).toBeGreaterThan(n);
  });

  it("a gate that throws ⇒ treated as not leader (fail closed)", async () => {
    const c = cfg();
    const { b, box } = scripted(c, [{}]);
    const { p } = mk(() => [c], () => b, {
      leader: {
        acquire: async () => {
          throw new Error("db down");
        },
        held: async () => false,
        release: async () => undefined,
      },
    });
    p.start();
    await sleep(500);
    expect(box.reads).toBe(0);
    expect(await p.leaderCheckAndRefresh()).toBe(false);
  });

  it("stop() releases the leadership", async () => {
    const released = { n: 0 };
    const { p } = mk(() => [], () => scripted(cfg(), [{}]).b, { leader: { ...LEADER, release: async () => void released.n++ } });
    p.start();
    await sleep(100);
    await p.stop();
    expect(released.n).toBe(1);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("M4 — the real advisory-lock gate on the _test DB", () => {
  it("★ exactly one gate holds the key; release ⇒ the other takes over; a dead session is not 'held'", async () => {
    const key = 480_100_000 + Math.floor(Math.random() * 900); // a private key per run (parallel files never collide)
    const a = pgPollerLeaderGate(key);
    const b = pgPollerLeaderGate(key);
    try {
      expect(await a.acquire()).toBe(true);
      expect(await a.held()).toBe(true);
      expect(await b.acquire()).toBe(false);
      expect(await b.held()).toBe(false);
      // kill a's session from outside ⇒ a must not believe it still leads
      const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
      try {
        const rows = await admin`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND ((classid::bigint << 32) | objid::bigint) = ${key}`;
        expect(rows).toHaveLength(1);
        await admin`SELECT pg_terminate_backend(${rows[0].pid})`;
        const t0 = Date.now();
        expect(await a.held(), "a terminated session must not be believed to hold the lock").toBe(false);
        expect(Date.now() - t0, "held() on a dead session must answer within its bound").toBeLessThan(4000);
        expect(await b.acquire()).toBe(true);
        expect(await b.held()).toBe(true);
        expect(await a.acquire()).toBe(false);
        await b.release();
        expect(await a.acquire()).toBe(true);
      } finally {
        await admin.end();
      }
    } finally {
      await a.release();
      await b.release();
    }
  });
});
