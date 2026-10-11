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
    state: { load: async () => null, save: async () => undefined, list: async () => [], claimStaleAlarm: async () => false },
    ...extra,
  });
  pollers.push(p);
  return { p, recs };
}

// fix scan 3 (R-8-c): the heartbeat health / watchdog tests that stood here are SUPERSEDED by safetyPlcPoller.scan3.dot8.test.ts
// (health now comes from durable rows; the system_settings heartbeat was removed). The bounded-await tests stay.
describe("(a) no await of the poll chain is unbounded", () => {
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
