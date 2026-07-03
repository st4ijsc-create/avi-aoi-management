/**
 * Doc 24 / Wave-4 — AOI-F: vision→control write-tools THROUGH the HITL lifecycle
 * and the REAL command dispatcher (proves the gates are inherited, not bypassed).
 *
 * Unlike machineControl.tools.test.ts (which mocks the dispatcher), this suite runs
 * the REAL commandDispatcher + REAL commissioningService against an in-memory DB, so
 * it proves the FULL emission path is safe:
 *
 *   (c) propose → confirm → execute → dispatch(kind='hitl') → SIMULATED on an
 *       UNCOMMISSIONED adapter EVEN with OT_CONTROL_ENABLED=true (composes with the
 *       C2 commissioning gate). driver.writeTags is NEVER called.
 *   +   once the adapter is COMMISSIONED, the SAME confirmed proposal actuates for
 *       real (writeTags 1×, acked) — showing the gate composes both ways.
 *   +   GATE-INTACT: preview never dispatches/writes; a lost RBAC #2 at confirm
 *       blocks execute entirely (no dispatch, no command_log).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;

// ── In-memory tables ────────────────────────────────────────────────────────────
const pending: Row[] = [];   // ai_pending_actions
const adapters: Row[] = [];
const tags: Row[] = [];
const cmdLog: Row[] = [];
const commissioning: Row[] = [];
const rules: Row[] = [];
const events: Row[] = [];
let seq = 1;

function reset() {
  pending.length = 0;
  adapters.length = 0;
  tags.length = 0;
  cmdLog.length = 0;
  commissioning.length = 0;
  rules.length = 0;
  events.length = 0;
  seq = 1;
}

// ── drizzle-orm predicate shims (object form) ──────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "eq" }),
  and: (...ps: any[]) => ({ __and: ps }),
  lt: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "lt" }),
  desc: (col: any) => ({ __desc: col.__name }),
}));

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__and) return pred.__and.every((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "lt") return row[pred.__k] < pred.__v;
  return true;
}

function tableFor(table: any): Row[] {
  switch (table.__table) {
    case "ai_pending_actions": return pending;
    case "device_adapters": return adapters;
    case "device_tags": return tags;
    case "command_log": return cmdLog;
    case "commissioning_records": return commissioning;
    case "interlock_rules": return rules;
    case "interlock_events": return events;
    default: return [];
  }
}

/** where(...) result: awaitable (full filtered array) AND has .limit()/.orderBy(). */
function whereResult(rows: Row[]) {
  const p: any = Promise.resolve(rows);
  p.limit = async (_n?: number) => rows.slice(0, 1);
  p.orderBy = () => Promise.resolve(rows);
  return p;
}

function makeFakeDb() {
  return {
    select: (_sel?: unknown) => ({
      from: (table: any) => ({
        where: (pred: any) => whereResult(tableFor(table).filter((r) => matches(r, pred))),
      }),
    }),
    insert: (table: any) => ({
      values: (vals: Row) => {
        let result: any[];
        if (table.__table === "command_log") {
          const row = { id: seq++, ...vals }; cmdLog.push(row); result = [{ id: row.id }];
        } else if (table.__table === "commissioning_records") {
          const row = { id: seq++, ...vals }; commissioning.push(row); result = [row];
        } else if (table.__table === "ai_pending_actions") {
          const row = { ...vals }; pending.push(row); result = [row];
        } else {
          result = [{ id: seq++ }];
        }
        const p: any = Promise.resolve(result);
        p.returning = async (_s?: unknown) => result;
        return p;
      },
    }),
    update: (table: any) => ({
      set: (patch: Row) => ({
        where: (pred: any) => {
          const rows = tableFor(table).filter((r) => matches(r, pred));
          for (const r of rows) Object.assign(r, patch);
          return Promise.resolve({ rowCount: rows.length });
        },
      }),
    }),
  };
}

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));

