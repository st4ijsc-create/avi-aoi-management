/**
 * Doc 24 / Wave-1 phase C2 — commandDispatcher COMMISSIONING / FAT GATE tests.
 *
 * Proves the NEW per-adapter commissioning gate is a STRICTER layer on top of the
 * mode gate, and that it never weakens any existing gate:
 *   (a) OT_CONTROL_ENABLED=true + NOT commissioned ⇒ simulated + blockedReason,
 *       driver.writeTags 0×.
 *   (b) OT_CONTROL_ENABLED=true + commissioned (active, non-expired) ⇒ REAL path
 *       (driver.writeTags 1×, status=acked).
 *   (c) expired record ⇒ blocked (simulated); revoked record ⇒ blocked (simulated).
 *   (d) OT_COMMISSIONING_REQUIRED=false ⇒ legacy behaviour (real write even when
 *       NOT commissioned).
 *   (e) EXISTING gates still enforced with the gate ON: not-confirmed (HITL),
 *       tag-not-writable (allowlist), interlock master-flag — all still reject with
 *       writeTags 0× (none weakened; commissioning is only ever an ADDITIONAL block).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;

// ── In-memory tables ──────────────────────────────────────────────────────────
const pending = new Map<string, Row>();
const adapters: Row[] = [];
const tags: Row[] = [];
const cmdLog: Row[] = [];
const commissioning: Row[] = [];
const rules: Row[] = [];
const events: Row[] = [];
let cmdSeq = 1;

function reset() {
  pending.clear();
  adapters.length = 0;
  tags.length = 0;
  cmdLog.length = 0;
  commissioning.length = 0;
  rules.length = 0;
  events.length = 0;
  cmdSeq = 1;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "eq" }),
  and: (...ps: any[]) => ({ __and: ps }),
  desc: (col: any) => ({ __desc: col.__name }),
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
    case "commissioning_records": return commissioning;
    case "interlock_rules": return rules;
    case "interlock_events": return events;
    default: return [];
  }
}

// A `where(...)` result that is BOTH awaitable (returns the full filtered array —
// used by isCommissioned / listRecords) AND has `.limit()` (used by the dispatcher's
// single-row probes). This makes the fake DB support both call shapes.
function whereResult(rows: Row[]) {
  const p: any = Promise.resolve(rows);
  p.limit = async (_n?: number) => rows.slice(0, 1);
  p.orderBy = () => Promise.resolve(rows);
  return p;
}

function makeFakeDb() {
  return {
    select: () => ({
      from: (table: any) => ({
        where: (pred: any) => whereResult(tableFor(table).filter((r) => matches(r, pred))),
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
          if (table.__table === "commissioning_records") {
            const row = { id: cmdSeq++, ...vals };
            commissioning.push(row);
            return [row];
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
  commissioningRecords: { __table: "commissioning_records", id: { __name: "id" }, adapterId: { __name: "adapterId" }, status: { __name: "status" } },
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

// Doc 25 T1 — cổng interlock inline được test riêng; mock luôn-qua để giữ nguyên
// ngữ nghĩa gate commissioning (không liên quan interlock).
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

/** Seed an ACTIVE, non-expired commissioning record for adapter 10. */
function commissionAdapter10(over: Partial<Row> = {}) {
  commissioning.push({ id: 900, adapterId: 10, status: "active", signedBy: 7, signedAt: new Date(), expiresAt: null, ...over });
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  driverConnected = true;
  process.env.OT_CONTROL_ENABLED = "true"; // real path armed for these tests
  delete process.env.OT_CONTROL_TIMEOUT_MS;
  delete process.env.OT_READBACK_ENABLED;
  delete process.env.OT_COMMISSIONING_REQUIRED; // DEFAULT = ON
  writeTagsSpy.mockImplementation(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
  // default: enabled adapter + writable tag + confirmed action
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  pending.set("act-1", { id: "act-1", status: "confirmed", userId: 1 });
});

