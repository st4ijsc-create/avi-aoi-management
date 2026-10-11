/**
 * doc 81 Đợt 8 task N2 — state TRANSITIONS of a polled safety-PLC become safety events through the device-ingest door:
 *   e-stop pressed / released; guard or light curtain tripped; PLC offline / back online.
 * A REAL (modbus/opcua read) e-stop or zone trip carries the SERVER-set trusted marker (R-5-h) ⇒ its notice is
 * safety-critical; released / offline / online / reset / muting are marked but not of a trusted type; sim never.
 *
 * Oracles: the events captured at the record seam (unit part), and — with the REAL safetyAuditService (DB insert + socket
 * mocked at their seams) — the rules engine's own predicate judged at emit time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SafetyPlcConfig, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";

const E = vi.hoisted(() => ({
  emitted: [] as Array<Record<string, unknown>>,
  atEmit: [] as boolean[],
  nextId: 7000,
  judge: null as null | ((e: Record<string, unknown>) => boolean),
}));
vi.mock("../../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [{ id: E.nextId++, createdAt: new Date(), robotId: null, lineId: null, stationId: null, ...v }],
      }),
    }),
  })),
}));
vi.mock("../../../_core/socket", () => ({
  emitSafetyEvent: vi.fn((e: Record<string, unknown>) => {
    E.emitted.push(e);
    E.atEmit.push(E.judge ? E.judge(e) : false);
  }),
}));

const N = vi.hoisted(() => ({ calls: [] as Array<{ userId: number; opts: any }> }));
vi.mock("../../notificationService", () => ({
  sendSystemNotification: vi.fn(async (userId: number, _d: unknown, opts?: unknown) => {
    N.calls.push({ userId, opts });
    return { id: 1 };
  }),
}));
vi.mock("../../auditTrailService", () => ({ logCrudOperation: vi.fn(async () => ({ id: 1 })) }));

import { SafetyPlcPoller } from "./safetyPlcPoller";
import { startOrchestration, stopOrchestration } from "../../orchestration/rulesEngine";
import { eventBus, EventTypes } from "../../../_core/eventBus";
import { OtReadSafetyPlcBackend, SimSafetyPlcBackend, type SafetyPlcBackendReader, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import { isSafetyCriticalSafetyEvent } from "../../orchestration/rulesEngine";
import { _resetTrustedSafetyMarksForTests, TRUSTED_ORIGIN_EVENT_TYPES } from "../trustedSafetyOrigin";
import type { RecordSafetyEventInput } from "../safetyAuditService";

E.judge = isSafetyCriticalSafetyEvent;

function cfg(id: number, over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id,
    code: `N2-${id}`,
    name: `N2 ${id}`,
    vendor: "pilz",
    backend: "modbus",
    endpoint: "tcp://127.0.0.1:1",
    statusMap: { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" }, resetRequired: { address: "coil:3" }, muting: { address: "coil:4" } },
    robotId: 4,
    stationId: 9,
    lineId: 2,
    enabled: true,
    notes: null,
    scope: "factory",
    corporateCode: "C1",
    factoryId: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as SafetyPlcConfig;
}

type Step = SafetyPlcStatusSnapshot | "fail";
/** A REAL OtReadSafetyPlcBackend instance whose readChecked is scripted by the test (no network). */
function realScripted(c: SafetyPlcConfig, steps: Step[]) {
  const b = new OtReadSafetyPlcBackend("modbus", c.endpoint!, c.statusMap as never, 500);
  let i = 0;
  const flags = ["estop", "zoneOccupied", "resetRequired", "muting"] as const;
  (b as unknown as { readChecked: () => Promise<SafetyPlcCheckedRead> }).readChecked = async () => {
    const s = steps[Math.min(i++, steps.length - 1)];
    if (s === "fail") throw new Error("ECONNREFUSED 127.0.0.1:1");
    const status: SafetyPlcStatusSnapshot = {};
    for (const f of flags) status[f] = s[f] === true;
    return { status, unreadable: [] };
  };
  return b;
}

