/**
 * Phase E2 — Factory Control Plane: FOE engine + model unit tests.
 *
 * Covers (vitest; mocks the E0 dispatchers + a tiny in-memory drizzle stand-in):
 *   • validateWorkflow — good / bad (unknown machine, unknown command, malformed).
 *   • executor — a command SEQUENCE runs in order, in SIMULATION (sendCommand routes
 *     to the EXISTING HITL dispatcher in dry-run; assert called + order + HITL trigger).
 *   • parallel runs concurrently; branch picks the right path.
 *   • wait_state resolves + times out.
 *   • hitl_gate → awaiting_confirm, then resumeRun continues.
 *   • onError → compensation runs + run failed.
 *   • flag-off startRun → disabled.
 *   • fail-safe — a step throwing → run failed, no crash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock the EXISTING dispatchers (E0 routes sendCommand here in dry-run) ──
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

// ── tiny in-memory drizzle stand-in (only the chains the engine uses) ──
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

// `eq`/`desc` are mocked to capture {col,val}; WHERE is applied as JS.
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
    let tableName = "";
    const c: any = {
      from(t: any) {
        tableName = tbl(t);
        return makeSelect(tableName).from();
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
        // upsert on (runId, stepId) for run_steps
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

vi.mock("../../../db/connection", () => ({
  getDb: vi.fn(async () => fakeDb),
}));

import {
  validateWorkflow,
  evaluateCondition,
  type WorkflowDefinition,
} from "./workflowModel";
import {
  deployWorkflow,
  rollbackWorkflow,
  startRun,
  resumeRun,
  getRun,
  rehydrateInterruptedRuns,
} from "./foeEngine";

const USER = { id: 42, role: "admin", name: "tester" };

// Seed machines: id 1 = AUTOMATION (ot-opcua, supports start/stop), id 2 = AOI (vision).
function seedMachines() {
  store.set("machines", [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "AOI", capabilities: null, code: "M2", name: "Aoi-1", operationStatus: "stopped", stationId: 1 },
  ]);
}

function reset() {
  store.clear();
  seqs.clear();
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = ""; // dry-run (the existing dispatcher is mocked anyway)
  seedMachines();
}

beforeEach(reset);

// ════════════════════════════════════════════════════════════════════════════════
// validateWorkflow
// ════════════════════════════════════════════════════════════════════════════════
describe("validateWorkflow", () => {
  const machines = [{ id: 1, machineType: "AUTOMATION", capabilities: null }];

  it("accepts a well-formed command sequence", () => {
    const def: WorkflowDefinition = {
      ref: "wf-ok",
      name: "OK",
      steps: [
        { id: "s1", type: "command", machineId: 1, command: "start" },
        { id: "s2", type: "command", machineId: 1, command: "stop" },
      ],
    };
    const res = validateWorkflow(def, machines);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.referencedMachineIds).toContain(1);
  });

  it("rejects an unknown machine", () => {
    const def: WorkflowDefinition = {
      ref: "wf-badmachine",
      name: "Bad",
      steps: [{ id: "s1", type: "command", machineId: 999, command: "start" }],
    };
    const res = validateWorkflow(def, machines);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /machine 999 does not exist/i.test(e.message))).toBe(true);
  });

  it("rejects an unsupported command on a machine", () => {
    const def: WorkflowDefinition = {
      ref: "wf-badcmd",
      name: "Bad",
      steps: [{ id: "s1", type: "command", machineId: 1, command: "fly_to_moon" }],
    };
    const res = validateWorkflow(def, machines);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /does not support command/i.test(e.message))).toBe(true);
  });

  it("rejects a malformed definition (no steps, duplicate ids)", () => {
    const noSteps = validateWorkflow({ ref: "x", name: "x", steps: [] } as WorkflowDefinition, machines);
    expect(noSteps.ok).toBe(false);

    const dup: WorkflowDefinition = {
      ref: "wf-dup",
      name: "Dup",
      steps: [
        { id: "same", type: "delay", ms: 1 },
        { id: "same", type: "delay", ms: 1 },
      ],
    };
    const res = validateWorkflow(dup, machines);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /Duplicate step id/i.test(e.message))).toBe(true);
  });

  it("evaluates conditions safely (no eval) over params/telemetry", () => {
    const ctx = {
      params: { threshold: 5 },
      context: {},
      getTelemetry: (_m: number | undefined, k: string) => (k === "ng_count" ? 7 : undefined),
      getState: () => undefined,
    };
    expect(
      evaluateCondition({ source: "telemetry", machineId: 1, key: "ng_count", op: "gt", value: 0 }, ctx),
    ).toBe(true);
    expect(
      evaluateCondition({ source: "param", key: "threshold", op: "gte", value: 10 }, ctx),
    ).toBe(false);
    // composite all/any/not
    expect(
      evaluateCondition(
        { all: [{ source: "param", key: "threshold", op: "eq", value: 5 }, { source: "telemetry", machineId: 1, key: "ng_count", op: "gt", value: 5 }] },
        ctx,
      ),
    ).toBe(true);
    // malformed → fail-closed (false)
    expect(evaluateCondition({ source: "telemetry", key: "x", op: "bogus" as never }, ctx)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// executor
// ════════════════════════════════════════════════════════════════════════════════
describe("foeEngine executor (SIMULATION via E0 dispatcher)", () => {
  async function deploy(def: WorkflowDefinition) {
    const d = await deployWorkflow(def, USER);
    expect(d.ok).toBe(true);
    return d;
  }

  it("runs a command sequence IN ORDER, routing each through the HITL dispatcher", async () => {
    const def: WorkflowDefinition = {
      ref: "seq",
      name: "Seq",
      steps: [
        { id: "a", type: "command", machineId: 1, command: "start" },
        { id: "b", type: "command", machineId: 1, command: "stop" },
      ],
    };
    await deploy(def);
    const res = await startRun("seq", {}, USER);
    expect(res.status).toBe("completed");

    // BOTH command steps routed to the EXISTING ot dispatcher (dry-run mock).
    expect(otDispatchMock).toHaveBeenCalledTimes(2);
    const [first, second] = otDispatchMock.mock.calls;
    expect(first[0].commandType).toBe("start");
    expect(second[0].commandType).toBe("stop");
    // HITL trigger preserved (the engine never bypasses the dispatcher's gate).
    expect(first[0].triggeredBy.kind).toBe("hitl");
    expect(String(first[0].triggeredBy.actionId)).toMatch(/^foe-/);

    const view = await getRun(res.runId!);
    expect(view?.steps.map((s) => s.stepId)).toEqual(expect.arrayContaining(["a", "b"]));
    expect(view?.steps.every((s) => s.status === "completed")).toBe(true);
  });

  it("doc 25 T1 — tạo bản ghi ai_pending_actions confirmed THẬT + trỏ actionId/confirmedBy khớp (khép cổng FOE→dispatcher)", async () => {
    const def: WorkflowDefinition = {
      ref: "gatewire",
      name: "GateWire",
      steps: [{ id: "a", type: "command", machineId: 1, command: "start" }],
    };
    await deploy(def);
    const res = await startRun("gatewire", {}, USER);
    expect(res.status).toBe("completed");

    // FOE đã tạo ủy quyền ai_pending_actions confirmed, owner = user khởi động run.
    const pend = store.get("ai_pending_actions") ?? [];
    expect(pend).toHaveLength(1);
    expect(pend[0].status).toBe("executed"); // terminal → không lọt action inbox
    expect(pend[0].userId).toBe(USER.id);
    expect(String(pend[0].id)).toMatch(/^foe-/);

    // Trigger gửi tới dispatcher trỏ ĐÚNG bản ghi đó + confirmedBy = owner → qua cổng thật.
    const call = otDispatchMock.mock.calls[0][0];
    expect(call.triggeredBy.actionId).toBe(pend[0].id);
    expect(call.triggeredBy.confirmedBy).toBe(USER.id);
  });

  it("runs parallel branches concurrently", async () => {
    const def: WorkflowDefinition = {
      ref: "par",
      name: "Par",
      steps: [
        {
          id: "p",
          type: "parallel",
          steps: [
            { id: "p1", type: "command", machineId: 1, command: "start" },
            { id: "p2", type: "command", machineId: 1, command: "stop" },
          ],
        },
      ],
    };
    await deploy(def);
    const res = await startRun("par", {}, USER);
    expect(res.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(2);
  });

  it("branch picks the THEN path when the condition holds, ELSE otherwise", async () => {
    const def: WorkflowDefinition = {
      ref: "br",
      name: "Branch",
      steps: [
        {
          id: "b",
          type: "branch",
          condition: { source: "param", key: "go", op: "eq", value: true },
          then: [{ id: "t", type: "command", machineId: 1, command: "start" }],
          else: [{ id: "e", type: "command", machineId: 1, command: "stop" }],
        },
      ],
    };
    await deploy(def);

    const yes = await startRun("br", { go: true }, USER);
    expect(yes.status).toBe("completed");
    expect(otDispatchMock.mock.calls[0][0].commandType).toBe("start");

    otDispatchMock.mockClear();
    const no = await startRun("br", { go: false }, USER);
    expect(no.status).toBe("completed");
    expect(otDispatchMock.mock.calls[0][0].commandType).toBe("stop");
  });

  it("wait_state resolves when the machine reaches the target state", async () => {
    const def: WorkflowDefinition = {
      ref: "ws-ok",
      name: "WaitState",
      steps: [
        { id: "w", type: "wait_state", machineId: 1, targetStates: ["Idle"], timeoutMs: 50, pollMs: 5 },
      ],
    };
    await deploy(def);
    // Make getAdapter return an adapter whose getState() reports Idle so the wait resolves.
    const mod = await import("../../equipment/equipmentAdapter");
    const getAdapterSpy = vi.spyOn(mod.equipmentRegistry, "getAdapter").mockReturnValue({
      kind: "ot-opcua",
      delegatesTo: "ot",
      testConnection: async () => ({ ok: true }),
      readTelemetry: async () => [],
      sendCommand: otDispatchMock as never,
      getState: async () => ({ state: "Idle" }),
    } as never);
    const res = await startRun("ws-ok", {}, USER);
    expect(res.status).toBe("completed");
    getAdapterSpy.mockRestore();
  });

  it("wait_state TIMES OUT (run failed) when the state is never reached", async () => {
    const def: WorkflowDefinition = {
      ref: "ws-to",
      name: "WaitStateTimeout",
      steps: [
        { id: "w", type: "wait_state", machineId: 1, targetStates: ["Execute"], timeoutMs: 30, pollMs: 5 },
      ],
    };
    await deploy(def);
    const mod = await import("../../equipment/equipmentAdapter");
    const getAdapterSpy = vi.spyOn(mod.equipmentRegistry, "getAdapter").mockReturnValue({
      kind: "ot-opcua",
      delegatesTo: "ot",
      testConnection: async () => ({ ok: true }),
      readTelemetry: async () => [],
      sendCommand: otDispatchMock as never,
      getState: async () => ({ state: "Idle" }), // never reaches "Execute"
    } as never);
    const res = await startRun("ws-to", {}, USER);
    expect(res.status).toBe("failed");
    getAdapterSpy.mockRestore();
  });

  it("hitl_gate pauses (awaiting_confirm) then resumeRun continues to completion", async () => {
    const def: WorkflowDefinition = {
      ref: "gate",
      name: "Gate",
      steps: [
        { id: "g", type: "hitl_gate", prompt: "Approve to continue?" },
        { id: "after", type: "command", machineId: 1, command: "start" },
      ],
    };
    await deploy(def);
    const res = await startRun("gate", {}, USER);
    expect(res.status).toBe("awaiting_confirm");
    expect(res.runId).toBeDefined();
    // the post-gate command must NOT have run yet
    expect(otDispatchMock).toHaveBeenCalledTimes(0);

    const resumed = await resumeRun(res.runId!, { approved: true }, USER);
    expect(resumed.status).toBe("completed");
    // now the post-gate command ran (once)
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(otDispatchMock.mock.calls[0][0].commandType).toBe("start");
  });

  it("hitl_gate REJECTED aborts the run", async () => {
    const def: WorkflowDefinition = {
      ref: "gate-rej",
      name: "GateReject",
      steps: [
        { id: "g", type: "hitl_gate", prompt: "Approve?" },
        { id: "after", type: "command", machineId: 1, command: "start" },
      ],
    };
    await deploy(def);
    const res = await startRun("gate-rej", {}, USER);
    expect(res.status).toBe("awaiting_confirm");
    const resumed = await resumeRun(res.runId!, { approved: false }, USER);
    expect(resumed.status).toBe("aborted");
    expect(otDispatchMock).toHaveBeenCalledTimes(0);
  });

  // ── Doc 25 T1 — RESUME idempotent + gate lồng ────────────────────────────────
  it("resume KHÔNG re-dispatch lệnh TRƯỚC gate (idempotent)", async () => {
    const def: WorkflowDefinition = {
      ref: "gate-pre",
      name: "GatePre",
      steps: [
        { id: "pre", type: "command", machineId: 1, command: "start" },
        { id: "g", type: "hitl_gate", prompt: "Approve?" },
        { id: "after", type: "command", machineId: 1, command: "stop" },
      ],
    };
    await deploy(def);
    const res = await startRun("gate-pre", {}, USER);
    expect(res.status).toBe("awaiting_confirm");
    // 'pre' đã dispatch đúng 1 lần; 'after' (sau gate) chưa chạy
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(otDispatchMock.mock.calls[0][0].commandType).toBe("start");

    const resumed = await resumeRun(res.runId!, { approved: true }, USER);
    expect(resumed.status).toBe("completed");
    // 'pre' KHÔNG chạy lại (vẫn 1 'start'); chỉ 'after' chạy → tổng đúng [start, stop]
    expect(otDispatchMock).toHaveBeenCalledTimes(2);
    expect(otDispatchMock.mock.calls.map((c) => c[0].commandType)).toEqual(["start", "stop"]);
  });

  it("resume qua được hitl_gate LỒNG TRONG PARALLEL tới hoàn tất (không re-pause, không re-dispatch)", async () => {
    const def: WorkflowDefinition = {
      ref: "gate-par",
      name: "GatePar",
      steps: [
        {
          id: "p",
          type: "parallel",
          steps: [
            { id: "p1", type: "command", machineId: 1, command: "start" },
            {
              id: "sub",
              type: "sequence",
              steps: [
                { id: "g", type: "hitl_gate", prompt: "Approve?" },
                { id: "p2", type: "command", machineId: 1, command: "stop" },
              ],
            },
          ],
        },
      ],
    };
    await deploy(def);
    const res = await startRun("gate-par", {}, USER);
    expect(res.status).toBe("awaiting_confirm");
    // 'p1' chạy; 'p2' (sau gate lồng) chưa
    expect(otDispatchMock.mock.calls.map((c) => c[0].commandType)).toEqual(["start"]);

    const resumed = await resumeRun(res.runId!, { approved: true }, USER);
    expect(resumed.status).toBe("completed");
    // 'p1' KHÔNG re-dispatch, gate lồng được skip, 'p2' chạy → tổng [start, stop]
    expect(otDispatchMock.mock.calls.map((c) => c[0].commandType)).toEqual(["start", "stop"]);
  });

  it("resume qua được hitl_gate LỒNG TRONG BRANCH tới hoàn tất", async () => {
    const def: WorkflowDefinition = {
      ref: "gate-br",
      name: "GateBr",
      steps: [
        {
          id: "b",
          type: "branch",
          condition: { source: "param", key: "go", op: "eq", value: true },
          then: [
            { id: "g", type: "hitl_gate", prompt: "Approve?" },
            { id: "t", type: "command", machineId: 1, command: "start" },
          ],
          else: [{ id: "e", type: "command", machineId: 1, command: "stop" }],
        },
      ],
    };
    await deploy(def);
    const res = await startRun("gate-br", { go: true }, USER);
    expect(res.status).toBe("awaiting_confirm");
    // gate đứng trước 't' → chưa dispatch gì
    expect(otDispatchMock).toHaveBeenCalledTimes(0);

    const resumed = await resumeRun(res.runId!, { approved: true }, USER);
    expect(resumed.status).toBe("completed");
    // đi đúng nhánh 'then', gate được skip, chỉ 't' chạy → [start] (không lạc sang 'else')
    expect(otDispatchMock.mock.calls.map((c) => c[0].commandType)).toEqual(["start"]);
  });

  it("onError → compensation runs and the run is marked failed", async () => {
    // Make the dispatcher reject the main command so the step fails.
    otDispatchMock.mockResolvedValueOnce({
      ok: false,
      simulated: true,
      status: "rejected",
      results: [],
      commandLogIds: [],
    } as never);
    const def: WorkflowDefinition = {
      ref: "comp",
      name: "Compensation",
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
    await deploy(def);
    const res = await startRun("comp", {}, USER);
    expect(res.status).toBe("failed");
    // compensation 'stop' was dispatched after the 'start' failure
    const types = otDispatchMock.mock.calls.map((c) => c[0].commandType);
    expect(types).toContain("start");
    expect(types).toContain("stop");
    const view = await getRun(res.runId!);
    expect(view?.steps.find((s) => s.stepId === "undo")?.status).toBe("compensated");
  });

  it("flag OFF → startRun/deployWorkflow return disabled", async () => {
    process.env.FOE_ENABLED = "false";
    const def: WorkflowDefinition = {
      ref: "off",
      name: "Off",
      steps: [{ id: "a", type: "command", machineId: 1, command: "start" }],
    };
    const dep = await deployWorkflow(def, USER);
    expect(dep.enabled).toBe(false);
    expect(dep.ok).toBe(false);

    const run = await startRun("off", {}, USER);
    expect(run.enabled).toBe(false);
    expect(otDispatchMock).toHaveBeenCalledTimes(0);
  });

  it("FAIL-SAFE: a step throwing → run failed, no crash", async () => {
    otDispatchMock.mockImplementationOnce(async () => {
      throw new Error("boom from dispatcher");
    });
    const def: WorkflowDefinition = {
      ref: "boom",
      name: "Boom",
      steps: [{ id: "a", type: "command", machineId: 1, command: "start" }],
    };
    await deployWorkflow(def, USER);
    const res = await startRun("boom", {}, USER);
    expect(res.status).toBe("failed");
    expect(res.ok).toBe(false);
    // engine did not throw — we got a structured result back
    expect(res.runId).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// W3-11 — workflow VERSION history (snapshot each deploy; rollback = new version)
// ════════════════════════════════════════════════════════════════════════════════
describe("workflow versioning (W3-11)", () => {
  const base = (ref: string, cmd: string): WorkflowDefinition => ({
    ref,
    name: `WF ${ref}`,
    steps: [{ id: "a", type: "command", machineId: 1, command: cmd }],
  });

  function versionRows(): Array<{ workflowId: number; version: number; definitionJson: WorkflowDefinition }> {
    return (store.get("orchestration_workflow_versions") ?? []) as any[];
  }

  it("snapshots a NEW version row on every deploy of the same ref (no overwrite of history)", async () => {
    const d1 = await deployWorkflow(base("vh", "start"), USER);
    const d2 = await deployWorkflow(base("vh", "stop"), USER);
    expect(d1.ok && d2.ok).toBe(true);
    const rows = versionRows().filter((v) => v.workflowId === d1.workflowId);
    expect(rows.map((r) => r.version).sort()).toEqual([1, 2]);
    // Bản snapshot v1 vẫn giữ định nghĩa cũ (không bị đè).
    const v1 = rows.find((r) => r.version === 1)!;
    expect((v1.definitionJson.steps[0] as any).command).toBe("start");
  });

  it("rollbackWorkflow re-deploys an old version as a NEW version (append-only)", async () => {
    const d1 = await deployWorkflow(base("rb", "start"), USER);
    await deployWorkflow(base("rb", "stop"), USER); // v2 (head = stop)
    const res = await rollbackWorkflow(d1.workflowId!, 1, USER);
    expect(res.ok).toBe(true);
    expect(res.version).toBe(3); // phiên bản mới, nội dung = v1
    const v3 = versionRows().find((v) => v.workflowId === d1.workflowId && v.version === 3)!;
    expect((v3.definitionJson.steps[0] as any).command).toBe("start");
  });

  it("rollbackWorkflow to a missing version returns a structured error", async () => {
    const d1 = await deployWorkflow(base("rb2", "start"), USER);
    const res = await rollbackWorkflow(d1.workflowId!, 99, USER);
    expect(res.ok).toBe(false);
    expect(res.enabled).toBe(true);
  });

  it("flag OFF → rollbackWorkflow returns disabled", async () => {
    const d1 = await deployWorkflow(base("rb3", "start"), USER);
    process.env.FOE_ENABLED = "false";
    const res = await rollbackWorkflow(d1.workflowId!, 1, USER);
    expect(res.enabled).toBe(false);
    expect(res.ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// W4-17 — DURABLE EXECUTION: rehydrate-on-boot + async opt-in
// ════════════════════════════════════════════════════════════════════════════════
describe("W4-17 durable execution", () => {
  /** Chèn thẳng một run vào store (giả lập bản ghi còn sót sau restart). */
  function seedRun(status: string, extra: Record<string, any> = {}): number {
    const id = nextId("orchestration_runs");
    rows("orchestration_runs").push({
      id,
      workflowId: 1,
      workflowRef: "wf",
      status,
      paramsJson: {},
      contextJson: {},
      startedBy: USER.id,
      startedAt: new Date(),
      ...extra,
    });
    return id;
  }
  function runById(id: number): Row | undefined {
    return (store.get("orchestration_runs") ?? []).find((r) => r.id === id);
  }

  it("rehydrate: 'running'/'queued' → 'held' resumable + cờ interrupted; 'compensating' → 'failed'", async () => {
    const rRunning = seedRun("running");
    const rQueued = seedRun("queued");
    const rComp = seedRun("compensating");
    // Wait bền vững + terminal → KHÔNG bị đụng.
    const rAwait = seedRun("awaiting_confirm", { currentStepId: "g" });
    const rHeld = seedRun("held");
    const rDone = seedRun("completed", { finishedAt: new Date() });

    const res = await rehydrateInterruptedRuns();
    expect(res.scanned).toBe(3);
    expect(res.interrupted).toBe(2); // running + queued
    expect(res.failed).toBe(1); // compensating

    expect(runById(rRunning)!.status).toBe("held");
    expect((runById(rRunning)!.contextJson as any).interrupted).toBe(true);
    expect((runById(rRunning)!.contextJson as any).interruptedFrom).toBe("running");
    expect(runById(rQueued)!.status).toBe("held");
    expect(runById(rComp)!.status).toBe("failed");
    expect(runById(rComp)!.finishedAt).toBeTruthy();

    // Không đụng vào wait bền vững / terminal.
    expect(runById(rAwait)!.status).toBe("awaiting_confirm");
    expect(runById(rHeld)!.status).toBe("held");
    expect((runById(rHeld)!.contextJson as any).interrupted).toBeUndefined();
    expect(runById(rDone)!.status).toBe("completed");
  });

  it("rehydrate no-op khi không có run đang chạy", async () => {
    seedRun("completed", { finishedAt: new Date() });
    seedRun("awaiting_confirm", { currentStepId: "g" });
    const res = await rehydrateInterruptedRuns();
    expect(res.scanned).toBe(0);
    expect(res.runIds).toEqual([]);
  });

  it("run 'interrupted' (held) RESUME được: đi lại idempotent tới hoàn tất, không re-dispatch bước đã xong", async () => {
    // Chạy tới gate → 'pre' đã dispatch, run awaiting_confirm.
    const def: WorkflowDefinition = {
      ref: "durable-resume",
      name: "DurableResume",
      steps: [
        { id: "pre", type: "command", machineId: 1, command: "start" },
        { id: "g", type: "hitl_gate", prompt: "Approve?" },
        { id: "after", type: "command", machineId: 1, command: "stop" },
      ],
    };
    await deployWorkflow(def, USER);
    const started = await startRun("durable-resume", {}, USER);
    expect(started.status).toBe("awaiting_confirm");
    expect(otDispatchMock).toHaveBeenCalledTimes(1); // chỉ 'pre'

    // Giả lập restart giữa lúc đang chạy: ép run về 'running' rồi rehydrate.
    const runRow = runById(started.runId!)!;
    runRow.status = "running";
    const rh = await rehydrateInterruptedRuns();
    expect(rh.interrupted).toBe(1);
    expect(runById(started.runId!)!.status).toBe("held");

    // Resume thủ công (approve) → đi lại: 'pre' KHÔNG re-dispatch, gate đã đánh dấu completed,
    // chỉ 'after' chạy → tổng [start, stop].
    const resumed = await resumeRun(started.runId!, { approved: true }, USER);
    expect(resumed.status).toBe("completed");
    expect(otDispatchMock.mock.calls.map((c) => c[0].commandType)).toEqual(["start", "stop"]);
  });

  it("startRun async opt-in: trả 'queued' + runId NGAY, drive nền tới hoàn tất", async () => {
    const def: WorkflowDefinition = {
      ref: "async-run",
      name: "AsyncRun",
      steps: [
        { id: "a", type: "command", machineId: 1, command: "start" },
        { id: "b", type: "command", machineId: 1, command: "stop" },
      ],
    };
    await deployWorkflow(def, USER);
    const res = await startRun("async-run", {}, USER, { async: true });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("queued");
    expect(res.runId).toBeDefined();

    // Chờ drive nền (setImmediate) hoàn tất.
    let status: string | undefined;
    for (let i = 0; i < 50; i++) {
      const v = await getRun(res.runId!);
      status = v?.run.status;
      if (status && ["completed", "failed", "aborted", "awaiting_confirm"].includes(status)) break;
      await new Promise((r) => setImmediate(r));
    }
    expect(status).toBe("completed");
    expect(otDispatchMock.mock.calls.map((c) => c[0].commandType)).toEqual(["start", "stop"]);
  });
});