function schemaFactory() {
  return {
    aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" }, expiresAt: { __name: "expiresAt" }, idempotencyKey: { __name: "idempotencyKey" } },
    deviceAdapters: { __table: "device_adapters", id: { __name: "id" }, machineId: { __name: "machineId" }, isEnabled: { __name: "isEnabled" } },
    deviceTags: { __table: "device_tags", id: { __name: "id" }, adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" }, dataType: { __name: "dataType" }, scale: { __name: "scale" }, offset: { __name: "offset" }, writable: { __name: "writable" }, isEnabled: { __name: "isEnabled" } },
    commandLog: { __table: "command_log", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" }, status: { __name: "status" } },
    commissioningRecords: { __table: "commissioning_records", id: { __name: "id" }, adapterId: { __name: "adapterId" }, status: { __name: "status" } },
    interlockRules: { __table: "interlock_rules", id: { __name: "id" } },
    interlockEvents: { __table: "interlock_events", id: { __name: "id" } },
  };
}
vi.mock("../../../drizzle/schema", () => schemaFactory());
vi.mock("../../drizzle/schema", () => schemaFactory());

// ── accessControl (RBAC #1 + #2) ──
const checkPermission = vi.fn(async () => true);
vi.mock("../../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => (checkPermission as any)(...a) }));
vi.mock("../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => (checkPermission as any)(...a) }));

// ── audit (silence) ──
const logCrudOperation = vi.fn(async () => ({ id: 1 }));
const logUpdate = vi.fn(async () => {});
vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: {
    AI_ACTION_PROPOSED: "ai_action_proposed", AI_ACTION_CONFIRMED: "ai_action_confirmed",
    AI_ACTION_EXECUTED: "ai_action_executed", AI_ACTION_DENIED: "ai_action_denied",
    AI_ACTION_CANCELLED: "ai_action_cancelled", INTERLOCK_AUTO_BLOCK: "interlock_auto_block",
  },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: (x: any) => x,
  logCrudOperation: (...a: unknown[]) => (logCrudOperation as any)(...a),
  logUpdate: (...a: unknown[]) => (logUpdate as any)(...a),
}));

// ── OT driver (spied so we can prove writeTags is NEVER called when simulated) ──
const writeTagsSpy = vi.fn(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
let driverConnected = true;
vi.mock("../ot/otManager", () => ({
  getActiveDriver: vi.fn((_id: number) => (driverConnected ? { isConnected: () => true, writeTags: (...a: any[]) => (writeTagsSpy as any)(...a) } : undefined)),
}));

// REAL modules under test.
import { getTool } from "./toolRegistry";
import "./writeHandlers/visionControl";
import { proposeAction, confirmAction } from "../aiCopilotActions";

const USER = { id: 1, role: "admin", name: "Admin" } as const;
const ctx = () => ({ user: USER, lang: "vi" as const });

function tool(name: string) {
  const t = getTool(name);
  if (!t) throw new Error(`${name} not registered`);
  return t;
}

function commissionAdapter10(over: Partial<Row> = {}) {
  commissioning.push({ id: 900, adapterId: 10, status: "active", signedBy: 7, signedAt: new Date(), expiresAt: null, ...over });
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  driverConnected = true;
  checkPermission.mockResolvedValue(true);
  process.env.OT_CONTROL_ENABLED = "true";       // real path ARMED for these tests
  delete process.env.OT_COMMISSIONING_REQUIRED;  // DEFAULT = ON (C2 engaged)
  delete process.env.OT_READBACK_ENABLED;
  delete process.env.OT_CONTROL_TIMEOUT_MS;
  writeTagsSpy.mockImplementation(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  tags.push(
    { id: 100, adapterId: 10, tagKey: "cmd_reject_divert", address: "ns=1;s=Divert", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true },
    { id: 101, adapterId: 10, tagKey: "printer_offset_x", address: "ns=1;s=OffX", dataType: "float", scale: "1", offset: "0", writable: true, isEnabled: true },
    { id: 102, adapterId: 10, tagKey: "printer_offset_y", address: "ns=1;s=OffY", dataType: "float", scale: "1", offset: "0", writable: true, isEnabled: true },
  );
});

describe("registration + RBAC surface", () => {
  it("reject_divert=canCreate, spi_printer_offset=canEdit, both kind=write", () => {
    expect(tool("reject_divert").kind).toBe("write");
    expect(tool("reject_divert").requiredPermission).toEqual({ module: "machine_control", action: "canCreate" });
    expect(tool("spi_printer_offset").kind).toBe("write");
    expect(tool("spi_printer_offset").requiredPermission).toEqual({ module: "machine_control", action: "canEdit" });
  });
});

describe("(c) confirmed proposal routes through dispatch — SIMULATED on uncommissioned adapter (composes with C2)", () => {
  it("reject_divert: control ON + NOT commissioned ⇒ simulated, writeTags 0×", async () => {
    // no commissioning record seeded
    const p = await proposeAction(tool("reject_divert"), { machineId: 5, unitRef: "55" }, ctx());
    expect(p.ok).toBe(true);
    // GATE-INTACT: preview did NOT dispatch / write / log anything.
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog).toHaveLength(0);

    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, USER, "vi");
    expect(c.status).toBe("executed");

    const result = (c.result as any).data; // DispatchResult
    expect(result.simulated).toBe(true);
    expect(result.status).toBe("simulated");
    expect(result.reason).toBe("not_commissioned");
    // The driver was NEVER touched — C2 forced the simulated path despite control ON.
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog).toHaveLength(1);
    expect(cmdLog[0].status).toBe("simulated");
    expect(cmdLog[0].triggerKind).toBe("hitl");
    expect(cmdLog[0].errorText).toMatch(/^not_commissioned:/);
  });

  it("spi_printer_offset: two writes, both simulated on uncommissioned adapter, writeTags 0×", async () => {
    const p = await proposeAction(tool("spi_printer_offset"), { machineId: 5, offsetXUm: -6, offsetYUm: 2.5 }, ctx());
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, USER, "vi");
    expect(c.status).toBe("executed");
    const result = (c.result as any).data;
    expect(result.simulated).toBe(true);
    expect(result.results).toHaveLength(2); // offset_x + offset_y
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog.every((r) => r.status === "simulated")).toBe(true);
    expect(cmdLog).toHaveLength(2);
  });

  it("once COMMISSIONED (+control ON) the SAME confirmed proposal actuates for real (writeTags 1×, acked)", async () => {
    commissionAdapter10();
    const p = await proposeAction(tool("reject_divert"), { machineId: 5, unitRef: "55" }, ctx());
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, USER, "vi");
    expect(c.status).toBe("executed");
    const result = (c.result as any).data;
    expect(result.simulated).toBe(false);
    expect(result.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    expect(cmdLog[0].status).toBe("acked");
  });
});

describe("GATE-INTACT: HITL + allowlist are never bypassed", () => {
  it("RBAC #2 lost at confirm ⇒ denied; NO dispatch, NO command_log", async () => {
    const p = await proposeAction(tool("reject_divert"), { machineId: 5 }, ctx());
    checkPermission.mockResolvedValue(false); // role downgraded between propose and confirm
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, USER, "vi");
    expect(c.status).toBe("denied");
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog).toHaveLength(0);
  });

  it("a non-writable tag is rejected by the dispatcher allowlist even when commissioned", async () => {
    commissionAdapter10();
    tags[0].writable = false; // cmd_reject_divert no longer in the write allowlist
    const p = await proposeAction(tool("reject_divert"), { machineId: 5 }, ctx());
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, USER, "vi");
    const result = (c.result as any).data;
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("TAG_NOT_WRITABLE");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("the AI/quality-loop dispatch is ALWAYS triggeredBy.kind='hitl' (never interlock)", async () => {
    commissionAdapter10();
    const p = await proposeAction(tool("reject_divert"), { machineId: 5 }, ctx());
    await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, USER, "vi");
    expect(cmdLog[0].triggerKind).toBe("hitl");
    expect(cmdLog[0].interlockRuleId ?? null).toBeNull();
  });
});
