/**
 * doc 44 W0-D — G1.7 (correlationId + deadlineMs) + G1.6 (cmd_ack publish) tests.
 *
 * Proves (mirrors the commandDispatcher.test.ts harness — in-memory tables,
 * mocked driver/gates, NO live DB):
 *   G1.7
 *   - explicit input.correlationId is persisted on the commandLog row (simulated)
 *   - absent → the AsyncLocalStorage correlation backbone is used (withCorrelation)
 *   - absent + no ALS context → correlationId null (unchanged rows)
 *   - rejected branch ALSO persists correlationId (ledger on EVERY branch)
 *   - deadlineMs is persisted AND overrides the env timeout for THIS command
 *     (hanging write → 'timeout' fast); OT_CONTROL_TIMEOUT_MAX_MS caps it
 *   - no deadlineMs → env timeout behaviour unchanged (regression guard)
 *   G1.6
 *   - UNS_CMD_ACK_ENABLED=true → publishCmdAck called ONCE with the LDS-L1 §8.5
 *     payload { command_id, correlation_id, status, reason, ts, result }
 *   - rejected branch also acks (status rejected + reason)
 *   - publishCmdAck THROWING never fails/It changes the dispatch result
 *   - flag OFF (default) → publishCmdAck NEVER called
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;

// ── In-memory tables (same harness as commandDispatcher.test.ts) ─────────────
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

vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { INTERLOCK_AUTO_BLOCK: "interlock_auto_block" },
  createAuditContext: (x: any) => x,
  logCrudOperation: vi.fn(async () => ({ id: 1 })),
}));

const writeTagsSpy = vi.fn(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
vi.mock("./otManager", () => ({
  getActiveDriver: vi.fn((_id: number) => ({
    isConnected: () => true,
    writeTags: (...a: any[]) => (writeTagsSpy as any)(...a),
    readTags: vi.fn(async () => []),
  })),
}));

vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async () => ({ blocked: false, failClosed: false, violations: [] })),
}));

// G1.6 — the UNS cmd_ack publisher, mocked (the dispatcher dynamic-imports it).
const publishCmdAckSpy = vi.fn((_ack: any, _target?: any) => true);
vi.mock("../unsPublisher", () => ({
  publishCmdAck: (...a: any[]) => (publishCmdAckSpy as any)(...a),
}));

import { dispatch } from "./commandDispatcher";
import { withCorrelation } from "../observability/correlation";

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

/** Wait (bounded) for a fire-and-forget side effect. Dependency-free. */
async function until(cond: () => boolean, ms = 1000): Promise<void> {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  process.env.OT_CONTROL_ENABLED = "false";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false"; // doc 48 R1 (T1): opt safety-PLC preflight OUT (own suite: commandDispatcher.safety.test.ts)
  delete process.env.OT_CONTROL_TIMEOUT_MS;
  delete process.env.OT_CONTROL_TIMEOUT_MAX_MS;
  delete process.env.UNS_CMD_ACK_ENABLED;
  writeTagsSpy.mockImplementation(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
  publishCmdAckSpy.mockImplementation(() => true);
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  pending.set("act-1", { id: "act-1", status: "confirmed", userId: 1 });
});

describe("G1.7 — correlationId persistence", () => {
  it("explicit input.correlationId is persisted on the (simulated) commandLog row", async () => {
    const r = await dispatch(baseInput({ correlationId: "corr-explicit-1" }));
    expect(r.status).toBe("simulated");
    expect(cmdLog).toHaveLength(1);
    expect(cmdLog[0].correlationId).toBe("corr-explicit-1");
    expect(cmdLog[0].deadlineMs).toBeNull();
  });

  it("absent → picked up from the AsyncLocalStorage correlation backbone", async () => {
    const r = await withCorrelation({ correlationId: "corr-als-1" }, () => dispatch(baseInput()));
    expect(r.status).toBe("simulated");
    expect(cmdLog[0].correlationId).toBe("corr-als-1");
  });

  it("explicit correlationId WINS over the ALS context", async () => {
    await withCorrelation({ correlationId: "corr-als-2" }, () =>
      dispatch(baseInput({ correlationId: "corr-explicit-2" })),
    );
    expect(cmdLog[0].correlationId).toBe("corr-explicit-2");
  });

  it("absent + no ALS context → correlationId null (behaviour unchanged)", async () => {
    await dispatch(baseInput());
    expect(cmdLog[0].correlationId).toBeNull();
  });

  it("rejected branch ALSO persists correlationId (ledger on every branch)", async () => {
    tags[0].writable = false;
    const r = await dispatch(baseInput({ correlationId: "corr-rej-1" }));
    expect(r.status).toBe("rejected");
    expect(cmdLog.length).toBeGreaterThan(0);
    expect(cmdLog[0].correlationId).toBe("corr-rej-1");
  });

  it("real-write path (control ON) persists correlationId on the acked row", async () => {
    process.env.OT_CONTROL_ENABLED = "true";
    const r = await dispatch(baseInput({ correlationId: "corr-real-1" }));
    expect(r.status).toBe("acked");
    expect(cmdLog[0].correlationId).toBe("corr-real-1");
  });
});

