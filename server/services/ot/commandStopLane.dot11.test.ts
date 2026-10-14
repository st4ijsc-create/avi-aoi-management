/**
 * doc 81 Đợt 11 K-fix 2 (rulings R-11-i, R-11-h) — the central dispatcher, real dispatch() over the testkit fake DB, recording driver,
 * controllable safety facade (harness copied from commandSafetyRecheck.dot4.test.ts):
 *   (a) STOP treatment by CONTENT, not label: a stop-LABELLED command with arbitrary writes is an ordinary command (no front of
 *       line, no cancelling, a re-check does not give way to it); a set writing exactly the pinned stop value IS a stop;
 *   (c) a STOP flood costs ONE device write (bounded lane, results resolve together);
 *   (d) R-11-h: a protective interlock action waiting in the queue is never cancelled by a STOP; it gets the STOP lane only when its
 *       content is a stop; every gate stays (interlock authorisation path unchanged).
 * doc 81 Đợt 11 final fix wave (rulings R-11-j + addendum, R-11-k) — three cases are FLIPPED (they asserted the D-1 gap the rulings
 * close): an UNVERIFIED stop (stop-labelled, values not the pins) takes the stop lane — never BUSY, ahead of ordinary writes and of a
 * waiting interlock action (which it never cancels); a stop in the lane is never re-checked (C-1). New: C-1 (no shared re-check, pin
 * read at send time), C-2 flag OFF (an unverified stop is never cancelled STOPPED_BEFORE_WRITE), I-1 (a verified STOP cancels an
 * interlock action that would override its pin, queued or in its gates).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeLedgerFakeDb, boundPending, TESTKIT_TOOL } from "./commandDispatcher.testkit";

type Row = Record<string, any>;
const pending = new Map<string, Row>();
const adapters: Row[] = [];
const tags: Row[] = [];
const cmdLog: Row[] = [];
const rules: Row[] = [];
const events: Row[] = [];
let cmdSeq = 1;

vi.mock("drizzle-orm", async () => (await import("./commandDispatcher.testkit")).fakeOrm);
function tableFor(table: any): Row[] {
  switch (table.__table) {
    case "ai_pending_actions": return Array.from(pending.values());
    case "device_adapters": return adapters;
    case "device_tags": return tags;
    case "command_log": return cmdLog;
    case "interlock_rules": return rules;
    case "interlock_events": return events;
    default: return [];
  }
}
const G = vi.hoisted(() => ({
  /** final fix wave — the NEXT getDb() call (= the start of the next dispatch's gates, right after its epoch read) waits on this */
  holdNext: null as null | { entered: () => void; release: Promise<void> },
}));
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => {
    const h = G.holdNext;
    if (h) {
      G.holdNext = null;
      h.entered();
      await h.release;
    }
    return makeLedgerFakeDb({
      tableFor,
      onInsert: (table: any, vals: Row) => {
        const row = { id: cmdSeq++, ...vals };
        if (table.__table === "command_log") cmdLog.push(row);
        return { id: row.id };
      },
    });
  }),
}));
vi.mock("../../../drizzle/schema", () => ({
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" }, tool: { __name: "tool" } },
  deviceAdapters: { __table: "device_adapters", id: { __name: "id" }, machineId: { __name: "machineId" }, isEnabled: { __name: "isEnabled" } },
  deviceTags: { __table: "device_tags", id: { __name: "id" }, adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" }, dataType: { __name: "dataType" }, scale: { __name: "scale" }, offset: { __name: "offset" }, isEnabled: { __name: "isEnabled" }, writable: { __name: "writable" }, stopValue: { __name: "stopValue" } },
  commandLog: { __table: "command_log", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" }, status: { __name: "status" } },
  interlockRules: { __table: "interlock_rules", id: { __name: "id" } },
  interlockEvents: { __table: "interlock_events", id: { __name: "id" } },
}));
vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { INTERLOCK_AUTO_BLOCK: "interlock_auto_block" },
  createAuditContext: (x: any) => x,
  logCrudOperation: vi.fn(async () => ({ id: 1 })),
}));
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async () => ({ blocked: false, failClosed: false, violations: [] })),
}));
vi.mock("../audit/controlAuditService", () => ({ recordAuditEvent: vi.fn(async () => null) }));
vi.mock("../ecosystem/ecosystemEvents", () => ({ publishAnomalyDetected: vi.fn() }));
vi.mock("../notificationService", () => ({ sendNotification: vi.fn(async () => ({ id: 1 })) }));

