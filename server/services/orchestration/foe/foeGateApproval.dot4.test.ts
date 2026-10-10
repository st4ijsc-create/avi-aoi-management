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

import { orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows, machines, deviceAdapters } from "../../../../drizzle/schema";
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
  // doc 81 Đợt 4 fix round 1 (R-4-d): an OT step writes through the adapter BOUND to its machine (no more adapterId = machineId).
  fake.seed(deviceAdapters, [{ id: 501, machineId: 1, isEnabled: true }]);
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

const gateErr = (reason: string) => new RegExp(`^${FOE_GATE_REQUIRED}\\(${reason}\\): `);
const C_OT: WorkflowDefinition["steps"][number] = { id: "c", type: "command", machineId: 1, command: "start" };

describe("doc 81 Đợt 4 Task A5 — engine: an OT/robot step needs a gate approved by someone other than the run owner", () => {
  it("★ OT step with NO gate ⇒ not dispatched, no authorisation row, step failed FOE_GATE_REQUIRED(noGate) (clear message, run failed — not stuck)", async () => {
    expect((await deployWorkflow({ ref: "nogate", name: "NoGate", steps: [{ id: "w", type: "command", machineId: 1, command: "start" }] }, OWNER)).ok).toBe(true);
    const res = await startRun("nogate", {}, OWNER);
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(0);
    const s = stepRow(res.runId!, "w")!;
    expect(s.status).toBe("failed");
    expect(String(s.error)).toMatch(gateErr("noGate"));
    expect(String(s.error)).toContain("Add a hitl_gate before this step");
    expect(String(runRow(res.runId!).error)).toMatch(gateErr("noGate"));
  });

  it("★ gate approved by the RUN OWNER does not count ⇒ step not dispatched (FOE_GATE_REQUIRED(approvedByOwner), its own message)", async () => {
    await deployWorkflow(GATED, OWNER);
    const started = await startRun("gated", {}, OWNER);
    expect(started.status).toBe("awaiting_confirm");
    const res = await resumeRun(started.runId!, { approved: true }, OWNER);
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(0);
    const err = String(stepRow(started.runId!, "w")!.error);
    expect(err).toMatch(gateErr("approvedByOwner"));
    expect(err).not.toContain("Add a hitl_gate");
  });

  it("★ gate approved by SOMEONE ELSE ⇒ dispatched EXACTLY ONCE; confirmer = approver, requester = owner; the gate row records source + definition hash", async () => {
    await deployWorkflow(GATED, OWNER);
    const started = await startRun("gated", {}, OWNER);
    const res = await resumeRun(started.runId!, { approved: true }, OTHER);
    expect(res.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    const trig = (otDispatchMock.mock.calls[0][0] as { triggeredBy: Record<string, unknown>; adapterId: number }).triggeredBy;
    expect(trig).toMatchObject({ kind: "hitl", confirmedBy: OTHER.id, requestedBy: OWNER.id, tool: "foe.orchestration" });
    // R-4-d: the write goes through the adapter BOUND to machine 1 (501), not "adapter id = machine id"
    expect((otDispatchMock.mock.calls[0][0] as { adapterId: number }).adapterId).toBe(501);
    expect(actions()).toHaveLength(1);
    expect(actions()[0]).toMatchObject({ status: "confirmed", userId: OTHER.id });
    expect(readFoeGateApproval(actions()[0].previewJson)).toEqual({ runId: started.runId, runOwner: OWNER.id, approvedBy: OTHER.id, gateStepId: "g" });
    expect(stepRow(started.runId!, "g")!.resultJson).toMatchObject({ approved: true, approvedBy: OTHER.id, approvalSource: "server" });
    expect(String(stepRow(started.runId!, "g")!.resultJson.defHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(runRow(started.runId!).currentStepId).toBeNull(); // R-4-g: cleared once the run moved past the gate
  });

  it("R-4-d: an OT machine with no bound adapter (or several) ⇒ no adapterId ⇒ the OT route refuses, nothing dispatched", async () => {
    fake.store.set("device_adapters", [
      { id: 501, machineId: 1, isEnabled: true },
      { id: 502, machineId: 1, isEnabled: true },
    ]);
    await deployWorkflow(GATED, OWNER);
    const started = await startRun("gated", {}, OWNER);
    const res = await resumeRun(started.runId!, { approved: true }, OTHER);
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(String(stepRow(started.runId!, "w")!.error)).toContain("adapterId required");
  });

  it("★ R-4-a/R-4-h: gate results not recorded by the server's approval path do NOT count (no approvedBy; approvedBy without source; source 'edge')", async () => {
    await deployWorkflow(GATED, OWNER);
    const wf = (fake.store.get("orchestration_workflows") ?? [])[0] as Row;
    const forged = [
      { approved: true, note: null }, // pre-Đợt-4 shape
      { approved: true, approvedBy: OTHER.id }, // approvedBy but no source
      { approved: true, approvedBy: OTHER.id, approvalSource: "edge" }, // edge-synced
      { approved: true, approvedBy: OTHER.id, approvalSource: "system" }, // auto-resume
    ];
    let runId = 900;
    for (const result of forged) {
      runId += 1;
      fake.seed(orchestrationRuns, [
        { id: runId, workflowId: wf.id, workflowRef: "gated", status: "held", paramsJson: {}, contextJson: { interrupted: true }, startedBy: OWNER.id, startedAt: new Date(), currentStepId: null },
      ]);
      fake.seed(orchestrationRunSteps, [{ id: runId * 10, runId, stepId: "g", stepType: "hitl_gate", status: "completed", attempt: 0, resultJson: result, finishedAt: new Date() }]);
      const res = await resumeRun(runId, { approved: true }, OTHER); // "Continue" of the interrupted run
      expect(res.status, JSON.stringify(result)).toBe("failed");
      expect(String(stepRow(runId, "w")!.error), JSON.stringify(result)).toMatch(gateErr("noGate"));
      expect(stepRow(runId, "g")!.resultJson, "the gate row is never re-stamped by a Continue").toEqual(result);
    }
    expect(otDispatchMock).not.toHaveBeenCalled();
  });

  it("★ R-4-e — the reviewer's exploit: deploy [G1,G2] → B approves G1 → redeploy [G1,G2,C:OT] → owner approves G2 ⇒ C does NOT run (staleApproval)", async () => {
    const v1: WorkflowDefinition = { ref: "swap", name: "Swap", steps: [{ id: "g1", type: "hitl_gate", prompt: "1" }, { id: "g2", type: "hitl_gate", prompt: "2" }] };
    await deployWorkflow(v1, OWNER);
    const started = await startRun("swap", {}, OWNER);
    expect(started.status).toBe("awaiting_confirm");
    expect((await resumeRun(started.runId!, { approved: true }, OTHER)).status).toBe("awaiting_confirm"); // B approves G1 (no command)
    expect(runRow(started.runId!).currentStepId).toBe("g2");
    expect((await deployWorkflow({ ...v1, steps: [...v1.steps, C_OT] }, OWNER)).ok).toBe(true); // owner swaps the definition
    const res = await resumeRun(started.runId!, { approved: true }, OWNER); // owner approves G2
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(0);
    expect(String(stepRow(started.runId!, "c")!.error)).toMatch(gateErr("staleApproval"));
  });

  it("control for R-4-e: the SAME sequence without a redeploy ⇒ C runs once (B's approval covers the definition it saw)", async () => {
    await deployWorkflow({ ref: "noswap", name: "NoSwap", steps: [{ id: "g1", type: "hitl_gate", prompt: "1" }, { id: "g2", type: "hitl_gate", prompt: "2" }, C_OT] }, OWNER);
    const started = await startRun("noswap", {}, OWNER);
    await resumeRun(started.runId!, { approved: true }, OTHER);
    const res = await resumeRun(started.runId!, { approved: true }, OWNER);
    expect(res.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect((otDispatchMock.mock.calls[0][0] as { triggeredBy: Record<string, unknown> }).triggeredBy).toMatchObject({ confirmedBy: OTHER.id });
  });

  it("★ R-4-f: an owner-less run (API key without an attributable creator) refuses OT steps (ownerUnknown) even after another user approves", async () => {
    await deployWorkflow(GATED, OWNER);
    const started = await startRun("gated", {}, { id: 0, role: "api", name: "key-x" });
    expect(runRow(started.runId!).startedBy).toBeNull();
    const res = await resumeRun(started.runId!, { approved: true }, OTHER);
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(String(stepRow(started.runId!, "w")!.error)).toMatch(gateErr("ownerUnknown"));
  });

  it("★ R-4-f: API run owned by the key's creator U — U approving their own run is refused (approvedByOwner; fourEyes gate ⇒ FORBIDDEN); another user ⇒ runs", async () => {
    const U = { id: 31, role: "engineer", name: "key-creator" };
    const api = { id: 0, role: "api", name: "key-u" };
    await deployWorkflow(GATED, OWNER);
    const a = await startRun("gated", {}, api, { ownerUserId: U.id });
    expect(runRow(a.runId!).startedBy).toBe(U.id);
    expect((await resumeRun(a.runId!, { approved: true }, U)).status).toBe("failed");
    expect(String(stepRow(a.runId!, "w")!.error)).toMatch(gateErr("approvedByOwner"));
    expect(otDispatchMock).not.toHaveBeenCalled();

    await deployWorkflow({ ref: "fe", name: "FourEyes", steps: [{ id: "g", type: "hitl_gate", prompt: "4e", fourEyes: true }, { id: "w", type: "command", machineId: 1, command: "start" }] }, OWNER);
    const b = await startRun("fe", {}, api, { ownerUserId: U.id });
    await expect(resumeRun(b.runId!, { approved: true }, U)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const c = await startRun("fe", {}, api); // no attributable owner
    await expect(resumeRun(c.runId!, { approved: true }, OTHER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(otDispatchMock).not.toHaveBeenCalled();

    const ok = await resumeRun(b.runId!, { approved: true }, OTHER);
    expect(ok.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ R-4-g: B approves → run interrupted → Continue by the OWNER, and by the SYSTEM (user 0) ⇒ B's approval kept, the run proceeds", async () => {
    const def: WorkflowDefinition = { ref: "intr", name: "Intr", steps: [{ id: "g", type: "hitl_gate", prompt: "g" }, { id: "c1", type: "command", machineId: 1, command: "start" }, { id: "c2", type: "command", machineId: 1, command: "stop" }] };
    await deployWorkflow(def, OWNER);
    for (const continuer of [OWNER, { id: 0, role: "system", name: "FOE auto-resume" }]) {
      otDispatchMock.mockClear();
      const started = await startRun("intr", {}, OWNER);
      expect((await resumeRun(started.runId!, { approved: true }, OTHER)).status).toBe("completed");
      const gateBefore = JSON.stringify(stepRow(started.runId!, "g")!.resultJson);
      // Interruption after the gate: c2 had not finished; the run is 'held' and (pre-fix shape) still points at 'g'.
      const steps = fake.store.get("orchestration_run_steps")!;
      steps.splice(steps.findIndex((r: Row) => r.runId === started.runId && r.stepId === "c2"), 1);
      Object.assign(runRow(started.runId!), { status: "held", currentStepId: "g", contextJson: { interrupted: true }, finishedAt: null });
      const res = await resumeRun(started.runId!, { approved: true, note: "continue" }, continuer);
      expect(res.status, `continued by ${continuer.id}`).toBe("completed");
      expect(JSON.stringify(stepRow(started.runId!, "g")!.resultJson), "gate approval NOT re-stamped").toBe(gateBefore);
      expect(otDispatchMock.mock.calls.map((c) => (c[0] as { commandType: string }).commandType)).toEqual(["start", "stop", "stop"]);
      expect((otDispatchMock.mock.calls[2][0] as { triggeredBy: Record<string, unknown> }).triggeredBy).toMatchObject({ confirmedBy: OTHER.id });
    }
  });

  it("R-4-g: a run pointed (awaiting) at a gate that ALREADY passed — approving again never re-stamps it; B's approval is kept", async () => {
    await deployWorkflow(GATED, OWNER);
    const started = await startRun("gated", {}, OWNER);
    expect((await resumeRun(started.runId!, { approved: true }, OTHER)).status).toBe("completed");
    const before = JSON.stringify(stepRow(started.runId!, "g")!.resultJson);
    const steps = fake.store.get("orchestration_run_steps")!;
    steps.splice(steps.findIndex((r: Row) => r.runId === started.runId && r.stepId === "w"), 1);
    Object.assign(runRow(started.runId!), { status: "awaiting_confirm", currentStepId: "g", finishedAt: null });
    otDispatchMock.mockClear();
    const res = await resumeRun(started.runId!, { approved: true }, OWNER);
    expect(res.status).toBe("completed");
    expect(JSON.stringify(stepRow(started.runId!, "g")!.resultJson)).toBe(before);
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect((otDispatchMock.mock.calls[0][0] as { triggeredBy: Record<string, unknown> }).triggeredBy).toMatchObject({ confirmedBy: OTHER.id });
  });

  it("R-4-g: the system user (0) resolving an open gate records NO approvedBy (source 'system') — it never counts", async () => {
    await deployWorkflow(GATED, OWNER);
    const started = await startRun("gated", {}, OWNER);
    const res = await resumeRun(started.runId!, { approved: true }, { id: 0, role: "system", name: "sys" });
    expect(res.status).toBe("failed");
    expect(stepRow(started.runId!, "g")!.resultJson).toMatchObject({ approved: true, approvalSource: "system" });
    expect(stepRow(started.runId!, "g")!.resultJson.approvedBy).toBeUndefined();
    expect(otDispatchMock).not.toHaveBeenCalled();
  });

  it("a robot MOTION step without a gate is refused the same way (robot dispatcher not called)", async () => {
    await deployWorkflow({ ref: "rbmove", name: "RbMove", steps: [{ id: "m", type: "command", machineId: 2, command: "start" }] }, OWNER);
    const res = await startRun("rbmove", {}, OWNER);
    expect(res.status).toBe("failed");
    expect(robotDispatchMock).not.toHaveBeenCalled();
    expect(String(stepRow(res.runId!, "m")!.error)).toMatch(gateErr("noGate"));
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
    // (verifyActionBinding + the DB layer — measured in commandDispatcher.dot1b.db.test.ts).
    expect((otDispatchMock.mock.calls[0][0] as { commandType: string }).commandType).toBe("stop");
  });
});
