/**
 * doc 81 Đợt 9 task R2/R4 (owner decision 2026-10-12, OPTION A — replaces Đợt 5 E1 option C "API runs never actuate").
 *
 * A run started through an API key records WHICH key started it (orchestration_runs.startedViaApiKeyId, server side) and
 * the key records WHO IT IS ISSUED TO (api_keys.holderUserId + the append-only api_key_holder_changes). An approval of such
 * a run counts only when the approver is NONE of {the starter, the key's holder now, every earlier holder, the creator} —
 * re-derived from the DB rows on every approval-consuming path. Measured here (shared FakeDb; OT/robot dispatchers are
 * counters; `isStopCommandType` is the real one):
 *   • engine: fresh walk after the gate, step RETRY (each attempt re-derives), "Continue" of an interrupted run, saga
 *     compensation, four-eyes gate policy at approval time;
 *   • edge: an edge re-execution (params copied, no key recorded there), an edge sync wiping contextJson (the real
 *     edgeCoordinator.syncRunResult), edge-synced gate rows;
 *   • the dispatchers' DB layer (foeGateApproval.foeApprovalDbRefusal);
 *   • STOPs (L-7) unaffected — identified, unidentified and holder-less keys alike;
 *   • the approver's screen (getRun().apiKey).
 * The real dispatchers on the real `_test` DB (mig 0369 columns + trigger): foeApiKeyHolderDispatchers.dot9.db.test.ts.
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
// factory scope is measured elsewhere (foeScope.dot5.db.test.ts); every principal here is unrestricted.
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return { ...orig, resolveUserFoeScope: () => null };
});
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { orchestrationRunSteps, machines, deviceAdapters, robots, users } from "../../../../drizzle/schema";
import { deployWorkflow, startRun, resumeRun, getRun, FOE_GATE_REQUIRED } from "./foeEngine";
import { foeApprovalDbRefusal, hashWorkflowDefinition, computeBindingDigest, FOE_API_RUN_PARAM } from "./foeGateApproval";
import { apiKeyHolderChanges, apiKeyIdentityCols } from "./runApiKeyIdentity";
import type { WorkflowDefinition } from "./workflowModel";

type Row = Record<string, any>;
const KEY = 700;
const CREATOR = { id: 10, role: "engineer", name: "key-creator" };
const EARLIER = { id: 13, role: "engineer", name: "earlier-holder" }; // the key was issued to them first
const STARTER = { id: 14, role: "engineer", name: "holder-at-start" }; // holder when the run started ⇒ startedBy
const HOLDER = { id: 12, role: "supervisor", name: "holder-now" }; // re-issued to them after the start
const OTHER = { id: 20, role: "supervisor", name: "second-person" };
const OTHER2 = { id: 21, role: "supervisor", name: "holder-of-another-key" };
const API = { id: 0, role: "api", name: "line-integration" };

const runRow = (id: number): Row => (fake.store.get("orchestration_runs") ?? []).find((r: Row) => r.id === id)!;
const stepRow = (runId: number, stepId: string): Row | undefined =>
  (fake.store.get("orchestration_run_steps") ?? []).find((s: Row) => s.runId === runId && s.stepId === stepId);
const actions = (): Row[] => fake.store.get("ai_pending_actions") ?? [];
const keyRow = (): Row => (fake.store.get("api_keys") ?? []).find((k: Row) => k.id === KEY)!;
const gateErr = (reason: string) => new RegExp(`^${FOE_GATE_REQUIRED}\\(${reason}\\): `);
let histSeq = 100;
/** what apiKeyRouter.setHolder + the 0369 trigger do: new holder + a history row */
function reissue(to: number) {
  const k = keyRow();
  fake.store.get("api_key_holder_changes")!.push({ id: histSeq++, apiKeyId: KEY, fromUserId: k.holderUserId, toUserId: to });
  k.holderUserId = to;
}
/** the API v1 route: owner = holder (STARTER at the time), the AUTHENTICATED key id */
const apiStart = (ref: string, params: Record<string, unknown> = {}) => startRun(ref, params, API, { ownerUserId: STARTER.id, viaApi: true, apiKeyId: KEY });
/** start through the key, then the admin re-issues the key to HOLDER ⇒ four distinct roles: starter / holder / earlier / creator */
async function startedThenReissued(ref: string) {
  const r = await apiStart(ref);
  reissue(HOLDER.id);
  return r;
}

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  histSeq = 100;
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "ROBOT", capabilities: null, code: "R1", name: "Robot-1", operationStatus: "stopped", stationId: 1 },
  ]);
  fake.seed(deviceAdapters, [{ id: 501, machineId: 1, isEnabled: true }]);
  fake.seed(robots, [{ id: 2, code: "R2", isEnabled: true }]);
  seedKeys();
  fake.seed(users, [CREATOR, EARLIER, STARTER, HOLDER, OTHER, OTHER2].map((u) => ({ id: u.id, name: u.name, role: u.role, isActive: true })));
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
});