// ── controllable safety facade + recording driver ─────────────────────────────
const S = vi.hoisted(() => ({
  state: "OK" as "OK" | "BLOCKED" | "UNKNOWN",
  /** the NEXT safety read never answers (the dispatcher's own OT_SAFETY_PREFLIGHT_DEADLINE_MS bounds it) */
  hangNext: false,
  /** final fix wave residual — the NEXT safety read answers only when this resolves */
  gateNext: null as null | Promise<void>,
  reads: [] as number[],
}));
vi.mock("./adapterFacade", () => ({
  createAdapterFacade: () => ({
    getSafetyStatus: async () => {
      S.reads.push(Date.now());
      if (S.hangNext) {
        S.hangNext = false;
        return new Promise(() => undefined);
      }
      if (S.gateNext) {
        const g = S.gateNext;
        S.gateNext = null;
        await g;
      }
      return { state: S.state, source: "test", ts: new Date().toISOString(), ...(S.state === "OK" ? {} : { basis: "unreadable" }) };
    },
  }),
}));
const D = vi.hoisted(() => ({
  log: [] as Array<{ tag: string; value: unknown; start: number }>,
  /** tag ⇒ ms the write takes (default 0) */
  plan: new Map<string, number>(),
  fingerprint: undefined as string | undefined,
  /** K-fix 2 — the NEXT write stays on the wire until the test resolves this (deterministic in-flight command) */
  hold: null as null | Promise<void>,
}));
const driver = {
  isConnected: () => true,
  readTags: async () => [],
  writeTags: (writes: Array<{ tagKey: string; value?: unknown }>) => {
    D.log.push({ tag: writes[0].tagKey, value: writes[0].value, start: Date.now() });
    const hold = D.hold;
    D.hold = null;
    if (hold) return hold.then(() => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
    return new Promise((resolve) => setTimeout(() => resolve(writes.map((w) => ({ tagKey: w.tagKey, ok: true }))), D.plan.get(writes[0].tagKey) ?? 0));
  },
};
vi.mock("./otManager", () => ({
  getActiveDriver: vi.fn(() => driver),
  getActiveConnectionFingerprint: vi.fn(() => D.fingerprint),
  adapterSessionResetBoundMs: vi.fn(() => 300),
  resetAdapterSession: vi.fn(async () => ({ reset: true, via: "supervisor" })),
}));

import { dispatch, _resetAdapterCommandQueuesForTests, _adapterCommandQueueDepthForTests, _stopLaneWaitingMembersForTests, OT_SAFETY_PREFLIGHT_DEADLINE_MS } from "./commandDispatcher";
import { _adapterQueueLineForTests, _staleWriteRiskIntentIdsForTests } from "./otDeviceWrite";
import { adapterTargetFingerprint } from "./adapterTarget";

/** The first write is slower than the re-check threshold, so the command queued behind it waits past it. */
const SLOW = OT_SAFETY_PREFLIGHT_DEADLINE_MS + 300;
let actSeq = 0;
function input(tagKey: string, commandType: string, value: unknown = true) {
  const actionId = `f7-act-${++actSeq}`;
  const inp = {
    adapterId: 10,
    machineId: 5,
    commandType,
    writes: [{ tagKey, value }],
    triggeredBy: { kind: "hitl" as const, actionId, tool: TESTKIT_TOOL, confirmedBy: 1, requestedBy: 1 },
    lang: "vi" as const,
    idempotencyKey: `f7-${actSeq}`,
  };
  pending.set(actionId, boundPending(actionId, inp));
  return inp;
}
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}
async function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`still pending after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(t);
  }
}
/** A slow write A occupies the adapter; command B is queued behind it (its preflight passes NOW, state OK). */
async function slowWriteThen(bTag: string, bType: string, bValue: unknown = true) {
  D.plan.set("cmd_speed", SLOW);
  const pA = dispatch(input("cmd_speed", "set_speed"));
  expect(await until(() => D.log.length === 1, 2000)).toBe(true);
  const readsBefore = S.reads.length;
  const pB = dispatch(input(bTag, bType, bValue));
  expect(await until(() => S.reads.length === readsBefore + 1, 2000)).toBe(true); // B's preflight ran (OK)
  await new Promise((r) => setTimeout(r, 50)); // B is now queued behind A
  return { pA, pB };
}

const ENV = ["INTERLOCK_AUTO_BLOCK_ENABLED", "OT_CMD_QUEUE_MAX", "OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "OT_CONTROL_TIMEOUT_MS", "OT_READBACK_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];
let warnSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  pending.clear();
  adapters.length = 0;
  tags.length = 0;
  cmdLog.length = 0;
  rules.length = 0;
  events.length = 0;
  cmdSeq = 1;
  D.log.length = 0;
  D.plan.clear();
  D.hold = null;
  G.holdNext = null;
  S.state = "OK";
  S.hangNext = false;
  S.gateNext = null;
  S.reads.length = 0;
  _resetAdapterCommandQueuesForTests();
  process.env.OT_CONTROL_ENABLED = "true";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  delete process.env.OT_SAFETY_PREFLIGHT_ENABLED; // default ON
  process.env.OT_CMD_SERIALIZE_ENABLED = "true";
  process.env.OT_CONTROL_TIMEOUT_MS = String(SLOW + 2000);
  delete process.env.OT_READBACK_ENABLED;
  const adapterRow = { id: 10, machineId: 5, code: "A10", isEnabled: true, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", connectionOptions: null };
  adapters.push(adapterRow);
  D.fingerprint = adapterTargetFingerprint({ protocol: adapterRow.protocol, endpoint: adapterRow.endpoint, machineId: adapterRow.machineId, connectionOptions: null });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_speed", address: "ns=1;s=Speed", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  tags.push({ id: 101, adapterId: 10, tagKey: "cmd_jog", address: "ns=1;s=Jog", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  tags.push({ id: 102, adapterId: 10, tagKey: "cmd_stop", address: "ns=1;s=Stop", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  // cmd_run carries a STOP PIN (false) ⇒ a "stop" writing cmd_run=false is a PINNED stop (Đợt 1D).
  tags.push({ id: 104, adapterId: 10, tagKey: "cmd_block", address: "ns=1;s=Block", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
  delete process.env.OT_CMD_QUEUE_MAX;
  tags.push({ id: 103, adapterId: 10, tagKey: "cmd_run", address: "ns=1;s=Run", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true, stopValue: false });
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  warnSpy.mockRestore();
  errSpy.mockRestore();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const BOUND = SLOW + 3000;



/** an approved auto-block interlock rule + fired event on adapter 10 writing `tag` = `value` (action = commandType) */
let ilSeq = 0;
function interlockInput(action: string, tag: string, value: unknown) {
  const id = 700 + ++ilSeq;
  rules.push({ id, enabled: true, approvedBy: 42, requiresHumanConfirm: false, action, targetAdapterId: 10, targetMachineId: 5, commandTag: tag, commandValue: value });
  events.push({ id: id * 10, ruleId: id, status: "fired" });
  return {
    adapterId: 10,
    machineId: 5,
    commandType: action,
    writes: [{ tagKey: tag, value }],
    triggeredBy: { kind: "interlock" as const, ruleId: id, eventId: id * 10, approvedBy: 42 },
    lang: "vi" as const,
    idempotencyKey: `il-${id}`,
  };
}
/** A write A is ON THE WIRE until `release()` (deterministic: no timing race with cold module loads in later gates). */
async function inFlight() {
  let release!: () => void;
  D.hold = new Promise<void>((r) => (release = r));
  const pA = dispatch(input("cmd_speed", "set_speed"));
  expect(await until(() => D.log.length === 1, 5000)).toBe(true);
  return { pA, release };
}
const depthIs = (n: number) => until(() => _adapterCommandQueueDepthForTests(10) === n, 5000);

describe("K-fix 2 — R-11-h: a protective interlock action is never cancelled by a STOP", () => {
  it("★ (safety-interlock-bypass → R-11-j) an UNVERIFIED stop (stop-labelled, ARBITRARY writes) takes the stop lane ahead of a waiting interlock action but NEVER cancels it", async () => {
    process.env.OT_CMD_QUEUE_MAX = "10";
    const { pA, release } = await inFlight();
    const pL = dispatch(interlockInput("block_downstream", "cmd_block", true));
    expect(await depthIs(2)).toBe(true);
    const pX = dispatch(input("cmd_stop", "stop", true)); // labelled "stop", cmd_stop has no pin ⇒ an UNVERIFIED stop
    expect(await depthIs(3)).toBe(true); // in the lane, L still waiting (not cancelled)
    release();
    const [rA, rL, rX] = await within(Promise.all([pA, pL, pX]), 5000);
    expect(rA.status).toBe("acked");
    expect(rL).toMatchObject({ ok: true, status: "acked" }); // NOT SUPERSEDED_BY_STOP
    expect(rX).toMatchObject({ ok: true, status: "acked" });
    expect(rX.pinnedStop).not.toBe(true); // never treated as the pinned stop
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_stop", "cmd_block"]); // the stop first; the interlock action keeps the last word
  });

  it("★ a PINNED STOP goes first but does NOT cancel the waiting interlock action (it runs after the STOP); an ordinary waiting write is cancelled", async () => {
    process.env.OT_CMD_QUEUE_MAX = "10";
    const { pA, release } = await inFlight();
    const pL = dispatch(interlockInput("block_downstream", "cmd_block", true));
    expect(await depthIs(2)).toBe(true);
    const pW = dispatch(input("cmd_jog", "set_jog"));
    expect(await depthIs(3)).toBe(true);
    const pS = dispatch(input("cmd_run", "stop", false));
    const rW = await within(pW, 5000);
    expect(rW).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" }); // an ordinary write is cancelled
    release();
    const [, rL, rS] = await within(Promise.all([pA, pL, pS]), 5000);
    expect(rS).toMatchObject({ status: "acked", pinnedStop: true });
    expect(rL).toMatchObject({ ok: true, status: "acked" }); // the protective action is not
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_run", "cmd_block"]);
  });

  it("an interlock action whose CONTENT is a stop (pinned tag + pinned value) gets the STOP lane: ahead of the waiting write, which is cancelled", async () => {
    process.env.OT_CMD_QUEUE_MAX = "10";
    const { pA, release } = await inFlight();
    const pW = dispatch(input("cmd_jog", "set_jog"));
    expect(await depthIs(2)).toBe(true);
    const pL = dispatch(interlockInput("stop_line", "cmd_run", false));
    const rW = await within(pW, 5000);
    expect(rW).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" });
    release();
    const [, rL] = await within(Promise.all([pA, pL]), 5000);
    expect(rL).toMatchObject({ ok: true, status: "acked" });
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_run"]);
  });

  it("control: an interlock action that is NOT a stop by content is capped like any command (BUSY when the queue is full) — every gate stays", async () => {
    process.env.OT_CMD_QUEUE_MAX = "1";
    const { pA, release } = await inFlight();
    const rL = await within(dispatch(interlockInput("block_downstream", "cmd_block", true)), 5000);
    expect(rL).toMatchObject({ ok: false, reason: "BUSY" });
    release();
    await within(pA, 3000);
  });
});

describe("K-fix 2 — R-11-i (a): STOP by content, not label", () => {
  it("★ a NON-stop write whose re-check HANGS does NOT give way to a stop-LABELLED command with arbitrary writes (refused only by its own deadline)", async () => {
    const { pA, pB } = await slowWriteThen("cmd_jog", "set_jog");
    await within(pA, BOUND);
    S.hangNext = true;
    expect(await until(() => S.reads.length === 3, 2000)).toBe(true); // B's re-check is in flight
    const pX = dispatch(input("cmd_stop", "stop", true)); // labelled stop, NOT a stop by content
    const rB = await within(pB, OT_SAFETY_PREFLIGHT_DEADLINE_MS + 1500);
    expect(rB.reason).not.toBe("SUPERSEDED_BY_STOP");
    expect(rB).toMatchObject({ ok: false, reason: "SAFETY_UNKNOWN" });
    expect((await within(pX, 3000)).status).toBe("acked");
  }, 30_000);

  it("★ a 'set' writing EXACTLY the pinned stop value IS a stop: the re-checking write gives way, the stop is written at once (ledger: STOP, not pinned STOP)", async () => {
    const { pA, pB } = await slowWriteThen("cmd_jog", "set_jog");
    await within(pA, BOUND);
    S.hangNext = true;
    expect(await until(() => S.reads.length === 3, 2000)).toBe(true);
    const tStop = Date.now();
    const rC = await within(dispatch(input("cmd_run", "set_run", false)), 1500);
    expect(rC).toMatchObject({ status: "acked" });
    expect(rC.pinnedStop).not.toBe(true); // a content stop is never the gate-exempt pinned stop
    expect(D.log.find((w) => w.tag === "cmd_run")!.start - tStop).toBeLessThan(500);
    const rB = await within(pB, 1500);
    expect(rB).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" });
    const bRow = cmdLog.find((r) => r.tagKey === "cmd_jog" && r.status === "rejected")!;
    expect(String(bRow.errorText)).toMatch(/: STOP f7-\d+ was queued after it/);
    expect(String(bRow.errorText)).not.toContain("pinned STOP");
  }, 20_000);

  it("★ C-2 (flipped, R-11-j): an UNVERIFIED stop is NEVER BUSY on a full queue — it waits in the stop lane; a pinned STOP arriving meanwhile cancels it (R-1E-b, kept) and is written", async () => {
    process.env.OT_CMD_QUEUE_MAX = "1";
    const { pA, release } = await inFlight();
    const pX = dispatch(input("cmd_stop", "stop", true));
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 1, 5000)).toBe(true); // in the lane, not refused BUSY
    expect(_adapterQueueLineForTests(10).map((x) => x.cls)).toEqual(["unverified"]);
    const pS = dispatch(input("cmd_run", "stop", false));
    const rX = await within(pX, 5000);
    expect(rX.reason).not.toBe("BUSY");
    expect(rX).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" }); // its unproven value never runs after the pinned STOP
    release();
    expect(await within(pS, 3000)).toMatchObject({ status: "acked", pinnedStop: true });
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_run"]);
    await within(pA, 3000);
  });

  it("★ C-2 (R-11-j): an UNVERIFIED stop on a full queue (no other stop coming) is written right after the in-flight write", async () => {
    process.env.OT_CMD_QUEUE_MAX = "1";
    const { pA, release } = await inFlight();
    const pX = dispatch(input("cmd_stop", "stop", true));
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 1, 5000)).toBe(true);
    release();
    const rX = await within(pX, 3000);
    expect(rX).toMatchObject({ ok: true, status: "acked" });
    expect(rX.pinnedStop).not.toBe(true);
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_stop"]);
    await within(pA, 3000);
  });

  it("★ C-2 (R-11-j): an UNVERIFIED stop is not FIFO behind waiting writes — it runs right after the in-flight write and the waiting ordinary writes are cancelled", async () => {
    process.env.OT_CMD_QUEUE_MAX = "10";
    const { pA, release } = await inFlight();
    const pW1 = dispatch(input("cmd_jog", "set_jog"));
    expect(await depthIs(2)).toBe(true);
    const pW2 = dispatch(input("cmd_block", "set_block"));
    expect(await depthIs(3)).toBe(true);
    const pX = dispatch(input("cmd_stop", "stop", true));
    const [rW1, rW2] = await within(Promise.all([pW1, pW2]), 5000);
    expect(rW1).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" });
    expect(rW2).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" });
    release();
    expect(await within(pX, 3000)).toMatchObject({ ok: true, status: "acked" });
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_stop"]);
    await within(pA, 3000);
  });
});

describe("K-fix 2 — R-11-i (c): a STOP flood is one bounded lane", () => {
  it("★ 25 pinned STOPs while a write is in flight ⇒ queue depth ≤ 2 throughout, ONE device write of the STOP, all 25 answered acked with their own result rows", async () => {
    const { pA, release } = await inFlight();
    let maxDepth = 0;
    const iv = setInterval(() => (maxDepth = Math.max(maxDepth, _adapterCommandQueueDepthForTests(10))), 1);
    const stops = Array.from({ length: 25 }, () => dispatch(input("cmd_run", "stop", false)));
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 25, 10_000)).toBe(true); // all joined ONE waiting group
    release();
    const rs = await within(Promise.all(stops), 5000);
    clearInterval(iv);
    await within(pA, 3000);
    expect(maxDepth).toBeLessThanOrEqual(2);
    expect(rs.every((r) => r.status === "acked" && r.pinnedStop === true)).toBe(true);
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_run"]); // ONE STOP write for 25 STOPs
    expect(cmdLog.filter((r) => r.tagKey === "cmd_run" && r.status === "acked").length).toBe(25); // each STOP's own ledger result
  });
});

describe("K-fix 2 — R-11-i (a): the content test needs the same evidence as the pin (minus the label)", () => {
  it("a 'set' of the pinned value on a STALE connection (adapter re-pointed) is NOT a stop by content: ordinary, BUSY on a full queue", async () => {
    process.env.OT_CMD_QUEUE_MAX = "1";
    const { pA, release } = await inFlight();
    D.fingerprint = "f".repeat(64); // the running connection was made for another target
    const rC = await within(dispatch(input("cmd_run", "set_run", false)), 5000);
    expect(rC).toMatchObject({ ok: false, reason: "BUSY" });
    release();
    await within(pA, 3000);
  });

  it("★ C-1 (R-11-k 2): a stop in the lane is NEVER re-checked — content stop C waits past the threshold behind a slow write, a pinned P arrives, the safety PLC turns BLOCKED: P is written first, then C; nothing refused", async () => {
    const { pA, pB: pC } = await slowWriteThen("cmd_run", "set_run", false); // C = a content stop (not labelled), waits past the re-check threshold
    const pP = dispatch(input("cmd_run", "stop", false)); // the pinned STOP: its own group, AHEAD of C (never joins it)
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 2, 2000)).toBe(true);
    expect(_adapterQueueLineForTests(10).map((x) => x.cls)).toEqual(["pinned", "verified"]);
    S.state = "BLOCKED"; // what people pressing STOP typically see
    const readsBefore = S.reads.length;
    await within(pA, BOUND);
    const [rP, rC] = await within(Promise.all([pP, pC]), 3000);
    expect(rP).toMatchObject({ ok: true, status: "acked", pinnedStop: true });
    expect(rC).toMatchObject({ ok: true, status: "acked" });
    expect(S.reads.length).toBe(readsBefore); // no safety read inside a STOP group
    expect(D.log.map((w) => [w.tag, w.value])).toEqual([["cmd_speed", true], ["cmd_run", false], ["cmd_run", false]]);
  }, 30_000);
});

/** final fix wave — dispatch(), held at the very start of its gates (its getDb, right after the epoch read) until `release()`. */
async function heldInGates(inp: Parameters<typeof dispatch>[0]) {
  let entered!: () => void;
  let release!: () => void;
  const e = new Promise<void>((r) => (entered = r));
  G.holdNext = { entered, release: new Promise<void>((r) => (release = r)) };
  const p = dispatch(inp);
  await e;
  return { p, release };
}

describe("final fix wave — C-2 (R-11-j): an unverified stop is never cancelled STOPPED_BEFORE_WRITE (flag OFF and ON)", () => {
  for (const flag of [false, true]) {
    it(`[flag ${flag ? "ON" : "OFF"}] ★ an unverified stop held in its gates while a pinned STOP is sent is still written (not STOPPED_BEFORE_WRITE)`, async () => {
      process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
      const x = await heldInGates(input("cmd_stop", "stop", true));
      const rS = await within(dispatch(input("cmd_run", "stop", false)), 5000);
      expect(rS).toMatchObject({ status: "acked", pinnedStop: true });
      x.release();
      const rX = await within(x.p, 5000);
      expect(rX.reason).not.toBe("STOPPED_BEFORE_WRITE");
      expect(rX).toMatchObject({ ok: true, status: "acked" });
      expect(D.log.map((w) => w.tag)).toEqual(["cmd_run", "cmd_stop"]);
    });
    it(`[flag ${flag ? "ON" : "OFF"}] control: an ordinary write held in its gates while the pinned STOP is sent IS cancelled (STOPPED_BEFORE_WRITE)`, async () => {
      process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
      const w = await heldInGates(input("cmd_jog", "set_jog"));
      expect(await within(dispatch(input("cmd_run", "stop", false)), 5000)).toMatchObject({ status: "acked", pinnedStop: true });
      w.release();
      expect(await within(w.p, 5000)).toMatchObject({ ok: false, reason: "STOPPED_BEFORE_WRITE" });
      expect(D.log.map((x) => x.tag)).toEqual(["cmd_run"]);
    });
    it(`[flag ${flag ? "ON" : "OFF"}] an unverified stop moves NO epoch: an ordinary write held in its gates while it is sent is written`, async () => {
      process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
      const w = await heldInGates(input("cmd_jog", "set_jog"));
      expect(await within(dispatch(input("cmd_stop", "stop", true)), 5000)).toMatchObject({ ok: true, status: "acked" });
      w.release();
      expect(await within(w.p, 5000)).toMatchObject({ ok: true, status: "acked" });
      expect(D.log.map((x) => x.tag)).toEqual(["cmd_stop", "cmd_jog"]);
    });
  }
});

describe("final fix wave — I-1 (R-11-k 3): a verified STOP cancels an interlock action that would override its pin; others never", () => {
  it("★ [flag ON] a reduce_speed-like interlock action writing a NON-pin value to the pinned tag waits behind W; the pinned STOP cancels it — the pin is the last word", async () => {
    process.env.OT_CMD_QUEUE_MAX = "10";
    const { pA, release } = await inFlight();
    const pL = dispatch(interlockInput("reduce_speed", "cmd_run", true)); // cmd_run's stop pin is false
    expect(await depthIs(2)).toBe(true);
    const pS = dispatch(input("cmd_run", "stop", false));
    const rL = await within(pL, 5000);
    expect(rL).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" });
    release();
    const [, rS] = await within(Promise.all([pA, pS]), 5000);
    expect(rS).toMatchObject({ status: "acked", pinnedStop: true });
    expect(D.log.map((w) => [w.tag, w.value])).toEqual([["cmd_speed", true], ["cmd_run", false]]);
  });

  for (const flag of [false, true]) {
    it(`[flag ${flag ? "ON" : "OFF"}] ★ the same interlock action held in its gates while the pinned STOP is sent ⇒ STOPPED_BEFORE_WRITE, the pin stays`, async () => {
      process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
      const l = await heldInGates(interlockInput("reduce_speed", "cmd_run", true));
      expect(await within(dispatch(input("cmd_run", "stop", false)), 5000)).toMatchObject({ status: "acked", pinnedStop: true });
      l.release();
      expect(await within(l.p, 5000)).toMatchObject({ ok: false, reason: "STOPPED_BEFORE_WRITE" });
      expect(D.log.map((w) => [w.tag, w.value])).toEqual([["cmd_run", false]]);
    });
    it(`[flag ${flag ? "ON" : "OFF"}] control: an interlock action on an UNPINNED tag held in its gates is never cancelled by the STOP`, async () => {
      process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
      const l = await heldInGates(interlockInput("block_downstream", "cmd_block", true));
      expect(await within(dispatch(input("cmd_run", "stop", false)), 5000)).toMatchObject({ status: "acked", pinnedStop: true });
      l.release();
      expect(await within(l.p, 5000)).toMatchObject({ ok: true, status: "acked" });
      expect(D.log.map((w) => w.tag)).toEqual(["cmd_run", "cmd_block"]);
    });
    it(`[flag ${flag ? "ON" : "OFF"}] control: an UNVERIFIED stop never cancels the overriding interlock action (queued or in its gates)`, async () => {
      process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
      const l = await heldInGates(interlockInput("reduce_speed", "cmd_run", true));
      expect(await within(dispatch(input("cmd_stop", "stop", true)), 5000)).toMatchObject({ ok: true, status: "acked" });
      l.release();
      expect(await within(l.p, 5000)).toMatchObject({ ok: true, status: "acked" });
      expect(D.log.map((w) => w.tag)).toEqual(["cmd_stop", "cmd_run"]);
    });
  }
});

describe("final fix wave — C-1 (R-11-k 2): the pin is read at SEND time; every member keeps its own result row", () => {
  it("★ a pinned STOP waiting behind the in-flight write is sent with the pin as it is at SEND time (pin edited meanwhile); its result row says so", async () => {
    const { pA, release } = await inFlight();
    const pS = dispatch(input("cmd_run", "stop", false));
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 1, 5000)).toBe(true);
    tags.find((t) => t.tagKey === "cmd_run")!.stopValue = true; // maker-checker pin edit while the STOP waits
    release();
    const rS = await within(pS, 5000);
    await within(pA, 3000);
    expect(rS).toMatchObject({ status: "acked", pinnedStop: true });
    expect(D.log.map((w) => [w.tag, w.value])).toEqual([["cmd_speed", true], ["cmd_run", true]]); // the CURRENT pin
    const row = cmdLog.find((r) => r.tagKey === "cmd_run" && r.status === "acked")!;
    expect(row.ackValue).toMatchObject({ pinAtSend: { requested: false, sent: true } });
  });

  it("★ two pinned STOPs with DIFFERENT writes never share a write: each is written, each answers from its own write", async () => {
    tags.find((t) => t.tagKey === "cmd_jog")!.stopValue = false; // a second pinned tag
    const { pA, release } = await inFlight();
    const p1 = dispatch(input("cmd_run", "stop", false));
    const p2 = dispatch(input("cmd_jog", "stop", false));
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 2, 5000)).toBe(true);
    expect(_adapterQueueLineForTests(10)).toEqual([{ cls: "pinned", members: 1 }, { cls: "pinned", members: 1 }]);
    release();
    const [r1, r2] = await within(Promise.all([p1, p2]), 5000);
    await within(pA, 3000);
    expect(r1).toMatchObject({ status: "acked", pinnedStop: true });
    expect(r2).toMatchObject({ status: "acked", pinnedStop: true });
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_run", "cmd_jog"]);
  });

  it("★ C-1 (3): a coalesced group whose write TIMES OUT carries EVERY member's intent into the late-result review (stale-write risk), not only the leader's", async () => {
    process.env.OT_CONTROL_TIMEOUT_MS = "300";
    const { pA, release } = await inFlight();
    const p1 = dispatch(input("cmd_run", "stop", false));
    const p2 = dispatch(input("cmd_run", "stop", false));
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 2, 5000)).toBe(true);
    expect(_adapterQueueLineForTests(10)).toEqual([{ cls: "pinned", members: 2 }]); // identical ⇒ one group
    D.plan.set("cmd_run", 2500); // the group's ONE write outlives its timeout and its 1 s grace
    release();
    const [r1, r2] = await within(Promise.all([p1, p2]), 5000);
    await within(pA, 3000);
    expect(r1.status).toBe("timeout");
    expect(r2.status).toBe("timeout");
    expect(await until(() => _staleWriteRiskIntentIdsForTests(10) !== null, 3000)).toBe(true);
    const intents = cmdLog.filter((r) => r.tagKey === "cmd_run" && r.status === "timeout").map((r) => (r.ackValue as { intentId: number }).intentId);
    expect(intents).toHaveLength(2);
    expect([..._staleWriteRiskIntentIdsForTests(10)!].sort()).toEqual([...intents].sort());
    expect(D.log.filter((w) => w.tag === "cmd_run")).toHaveLength(1);
  }, 20_000);
});

describe("final fix wave residual — R-11-m: an UNVERIFIED stop that writes a pinned stop tag with a non-pin value is superseded by a verified STOP sent after its gates began", () => {
  for (const flag of [false, true]) {
    it(`[flag ${flag ? "ON" : "OFF"}] ★ held in its gates while the pinned STOP is sent ⇒ SUPERSEDED_BY_STOP, nothing written — the STOP's pin stays the last word`, async () => {
      process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
      const u = await heldInGates(input("cmd_run", "stop", true)); // stop-typed, cmd_run's pin is false ⇒ unverified AND overriding
      const rS = await within(dispatch(input("cmd_run", "stop", false)), 5000);
      expect(rS).toMatchObject({ status: "acked", pinnedStop: true });
      u.release();
      const rU = await within(u.p, 5000);
      expect(rU).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" });
      expect(rU.reason).not.toBe("STOPPED_BEFORE_WRITE");
      expect(D.log.map((w) => [w.tag, w.value])).toEqual([["cmd_run", false]]);
      const row = cmdLog.find((r) => r.tagKey === "cmd_run" && r.status === "rejected")!;
      expect(String(row.errorText)).toMatch(/^SUPERSEDED_BY_STOP/);
    });
  }

  it("[flag ON] ★ issued while the pinned STOP waits behind the in-flight write (its gates began BEFORE the STOP was sent) ⇒ superseded at its turn, never written after the STOP", async () => {
    const { pA, release } = await inFlight();
    const pS = dispatch(input("cmd_run", "stop", false));
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 1, 5000)).toBe(true);
    const pU = dispatch(input("cmd_run", "stop", true));
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 2, 5000)).toBe(true);
    expect(_adapterQueueLineForTests(10).map((x) => x.cls)).toEqual(["pinned", "unverified"]);
    release();
    const [rS, rU] = await within(Promise.all([pS, pU]), 5000);
    await within(pA, 3000);
    expect(rS).toMatchObject({ status: "acked", pinnedStop: true });
    expect(rU).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" });
    expect(D.log.map((w) => [w.tag, w.value])).toEqual([["cmd_speed", true], ["cmd_run", false]]);
  });

  for (const flag of [false, true]) {
    it(`[flag ${flag ? "ON" : "OFF"}] control: an unverified stop that writes only NON-pinned tags, held in its gates while the pinned STOP is sent, is still written`, async () => {
      process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
      const u = await heldInGates(input("cmd_stop", "stop", true));
      expect(await within(dispatch(input("cmd_run", "stop", false)), 5000)).toMatchObject({ status: "acked", pinnedStop: true });
      u.release();
      expect(await within(u.p, 5000)).toMatchObject({ ok: true, status: "acked" });
      expect(D.log.map((w) => w.tag)).toEqual(["cmd_run", "cmd_stop"]);
    });
    it(`[flag ${flag ? "ON" : "OFF"}] control: the overriding unverified stop issued AFTER the STOP was sent is the operator's newer intent and is written`, async () => {
      process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
      expect(await within(dispatch(input("cmd_run", "stop", false)), 5000)).toMatchObject({ status: "acked", pinnedStop: true });
      expect(await within(dispatch(input("cmd_run", "stop", true)), 5000)).toMatchObject({ ok: true, status: "acked" });
      expect(D.log.map((w) => [w.tag, w.value])).toEqual([["cmd_run", false], ["cmd_run", true]]);
    });
  }
});

