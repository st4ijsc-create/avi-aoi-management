/**
 * doc 48 R1 (T1) — commandDispatcher SAFETY-PLC PREFLIGHT tests.
 *
 * Proves spec invariant #1 ("a BLOCKED safety-PLC MUST deny actuation") is wired into
 * the REAL-write path of dispatchCore, flag-gated + HONEST (same in-memory harness as
 * commandDispatcher.test.ts; the adapter facade's getSafetyStatus is mocked so we drive
 * OK / BLOCKED / UNKNOWN directly, no live safety-PLC):
 *   - safety BLOCKED → rejected SAFETY_BLOCKED, driver.writeTags 0× (denied BEFORE write)
 *   - safety UNKNOWN → REJECTED SAFETY_UNKNOWN, driver.writeTags 0× (doc 81 Đợt 1B Task 6 —
 *     was "ALLOWED, UNKNOWN ≠ blocked"; not OK is not OK, same rule as the robot dispatcher)
 *   - safety OK      → ALLOWED (write proceeds, acked)
 *   - OT_SAFETY_PREFLIGHT_ENABLED=false → preflight SKIPPED (getSafetyStatus NOT called),
 *     even a BLOCKED status writes (flag OFF ⇒ prior behaviour)
 *   - dry-run (OT_CONTROL_ENABLED=false) → simulated, getSafetyStatus NOT called (the
 *     preflight guards ONLY the real write; there is nothing to guard on the sim path)
 *   - the SAFETY_BLOCKED rejection is recorded on the append-only commandLog ledger
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeLedgerFakeDb, boundPending, resultRows, isIntentRow, TESTKIT_TOOL } from "./commandDispatcher.testkit";

type Row = Record<string, any>;

// ── In-memory tables (mirrors commandDispatcher.test.ts) ──────────────────────
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
  getActiveDriver: vi.fn((_id: number) => ({ isConnected: () => true, writeTags: (...a: any[]) => (writeTagsSpy as any)(...a) })),
}));

// Interlock gate always passes → isolates the safety preflight behaviour.
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async () => ({ blocked: false, failClosed: false, violations: [] })),
}));

// Adapter facade — the READ-ONLY safety source. `safetyState` drives what
// getSafetyStatus() reports for THIS test; the spy also records that the preflight
// actually consulted the adapter (or, for the negative cases, that it did NOT).
let safetyState: "OK" | "BLOCKED" | "UNKNOWN" = "UNKNOWN";
const getSafetyStatusSpy = vi.fn(async () => ({ state: safetyState, source: "test", ts: new Date().toISOString() }));
const createAdapterFacadeSpy = vi.fn((_ctx: any) => ({ getSafetyStatus: (...a: any[]) => (getSafetyStatusSpy as any)(...a) }));
vi.mock("./adapterFacade", () => ({
  createAdapterFacade: (...a: any[]) => (createAdapterFacadeSpy as any)(...a),
}));

import { dispatch, isSafetyPreflightEnabled } from "./commandDispatcher";

const baseInput = (over: Partial<Parameters<typeof dispatch>[0]> = {}) => ({
  adapterId: 10,
  machineId: 5,
  commandType: "tag.write",
  writes: [{ tagKey: "cmd_start", value: true }],
  triggeredBy: { kind: "hitl" as const, actionId: "act-1", tool: TESTKIT_TOOL, confirmedBy: 1, requestedBy: 1 },
  lang: "vi" as const,
  idempotencyKey: "key-1",
  ...over,
});

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  safetyState = "UNKNOWN";
  writeTagsSpy.mockImplementation(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
  getSafetyStatusSpy.mockImplementation(async () => ({ state: safetyState, source: "test", ts: new Date().toISOString() }));
  createAdapterFacadeSpy.mockImplementation((_ctx: any) => ({ getSafetyStatus: (...a: any[]) => (getSafetyStatusSpy as any)(...a) }));
  // Real write ARMED; opt other newer gates OUT so ONLY the safety preflight is under test.
  process.env.OT_CONTROL_ENABLED = "true";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  delete process.env.OT_SAFETY_PREFLIGHT_ENABLED; // default = ON (unless "false")
  delete process.env.OT_CONTROL_TIMEOUT_MS;
  delete process.env.OT_READBACK_ENABLED;
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
  // doc 81 Đợt 1B Task 6 — a real write needs a confirmed action BOUND to the command.
  pending.set("act-1", boundPending("act-1", baseInput()));
});

describe("commandDispatcher — safety-PLC preflight (default ON)", () => {
  it("flag defaults ON (OT_SAFETY_PREFLIGHT_ENABLED unset → enabled)", () => {
    expect(isSafetyPreflightEnabled()).toBe(true);
    process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
    expect(isSafetyPreflightEnabled()).toBe(false);
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
  });

  it("BLOCKED safety status → rejected SAFETY_BLOCKED, writeTags 0× (denied before write)", async () => {
    safetyState = "BLOCKED";
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("SAFETY_BLOCKED");
    expect(getSafetyStatusSpy).toHaveBeenCalledTimes(1);
    expect(writeTagsSpy).not.toHaveBeenCalled();
    // Ledger records the rejection (append-only, one row) with the reason.
    expect(resultRows(cmdLog)).toHaveLength(1);
    expect(resultRows(cmdLog)[0].status).toBe("rejected");
    expect(resultRows(cmdLog)[0].errorText).toMatch(/^SAFETY_BLOCKED:/);
    // The facade was consulted for the target adapter/machine.
    expect(createAdapterFacadeSpy).toHaveBeenCalledWith({ adapterId: 10, machineId: 5 });
  });

  it("UNKNOWN safety status → REJECTED SAFETY_UNKNOWN, writeTags 0× (doc 81 Đợt 1B Task 6)", async () => {
    safetyState = "UNKNOWN";
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(false);
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("SAFETY_UNKNOWN");
    expect(getSafetyStatusSpy).toHaveBeenCalledTimes(1);
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(resultRows(cmdLog)).toHaveLength(1);
    expect(resultRows(cmdLog)[0].errorText).toMatch(/^SAFETY_UNKNOWN:/);
    expect(cmdLog.filter(isIntentRow)).toHaveLength(0); // refused BEFORE the write-ahead intent
  });

  it("OK safety status → ALLOWED (write proceeds, acked)", async () => {
    safetyState = "OK";
    const r = await dispatch(baseInput());
    expect(r.ok).toBe(true);
    expect(r.status).toBe("acked");
    expect(getSafetyStatusSpy).toHaveBeenCalledTimes(1);
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
  });
});

describe("commandDispatcher — safety-PLC preflight non-breaking gates", () => {
  it("OT_SAFETY_PREFLIGHT_ENABLED=false → preflight skipped, BLOCKED still writes (flag OFF)", async () => {
    process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
    safetyState = "BLOCKED";
    const r = await dispatch(baseInput());
    expect(r.status).toBe("acked");
    expect(r.ok).toBe(true);
    expect(getSafetyStatusSpy).not.toHaveBeenCalled(); // preflight fully bypassed
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
  });

  it("dry-run (OT_CONTROL_ENABLED=false) → simulated, getSafetyStatus NOT called (no real write to guard)", async () => {
    process.env.OT_CONTROL_ENABLED = "false";
    safetyState = "BLOCKED";
    const r = await dispatch(baseInput());
    expect(r.simulated).toBe(true);
    expect(r.status).toBe("simulated");
    expect(getSafetyStatusSpy).not.toHaveBeenCalled();
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("BLOCKED does NOT weaken earlier gates: not-confirmed still rejects NOT_CONFIRMED first", async () => {
    // Authorization runs BEFORE the preflight, so an unconfirmed action is rejected
    // without ever consulting safety (defense-in-depth ordering preserved).
    pending.set("act-1", { id: "act-1", status: "proposed", userId: 1 });
    safetyState = "BLOCKED";
    const r = await dispatch(baseInput());
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("NOT_CONFIRMED");
    expect(getSafetyStatusSpy).not.toHaveBeenCalled();
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });
});

// ── doc 81 Đợt 1C final wave 4 (ruling R-1C-g, final review I1) ───────────────────────────────────────
// Lệnh OT kiểu stop/e_stop VẪN chịu preflight (không miễn theo TÊN — một "stop" OT là các lệnh ghi tag do người gọi
// chọn, không có siêu dữ liệu tag dừng được ghim). Nhưng khi preflight từ chối nó, lời từ chối phải nói THẲNG: lệnh dừng
// phần mềm đã bị từ chối ⇒ dùng nút E-STOP cứng. Mã giữ nguyên (SAFETY_*), thêm LÝ DO mới (không thêm giá trị enum).
describe("R-1C-g — OT stop/e_stop bị preflight từ chối ⇒ nói thẳng 'dùng E-STOP cứng'", () => {
  const LOCALES = ["vi", "en", "zh"] as const;
  const TEN_BIEN_MOI_TRUONG = /[A-Z][A-Z0-9]+_[A-Z0-9_]+/;
  const stopInput = (commandType: string) => {
    const input = baseInput({ commandType, idempotencyKey: `key-${commandType}` });
    pending.set("act-1", boundPending("act-1", input));
    return input;
  };

  it.each([
    ["e_stop", "BLOCKED", undefined, "SAFETY_BLOCKED"],
    ["stop", "UNKNOWN", undefined, "SAFETY_UNKNOWN"],
    ["e_stop", "UNKNOWN", "sim_only", "SAFETY_SIM_ONLY"],
    ["E_STOP", "UNKNOWN", undefined, "SAFETY_UNKNOWN"],
  ] as const)("%s + safety %s(%s) ⇒ vẫn rejected %s (không miễn), 0 write; lý do nói rõ lệnh dừng phần mềm bị từ chối + E-STOP cứng", async (cmd, state, basis, code) => {
    getSafetyStatusSpy.mockImplementation(async () => ({ state, source: "test", ts: new Date().toISOString(), ...(basis ? { basis } : {}) }) as any);
    const r = await dispatch(stopInput(cmd));
    expect(r.status).toBe("rejected");
    expect(r.reason).toBe(code); // mã cũ, không enum mới
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(r.appError).toEqual({ appCode: "OPERATION_FAILED", appParams: { operation: "softwareStop", reason: "softwareStopRefusedUseHardwareEstop" } });
    expect(r.message).toMatch(/software stop was REFUSED/i);
    expect(r.message).toMatch(/hardware E-STOP/);
    expect(r.message).not.toMatch(TEN_BIEN_MOI_TRUONG);
    // Sổ commandLog mang cùng câu nói thẳng.
    expect(cmdLog.some((row) => /hardware E-STOP/.test(String(row.errorText ?? row.error ?? row.detail ?? JSON.stringify(row))))).toBe(true);
  });

  it("lệnh KHÔNG phải stop bị preflight từ chối ⇒ không kèm lý do E-STOP (chỉ lệnh dừng mới được bảo dùng E-STOP)", async () => {
    safetyState = "UNKNOWN";
    const r = await dispatch(baseInput());
    expect(r.reason).toBe("SAFETY_UNKNOWN");
    expect(r.appError).toBeUndefined();
    expect(r.message).toBeUndefined();
  });

  it("stop khi safety OK ⇒ đi qua như mọi lệnh (không bị chặn oan)", async () => {
    safetyState = "OK";
    const r = await dispatch(stopInput("stop"));
    expect(r.status).toBe("acked");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
  });

  it.each(LOCALES)("%s.json: errors.reason.softwareStopRefusedUseHardwareEstop + errors.operation.softwareStop có, nhắc E-STOP, không tên biến môi trường", async (lng) => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const json = JSON.parse(readFileSync(resolve(__dirname, "../../../client/src/i18n/locales", `${lng}.json`), "utf8"));
    const reason = json.errors?.reason?.softwareStopRefusedUseHardwareEstop;
    const op = json.errors?.operation?.softwareStop;
    expect(typeof reason).toBe("string");
    expect(typeof op).toBe("string");
    expect(reason).toMatch(/E-STOP/);
    expect(reason).not.toMatch(TEN_BIEN_MOI_TRUONG);
    expect(op).not.toMatch(TEN_BIEN_MOI_TRUONG);
  });
});
