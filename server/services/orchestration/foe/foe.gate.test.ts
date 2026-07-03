/**
 * Doc 25 T1 — ĐƯỜNG THẬT (không mock dispatcher): lệnh kiểu-FOE đi qua facade
 * equipmentRegistry.sendCommand → dispatcher THẬT (OT commandDispatcher / robot
 * robotCommandDispatcher). Chứng minh cho CẢ OT lẫn robot:
 *   - HỢP LỆ: FOE tạo bản ghi ai_pending_actions confirmed thật (actionId `foe-…`,
 *     owner = user) → cổng HITL tái-xác-minh QUA → dry-run `simulated`.
 *   - KHÔNG HỢP LỆ: actionId `foe-…` KHÔNG có bản ghi (đúng lỗi cũ mà mock che) → cổng
 *     TỪ CHỐI (NOT_CONFIRMED), không ghi thiết bị.
 *
 * Đây là bằng chứng test cũ (foe.test.ts) chỉ xanh vì MOCK dispatcher; ở đây dispatcher
 * là THẬT nên cổng thực sự chặn/duyệt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;

const pending = new Map<string, Row>();
const adapters: Row[] = [];
const tags: Row[] = [];
const cmdLog: Row[] = [];
const robotJobsRows: Row[] = [];
let seq = 1;

// eq/and mock (mirrors commandDispatcher.test.ts) — WHERE áp bằng JS.
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
    case "robot_jobs": return robotJobsRows;
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
          const row = { id: seq++, ...vals };
          if (table.__table === "command_log") cmdLog.push(row);
          if (table.__table === "robot_jobs") robotJobsRows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
  };
}

vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../../../drizzle/schema", () => ({
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" } },
  deviceAdapters: { __table: "device_adapters", id: { __name: "id" }, isEnabled: { __name: "isEnabled" } },
  deviceTags: { __table: "device_tags", id: { __name: "id" }, adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" } },
  commandLog: { __table: "command_log", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" }, status: { __name: "status" } },
  robotJobs: { __table: "robot_jobs", idempotencyKey: { __name: "idempotencyKey" } },
  robots: { __table: "robots", id: { __name: "id" } },
  interlockRules: { __table: "interlock_rules", id: { __name: "id" } },
  interlockEvents: { __table: "interlock_events", id: { __name: "id" } },
}));

// Audit + interlock gate (chỉ dùng ở nhánh control-on / interlock; ta giữ dry-run) — mock trơ.
vi.mock("../../auditTrailService", () => ({
  AUDIT_ACTIONS: { INTERLOCK_AUTO_BLOCK: "interlock_auto_block" },
  createAuditContext: (x: any) => x,
  logCrudOperation: vi.fn(async () => ({ id: 1 })),
}));
vi.mock("../../interlock/interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async () => ({ blocked: false, failClosed: false, violations: [] })),
}));

// OT driver connected (writeTags KHÔNG được gọi ở dry-run).
vi.mock("../../ot/otManager", () => ({
  getActiveDriver: vi.fn((_id: number) => ({ isConnected: () => true, writeTags: vi.fn(), readTags: vi.fn() })),
}));
// Robot runtime connected (runJob KHÔNG được gọi ở dry-run).
vi.mock("../../robot/robotManager", () => ({
  getActiveRobot: vi.fn((_id: number) => ({ driver: { isConnected: () => true, runJob: vi.fn(async () => ({ ok: true })) } })),
}));

import { equipmentRegistry, type EquipmentCommand } from "../../equipment/equipmentAdapter";

const USER = 7;

// Lệnh kiểu-FOE: actionId `foe-…`, confirmedBy/requestedBy = user khởi động run.
function otFoeCommand(actionId: string, key: string): EquipmentCommand {
  return {
    name: "start",
    adapterId: 10,
    machineId: 5,
    writes: [{ tagKey: "cmd_start", value: true }],
    idempotencyKey: key,
    hitl: { actionId, requestedBy: USER, confirmedBy: USER },
  };
}
function robotFoeCommand(actionId: string, key: string): EquipmentCommand {
  return {
    name: "run_job",
    robotId: 3,
    machineId: 3,
    job: { jobType: "home", params: {} },
    idempotencyKey: key,
    hitl: { actionId, requestedBy: USER, confirmedBy: USER },
  };
}

beforeEach(() => {
  pending.clear();
  adapters.length = 0;
  tags.length = 0;
  cmdLog.length = 0;
  robotJobsRows.length = 0;
  seq = 1;
  vi.clearAllMocks();
  equipmentRegistry._clear();
  process.env.OT_CONTROL_ENABLED = "false"; // dry-run
  process.env.ROBOT_CONTROL_ENABLED = "false";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  delete process.env.FIELD_V2_ENABLED;
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  tags.push({ id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", dataType: "bool", scale: "1", offset: "0", writable: true, isEnabled: true });
});

describe("FOE → REAL OT gate (equipmentRegistry.sendCommand, no dispatcher mock)", () => {
  it("HỢP LỆ: bản ghi ai_pending_actions confirmed → cổng QUA → simulated", async () => {
    pending.set("foe-run1-a-a1", { id: "foe-run1-a-a1", status: "executed", userId: USER });
    const res = await equipmentRegistry.getAdapter("ot-opcua").sendCommand(otFoeCommand("foe-run1-a-a1", "run1-a-a1"));
    expect(res.routedTo).toBe("ot-dispatcher");
    expect(res.ok).toBe(true);
    expect(res.status).toBe("simulated");
  });

  it("KHÔNG HỢP LỆ: actionId `foe-…` không có bản ghi → rejected NOT_CONFIRMED", async () => {
    const res = await equipmentRegistry.getAdapter("ot-opcua").sendCommand(otFoeCommand("foe-nope", "run1-a-a1"));
    expect(res.ok).toBe(false);
    expect(res.status).toBe("rejected");
    expect(res.detail?.reason).toBe("NOT_CONFIRMED");
  });
});

describe("FOE → REAL robot gate (equipmentRegistry.sendCommand, no dispatcher mock)", () => {
  it("HỢP LỆ: bản ghi ai_pending_actions confirmed → cổng QUA → simulated", async () => {
    pending.set("foe-run2-r-a1", { id: "foe-run2-r-a1", status: "executed", userId: USER });
    const res = await equipmentRegistry.getAdapter("robot").sendCommand(robotFoeCommand("foe-run2-r-a1", "run2-r-a1"));
    expect(res.routedTo).toBe("robot-dispatcher");
    expect(res.ok).toBe(true);
    expect(res.status).toBe("simulated");
  });

  it("KHÔNG HỢP LỆ: actionId `foe-…` không có bản ghi → rejected NOT_CONFIRMED", async () => {
    const res = await equipmentRegistry.getAdapter("robot").sendCommand(robotFoeCommand("foe-nope", "run2-r-a1"));
    expect(res.ok).toBe(false);
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("NOT_CONFIRMED");
  });
});