describe("final fix wave residual — R-11-m: the check right before the unverified group's device write", () => {
  it("[flag ON] ★ a STOP sent OUTSIDE the queue (central fallback / sweep STOP) while the overriding unverified stop's re-check is running ⇒ superseded right before its write", async () => {
    const { pA, pB: pU } = await slowWriteThen("cmd_run", "stop", true); // U: unverified, overrides cmd_run's pin; waits past the re-check threshold
    let open!: () => void;
    S.gateNext = new Promise<void>((r) => (open = r)); // U's re-check read waits
    await within(pA, BOUND);
    expect(await until(() => S.reads.length === 3, 2000)).toBe(true); // U's re-check is in flight
    const { bumpAdapterStopEpoch } = await import("./otDeviceWrite");
    bumpAdapterStopEpoch(10, { idempotencyKey: "sweep-stop" }); // a verified STOP executed out of the queue (sendCentralAdapterStop)
    open(); // the re-check answers OK
    const rU = await within(pU, 3000);
    expect(rU).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" });
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed"]); // U never reached the driver
  }, 30_000);
});

// ── Scan flag (on 14ba602c5) "safety-interlock-bypass / gate parity", PINNED ONLY — NOT fixed (controller: design decision pending).
// Path: commandDispatcher.executeStopGroup → applyPinsAtSend (R-11-k 2) re-values a VERIFIED group's writes with the pin read at SEND
// time. For a CONTENT stop (verified, not the gate-exempt pinned command: a HITL / FOE "set" of the pin value) every gate — the HITL
// binding (payload hash of the confirmed writes), the policy gate, the interlock gate, the safety preflight — approved the CLASSIFIED
// value; a maker-checker pin edit while it waits makes the device receive a value no gate of that command ever saw.
describe("scan pin — central gate parity: a content stop is sent a value its gates never approved (pin read at send)", () => {
  it.fails("★ [flag ON] content stop 'set_run cmd_run=false' waits in the lane; the pin becomes true; the device must NOT receive true for it", async () => {
    const { pA, release } = await inFlight();
    const pC = dispatch(input("cmd_run", "set_run", false)); // a stop by CONTENT (not the pinned stop command): every gate ran on false
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 1, 5000)).toBe(true);
    expect(_adapterQueueLineForTests(10).map((x) => x.cls)).toEqual(["verified"]);
    tags.find((t) => t.tagKey === "cmd_run")!.stopValue = true;
    release();
    await within(Promise.all([pA, pC]), 5000);
    expect(D.log.filter((w) => w.tag === "cmd_run").map((w) => w.value)).toEqual([false]); // FAILS today: [true]
  });
});

