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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
/**
 * final wave F5 — a HUNG DB for chosen engine lookups only: a select issued (synchronously) from one of these engine
 * functions never answers. The rest of the fake DB stays healthy so the run itself can progress.
 */
const HANG = { fns: new Set<string>(), hits: [] as string[] };
{
  const realSelect = fake.select.bind(fake);
  (fake as unknown as { select: typeof fake.select }).select = (proj?: Record<string, any>) => {
    const stack = new Error().stack ?? "";
    const fn = [...HANG.fns].find((f) => stack.includes(f));
    if (!fn) return realSelect(proj);
    HANG.hits.push(fn);
    const hung: any = { from: () => hung, where: () => hung, limit: () => hung, orderBy: () => hung, then: () => undefined };
    return hung;
  };
}
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

import { orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows, machines, deviceAdapters, robots } from "../../../../drizzle/schema";
import { deployWorkflow, startRun, resumeRun, FOE_GATE_REQUIRED } from "./foeEngine";
import { readFoeGateApproval } from "../../ot/otActionBinding";
import { hashWorkflowDefinition } from "./foeGateApproval";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";
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
  // final wave G3 / N1 (R-4-w) — a robot step must name an EXISTING robot (2 enabled, 3 disabled-but-existing).
  fake.seed(robots, [
    { id: 2, code: "R2", isEnabled: true },
    { id: 3, code: "R3", isEnabled: false },
  ]);
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  HANG.fns.clear();
  HANG.hits.length = 0;
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

  // doc 81 Đợt 5 task E1 (2026-10-10, item 24 option C) — re-pinned: an API-started run never actuates a non-STOP step, so
  // the reason is now apiRun (it precedes approvedByOwner) and "another user ⇒ runs" became "another user ⇒ still refused".
  it("★ R-4-f + Đợt 5 E1: API run owned by the key's creator U — U approving is refused (apiRun; fourEyes gate ⇒ FORBIDDEN); another user approving ⇒ STILL refused (apiRun)", async () => {
    const U = { id: 31, role: "engineer", name: "key-creator" };
    const api = { id: 0, role: "api", name: "key-u" };
    await deployWorkflow(GATED, OWNER);
    const a = await startRun("gated", {}, api, { ownerUserId: U.id });
    expect(runRow(a.runId!).startedBy).toBe(U.id);
    expect((await resumeRun(a.runId!, { approved: true }, U)).status).toBe("failed");
    expect(String(stepRow(a.runId!, "w")!.error)).toMatch(gateErr("apiRun"));
    expect(otDispatchMock).not.toHaveBeenCalled();

    await deployWorkflow({ ref: "fe", name: "FourEyes", steps: [{ id: "g", type: "hitl_gate", prompt: "4e", fourEyes: true }, { id: "w", type: "command", machineId: 1, command: "start" }] }, OWNER);
    const b = await startRun("fe", {}, api, { ownerUserId: U.id });
    await expect(resumeRun(b.runId!, { approved: true }, U)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const c = await startRun("fe", {}, api); // no attributable owner
    await expect(resumeRun(c.runId!, { approved: true }, OTHER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(otDispatchMock).not.toHaveBeenCalled();

    const other = await resumeRun(b.runId!, { approved: true }, OTHER);
    expect(other.status).toBe("failed");
    expect(String(stepRow(b.runId!, "w")!.error)).toMatch(gateErr("apiRun"));
    expect(otDispatchMock).not.toHaveBeenCalled();
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

  /** A definition that is ALREADY active (deployed before fix round 3) — R-4-n now refuses it at deploy. */
  const seedActive = (ref: string, steps: WorkflowDefinition["steps"]) =>
    fake.seed(orchestrationWorkflows, [{ id: 7000 + (fake.store.get("orchestration_workflows")?.length ?? 0), ref, name: ref, version: 1, definitionJson: { ref, name: ref, steps }, status: "active" }]);

  /**
   * final wave G4 — a run that was ALREADY IN FLIGHT before the start-time check existed: 'held' + interrupted, with (when
   * `gateBy` is given) gate "g" approved through the server path by that user for the current definition.
   */
  const seedInFlightRun = (ref: string, runId: number, gateBy?: number) => {
    const wf = (fake.store.get("orchestration_workflows") ?? []).find((w: Row) => w.ref === ref)!;
    fake.seed(orchestrationRuns, [
      { id: runId, workflowId: wf.id, workflowRef: ref, status: "held", paramsJson: {}, contextJson: { interrupted: true }, startedBy: OWNER.id, startedAt: new Date(), currentStepId: null },
    ]);
    fake.seed(
      orchestrationRunSteps,
      gateBy
        ? [{ id: runId * 10, runId, stepId: "g", stepType: "hitl_gate", status: "completed", attempt: 0, resultJson: { approved: true, approvedBy: gateBy, approvalSource: "server", defHash: hashWorkflowDefinition(wf.definitionJson) }, finishedAt: new Date() }]
        : [],
    );
  };

  it("★ R-4-m/R-4-n runtime + final wave G4: an already-active robot step with NO robotId — a NEW run is refused at START (robotIdMissing, no run created); a run already in flight never falls back to the machine id — refused with the localisable INVALID_VALUE robotId/robotIdRequired; robot dispatcher not called; no authorisation row; a STOP likewise (not a gate error)", async () => {
    seedActive("rbnoid", [{ id: "g", type: "hitl_gate", prompt: "g" }, { id: "m", type: "command", machineId: 2, command: "start" }]);
    const refused = await startRun("rbnoid", {}, OWNER);
    expect(refused).toMatchObject({ ok: false, enabled: true, reason: "robotIdMissing", stepIds: ["m"] });
    expect(refused.runId).toBeUndefined();
    expect(fake.store.get("orchestration_runs") ?? []).toHaveLength(0); // G4: no run created
    seedInFlightRun("rbnoid", 801, OTHER.id);
    const started = { runId: 801 };
    const res = await resumeRun(started.runId!, { approved: true }, OTHER);
    expect(res.status).toBe("failed");
    expect(robotDispatchMock).not.toHaveBeenCalled();
    const row = stepRow(started.runId!, "m")!;
    expect(String(row.error)).toContain("robotId required");
    expect(row.resultJson?.detail?.appError).toEqual({ appCode: "INVALID_VALUE", appParams: { field: "robotId", reason: "robotIdRequired" } });
    expect(actions()).toHaveLength(0); // R-4-n: no authorisation row for a command that can never be sent
    seedActive("rbnoidstop", [{ id: "s", type: "command", machineId: 2, command: "abort" }]);
    // final wave N1 (R-4-w) — a STOP step never refuses a start: the run starts and the abort fails on its own at runtime.
    const stop = await startRun("rbnoidstop", {}, OWNER);
    expect(stop.runId).toBeDefined();
    expect(stop.reason).toBeUndefined();
    expect(stop.status).toBe("failed");
    expect(robotDispatchMock).not.toHaveBeenCalled();
    const srow = stepRow(stop.runId!, "s")!;
    expect(String(srow.error)).toContain("robotId required");
    expect(String(srow.error)).not.toMatch(gateErr("noGate"));
    expect(srow.resultJson?.detail?.appError).toMatchObject({ appParams: { reason: "robotIdRequired" } });
  });

  it("★ R-4-n deploy: a robot step (motion, abort, nested compensation) without a numeric robotId is REFUSED at deploy (robotIdMissing, names the steps, nothing persisted); with robotId it deploys", async () => {
    const r = await deployWorkflow(
      {
        ref: "rbdep",
        name: "rbdep",
        steps: [
          { id: "mv", type: "command", machineId: 2, command: "start" },
          { id: "ab", type: "command", machineId: 2, command: "abort", args: { robotId: "2" } },
          { id: "ot", type: "command", machineId: 1, command: "start", args: { adapterId: 501 }, compensation: { id: "es", type: "command", machineId: 2, command: "e_stop" } },
        ],
      },
      OWNER,
    );
    expect(r).toMatchObject({ ok: false, reason: "robotIdMissing", stepIds: ["mv", "ab", "es"] });
    expect(String(r.message)).toContain("mv, ab, es");
    expect(fake.store.get("orchestration_workflows") ?? []).toHaveLength(0);
    const ok = await deployWorkflow({ ref: "rbdep2", name: "rbdep2", steps: [{ id: "ab", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }] }, OWNER);
    expect(ok.ok).toBe(true);
    const run = await startRun("rbdep2", {}, OWNER);
    expect(run.status).toBe("completed"); // L-7: a robot STOP with its robot is still never gated
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ R-4-j: an OT STOP step without a unique adapter is refused at DEPLOY (0 or 2 enabled adapters, no args.adapterId); 1 adapter / explicit adapterId / non-stop step ⇒ deploys", async () => {
    const stopDef = (ref: string, args?: Record<string, unknown>): WorkflowDefinition => ({
      ref,
      name: ref,
      steps: [{ id: "st", type: "command", machineId: 1, command: "stop", ...(args ? { args } : {}) }],
    });
    fake.store.set("device_adapters", []);
    const none = await deployWorkflow(stopDef("st0"), OWNER);
    expect(none).toMatchObject({ ok: false, reason: "stopAdapterAmbiguous", stepIds: ["st"] });
    expect(String(none.message)).toContain("st");
    expect(fake.store.get("orchestration_workflows") ?? []).toHaveLength(0); // nothing persisted
    fake.store.set("device_adapters", [
      { id: 501, machineId: 1, isEnabled: true },
      { id: 502, machineId: 1, isEnabled: true },
    ]);
    expect(await deployWorkflow(stopDef("st2"), OWNER)).toMatchObject({ ok: false, reason: "stopAdapterAmbiguous" });
    // nested in a branch/compensation is found too
    const nested = await deployWorkflow(
      { ref: "stn", name: "n", steps: [{ id: "c", type: "command", machineId: 1, command: "start", args: { adapterId: 501 }, compensation: { id: "undo", type: "command", machineId: 1, command: "stop" } }] },
      OWNER,
    );
    expect(nested).toMatchObject({ ok: false, reason: "stopAdapterAmbiguous", stepIds: ["undo"] });
    expect((await deployWorkflow(stopDef("st2x", { adapterId: 502 }), OWNER)).ok).toBe(true); // explicit adapter
    expect((await deployWorkflow({ ref: "nonstop", name: "ns", steps: [{ id: "w", type: "command", machineId: 1, command: "start" }] }, OWNER)).ok).toBe(true);
    fake.store.set("device_adapters", [{ id: 501, machineId: 1, isEnabled: true }, { id: 502, machineId: 1, isEnabled: false }]);
    expect((await deployWorkflow(stopDef("st1"), OWNER)).ok).toBe(true); // exactly one ENABLED
  });

  it("R-4-j: the RUNTIME stop path is unchanged — never gated; adapters changed after deploy ⇒ a NEW run still STARTS (N1, R-4-w: a stop step never refuses a start) and the stop gets the OT route's refusal as before (no gate error)", async () => {
    await deployWorkflow({ ref: "strt", name: "strt", steps: [{ id: "st", type: "command", machineId: 1, command: "stop" }] }, OWNER);
    const ok = await startRun("strt", {}, OWNER);
    expect(ok.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect((otDispatchMock.mock.calls[0][0] as { adapterId: number }).adapterId).toBe(501);
    fake.store.set("device_adapters", []); // adapter removed AFTER deploy
    const later = await startRun("strt", {}, OWNER);
    expect(later.reason).toBeUndefined(); // N1 — not refused at start
    expect(later.runId).toBeDefined();
    expect(later.status).toBe("failed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    const err = String(stepRow(later.runId!, "st")!.error);
    expect(err).toContain("adapterId required");
    expect(err).not.toMatch(/FOE_GATE_REQUIRED/);
  });

  it("a robot MOTION step without a gate is refused the same way (robot dispatcher not called)", async () => {
    await deployWorkflow({ ref: "rbmove", name: "RbMove", steps: [{ id: "m", type: "command", machineId: 2, command: "start", args: { robotId: 2 } }] }, OWNER);
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
          { id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }, // fix round 2 (R-4-m): robotId explicit
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

/** Explicit bound (never a vitest timeout): the promise's value, or "HUNG" if it did not settle within `ms`. */
async function within<T>(p: Promise<T>, ms: number): Promise<T | "HUNG"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([p, new Promise<"HUNG">((res) => (t = setTimeout(() => res("HUNG"), ms)))]);
  clearTimeout(t);
  return r;
}

describe("final wave F5 (L-7) — an engine STOP step never waits on a hung DB lookup", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it("★ robot STOP: the gate lookup is NOT made at all — a hung gate lookup cannot delay it (answered well under the STOP DB deadline)", async () => {
    await deployWorkflow({ ref: "rstop", name: "rstop", steps: [{ id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }] }, OWNER);
    HANG.fns.add("findSeparateGateApproval");
    const t0 = Date.now();
    const res = await within(startRun("rstop", {}, OWNER), STOP_DB_STEP_DEADLINE_MS + 2000);
    expect(res, "robot STOP hung behind the gate lookup").not.toBe("HUNG");
    expect(Date.now() - t0).toBeLessThan(STOP_DB_STEP_DEADLINE_MS / 2);
    expect(HANG.hits).toEqual([]); // never asked
    expect((res as { status: string }).status).toBe("completed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ OT STOP with an explicit adapter + HUNG gate lookup ⇒ sent within the STOP DB deadline (self-confirmed: the dispatcher's pinned-stop rule decides), logged", async () => {
    await deployWorkflow({ ref: "ostop", name: "ostop", steps: [{ id: "os", type: "command", machineId: 1, command: "stop", args: { adapterId: 501 } }] }, OWNER);
    HANG.fns.add("findSeparateGateApproval");
    const t0 = Date.now();
    const res = await within(startRun("ostop", {}, OWNER), STOP_DB_STEP_DEADLINE_MS + 2000);
    expect(res, "OT STOP hung behind the gate lookup").not.toBe("HUNG");
    expect(Date.now() - t0).toBeLessThan(STOP_DB_STEP_DEADLINE_MS + 700);
    expect(HANG.hits).toEqual(["findSeparateGateApproval"]);
    expect((res as { status: string }).status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect((otDispatchMock.mock.calls[0][0] as { triggeredBy: Record<string, unknown> }).triggeredBy).toMatchObject({ confirmedBy: OWNER.id, requestedBy: OWNER.id });
    expect(warn.mock.calls.flat().join(" ")).toMatch(/gate lookup not answered/);
  });

  it("★ OT STOP whose ADAPTER lookup (and gate lookup) HANG ⇒ bounded: the OT route's own refusal (adapterId required), no gate error, never a silent hang", async () => {
    await deployWorkflow({ ref: "ostop2", name: "ostop2", steps: [{ id: "os", type: "command", machineId: 1, command: "stop" }] }, OWNER); // 1 adapter ⇒ deploys
    HANG.fns.add("withResolvedAdapter"); // the RUNTIME adapter lookup only (the start-time G4 check stays healthy)
    HANG.fns.add("findSeparateGateApproval");
    const t0 = Date.now();
    const res = await within(startRun("ostop2", {}, OWNER), STOP_DB_STEP_DEADLINE_MS + 2000);
    expect(res, "OT STOP hung behind the adapter lookup").not.toBe("HUNG");
    expect(Date.now() - t0).toBeLessThan(STOP_DB_STEP_DEADLINE_MS + 700);
    expect([...HANG.hits].sort()).toEqual(["findSeparateGateApproval", "withResolvedAdapter"]);
    expect((res as { status: string }).status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    const err = String(stepRow((res as { runId: number }).runId, "os")!.error);
    expect(err).toContain("adapterId required");
    expect(err).not.toMatch(/FOE_GATE_REQUIRED/);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/adapter lookup not answered/);
  });

  it("control: a NON-stop OT step is unchanged — it still needs the gate (a hung gate lookup holds it; it is not bounded by the STOP deadline)", async () => {
    await deployWorkflow({ ref: "omove", name: "omove", steps: [{ id: "w", type: "command", machineId: 1, command: "start", args: { adapterId: 501 } }] }, OWNER);
    HANG.fns.add("findSeparateGateApproval");
    const res = await within(startRun("omove", {}, OWNER), STOP_DB_STEP_DEADLINE_MS + 500);
    expect(res).toBe("HUNG");
    expect(otDispatchMock).not.toHaveBeenCalled();
  });
});

describe("final wave G3 + G4 (N1 R-4-w, R-4-x) — robot exists (every step) + enabled (motion) at deploy; NON-stop checks at run START", () => {
  it("★ G3/N1 deploy: a robot step naming a robot that does not EXIST is REFUSED (robotUnavailable, names the steps, nothing persisted); a disabled-but-existing robot is NOT a refusal", async () => {
    const r = await deployWorkflow(
      {
        ref: "rbun",
        name: "rbun",
        steps: [
          { id: "ghost", type: "command", machineId: 2, command: "abort", args: { robotId: 99 } },
          { id: "off", type: "command", machineId: 2, command: "start", args: { robotId: 3 } },
          { id: "fine", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } },
        ],
      },
      OWNER,
    );
    expect(r).toMatchObject({ ok: false, reason: "robotUnavailable", stepIds: ["ghost"] }); // "off" (robot 3, disabled) is not refused
    expect(String(r.message)).toContain("ghost");
    expect(fake.store.get("orchestration_workflows") ?? []).toHaveLength(0);
    expect((await deployWorkflow({ ref: "rbok", name: "rbok", steps: [{ id: "fine", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }] }, OWNER)).ok).toBe(true);
  });

  it("★ N1 (c) + R-4-x deploy: a DISABLED-but-existing robot — an ABORT deploys; a MOTION step is refused (robotDisabled); a NONEXISTENT robot is still refused", async () => {
    const ab = await deployWorkflow({ ref: "rboffab", name: "rboffab", steps: [{ id: "ab", type: "command", machineId: 2, command: "abort", args: { robotId: 3 } }] }, OWNER);
    expect(ab.ok).toBe(true);
    expect(ab.reason).toBeUndefined();
    const mv = await deployWorkflow(
      { ref: "rboffmv", name: "rboffmv", steps: [{ id: "ab", type: "command", machineId: 2, command: "abort", args: { robotId: 3 } }, { id: "mv", type: "command", machineId: 2, command: "start", args: { robotId: 3 } }] },
      OWNER,
    );
    expect(mv).toMatchObject({ ok: false, reason: "robotDisabled", stepIds: ["mv"] }); // the abort "ab" is not named
    // run_job classified by its JOB: jobType "move" is motion (refused), jobType "abort" is a stop (deploys)
    const rjMove = await deployWorkflow({ ref: "rjmove", name: "rjmove", steps: [{ id: "rj", type: "command", machineId: 2, command: "run_job", args: { robotId: 3, jobType: "move", params: {} } }] }, OWNER);
    expect(rjMove).toMatchObject({ ok: false, reason: "robotDisabled", stepIds: ["rj"] });
    const rjAbort = await deployWorkflow({ ref: "rjabort", name: "rjabort", steps: [{ id: "rj", type: "command", machineId: 2, command: "run_job", args: { robotId: 3, jobType: "abort", params: { joints: [1, 2] } } }] }, OWNER);
    expect(rjAbort.ok).toBe(true);
    const ghost = await deployWorkflow({ ref: "rbghost", name: "rbghost", steps: [{ id: "ab", type: "command", machineId: 2, command: "abort", args: { robotId: 4242 } }] }, OWNER);
    expect(ghost).toMatchObject({ ok: false, reason: "robotUnavailable", stepIds: ["ab"] });
  });

  it("★ R-4-x start: an ACTIVE workflow with a MOTION step to a DISABLED robot is refused at START (robotDisabled), nothing dispatched; the same robot with only an abort starts", async () => {
    fake.seed(orchestrationWorkflows, [
      { id: 7500, ref: "offmv", name: "offmv", version: 1, definitionJson: { ref: "offmv", name: "offmv", steps: [{ id: "ab", type: "command", machineId: 2, command: "abort", args: { robotId: 3 } }, { id: "mv", type: "command", machineId: 2, command: "start", args: { robotId: 3 } }] }, status: "active" },
      { id: 7501, ref: "offab", name: "offab", version: 1, definitionJson: { ref: "offab", name: "offab", steps: [{ id: "ab", type: "command", machineId: 2, command: "abort", args: { robotId: 3 } }] }, status: "active" },
    ]);
    const r = await startRun("offmv", {}, OWNER);
    expect(r).toMatchObject({ ok: false, enabled: true, reason: "robotDisabled", stepIds: ["mv"] });
    expect(r.runId).toBeUndefined();
    expect(robotDispatchMock).not.toHaveBeenCalled();
    const ok = await startRun("offab", {}, OWNER);
    expect(ok.reason).toBeUndefined();
    expect(ok.status).toBe("completed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("G3 fail-closed: the robot lookup failing (DB error) refuses the robot steps", async () => {
    HANG.fns.clear();
    const realSelect = (fake as any).select;
    (fake as any).select = (proj?: unknown) => {
      const b = realSelect(proj);
      const from = b.from;
      b.from = (t: unknown) => {
        if (t === robots) throw new Error("simulated DB error on robots");
        return from(t);
      };
      return b;
    };
    try {
      const r = await deployWorkflow({ ref: "rbdb", name: "rbdb", steps: [{ id: "a", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }] }, OWNER);
      expect(r).toMatchObject({ ok: false, reason: "robotUnavailable", stepIds: ["a"] });
    } finally {
      (fake as any).select = realSelect;
    }
  });

  const seedActiveDef = (id: number, ref: string, steps: WorkflowDefinition["steps"]) =>
    fake.seed(orchestrationWorkflows, [{ id, ref, name: ref, version: 1, definitionJson: { ref, name: ref, steps }, status: "active" }]);

  it("★ N1 (R-4-w): an ACTIVE workflow whose abort names a DISABLED (existing) robot STARTS and the abort goes out (it did before G4)", async () => {
    seedActiveDef(7100, "legacyrb", [{ id: "ab", type: "command", machineId: 2, command: "abort", args: { robotId: 3 } }]);
    const r = await startRun("legacyrb", {}, OWNER);
    expect(r.reason).toBeUndefined();
    expect(r.status).toBe("completed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ N1 (a): a run whose ONLY defects are in STOP steps starts; its other stop steps go out; the defective stop step fails visibly (i18n robotIdRequired / adapterId required)", async () => {
    // a1 — robot abort with no robotId, after a good OT stop and a good robot abort
    seedActiveDef(7200, "stopsA", [
      { id: "os", type: "command", machineId: 1, command: "stop" },
      { id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } },
      { id: "rbad", type: "command", machineId: 2, command: "abort" },
    ]);
    const a = await startRun("stopsA", {}, OWNER);
    expect(a.reason).toBeUndefined();
    expect(a.runId).toBeDefined();
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    expect(a.status).toBe("failed");
    const bad = stepRow(a.runId!, "rbad")!;
    expect(bad.status).toBe("failed");
    expect(bad.resultJson?.detail?.appError).toEqual({ appCode: "INVALID_VALUE", appParams: { field: "robotId", reason: "robotIdRequired" } });
    // a2 — an OT stop whose machine has no unique adapter any more (changed after deploy), after a good robot abort.
    otDispatchMock.mockClear();
    robotDispatchMock.mockClear();
    fake.store.set("device_adapters", [
      { id: 501, machineId: 1, isEnabled: true },
      { id: 502, machineId: 1, isEnabled: true },
    ]);
    seedActiveDef(7201, "stopsB", [
      { id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } },
      { id: "os", type: "command", machineId: 1, command: "stop" },
    ]);
    const b = await startRun("stopsB", {}, OWNER);
    expect(b.reason).toBeUndefined();
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(b.status).toBe("failed");
    expect(String(stepRow(b.runId!, "os")!.error)).toContain("adapterId required");
  });

  it("★ N1 (b): a defect in a NON-stop step is still refused at START (robotUnavailable / robotIdMissing), no run, nothing dispatched — even next to good stops", async () => {
    seedActiveDef(7300, "mixed", [
      { id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } },
      { id: "mv", type: "command", machineId: 2, command: "start", args: { robotId: 4242 } },
    ]);
    const r = await startRun("mixed", {}, OWNER);
    expect(r).toMatchObject({ ok: false, enabled: true, reason: "robotUnavailable", stepIds: ["mv"] });
    expect(r.runId).toBeUndefined();
    expect(fake.store.get("orchestration_runs") ?? []).toHaveLength(0);
    seedActiveDef(7301, "mixed2", [
      { id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } },
      { id: "mv", type: "command", machineId: 2, command: "start" },
      { id: "s", type: "command", machineId: 2, command: "e_stop" },
    ]);
    expect(await startRun("mixed2", {}, OWNER)).toMatchObject({ ok: false, reason: "robotIdMissing", stepIds: ["mv"] }); // the e_stop "s" is not named
    expect(robotDispatchMock).not.toHaveBeenCalled();
    expect(otDispatchMock).not.toHaveBeenCalled();
  });

  it("N1: at START a robots-table DB error refuses only MOTION steps — a stop-only run still starts and goes out", async () => {
    seedActiveDef(7400, "stopdb", [{ id: "ab", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }]);
    const realSelect = (fake as any).select;
    (fake as any).select = (proj?: unknown) => {
      const b = realSelect(proj);
      const from = b.from;
      b.from = (t: unknown) => {
        if (t === robots) throw new Error("simulated DB error on robots");
        return from(t);
      };
      return b;
    };
    try {
      const r = await startRun("stopdb", {}, OWNER);
      expect(r.reason).toBeUndefined();
      expect(r.status).toBe("completed");
      expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    } finally {
      (fake as any).select = realSelect;
    }
  });

  it("G4: a valid active workflow starts exactly as before (the start-time check refuses nothing it should not)", async () => {
    await deployWorkflow({ ref: "validstart", name: "v", steps: [{ id: "os", type: "command", machineId: 1, command: "stop" }, { id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }] }, OWNER);
    const r = await startRun("validstart", {}, OWNER);
    expect(r.status).toBe("completed");
    expect(r.reason).toBeUndefined();
  });
});
