/**
 * Doc 25 T1 — commandDispatcher CỔNG INTERLOCK INLINE (fail-closed) integration.
 *
 * Chứng minh dispatch() gọi evaluateInterlockGate ĐỒNG BỘ TRƯỚC real-write cho lệnh
 * HITL và fail-closed đúng:
 *   - gate.blocked (rule vi phạm) → reject INTERLOCK_BLOCKED, driver.writeTags 0×.
 *   - gate.failClosed (lỗi đánh giá) → reject INTERLOCK_BLOCKED, writeTags 0×.
 *   - gate cho qua → real write (acked), writeTags 1×.
 *   - lệnh kind='interlock' KHÔNG qua cổng này (gate KHÔNG được gọi) → vẫn ghi.
 *   - dry-run (OT_CONTROL_ENABLED off) → simulated, gate KHÔNG được gọi (không real-write).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;

const pending = new Map<string, Row>();
const adapters: Row[] = [];
const tags: Row[] = [];
const cmdLog: Row[] = [];
const rules: Row[] = [];
const events: Row[] = [];
let cmdSeq = 1;

function reset() {
  pending.clear();
  adapters.length = 0;
  tags.length = 0;
  cmdLog.length = 0;
  rules.length = 0;
  events.length = 0;
  cmdSeq = 1;
}

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
    case "interlock_rules": return rules;
    case "interlock_events": return events;
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

vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { INTERLOCK_AUTO_BLOCK: "interlock_auto_block" },
  createAuditContext: (x: any) => x,
  logCrudOperation: vi.fn(async () => ({ id: 1 })),
}));

const writeTagsSpy = vi.fn(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
vi.mock("./otManager", () => ({
  getActiveDriver: vi.fn((_id: number) => ({ isConnected: () => true, writeTags: (...a: any[]) => (writeTagsSpy as any)(...a) })),
}));

// Cổng interlock — điều khiển bằng gateResult; theo dõi có được gọi hay không.
const gateSpy = vi.fn(async () => gateResult);
let gateResult: { blocked: boolean; failClosed: boolean; violations: any[] } = { blocked: false, failClosed: false, violations: [] };
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: (...a: any[]) => (gateSpy as any)(...a),
}));

import { dispatch } from "./commandDispatcher";

const hitlInput = (over: Partial<Parameters<typeof dispatch>[0]> = {}) => ({
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
  gateResult = { blocked: false, failClosed: false, violations: [] };
  process.env.OT_CONTROL_ENABLED = "true"; // real path armed
  process.env.OT_COMMISSIONING_REQUIRED = "false"; // bỏ qua gate commissioning (test riêng)
  process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false"; // doc 48 R1 (T1): bỏ qua safety-PLC preflight (test riêng: commandDispatcher.safety.test.ts)
  delete process.env.OT_READBACK_ENABLED;
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  pending.set("act-1", { id: "act-1", status: "confirmed", userId: 1 });
});

describe("commandDispatcher — cổng interlock inline (HITL)", () => {
  it("gate blocked (rule vi phạm) → reject INTERLOCK_BLOCKED, writeTags 0×", async () => {
    gateResult = { blocked: true, failClosed: false, violations: [{ ruleId: 7, ruleName: "R7", action: "stop_line" }] };
    const r = await dispatch(hitlInput());
    expect(r.ok).toBe(false);
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_BLOCKED");
    expect(gateSpy).toHaveBeenCalledTimes(1);
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog.every((c) => c.status === "rejected")).toBe(true);
    expect(cmdLog[0].errorText).toMatch(/INTERLOCK_BLOCKED/);
    expect(cmdLog[0].errorText).toMatch(/#7\(stop_line\)/);
  });

  it("gate fail-closed (lỗi đánh giá) → reject INTERLOCK_BLOCKED, writeTags 0×", async () => {
    gateResult = { blocked: true, failClosed: true, violations: [] };
    const r = await dispatch(hitlInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_BLOCKED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog[0].errorText).toMatch(/fail-closed/);
  });

  it("gate cho qua → real write acked, writeTags 1×, gate được gọi", async () => {
    gateResult = { blocked: false, failClosed: false, violations: [] };
    const r = await dispatch(hitlInput());
    expect(r.status).toBe("acked");
    expect(r.ok).toBe(true);
    expect(gateSpy).toHaveBeenCalledTimes(1);
    // gate nhận đúng target của lệnh.
    expect(gateSpy.mock.calls[0][0]).toMatchObject({ adapterId: 10, machineId: 5, tagKeys: ["cmd_start"] });
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
  });

  it("dry-run (OT_CONTROL_ENABLED off) → simulated, gate KHÔNG được gọi (không real-write)", async () => {
    process.env.OT_CONTROL_ENABLED = "false";
    const r = await dispatch(hitlInput());
    expect(r.simulated).toBe(true);
    expect(r.status).toBe("simulated");
    expect(gateSpy).not.toHaveBeenCalled();
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });
});

describe("commandDispatcher — cổng interlock inline KHÔNG áp cho kind='interlock'", () => {
  function seedInterlock() {
    tags.push({ id: 101, adapterId: 10, tagKey: "cmd_block", address: "ns=1;s=Block", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
    rules.push({ id: 7, enabled: true, approvedBy: 42, requiresHumanConfirm: false, action: "block_downstream", targetAdapterId: 10, targetMachineId: 5, commandTag: "cmd_block", commandValue: true });
    events.push({ id: 70, ruleId: 7, status: "fired" });
  }

  it("lệnh interlock auto-block: gate inline KHÔNG được gọi dù gateResult=blocked", async () => {
    process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
    gateResult = { blocked: true, failClosed: false, violations: [{ ruleId: 7, ruleName: "R7", action: "block_downstream" }] };
    seedInterlock();
    const r = await dispatch({
      adapterId: 10,
      machineId: 5,
      commandType: "block_downstream",
      writes: [{ tagKey: "cmd_block", value: true }],
      triggeredBy: { kind: "interlock", ruleId: 7, eventId: 70, approvedBy: 42 },
      idempotencyKey: "il-7-70",
    });
    // gate inline không áp cho kind='interlock' → không tự khoá lệnh an toàn.
    expect(gateSpy).not.toHaveBeenCalled();
    expect(r.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
  });
});
