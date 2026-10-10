/**
 * doc 81 Đợt 4 Task B3 (QĐ-4b) — lệnh DỪNG không bao giờ CHỒNG lên một lệnh ghi đã quá hạn.
 *
 * Trước bản vá: `executeWriteAndVerify` đua `driver.writeTags` với hạn giờ; hết hạn ⇒ trả 'timeout' và NHẢ chỗ trong
 * hàng đợi per-adapter NGAY — lệnh ghi cũ vẫn có thể đang chạy trên phiên driver cũ, và lệnh DỪNG xếp sau nó chạy
 * CÙNG lúc trên CÙNG phiên. Sau: chỗ trong hàng giữ tới khi lệnh cũ kết thúc HOẶC hết ân hạn
 * OT_TIMED_OUT_WRITE_GRACE_MS (1000 ms); hết ân hạn ⇒ đặt lại phiên qua otManager.resetAdapterSession (có hạn
 * adapterSessionResetBoundMs). L-7: đặt lại lỗi/quá hạn ⇒ DỪNG VẪN chạy, ghi log + audit `overlapRisk`.
 *
 * Bộ dispatcher THẬT (dispatch, CSDL giả của testkit); otManager giả trả MỘT driver mô hình hoá PHIÊN (giống
 * otSessionReset.dot4.test.ts): mỗi lệnh ghi được ghi lại {tag, phiên, bắt đầu, kết thúc}. Oracle = nhật ký của
 * driver giả. Mọi khẳng định thời gian dùng hạn giờ tường minh.
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
function makeFakeDb() {
  return makeLedgerFakeDb({
    tableFor,
    onInsert: (table: any, vals: Row) => {
      const row = { id: cmdSeq++, ...vals };
      if (table.__table === "command_log") cmdLog.push(row);
      return { id: row.id };
    },
  });
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../../drizzle/schema", () => ({
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" }, tool: { __name: "tool" } },
  deviceAdapters: { __table: "device_adapters", id: { __name: "id" }, machineId: { __name: "machineId" }, isEnabled: { __name: "isEnabled" } },
  deviceTags: { __table: "device_tags", id: { __name: "id" }, adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" }, dataType: { __name: "dataType" }, scale: { __name: "scale" }, offset: { __name: "offset" } },
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
const audit = vi.hoisted(() => ({ events: [] as Array<Record<string, any>> }));
vi.mock("../audit/controlAuditService", () => ({
  recordAuditEvent: vi.fn(async (_db: unknown, e: Record<string, any>) => {
    audit.events.push(e);
    return null;
  }),
}));

// ── the session-modelling driver + controllable session reset ────────────────
type WriteLog = { tag: string; session: number; start: number; end?: number; outcome?: string };
const D = vi.hoisted(() => ({
  session: 1,
  log: [] as Array<{ tag: string; session: number; start: number; end?: number; outcome?: string }>,
  hung: [] as Array<{ session: number; finish: (outcome: string, err?: boolean) => void }>,
  /** tag ⇒ behaviour of its write: "hang" (only a session close ends it), number = answer after N ms, default ok now. */
  plan: new Map<string, "hang" | number>(),
  reset: { mode: "ok" as "ok" | "fail" | "hang", calls: 0, boundMs: 300 },
}));
function closeSession(): void {
  const s = D.session;
  for (const h of D.hung.filter((x) => x.session === s)) h.finish(`session ${s} closed`, true);
  D.hung = D.hung.filter((x) => x.session !== s);
  D.session += 1;
}
const driver = {
  isConnected: () => true,
  readTags: async () => [],
  writeTags: (writes: Array<{ tagKey: string }>) => {
    const tag = writes[0].tagKey;
    const entry: WriteLog = { tag, session: D.session, start: Date.now() };
    D.log.push(entry);
    const plan = D.plan.get(tag);
    return new Promise((resolve, reject) => {
      const finish = (outcome: string, err?: boolean) => {
        if (entry.end != null) return;
        entry.end = Date.now();
        entry.outcome = outcome;
        if (err) reject(new Error(outcome));
        else resolve(writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
      };
      D.hung.push({ session: entry.session, finish });
      if (plan === "hang") return;
      setTimeout(() => finish("ok"), typeof plan === "number" ? plan : 0);
    });
  },
};
vi.mock("./otManager", () => ({
  getActiveDriver: vi.fn(() => driver),
  getActiveConnectionFingerprint: vi.fn(() => undefined),
  adapterSessionResetBoundMs: vi.fn(() => D.reset.boundMs),
  resetAdapterSession: vi.fn(async () => {
    D.reset.calls += 1;
    if (D.reset.mode === "hang") return new Promise(() => undefined);
    if (D.reset.mode === "fail") return { reset: false, via: "supervisor", error: "connect refused" };
    closeSession();
    return { reset: true, via: "supervisor" };
  }),
}));

import { dispatch, _resetAdapterCommandQueuesForTests, OT_TIMED_OUT_WRITE_GRACE_MS } from "./commandDispatcher";

const TIMEOUT_MS = 300;
/** QĐ-4b — the ruling's grace (the exported constant is asserted equal to it below). */
const GRACE = 1000;
let actSeq = 0;
function input(tagKey: string, commandType: string, key: string) {
  const actionId = `b3-act-${++actSeq}`;
  const inp = {
    adapterId: 10,
    machineId: 5,
    commandType,
    writes: [{ tagKey, value: true }],
    triggeredBy: { kind: "hitl" as const, actionId, tool: TESTKIT_TOOL, confirmedBy: 1, requestedBy: 1 },
    lang: "vi" as const,
    idempotencyKey: key,
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
/** Explicit bounded wait for a promise; rejects if still pending after `ms`. */
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
/** The no-overlap oracle: when STOP started, no OTHER write on the SAME session was still running. */
function overlapsOnSession(stop: WriteLog): WriteLog[] {
  return D.log.filter((w) => w !== stop && w.session === stop.session && w.start <= stop.start && (w.end == null || w.end > stop.start));
}

const ENV = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "OT_CONTROL_TIMEOUT_MS", "OT_READBACK_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];
let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
const unhandled: unknown[] = [];
const onUnhandled = (r: unknown) => unhandled.push(r);

beforeEach(() => {
  pending.clear();
  adapters.length = 0;
  tags.length = 0;
  cmdLog.length = 0;
  cmdSeq = 1;
  D.session = 1;
  D.log.length = 0;
  D.hung = [];
  D.plan.clear();
  D.reset.mode = "ok";
  D.reset.calls = 0;
  D.reset.boundMs = 300;
  audit.events.length = 0;
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  _resetAdapterCommandQueuesForTests();
  process.env.OT_CONTROL_ENABLED = "true";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
  process.env.OT_CMD_SERIALIZE_ENABLED = "true";
  process.env.OT_CONTROL_TIMEOUT_MS = String(TIMEOUT_MS);
  delete process.env.OT_READBACK_ENABLED;
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_speed", address: "ns=1;s=Speed", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  tags.push({ id: 101, adapterId: 10, tagKey: "cmd_stop", address: "ns=1;s=Stop", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  errSpy.mockRestore();
  warnSpy.mockRestore();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  // release anything still hanging so no test leaks into the next
  for (const h of D.hung) h.finish("test teardown", true);
  D.hung = [];
});

/** Start a write that will hang, then queue a STOP behind it. Returns timing anchors. */
async function hungWriteThenStop() {
  const t0 = Date.now();
  const pOld = dispatch(input("cmd_speed", "set_speed", `b3-old-${actSeq}`));
  expect(await until(() => D.log.length === 1, 2000)).toBe(true);
  const pStop = dispatch(input("cmd_stop", "stop", `b3-stop-${actSeq}`));
  return { t0, pOld, pStop };
}

describe("B3 — a STOP behind a timed-out write (QĐ-4b, grace = 1000 ms)", () => {
  it("grace constant is the ruling's 1000 ms", () => {
    expect(OT_TIMED_OUT_WRITE_GRACE_MS).toBe(GRACE);
  });

  it("★ old write hangs forever ⇒ STOP starts at timeout + grace (never earlier), on a FRESH session; no overlap", async () => {
    D.plan.set("cmd_speed", "hang");
    const { t0, pOld, pStop } = await hungWriteThenStop();
    // The timed-out command's caller is answered at its own timeout — it does NOT wait for the grace.
    const rOld = await within(pOld, TIMEOUT_MS + 700);
    expect(rOld.status).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(TIMEOUT_MS + GRACE);
    const rStop = await within(pStop, TIMEOUT_MS + GRACE + D.reset.boundMs + 700);
    expect(rStop.status).toBe("acked");
    const stop = D.log.find((w) => w.tag === "cmd_stop")!;
    const startedAfter = stop.start - t0;
    expect(startedAfter).toBeGreaterThanOrEqual(TIMEOUT_MS + GRACE - 20); // never inside the grace
    expect(startedAfter).toBeLessThanOrEqual(TIMEOUT_MS + GRACE + 400); // bounded
    expect(D.reset.calls).toBe(1);
    expect(stop.session).toBe(2); // fresh session
    expect(overlapsOnSession(stop)).toEqual([]);
    const old = D.log.find((w) => w.tag === "cmd_speed")!;
    expect(old.outcome).toBe("session 1 closed"); // the reset ended the old write before the STOP started
    expect(old.end!).toBeLessThanOrEqual(stop.start);
    expect(audit.events.filter((e) => e.action === "ot_write_overlap_risk")).toEqual([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).toEqual([]); // the dangling write's late rejection is caught
  });

  it("★ old write answers late but INSIDE the grace ⇒ STOP starts right after it (same session, no reset, no overlap)", async () => {
    D.plan.set("cmd_speed", TIMEOUT_MS + 400);
    const { t0, pOld, pStop } = await hungWriteThenStop();
    expect((await within(pOld, TIMEOUT_MS + 700)).status).toBe("timeout");
    expect((await within(pStop, TIMEOUT_MS + GRACE + 700)).status).toBe("acked");
    const old = D.log.find((w) => w.tag === "cmd_speed")!;
    const stop = D.log.find((w) => w.tag === "cmd_stop")!;
    expect(old.end!).toBeLessThanOrEqual(stop.start); // waited for the old write
    expect(stop.start - t0).toBeLessThan(TIMEOUT_MS + GRACE); // did not wait the full grace
    expect(D.reset.calls).toBe(0);
    expect(stop.session).toBe(1);
    expect(overlapsOnSession(stop)).toEqual([]);
  });

  it("★ L-7: session reset HANGS ⇒ STOP still starts within timeout + grace + reset bound; overlapRisk logged + audited", async () => {
    D.plan.set("cmd_speed", "hang");
    D.reset.mode = "hang";
    const { t0, pStop } = await hungWriteThenStop();
    const rStop = await within(pStop, TIMEOUT_MS + GRACE + D.reset.boundMs + 700);
    expect(rStop.status).toBe("acked");
    const stop = D.log.find((w) => w.tag === "cmd_stop")!;
    expect(stop.start - t0).toBeGreaterThanOrEqual(TIMEOUT_MS + GRACE - 20);
    expect(stop.start - t0).toBeLessThanOrEqual(TIMEOUT_MS + GRACE + D.reset.boundMs + 400);
    expect(await until(() => audit.events.some((e) => e.action === "ot_write_overlap_risk"), 2000)).toBe(true);
    const ev = audit.events.find((e) => e.action === "ot_write_overlap_risk")!;
    expect(ev).toMatchObject({ entityType: "ot_command", actorId: 1 });
    expect(ev.after).toMatchObject({ adapterId: 10, overlapRisk: true, graceMs: 1000, resetBoundMs: 300 });
    expect(String(ev.after.resetError)).toMatch(/timeout/);
    expect(errSpy.mock.calls.flat().join(" ")).toMatch(/overlapRisk/);
  });

  it("★ L-7: session reset FAILS ⇒ STOP proceeds right after the grace; overlapRisk audited with the reason", async () => {
    D.plan.set("cmd_speed", "hang");
    D.reset.mode = "fail";
    const { t0, pStop } = await hungWriteThenStop();
    expect((await within(pStop, TIMEOUT_MS + GRACE + 700)).status).toBe("acked");
    const stop = D.log.find((w) => w.tag === "cmd_stop")!;
    expect(stop.start - t0).toBeLessThanOrEqual(TIMEOUT_MS + GRACE + 400);
    expect(await until(() => audit.events.some((e) => e.action === "ot_write_overlap_risk"), 2000)).toBe(true);
    expect(audit.events.find((e) => e.action === "ot_write_overlap_risk")!.after.resetError).toBe("connect refused");
  });

  it("a write that answers in time holds nothing (next command starts at once, no reset)", async () => {
    D.plan.set("cmd_speed", 20);
    const { pOld, pStop } = await hungWriteThenStop();
    expect((await within(pOld, 1000)).status).toBe("acked");
    expect((await within(pStop, 1000)).status).toBe("acked");
    expect(D.reset.calls).toBe(0);
  });
});

describe("B3 — queue holdSlot (pure tryEnqueueAdapterCommand)", () => {
  it("the slot waits for the hold (a pinned STOP too); the caller is answered at once; a rejecting hold also releases", async () => {
    const { tryEnqueueAdapterCommand } = await import("./commandDispatcher");
    const ran: string[] = [];
    let releaseHold!: () => void;
    const hold = new Promise<void>((r) => (releaseHold = r));
    const a = tryEnqueueAdapterCommand(77, async () => {
      ran.push("A");
      return { hold };
    }, { holdSlot: (v) => v.hold });
    const s = tryEnqueueAdapterCommand(77, async () => {
      ran.push("S");
      return { hold: undefined as Promise<void> | undefined };
    }, { priorityStop: true, holdSlot: (v) => v.hold });
    if (!a.accepted || !s.accepted) throw new Error("not accepted");
    await within(a.result, 500); // A's caller answered while its slot is still held
    await new Promise((r) => setTimeout(r, 50));
    expect(ran).toEqual(["A"]); // the pinned STOP waits for the hold
    releaseHold();
    await within(s.result, 500);
    expect(ran).toEqual(["A", "S"]);

    const b = tryEnqueueAdapterCommand(78, async () => ({ hold: Promise.reject(new Error("x")) as Promise<void> }), { holdSlot: (v) => v.hold });
    const c = tryEnqueueAdapterCommand(78, async () => "c", {});
    if (!b.accepted || !c.accepted) throw new Error("not accepted");
    await within(b.result, 500);
    await expect(within(c.result, 500)).resolves.toBe("c");
  });
});