describe("G1.7 — deadlineMs override", () => {
  beforeEach(() => {
    process.env.OT_CONTROL_ENABLED = "true";
  });

  it("deadlineMs is persisted on the commandLog row", async () => {
    const r = await dispatch(baseInput({ deadlineMs: 2000 }));
    expect(r.status).toBe("acked");
    expect(cmdLog[0].deadlineMs).toBe(2000);
  });

  it("hanging write + deadlineMs=30 → 'timeout' using the DEADLINE, not the 5000ms env default", async () => {
    writeTagsSpy.mockImplementationOnce(() => new Promise(() => { /* never resolves */ }));
    const t0 = Date.now();
    const r = await dispatch(baseInput({ deadlineMs: 30 }));
    const elapsed = Date.now() - t0;
    expect(r.status).toBe("timeout");
    expect(elapsed).toBeLessThan(3000); // would be ≥5000ms on the env default
    expect(cmdLog[0].status).toBe("timeout");
    expect(cmdLog[0].errorText).toMatch(/timeout after 30ms/);
    expect(cmdLog[0].deadlineMs).toBe(30);
  });

  it("OT_CONTROL_TIMEOUT_MAX_MS caps an oversized deadline (min(deadline, max))", async () => {
    process.env.OT_CONTROL_TIMEOUT_MAX_MS = "25";
    writeTagsSpy.mockImplementationOnce(() => new Promise(() => { /* never resolves */ }));
    const t0 = Date.now();
    const r = await dispatch(baseInput({ deadlineMs: 60_000 }));
    const elapsed = Date.now() - t0;
    expect(r.status).toBe("timeout");
    expect(elapsed).toBeLessThan(3000);
    expect(cmdLog[0].errorText).toMatch(/timeout after 25ms/);
  });

  it("NO deadlineMs → env timeout behaviour unchanged (regression guard)", async () => {
    process.env.OT_CONTROL_TIMEOUT_MS = "30";
    writeTagsSpy.mockImplementationOnce(() => new Promise(() => { /* never resolves */ }));
    const r = await dispatch(baseInput());
    expect(r.status).toBe("timeout");
    expect(cmdLog[0].errorText).toMatch(/timeout after 30ms/);
    expect(cmdLog[0].deadlineMs).toBeNull();
  });

  it("invalid deadlineMs (<=0 / NaN) is ignored → env default + null persisted", async () => {
    process.env.OT_CONTROL_TIMEOUT_MS = "30";
    writeTagsSpy.mockImplementationOnce(() => new Promise(() => { /* never resolves */ }));
    const r = await dispatch(baseInput({ deadlineMs: -5 }));
    expect(r.status).toBe("timeout");
    expect(cmdLog[0].errorText).toMatch(/timeout after 30ms/);
    expect(cmdLog[0].deadlineMs).toBeNull();
  });
});

describe("G1.6 — cmd_ack publish (fire-and-forget)", () => {
  it("flag ON → publishCmdAck called ONCE with the LDS-L1 §8.5 payload (simulated)", async () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    const r = await dispatch(baseInput({ correlationId: "corr-ack-1" }));
    expect(r.status).toBe("simulated");
    await until(() => publishCmdAckSpy.mock.calls.length >= 1);
    expect(publishCmdAckSpy).toHaveBeenCalledTimes(1);
    const [ack, target] = publishCmdAckSpy.mock.calls[0];
    expect(ack.command_id).toBe("key-1");
    expect(ack.correlation_id).toBe("corr-ack-1");
    expect(ack.status).toBe("simulated");
    expect(ack.reason).toBeNull();
    expect(typeof ack.ts).toBe("string");
    expect(Array.isArray(ack.result)).toBe(true);
    expect(target).toEqual({ adapterId: 10, machineId: 5 });
  });

  it("rejected branch also acks (status rejected + reason)", async () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    tags[0].writable = false;
    const r = await dispatch(baseInput());
    expect(r.status).toBe("rejected");
    await until(() => publishCmdAckSpy.mock.calls.length >= 1);
    const [ack] = publishCmdAckSpy.mock.calls[0];
    expect(ack.status).toBe("rejected");
    expect(ack.reason).toBe("TAG_NOT_WRITABLE");
  });

  it("publishCmdAck THROWING does not fail or change the dispatch result", async () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    publishCmdAckSpy.mockImplementation(() => { throw new Error("broker exploded"); });
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(true);
    expect(r.status).toBe("simulated");
    await until(() => publishCmdAckSpy.mock.calls.length >= 1);
    expect(publishCmdAckSpy).toHaveBeenCalledTimes(1); // attempted, swallowed
    expect(cmdLog).toHaveLength(1); // ledger untouched by the publish failure
  });

  it("flag OFF (default) → publishCmdAck NEVER called", async () => {
    const r = await dispatch(baseInput());
    expect(r.status).toBe("simulated");
    // give any (wrong) fire-and-forget a chance to run before asserting
    await new Promise((res) => setTimeout(res, 20));
    expect(publishCmdAckSpy).not.toHaveBeenCalled();
  });

  it("idempotent cached replay also acks (one ack per dispatch CALL)", async () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    await dispatch(baseInput());
    await dispatch(baseInput()); // cached terminal → still a terminal result
    await until(() => publishCmdAckSpy.mock.calls.length >= 2);
    expect(publishCmdAckSpy).toHaveBeenCalledTimes(2);
    expect(cmdLog).toHaveLength(1); // ledger still has exactly one row
  });
});
