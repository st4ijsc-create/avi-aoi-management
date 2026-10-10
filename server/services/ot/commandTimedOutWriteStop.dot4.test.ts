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
const audit = vi.hoisted(() => ({ events: [] as Array<Record<string, any>> }));
vi.mock("../audit/controlAuditService", () => ({
  recordAuditEvent: vi.fn(async (_db: unknown, e: Record<string, any>) => {
    audit.events.push(e);
    return null;
  }),
}));

// ── B3 alert-only — the alarm paths (unified critical event + URGENT inbox), captured ─────────
const alarm = vi.hoisted(() => ({ events: [] as Array<Record<string, any>>, notes: [] as Array<Record<string, any>> }));
vi.mock("../ecosystem/ecosystemEvents", () => ({
  publishAnomalyDetected: vi.fn((p: Record<string, any>) => void alarm.events.push(p)),
}));
vi.mock("../notificationService", () => ({
  sendNotification: vi.fn(async (userId: number, p: Record<string, any>, opts?: Record<string, any>) => {
    alarm.notes.push({ userId, ...p, opts });
    return { id: 1 };
  }),
}));

// ── the session-modelling driver + controllable session reset ────────────────
type WriteLog = { tag: string; session: number; start: number; end?: number; outcome?: string };
const D = vi.hoisted(() => ({
  session: 1,
  log: [] as Array<{ tag: string; session: number; start: number; end?: number; outcome?: string }>,
  hung: [] as Array<{ session: number; finish: (outcome: string, err?: boolean) => void; tag: string; value: unknown }>,
  /** fix scan (3) — the DEVICE: what a read returns. A write that finishes "ok" lands its value here. */
  device: new Map<string, unknown>(),
  /** A hung write rejected by a session close still LANDS on the device this many ms later (null = never). */
  landLateMs: null as number | null,
  /** tag ⇒ value the device keeps returning whatever is written (an old write that keeps winning). */
  sticky: new Map<string, unknown>(),
  /** the device answers reads with NO sample (unverifiable). */
  readEmpty: false,
  /** reads served by the original driver */
  reads: 0,
  /** the adapter is offline (getActiveDriver ⇒ undefined) */
  offline: false,
  /** scan 3 (b) — a REPLACED driver object for the adapter (null = the original). Records its writes. */
  swapped: null as null | { isConnected: () => boolean; readTags: (t: Array<{ tagKey: string }>) => Promise<unknown[]>; writeTags: (w: Array<{ tagKey: string; value?: unknown }>) => Promise<unknown[]>; writes: unknown[] },
  /** fingerprint the running connection reports (= the adapter row's ⇒ pinned stops are honoured). */
  fingerprint: undefined as string | undefined,
  /** tag ⇒ behaviour of its write: "hang" (only a session close ends it), number = answer after N ms, default ok now. */
  plan: new Map<string, "hang" | number>(),
  reset: { mode: "ok" as "ok" | "fail" | "hang", calls: 0, boundMs: 300 },
  /** doc 81 Đợt 5 F3 — the running adapters otManager reports (connection/backup timeoutMs drive the risk window). */
  active: [] as Array<{ adapterId: number; connection: { timeoutMs?: unknown }; backupConnection?: { timeoutMs?: unknown } }>,
}));
function closeSession(): void {
  const s = D.session;
  for (const h of D.hung.filter((x) => x.session === s)) {
    h.finish(`session ${s} closed`, true);
    // fix scan (3) — closing the client session does NOT recall a request already on the wire.
    if (D.landLateMs != null) setTimeout(() => D.device.set(h.tag, h.value), D.landLateMs);
  }
  D.hung = D.hung.filter((x) => x.session !== s);
  D.session += 1;
}
const driver = {
  isConnected: () => true,
  readTags: async (tags: Array<{ tagKey: string }>) =>
    (D.reads++, D.readEmpty ? [] : tags)
      .filter((t) => D.sticky.has(t.tagKey) || D.device.has(t.tagKey))
      .map((t) => ({ tagKey: t.tagKey, value: D.sticky.has(t.tagKey) ? D.sticky.get(t.tagKey) : D.device.get(t.tagKey), quality: "good", ts: new Date() })),
  writeTags: (writes: Array<{ tagKey: string; value?: unknown }>) => {
    const tag = writes[0].tagKey;
    const value = writes[0].value;
    const entry: WriteLog = { tag, session: D.session, start: Date.now() };
    D.log.push(entry);
    const plan = D.plan.get(`${tag}=${String(value)}`) ?? D.plan.get(tag);
    return new Promise((resolve, reject) => {
      const finish = (outcome: string, err?: boolean) => {
        if (entry.end != null) return;
        entry.end = Date.now();
        entry.outcome = outcome;
        if (err) reject(new Error(outcome));
        else {
          for (const w of writes) D.device.set(w.tagKey, w.value);
          resolve(writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
        }
      };
      D.hung.push({ session: entry.session, finish, tag, value });
      if (plan === "hang") return;
      setTimeout(() => finish("ok"), typeof plan === "number" ? plan : 0);
    });
  },
};
vi.mock("./otManager", () => ({
  getActiveDriver: vi.fn(() => (D.offline ? undefined : D.swapped ? D.swapped : driver)),
  getActiveConnectionFingerprint: vi.fn(() => D.fingerprint),
  adapterSessionResetBoundMs: vi.fn(() => D.reset.boundMs),
  listActiveAdapters: vi.fn(() => D.active),
  resetAdapterSession: vi.fn(async () => {
    D.reset.calls += 1;
    if (D.reset.mode === "hang") return new Promise(() => undefined);
    if (D.reset.mode === "fail") return { reset: false, via: "supervisor", error: "connect refused" };
    closeSession();
    return { reset: true, via: "supervisor" };
  }),
}));

import { dispatch, _resetAdapterCommandQueuesForTests, _adapterCommandQueueDepthForTests, _staleWriteRiskSizeForTests, _sweepStaleWriteRiskForTests, _stopWatchCountForTests, OT_STALE_WRITE_RISK_TTL_MS, OT_TIMED_OUT_WRITE_GRACE_MS, staleWriteRiskWindowMs } from "./commandDispatcher";
import { adapterTargetFingerprint } from "./adapterTarget";

const TIMEOUT_MS = 300;
/** QĐ-4b — the ruling's grace (the exported constant is asserted equal to it below). */
const GRACE = 1000;
let actSeq = 0;
function input(tagKey: string, commandType: string, key: string, value: unknown = true) {
  const actionId = `b3-act-${++actSeq}`;
  const inp = {
    adapterId: 10,
    machineId: 5,
    commandType,
    writes: [{ tagKey, value }],
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
  D.device.clear();
  D.landLateMs = null;
  D.sticky.clear();
  D.readEmpty = false;
  D.reads = 0;
  D.offline = false;
  alarm.events.length = 0;
  alarm.notes.length = 0;
  D.swapped = null;
  D.reset.mode = "ok";
  D.reset.calls = 0;
  D.reset.boundMs = 300;
  D.active = [];
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
  const adapterRow = { id: 10, machineId: 5, code: "A10", isEnabled: true, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", connectionOptions: null };
  adapters.push(adapterRow);
  D.fingerprint = adapterTargetFingerprint({ protocol: adapterRow.protocol, endpoint: adapterRow.endpoint, machineId: adapterRow.machineId, connectionOptions: null });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_speed", address: "ns=1;s=Speed", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  tags.push({ id: 101, adapterId: 10, tagKey: "cmd_stop", address: "ns=1;s=Stop", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  // cmd_run carries a STOP PIN (false) ⇒ a "stop" writing cmd_run=false is a PINNED stop (Đợt 1D).
  tags.push({ id: 102, adapterId: 10, tagKey: "cmd_run", address: "ns=1;s=Run", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true, stopValue: false });
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
    // fix scan (2) — the ledger never claims "not applied": the outcome is UNKNOWN.
    const oldRows = cmdLog.filter((r) => String(r.idempotencyKey ?? "").startsWith("b3-old-") && r.status === "timeout");
    expect(oldRows.length).toBeGreaterThan(0);
    for (const r of oldRows) expect(String(r.errorText)).toMatch(/outcome unknown: the write may have been applied/);
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

describe("B3 alert-only (R-4-q) — read-only watch after a STOP that followed an abandoned write", () => {
  const STOP_DONE = TIMEOUT_MS + GRACE + 300 + 700;
  /** Abandoned `start` (hangs, reset closes it) then a STOP on cmd_run; resolves when the STOP is DONE. */
  async function hungRunThenStop() {
    D.plan.set("cmd_run=true", "hang");
    const pRun = dispatch(input("cmd_run", "start", `al-run-${actSeq}`, true));
    expect(await until(() => D.log.length === 1, 2000)).toBe(true);
    const r = await within(dispatch(input("cmd_run", "stop", `al-stop-${actSeq}`, false)), STOP_DONE);
    expect(r.status).toBe("acked");
    expect((await pRun).status).toBe("timeout");
    return r;
  }
  const writesAfterStop = () => D.log.filter((w) => w.tag === "cmd_run").length - 2;
  const unverified = () => audit.events.filter((e) => e.action === "ot_stop_unverified");

  it("★ the old write lands after the STOP ⇒ ONE critical alarm (event + URGENT inbox) + audit on the ABANDONED command; ZERO device writes", async () => {
    D.landLateMs = 300;
    await hungRunThenStop();
    expect(await until(() => D.device.get("cmd_run") === true, 1500)).toBe(true); // re-energised by the late landing
    expect(await until(() => alarm.events.length > 0 && alarm.notes.length > 0, 2500)).toBe(true);
    await new Promise((r) => setTimeout(r, 1200)); // more polls happen — still ONE alarm (no spam)
    expect(alarm.events).toHaveLength(1);
    expect(alarm.events[0]).toMatchObject({ kind: "ot_stop_unverified", severity: "critical", source: "ot", machineId: 5 });
    expect(alarm.notes).toEqual([expect.objectContaining({ userId: 1, priority: "URGENT", type: "ALERT" })]); // same confirmer ⇒ one recipient
    expect(alarm.notes[0].opts).toEqual({ safetyCritical: true }); // Đợt 5 F6 — ignores the recipient's in-app opt-outs
    expect(unverified()).toHaveLength(1);
    const ev = unverified()[0];
    const oldIntent = cmdLog.find((r) => String(r.idempotencyKey ?? "").startsWith("intent:al-run-"));
    expect(ev).toMatchObject({ entityType: "ot_command", entityId: oldIntent!.id }); // linked to the abandoned command's ledger row
    expect(ev.after.drift).toEqual([{ tagKey: "cmd_run", expected: false, actual: true, abandonedValueLanded: true }]);
    expect(writesAfterStop()).toBe(0); // ★ nothing re-sent
    expect(D.device.get("cmd_run")).toBe(true); // the alarm told the operator; the platform did NOT write
  });

  it("★ the device cannot be read (no sample) ⇒ ONE critical alarm, zero writes", async () => {
    await hungRunThenStop();
    D.readEmpty = true;
    expect(await until(() => alarm.events.length > 0, 1500)).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    expect(alarm.events).toHaveLength(1);
    expect(unverified()[0].after.unread).toEqual(["cmd_run"]);
    expect(writesAfterStop()).toBe(0);
  });

  it("the adapter goes OFFLINE mid-watch ⇒ unreadable ⇒ ONE critical alarm, zero writes", async () => {
    await hungRunThenStop();
    D.offline = true;
    expect(await until(() => alarm.events.length > 0, 1500)).toBe(true);
    expect(writesAfterStop()).toBe(0);
  });

  it("★ the old write lands 4 s later (well inside the 10 s risk window) ⇒ still caught", async () => {
    D.landLateMs = 4000;
    await hungRunThenStop();
    expect(await until(() => alarm.events.length > 0, 6000)).toBe(true);
    expect(writesAfterStop()).toBe(0);
  }, 20_000);

  it("the STOP holds: the watch reads, raises nothing, writes nothing", async () => {
    await hungRunThenStop();
    await new Promise((r) => setTimeout(r, 1500));
    expect(alarm.events).toEqual([]);
    expect(audit.events.filter((e) => String(e.action).startsWith("ot_stop_"))).toEqual([]);
    expect(writesAfterStop()).toBe(0);
  });

  it("★ the watch never holds the queue: a newer STOP and a newer command write at once", async () => {
    await hungRunThenStop();
    const t1 = Date.now();
    expect((await within(dispatch(input("cmd_run", "stop", `al-stop2-${actSeq}`, false)), 1000)).status).toBe("acked");
    expect((await within(dispatch(input("cmd_speed", "set_speed", `al-speed-${actSeq}`, true)), 1000)).status).toBe("acked");
    expect(Date.now() - t1).toBeLessThan(400);
  });

  it("★ a newer command that WRITES the STOP's tag ends the watch for it — no alarm about the operator's own start", async () => {
    await hungRunThenStop();
    D.plan.delete("cmd_run=true");
    expect((await within(dispatch(input("cmd_run", "start", `al-start-${actSeq}`, true)), 1000)).status).toBe("acked");
    expect(_stopWatchCountForTests(10)).toBe(0);
    await new Promise((r) => setTimeout(r, 800));
    expect(alarm.events).toEqual([]);
    expect(D.device.get("cmd_run")).toBe(true);
  });

  it("★ a newer command for an UNRELATED tag does not end the watch — a late landing is still alarmed", async () => {
    D.landLateMs = 1200;
    await hungRunThenStop();
    expect((await within(dispatch(input("cmd_speed", "set_speed", `al-other-${actSeq}`, true)), 1000)).status).toBe("acked");
    expect(_stopWatchCountForTests(10)).toBe(1);
    expect(await until(() => alarm.events.length > 0, 3000)).toBe(true);
    expect(writesAfterStop()).toBe(0);
  });

  it("★ fix 1 (R-4-s #3): target changed (adapter reconfigured) mid-watch ⇒ the SAME single critical alarm 'cannot verify — check manually', nothing read through the new target", async () => {
    await hungRunThenStop();
    const readsBefore = D.reads;
    D.fingerprint = "a-different-target";
    expect(await until(() => alarm.events.length > 0, 1500)).toBe(true);
    await new Promise((r) => setTimeout(r, 600));
    expect(alarm.events).toHaveLength(1);
    expect(alarm.events[0]).toMatchObject({ kind: "ot_stop_unverified", severity: "critical" });
    expect(alarm.notes).toHaveLength(1);
    expect(String(alarm.notes[0].message)).toMatch(/cannot be verified.*check manually/);
    expect(unverified()).toHaveLength(1);
    expect(unverified()[0].after).toMatchObject({ reason: "target_changed", unread: ["cmd_run"] });
    expect(D.reads).toBe(readsBefore); // no read after the change
    expect(_stopWatchCountForTests(10)).toBe(0);
  });

  it("★ fix 1 (R-4-s #6): the alarm audit's actor is SYSTEM (null); the abandoned command's confirmer is in the detail", async () => {
    await hungRunThenStop();
    D.readEmpty = true;
    expect(await until(() => unverified().length > 0, 1500)).toBe(true);
    expect(unverified()[0].actorId).toBeNull();
    expect(unverified()[0].after.abandonedWrite).toMatchObject({ confirmedBy: 1 });
  });

  it("★ fix 1 (R-4-r): a reset that uses its WHOLE budget (= the 10 s TTL) still leaves the STOP a watch — a late landing is alarmed", async () => {
    D.plan.set("cmd_run=true", "hang");
    D.reset.mode = "hang";
    D.reset.boundMs = OT_STALE_WRITE_RISK_TTL_MS; // the real default bound (connect timeout 10 s)
    const t0 = Date.now();
    const pRun = dispatch(input("cmd_run", "start", `al-full-${actSeq}`, true));
    expect(await until(() => D.log.length === 1, 2000)).toBe(true);
    const pStop = dispatch(input("cmd_run", "stop", `al-full-stop-${actSeq}`, false));
    // While the reset is still running, time "passes" beyond a TTL counted from the grace: the entry must survive a sweep.
    expect(await until(() => D.reset.calls === 1, TIMEOUT_MS + GRACE + 1000)).toBe(true);
    _sweepStaleWriteRiskForTests(Date.now() + OT_STALE_WRITE_RISK_TTL_MS + 1);
    expect(_staleWriteRiskSizeForTests()).toBe(1);
    const r = await within(pStop, TIMEOUT_MS + GRACE + OT_STALE_WRITE_RISK_TTL_MS + 250 + 1500);
    expect(r.status).toBe("acked");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(TIMEOUT_MS + GRACE + OT_STALE_WRITE_RISK_TTL_MS - 50); // it waited the full budget
    expect((await pRun).status).toBe("timeout");
    expect(_stopWatchCountForTests(10)).toBe(1); // the watch exists although the reset took the whole window
    D.sticky.set("cmd_run", true); // the abandoned start lands now
    expect(await until(() => alarm.events.length > 0, 1500)).toBe(true);
    expect(writesAfterStop()).toBe(0);
  }, 30_000);

  it("★ driver replaced mid-watch ⇒ one 'cannot verify' alarm (target_changed), nothing read from or written to either driver", async () => {
    await hungRunThenStop();
    const swappedReads: unknown[] = [];
    D.swapped = {
      isConnected: () => true,
      readTags: async (t) => {
        swappedReads.push(t);
        return [];
      },
      writeTags: async (w) => w.map((x) => ({ tagKey: x.tagKey, ok: true })),
      writes: [],
    };
    expect(await until(() => alarm.events.length > 0, 1500)).toBe(true);
    expect(unverified()[0].after.reason).toBe("target_changed");
    expect(swappedReads).toEqual([]);
    expect(writesAfterStop()).toBe(0);
  });

  it("★ fix 2 (N2): the watch window starts at the STOP, not at the reset's end — a STOP late in the risk window still watches a full TTL", async () => {
    D.plan.set("cmd_run=true", "hang");
    const pRun = dispatch(input("cmd_run", "start", `al-n2-${actSeq}`, true));
    expect((await within(pRun, TIMEOUT_MS + 700)).status).toBe("timeout");
    expect(await until(() => D.reset.calls === 1, GRACE + 1000)).toBe(true); // reset settles ≈ now (quick, "ok")
    const settledAt = Date.now();
    await new Promise((r) => setTimeout(r, 8000)); // the STOP comes 8 s after the reset settled (risk still live)
    const r = await within(dispatch(input("cmd_run", "stop", `al-n2-stop-${actSeq}`, false)), 1500);
    expect(r.status).toBe("acked");
    expect(_stopWatchCountForTests(10)).toBe(1);
    await new Promise((r2) => setTimeout(r2, 5000)); // settle + 13 s: past a window anchored at the reset's end
    expect(Date.now() - settledAt).toBeGreaterThan(OT_STALE_WRITE_RISK_TTL_MS + 2000);
    D.sticky.set("cmd_run", true); // the abandoned start lands now — 5 s after the STOP
    expect(await until(() => alarm.events.length > 0, 1500)).toBe(true);
    expect(writesAfterStop()).toBe(0);
  }, 30_000);

  it("(b) state hygiene: the watch unregisters when it ends; the risk map is swept after its TTL", async () => {
    await hungRunThenStop();
    expect(_stopWatchCountForTests(10)).toBe(1);
    expect(_staleWriteRiskSizeForTests()).toBe(1);
    D.sticky.set("cmd_run", true);
    expect(await until(() => alarm.events.length > 0, 1500)).toBe(true);
    expect(await until(() => _stopWatchCountForTests(10) === 0, 500)).toBe(true);
    _sweepStaleWriteRiskForTests(Date.now() + OT_STALE_WRITE_RISK_TTL_MS + 1);
    expect(_staleWriteRiskSizeForTests()).toBe(0);
  });

  it("a STOP with NO abandoned write before it is not watched (no reads, no alarm)", async () => {
    const r = await within(dispatch(input("cmd_run", "stop", `al-plain-${actSeq}`, false)), 1000);
    expect(r.status).toBe("acked");
    D.sticky.set("cmd_run", true);
    await new Promise((res) => setTimeout(res, 600));
    expect(alarm.events).toEqual([]);
    expect(D.log).toHaveLength(1);
    expect(D.reads).toBe(0);
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

// doc 81 Đợt 5 task F3 (item 29) — the risk window per adapter = max(10 s, 2 × the driver's request/connect timeout).
// Every built-in OT driver uses `connection.timeoutMs ?? 5000` as BOTH its connect and its request timeout.
describe("Đợt 5 F3 — stale-write risk window per adapter = max(10 s, 2 × driver timeout)", () => {
  it("formula: floor 10 s; 2 × connection.timeoutMs; the larger of primary/backup; driver default 5000 when unset/garbage", () => {
    expect(OT_STALE_WRITE_RISK_TTL_MS).toBe(10_000);
    D.active = [{ adapterId: 10, connection: {} }];
    expect(staleWriteRiskWindowMs(10)).toBe(10_000); // unset ⇒ driver default 5000 ⇒ 10 s
    D.active = [{ adapterId: 10, connection: { timeoutMs: 3000 } }];
    expect(staleWriteRiskWindowMs(10)).toBe(10_000); // floor
    D.active = [{ adapterId: 10, connection: { timeoutMs: 7000 } }];
    expect(staleWriteRiskWindowMs(10)).toBe(14_000);
    D.active = [{ adapterId: 10, connection: { timeoutMs: 7000 }, backupConnection: { timeoutMs: 9000 } }];
    expect(staleWriteRiskWindowMs(10)).toBe(18_000); // the slower endpoint counts (HA failover)
    for (const bad of [-5, 0, Number.NaN, "8000", null]) {
      D.active = [{ adapterId: 10, connection: { timeoutMs: bad } }];
      expect(staleWriteRiskWindowMs(10)).toBe(10_000);
    }
    D.active = [{ adapterId: 11, connection: { timeoutMs: 20_000 } }];
    expect(staleWriteRiskWindowMs(10)).toBe(10_000); // another adapter's config never counts
  });

  it("adapter not in the running set ⇒ conservative: 2 × its reset (connect) bound, never below 10 s", () => {
    D.active = [];
    D.reset.boundMs = 8000;
    expect(staleWriteRiskWindowMs(10)).toBe(16_000);
    D.reset.boundMs = 300;
    expect(staleWriteRiskWindowMs(10)).toBe(10_000);
  });

  it("the risk ENTRY of an abandoned write lives for the adapter's window (timeoutMs 7000 ⇒ 14 s), not a fixed 10 s", async () => {
    D.active = [{ adapterId: 10, connection: { timeoutMs: 7000 } }];
    D.plan.set("cmd_run=true", "hang");
    const pRun = dispatch(input("cmd_run", "start", `f3-run-${actSeq}`, true));
    expect((await within(pRun, TIMEOUT_MS + 700)).status).toBe("timeout");
    expect(await until(() => D.reset.calls === 1, GRACE + 1000)).toBe(true);
    await new Promise((r) => setTimeout(r, 50)); // the reset settled ⇒ the entry got its TTL
    const settled = Date.now();
    _sweepStaleWriteRiskForTests(settled + OT_STALE_WRITE_RISK_TTL_MS + 500);
    expect(_staleWriteRiskSizeForTests()).toBe(1); // a fixed 10 s window would be gone
    _sweepStaleWriteRiskForTests(settled + 14_000 + 1);
    expect(_staleWriteRiskSizeForTests()).toBe(0);
  });

  it("★ the STOP's read-only watch lasts the adapter's window: a late landing 11.5 s after the STOP (timeoutMs 7000 ⇒ 14 s) is alarmed", async () => {
    D.active = [{ adapterId: 10, connection: { timeoutMs: 7000 } }];
    D.plan.set("cmd_run=true", "hang");
    const pRun = dispatch(input("cmd_run", "start", `f3-w-${actSeq}`, true));
    expect(await until(() => D.log.length === 1, 2000)).toBe(true);
    const r = await within(dispatch(input("cmd_run", "stop", `f3-w-stop-${actSeq}`, false)), TIMEOUT_MS + GRACE + 300 + 700);
    expect(r.status).toBe("acked");
    expect((await pRun).status).toBe("timeout");
    const stopAt = Date.now();
    await new Promise((res) => setTimeout(res, 11_500));
    expect(Date.now() - stopAt).toBeGreaterThan(OT_STALE_WRITE_RISK_TTL_MS + 1000);
    expect(_stopWatchCountForTests(10)).toBe(1); // still watching past a fixed 10 s window
    D.sticky.set("cmd_run", true); // the abandoned start lands now
    expect(await until(() => alarm.events.length > 0, 1500)).toBe(true);
    expect(D.log.filter((w) => w.tag === "cmd_run")).toHaveLength(2); // zero writes after the STOP
  }, 30_000);
});
