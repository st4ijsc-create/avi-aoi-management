/**
 * doc 81 Đợt 5 task E1 (item 24, owner decision option C) — a run started through an API key NEVER sends an OT or robot
 * command other than a STOP. The holder of a key is invisible to the server, so "the gate was approved by someone other
 * than the run owner" cannot be established for such a run (holder B starts it with A's key, then approves it as B).
 *
 * Measured at both layers:
 *   • the engine (foeEngine.findSeparateGateApproval → FOE_GATE_REQUIRED(apiRun)): no dispatch, no authorisation row —
 *     on a fresh walk, on resume, on retry (maxAttempts), in a saga compensation, and after an edge sync wiped contextJson;
 *   • the dispatchers' DB layer (foeGateApproval.foeApprovalDbRefusal), which re-derives the run from the DB rows.
 * STOPs (L-7): a robot abort and an OT stop of an API run still go out exactly as before (engine side).
 *
 * DB = the shared FakeDb; OT/robot dispatchers are counters; `isStopCommandType` is the REAL one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const { otDispatchMock, robotDispatchMock } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(async (_cmd?: unknown) => ({ ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] })),
  robotDispatchMock: vi.fn(async (_job?: unknown) => ({ ok: true, status: "simulated" as const, jobId: 7 })),
}));
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return { isStopCommandType: orig.isStopCommandType, dispatch: otDispatchMock };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));
vi.mock("../../auditTrailService", () => ({ createAuditContext: (x: unknown) => x, logCrudOperation: vi.fn(async () => ({ id: 1 })) }));

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  const ne = (col: { name: string }, v: unknown) => (row: Record<string, unknown>) => row[col.name] !== v;
  const inArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => vs.includes(row[col.name]);
  const notInArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => !vs.includes(row[col.name]);
  const isNull = (col: { name: string }) => (row: Record<string, unknown>) => row[col.name] == null;
  return { ...actual, eq: makeEq, and: makeAnd, ne, inArray, notInArray, isNull };
});
// doc 81 Đợt 5 task E2 (2026-10-10) — this file does not measure factory scope (foeScope.dot5.db.test.ts does, on _test):
// every principal here is unrestricted, as before E2 (the FakeDb cannot answer the scope resolver's SQL).
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return { ...orig, resolveUserFoeScope: () => null };
});
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { orchestrationRunSteps, machines, deviceAdapters, robots } from "../../../../drizzle/schema";
import { deployWorkflow, startRun, resumeRun, FOE_GATE_REQUIRED } from "./foeEngine";
import { foeApprovalDbRefusal, FOE_API_RUN_PARAM, runStartedViaApi } from "./foeGateApproval";
import type { WorkflowDefinition } from "./workflowModel";

type Row = Record<string, any>;
const OWNER = { id: 10, role: "engineer", name: "key-creator" }; // A — created the API key
const HOLDER = { id: 12, role: "supervisor", name: "key-holder" }; // B — holds A's key, approves in the UI
const API = { id: 0, role: "api", name: "key-of-A" };

const runRow = (id: number): Row => (fake.store.get("orchestration_runs") ?? []).find((r: Row) => r.id === id)!;
const stepRow = (runId: number, stepId: string): Row | undefined =>
  (fake.store.get("orchestration_run_steps") ?? []).find((s: Row) => s.runId === runId && s.stepId === stepId);
const actions = (): Row[] => fake.store.get("ai_pending_actions") ?? [];
const gateErr = (reason: string) => new RegExp(`^${FOE_GATE_REQUIRED}\\(${reason}\\): `);
const apiStart = (ref: string, params: Record<string, unknown> = {}) => startRun(ref, params, API, { ownerUserId: OWNER.id, viaApi: true });

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "ROBOT", capabilities: null, code: "R1", name: "Robot-1", operationStatus: "stopped", stationId: 1 },
  ]);
  fake.seed(deviceAdapters, [{ id: 501, machineId: 1, isEnabled: true }]);
  fake.seed(robots, [{ id: 2, code: "R2", isEnabled: true }]);
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
});

const GATED_OT: WorkflowDefinition = {
  ref: "api-ot",
  name: "api-ot",
  steps: [
    { id: "g", type: "hitl_gate", prompt: "approve" },
    { id: "w", type: "command", machineId: 1, command: "start" },
  ],
};

describe("doc 81 Đợt 5 task E1 — an API-started run never actuates a non-STOP step (option C)", () => {
  it("★ the marker is written server-side in BOTH places; a user-started run has none; a caller cannot lift it", async () => {
    await deployWorkflow(GATED_OT, OWNER);
    const a = await apiStart("api-ot", { [FOE_API_RUN_PARAM]: false, x: 1 }); // a caller trying to say "not API"
    expect(runRow(a.runId!).paramsJson).toEqual({ x: 1, [FOE_API_RUN_PARAM]: true });
    expect(runRow(a.runId!).contextJson).toMatchObject({ startedViaApi: true });
    expect(runRow(a.runId!).startedBy).toBe(OWNER.id);
    const u = await startRun("api-ot", { x: 1 }, OWNER);
    expect(runRow(u.runId!).paramsJson).toEqual({ x: 1 });
    expect(runStartedViaApi(runRow(u.runId!))).toBe(false);
    // a non-user principal starting on behalf of an owner is an API start even if the route forgot `viaApi`
    const b = await startRun("api-ot", {}, API, { ownerUserId: OWNER.id });
    expect(runStartedViaApi(runRow(b.runId!))).toBe(true);
    // an edge re-execution of an API run copies its params ⇒ the new run is an API run too
    const e = await startRun("api-ot", { ...runRow(a.runId!).paramsJson }, { id: OWNER.id, role: "edge", name: "edge-1" });
    expect(runStartedViaApi(runRow(e.runId!))).toBe(true);
  });

  it("★ the exploit: holder B approves the gate of a run started with A's key ⇒ OT step NOT sent (apiRun), no authorisation row", async () => {
    await deployWorkflow(GATED_OT, OWNER);
    const started = await apiStart("api-ot");
    expect(started.status).toBe("awaiting_confirm");
    const res = await resumeRun(started.runId!, { approved: true }, HOLDER);
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(0);
    const err = String(stepRow(started.runId!, "w")!.error);
    expect(err).toMatch(gateErr("apiRun"));
    expect(err).toContain("started through an API key");
  });

  it("control: the SAME definition started by a user and approved by B ⇒ sent once (only API runs are affected)", async () => {
    await deployWorkflow(GATED_OT, OWNER);
    const started = await startRun("api-ot", {}, OWNER);
    expect((await resumeRun(started.runId!, { approved: true }, HOLDER)).status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ a robot MOTION step of an API run is refused the same way (robot dispatcher not called)", async () => {
    await deployWorkflow({ ref: "api-rb", name: "api-rb", steps: [{ id: "g", type: "hitl_gate", prompt: "p" }, { id: "m", type: "command", machineId: 2, command: "start", args: { robotId: 2 } }] }, OWNER);
    const started = await apiStart("api-rb");
    expect((await resumeRun(started.runId!, { approved: true }, HOLDER)).status).toBe("failed");
    expect(robotDispatchMock).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(0);
    expect(String(stepRow(started.runId!, "m")!.error)).toMatch(gateErr("apiRun"));
  });

  it("★ retry and saga compensation: every attempt is refused, the compensation's OT write is refused too", async () => {
    await deployWorkflow(
      {
        ref: "api-retry",
        name: "api-retry",
        steps: [
          { id: "g", type: "hitl_gate", prompt: "p" },
          { id: "w", type: "command", machineId: 1, command: "start", maxAttempts: 3, compensation: { id: "undo", type: "command", machineId: 1, command: "reset" } },
        ],
      },
      OWNER,
    );
    const started = await apiStart("api-retry");
    expect((await resumeRun(started.runId!, { approved: true }, HOLDER)).status).toBe("failed");
    expect(stepRow(started.runId!, "w")!.attempt).toBe(4);
    expect(String(stepRow(started.runId!, "undo")!.error)).toMatch(gateErr("apiRun"));
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(0);
  });

  it("★ edge sync wiped contextJson (the payload carries its own context) ⇒ still apiRun on resume (the params marker stays)", async () => {
    await deployWorkflow(GATED_OT, OWNER);
    const started = await apiStart("api-ot");
    runRow(started.runId!).contextJson = { startedViaApi: false }; // what edgeCoordinator.syncRunResult may write
    const res = await resumeRun(started.runId!, { approved: true }, HOLDER);
    expect(res.status).toBe("failed");
    expect(String(stepRow(started.runId!, "w")!.error)).toMatch(gateErr("apiRun"));
    expect(otDispatchMock).not.toHaveBeenCalled();
  });

  it("★ L-7: STOPs of an API run still go out — robot abort and OT stop, no gate at all", async () => {
    await deployWorkflow(
      {
        ref: "api-stop",
        name: "api-stop",
        steps: [
          { id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } },
          { id: "os", type: "command", machineId: 1, command: "stop" },
        ],
      },
      OWNER,
    );
    const res = await apiStart("api-stop");
    expect(res.status).toBe("completed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect((otDispatchMock.mock.calls[0][0] as { commandType: string }).commandType).toBe("stop");
  });

  it("★ dispatcher DB layer: an action of an API run is refused (apiRun) even when a counting gate approved by its confirmer exists", async () => {
    await deployWorkflow(GATED_OT, OWNER);
    const wf = (fake.store.get("orchestration_workflows") ?? [])[0] as Row;
    const { hashWorkflowDefinition } = await import("./foeGateApproval");
    const seed = (runId: number, apiMarker: "params" | "context" | null) => {
      (fake.store.get("orchestration_runs") ?? fake.store.set("orchestration_runs", []).get("orchestration_runs")!).push({
        id: runId,
        workflowId: wf.id,
        workflowRef: "api-ot",
        status: "running",
        paramsJson: apiMarker === "params" ? { [FOE_API_RUN_PARAM]: true } : {},
        contextJson: apiMarker === "context" ? { startedViaApi: true } : {},
        startedBy: OWNER.id,
      });
      fake.store.get("orchestration_run_steps")!.push({
        id: runId * 10,
        runId,
        stepId: "g",
        stepType: "hitl_gate",
        status: "completed",
        resultJson: { approved: true, approvedBy: HOLDER.id, approvalSource: "server", defHash: hashWorkflowDefinition(wf.definitionJson) },
      });
    };
    fake.store.set("orchestration_run_steps", []);
    seed(901, "params");
    seed(902, "context");
    seed(903, null);
    const pending = (runId: number) => ({ userId: HOLDER.id, previewJson: { __foeGateApproval: { runId } } });
    expect(await foeApprovalDbRefusal(fake as never, pending(901), OWNER.id)).toMatch(/apiRun/);
    expect(await foeApprovalDbRefusal(fake as never, pending(902), OWNER.id)).toMatch(/apiRun/);
    // control: the same rows without the marker are accepted by this layer
    expect(await foeApprovalDbRefusal(fake as never, pending(903), OWNER.id)).toBeNull();
  });
});
