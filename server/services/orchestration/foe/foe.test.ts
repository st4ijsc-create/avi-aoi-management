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
  startRun,
  resumeRun,
  getRun,
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
