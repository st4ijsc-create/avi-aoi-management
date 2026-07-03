/**
 * Sprint F4a — commandDispatcher unit tests.
 *
 * Proves the F4a safety invariants:
 *   - not confirmed (status proposed) → rejected NOT_CONFIRMED, writeTags 0×
 *   - tag not writable → rejected TAG_NOT_WRITABLE, writeTags 0×
 *   - adapter offline (no active driver) → failed, does NOT throw, writeTags 0×
 *   - idempotency: a 2nd dispatch with the same key returns cached (1 effective)
 *   - DRY-RUN (OT_CONTROL_ENABLED off) → simulated, writeTags 0×
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;

// ── In-memory tables ──────────────────────────────────────────────────────────
const pending = new Map<string, Row>();
const adapters: Row[] = [];
const tags: Row[] = [];
const cmdLog: Row[] = [];
let cmdSeq = 1;

function reset() {
  pending.clear();
  adapters.length = 0;
  tags.length = 0;
  cmdLog.length = 0;
  cmdSeq = 1;
}

// Drizzle-like predicate builder (mirrors writeHandlers.gd3.test.ts).
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "eq" }),
  and: (...ps: any[]) => ({ __and: ps }),
}));

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__and) return pred.__and.every((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  return true;
}

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
  return {
    select: () => ({
      from: (table: any) => ({
        where: (pred: any) => ({
          limit: async () => tableFor(table).filter((r) => matches(r, pred)).slice(0, 1),
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (vals: Row) => ({
        returning: async (_sel?: any) => {
          if (table.__table === "command_log") {
            const row = { id: cmdSeq++, ...vals };
            cmdLog.push(row);
            return [{ id: row.id }];
          }
          return [{ id: cmdSeq++ }];
        },
      }),
    }),
  };
}

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));

vi.mock("../../../drizzle/schema", () => ({
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" } },
  deviceAdapters: { __table: "device_adapters", id: { __name: "id" }, machineId: { __name: "machineId" }, isEnabled: { __name: "isEnabled" } },
  deviceTags: { __table: "device_tags", id: { __name: "id" }, adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" }, dataType: { __name: "dataType" }, scale: { __name: "scale" }, offset: { __name: "offset" } },
  commandLog: { __table: "command_log", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" }, status: { __name: "status" } },
  interlockRules: { __table: "interlock_rules", id: { __name: "id" } },
  interlockEvents: { __table: "interlock_events", id: { __name: "id" } },
}));

// Audit trail — capture INTERLOCK_AUTO_BLOCK calls.
const auditSpy = vi.fn(async () => ({ id: 1 }));
vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { INTERLOCK_AUTO_BLOCK: "interlock_auto_block" },
  createAuditContext: (x: any) => x,
  logCrudOperation: (...a: any[]) => (auditSpy as any)(...a),
}));

// Active driver registry (otManager accessor mocked).
const writeTagsSpy = vi.fn(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
// G2.1 read-back: default echoes the REQUESTED value back (→ verified) — tests override.
const readTagsSpy = vi.fn(async (tags: any[]) =>
  tags.map((t) => ({ tagKey: t.tagKey, raw: null, value: lastWriteValueByKey.get(t.tagKey) ?? null, quality: "good", timestamp: new Date() })),
);
// Capture what was requested so the default readTags can echo it back.
const lastWriteValueByKey = new Map<string, unknown>();
writeTagsSpy.mockImplementation(async (writes: any[]) => {
  for (const w of writes) lastWriteValueByKey.set(w.tagKey, w.value);
  return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
});
let driverConnected = true;
vi.mock("./otManager", () => ({
  getActiveDriver: vi.fn((_id: number) => (driverConnected ? { isConnected: () => true, writeTags: (...a: any[]) => (writeTagsSpy as any)(...a), readTags: (...a: any[]) => (readTagsSpy as any)(...a) } : undefined)),
}));

// Doc 25 T1 — cổng interlock inline được test riêng (interlockGate.test.ts). Ở đây
// mock cho luôn-qua để giữ nguyên ngữ nghĩa F4a/F4b/G2.1 gốc (không liên quan interlock).
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async () => ({ blocked: false, failClosed: false, violations: [] })),
}));

import { dispatch } from "./commandDispatcher";

const baseInput = (over: Partial<Parameters<typeof dispatch>[0]> = {}) => ({
  adapterId: 10,
  machineId: 5,
  commandType: "start",
  writes: [{ tagKey: "cmd_start", value: true }],
  triggeredBy: { kind: "hitl" as const, actionId: "act-1", confirmedBy: 1, requestedBy: 1 },
  lang: "vi" as const,
  idempotencyKey: "key-1",
  ...over,
});

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  lastWriteValueByKey.clear();
  driverConnected = true;
  process.env.OT_CONTROL_ENABLED = "false";
  // C2 (doc 24): these F4a/F4b/G2.1 tests predate the commissioning gate and assert
  // the mode-gate behaviour directly. Opt the NEW gate OUT so their legacy semantics
  // are preserved exactly (dedicated coverage lives in commandDispatcher.commissioning.test.ts).
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  delete process.env.OT_READBACK_ENABLED;
  delete process.env.OT_READBACK_FLOAT_TOLERANCE;
  // restore default writeTags impl after clearAllMocks wiped it.
  writeTagsSpy.mockImplementation(async (writes: any[]) => {
    for (const w of writes) lastWriteValueByKey.set(w.tagKey, w.value);
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  });
  readTagsSpy.mockImplementation(async (tags: any[]) =>
    tags.map((t) => ({ tagKey: t.tagKey, raw: null, value: lastWriteValueByKey.get(t.tagKey) ?? null, quality: "good", timestamp: new Date() })),
  );
  // default: enabled adapter + writable tag + confirmed action
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  pending.set("act-1", { id: "act-1", status: "confirmed", userId: 1 });
});

describe("commandDispatcher — F4a safety", () => {
  it("DRY-RUN: OT_CONTROL_ENABLED off → simulated, writeTags NOT called", async () => {
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(true);
    expect(r.simulated).toBe(true);
    expect(r.status).toBe("simulated");
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog).toHaveLength(1);
    expect(cmdLog[0].status).toBe("simulated");
  });

  it("not confirmed (status proposed) → rejected NOT_CONFIRMED, writeTags 0×", async () => {
    pending.set("act-1", { id: "act-1", status: "proposed", userId: 1 });
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(false);
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("NOT_CONFIRMED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("owner mismatch → rejected NOT_CONFIRMED", async () => {
    pending.set("act-1", { id: "act-1", status: "confirmed", userId: 999 });
    const r = await dispatch(baseInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("NOT_CONFIRMED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("tag not writable → rejected TAG_NOT_WRITABLE, writeTags 0×, no simulate", async () => {
    tags[0].writable = false;
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(false);
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("TAG_NOT_WRITABLE");
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog.every((c) => c.status === "rejected")).toBe(true);
  });

  it("adapter offline (no active driver) → failed, does NOT throw, writeTags 0×", async () => {
    driverConnected = false;
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.reason).toBe("ADAPTER_OFFLINE");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("idempotency: a 2nd dispatch with the same key returns cached (1 commandLog row)", async () => {
    const r1 = await dispatch(baseInput());
    expect(r1.simulated).toBe(true);
    expect(cmdLog).toHaveLength(1);
    const r2 = await dispatch(baseInput());
    expect(r2.status).toBe("simulated");
    expect(cmdLog).toHaveLength(1); // no new row inserted
  });
});

describe("commandDispatcher — F4b real write (OT_CONTROL_ENABLED=true)", () => {
  beforeEach(() => {
    process.env.OT_CONTROL_ENABLED = "true";
    delete process.env.OT_CONTROL_TIMEOUT_MS;
  });

  it("writeTags ok → status=acked, writeTags called ONCE with resolved address", async () => {
    const r = await dispatch(baseInput());
    expect(r.simulated).toBe(false);
    expect(r.status).toBe("acked");
    expect(r.ok).toBe(true);
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    const sent = writeTagsSpy.mock.calls[0][0];
    expect(sent).toHaveLength(1);
    expect(sent[0].tagKey).toBe("cmd_start");
    expect(sent[0].address).toBe("ns=1;s=Start"); // resolved from deviceTags
    expect(cmdLog[0].status).toBe("acked");
    expect(cmdLog[0].sentAt).toBeInstanceOf(Date);
    expect(cmdLog[0].ackedAt).toBeInstanceOf(Date);
  });

  it("writeTags returns ok:false → status=failed", async () => {
    writeTagsSpy.mockImplementationOnce(async (w: any[]) => w.map((x) => ({ tagKey: x.tagKey, ok: false, error: "device NAK" })));
    const r = await dispatch(baseInput());
    expect(r.status).toBe("failed");
    expect(r.ok).toBe(false);
    expect(r.results[0].error).toMatch(/device NAK/);
    expect(cmdLog[0].status).toBe("failed");
    expect(cmdLog[0].ackedAt).toBeNull();
  });

  it("writeTags hangs → status=timeout (short OT_CONTROL_TIMEOUT_MS)", async () => {
    process.env.OT_CONTROL_TIMEOUT_MS = "30";
    writeTagsSpy.mockImplementationOnce(() => new Promise(() => { /* never resolves */ }));
    const r = await dispatch(baseInput());
    expect(r.status).toBe("timeout");
    expect(r.ok).toBe(false);
    expect(cmdLog[0].status).toBe("timeout");
  });

  it("writeTags throws → status=failed (no crash)", async () => {
    writeTagsSpy.mockImplementationOnce(async () => { throw new Error("transport closed"); });
    const r = await dispatch(baseInput());
    expect(r.status).toBe("failed");
    expect(r.results[0].error).toMatch(/transport closed/);
  });

  it("idempotency: 2nd dispatch (same key) returns cached acked, writeTags NOT called again", async () => {
    const r1 = await dispatch(baseInput());
    expect(r1.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    const r2 = await dispatch(baseInput());
    expect(r2.status).toBe("acked");
    expect(r2.ok).toBe(true);
    expect(writeTagsSpy).toHaveBeenCalledTimes(1); // not called again
    expect(cmdLog).toHaveLength(1); // no new row
  });

  it("SAFETY (no regression): not confirmed → rejected, writeTags 0× even with control ON", async () => {
    pending.set("act-1", { id: "act-1", status: "proposed", userId: 1 });
    const r = await dispatch(baseInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("NOT_CONFIRMED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("SAFETY (no regression): tag not writable → rejected, writeTags 0× even with control ON", async () => {
    tags[0].writable = false;
    const r = await dispatch(baseInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("TAG_NOT_WRITABLE");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("inverse scale/offset resolved from deviceTags is passed to driver", async () => {
    tags[0].dataType = "float";
    tags[0].scale = "10";
    tags[0].offset = "1";
    await dispatch(baseInput());
    const sent = writeTagsSpy.mock.calls[0][0];
    expect(sent[0].dataType).toBe("float");
    expect(sent[0].scale).toBe(10);
    expect(sent[0].offset).toBe(1);
  });
});

describe("commandDispatcher — G2.1 read-back ack (OT_CONTROL_ENABLED+OT_READBACK_ENABLED)", () => {
  beforeEach(() => {
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_READBACK_ENABLED = "true";
    delete process.env.OT_CONTROL_TIMEOUT_MS;
  });

  it("read-back matches → acked_verified + readBackValue, ok stays true", async () => {
    // default readTags echoes the requested value (true) back.
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(true);
    expect(r.status).toBe("acked_verified");
    expect(readTagsSpy).toHaveBeenCalledTimes(1);
    expect(cmdLog[0].status).toBe("acked_verified");
    expect(cmdLog[0].readBackValue).toBe(true);
  });

  it("read-back mismatch → acked_unverified, ok STILL true (WARN only, NOT failed)", async () => {
    readTagsSpy.mockImplementationOnce(async (rt: any[]) =>
      rt.map((t) => ({ tagKey: t.tagKey, raw: null, value: false, quality: "good", timestamp: new Date() })),
    );
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(true); // <-- KHÔNG failed
    expect(r.status).toBe("acked_unverified");
    expect(cmdLog[0].status).toBe("acked_unverified");
    expect(cmdLog[0].readBackValue).toBe(false);
    expect(cmdLog[0].errorText).toMatch(/readback mismatch/);
  });

  it("float read-back within tolerance → acked_verified", async () => {
    tags[0].dataType = "float";
    tags[0].scale = "1";
    tags[0].offset = "0";
    const input = baseInput({ writes: [{ tagKey: "cmd_start", value: 25.0 }] });
    readTagsSpy.mockImplementationOnce(async (rt: any[]) =>
      rt.map((t) => ({ tagKey: t.tagKey, raw: null, value: 25.0000004, quality: "good", timestamp: new Date() })),
    );
    const r = await dispatch(input);
    expect(r.status).toBe("acked_verified");
  });

  it("readTags throws → acked_unverified, readTags called EXACTLY once (no retry), ok true", async () => {
    readTagsSpy.mockImplementationOnce(async () => { throw new Error("read failure"); });
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(true);
    expect(r.status).toBe("acked_unverified");
    expect(readTagsSpy).toHaveBeenCalledTimes(1);
    expect(cmdLog[0].errorText).toMatch(/readback unavailable/);
  });

  it("read-back returns bad quality / null value → acked_unverified", async () => {
    readTagsSpy.mockImplementationOnce(async (rt: any[]) =>
      rt.map((t) => ({ tagKey: t.tagKey, raw: null, value: null, quality: "bad", timestamp: new Date() })),
    );
    const r = await dispatch(baseInput());
    expect(r.status).toBe("acked_unverified");
  });

  it("OT_READBACK_ENABLED off → status acked (old), readTags NOT called", async () => {
    process.env.OT_READBACK_ENABLED = "false";
    const r = await dispatch(baseInput());
    expect(r.status).toBe("acked");
    expect(readTagsSpy).not.toHaveBeenCalled();
  });

  it("write failed → NO read-back (readTags not called), status failed", async () => {
    writeTagsSpy.mockImplementationOnce(async (w: any[]) => w.map((x) => ({ tagKey: x.tagKey, ok: false, error: "NAK" })));
    const r = await dispatch(baseInput());
    expect(r.status).toBe("failed");
    expect(readTagsSpy).not.toHaveBeenCalled();
  });

  it("idempotency: 2nd dispatch with new acked_verified status returns cached (ok), no new row, readTags not re-called", async () => {
    const r1 = await dispatch(baseInput());
    expect(r1.status).toBe("acked_verified");
    expect(readTagsSpy).toHaveBeenCalledTimes(1);
    const r2 = await dispatch(baseInput());
    expect(r2.status).toBe("acked_verified");
    expect(r2.ok).toBe(true);
    expect(cmdLog).toHaveLength(1);
    expect(readTagsSpy).toHaveBeenCalledTimes(1); // not re-called
  });
});