type Rec = { door: "plain" | "trusted"; input: RecordSafetyEventInput };
function mk(c: SafetyPlcConfig, backend: SafetyPlcBackendReader, opts: { real?: boolean; fail?: () => boolean; approved?: () => boolean | Promise<boolean> } = {}) {
  const recs: Rec[] = [];
  const seam = (door: Rec["door"]) => async (input: RecordSafetyEventInput) => {
    if (opts.fail?.()) throw new Error("db down");
    recs.push({ door, input });
    return { ok: true, enabled: true };
  };
  const p = new SafetyPlcPoller({
    loadConfigs: async () => [c],
    backendFor: () => ({ backend }),
    ...(opts.real ? {} : { recordPlain: seam("plain"), recordTrusted: seam("trusted") }),
    // N fix 1 (I1) — the maker-checker approval (default: approved by a second person)
    isTrustApproved: async () => (opts.approved ? await opts.approved() : true),
  });
  return { p, recs };
}

const saved = process.env.SAFETY_AUDIT_ENABLED;
let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  E.emitted.length = 0;
  E.atEmit.length = 0;
  _resetTrustedSafetyMarksForTests();
  process.env.SAFETY_AUDIT_ENABLED = "true";
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  if (saved === undefined) delete process.env.SAFETY_AUDIT_ENABLED;
  else process.env.SAFETY_AUDIT_ENABLED = saved;
  warn.mockRestore();
  log.mockRestore();
});

async function run(p: SafetyPlcPoller, id: number, n: number) {
  await p.refreshConfigs();
  for (let k = 0; k < n; k++) await p.pollNow(id);
}

describe("doc 81 Đợt 8 N2 — transitions ⇒ events (real backend ⇒ device-ingest door)", () => {
  it("e-stop pressed ⇒ ONE 'estop'; held ⇒ nothing more; released ⇒ ONE 'estop_released' — all through the trusted door", async () => {
    const c = cfg(1);
    const { p, recs } = mk(c, realScripted(c, [{}, { estop: true }, { estop: true }, { estop: true }, {}, {}]));
    await run(p, 1, 6);
    expect(recs.map((r) => [r.door, r.input.eventType])).toEqual([
      ["trusted", "estop"],
      ["trusted", "estop_released"],
    ]);
    expect(recs[0].input).toMatchObject({ robotId: 4, stationId: 9, lineId: 2, detectedBy: "plc", handledBy: "advisory", outcome: "logged_only", scope: "factory", corporateCode: "C1", factoryId: 3 });
    expect(String(recs[0].input.notes)).toMatch(/N2-1/);
    expect(recs[0].input.isNearMiss).toBe(false);
  });

  it("guard / light curtain tripped ⇒ 'zone_intrusion'; reset required ⇒ 'intrusion'; muting ⇒ 'speed_violation' (rising edges only)", async () => {
    const c = cfg(1);
    const { p, recs } = mk(c, realScripted(c, [{}, { zoneOccupied: true }, { zoneOccupied: true, resetRequired: true }, { resetRequired: true, muting: true }, {}]));
    await run(p, 1, 5);
    expect(recs.map((r) => r.input.eventType)).toEqual(["zone_intrusion", "intrusion", "speed_violation"]);
    expect(recs.every((r) => r.door === "trusted")).toBe(true);
  });

  it("an e-stop already active at the FIRST read is reported (state was unknown); a clear first read reports nothing", async () => {
    const c = cfg(1);
    const a = mk(c, realScripted(c, [{ estop: true }]));
    await run(a.p, 1, 2);
    expect(a.recs.map((r) => r.input.eventType)).toEqual(["estop"]);
    const b = mk(c, realScripted(c, [{}]));
    await run(b.p, 1, 3);
    expect(b.recs).toEqual([]);
  });

  it("PLC offline ⇒ ONE 'plc_offline' however many failed polls; back online ⇒ ONE 'plc_online'", async () => {
    const c = cfg(1);
    const { p, recs } = mk(c, realScripted(c, [{}, "fail", "fail", "fail", {}, {}]));
    await run(p, 1, 6);
    expect(recs.map((r) => r.input.eventType)).toEqual(["plc_offline", "plc_online"]);
    expect(String(recs[0].input.notes)).toMatch(/ECONNREFUSED/);
  });

  it("the first read failing ⇒ 'plc_offline' (an enabled PLC that cannot be read is reported, not silently 'ok')", async () => {
    const c = cfg(1);
    const { p, recs } = mk(c, realScripted(c, ["fail"]));
    await run(p, 1, 2);
    expect(recs.map((r) => r.input.eventType)).toEqual(["plc_offline"]);
  });
});