describe("commandDispatcher — C2 commissioning gate (default ON)", () => {
  it("(a) control ON + NOT commissioned ⇒ simulated + blockedReason, writeTags 0×", async () => {
    // no commissioning record seeded
    const r = await dispatch(baseInput());
    expect(r.simulated).toBe(true);
    expect(r.status).toBe("simulated");
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("not_commissioned");
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog).toHaveLength(1);
    expect(cmdLog[0].status).toBe("simulated");
    expect(cmdLog[0].errorText).toMatch(/^not_commissioned:/);
  });

  it("(b) control ON + commissioned (active, non-expired) ⇒ REAL write, writeTags 1×, acked", async () => {
    commissionAdapter10();
    const r = await dispatch(baseInput());
    expect(r.simulated).toBe(false);
    expect(r.status).toBe("acked");
    expect(r.ok).toBe(true);
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    expect(cmdLog[0].status).toBe("acked");
  });

  it("(c1) EXPIRED commissioning record ⇒ blocked (simulated), writeTags 0×", async () => {
    commissionAdapter10({ expiresAt: new Date(Date.now() - 60_000) }); // expired 1 min ago
    const r = await dispatch(baseInput());
    expect(r.status).toBe("simulated");
    expect(r.reason).toBe("not_commissioned");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("(c2) REVOKED commissioning record ⇒ blocked (simulated), writeTags 0×", async () => {
    commissionAdapter10({ status: "revoked" });
    const r = await dispatch(baseInput());
    expect(r.status).toBe("simulated");
    expect(r.reason).toBe("not_commissioned");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("commissioned with a FUTURE expiry ⇒ real write allowed", async () => {
    commissionAdapter10({ expiresAt: new Date(Date.now() + 3_600_000) }); // +1h
    const r = await dispatch(baseInput());
    expect(r.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
  });
});

describe("commandDispatcher — C2 flag OFF preserves legacy behaviour", () => {
  it("(d) OT_COMMISSIONING_REQUIRED=false ⇒ real write even when NOT commissioned", async () => {
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    // no commissioning record
    const r = await dispatch(baseInput());
    expect(r.simulated).toBe(false);
    expect(r.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
  });

  it("OT_COMMISSIONING_REQUIRED=0 also opts out (legacy)", async () => {
    process.env.OT_COMMISSIONING_REQUIRED = "0";
    const r = await dispatch(baseInput());
    expect(r.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
  });
});

describe("commandDispatcher — C2 does NOT weaken any existing gate (gate ON)", () => {
  // For all of these the adapter is NOT commissioned; the point is that the
  // EXISTING gate still fires FIRST/independently and still blocks the write — the
  // new gate never turns a reject into a write.
  it("(e1) not confirmed (HITL) ⇒ still rejected NOT_CONFIRMED, writeTags 0×", async () => {
    pending.set("act-1", { id: "act-1", status: "proposed", userId: 1 });
    const r = await dispatch(baseInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("NOT_CONFIRMED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("(e2) tag not writable ⇒ still rejected TAG_NOT_WRITABLE, writeTags 0×", async () => {
    commissionAdapter10(); // even a commissioned adapter must still respect the allowlist
    tags[0].writable = false;
    const r = await dispatch(baseInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("TAG_NOT_WRITABLE");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("(e3) adapter offline ⇒ still failed ADAPTER_OFFLINE, writeTags 0×", async () => {
    commissionAdapter10();
    driverConnected = false;
    const r = await dispatch(baseInput());
    expect(r.status).toBe("failed");
    expect(r.reason).toBe("ADAPTER_OFFLINE");
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("(e4) interlock master flag OFF ⇒ still rejected, writeTags 0× (commissioned)", async () => {
    commissionAdapter10();
    rules.push({ id: 7, enabled: true, approvedBy: 42, requiresHumanConfirm: false, action: "block_downstream", targetAdapterId: 10, commandTag: "cmd_start", commandValue: true });
    events.push({ id: 70, ruleId: 7, status: "fired" });
    process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "false";
    const r = await dispatch(baseInput({
      commandType: "block_downstream",
      triggeredBy: { kind: "interlock", ruleId: 7, eventId: 70, approvedBy: 42 },
      idempotencyKey: "il-7-70",
    }));
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("INTERLOCK_AUTO_BLOCK_DISABLED");
    expect(writeTagsSpy).not.toHaveBeenCalled();
    delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
  });

  it("mode gate precedence: OT_CONTROL_ENABLED=false ⇒ simulated with NO blockedReason (mode gate wins first)", async () => {
    process.env.OT_CONTROL_ENABLED = "false";
    const r = await dispatch(baseInput());
    expect(r.status).toBe("simulated");
    expect(r.reason).toBeUndefined(); // plain dry-run, not the commissioning block
    expect(cmdLog[0].errorText ?? null).toBeNull();
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });
});
