/**
 * W3-B2 (doc 44 G3.14 — "một cửa duy nhất") — policy seam trong FOE execCommand.
 * Scaffolding = foe.test.ts (in-memory drizzle stand-in + mock 2 dispatcher E0);
 * policyGate được mock để chứng minh WIRING (engine đã có policyEvaluate.test.ts).
 *
 * Chứng minh:
 *   - SEC_PLATFORM OFF → run hoàn tất như cũ, evaluateActionPolicy KHÔNG được gọi.
 *   - ON + PERMIT → run hoàn tất NGUYÊN VẸN; action foe.command.{command},
 *     resource machine:{id}, context {runId, workflowRef, stepId, role, …}.
 *   - ON + DENY → step FAIL lý do POLICY_DENIED, dispatcher KHÔNG được gọi,
 *     run 'failed' CÓ CẤU TRÚC (không throw sập run-loop).
 *   - ON + DENY + compensation → flow saga tự nhiên: compensation vẫn chạy
 *     (và chính nó cũng qua seam — deny start / allow stop).
 *   - ON + require_approval → step FAIL POLICY_APPROVAL_REQUIRED honest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock 2 dispatcher E0 (như foe.test.ts) ──────────────────────────────────
const { otDispatchMock, robotDispatchMock } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(async () => ({
    ok: true,
    simulated: true,
    status: "simulated" as const,
    results: [],
    commandLogIds: [1],
  })),
  robotDispatchMock: vi.fn(async () => ({ ok: true, status: "simulated" as const, jobId: 7 })),
}));
vi.mock("../../ot/commandDispatcher", () => ({ dispatch: otDispatchMock }));
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));

// ── policy seam mock ─────────────────────────────────────────────────────────
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
vi.mock("../../security/policyGate", () => policyMock);

// ── tiny in-memory drizzle stand-in (bản rút gọn của foe.test.ts) ────────────
import { getTableName } from "drizzle-orm";

type Row = Record<string, any>;
const store = new Map<string, Row[]>();
const seqs = new Map<string, number>();

function tbl(t: any): string {
  return getTableName(t);
}
function nextId(name: string): number {
  const n = (seqs.get(name) ?? 0) + 1;
  seqs.set(name, n);
  return n;
}
function rows(name: string): Row[] {
  let r = store.get(name);
  if (!r) {
    r = [];
    store.set(name, r);
  }
  return r;
}

vi.mock("drizzle-orm", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: any, val: unknown) => ({ __op: "eq", col, val }),
    desc: (col: any) => ({ __op: "desc", col }),
  };
});

function colName(col: any): string {
  return col?.name ?? col?.config?.name ?? String(col);
}
function applyWhere(list: Row[], cond: any): Row[] {
  if (!cond) return list;
  if (cond.__op === "eq") return list.filter((r) => r[colName(cond.col)] === cond.val);
  return list;
}
function makeSelect(tableName: string) {
  let current = [...rows(tableName)];
  const chain: any = {
    from() {
      current = [...rows(tableName)];
      return chain;
    },
    where(cond: any) {
      current = applyWhere(current, cond);
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit(n: number) {
      return Promise.resolve(current.slice(0, n));
    },
    then(res: any, rej: any) {
      return Promise.resolve(current).then(res, rej);
    },
  };
  return chain;
}
const fakeDb = {
  select() {
    const c: any = {
      from(t: any) {
        return makeSelect(tbl(t)).from();
      },
    };
    return c;
  },
  insert(t: any) {
    const tableName = tbl(t);
    let pending: Row[] = [];
    const ins: any = {
      values(v: Row | Row[]) {
        const arr = Array.isArray(v) ? v : [v];
        pending = arr.map((row) => ({ id: nextId(tableName), ...row }));
        return ins;
      },
      returning() {
        rows(tableName).push(...pending);
        return Promise.resolve(pending);
      },
      onConflictDoUpdate(opts: any) {
        const list = rows(tableName);
        for (const row of pending) {
          const existing = list.find((r) => r.runId === row.runId && r.stepId === row.stepId);
          if (existing) Object.assign(existing, opts.set);
          else list.push(row);
        }
        return Promise.resolve();
      },
      then(res: any, rej: any) {
        rows(tableName).push(...pending);
        return Promise.resolve(pending).then(res, rej);
      },
    };
    return ins;
  },
  update(t: any) {
    const tableName = tbl(t);
    let patch: Row = {};
    const upd: any = {
      set(p: Row) {
        patch = p;
        return upd;
      },
      where(cond: any) {
        const matched = applyWhere(rows(tableName), cond);
        for (const r of matched) Object.assign(r, patch);
        return Promise.resolve();
      },
    };
    return upd;
  },
};
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));

import { deployWorkflow, startRun, getRun } from "./foeEngine";
import type { WorkflowDefinition } from "./workflowModel";

const USER = { id: 42, role: "admin", name: "tester" };

function seedMachines() {
  store.set("machines", [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
  ]);
}

beforeEach(() => {
  store.clear();
  seqs.clear();
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  policyMock.secPlatformEnabled.mockReset().mockReturnValue(false);
  policyMock.evaluateActionPolicy.mockReset().mockReturnValue({
    allow: true,
    effect: "allow",
    reason: "no matching policy",
    policyId: null,
    reasonCode: "DEFAULT_ALLOW",
    obligations: [],
  });
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  seedMachines();
});

const DEF: WorkflowDefinition = {
  ref: "pol-wf",
  name: "PolicyWF",
  steps: [{ id: "a", type: "command", machineId: 1, command: "start" }],
};

describe("FOE execCommand — policy seam (W3-B2 G3.14)", () => {
  it("SEC_PLATFORM OFF → run hoàn tất như cũ, evaluateActionPolicy KHÔNG được gọi (bit-compat)", async () => {
    await deployWorkflow(DEF, USER);
    const res = await startRun("pol-wf", {}, USER);
    expect(res.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(policyMock.evaluateActionPolicy).not.toHaveBeenCalled();
  });

  it("ON + PERMIT → run hoàn tất nguyên vẹn + action/resource/context đúng chuẩn foe.command.{command}", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    await deployWorkflow(DEF, USER);
    const res = await startRun("pol-wf", {}, USER);
    expect(res.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);

    expect(policyMock.evaluateActionPolicy).toHaveBeenCalledTimes(1);
    const [subject, action, resource, context] = policyMock.evaluateActionPolicy.mock.calls[0] as any[];
    expect(subject).toMatch(/^foe-run:\d+$/);
    expect(action).toBe("foe.command.start");
    expect(resource).toBe("machine:1");
    expect(context).toMatchObject({
      workflowRef: "pol-wf",
      stepId: "a",
      stepType: "command",
      command: "start",
      machineId: 1,
      role: "admin",
      startedBy: 42,
      attempt: 1,
    });
    expect(typeof context.runId).toBe("number");
  });

  it("ON + DENY → step FAIL POLICY_DENIED, dispatcher KHÔNG được gọi, run 'failed' có cấu trúc (không throw)", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    policyMock.evaluateActionPolicy.mockReturnValue({
      allow: false,
      effect: "deny",
      reason: "cấm start theo policy Z",
      policyId: "deny-foe-z",
      reasonCode: "POLICY_DENIED",
      obligations: [],
    });
    await deployWorkflow(DEF, USER);
    const res = await startRun("pol-wf", {}, USER);
    expect(res.status).toBe("failed"); // kết quả CÓ CẤU TRÚC — run-loop không sập
    expect(res.runId).toBeDefined();
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(robotDispatchMock).not.toHaveBeenCalled();
    // Bản ghi ủy quyền ai_pending_actions KHÔNG được tạo cho lệnh bị deny (seam đứng trước).
    expect(store.get("ai_pending_actions") ?? []).toHaveLength(0);

    const view = await getRun(res.runId!);
    const stepA = view?.steps.find((s) => s.stepId === "a");
    expect(stepA?.status).toBe("failed");
    expect(stepA?.error).toMatch(/^POLICY_DENIED: /);
    expect(stepA?.error).toContain("deny-foe-z");
  });

  it("ON + DENY + compensation → saga tự nhiên: compensation vẫn chạy (deny start / allow stop)", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    policyMock.evaluateActionPolicy.mockImplementation(((_s: string, action: string) =>
      action === "foe.command.start"
        ? {
            allow: false,
            effect: "deny",
            reason: "cấm start",
            policyId: "deny-foe-start",
            reasonCode: "POLICY_DENIED",
            obligations: [],
          }
        : {
            allow: true,
            effect: "allow",
            reason: "no matching policy",
            policyId: null,
            reasonCode: "DEFAULT_ALLOW",
            obligations: [],
          }) as any);
    const def: WorkflowDefinition = {
      ref: "pol-comp",
      name: "PolicyComp",
      steps: [
        {
          id: "main",
          type: "command",
          machineId: 1,
          command: "start",
          compensation: { id: "undo", type: "command", machineId: 1, command: "stop" },
        },
      ],
    };
    await deployWorkflow(def, USER);
    const res = await startRun("pol-comp", {}, USER);
    expect(res.status).toBe("failed");
    // 'start' bị deny (không dispatch); compensation 'stop' ĐƯỢC phép và đã dispatch.
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect((otDispatchMock.mock.calls[0] as any[])[0].commandType).toBe("stop");
    const view = await getRun(res.runId!);
    expect(view?.steps.find((s) => s.stepId === "undo")?.status).toBe("compensated");
  });

  it("ON + require_approval → step FAIL POLICY_APPROVAL_REQUIRED honest (FOE không có kênh approval per-step)", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    policyMock.evaluateActionPolicy.mockReturnValue({
      allow: false,
      effect: "require_approval",
      reason: "cần phê duyệt",
      policyId: "approve-foe",
      reasonCode: "APPROVAL_REQUIRED",
      obligations: ["require_approval"],
    });
    await deployWorkflow(DEF, USER);
    const res = await startRun("pol-wf", {}, USER);
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    const view = await getRun(res.runId!);
    expect(view?.steps.find((s) => s.stepId === "a")?.error).toMatch(/^POLICY_APPROVAL_REQUIRED: /);
  });
});
