/**
 * doc 44 W2-A3 — G1.9 per-adapter command serialization tests.
 *
 * Proves (in-memory tables, mocked driver/gates — same harness as
 * commandDispatcher.correlation.test.ts; NO live DB):
 *   - flag OFF (default): concurrent real-writes to the same adapter run in
 *     PARALLEL (prior behaviour byte-for-byte)
 *   - flag ON: real-writes to the SAME adapter run strictly ONE-AT-A-TIME and in
 *     FIFO order (the 2nd write does not reach the driver until the 1st finished)
 *   - different adapters are NOT serialized against each other
 *   - bounded queue: depth ≥ OT_CMD_QUEUE_MAX → immediate 'rejected' reason
 *     'BUSY' (spec §13.3) + a ledger row; the in-flight command is untouched
 *   - the simulated path (mode gate OFF) never touches the queue
 *   - queue drains and a subsequent command executes normally
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

import { dispatch, _resetAdapterCommandQueuesForTests, isCmdSerializeEnabled } from "./commandDispatcher";

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

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/** Wait (bounded) for a condition. Dependency-free. */
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  _resetAdapterCommandQueuesForTests();
  process.env.OT_CONTROL_ENABLED = "true";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false"; // doc 48 R1 (T1): opt safety-PLC preflight OUT (avoid perturbing per-adapter queue timing)
  delete process.env.OT_CMD_SERIALIZE_ENABLED;
  delete process.env.OT_CMD_QUEUE_MAX;
  delete process.env.UNS_CMD_ACK_ENABLED;
  writeTagsSpy.mockImplementation(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  adapters.push({ id: 11, machineId: 6, code: "A11", isEnabled: true });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  tags.push({ id: 101, adapterId: 10, tagKey: "cmd_speed", address: "ns=1;s=Speed", dataType: "float", scale: "1", offset: "0", writable: true, isEnabled: true });
  tags.push({ id: 102, adapterId: 11, tagKey: "cmd_start", address: "ns=1;s=Start", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  pending.set("act-1", { id: "act-1", status: "confirmed", userId: 1 });
});

describe("G1.9 — flag OFF (default): behaviour unchanged", () => {
  it("isCmdSerializeEnabled defaults to false", () => {
    expect(isCmdSerializeEnabled()).toBe(false);
  });

  it("two concurrent writes to the SAME adapter run in PARALLEL (no queue)", async () => {
    const d1 = deferred<any[]>();
    const d2 = deferred<any[]>();
    const pendingWrites: Array<typeof d1> = [d1, d2];
    writeTagsSpy.mockImplementation(() => pendingWrites.shift()!.promise as any);

    const pA = dispatch(baseInput({ idempotencyKey: "off-A" }));
    const pB = dispatch(baseInput({ writes: [{ tagKey: "cmd_speed", value: 5 }], idempotencyKey: "off-B" }));
    // BOTH reach the driver while NEITHER write has resolved → parallel.
    await until(() => writeTagsSpy.mock.calls.length >= 2);
    expect(writeTagsSpy).toHaveBeenCalledTimes(2);
    d1.resolve([{ tagKey: "cmd_start", ok: true }]);
    d2.resolve([{ tagKey: "cmd_speed", ok: true }]);
    const [rA, rB] = await Promise.all([pA, pB]);
    expect(rA.status).toBe("acked");
    expect(rB.status).toBe("acked");
  });
});

describe("G1.9 — flag ON: per-adapter serialization", () => {
  beforeEach(() => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
  });

  it("writes to the SAME adapter run one-at-a-time, FIFO (2nd waits for the 1st)", async () => {
    const d1 = deferred<any[]>();
    const order: string[] = [];
    writeTagsSpy.mockImplementation(async (writes: any[]) => {
      order.push(writes[0].tagKey);
      if (order.length === 1) return d1.promise as any;
      return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
    });

    const pA = dispatch(baseInput({ idempotencyKey: "ser-A" }));
    await until(() => order.length === 1); // A is IN FLIGHT (write pending)
    const pB = dispatch(baseInput({ writes: [{ tagKey: "cmd_speed", value: 7 }], idempotencyKey: "ser-B" }));

    // B passed every gate but must NOT reach the driver while A is in flight.
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(["cmd_start"]);

    d1.resolve([{ tagKey: "cmd_start", ok: true }]);
    const [rA, rB] = await Promise.all([pA, pB]);
    expect(rA.status).toBe("acked");
    expect(rB.status).toBe("acked");
    expect(order).toEqual(["cmd_start", "cmd_speed"]); // strict FIFO
  });

  it("DIFFERENT adapters are not serialized against each other", async () => {
    const d1 = deferred<any[]>();
    let calls = 0;
    writeTagsSpy.mockImplementation(async (writes: any[]) => {
      calls += 1;
      if (calls === 1) return d1.promise as any; // adapter 10 hangs
      return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
    });

    const pA = dispatch(baseInput({ idempotencyKey: "x-A" })); // adapter 10 (hangs)
    await until(() => calls === 1);
    const rB = await dispatch(baseInput({ adapterId: 11, machineId: 6, idempotencyKey: "x-B" }));
    expect(rB.status).toBe("acked"); // adapter 11 proceeded while 10 was busy
    d1.resolve([{ tagKey: "cmd_start", ok: true }]);
    await expect(pA).resolves.toMatchObject({ status: "acked" });
  });

  it("queue full (OT_CMD_QUEUE_MAX=1) → immediate 'rejected' reason BUSY + ledger row", async () => {
    process.env.OT_CMD_QUEUE_MAX = "1";
    const d1 = deferred<any[]>();
    writeTagsSpy.mockImplementationOnce(() => d1.promise as any);

    const pA = dispatch(baseInput({ idempotencyKey: "busy-A" }));
    await until(() => writeTagsSpy.mock.calls.length === 1); // A occupies the queue

    const t0 = Date.now();
    const rB = await dispatch(baseInput({ writes: [{ tagKey: "cmd_speed", value: 1 }], idempotencyKey: "busy-B" }));
    expect(Date.now() - t0).toBeLessThan(1500); // immediate — did not wait for A
    expect(rB.ok).toBe(false);
    expect(rB.status).toBe("rejected");
    expect(rB.reason).toBe("BUSY");
    const busyRow = cmdLog.find((r) => String(r.idempotencyKey).startsWith("busy-B"));
    expect(busyRow).toBeTruthy();
    expect(busyRow!.status).toBe("rejected");
    expect(busyRow!.errorText).toMatch(/BUSY/);

    // The in-flight command is untouched by the rejection.
    d1.resolve([{ tagKey: "cmd_start", ok: true }]);
    await expect(pA).resolves.toMatchObject({ status: "acked" });
    // B never reached the driver.
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
  });

  it("queue drains: after A completes, a new command executes normally (no BUSY)", async () => {
    process.env.OT_CMD_QUEUE_MAX = "1";
    const rA = await dispatch(baseInput({ idempotencyKey: "drain-A" }));
    expect(rA.status).toBe("acked");
    const rB = await dispatch(baseInput({ writes: [{ tagKey: "cmd_speed", value: 2 }], idempotencyKey: "drain-B" }));
    expect(rB.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(2);
  });

  it("simulated path (mode gate OFF) never touches the queue — full queue does not reject it", async () => {
    process.env.OT_CMD_QUEUE_MAX = "1";
    const d1 = deferred<any[]>();
    writeTagsSpy.mockImplementationOnce(() => d1.promise as any);
    const pA = dispatch(baseInput({ idempotencyKey: "sim-A" })); // occupies queue (control ON)
    await until(() => writeTagsSpy.mock.calls.length === 1);

    process.env.OT_CONTROL_ENABLED = "false"; // mode gate now OFF for the next command
    const rSim = await dispatch(baseInput({ writes: [{ tagKey: "cmd_speed", value: 3 }], idempotencyKey: "sim-B" }));
    expect(rSim.status).toBe("simulated"); // NOT 'BUSY' — simulated returns before the lock
    expect(rSim.ok).toBe(true);

    process.env.OT_CONTROL_ENABLED = "true";
    d1.resolve([{ tagKey: "cmd_start", ok: true }]);
    await expect(pA).resolves.toMatchObject({ status: "acked" });
  });

  it("a FAILED command still releases the queue (next command proceeds)", async () => {
    writeTagsSpy.mockImplementationOnce(async () => { throw new Error("device fault"); });
    const rA = await dispatch(baseInput({ idempotencyKey: "fail-A" }));
    expect(rA.status).toBe("failed");
    const rB = await dispatch(baseInput({ writes: [{ tagKey: "cmd_speed", value: 4 }], idempotencyKey: "fail-B" }));
    expect(rB.status).toBe("acked"); // queue drained despite the failure
  });
});
