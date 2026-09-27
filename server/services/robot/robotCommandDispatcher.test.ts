/**
 * Doc 25 T1 — robotCommandDispatcher HITL gate (ĐỐI XỨNG với OT commandDispatcher).
 *
 * Chứng minh: khi triggerKind='hitl' VÀ có actionId, dispatcher PHẢI tái-xác-minh bản
 * ghi ai_pending_actions (confirmed/executed + đúng owner) — KHÔNG tin confirmedBy tự-điền.
 * Các ca:
 *   - actionId + bản ghi confirmed/executed + đúng owner → qua cổng → simulated (dry-run).
 *   - actionId + KHÔNG có bản ghi → rejected NOT_CONFIRMED, không chạy job.
 *   - actionId + sai owner → rejected.
 *   - actionId + status 'proposed' (chưa confirmed) → rejected.
 *   - thiếu confirmedBy → rejected (hành vi cũ, giữ nguyên).
 *   - KHÔNG có actionId + 'hitl' + chuyển động → rejected HITL_ACTION_REQUIRED (doc 81 Đợt 1C Task 3,
 *     2026-09-27 — trước đây chỉ cần confirmedBy ⇒ qua); 'hitl' abort không actionId vẫn qua.
 *   - triggerKind='manual' + chuyển động → CÙNG cổng HITL (doc 81 Đợt 1B Task 5); abort manual vẫn miễn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;

const pending = new Map<string, Row>();
const robotJobsRows: Row[] = [];
let seq = 1;

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "eq" }),
}));

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  return true;
}
function tableFor(table: any): Row[] {
  switch (table.__table) {
    case "ai_pending_actions": return Array.from(pending.values());
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
          if (table.__table === "robot_jobs") robotJobsRows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
  };
}

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../../drizzle/schema", () => ({
  robotJobs: { __table: "robot_jobs", idempotencyKey: { __name: "idempotencyKey" } },
  robots: { __table: "robots", id: { __name: "id" } },
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" } },
}));

// Robot runtime: connected driver (runJob không được gọi ở dry-run).
const runJobSpy = vi.fn(async () => ({ ok: true, detail: {} }));
let robotConnected = true;
vi.mock("./robotManager", () => ({
  getActiveRobot: vi.fn((_id: number) => (robotConnected ? { driver: { isConnected: () => true, runJob: (...a: any[]) => (runJobSpy as any)(...a) } } : undefined)),
}));

import { dispatchRobotJob } from "./robotCommandDispatcher";

const baseInput = (over: Record<string, any> = {}) => ({
  robotId: 3,
  job: { jobType: "home" as const, params: {} },
  triggerKind: "hitl" as const,
  actionId: "foe-r1",
  requestedBy: 7,
  confirmedBy: 7,
  idempotencyKey: undefined as string | undefined,
  ...over,
});

beforeEach(() => {
  pending.clear();
  robotJobsRows.length = 0;
  seq = 1;
  robotConnected = true;
  vi.clearAllMocks();
  process.env.ROBOT_CONTROL_ENABLED = "false"; // dry-run
  delete process.env.FIELD_V2_ENABLED; // authz X1-e off
  // mặc định: bản ghi confirmed đúng owner
  pending.set("foe-r1", { id: "foe-r1", status: "executed", userId: 7 });
});

describe("robotCommandDispatcher — HITL pending-action verify (doc 25 T1)", () => {
  it("actionId + bản ghi executed đúng owner → qua cổng → simulated", async () => {
    const r = await dispatchRobotJob(baseInput());
    expect(r.status).toBe("simulated");
    expect(r.ok).toBe(true);
    expect(runJobSpy).not.toHaveBeenCalled();
  });

  it("actionId nhưng KHÔNG có bản ghi → rejected NOT_CONFIRMED", async () => {
    const r = await dispatchRobotJob(baseInput({ actionId: "foe-nope" }));
    expect(r.status).toBe("rejected");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("NOT_CONFIRMED");
    expect(runJobSpy).not.toHaveBeenCalled();
  });

  it("actionId + sai owner → rejected", async () => {
    pending.set("foe-r1", { id: "foe-r1", status: "executed", userId: 999 });
    const r = await dispatchRobotJob(baseInput());
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("NOT_CONFIRMED");
  });

  it("actionId + status 'proposed' (chưa confirmed) → rejected", async () => {
    pending.set("foe-r1", { id: "foe-r1", status: "proposed", userId: 7 });
    const r = await dispatchRobotJob(baseInput());
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("NOT_CONFIRMED");
  });

  it("thiếu confirmedBy → rejected (giữ nguyên hành vi cũ)", async () => {
    const r = await dispatchRobotJob(baseInput({ confirmedBy: undefined }));
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("HITL confirmation required");
  });

  // doc 81 Đợt 1C Task 3 (2026-09-27, chủ dự án "Đóng") — ca này từng khẳng định "KHÔNG actionId + có
  // confirmedBy → qua (simulated)". Nay 'hitl' chuyển động không actionId bị từ chối ở MỌI chế độ (kể cả
  // dry-run); lệnh DỪNG (abort) không actionId vẫn qua.
  it("KHÔNG có actionId + 'hitl' + chuyển động + có confirmedBy → rejected HITL_ACTION_REQUIRED (dry-run cũng vậy); abort vẫn qua", async () => {
    const r = await dispatchRobotJob(baseInput({ actionId: undefined }));
    expect(r.status).toBe("rejected");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("HITL_ACTION_REQUIRED");
    expect(r.code).toBe("PRECONDITION_FAILED");
    expect(runJobSpy).not.toHaveBeenCalled();
    const stop = await dispatchRobotJob(baseInput({ actionId: undefined, job: { jobType: "abort", params: {} } }));
    expect(stop.status).toBe("simulated");
  });

  // doc 81 Đợt 1B Task 5 — manual KHÔNG còn bỏ qua HITL cho lệnh CHUYỂN ĐỘNG (trước đây ca này
  // khẳng định "manual → bỏ qua cổng HITL"). Điều kiện tương đương: có confirmedBy (người vận hành
  // đã xác nhận); lệnh dừng (abort) vẫn được miễn để không bao giờ bị khoá.
  it("triggerKind='manual' + chuyển động + KHÔNG confirmedBy → rejected (không còn bỏ qua HITL)", async () => {
    const r = await dispatchRobotJob(baseInput({ triggerKind: "manual", confirmedBy: undefined, actionId: undefined }));
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("HITL confirmation required");
  });

  it("triggerKind='manual' + chuyển động + confirmedBy → qua cổng → simulated", async () => {
    const r = await dispatchRobotJob(baseInput({ triggerKind: "manual", actionId: undefined }));
    expect(r.status).toBe("simulated");
  });

  it("triggerKind='manual' + actionId sai owner → rejected (actionId của manual cũng được tái xác minh)", async () => {
    pending.set("foe-r1", { id: "foe-r1", status: "executed", userId: 999 });
    const r = await dispatchRobotJob(baseInput({ triggerKind: "manual" }));
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("NOT_CONFIRMED");
  });

  it("triggerKind='manual' + abort (dừng) KHÔNG confirmedBy → vẫn qua (dừng không bị khoá)", async () => {
    const r = await dispatchRobotJob(
      baseInput({ triggerKind: "manual", confirmedBy: undefined, actionId: undefined, job: { jobType: "abort", params: {} } }),
    );
    expect(r.status).toBe("simulated");
  });
});