function seedKeys() {
  fake.seed(apiKeyIdentityCols, [
    { id: KEY, name: "line-integration", keyPrefix: "ak_1a2b3c", isActive: true, createdBy: CREATOR.id, holderUserId: STARTER.id },
    { id: 701, name: "other-key", keyPrefix: "ak_999999", isActive: true, createdBy: OTHER2.id, holderUserId: OTHER2.id },
  ]);
  fake.seed(apiKeyHolderChanges, [
    { id: 1, apiKeyId: KEY, fromUserId: null, toUserId: EARLIER.id },
    { id: 2, apiKeyId: KEY, fromUserId: EARLIER.id, toUserId: STARTER.id },
    { id: 3, apiKeyId: 701, fromUserId: null, toUserId: OTHER.id }, // another key's history never widens KEY's set
    { id: 4, apiKeyId: 701, fromUserId: OTHER.id, toUserId: OTHER2.id },
  ]);
}

const GATED_OT: WorkflowDefinition = {
  ref: "api-ot",
  name: "api-ot",
  steps: [
    { id: "g", type: "hitl_gate", prompt: "approve" },
    { id: "w", type: "command", machineId: 1, command: "start" },
  ],
};
const FOUR_EYES: WorkflowDefinition = {
  ref: "api-4e",
  name: "api-4e",
  steps: [
    { id: "g", type: "hitl_gate", prompt: "approve", fourEyes: true },
    { id: "w", type: "command", machineId: 1, command: "start" },
  ],
};