describe("doc 81 Đợt 8 N fix 1 (I1) — a real config takes the trusted door ONLY while approved", () => {
  it("not approved ⇒ every event through the PLAIN door, recorded, with a 'not approved' note", async () => {
    const c = cfg(1);
    const { p, recs } = mk(c, realScripted(c, [{}, { estop: true }, {}]), { approved: () => false });
    await run(p, 1, 3);
    expect(recs.map((r) => [r.door, r.input.eventType])).toEqual([["plain", "estop"], ["plain", "estop_released"]]);
    expect(String(recs[0].input.notes)).toMatch(/not approved/);
  });

  it("the approval lookup throws ⇒ plain door (fail closed for trust), the event is NOT lost", async () => {
    const c = cfg(1);
    const { p, recs } = mk(c, realScripted(c, [{}, { estop: true }]), {
      approved: () => {
        throw new Error("relation safety_plc_config_trust does not exist");
      },
    });
    await run(p, 1, 2);
    expect(recs.map((r) => [r.door, r.input.eventType])).toEqual([["plain", "estop"]]);
  });

  it("approval is asked at RECORD time: revoked between two trips ⇒ the second one is plain", async () => {
    const c = cfg(1);
    let ok = true;
    const { p, recs } = mk(c, realScripted(c, [{}, { estop: true }, {}, { estop: true }]), { approved: () => ok });
    await run(p, 1, 2);
    ok = false;
    await p.pollNow(1);
    await p.pollNow(1);
    expect(recs.map((r) => [r.door, r.input.eventType])).toEqual([["trusted", "estop"], ["plain", "estop_released"], ["plain", "estop"]]);
  });

  it("★ with the REAL audit service: an unapproved real e-stop is NOT safety-critical", async () => {
    const c = cfg(1);
    const { p } = mk(c, realScripted(c, [{}, { estop: true }]), { real: true, approved: () => false });
    await run(p, 1, 2);
    expect(E.emitted.map((e) => e.eventType)).toEqual(["estop"]);
    expect(E.atEmit).toEqual([false]);
  });
});

describe("doc 81 Đợt 8 N2 — sim never takes the trusted door", () => {
  it("sim e-stop / zone trips ⇒ the PLAIN door, detectedBy 'sim'", async () => {
    const c = cfg(2, { backend: "sim", endpoint: null, statusMap: { simScript: [{}, { estop: true, zoneOccupied: true }] } });
    const { p, recs } = mk(c, new SimSafetyPlcBackend([{}, { estop: true, zoneOccupied: true }]));
    await run(p, 2, 2);
    expect(recs.map((r) => [r.door, r.input.eventType, r.input.detectedBy])).toEqual([
      ["plain", "estop", "sim"],
      ["plain", "zone_intrusion", "sim"],
    ]);
  });

  it("a fake 'modbus' backend that is NOT the adapter's real OT read class ⇒ the plain door", async () => {
    let n = 0;
    const fake = { kind: "modbus" as const, read: async () => ({}), readChecked: async () => ({ status: { estop: n++ > 0, zoneOccupied: false, resetRequired: false, muting: false }, unreadable: [] }), label: () => "fake" };
    const c = cfg(3);
    const { p, recs } = mk(c, fake);
    await run(p, 3, 2);
    expect(recs.map((r) => [r.door, r.input.eventType])).toEqual([["plain", "estop"]]);
  });
});

describe("doc 81 Đợt 8 N2 — a failed record is not lost: the transition is retried at the next poll", () => {
  it("record throws ⇒ state not committed ⇒ the same 'estop' is recorded at the next poll", async () => {
    const c = cfg(1);
    let failing = true;
    const { p, recs } = mk(c, realScripted(c, [{ estop: true }]), { fail: () => failing });
    await run(p, 1, 2);
    expect(recs).toEqual([]);
    failing = false;
    await p.pollNow(1);
    await p.pollNow(1);
    expect(recs.map((r) => r.input.eventType)).toEqual(["estop"]);
  });
});

