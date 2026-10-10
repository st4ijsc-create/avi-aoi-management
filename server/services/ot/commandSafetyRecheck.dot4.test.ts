/**
 * doc 81 Đợt 4 final wave F7 (final review M5) — the check-then-act gap between the safety preflight and the write.
 *
 * The safety preflight runs BEFORE the write-ahead reservation and the per-adapter queue. A non-stop write queued behind a
 * slow (or B3-held, timed-out) write reached the device on a preflight verdict up to ~11 s old. Now a NON-STOP write whose
 * preflight passed more than OT_SAFETY_PREFLIGHT_DEADLINE_MS ago re-runs the same preflight read just before its write;
 * not OK ⇒ refused with the same reason, nothing written. Stop-typed commands are never re-checked (L-7), and a PINNED STOP
 * queued while a re-check is in flight does not wait for it (the re-checking write gives way, SUPERSEDED_BY_STOP).
 *
 * Real dispatcher (dispatch, testkit fake DB); fake driver records every write {tag, start}; the safety facade is a
 * controllable fake (state / hang). Every timing assertion uses explicit bounds, never the vitest timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeLedgerFakeDb, boundPending, TESTKIT_TOOL } from "./commandDispatcher.testkit";

type Row = Record<string, any>;
const pending = new Map<string, Row>();
const adapters: Row[] = [];
const tags: Row[] = [];
const cmdLog: Row[] = [];
let cmdSeq = 1;

vi.mock("drizzle-orm", async () => (await import("./commandDispatcher.testkit")).fakeOrm);
function tableFor(table: any): Row[] {
  switch (table.__table) {
    case "ai_pending_actions": return Array.from(pending.values());
    case "device_adapters": return adapters;
    case "device_tags": return tags;
    case "command_log": return cmdLog;
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
}));
const driver = {
  isConnected: () => true,
  readTags: async () => [],
  writeTags: (writes: Array<{ tagKey: string; value?: unknown }>) => {
    D.log.push({ tag: writes[0].tagKey, value: writes[0].value, start: Date.now() });
    return new Promise((resolve) => setTimeout(() => resolve(writes.map((w) => ({ tagKey: w.tagKey, ok: true }))), D.plan.get(writes[0].tagKey) ?? 0));
  },
};
vi.mock("./otManager", () => ({
  getActiveDriver: vi.fn(() => driver),
  getActiveConnectionFingerprint: vi.fn(() => D.fingerprint),
  adapterSessionResetBoundMs: vi.fn(() => 300),
  resetAdapterSession: vi.fn(async () => ({ reset: true, via: "supervisor" })),
}));

import { dispatch, _resetAdapterCommandQueuesForTests, OT_SAFETY_PREFLIGHT_DEADLINE_MS } from "./commandDispatcher";
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

const ENV = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "OT_CONTROL_TIMEOUT_MS", "OT_READBACK_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];
let warnSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  pending.clear();
  adapters.length = 0;
  tags.length = 0;
  cmdLog.length = 0;
  cmdSeq = 1;
  D.log.length = 0;
  D.plan.clear();
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

describe("final wave F7 — a non-stop write that waited past OT_SAFETY_PREFLIGHT_DEADLINE_MS re-checks safety just before writing", () => {
  it("★ safety turns BLOCKED while it waits ⇒ refused SAFETY_BLOCKED at its turn, NOTHING written; the intent gets its result row", async () => {
    const { pA, pB } = await slowWriteThen("cmd_jog", "set_jog");
    S.state = "BLOCKED"; // the safety PLC trips while B waits behind A
    expect((await within(pA, BOUND)).status).toBe("acked");
    const rB = await within(pB, BOUND);
    expect(rB).toMatchObject({ ok: false, status: "rejected", reason: "SAFETY_BLOCKED" });
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed"]); // B never reached the driver
    expect(S.reads).toHaveLength(3); // A preflight, B preflight, B re-check
    const bRows = cmdLog.filter((r) => r.tagKey === "cmd_jog" && (r.ackValue as Row | undefined)?.ledger !== "intent");
    expect(bRows).toHaveLength(1);
    expect(bRows[0]).toMatchObject({ status: "rejected" });
    expect(String(bRows[0].errorText)).toMatch(/re-check before the write .* returned BLOCKED/);
  }, 20_000);

  it("safety still OK at its turn ⇒ re-checked, then written (no false refusal)", async () => {
    const { pA, pB } = await slowWriteThen("cmd_jog", "set_jog");
    await within(pA, BOUND);
    expect((await within(pB, BOUND)).status).toBe("acked");
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_jog"]);
    expect(S.reads).toHaveLength(3);
  }, 20_000);

  it("control: a SHORT wait (≤ the deadline) is not re-checked — the preflight verdict is still fresh", async () => {
    D.plan.set("cmd_speed", 200);
    const pA = dispatch(input("cmd_speed", "set_speed"));
    expect(await until(() => D.log.length === 1, 2000)).toBe(true);
    const pB = dispatch(input("cmd_jog", "set_jog"));
    await within(pA, 3000);
    expect((await within(pB, 3000)).status).toBe("acked");
    expect(S.reads).toHaveLength(2);
  });

  it("★ L-7: a stop-typed (unpinned) command is NEVER re-checked — written even though safety turned BLOCKED while it waited", async () => {
    const { pA, pB } = await slowWriteThen("cmd_stop", "stop");
    S.state = "BLOCKED";
    await within(pA, BOUND);
    expect((await within(pB, BOUND)).status).toBe("acked");
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_stop"]);
    expect(S.reads).toHaveLength(2); // A preflight + the stop's own preflight only
  }, 20_000);

  it("★ L-7: a PINNED STOP queued while a re-check HANGS is not held by it — the re-checking write gives way (SUPERSEDED_BY_STOP) and the STOP runs at once", async () => {
    const { pA, pB } = await slowWriteThen("cmd_jog", "set_jog");
    await within(pA, BOUND);
    S.hangNext = true; // B's re-check read never answers (only its 5 s deadline would end it)
    expect(await until(() => S.reads.length === 3, 2000)).toBe(true); // B's re-check is in flight
    const tStop = Date.now();
    const rStop = await within(dispatch(input("cmd_run", "stop", false)), 1500);
    expect(rStop).toMatchObject({ status: "acked", pinnedStop: true });
    const stopWrite = D.log.find((w) => w.tag === "cmd_run")!;
    expect(stopWrite.start - tStop).toBeLessThan(500); // not behind the 5 s re-check deadline
    const rB = await within(pB, 1500);
    expect(rB).toMatchObject({ ok: false, status: "rejected", reason: "SUPERSEDED_BY_STOP" });
    expect(D.log.map((w) => w.tag)).toEqual(["cmd_speed", "cmd_run"]); // B never written
  }, 20_000);
});

describe("final wave G9 (group C review M5) — a waiting command cancelled by a pinned STOP that has NO idempotency key", () => {
  it("★ appError is the localisable NO_KEY variant (no literal 'unknown' in the operator's sentence); with a key it stays OT_COMMAND_SUPERSEDED_BY_STOP { stopKey }", async () => {
    D.plan.set("cmd_speed", 300);
    const pA = dispatch(input("cmd_speed", "set_speed"));
    expect(await until(() => D.log.length === 1, 2000)).toBe(true);
    const pB = dispatch(input("cmd_jog", "set_jog"));
    await new Promise((r) => setTimeout(r, 50)); // B waits behind A
    const stop = input("cmd_run", "stop", false);
    delete (stop as { idempotencyKey?: string }).idempotencyKey; // a STOP sent without an idempotency key
    const pStop = dispatch(stop);
    const rB = await within(pB, 3000);
    expect(rB).toMatchObject({ reason: "SUPERSEDED_BY_STOP", appError: { appCode: "OT_COMMAND_SUPERSEDED_BY_STOP_NO_KEY", appParams: {} } });
    expect(JSON.stringify(rB.appError)).not.toMatch(/unknown/);
    const bRow = cmdLog.find((r) => r.tagKey === "cmd_jog" && r.status === "rejected")!;
    expect(String(bRow.errorText)).not.toMatch(/unknown/);
    await within(pA, 3000);
    expect((await within(pStop, 3000)).status).toBe("acked");

    // control: the same with a keyed STOP keeps the keyed code + param (C7)
    const pA2 = dispatch(input("cmd_speed", "set_speed"));
    expect(await until(() => D.log.length === 3, 2000)).toBe(true);
    const pB2 = dispatch(input("cmd_jog", "set_jog"));
    await new Promise((r) => setTimeout(r, 50));
    const stop2 = input("cmd_run", "stop", false);
    const pStop2 = dispatch(stop2);
    expect(await within(pB2, 3000)).toMatchObject({ appError: { appCode: "OT_COMMAND_SUPERSEDED_BY_STOP", appParams: { stopKey: stop2.idempotencyKey } } });
    await within(pA2, 3000);
    await within(pStop2, 3000);
  });
});
