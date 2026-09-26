/**
 * doc 80 Đợt 0 — Task 1 (ORC-01/02/03/05/06) — ENGINE FOE: hành vi an toàn điều phối.
 *
 *   • ORC-01 Abort THẬT: abort khi run đang ở `delay` / `wait_state` ⇒ 0 lệnh dispatch sau abort,
 *     trạng thái cuối `aborted` (driver KHÔNG ghi đè `completed`); lệnh ghi trạng thái cuối là
 *     UPDATE có điều kiện `status <> 'aborted'` (abort từ nơi khác — không qua registry — vẫn giữ).
 *   • ORC-02 Resume CAS: N lượt resume đồng thời ⇒ đúng MỘT thành công, driver chạy đúng một lần,
 *     các lượt còn lại CONFLICT.
 *   • ORC-03 Ép quyền duyệt cổng: vai ngoài `approverRoles` ⇒ FORBIDDEN (admin luôn được);
 *     `fourEyes` ⇒ người start KHÔNG tự duyệt (kể cả admin).
 *   • ORC-05 Rollback KHÔNG tự điền override sim-gate: lý do của NGƯỜI là bắt buộc.
 *   • ORC-06 Workflow `draft` (bản duplicate) KHÔNG chạy được tới khi qua deploy.
 *
 * DB = FakeDb dùng chung (`server/routers/__otFakeDb.ts`) — nó hỗ trợ `update … returning()`,
 * đúng thứ CAS cần để biết số hàng. eq/and/ne/inArray được mock thành vị từ JS.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const { otDispatchMock, robotDispatchMock, auditMock } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(async (_cmd?: unknown) => ({
    ok: true,
    simulated: true,
    status: "simulated" as const,
    results: [],
    commandLogIds: [1],
  })),
  robotDispatchMock: vi.fn(async () => ({ ok: true, status: "simulated" as const, jobId: 7 })),
  auditMock: vi.fn(async (..._a: unknown[]) => ({ id: 1 })),
}));
vi.mock("../../ot/commandDispatcher", () => ({ dispatch: otDispatchMock }));
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));
vi.mock("../../auditTrailService", () => ({
  createAuditContext: (x: unknown) => x,
  logCrudOperation: auditMock,
}));

function makeNe(col: { name: string }, value: unknown) {
  return (row: Record<string, unknown>) => row[col.name] !== value;
}
function makeInArray(col: { name: string }, values: unknown[]) {
  return (row: Record<string, unknown>) => values.includes(row[col.name]);
}
function makeNotInArray(col: { name: string }, values: unknown[]) {
  return (row: Record<string, unknown>) => !values.includes(row[col.name]);
}

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, ne: makeNe, inArray: makeInArray, notInArray: makeNotInArray };
});
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import {
  orchestrationRuns,
  orchestrationRunSteps,
  orchestrationWorkflows,
  machines,
} from "../../../../drizzle/schema";
import { deployWorkflow, startRun, resumeRun, abortRun, rollbackWorkflow } from "./foeEngine";
import type { WorkflowDefinition } from "./workflowModel";

const ENGINEER = { id: 10, role: "engineer", name: "eng-a" };
const ENGINEER_B = { id: 11, role: "engineer", name: "eng-b" };
const SUP = { id: 12, role: "supervisor", name: "sup-a" };
const SUP_B = { id: 14, role: "supervisor", name: "sup-b" };
const ADMIN = { id: 13, role: "admin", name: "admin" };

type Row = Record<string, any>;
function runRows(): Row[] {
  return fake.store.get("orchestration_runs") ?? [];
}
function runRow(id: number): Row {
  const r = runRows().find((x) => x.id === id);
  if (!r) throw new Error(`run ${id} không có trong store`);
  return r;
}
function stepRow(runId: number, stepId: string): Row | undefined {
  return (fake.store.get("orchestration_run_steps") ?? []).find((s) => s.runId === runId && s.stepId === stepId);
}
function dispatched(): string[] {
  return otDispatchMock.mock.calls.map((c) => (c[0] as { commandType: string }).commandType);
}
async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error("waitFor: hết giờ");
    await new Promise((r) => setTimeout(r, 5));
  }
}
function codeOf(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
  ]);
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  auditMock.mockClear();
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
});

// ════════════════════════════════════════════════════════════════════════════════
// ORC-01 — Abort THẬT
// ════════════════════════════════════════════════════════════════════════════════
describe("ORC-01 — abort dừng run ĐANG CHẠY", () => {
  it("abort khi đang ở `delay` ⇒ thoát sớm, 0 lệnh sau abort, trạng thái cuối `aborted` (không bị ghi đè `completed`)", async () => {
    const def: WorkflowDefinition = {
      ref: "abort-delay",
      name: "AbortDelay",
      steps: [
        { id: "a", type: "command", machineId: 1, command: "start" },
        { id: "d", type: "delay", ms: 1500 },
        { id: "b", type: "command", machineId: 1, command: "stop" },
      ],
    };
    expect((await deployWorkflow(def, ENGINEER)).ok).toBe(true);

    const t0 = Date.now();
    const pending = startRun("abort-delay", {}, ENGINEER);
    await waitFor(() => runRows().length === 1 && stepRow(runRows()[0].id, "d")?.status === "running");
    const runId = runRows()[0].id as number;
    expect(dispatched()).toEqual(["start"]);

    const ab = await abortRun(runId, SUP, "dung khan cap");
    expect(ab.ok).toBe(true);
    const res = await pending;

    // 0 lệnh sau thời điểm abort — 'b' (stop) KHÔNG được dispatch.
    expect(dispatched()).toEqual(["start"]);
    expect(res.status).toBe("aborted");
    expect(runRow(runId).status).toBe("aborted");
    // lý do của NGƯỜI abort được giữ (driver không ghi đè error)
    expect(String(runRow(runId).error)).toContain("dung khan cap");
    // delay 1500 ms được đánh thức bởi AbortSignal, không ngủ hết
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(stepRow(runId, "b")).toBeUndefined();
  });

  it("abort khi đang ở `wait_state` (poll) ⇒ thoát sớm, 0 lệnh sau abort, `aborted`", async () => {
    const mod = await import("../../equipment/equipmentAdapter");
    const spy = vi.spyOn(mod.equipmentRegistry, "getAdapter").mockReturnValue({
      kind: "ot-opcua",
      delegatesTo: "ot",
      testConnection: async () => ({ ok: true }),
      readTelemetry: async () => [],
      sendCommand: async (cmd: { name: string }) => {
        await otDispatchMock({ commandType: cmd.name } as never);
        return { ok: true, routedTo: "ot-dispatcher", status: "simulated" };
      },
      getState: async () => ({ state: "Idle" }), // không bao giờ tới "Execute"
    } as never);
    try {
      const def: WorkflowDefinition = {
        ref: "abort-wait",
        name: "AbortWait",
        steps: [
          { id: "w", type: "wait_state", machineId: 1, targetStates: ["Execute"], timeoutMs: 1500, pollMs: 20 },
          { id: "b", type: "command", machineId: 1, command: "stop" },
        ],
      };
      expect((await deployWorkflow(def, ENGINEER)).ok).toBe(true);
      const t0 = Date.now();
      const pending = startRun("abort-wait", {}, ENGINEER);
      await waitFor(() => runRows().length === 1 && stepRow(runRows()[0].id, "w")?.status === "running");
      const runId = runRows()[0].id as number;

      expect((await abortRun(runId, SUP)).ok).toBe(true);
      const res = await pending;
      expect(res.status).toBe("aborted");
      expect(runRow(runId).status).toBe("aborted");
      expect(dispatched()).toEqual([]);
      expect(Date.now() - t0).toBeLessThan(1000);
    } finally {
      spy.mockRestore();
    }
  });

  it("run bị abort ở NƠI KHÁC (DB = aborted, không qua registry) ⇒ lệnh ghi trạng thái cuối KHÔNG ghi đè `aborted`", async () => {
    const def: WorkflowDefinition = {
      ref: "abort-elsewhere",
      name: "AbortElsewhere",
      steps: [{ id: "a", type: "command", machineId: 1, command: "start" }],
    };
    expect((await deployWorkflow(def, ENGINEER)).ok).toBe(true);
    // Trong lúc bước 'a' đang dispatch, một instance khác ghi DB `aborted`.
    otDispatchMock.mockImplementationOnce(async () => {
      for (const r of runRows()) r.status = "aborted";
      return { ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] };
    });
    const res = await startRun("abort-elsewhere", {}, ENGINEER);
    const runId = res.runId!;
    expect(runRow(runId).status).toBe("aborted");
    expect(res.status).toBe("aborted");
  });

  it("abort run đã terminal ⇒ ok:false, không đổi trạng thái", async () => {
    const def: WorkflowDefinition = {
      ref: "abort-done",
      name: "AbortDone",
      steps: [{ id: "a", type: "command", machineId: 1, command: "start" }],
    };
    await deployWorkflow(def, ENGINEER);
    const res = await startRun("abort-done", {}, ENGINEER);
    expect(res.status).toBe("completed");
    const ab = await abortRun(res.runId!, SUP);
    expect(ab.ok).toBe(false);
    expect(runRow(res.runId!).status).toBe("completed");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// ORC-02 — Resume CAS
// ════════════════════════════════════════════════════════════════════════════════
describe("ORC-02 — resume là compare-and-set", () => {
  const GATE_DEF: WorkflowDefinition = {
    ref: "cas-gate",
    name: "CasGate",
    steps: [
      { id: "g", type: "hitl_gate", prompt: "Duyệt?" },
      { id: "after", type: "command", machineId: 1, command: "start" },
    ],
  };

  it("20 lượt resume ĐỒNG THỜI ⇒ đúng 1 thành công, driver chạy đúng 1 lần, 19 lượt CONFLICT", async () => {
    await deployWorkflow(GATE_DEF, ENGINEER);
    const started = await startRun("cas-gate", {}, ENGINEER);
    expect(started.status).toBe("awaiting_confirm");

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => resumeRun(started.runId!, { approved: true }, SUP)),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect((ok[0] as PromiseFulfilledResult<{ status?: string }>).value.status).toBe("completed");
    expect(rejected).toHaveLength(19);
    expect(rejected.every((r) => codeOf(r.reason) === "CONFLICT")).toBe(true);
    // driver chạy đúng một lần ⇒ lệnh sau gate dispatch đúng một lần
    expect(dispatched()).toEqual(["start"]);
    expect(runRow(started.runId!).status).toBe("completed");
  });

  it("duyệt và từ chối ĐỒNG THỜI ⇒ đúng một quyết định thắng", async () => {
    await deployWorkflow(GATE_DEF, ENGINEER);
    const started = await startRun("cas-gate", {}, ENGINEER);
    const results = await Promise.allSettled([
      resumeRun(started.runId!, { approved: true }, SUP),
      resumeRun(started.runId!, { approved: false, note: "khong" }, SUP_B),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rej = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(codeOf(rej.reason)).toBe("CONFLICT");
  });

  it("resume run KHÔNG ở trạng thái chờ (đã completed) ⇒ không chạy lại driver", async () => {
    await deployWorkflow(GATE_DEF, ENGINEER);
    const started = await startRun("cas-gate", {}, ENGINEER);
    await resumeRun(started.runId!, { approved: true }, SUP);
    otDispatchMock.mockClear();
    const again = await resumeRun(started.runId!, { approved: true }, SUP).catch((e) => e);
    expect(dispatched()).toEqual([]);
    // hoặc ok:false (not resumable) — không bao giờ là một lượt chạy mới
    expect((again as { ok?: boolean }).ok === false || codeOf(again) === "CONFLICT").toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// ORC-03 — Ép quyền duyệt cổng
// ════════════════════════════════════════════════════════════════════════════════
describe("ORC-03 — approverRoles + fourEyes được ÉP", () => {
  const ROLE_DEF: WorkflowDefinition = {
    ref: "gate-roles",
    name: "GateRoles",
    steps: [
      { id: "g", type: "hitl_gate", prompt: "Supervisor duyệt", approverRoles: ["supervisor"] },
      { id: "after", type: "command", machineId: 1, command: "start" },
    ],
  };

  it("vai NGOÀI approverRoles ⇒ FORBIDDEN, run vẫn chờ duyệt, 0 lệnh", async () => {
    await deployWorkflow(ROLE_DEF, ENGINEER);
    const started = await startRun("gate-roles", {}, ENGINEER);
    const err = await resumeRun(started.runId!, { approved: true }, ENGINEER_B).catch((e) => e);
    expect(codeOf(err)).toBe("FORBIDDEN");
    expect(runRow(started.runId!).status).toBe("awaiting_confirm");
    expect(dispatched()).toEqual([]);
  });

  it("vai THUỘC approverRoles ⇒ qua", async () => {
    await deployWorkflow(ROLE_DEF, ENGINEER);
    const started = await startRun("gate-roles", {}, ENGINEER);
    const res = await resumeRun(started.runId!, { approved: true }, SUP);
    expect(res.status).toBe("completed");
    expect(dispatched()).toEqual(["start"]);
  });

  it("admin luôn được duyệt (dù không có trong approverRoles)", async () => {
    await deployWorkflow(ROLE_DEF, ENGINEER);
    const started = await startRun("gate-roles", {}, ENGINEER);
    const res = await resumeRun(started.runId!, { approved: true }, ADMIN);
    expect(res.status).toBe("completed");
  });

  const FOUR_EYES_DEF: WorkflowDefinition = {
    ref: "gate-4eyes",
    name: "Gate4Eyes",
    steps: [
      { id: "g", type: "hitl_gate", prompt: "Người khác duyệt", fourEyes: true },
      { id: "after", type: "command", machineId: 1, command: "start" },
    ],
  };

  it("fourEyes: người START tự duyệt ⇒ FORBIDDEN (kể cả admin)", async () => {
    await deployWorkflow(FOUR_EYES_DEF, ADMIN);
    const started = await startRun("gate-4eyes", {}, ADMIN);
    const err = await resumeRun(started.runId!, { approved: true }, ADMIN).catch((e) => e);
    expect(codeOf(err)).toBe("FORBIDDEN");
    expect(runRow(started.runId!).status).toBe("awaiting_confirm");
    expect(dispatched()).toEqual([]);
  });

  it("fourEyes: người KHÁC duyệt ⇒ qua", async () => {
    await deployWorkflow(FOUR_EYES_DEF, SUP);
    const started = await startRun("gate-4eyes", {}, SUP);
    const res = await resumeRun(started.runId!, { approved: true }, SUP_B);
    expect(res.status).toBe("completed");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// ORC-05 — Rollback không tự điền override sim-gate
// ════════════════════════════════════════════════════════════════════════════════
describe("ORC-05 — rollback đòi lý do của NGƯỜI", () => {
  const base = (cmd: string): WorkflowDefinition => ({
    ref: "rb",
    name: "RB",
    steps: [{ id: "a", type: "command", machineId: 1, command: cmd }],
  });

  it("thiếu lý do (≤2 ký tự) ⇒ từ chối, không tạo phiên bản mới", async () => {
    const d1 = await deployWorkflow(base("start"), ENGINEER);
    await deployWorkflow(base("stop"), ENGINEER);
    const res = await rollbackWorkflow(d1.workflowId!, 1, ENGINEER, "  x ");
    expect(res.ok).toBe(false);
    const wf = (fake.store.get("orchestration_workflows") ?? [])[0];
    expect(wf.version).toBe(2);
  });

  it("sim-gate BẬT: override mang ĐÚNG lý do của người (không chuỗi tự điền)", async () => {
    const d1 = await deployWorkflow(base("start"), ENGINEER);
    await deployWorkflow(base("stop"), ENGINEER);
    process.env.FOE_SIM_GATE_REQUIRED = "true";
    const res = await rollbackWorkflow(d1.workflowId!, 1, ENGINEER, "khach hang yeu cau quay lai v1");
    expect(res.ok).toBe(true);
    await waitFor(() => auditMock.mock.calls.length > 0);
    const reasons = auditMock.mock.calls.map(
      (c) => ((c[1] as { details?: { metadata?: { reason?: unknown } } })?.details?.metadata?.reason ?? null) as unknown,
    );
    expect(reasons.some((r) => typeof r === "string" && r.includes("khach hang yeu cau quay lai v1"))).toBe(true);
    expect(reasons.some((r) => typeof r === "string" && r.includes("previously deployed, validated content"))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// ORC-06 — workflow `draft` không chạy được
// ════════════════════════════════════════════════════════════════════════════════
describe("ORC-06 — workflow draft phải qua deploy mới chạy", () => {
  it("startRun trên workflow `draft` ⇒ ok:false, 0 run, 0 lệnh; deploy xong ⇒ chạy được", async () => {
    const def: WorkflowDefinition = {
      ref: "dup-copy",
      name: "Copy",
      steps: [{ id: "a", type: "command", machineId: 1, command: "start" }],
    };
    fake.seed(orchestrationWorkflows, [
      { id: 500, ref: "dup-copy", name: "Copy", version: 1, definitionJson: def, status: "draft", createdBy: 10 },
    ]);
    const res = await startRun("dup-copy", {}, ENGINEER);
    expect(res.ok).toBe(false);
    expect(runRows()).toHaveLength(0);
    expect(dispatched()).toEqual([]);

    const dep = await deployWorkflow(def, ENGINEER);
    expect(dep.ok).toBe(true);
    const wf = (fake.store.get("orchestration_workflows") ?? []).find((w) => w.ref === "dup-copy");
    expect(wf?.status).toBe("active");
    const res2 = await startRun("dup-copy", {}, ENGINEER);
    expect(res2.status).toBe("completed");
    expect(dispatched()).toEqual(["start"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// ORC-01 fix round 1 — một exception SAU abort (persistContext/upsertStep ném) đi vào các nhánh
// catch "failed" của startRun (sync + async) / resumeRun ⇒ các lệnh ghi ấy cũng phải có điều kiện.
// ════════════════════════════════════════════════════════════════════════════════
describe("ORC-01 (fix round 1) — lỗi SAU abort không được ghi đè `aborted` thành `failed`", () => {
  /** Sau khi `arm()`, mọi UPDATE mang `contextJson` (persistContext) sẽ NÉM. */
  function armPersistBoom() {
    let armed = false;
    const orig = fake.update.bind(fake);
    const spy = vi.spyOn(fake, "update").mockImplementation((t: any) => {
      const b = orig(t);
      const origSet = b.set;
      b.set = (p: Record<string, unknown>) => {
        if (armed && "contextJson" in p) throw new Error("persist boom after abort");
        return origSet(p);
      };
      return b;
    });
    return { arm: () => { armed = true; }, restore: () => spy.mockRestore() };
  }
  const DELAY_DEF: WorkflowDefinition = {
    ref: "abort-boom",
    name: "AbortBoom",
    steps: [
      { id: "d", type: "delay", ms: 1500 },
      { id: "b", type: "command", machineId: 1, command: "stop" },
    ],
  };

  it("startRun ĐỒNG BỘ: abort rồi persistContext ném ⇒ vẫn `aborted`", async () => {
    await deployWorkflow(DELAY_DEF, ENGINEER);
    const boom = armPersistBoom();
    try {
      const pending = startRun("abort-boom", {}, ENGINEER);
      await waitFor(() => runRows().length === 1 && stepRow(runRows()[0].id, "d")?.status === "running");
      const runId = runRows()[0].id as number;
      boom.arm();
      expect((await abortRun(runId, SUP, "dung")).ok).toBe(true);
      await pending;
      expect(runRow(runId).status).toBe("aborted");
      expect(String(runRow(runId).error)).toContain("dung");
      expect(dispatched()).toEqual([]);
    } finally {
      boom.restore();
    }
  });

  it("startRun ASYNC: abort rồi persistContext ném ⇒ vẫn `aborted`", async () => {
    await deployWorkflow(DELAY_DEF, ENGINEER);
    const boom = armPersistBoom();
    try {
      const res = await startRun("abort-boom", {}, ENGINEER, { async: true });
      const runId = res.runId!;
      await waitFor(() => stepRow(runId, "d")?.status === "running");
      boom.arm();
      expect((await abortRun(runId, SUP, "dung")).ok).toBe(true);
      // chờ drive nền kết thúc (nhánh catch nền chạy xong)
      await new Promise((r) => setTimeout(r, 100));
      expect(runRow(runId).status).toBe("aborted");
      expect(String(runRow(runId).error)).toContain("dung");
      expect(dispatched()).toEqual([]);
    } finally {
      boom.restore();
    }
  });

  it("resumeRun: abort giữa lúc resume đang chạy rồi persistContext ném ⇒ vẫn `aborted`", async () => {
    const def: WorkflowDefinition = {
      ref: "abort-boom-resume",
      name: "AbortBoomResume",
      steps: [
        { id: "g", type: "hitl_gate", prompt: "Duyệt?" },
        { id: "d", type: "delay", ms: 1500 },
        { id: "b", type: "command", machineId: 1, command: "stop" },
      ],
    };
    await deployWorkflow(def, ENGINEER);
    const started = await startRun("abort-boom-resume", {}, ENGINEER);
    expect(started.status).toBe("awaiting_confirm");
    const runId = started.runId!;
    const boom = armPersistBoom();
    try {
      const pending = resumeRun(runId, { approved: true }, SUP);
      await waitFor(() => stepRow(runId, "d")?.status === "running");
      boom.arm();
      expect((await abortRun(runId, SUP_B, "dung")).ok).toBe(true);
      await pending;
      expect(runRow(runId).status).toBe("aborted");
      expect(String(runRow(runId).error)).toContain("dung");
      expect(dispatched()).toEqual([]);
    } finally {
      boom.restore();
    }
  });
});

// giữ tham chiếu để tsc không cảnh báo import không dùng
void orchestrationRuns;
