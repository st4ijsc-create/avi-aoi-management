/**
 * W3-B2 (doc 44 G3.14 — "một cửa duy nhất") — policy seam 4a-policy trong
 * robotCommandDispatcher. Pattern test = lineControllerService.test.ts (W3-A1):
 * mock module policyGate, chứng minh WIRING (engine đã có policyEvaluate.test.ts).
 *
 * Chứng minh:
 *   - SEC_PLATFORM OFF → 0 khác biệt: dry-run 'simulated' / real-run 'done',
 *     evaluateActionPolicy KHÔNG được gọi (bit-compat).
 *   - OFF + dry-run: seam nằm SAU mode-gate → policy không chạy ở nhánh simulated.
 *   - ON + DENY → rejected + ledger robot_jobs row 'POLICY_DENIED: …', runJob KHÔNG chạy.
 *   - ON + require_approval (không có kênh approval) → rejected POLICY_APPROVAL_REQUIRED honest.
 *   - ON + PERMIT → đi tiếp nguyên vẹn (interlock → runJob → done).
 *   - ON: action/resource/context đúng chuẩn robot.command.{verb} / robot:{id}.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;

const robotJobsRows: Row[] = [];
let seq = 1;

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.__name, __v: val }),
  and: (...preds: any[]) => ({ __op: "and", preds }),
}));

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "and") return pred.preds.every((p: any) => matches(row, p));
  return true;
}
function tableFor(table: any): Row[] {
  switch (table?.__table) {
    case "robot_jobs":
      return robotJobsRows;
    default:
      return []; // robots / robot_commissioning_records / ai_pending_actions: rỗng
  }
}
function makeFakeDb() {
  return {
    select: (_sel?: any) => ({
      from: (table: any) => {
        const filtered = (pred: any) => tableFor(table).filter((r) => matches(r, pred));
        return {
          where: (pred: any) => ({
            limit: async (_n?: number) => filtered(pred).slice(0, 1),
            // isRobotCommissioned await-s .where(...) trực tiếp (không .limit)
            then: (res: any, rej: any) => Promise.resolve(filtered(pred)).then(res, rej),
          }),
          limit: async (_n?: number) => tableFor(table).slice(0, 1),
        };
      },
    }),
    insert: (table: any) => ({
      values: (vals: Row) => ({
        returning: async () => {
          const row = { id: seq++, ...vals };
          if (table?.__table === "robot_jobs") robotJobsRows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
  };
}

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../../drizzle/schema", () => ({
  robotJobs: { __table: "robot_jobs", idempotencyKey: { __name: "idempotencyKey" } },
  robots: { __table: "robots", id: { __name: "id" }, kind: { __name: "kind" } },
  aiPendingActions: {
    __table: "ai_pending_actions",
    id: { __name: "id" },
    status: { __name: "status" },
    userId: { __name: "userId" },
  },
}));

// Pin role của actor (best-effort role resolve trong seam).
vi.mock("../../db/auth", () => ({
  getUserById: vi.fn(async (id: number) => ({ id, role: "engineer" })),
}));

// Driver kết nối; runJob spy chứng minh DENY chặn TRƯỚC driver.
const runJobSpy = vi.fn(async () => ({ ok: true, detail: {} }));
vi.mock("./robotManager", () => ({
  getActiveRobot: vi.fn((_id: number) => ({
    driver: { isConnected: () => true, runJob: (...a: any[]) => (runJobSpy as any)(...a) },
  })),
}));

// Cô lập gate 4b (interlock có test riêng): pass để PERMIT chảy tới driver.
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async () => ({ blocked: false, failClosed: false, violations: [] })),
}));

// Policy seam mock — điều khiển được từng test (pattern lineControllerService.test.ts).
const policyMock = vi.hoisted(() => ({
  secPlatformEnabled: vi.fn((): boolean => false),
  evaluateActionPolicy: vi.fn(() => ({
    allow: true,
    effect: "allow" as const,
    reason: "no matching policy",
    policyId: null as string | null,
    reasonCode: "DEFAULT_ALLOW",
    obligations: [] as string[],
  })),
}));
vi.mock("../security/policyGate", () => policyMock);

import { dispatchRobotJob } from "./robotCommandDispatcher";

const baseInput = (over: Record<string, any> = {}) => ({
  robotId: 3,
  job: { jobType: "home" as const, params: { speed: 50 } },
  triggerKind: "manual" as const, // đường manual: cô lập seam khỏi cổng HITL (đã có test riêng)
  requestedBy: 7,
  ...over,
});

beforeEach(() => {
  robotJobsRows.length = 0;
  seq = 1;
  vi.clearAllMocks();
  policyMock.secPlatformEnabled.mockReturnValue(false);
  policyMock.evaluateActionPolicy.mockReturnValue({
    allow: true,
    effect: "allow",
    reason: "no matching policy",
    policyId: null,
    reasonCode: "DEFAULT_ALLOW",
    obligations: [],
  });
  delete process.env.FIELD_V2_ENABLED;
  process.env.ROBOT_CONTROL_ENABLED = "true"; // seam chỉ reachable ở nhánh real
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false"; // cô lập gate 4a (FAT) khỏi seam
});

describe("robotCommandDispatcher — policy seam 4a-policy (W3-B2 G3.14)", () => {
  it("SEC_PLATFORM OFF → real-run 'done' như cũ, evaluateActionPolicy KHÔNG được gọi (bit-compat)", async () => {
    const r = await dispatchRobotJob(baseInput());
    expect(r.status).toBe("done");
    expect(r.ok).toBe(true);
    expect(runJobSpy).toHaveBeenCalledTimes(1);
    expect(policyMock.evaluateActionPolicy).not.toHaveBeenCalled();
  });

  it("SEC_PLATFORM OFF + dry-run → 'simulated' như cũ, policy KHÔNG được gọi", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "false";
    const r = await dispatchRobotJob(baseInput());
    expect(r.status).toBe("simulated");
    expect(policyMock.evaluateActionPolicy).not.toHaveBeenCalled();
  });

  it("ON + dry-run → seam nằm SAU mode-gate: vẫn 'simulated', policy KHÔNG chạy (chỉ gác nhánh real)", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    process.env.ROBOT_CONTROL_ENABLED = "false";
    const r = await dispatchRobotJob(baseInput());
    expect(r.status).toBe("simulated");
    expect(policyMock.evaluateActionPolicy).not.toHaveBeenCalled();
  });

  it("ON + DENY → rejected POLICY_DENIED + ledger row, runJob KHÔNG được gọi", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    policyMock.evaluateActionPolicy.mockReturnValue({
      allow: false,
      effect: "deny",
      reason: "robot bị cấm theo policy X",
      policyId: "deny-robot-x",
      reasonCode: "POLICY_DENIED",
      obligations: [],
    });
    const r = await dispatchRobotJob(baseInput());
    expect(r.status).toBe("rejected");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("POLICY_DENIED");
    expect(runJobSpy).not.toHaveBeenCalled();
    // Ledger append-only: đúng 1 row rejected với errorText tiền tố POLICY_DENIED + policyRef.
    expect(robotJobsRows).toHaveLength(1);
    expect(robotJobsRows[0].status).toBe("rejected");
    expect(robotJobsRows[0].errorText).toMatch(/^POLICY_DENIED: /);
    expect(robotJobsRows[0].result).toMatchObject({ policyRef: "deny-robot-x", effect: "deny" });
  });

  it("ON + require_approval (không có kênh approval riêng) → rejected POLICY_APPROVAL_REQUIRED honest", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    policyMock.evaluateActionPolicy.mockReturnValue({
      allow: false,
      effect: "require_approval",
      reason: "cần four-eyes",
      policyId: "approve-robot-y",
      reasonCode: "APPROVAL_REQUIRED",
      obligations: ["require_approval"],
    });
    const r = await dispatchRobotJob(baseInput());
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("POLICY_APPROVAL_REQUIRED");
    expect(runJobSpy).not.toHaveBeenCalled();
    expect(robotJobsRows[0].errorText).toMatch(/^POLICY_APPROVAL_REQUIRED: /);
  });

  it("ON + PERMIT → đi tiếp NGUYÊN VẸN (interlock → runJob → done) + action/resource/context đúng chuẩn", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    const r = await dispatchRobotJob(baseInput({ confirmedBy: 9 }));
    expect(r.status).toBe("done");
    expect(runJobSpy).toHaveBeenCalledTimes(1);

    expect(policyMock.evaluateActionPolicy).toHaveBeenCalledTimes(1);
    const [subject, action, resource, context] = policyMock.evaluateActionPolicy.mock.calls[0] as any[];
    expect(subject).toBe("user:9"); // actor = confirmedBy ?? requestedBy
    expect(action).toBe("robot.command.home"); // robot.command.{verb}
    expect(resource).toBe("robot:3");
    expect(context).toMatchObject({
      verb: "home",
      robotId: 3,
      triggerKind: "manual",
      mode: "real",
      role: "engineer", // resolve qua db/auth (mocked)
      fat_passed: false, // không có bản ghi commissioning trong fake DB
      requestedBy: 7,
      confirmedBy: 9,
    });
    expect(context.argsKeys).toEqual(["speed"]); // args-summary: chỉ TÊN khóa, không leak giá trị
  });
});
