/**
 * doc 81 Đợt 11 K-fix 2 (rulings R-11-i, R-11-h) — the central dispatcher, real dispatch() over the testkit fake DB, recording driver,
 * controllable safety facade (harness copied from commandSafetyRecheck.dot4.test.ts):
 *   (a) STOP treatment by CONTENT, not label: a stop-LABELLED command with arbitrary writes is an ordinary command (no front of
 *       line, no cancelling, a re-check does not give way to it); a set writing exactly the pinned stop value IS a stop;
 *   (c) a STOP flood costs ONE device write (bounded lane, results resolve together);
 *   (d) R-11-h: a protective interlock action waiting in the queue is never cancelled by a STOP; it gets the STOP lane only when its
 *       content is a stop; every gate stays (interlock authorisation path unchanged).
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
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () =>
    makeLedgerFakeDb({
      tableFor,
      onInsert: (table: any, vals: Row) => {
        const row = { id: cmdSeq++, ...vals };
        if (table.__table === "command_log") cmdLog.push(row);
        return { id: row.id };
      },
    }),
  ),
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
  S.state = "OK";
  S.hangNext = false;
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
  it("★ (safety-interlock-bypass) a stop-LABELLED command with ARBITRARY writes neither cancels nor jumps a waiting interlock action", async () => {
    process.env.OT_CMD_QUEUE_MAX = "10";
    const { pA, release } = await inFlight();
    const pL = dispatch(interlockInput("block_downstream", "cmd_block", true));
    expect(await depthIs(2)).toBe(true);
    const pX = dispatch(input("cmd_stop", "stop", true)); // labelled "stop", cmd_stop has no pin ⇒ NOT a stop by content
    expect(await depthIs(3)).toBe(true); // queued behind L (ordinary), L still waiting
    release();
    const [rA, rL, rX] = await within(Promise.all([pA, pL, pX]), 5000);
    expect(rA.status).toBe("acked");
    expect(rL).toMatchObject({ ok: true, status: "acked" }); // NOT SUPERSEDED_BY_STOP
    expect(rX).toMatchObject({ ok: true, status: "acked" });
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_block", "cmd_stop"]); // FIFO: no front of line for a label
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

  it("a stop-LABELLED command with arbitrary writes is capped: BUSY on a full queue (the pinned STOP is not)", async () => {
    process.env.OT_CMD_QUEUE_MAX = "1";
    const { pA, release } = await inFlight();
    const rX = await within(dispatch(input("cmd_stop", "stop", true)), 5000);
    expect(rX).toMatchObject({ ok: false, reason: "BUSY" });
    const pS = dispatch(input("cmd_run", "stop", false));
    expect(await until(() => _stopLaneWaitingMembersForTests(10) === 1, 5000)).toBe(true);
    release();
    expect(await within(pS, 3000)).toMatchObject({ status: "acked", pinnedStop: true });
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

  it("a content stop's OWN re-check does not give way to a pinned STOP queued meanwhile (STOPs never cancel each other): it ends by its own deadline, the pinned STOP runs after it", async () => {
    const { pA, pB } = await slowWriteThen("cmd_run", "set_run", false); // B = a content stop (not labelled), waits past the re-check threshold
    await within(pA, BOUND);
    S.hangNext = true;
    expect(await until(() => S.reads.length === 3, 2000)).toBe(true); // B's re-check is in flight
    const pS = dispatch(input("cmd_run", "stop", false));
    const rB = await within(pB, OT_SAFETY_PREFLIGHT_DEADLINE_MS + 1500);
    expect(rB.reason).not.toBe("SUPERSEDED_BY_STOP");
    expect(rB).toMatchObject({ ok: false, reason: "SAFETY_UNKNOWN" });
    expect(await within(pS, 3000)).toMatchObject({ status: "acked", pinnedStop: true });
  }, 30_000);
});
