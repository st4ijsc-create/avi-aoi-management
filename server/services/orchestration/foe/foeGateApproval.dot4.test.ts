/**
 * doc 81 Đợt 4 Task A5 — QĐ-4a option (a), ruling R-4-a: the orchestration engine stops approving itself.
 *
 * Before: ensureOrchestrationAction created a CONFIRMED ai_pending_actions row for every OT/robot step with the run owner
 * as confirmer — the engine granted itself the HITL approval the dispatchers then verified. Now an OT/robot step runs
 * only on an EARLIER hitl_gate of the same run approved by someone OTHER than the run owner (orchestration_runs.startedBy),
 * and that approver is the action's confirmer. Otherwise the step fails with FOE_GATE_REQUIRED (Studio shows
 * studio.gateRequired). A STOP is exempt (L-7 energy direction).
 *
 * Engine layer only (the dispatchers' own re-check is measured on the real DB in commandDispatcher.dot1b.db.test.ts /
 * robotCommandDispatcher.binding.db.test.ts). DB = the shared FakeDb (server/routers/__otFakeDb.ts); the OT/robot
 * dispatchers are replaced by counters; `isStopCommandType` is the REAL one (importOriginal).
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
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows, machines } from "../../../../drizzle/schema";
import { deployWorkflow, startRun, resumeRun, FOE_GATE_REQUIRED } from "./foeEngine";
import { readFoeGateApproval } from "../../ot/otActionBinding";
import type { WorkflowDefinition } from "./workflowModel";

const OWNER = { id: 10, role: "engineer", name: "owner" };
const OTHER = { id: 12, role: "supervisor", name: "other" };

type Row = Record<string, any>;
const runRow = (id: number): Row => (fake.store.get("orchestration_runs") ?? []).find((r: Row) => r.id === id)!;
const stepRow = (runId: number, stepId: string): Row | undefined =>
  (fake.store.get("orchestration_run_steps") ?? []).find((s: Row) => s.runId === runId && s.stepId === stepId);
const actions = (): Row[] => fake.store.get("ai_pending_actions") ?? [];

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "ROBOT", capabilities: null, code: "R1", name: "Robot-1", operationStatus: "stopped", stationId: 1 },
  ]);
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
});

const GATED: WorkflowDefinition = {
  ref: "gated",
  name: "Gated",
  steps: [
    { id: "g", type: "hitl_gate", prompt: "Approve the write" },
    { id: "w", type: "command", machineId: 1, command: "start" },
  ],
};

describe("doc 81 Đợt 4 Task A5 — engine: an OT/robot step needs a gate approved by someone other than the run owner", () => {
  it("★ OT step with NO gate ⇒ not dispatched, no authorisation row, step failed FOE_GATE_REQUIRED (clear message, run failed — not stuck)", async () => {
    expect((await deployWorkflow({ ref: "nogate", name: "NoGate", steps: [{ id: "w", type: "command", machineId: 1, command: "start" }] }, OWNER)).ok).toBe(true);
    const res = await startRun("nogate", {}, OWNER);
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(0);
    const s = stepRow(res.runId!, "w")!;
    expect(s.status).toBe("failed");
    expect(String(s.error)).toMatch(new RegExp(`^${FOE_GATE_REQUIRED}: `));
    expect(String(s.error)).toContain("Add a hitl_gate before this step");
    expect(String(runRow(res.runId!).error)).toMatch(new RegExp(`^${FOE_GATE_REQUIRED}: `));
  });

  it("★ gate approved by the RUN OWNER does not count ⇒ step not dispatched (FOE_GATE_REQUIRED)", async () => {
    await deployWorkflow(GATED, OWNER);
    const started = await startRun("gated", {}, OWNER);
    expect(started.status).toBe("awaiting_confirm");
    const res = await resumeRun(started.runId!, { approved: true }, OWNER);
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(0);
    expect(String(stepRow(started.runId!, "w")!.error)).toMatch(new RegExp(`^${FOE_GATE_REQUIRED}: `));
  });

  it("★ gate approved by SOMEONE ELSE ⇒ dispatched EXACTLY ONCE; the action's confirmer is that approver, requester the owner", async () => {
    await deployWorkflow(GATED, OWNER);
    const started = await startRun("gated", {}, OWNER);
    const res = await resumeRun(started.runId!, { approved: true }, OTHER);
    expect(res.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    const trig = (otDispatchMock.mock.calls[0][0] as { triggeredBy: Record<string, unknown> }).triggeredBy;
    expect(trig).toMatchObject({ kind: "hitl", confirmedBy: OTHER.id, requestedBy: OWNER.id, tool: "foe.orchestration" });
    expect(actions()).toHaveLength(1);
    expect(actions()[0]).toMatchObject({ status: "confirmed", userId: OTHER.id });
    expect(readFoeGateApproval(actions()[0].previewJson)).toEqual({ runId: started.runId, runOwner: OWNER.id, approvedBy: OTHER.id, gateStepId: "g" });
  });

  it("★ R-4-a: a gate result WITHOUT approvedBy (run from before Đợt 4) does NOT count — fail-closed", async () => {
    // A run interrupted after its gate was approved under the OLD result shape { approved: true } (no approvedBy).
    await deployWorkflow(GATED, OWNER);
    const wf = (fake.store.get("orchestration_workflows") ?? [])[0] as Row;
    fake.seed(orchestrationRuns, [
      { id: 900, workflowId: wf.id, workflowRef: "gated", status: "held", paramsJson: {}, contextJson: { interrupted: true }, startedBy: OWNER.id, startedAt: new Date(), currentStepId: null },
    ]);
    fake.seed(orchestrationRunSteps, [
      { id: 901, runId: 900, stepId: "g", stepType: "hitl_gate", status: "completed", attempt: 0, resultJson: { approved: true, note: null }, finishedAt: new Date() },
    ]);
    const res = await resumeRun(900, { approved: true }, OTHER); // "Continue" of the interrupted run
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(String(stepRow(900, "w")!.error)).toMatch(new RegExp(`^${FOE_GATE_REQUIRED}: `));
  });

  it("a NON-gate step marked completed with an approvedBy (continue of a held step) does not count as a gate", async () => {
    const def: WorkflowDefinition = {
      ref: "heldcmd",
      name: "HeldCmd",
      steps: [
        { id: "c1", type: "command", machineId: 1, command: "start" },
        { id: "c2", type: "command", machineId: 1, command: "start" },
      ],
    };
    await deployWorkflow(def, OWNER);
    const wf = (fake.store.get("orchestration_workflows") ?? []).find((w: Row) => w.ref === "heldcmd") as Row;
    fake.seed(orchestrationRuns, [
      { id: 910, workflowId: wf.id, workflowRef: "heldcmd", status: "held", paramsJson: {}, contextJson: {}, startedBy: OWNER.id, startedAt: new Date(), currentStepId: "c1" },
    ]);
    const res = await resumeRun(910, { approved: true }, OTHER); // marks c1 'completed' with approvedBy OTHER
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(String(stepRow(910, "c2")!.error)).toMatch(new RegExp(`^${FOE_GATE_REQUIRED}: `));
  });

  it("a robot MOTION step without a gate is refused the same way (robot dispatcher not called)", async () => {
    await deployWorkflow({ ref: "rbmove", name: "RbMove", steps: [{ id: "m", type: "command", machineId: 2, command: "start" }] }, OWNER);
    const res = await startRun("rbmove", {}, OWNER);
    expect(res.status).toBe("failed");
    expect(robotDispatchMock).not.toHaveBeenCalled();
    expect(String(stepRow(res.runId!, "m")!.error)).toMatch(new RegExp(`^${FOE_GATE_REQUIRED}: `));
  });

  it("★ L-7: a STOP is never gated — robot abort and OT stop with NO gate are dispatched once each", async () => {
    await deployWorkflow(
      {
        ref: "stops",
        name: "Stops",
        steps: [
          { id: "ra", type: "command", machineId: 2, command: "abort" },
          { id: "os", type: "command", machineId: 1, command: "stop" },
        ],
      },
      OWNER,
    );
    const res = await startRun("stops", {}, OWNER);
    expect(res.status).toBe("completed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    // The OT stop rides on a self-confirmed row; the OT dispatcher accepts that ONLY for a PINNED stop
    // (verifyActionBinding — measured in commandDispatcher.dot1b.db.test.ts).
    expect((otDispatchMock.mock.calls[0][0] as { commandType: string }).commandType).toBe("stop");
  });
});
