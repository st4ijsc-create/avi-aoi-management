/**
 * doc 81 Đợt 10 task D fix review 3 — scan #73 ("fail-open-state-drift"), the dispatcher half: central wrote to an EDGE-OWNED adapter
 * through a session not yet detached (lost NOTIFY / reconcile window). The write-ahead reservation now asks, in its transaction, who
 * owns the adapter (otAdapterOwnerGate, FOR SHARE): edge-owned ⇒ ADAPTER_OWNED_BY_EDGE — nothing written, the HITL action NOT
 * consumed, the refusal ledgered. The gate gets the PINNED-stop flag (L-7: a pinned stop is never gated — proven in
 * otAdapterOwnerGate.dot10.db.test.ts). Harness: commandDispatcher.correlation.test.ts (in-memory tables, NO live DB).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeLedgerFakeDb, boundPending, resultRows, isIntentRow, TESTKIT_TOOL } from "./commandDispatcher.testkit";

const G = vi.hoisted(() => ({ owner: null as number | null, calls: [] as Array<{ adapterId: number; pinnedStop?: boolean }> }));
vi.mock("./otAdapterOwnerGate", () => ({
  ADAPTER_OWNED_BY_EDGE: "ADAPTER_OWNED_BY_EDGE",
  adapterOwnedByEdgeInTx: vi.fn(async (_tx: unknown, adapterId: number, opts: { pinnedStop?: boolean } = {}) => {
    G.calls.push({ adapterId, pinnedStop: opts.pinnedStop });
    return G.owner == null ? null : { code: "ADAPTER_OWNED_BY_EDGE", edgeNodeId: G.owner, detail: `adapter ${adapterId} is owned by edge node ${G.owner}` };
  }),
}));

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

// doc 81 Đợt 1B Task 6 — + inArray/sql for the write-ahead reservation (see commandDispatcher.testkit.ts).
vi.mock("drizzle-orm", async () => (await import("./commandDispatcher.testkit")).fakeOrm);

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
  // doc 81 Đợt 1B Task 6 — transaction-capable fake (reservation tx); same insert bookkeeping.
  return makeLedgerFakeDb({
    tableFor,
    onInsert: (table: any, vals: Row) => {
      if (table.__table === "command_log") {
        const row = { id: cmdSeq++, ...vals };
        cmdLog.push(row);
        return { id: row.id };
      }
      return { id: cmdSeq++ };
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

const baseInput = () => ({
  adapterId: 10,
  machineId: 5,
  commandType: "start",
  writes: [{ tagKey: "cmd_start", value: true }],
  triggeredBy: { kind: "hitl" as const, actionId: "act-1", tool: TESTKIT_TOOL, confirmedBy: 1, requestedBy: 1 },
  lang: "vi" as const,
  idempotencyKey: `key-${Math.random()}`,
});

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  G.owner = null;
  G.calls = [];
  process.env.OT_CONTROL_ENABLED = "true";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
  writeTagsSpy.mockImplementation(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  pending.set("act-1", boundPending("act-1", baseInput()));
});

describe("scan #73 — central never writes to an edge-owned adapter (reservation-time owner check)", () => {
  it("★ edge-owned at reservation ⇒ ADAPTER_OWNED_BY_EDGE: 0 device writes, no intent row, the HITL action NOT consumed, refusal ledgered", async () => {
    G.owner = 7;
    const r = await dispatch(baseInput());
    expect(r).toMatchObject({ ok: false, status: "rejected", reason: "ADAPTER_OWNED_BY_EDGE" });
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog.filter(isIntentRow)).toHaveLength(0);
    expect(pending.get("act-1")!.status).toBe("confirmed");
    expect(resultRows(cmdLog)).toHaveLength(1);
    expect(resultRows(cmdLog)[0]).toMatchObject({ status: "rejected" });
    expect(G.calls).toEqual([{ adapterId: 10, pinnedStop: false }]); // an unpinned command: the gate is asked
  });

  it("central-owned ⇒ the write proceeds exactly as before (acked, one device write)", async () => {
    const r = await dispatch(baseInput());
    expect(r.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    expect(G.calls).toHaveLength(1);
  });
});