describe("doc 81 Đợt 8 N2 — audit turned off at runtime ⇒ no retry storm", () => {
  it("record answers enabled:false ⇒ the transition is treated as done (one call, not one per poll)", async () => {
    const c = cfg(1);
    const calls: string[] = [];
    const p = new SafetyPlcPoller({
      loadConfigs: async () => [c],
      backendFor: () => ({ backend: realScripted(c, [{ estop: true }]) }),
      recordPlain: async (i) => (calls.push(`plain:${i.eventType}`), { ok: false, enabled: false }),
      recordTrusted: async (i) => (calls.push(`trusted:${i.eventType}`), { ok: false, enabled: false }),
      isTrustApproved: async () => true,
    });
    await run(p, 1, 4);
    expect(calls).toEqual(["trusted:estop"]);
  });
});

describe("doc 81 Đợt 8 N2 — with the REAL safetyAuditService: which notices are safety-critical (R-5-h)", () => {
  it("trusted origin 'safety_plc' allows exactly estop + zone_intrusion", () => {
    expect([...TRUSTED_ORIGIN_EVENT_TYPES.safety_plc].sort()).toEqual(["estop", "zone_intrusion"]);
  });

  it("★ real e-stop / guard trip ⇒ safety-critical AT EMIT; released / offline / online / reset / muting ⇒ not", async () => {
    const c = cfg(1);
    const { p } = mk(c, realScripted(c, [{}, { estop: true, zoneOccupied: true, resetRequired: true, muting: true }, {}, "fail", {}, {}]), { real: true });
    await run(p, 1, 6); // N3: back online after 2 clean reads (flap damping)
    const verdict = Object.fromEntries(E.emitted.map((e, i) => [String(e.eventType), E.atEmit[i]]));
    expect(verdict).toEqual({
      estop: true,
      zone_intrusion: true,
      intrusion: false,
      speed_violation: false,
      estop_released: false,
      plc_offline: false,
      plc_online: false,
    });
    expect(E.emitted.every((e) => e.detectedBy === "plc")).toBe(true);
  });

  it("★ sim e-stop through the REAL service ⇒ NOT safety-critical", async () => {
    const c = cfg(2, { backend: "sim", endpoint: null });
    const { p } = mk(c, new SimSafetyPlcBackend([{}, { estop: true }]), { real: true });
    await run(p, 2, 2);
    expect(E.emitted.map((e) => e.eventType)).toEqual(["estop"]);
    expect(E.atEmit).toEqual([false]);
    expect(E.emitted[0].detectedBy).toBe("sim");
  });
});

describe("doc 81 Đợt 8 N2 — per-machine cap key (P-F4) also distinguishes STATIONS (PLC configs guard stations)", () => {
  const sv = { en: process.env.ORCHESTRATION_ENABLED, ids: process.env.ORCH_NOTIFY_USER_IDS };
  afterEach(() => {
    stopOrchestration();
    if (sv.en === undefined) delete process.env.ORCHESTRATION_ENABLED;
    else process.env.ORCHESTRATION_ENABLED = sv.en;
    if (sv.ids === undefined) delete process.env.ORCH_NOTIFY_USER_IDS;
    else process.env.ORCH_NOTIFY_USER_IDS = sv.ids;
  });

  it("robot > station > line: two PLCs on one line at different stations do not share one bypass budget", async () => {
    N.calls.length = 0;
    process.env.ORCHESTRATION_ENABLED = "true";
    process.env.ORCH_NOTIFY_USER_IDS = "5";
    startOrchestration();
    // one at a time: concurrent FIRST dynamic imports of a vi.mock'ed module stall inside vitest (Đợt 5 F harness note)
    const evs = [
      { id: 1, eventType: "estop", lineId: 2, stationId: 7, isNearMiss: false },
      { id: 2, eventType: "estop", lineId: 2, stationId: 8, isNearMiss: false },
      { id: 3, eventType: "estop", robotId: 3, lineId: 2, stationId: 8, isNearMiss: false },
      { id: 4, eventType: "estop", lineId: 2, isNearMiss: false },
    ];
    for (const [i, ev] of evs.entries()) {
      eventBus.publish(EventTypes.SAFETY_EVENT, ev, "socket");
      const t0 = Date.now();
      while (N.calls.length < i + 1 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 5));
    }
    expect(N.calls.map((c) => c.opts.rateKey).sort()).toEqual(["safety:estop:line:2", "safety:estop:robot:3", "safety:estop:station:7", "safety:estop:station:8"]);
  });
});