describe("doc 81 Đợt 9 R2 — the approval rule of an API-started run (option A)", () => {
  it("★ the key is recorded SERVER side on the run (owner = holder at start); params cannot supply or change it", async () => {
    await deployWorkflow(GATED_OT, CREATOR);
    const a = await apiStart("api-ot", { startedViaApiKeyId: 701, apiKeyId: 701, [FOE_API_RUN_PARAM]: false });
    expect(runRow(a.runId!).startedViaApiKeyId).toBe(KEY);
    expect(runRow(a.runId!).startedBy).toBe(STARTER.id);
    expect(runRow(a.runId!).paramsJson[FOE_API_RUN_PARAM]).toBe(true);
    // a USER run whose params claim to be an API run with a key: the marker can only restrict (it is added), the key id is
    // never taken from params ⇒ unidentified ⇒ refused (apiRun) even when a second person approves
    const u = await startRun("api-ot", { [FOE_API_RUN_PARAM]: true, startedViaApiKeyId: KEY }, CREATOR);
    expect(runRow(u.runId!).startedViaApiKeyId).toBeUndefined();
    expect((await resumeRun(u.runId!, { approved: true }, OTHER)).status).toBe("failed");
    expect(String(stepRow(u.runId!, "w")!.error)).toMatch(gateErr("apiRun"));
    // an API start WITHOUT an authenticated key id (master key / OAuth principal) records none ⇒ unidentified
    const m = await startRun("api-ot", {}, API, { ownerUserId: STARTER.id, viaApi: true });
    expect(runRow(m.runId!).startedViaApiKeyId).toBeUndefined();
    expect(otDispatchMock).not.toHaveBeenCalled();
  });

  for (const [who, approver, reason] of [
    ["the STARTER (holder at start)", STARTER, "approvedByOwner"],
    ["the HOLDER now", HOLDER, "approvedByKeyHolder"],
    ["an EARLIER holder", EARLIER, "approvedByKeyHolder"],
    ["the key's CREATOR", CREATOR, "approvedByKeyHolder"],
  ] as const) {
    it(`★ ${who} approves the gate ⇒ the OT step is NOT sent (${reason}), no authorisation row`, async () => {
      await deployWorkflow(GATED_OT, CREATOR);
      const r = await startedThenReissued("api-ot");
      expect(r.status).toBe("awaiting_confirm");
      expect((await resumeRun(r.runId!, { approved: true }, approver)).status).toBe("failed");
      expect(String(stepRow(r.runId!, "w")!.error)).toMatch(gateErr(reason));
      expect(otDispatchMock).not.toHaveBeenCalled();
      expect(actions()).toHaveLength(0);
    });
  }

  it("★ a DIFFERENT user approves ⇒ sent exactly once; the authorisation row's confirmer is that user (OT and robot motion)", async () => {
    await deployWorkflow(GATED_OT, CREATOR);
    const r = await startedThenReissued("api-ot");
    expect((await resumeRun(r.runId!, { approved: true }, OTHER)).status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(actions()).toHaveLength(1);
    expect(actions()[0].userId).toBe(OTHER.id);
    // the holder of ANOTHER key (whose history names OTHER) is not a party of THIS key: OTHER2 also counts here
    await deployWorkflow({ ref: "api-rb", name: "api-rb", steps: [{ id: "g", type: "hitl_gate", prompt: "p" }, { id: "m", type: "command", machineId: 2, command: "start", args: { robotId: 2 } }] }, CREATOR);
    const rb = await apiStart("api-rb");
    expect((await resumeRun(rb.runId!, { approved: true }, OTHER2)).status).toBe("completed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ four-eyes gate: starter, holder, earlier holder and creator are each REFUSED at approval (FORBIDDEN, nothing changes); a different user proceeds", async () => {
    await deployWorkflow(FOUR_EYES, CREATOR);
    const r = await startedThenReissued("api-4e");
    for (const u of [STARTER, HOLDER, EARLIER, CREATOR]) {
      await expect(resumeRun(r.runId!, { approved: true }, u), `approver ${u.name}`).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(runRow(r.runId!).status).toBe("awaiting_confirm");
    }
    expect(stepRow(r.runId!, "g")?.status).not.toBe("completed");
    expect((await resumeRun(r.runId!, { approved: true }, OTHER)).status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ fail-closed identity: no key recorded / key deleted ⇒ apiRun; key without a holder ⇒ ownerUnknown (four-eyes: refused at approval)", async () => {
    await deployWorkflow(GATED_OT, CREATOR);
    const legacy = await startRun("api-ot", {}, API, { ownerUserId: STARTER.id, viaApi: true }); // before 0369 / edge copy
    expect((await resumeRun(legacy.runId!, { approved: true }, OTHER)).status).toBe("failed");
    expect(String(stepRow(legacy.runId!, "w")!.error)).toMatch(gateErr("apiRun"));

    const del = await apiStart("api-ot");
    fake.store.set("api_keys", (fake.store.get("api_keys") ?? []).filter((k: Row) => k.id !== KEY)); // apiKey.delete
    expect((await resumeRun(del.runId!, { approved: true }, OTHER)).status).toBe("failed");
    expect(String(stepRow(del.runId!, "w")!.error)).toMatch(gateErr("apiRun"));

    fake.seed(apiKeyIdentityCols, [{ id: KEY, name: "k", keyPrefix: "ak_x", isActive: true, createdBy: CREATOR.id, holderUserId: null }]);
    const noHolder = await apiStart("api-ot");
    expect((await resumeRun(noHolder.runId!, { approved: true }, OTHER)).status).toBe("failed");
    expect(String(stepRow(noHolder.runId!, "w")!.error)).toMatch(gateErr("ownerUnknown"));

    await deployWorkflow(FOUR_EYES, CREATOR);
    const fe = await apiStart("api-4e");
    await expect(resumeRun(fe.runId!, { approved: true }, OTHER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(0);
  });

  it("★ RETRY re-derives on every attempt: the first send fails, the key is re-issued to the approver meanwhile ⇒ the retry is NOT sent", async () => {
    await deployWorkflow({ ref: "api-retry", name: "api-retry", steps: [{ id: "g", type: "hitl_gate", prompt: "p" }, { id: "w", type: "command", machineId: 1, command: "start", maxAttempts: 2 }] }, CREATOR);
    const r = await apiStart("api-retry");
    otDispatchMock.mockImplementationOnce(async () => {
      reissue(OTHER.id); // between the attempts the admin re-issues the key to the approver
      return { ok: false, simulated: true, status: "rejected", results: [], commandLogIds: [] } as never;
    });
    expect((await resumeRun(r.runId!, { approved: true }, OTHER)).status).toBe("failed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1); // attempt 1 only
    expect(stepRow(r.runId!, "w")!.attempt).toBe(3); // attempt 2 refused (the counter ends one past the last attempt, as in E1)
    expect(String(stepRow(r.runId!, "w")!.error)).toMatch(gateErr("approvedByKeyHolder"));
  });

  it("★ saga compensation of an API run: approved by the holder ⇒ the compensation's OT write is refused too", async () => {
    await deployWorkflow(
      {
        ref: "api-comp",
        name: "api-comp",
        steps: [
          { id: "g", type: "hitl_gate", prompt: "p" },
          { id: "w", type: "command", machineId: 1, command: "start", compensation: { id: "undo", type: "command", machineId: 1, command: "reset" } },
        ],
      },
      CREATOR,
    );
    const r = await startedThenReissued("api-comp");
    expect((await resumeRun(r.runId!, { approved: true }, HOLDER)).status).toBe("failed");
    expect(String(stepRow(r.runId!, "undo")!.error)).toMatch(gateErr("approvedByKeyHolder"));
    expect(otDispatchMock).not.toHaveBeenCalled();
  });

  it("★ CONTINUE of an interrupted run re-derives: approved by OTHER, then the key is re-issued to OTHER ⇒ the rest is NOT sent (system and user continue)", async () => {
    const def: WorkflowDefinition = { ref: "api-intr", name: "api-intr", steps: [{ id: "g", type: "hitl_gate", prompt: "g" }, { id: "c1", type: "command", machineId: 1, command: "start" }, { id: "c2", type: "command", machineId: 1, command: "start" }] };
    await deployWorkflow(def, CREATOR);
    for (const continuer of [{ id: 0, role: "system", name: "FOE auto-resume" }, OTHER2]) {
      seedKeys(); // fresh key + history for each continuer (the previous loop re-issued the key to OTHER)
      otDispatchMock.mockClear();
      const r = await apiStart("api-intr");
      expect((await resumeRun(r.runId!, { approved: true }, OTHER)).status).toBe("completed");
      expect(otDispatchMock).toHaveBeenCalledTimes(2);
      const steps = fake.store.get("orchestration_run_steps")!;
      steps.splice(steps.findIndex((x: Row) => x.runId === r.runId && x.stepId === "c2"), 1);
      Object.assign(runRow(r.runId!), { status: "held", currentStepId: null, contextJson: { interrupted: true, startedViaApi: true }, finishedAt: null });
      reissue(OTHER.id);
      expect((await resumeRun(r.runId!, { approved: true, note: "continue" }, continuer)).status).toBe("failed");
      expect(otDispatchMock, `continued by ${continuer.id}`).toHaveBeenCalledTimes(2); // c2 NOT sent
      expect(String(stepRow(r.runId!, "c2")!.error)).toMatch(gateErr("approvedByKeyHolder"));
    }
  });

  it("★ L-7: STOPs of an API run go out with NO gate — identified key, unidentified run, key without holder", async () => {
    await deployWorkflow(
      { ref: "api-stop", name: "api-stop", steps: [{ id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }, { id: "os", type: "command", machineId: 1, command: "stop" }] },
      CREATOR,
    );
    expect((await apiStart("api-stop")).status).toBe("completed");
    expect((await startRun("api-stop", {}, API, { ownerUserId: STARTER.id, viaApi: true })).status).toBe("completed");
    keyRow().holderUserId = null;
    expect((await apiStart("api-stop")).status).toBe("completed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(3);
    expect(otDispatchMock).toHaveBeenCalledTimes(3);
    expect(otDispatchMock.mock.calls.every((c) => (c[0] as { commandType: string }).commandType === "stop")).toBe(true);
  });
});

describe("doc 81 Đợt 9 R2 — STOP path of the engine (L-7)", () => {
  it("★ an OT stop step after a gate the HOLDER approved: SENT (never refused), but its authorisation row carries NO gate approval", async () => {
    await deployWorkflow({ ref: "api-gstop", name: "api-gstop", steps: [{ id: "g", type: "hitl_gate", prompt: "p" }, { id: "os", type: "command", machineId: 1, command: "stop" }] }, CREATOR);
    const r = await startedThenReissued("api-gstop");
    expect((await resumeRun(r.runId!, { approved: true }, HOLDER)).status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(actions()).toHaveLength(1);
    // the holder's approval does not count ⇒ a self-confirmed row (the OT dispatcher accepts it only for a PINNED stop)
    expect(actions()[0].userRole).not.toBe("foe_gate_approver");
    expect(JSON.stringify(actions()[0].previewJson ?? {})).not.toContain("__foeGateApproval");
    // control: a second person's approval DOES bind the stop's row
    const r2 = await apiStart("api-gstop");
    expect((await resumeRun(r2.runId!, { approved: true }, OTHER)).status).toBe("completed");
    const row2 = actions().find((a) => a.userId === OTHER.id);
    expect(row2?.userRole).toBe("foe_gate_approver");
  });
});

describe("doc 81 Đợt 9 R4 — edge paths", () => {
  it("★ an EDGE re-execution of an API run (params copied, started as the real starter, no key recorded there) ⇒ refused (apiRun) whoever approves", async () => {
    await deployWorkflow(GATED_OT, CREATOR);
    const central = await apiStart("api-ot");
    const wfId = runRow(central.runId!).workflowId;
    // exactly what edgeRuntime.executeAssignedRun does (startRun as the starting principal, the central workflow id, params)
    const edge = await startRun("api-ot", { ...runRow(central.runId!).paramsJson }, { id: STARTER.id, role: "engineer", name: "edge-1" }, { workflowId: wfId });
    expect(runRow(edge.runId!).startedViaApiKeyId).toBeUndefined();
    expect((await resumeRun(edge.runId!, { approved: true }, OTHER)).status).toBe("failed");
    expect(String(stepRow(edge.runId!, "w")!.error)).toMatch(gateErr("apiRun"));
    expect(otDispatchMock).not.toHaveBeenCalled();
  });

  it("★ an edge SYNC (real syncRunResult) that wipes contextJson cannot turn the API run into a user run: the holder's approval still does not count", async () => {
    process.env.EDGE_RUNTIME_ENABLED = "true";
    try {
      await deployWorkflow(GATED_OT, CREATOR);
      const r = await startedThenReissued("api-ot");
      const { syncRunResult } = await import("../../edge/edgeCoordinator");
      const synced = await syncRunResult({ edgeNodeCode: "edge-1", runId: r.runId!, status: "awaiting_confirm", contextJson: { startedViaApi: false }, currentStepId: "g", steps: [] } as never);
      expect(synced.ok).toBe(true);
      expect(runRow(r.runId!).contextJson.startedViaApi).toBe(false);
      expect(runRow(r.runId!).startedViaApiKeyId).toBe(KEY); // untouched: the sync cannot name this column
      expect((await resumeRun(r.runId!, { approved: true }, HOLDER)).status).toBe("failed");
      expect(String(stepRow(r.runId!, "w")!.error)).toMatch(gateErr("approvedByKeyHolder"));
      expect(otDispatchMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.EDGE_RUNTIME_ENABLED;
    }
  });
});

describe("doc 81 Đợt 9 R2 — the dispatchers' DB layer (foeApprovalDbRefusal) re-derives the parties from the rows", () => {
  async function seedApprovedRun(runId: number, approvedBy: number, opts: { source?: string; keyId?: number | null; marker?: boolean } = {}) {
    await deployWorkflow(GATED_OT, CREATOR);
    const wf = (fake.store.get("orchestration_workflows") ?? [])[0] as Row;
    const digest = await computeBindingDigest(fake as never, wf.definitionJson);
    if (!fake.store.get("orchestration_runs")) fake.store.set("orchestration_runs", []);
    if (!fake.store.get("orchestration_run_steps")) fake.store.set("orchestration_run_steps", []);
    fake.store.get("orchestration_runs")!.push({
      id: runId,
      workflowId: wf.id,
      workflowRef: "api-ot",
      status: "running",
      paramsJson: opts.marker === false ? {} : { [FOE_API_RUN_PARAM]: true },
      contextJson: {},
      startedBy: STARTER.id,
      ...(opts.keyId === null ? {} : { startedViaApiKeyId: opts.keyId ?? KEY }),
    });
    fake.store.get("orchestration_run_steps")!.push({
      id: runId * 10,
      runId,
      stepId: "g",
      stepType: "hitl_gate",
      status: "completed",
      resultJson: { approved: true, approvedBy, approvalSource: opts.source ?? "server", defHash: hashWorkflowDefinition(wf.definitionJson), bindingDigest: digest },
    });
  }
  const pending = (runId: number, userId: number) => ({ userId, previewJson: { __foeGateApproval: { runId } } });

  it("★ confirmer = starter / holder now / earlier holder / creator ⇒ refused; a different user ⇒ accepted", async () => {
    reissue(HOLDER.id);
    for (const [i, u] of [STARTER, HOLDER, EARLIER, CREATOR].entries()) {
      await seedApprovedRun(900 + i, u.id);
      // the confirmer check names the reason itself (before the evaluation, which would refuse it too: two layers)
      expect(await foeApprovalDbRefusal(fake as never, pending(900 + i, u.id), STARTER.id), u.name).toMatch(
        u === STARTER ? /confirmed by the run owner/ : /confirmed by the holder or creator of the API key .*approvedByKeyHolder/,
      );
    }
    await seedApprovedRun(910, OTHER.id);
    expect(await foeApprovalDbRefusal(fake as never, pending(910, OTHER.id), STARTER.id)).toBeNull();
    // the action's requester must still be the run owner
    expect(await foeApprovalDbRefusal(fake as never, pending(910, OTHER.id), HOLDER.id)).toMatch(/requester is not the run owner/);
    // an edge-synced gate row by OTHER never counts (R-4-h)
    await seedApprovedRun(911, OTHER.id, { source: "edge" });
    expect(await foeApprovalDbRefusal(fake as never, pending(911, OTHER.id), STARTER.id)).toMatch(/noGate/);
  });

  it("★ the parties come from the ROWS, not from the action: an action naming a different approver changes nothing; key re-issued after the approval ⇒ refused", async () => {
    await seedApprovedRun(920, OTHER.id);
    const forged = { userId: OTHER.id, previewJson: { __foeGateApproval: { runId: 920, runOwner: 999, approvedBy: OTHER.id, keyParties: [] } } };
    expect(await foeApprovalDbRefusal(fake as never, forged, STARTER.id)).toBeNull();
    reissue(OTHER.id);
    expect(await foeApprovalDbRefusal(fake as never, forged, STARTER.id)).toMatch(/approvedByKeyHolder/);
  });

  it("★ fail-closed: no key recorded / key deleted ⇒ apiRun; key without holder ⇒ ownerUnknown; api_keys unreadable ⇒ refused", async () => {
    await seedApprovedRun(930, OTHER.id, { keyId: null });
    expect(await foeApprovalDbRefusal(fake as never, pending(930, OTHER.id), STARTER.id)).toMatch(/apiRun/);
    await seedApprovedRun(931, OTHER.id, { keyId: 4242 });
    expect(await foeApprovalDbRefusal(fake as never, pending(931, OTHER.id), STARTER.id)).toMatch(/apiRun/);
    keyRow().holderUserId = null;
    await seedApprovedRun(932, OTHER.id);
    expect(await foeApprovalDbRefusal(fake as never, pending(932, OTHER.id), STARTER.id)).toMatch(/ownerUnknown/);
    const realSelect = fake.select.bind(fake);
    const spy = vi.spyOn(fake, "select").mockImplementation(((p?: Record<string, unknown>) => {
      const b = realSelect(p);
      const from = b.from;
      b.from = (t: Record<symbol, unknown>) => {
        if (t[Symbol.for("drizzle:Name")] === "api_keys") throw new Error("connection terminated"); // the key read fails
        return from(t);
      };
      return b;
    }) as never);
    try {
      expect(await foeApprovalDbRefusal(fake as never, pending(932, OTHER.id), STARTER.id)).toMatch(/fail-closed/);
    } finally {
      spy.mockRestore();
    }
    // control: a USER run (no marker) never reads the key tables
    await seedApprovedRun(933, OTHER.id, { marker: false, keyId: null });
    expect(await foeApprovalDbRefusal(fake as never, pending(933, OTHER.id), STARTER.id)).toBeNull();
  });
});

describe("doc 81 Đợt 9 R3 — the approver's screen: getRun().apiKey", () => {
  it("names the key, who it is issued to, earlier holders, the creator, and every excluded user; a user run ⇒ null; unidentified ⇒ identified:false", async () => {
    await deployWorkflow(GATED_OT, CREATOR);
    const r = await startedThenReissued("api-ot");
    const v = await getRun(r.runId!, { bindingDigest: true });
    expect(v!.apiKey).toEqual({
      identified: true,
      keyId: KEY,
      name: "line-integration",
      keyPrefix: "ak_1a2b3c",
      holder: { id: HOLDER.id, name: HOLDER.name },
      creator: { id: CREATOR.id, name: CREATOR.name },
      earlierHolders: [
        { id: EARLIER.id, name: EARLIER.name },
        { id: STARTER.id, name: STARTER.name },
      ],
      excludedUserIds: [STARTER.id, CREATOR.id, HOLDER.id, EARLIER.id],
    });
    expect((await getRun(r.runId!))!.apiKey).toBeNull(); // not the approver's screen ⇒ not read
    const u = await startRun("api-ot", {}, CREATOR);
    expect((await getRun(u.runId!, { bindingDigest: true }))!.apiKey).toBeNull();
    const legacy = await startRun("api-ot", {}, API, { ownerUserId: STARTER.id, viaApi: true });
    expect((await getRun(legacy.runId!, { bindingDigest: true }))!.apiKey).toMatchObject({ identified: false, keyId: null, excludedUserIds: [] });
  });
});
