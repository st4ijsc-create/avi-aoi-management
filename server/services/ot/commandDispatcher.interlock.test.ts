/**
 * Sprint F5b — commandDispatcher INTERLOCK auto-block path tests.
 *
 * Proves the 6-layer safety gate for triggeredBy.kind='interlock':
 *   - rule not approved (approvedBy null) → reject, writeTags 0×
 *   - approvedBy mismatch (anti-forgery) → reject, writeTags 0×
 *   - requiresHumanConfirm=true → reject (not the auto path)
 *   - rule enabled=false → reject
 *   - tag not writable → reject TAG_NOT_WRITABLE (shared gate)
 *   - INTERLOCK_AUTO_BLOCK_ENABLED=false → reject INTERLOCK_AUTO_BLOCK_DISABLED, writeTags 0×
 *   - OT_CONTROL_ENABLED=false → simulated (no real write)
 *   - all gates pass → writeTags 1×, commandLog triggerKind='interlock'+ruleId+eventId+approvedBy,
 *     audit INTERLOCK_AUTO_BLOCK fired
 *   - idempotency il-rule-event → 2nd call cached, no 2nd write
 *   - kind='hitl' regression (F4 still works)
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

const auditSpy = vi.fn(async () => ({ id: 1 }));
vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { INTERLOCK_AUTO_BLOCK: "interlock_auto_block" },
  createAuditContext: (x: any) => x,
  logCrudOperation: (...a: any[]) => (auditSpy as any)(...a),
}));

const writeTagsSpy = vi.fn(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
let driverConnected = true;
vi.mock("./otManager", () => ({
  getActiveDriver: vi.fn((_id: number) => (driverConnected ? { isConnected: () => true, writeTags: (...a: any[]) => (writeTagsSpy as any)(...a) } : undefined)),
}));

import { dispatch } from "./commandDispatcher";

// A fully-authorized interlock rule + event + writable tag on adapter 10.
function seedAuthorized() {
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_block", address: "ns=1;s=Block", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  rules.push({
    id: 7, enabled: true, approvedBy: 42, requiresHumanConfirm: false,
    action: "block_downstream", targetAdapterId: 10, targetMachineId: 5, commandTag: "cmd_block", commandValue: true,
  });
  events.push({ id: 70, ruleId: 7, status: "fired" });
}

const interlockInput = (over: Partial<Parameters<typeof dispatch>[0]> = {}) => ({
  adapterId: 10,
  machineId: 5,
  commandType: "block_downstream",
  writes: [{ tagKey: "cmd_block", value: true }],
  triggeredBy: { kind: "interlock" as const, ruleId: 7, eventId: 70, approvedBy: 42 },
  lang: "vi" as const,
  idempotencyKey: "il-7-70",
  ...over,
});

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  driverConnected = true;
  process.env.OT_CONTROL_ENABLED = "true";
  process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
  // C2 (doc 24): these interlock tests predate the commissioning gate; opt it OUT so
  // their legacy real-write semantics are preserved exactly (the new gate has its own
  // suite in commandDispatcher.commissioning.test.ts, including an interlock case).
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  seedAuthorized();
});

describe("commandDispatcher — F5b interlock auto-block (all gates pass)", () => {
  it("authorized rule → writeTags 1×, commandLog interlock provenance, audit fired", async () => {
    const r = await dispatch(interlockInput());
    expect(r.ok).toBe(true);
    expect(r.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    expect(cmdLog).toHaveLength(1);
    expect(cmdLog[0].triggerKind).toBe("interlock");
    expect(cmdLog[0].interlockRuleId).toBe(7);
    expect(cmdLog[0].interlockEventId).toBe(70);
    expect(cmdLog[0].approvedBy).toBe(42);
    // approver owns responsibility → requestedBy=confirmedBy=approvedBy
    expect(cmdLog[0].requestedBy).toBe(42);
    expect(cmdLog[0].confirmedBy).toBe(42);
    expect(cmdLog[0].actionId).toBeNull();
    // audit INTERLOCK_AUTO_BLOCK
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0][1]).toMatchObject({ action: "interlock_auto_block", entityId: 7 });
    expect(auditSpy.mock.calls[0][1].details.metadata).toMatchObject({ ruleId: 7, eventId: 70, approvedBy: 42 });
  });

  it("OT_CONTROL_ENABLED=false → simulated (no real write) but still authorized", async () => {
    process.env.OT_CONTROL_ENABLED = "false";
    const r = await dispatch(interlockInput());
    expect(r.simulated).toBe(true);
    expect(r.status).toBe("simulated");
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog[0].triggerKind).toBe("interlock");
    expect(auditSpy).toHaveBeenCalledTimes(1);
  });

  it("idempotency il-rule-event: 2nd dispatch cached, writeTags NOT called again, audit once", async () => {
    const r1 = await dispatch(interlockInput());
    expect(r1.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    expect(cmdLog).toHaveLength(1);
    const r2 = await dispatch(interlockInput());
    expect(r2.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    expect(cmdLog).toHaveLength(1);
    expect(auditSpy).toHaveBeenCalledTimes(1); // not re-audited on cache hit
  });
});

describe("commandDispatcher — F5b interlock SAFETY rejections (writeTags 0×)", () => {
  it("master flag INTERLOCK_AUTO_BLOCK_ENABLED=false → reject INTERLOCK_AUTO_BLOCK_DISABLED", async () => {
    process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "false";
    const r = await dispatch(interlockInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_AUTO_BLOCK_DISABLED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog.every((c) => c.status === "rejected")).toBe(true);
  });

  it("rule not approved (approvedBy null) → reject INTERLOCK_NOT_APPROVED", async () => {
    rules[0].approvedBy = null;
    const r = await dispatch(interlockInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_NOT_APPROVED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("approvedBy mismatch (anti-forgery) → reject INTERLOCK_NOT_APPROVED", async () => {
    const r = await dispatch(interlockInput({ triggeredBy: { kind: "interlock", ruleId: 7, eventId: 70, approvedBy: 999 } }));
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_NOT_APPROVED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("requiresHumanConfirm=true → reject INTERLOCK_REQUIRES_HUMAN_CONFIRM (not auto path)", async () => {
    rules[0].requiresHumanConfirm = true;
    const r = await dispatch(interlockInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_REQUIRES_HUMAN_CONFIRM");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("rule enabled=false → reject INTERLOCK_RULE_DISABLED", async () => {
    rules[0].enabled = false;
    const r = await dispatch(interlockInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_RULE_DISABLED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("action not in allowlist → reject INTERLOCK_ACTION_NOT_ALLOWED", async () => {
    rules[0].action = "alert";
    const r = await dispatch(interlockInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_ACTION_NOT_ALLOWED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("targetAdapterId mismatch → reject INTERLOCK_TARGET_MISMATCH", async () => {
    rules[0].targetAdapterId = 99;
    const r = await dispatch(interlockInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_TARGET_MISMATCH");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("commandTag mismatch → reject INTERLOCK_TAG_MISMATCH", async () => {
    rules[0].commandTag = "other_tag";
    const r = await dispatch(interlockInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_TAG_MISMATCH");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("event does not belong to rule → reject INTERLOCK_EVENT_INVALID", async () => {
    events[0].ruleId = 999;
    const r = await dispatch(interlockInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_EVENT_INVALID");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("tag not writable → reject TAG_NOT_WRITABLE (shared allowlist gate)", async () => {
    tags[0].writable = false;
    const r = await dispatch(interlockInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("TAG_NOT_WRITABLE");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });
});

describe("commandDispatcher — F5b: kind='hitl' regression", () => {
  it("a HITL dispatch still works and records triggerKind='hitl'", async () => {
    pending.set("act-9", { id: "act-9", status: "confirmed", userId: 3 });
    const r = await dispatch({
      adapterId: 10,
      machineId: 5,
      commandType: "stop",
      writes: [{ tagKey: "cmd_block", value: true }],
      triggeredBy: { kind: "hitl", actionId: "act-9", confirmedBy: 3, requestedBy: 3 },
      idempotencyKey: "hitl-1",
    });
    expect(r.ok).toBe(true);
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    expect(cmdLog[0].triggerKind).toBe("hitl");
    expect(cmdLog[0].interlockRuleId).toBeNull();
    expect(cmdLog[0].confirmedBy).toBe(3);
    expect(auditSpy).not.toHaveBeenCalled(); // no interlock audit for HITL
  });
});
