/**
 * doc 81 Đợt 10 task C — ONE WALKER, TWO STORES: PARITY.
 *
 * The same definitions are walked twice by the SAME engine code:
 *   • CENTRAL — startRun / resumeRun / abortRun against the (fake) database (foeRunStore.centralRunStore, the pre-Đợt-10 code);
 *   • EDGE    — driveEdgeRunFromPackage against an in-memory edge store (edge/edgeRunStore.ts): a package built from the same
 *               database rows, a fake journal (the run-stream records it would ship) and a fake /authorize that decides exactly
 *               like central (findSeparateGateApproval over the same rows). Central then APPLIES the edge's records and its
 *               segment end with the exports group B calls (recordEdgeStepRows / applyEdgeSegmentEnd), and approves gates with
 *               the real resumeRun (edge branch: hand back to 'queued').
 * Required identical: the step-row sequence (stepId, status, attempt, result kind) the walker writes, the run outcome
 * sequence, the commands that reach the equipment, and the FINAL rows central holds for the two runs. Cases: gate pause,
 * branch, parallel, retry, compensation, abort sweep (+ the gate refusal text, the STOP that never asks, D5 held).
 * The equipment registry is replaced by a recording fake (the walker is under test, not the dispatchers — group D).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const h = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  failPlan: new Map<string, number>(), // stepId → how many attempts fail (Infinity ⇒ always)
  telemetry: [] as Array<{ key: string; value: unknown }>,
}));

vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return { isStopCommandType: orig.isStopCommandType, classifyOtStop: orig.classifyOtStop, runningConnectionMatchesAdapterRow: async () => true, dispatch: vi.fn() };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: vi.fn() }));
vi.mock("../../auditTrailService", () => ({ createAuditContext: (x: unknown) => x, logCrudOperation: vi.fn(async () => ({ id: 1 })) }));
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return { ...orig, resolveUserFoeScope: () => null };
});
/** the equipment: a recording fake (per-step failure plan; the idempotency key names the step and attempt) */
vi.mock("../../equipment/equipmentAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../equipment/equipmentAdapter")>();
  const adapter = (kind: string) => ({
    async sendCommand(cmd: Record<string, any>) {
      const m = /^run\d+-(.+)-a(\d+)$/.exec(String(cmd.idempotencyKey)) ?? /^run\d+-abort-[^-]+-(.+)$/.exec(String(cmd.idempotencyKey));
      const stepId = m ? m[1] : "?";
      h.sent.push({ kind, stepId, name: cmd.name, adapterId: cmd.adapterId ?? null, robotId: cmd.robotId ?? null, writes: cmd.writes ?? null, job: cmd.job ?? null, edge: cmd.edge ?? null, hitl: cmd.hitl });
      const left = h.failPlan.get(stepId) ?? 0;
      if (left > 0) {
        h.failPlan.set(stepId, left - 1);
        return { ok: false, status: "rejected", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: `scripted failure of ${stepId}` };
      }
      return { ok: true, status: "simulated", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", detail: { simulated: true } };
    },
    async getState() {
      return { state: "EXECUTE" };
    },
    async readTelemetry() {
      return h.telemetry;
    },
  });
  return { ...orig, equipmentRegistry: { getAdapter: (kind: string) => adapter(kind) } };
});

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

import { orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows, machines, deviceAdapters, deviceTags, robots } from "../../../../drizzle/schema";
import { runEdgeAssignments } from "../../edge/edgeExecutionSchema";
import {
  deployWorkflow,
  startRun,
  resumeRun,
  abortRun,
  getRun,
  hashWorkflowDefinition,
  driveEdgeRunFromPackage,
  stopLiveRunForCentralAbort,
  recordEdgeStepRows,
  applyEdgeSegmentEnd,
  edgePriorPictureOf,
  FOE_GATE_REQUIRED,
} from "./foeEngine";
import { findSeparateGateApproval, withResolvedAdapter } from "./foeRunStore";
import { verifiedStopStepIds } from "./foeStepClass";
import { createEdgeRunStore, type EdgeRunRecordIn, type EdgeStepAuthorizeOutcome, type EdgeStepAuthorizeRequest } from "../../edge/edgeRunStore";
import type { EdgeRunPackage } from "../../edge/edgeProtocol";
import type { MachineForValidation, WorkflowDefinition, WorkflowStep } from "./workflowModel";

type Row = Record<string, any>;
const OWNER = { id: 10, role: "engineer", name: "owner" };
const OTHER = { id: 12, role: "supervisor", name: "other" };
const T0 = new Date("2026-10-01T00:00:00Z");
const NODE = 7;

const rows = (t: string): Row[] => fake.store.get(t) ?? [];
const runRow = (id: number): Row => rows("orchestration_runs").find((r) => r.id === id)!;
const stepRows = (id: number): Row[] => rows("orchestration_run_steps").filter((s) => s.runId === id);

/** the central step-row WRITES (upsertStep ⇔ insert … onConflictDoUpdate on orchestration_run_steps), per run, in order */
const centralWrites = new Map<number, Array<{ stepId: string; status: string; attempt: number; result: string }>>();
const statusWrites = new Map<number, string[]>();
const resultKind = (r: unknown): string => {
  const v = r as Record<string, unknown> | null | undefined;
  if (v == null) return "-";
  if (typeof v.branch === "string") return `branch:${v.branch}`;
  if (typeof v.abortStop === "string") return `abort:${v.abortStop}`;
  if (typeof v.routedTo === "string") return `dispatch:${v.accepted === true ? "ok" : "refused"}`;
  if ("prompt" in v) return "gate";
  if ("approved" in v) return "approval";
  return Object.keys(v).sort().join(",");
};

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "ROBOT", capabilities: null, code: "R1", name: "Robot-1", operationStatus: "stopped", stationId: 1 },
  ]);
  fake.seed(deviceAdapters, [{ id: 501, machineId: 1, isEnabled: true, updatedAt: T0, protocol: "stub", code: "A501" }]);
  fake.seed(deviceTags, [
    { id: 71, adapterId: 501, tagKey: "run", address: "40001", dataType: "int16", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true },
    { id: 72, adapterId: 501, tagKey: "speed", address: "40002", dataType: "int16", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true },
  ]);
  fake.seed(robots, [{ id: 2, code: "R2", vendor: "sim", endpoint: "tcp://10.0.0.2:1", connectionOptions: { port: 1 }, isEnabled: true, status: "online", updatedAt: T0 }]);
  h.sent.length = 0;
  h.failPlan.clear();
  h.telemetry = [{ key: "temp", value: 80 }];
  centralWrites.clear();
  statusWrites.clear();
  // record every central step-row write and run-status write (the walker's store calls on the central side)
  const insert = FakeDb.prototype.insert.bind(fake);
  (fake as any).insert = (t: any) => {
    const b = insert(t);
    if (t?.[Symbol.for("drizzle:Name")] !== "orchestration_run_steps") return b;
    const values = b.values.bind(b);
    b.values = (v: Row) => {
      const list = centralWrites.get(v.runId) ?? [];
      list.push({ stepId: v.stepId, status: v.status, attempt: v.attempt ?? 0, result: resultKind(v.resultJson) });
      centralWrites.set(v.runId, list);
      return values(v);
    };
    return b;
  };
  const update = FakeDb.prototype.update.bind(fake);
  (fake as any).update = (t: any) => {
    const b = update(t);
    if (t?.[Symbol.for("drizzle:Name")] !== "orchestration_runs") return b;
    let status: unknown;
    const set = b.set.bind(b);
    b.set = (v: Row) => {
      status = v.status;
      set(v);
      return b;
    };
    const where = b.where.bind(b);
    b.where = (c: any) => {
      if (typeof status === "string") {
        for (const r of rows("orchestration_runs").filter((x) => (typeof c === "function" ? c(x) : true))) statusWrites.set(r.id, [...(statusWrites.get(r.id) ?? []), status as string]);
      }
      return where(c);
    };
    return b;
  };
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
  delete process.env.AVI_PROCESS_ROLE;
});

// ── definitions ─────────────────────────────────────────────────────────────────────────────────────────────────────
const gate = (id = "g1"): WorkflowStep => ({ id, type: "hitl_gate", prompt: `approve ${id}` }) as never;
const ot = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "start", args: { tagKey: "run", value: 1 }, ...extra }) as never;
const move = (id: string, extra: Record<string, unknown> = {}): WorkflowStep =>
  ({ id, type: "command", machineId: 2, command: "run_job", args: { robotId: 2, jobType: "move", params: { x: 1 } }, ...extra }) as never;
const robotStop = (id: string): WorkflowStep => ({ id, type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }) as never;
const def = (ref: string, steps: WorkflowStep[]): WorkflowDefinition => ({ ref, name: ref, steps }) as never;

// ── the central walk ────────────────────────────────────────────────────────────────────────────────────────────────
async function centralRun(d: WorkflowDefinition, approveGates: number): Promise<number> {
  expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
  const s = await startRun(d.ref, {}, OWNER);
  const runId = s.runId!;
  for (let i = 0; i < approveGates && runRow(runId).status === "awaiting_confirm"; i++) {
    const view = (await getRun(runId, { bindingDigest: true }))!;
    await resumeRun(runId, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  }
  return runId;
}

// ── the edge walk ───────────────────────────────────────────────────────────────────────────────────────────────────
interface EdgeHarness {
  runId: number;
  /** the walker's run-status calls on the edge stores of every segment (central only applies the segment END) */
  statuses: string[];
  records: EdgeRunRecordIn[];
  authorizeCalls: EdgeStepAuthorizeRequest[];
  /** unavailable from this authorize call on (D5) */
  offline: boolean;
  /** "stopped" answered by central from now on */
  stopped: boolean;
}

/** central's edge assignment (startRun with edgeNodeId) — created 'queued' + its assignment row */
async function edgeAssignedRun(d: WorkflowDefinition): Promise<EdgeHarness> {
  expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
  const s = await startRun(d.ref, {}, OWNER, { edgeNodeId: NODE });
  expect(s.ok).toBe(true);
  return { runId: s.runId!, statuses: [], records: [], authorizeCalls: [], offline: false, stopped: false };
}

/** B's claim: 'queued' → 'running' + the signed package (built here from the same rows — no signature in a unit test) */
async function claimPackage(x: EdgeHarness, claimSeq: number): Promise<EdgeRunPackage> {
  const run = runRow(x.runId);
  run.status = "running";
  const [a] = rows("orchestration_run_edge_assignments").filter((r) => r.runId === x.runId);
  a.claimSeq = claimSeq;
  const wf = rows("orchestration_workflows").find((w) => w.id === run.workflowId)!;
  const d = wf.definitionJson as WorkflowDefinition;
  const mrows = rows("machines");
  const machineMap = new Map<number, MachineForValidation>(mrows.map((m) => [m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities }] as const));
  const v = await verifiedStopStepIds(d, machineMap, null);
  const resolved: Array<{ stepId: string; adapterId: number }> = [];
  const all = (steps: WorkflowStep[] | undefined): WorkflowStep[] => (steps ?? []).flatMap((s) => [s, ...all((s as any).steps), ...all((s as any).then), ...all((s as any).else), ...(s.compensation ? all([s.compensation]) : [])]);
  for (const s of all(d.steps)) {
    if (s.type !== "command" || s.machineId !== 1) continue;
    const args = await withResolvedAdapter("ot-opcua", 1, (s.args ?? {}) as Record<string, unknown>);
    if (typeof args.adapterId === "number") resolved.push({ stepId: s.id, adapterId: args.adapterId });
  }
  return {
    kind: "run_package",
    runId: x.runId,
    nodeId: NODE,
    credentialId: 1,
    defHash: hashWorkflowDefinition(d),
    definition: d as never,
    machines: mrows.map((m) => ({ id: m.id, machineType: m.machineType, capabilities: m.capabilities })),
    verifiedStops: [...v.ids].map((stepId) => ({ kind: "robot" as const, stepId, robotId: 2 })),
    stopsUnsure: [...v.unsure],
    prior: edgePriorPictureOf(stepRows(x.runId)),
    issuedAt: Date.now(),
    claimSeq,
    workflowId: run.workflowId,
    workflowVersion: wf.version ?? 1,
    params: (run.paramsJson as Record<string, unknown>) ?? {},
    context: (run.contextJson as Record<string, unknown>) ?? {},
    owner: { id: OWNER.id, role: OWNER.role },
    startedViaApi: false,
    resolvedAdapters: resolved,
    approvals: [],
    bindingDigest: null,
  } as unknown as EdgeRunPackage;
}

/** the fake /authorize: central's own gate rule over the same rows (B's edgeAuthorizeCentral decides with it too) */
function fakeAuthorize(x: EdgeHarness, d: WorkflowDefinition) {
  return {
    async authorize(input: EdgeStepAuthorizeRequest): Promise<EdgeStepAuthorizeOutcome> {
      x.authorizeCalls.push(input);
      if (x.offline) return { ok: false, verdict: "unavailable", code: "network" };
      if (x.stopped) return { ok: false, verdict: "stopped", code: "stopped" };
      const found = await findSeparateGateApproval({ runId: x.runId, def: d, startedViaApi: false });
      if ("reason" in found) return { ok: false, verdict: "refused", code: "gate_required", reason: found.reason };
      return {
        ok: true,
        authorization: { typ: "avi-edge-auth+v1", alg: "EdDSA", kid: "edk_test", payload: "{}", sig: "x" } as never,
        claims: { jti: randomUUID(), approval: { approvedBy: found.approval.approvedBy, gateStepId: found.approval.gateStepId } },
        ttlMs: 10_000,
        reqNonce: randomUUID().replace(/-/g, ""),
        requestSentMonoMs: performance.now(),
      };
    },
  };
}

/** one segment on the edge, then central applies its records + its end (group B's endpoints call exactly these) */
async function edgeSegment(x: EdgeHarness, claimSeq: number, opts: { beforeEnd?: (drive: Promise<unknown>) => Promise<void> } = {}) {
  const pkg = await claimPackage(x, claimSeq);
  const d = pkg.definition as unknown as WorkflowDefinition;
  const from = x.records.length;
  const store = createEdgeRunStore(pkg, {
    runId: x.runId,
    claimSeq,
    claimToken: "ect_" + "a".repeat(43),
    sink: {
      async run(_runId, _claim, rec) {
        x.records.push(rec);
        return { seq: x.records.length, durable: true };
      },
      async event() {
        return { seq: 1, durable: true };
      },
    },
    consume: { admitNonStop: () => true },
    authorize: fakeAuthorize(x, d),
  });
  const drive = driveEdgeRunFromPackage(pkg, { runId: x.runId, claimSeq, claimToken: "ect_" + "a".repeat(43) }, store);
  if (opts.beforeEnd) await opts.beforeEnd(drive);
  const out = (await drive) as Record<string, any>;
  x.statuses.push(...store.statusLog());
  // central applies the reported rows (step / abort_stop / context) — as edgeReportsCentral does — and the segment end
  const seg = x.records.slice(from);
  const write = seg.filter((r) => r.kind === "step" || r.kind === "abort_stop").map((r: any) =>
    r.kind === "step"
      ? { stepId: r.stepId, stepType: r.stepType, status: r.status, attempt: r.attempt, startedAt: r.startedAt == null ? null : new Date(r.startedAt), finishedAt: r.finishedAt == null ? null : new Date(r.finishedAt), error: r.error, result: r.result ?? undefined }
      : { stepId: `abort:${r.stepId}`, stepType: "command", status: r.status, attempt: 0, startedAt: new Date(r.at), finishedAt: new Date(r.at), error: null, result: { ...(r.result ?? {}), stepId: r.stepId } },
  );
  await recordEdgeStepRows(fake as never, x.runId, write);
  for (const r of seg) if (r.kind === "context") Object.assign(runRow(x.runId).contextJson ?? (runRow(x.runId).contextJson = {}), Object.fromEntries(Object.entries(r.patch).filter(([k]) => !/^(foeRejectClaim|interrupted|edge)/.test(k))));
  if (out.outcome) await applyEdgeSegmentEnd(fake as never, x.runId, { ...(out as any), nodeCode: "EDGE-A", claimSeq, def: d });
  return { out, segment: seg };
}

async function approveEdgeGate(x: EdgeHarness) {
  const view = (await getRun(x.runId, { bindingDigest: true }))!;
  const r = await resumeRun(x.runId, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  expect(r.status).toBe("queued"); // the edge branch hands the run back to its node
}

// ── comparison helpers ──────────────────────────────────────────────────────────────────────────────────────────────
/** the walker's own step-row writes, comparable: (stepId, status, attempt, result kind); gate rows are central's on both sides */
const walkerWritesCentral = (runId: number) => (centralWrites.get(runId) ?? []).filter((w) => !rows("orchestration_run_steps").some((s) => s.runId === runId && s.stepId === w.stepId && s.stepType === "hitl_gate"));
const walkerWritesEdge = (x: EdgeHarness) =>
  x.records
    .filter((r) => r.kind === "step" || r.kind === "abort_stop")
    .map((r: any) => (r.kind === "step" ? { stepId: r.stepId, status: r.status, attempt: r.attempt, result: resultKind(r.result) } : { stepId: `abort:${r.stepId}`, status: r.status, attempt: 0, result: resultKind(r.result) }));
const finalRows = (runId: number) =>
  Object.fromEntries(
    stepRows(runId)
      .map((s) => [s.stepId, { status: s.status, attempt: s.attempt, type: s.stepType, result: resultKind(s.resultJson), error: s.error ? String(s.error).replace(/run\d+/g, "run#") : null }] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
/**
 * The commands that reached the equipment. The HITL provenance of a command WITH an approval (requestedBy = the run owner,
 * confirmedBy = the gate approver) is compared; a STOP has none: its provenance is the walker's principal — on central the
 * user who resumed the run (the approver), on the edge the run's owner (as in Đợt 9 S3) — informational only (a STOP is never
 * verified against it), so it is left out (recorded in group-C-report.md).
 */
const sentCommands = (from = 0, to?: number) =>
  h.sent.slice(from, to).map((c) => {
    const stop = c.name === "abort" || c.name === "e_stop" || c.name === "stop";
    return { kind: c.kind, stepId: c.stepId, name: c.name, adapterId: c.adapterId, robotId: c.robotId, writes: c.writes, job: c.job, ...(stop ? {} : { confirmedBy: (c.hitl as any)?.confirmedBy, requestedBy: (c.hitl as any)?.requestedBy }) };
  });
const outcomeTransitions = (list: string[]) => list.filter((s) => s !== "running" && s !== "queued");
const perStep = (ws: Array<{ stepId: string }>) => {
  const m = new Map<string, unknown[]>();
  for (const w of ws) m.set(w.stepId, [...(m.get(w.stepId) ?? []), w]);
  return Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
};

async function waitFor(fn: () => boolean, label: string, ms = 5_000) {
  const until = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > until) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("doc 81 Đợt 10 C — one walker, two stores: central and edge produce the same rows and outcomes", () => {
  it("★ gate pause → approval → motion (OT + robot) → completed: identical walker writes, outcomes, commands and final rows", async () => {
    const d = (ref: string) => def(ref, [gate(), ot("m1"), move("r1"), robotStop("s1")]);
    const c = await centralRun(d("gp-c"), 1);
    const cSent = sentCommands();
    const n0 = h.sent.length;

    const e = await edgeAssignedRun(d("gp-e"));
    const s1 = await edgeSegment(e, 1);
    expect(s1.out).toMatchObject({ outcome: "paused", gateStepId: "g1" });
    expect(runRow(e.runId).status).toBe("awaiting_confirm");
    expect(runRow(e.runId).currentStepId).toBe("g1");
    // the gate row central writes for a paused edge segment is the walker's own gate row
    expect(stepRows(e.runId).find((s) => s.stepId === "g1")).toMatchObject({ status: "awaiting_confirm", resultJson: { prompt: "approve g1", approverRoles: null } });
    await approveEdgeGate(e);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ ok: true, outcome: "completed", status: "completed" });

    expect(runRow(c).status).toBe("completed");
    expect(runRow(e.runId).status).toBe("completed");
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(cSent);
    expect(outcomeTransitions(statusWrites.get(e.runId) ?? [])).toEqual(outcomeTransitions(statusWrites.get(c) ?? []));
    expect(outcomeTransitions(e.statuses)).toEqual(outcomeTransitions(statusWrites.get(c) ?? []));
    // ★ L-7 — the STOP (s1) never asked central; m1 / r1 asked once each, with the payload hash of the exact command
    expect(e.authorizeCalls.map((a) => a.stepId)).toEqual(["m1", "r1"]);
    // the edge commands carry their signed authorisation (D verifies it); the STOP carries none
    const edgeSent = h.sent.slice(n0);
    expect((edgeSent.find((s) => s.stepId === "m1")!.edge as any).authorization.stepId).toBe("m1");
    expect((edgeSent.find((s) => s.stepId === "s1")!.edge as any).authorization).toBeNull();
    // every non-STOP result row quotes the jti it ran under; the STOP's quotes none
    const resultRow = (id: string) => e.records.filter((r: any) => r.kind === "step" && r.stepId === id && r.status === "completed")[0] as any;
    expect(resultRow("m1").jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(resultRow("s1").jti).toBeNull();
  });

  it("★ a non-STOP step with no counting gate: the SAME FOE_GATE_REQUIRED(noGate) refusal on both stores, nothing sent", async () => {
    const d = (ref: string) => def(ref, [ot("m1")]);
    const c = await centralRun(d("ng-c"), 0);
    const e = await edgeAssignedRun(d("ng-e"));
    const s1 = await edgeSegment(e, 1);
    expect(s1.out).toMatchObject({ outcome: "failed" });
    expect(String(runRow(c).error)).toMatch(new RegExp(`^${FOE_GATE_REQUIRED}\\(noGate\\)`));
    expect(stepRows(e.runId).find((s) => s.stepId === "m1")!.error).toBe(stepRows(c).find((s) => s.stepId === "m1")!.error);
    expect(h.sent).toEqual([]);
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
  });

  it("★ branch: the condition read the same way, the same path taken, the decision recorded on both", async () => {
    const br = (ref: string) =>
      def(ref, [gate(), { id: "b1", type: "branch", condition: { source: "telemetry", machineId: 1, key: "temp", op: "gt", value: 50 }, then: [ot("t1")], else: [move("e1")] } as never]);
    const c = await centralRun(br("br-c"), 1);
    const n0 = h.sent.length;
    const e = await edgeAssignedRun(br("br-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await edgeSegment(e, 2);
    expect(stepRows(c).find((s) => s.stepId === "b1")!.resultJson).toEqual({ branch: "then" });
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(sentCommands(0, n0));
    expect(runRow(e.runId).contextJson["branch:b1"]).toBe("then");
  });

  it("★ parallel: per-step write sequences, final rows and the command set are identical", async () => {
    const par = (ref: string) => def(ref, [gate(), { id: "p1", type: "parallel", steps: [ot("m1"), move("r1"), ot("m2", { args: { tagKey: "speed", value: 5 } })] } as never]);
    const c = await centralRun(par("par-c"), 1);
    const n0 = h.sent.length;
    const e = await edgeAssignedRun(par("par-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await edgeSegment(e, 2);
    expect(perStep(walkerWritesEdge(e))).toEqual(perStep(walkerWritesCentral(c)));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    const sortSent = (l: ReturnType<typeof sentCommands>) => [...l].sort((a, b) => (a.stepId < b.stepId ? -1 : 1));
    expect(sortSent(sentCommands(n0))).toEqual(sortSent(sentCommands(0, n0)));
    expect(runRow(e.runId).status).toBe("completed");
  });

  it("★ retry: a refused first attempt is retried — attempt 2 authorised separately on the edge, rows identical", async () => {
    const rt = (ref: string) => def(ref, [gate(), ot("m1", { maxAttempts: 2 })]);
    h.failPlan.set("m1", 1);
    const c = await centralRun(rt("rt-c"), 1);
    const n0 = h.sent.length;
    h.failPlan.set("m1", 1);
    const e = await edgeAssignedRun(rt("rt-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await edgeSegment(e, 2);
    expect(stepRows(c).find((s) => s.stepId === "m1")).toMatchObject({ status: "completed", attempt: 2 });
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(sentCommands(0, n0));
    expect(e.authorizeCalls.map((a) => `${a.stepId}#${a.attempt}`)).toEqual(["m1#1", "m1#2"]);
    expect(new Set(e.authorizeCalls.map((a) => a.idempotencyKey)).size).toBe(2);
  });

  it("★ compensation: the failing step's compensation runs (compensating → failed) — rows, outcomes and commands identical", async () => {
    const cp = (ref: string) => def(ref, [gate(), move("r1", { compensation: ot("c1", { args: { tagKey: "speed", value: 0 } }) })]);
    h.failPlan.set("r1", Infinity);
    const c = await centralRun(cp("cp-c"), 1);
    const n0 = h.sent.length;
    const e = await edgeAssignedRun(cp("cp-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "failed" });
    expect(runRow(c).status).toBe("failed");
    expect(runRow(e.runId).status).toBe("failed");
    expect(stepRows(c).find((s) => s.stepId === "c1")!.status).toBe("compensated");
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(sentCommands(0, n0));
    expect(outcomeTransitions(statusWrites.get(c) ?? [])).toEqual(["awaiting_confirm", "compensating", "failed"]);
    // the walker's run-status sequence is the same on the edge (central sees the END of the segment: failed)
    expect(outcomeTransitions(e.statuses)).toEqual(["awaiting_confirm", "compensating", "failed"]);
  });

  it("★ abort sweep: aborted mid-delay ⇒ the next motion is never sent, the remaining STOP is sent once — same rows on both", async () => {
    const ab = (ref: string) => def(ref, [gate(), move("r1"), { id: "d1", type: "delay", ms: 60_000 } as never, move("r2"), robotStop("s1")]);
    // central: the walk resumes in the background, is aborted while it sleeps in d1
    const cRef = "ab-c";
    expect((await deployWorkflow(ab(cRef), OWNER)).ok).toBe(true);
    const c = (await startRun(cRef, {}, OWNER)).runId!;
    const view = (await getRun(c, { bindingDigest: true }))!;
    const resuming = resumeRun(c, { approved: true, expectedStepId: "g1", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => stepRows(c).some((s) => s.stepId === "d1" && s.status === "running"), "central d1 running");
    const ar = await abortRun(c, OWNER, "parity");
    await resuming;
    expect(ar.abortStops).toMatchObject({ sent: ["s1"], failed: [], unverified: [], notNeeded: [] });
    const n0 = h.sent.length;

    // edge: the same walk, stopped by central while it sleeps in d1 (the agent's abortLive ⇒ stopLiveRunForCentralAbort)
    const e = await edgeAssignedRun(ab("ab-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await edgeSegment(e, 2, {
      beforeEnd: async () => {
        await waitFor(() => e.records.some((r: any) => r.kind === "step" && r.stepId === "d1" && r.status === "running"), "edge d1 running");
        runRow(e.runId).status = "aborted"; // central's abort (its own sweep cannot reach the edge's devices)
        const live = await stopLiveRunForCentralAbort(e.runId, { id: 0, role: "system", name: "edge: central abort" });
        expect(live.live).toBe(true);
        expect(live.abortStops).toMatchObject({ sent: ["s1"], failed: [], unverified: [], notNeeded: [] });
      },
    });
    expect(h.sent.filter((s) => s.stepId === "r2")).toEqual([]); // never sent, on either side
    expect(sentCommands(n0).map((s) => s.stepId)).toEqual(sentCommands(0, n0).map((s) => s.stepId));
    expect(sentCommands(n0).map((s) => s.stepId)).toEqual(["r1", "s1"]);
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(stepRows(e.runId).find((s) => s.stepId === "abort:s1")).toMatchObject({ status: "completed" });
    expect(runRow(e.runId).status).toBe("aborted");
  });
});

describe("doc 81 Đợt 10 C — the edge store's own verdicts (no central counterpart)", () => {
  it("★ D5: central unreachable at a non-STOP step ⇒ HELD (nothing sent, no compensation); a STOP before it still goes out", async () => {
    const hd = (ref: string) => def(ref, [gate(), robotStop("s0"), move("r1", { compensation: ot("c1") })]);
    const e = await edgeAssignedRun(hd("hd-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.offline = true;
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "centralUnreachable" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["s0"]); // the STOP never asked; r1 / c1 never sent
    expect(stepRows(e.runId).find((s) => s.stepId === "r1")).toMatchObject({ status: "held" });
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r1")!.error)).toMatch(/^EDGE_HELD\(centralUnreachable\)/);
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toBeUndefined();
    expect(runRow(e.runId).status).toBe("held");
  });

  it("★ central says 'stopped' at authorize ⇒ the walker aborts locally (no non-STOP sent) and sweeps its STOPs", async () => {
    const st = (ref: string) => def(ref, [gate(), move("r1"), move("r2"), robotStop("s1")]);
    const e = await edgeAssignedRun(st("st-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    const n0 = h.sent.length;
    // r1 goes; central stops the run before r2's authorisation
    const pkg2 = await claimPackage(e, 2);
    const central = fakeAuthorize(e, pkg2.definition as never);
    let calls = 0;
    const store = createEdgeRunStore(pkg2, {
      runId: e.runId,
      claimSeq: 2,
      claimToken: "ect_" + "a".repeat(43),
      sink: { run: async (_r, _c, rec) => (e.records.push(rec), { seq: e.records.length }) },
      authorize: { authorize: async (i) => (++calls === 2 ? { ok: false as const, verdict: "stopped" as const, code: "stopped" } : central.authorize(i)) },
    });
    const s2 = (await driveEdgeRunFromPackage(pkg2, { runId: e.runId, claimSeq: 2 }, store)) as Record<string, any>;
    await waitFor(() => h.sent.slice(n0).some((s) => s.stepId === "s1"), "sweep sent s1");
    expect(s2).toMatchObject({ outcome: "aborted" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r1", "s1"]);
  });

  it("★ the walker refuses a package that is not the assigned snapshot / not this claim (nothing walked)", async () => {
    const e = await edgeAssignedRun(def("rf-e", [gate(), ot("m1")]));
    const pkg = await claimPackage(e, 1);
    const store = createEdgeRunStore(pkg, { runId: e.runId, claimSeq: 1, claimToken: "ect_" + "a".repeat(43), sink: { run: async () => ({ seq: 1 }) }, authorize: fakeAuthorize(e, pkg.definition as never) });
    expect(((await driveEdgeRunFromPackage({ ...pkg, defHash: "0".repeat(64) }, { runId: e.runId, claimSeq: 1 }, store)) as any).refused).toMatch(/snapshot/);
    expect(((await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 2 }, store)) as any).refused).toMatch(/claim/);
    expect(((await driveEdgeRunFromPackage({ ...pkg, owner: null }, { runId: e.runId, claimSeq: 1 }, store)) as any).refused).toMatch(/owner/);
    expect(h.sent).toEqual([]);
  });
});

describe("doc 81 Đợt 10 C — the edge store in detail (no DB, fail-closed)", () => {
  const io = (x: Partial<{ records: EdgeRunRecordIn[]; authorize: (i: EdgeStepAuthorizeRequest) => Promise<EdgeStepAuthorizeOutcome>; admit: boolean; dropped: boolean }> = {}) => {
    const records = x.records ?? [];
    return {
      records,
      io: {
        runId: 0,
        claimSeq: 1,
        claimToken: "ect_" + "b".repeat(43),
        sink: {
          run: async (_r: number, _c: number, rec: EdgeRunRecordIn) => {
            if (x.dropped) return { seq: null, dropped: true as const, reason: "journal_full" };
            records.push(rec);
            return { seq: records.length };
          },
        },
        consume: { admitNonStop: () => x.admit ?? true },
        authorize: { authorize: x.authorize ?? (async (): Promise<EdgeStepAuthorizeOutcome> => ({ ok: false, verdict: "unavailable", code: "network" })) },
      },
    };
  };
  async function pkgOf(steps: WorkflowStep[], ref: string) {
    const e = await edgeAssignedRun(def(ref, steps));
    return { e, pkg: await claimPackage(e, 1) };
  }

  it("★ the authorise request carries the EXACT command and the canonical payload hash central binds (OT and robot)", async () => {
    const e = await edgeAssignedRun(def("hash-e", [gate(), ot("m1"), move("r1")]));
    await edgeSegment(e, 1); // paused at g1
    await approveEdgeGate(e);
    const pkg2 = await claimPackage(e, 2);
    const t = io();
    const seen: EdgeStepAuthorizeRequest[] = [];
    const central = fakeAuthorize(e, pkg2.definition as never);
    const store = createEdgeRunStore(pkg2, { ...t.io, runId: e.runId, claimSeq: 2, authorize: { authorize: async (i) => (seen.push(i), central.authorize(i)) } });
    await driveEdgeRunFromPackage(pkg2, { runId: e.runId, claimSeq: 2 }, store);
    const { otPayloadHash, robotPayloadHash, FOE_ENGINE_TOOL } = await import("../../ot/otActionBinding");
    expect(seen[0]).toMatchObject({ stepId: "m1", attempt: 1, idempotencyKey: `run${e.runId}-m1-a1`, command: { kind: "ot", adapterId: 501, machineId: 1, commandType: "start", writes: [{ tagKey: "run", value: 1 }] } });
    expect(seen[0].payloadHash).toBe(otPayloadHash({ tool: FOE_ENGINE_TOOL, adapterId: 501, machineId: 1, commandType: "start", writes: [{ tagKey: "run", value: 1 }] }));
    expect(seen[1]).toMatchObject({ stepId: "r1", command: { kind: "robot", robotId: 2, jobType: "move", params: { x: 1 } } });
    expect(seen[1].payloadHash).toBe(robotPayloadHash({ robotId: 2, jobType: "move", params: { x: 1 } }));
    expect(seen.every((s) => s.claimSeq === 2 && s.claimToken === t.io.claimToken && s.runId === e.runId)).toBe(true);
    // the approval central signed is the command's HITL provenance (requestedBy = owner, confirmedBy = approver)
    expect(h.sent.find((s) => s.stepId === "m1")!.hitl).toMatchObject({ requestedBy: OWNER.id, confirmedBy: OTHER.id });
  });

  it("★ verdict mapping: device refusal / payload mismatch fail the step with a machine-readable code; journal full and no config HOLD", async () => {
    const { e, pkg } = await pkgOf([ot("m1")], "map-e");
    const run = async (out: EdgeStepAuthorizeOutcome, opts: { admit?: boolean } = {}) => {
      const t = io({ authorize: async () => out, admit: opts.admit });
      const store = createEdgeRunStore(pkg, { ...t.io, runId: e.runId });
      const r = (await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)) as Record<string, any>;
      const row = t.records.filter((x: any) => x.kind === "step" && x.stepId === "m1").pop() as any;
      return { r, row };
    };
    const dev = await run({ ok: false, verdict: "refused", code: "device_refused", reason: "motion_locked" });
    expect(dev.r).toMatchObject({ outcome: "failed" });
    expect(dev.row).toMatchObject({ status: "failed" });
    expect(dev.row.error).toMatch(/^EDGE_DEVICE_REFUSED\(motion_locked\): command step "m1" was not sent/);
    const pm = await run({ ok: false, verdict: "refused", code: "payload_mismatch" });
    expect(pm.row.error).toMatch(/^EDGE_AUTHORIZE_REFUSED\(payload_mismatch\)/);
    const gr = await run({ ok: false, verdict: "refused", code: "gate_required", reason: "staleApproval" });
    expect(gr.row.error).toMatch(new RegExp(`^${FOE_GATE_REQUIRED}\\(staleApproval\\)`));
    const full = await run({ ok: false, verdict: "refused", code: "x" }, { admit: false });
    expect(full.r).toMatchObject({ outcome: "held", heldReason: "journalFull" });
    expect(full.row.error).toMatch(/^EDGE_HELD\(journalFull\)/);
    const nocfg = await run({ ok: false, verdict: "unavailable", code: "no_config" });
    expect(nocfg.r).toMatchObject({ outcome: "held", heldReason: "configStale" });
    const thrown = createEdgeRunStore(pkg, {
      ...io().io,
      runId: e.runId,
      authorize: {
        authorize: async () => {
          throw new Error("socket hang up");
        },
      },
    });
    expect(await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, thrown)).toMatchObject({ outcome: "held", heldReason: "centralUnreachable" });
    expect(h.sent).toEqual([]); // ★ nothing reached the equipment in any of them
  });

  it("★ stale claim ⇒ the walker lets go: nothing more sent, no segment end (refused + detached)", async () => {
    const { e, pkg } = await pkgOf([ot("m1"), robotStop("s1")], "stale-e");
    const t = io({ authorize: async () => ({ ok: false, verdict: "stale", code: "claim_stale", abortRequested: false }) });
    const store = createEdgeRunStore(pkg, { ...t.io, runId: e.runId });
    const r = (await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)) as Record<string, any>;
    expect(r).toMatchObject({ ok: false, detached: true });
    expect(r.refused).toMatch(/no longer this walker's/);
    expect(r.outcome).toBeUndefined();
    expect(h.sent).toEqual([]);
    expect(store.segmentEnd()).toBeNull();
  });

  it("★ a stale claim WITH abortRequested ⇒ stopped: the local sweep (the walk never actuated ⇒ its STOP is not needed, said)", async () => {
    const { e, pkg } = await pkgOf([ot("m1"), robotStop("s1")], "stale2-e");
    const t = io({ authorize: async () => ({ ok: false, verdict: "stale", code: "claim_stale", abortRequested: true }) });
    const store = createEdgeRunStore(pkg, { ...t.io, runId: e.runId });
    const r = (await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)) as Record<string, any>;
    expect(r).toMatchObject({ outcome: "aborted" });
    expect(h.sent).toEqual([]);
  });

  it("★ a journal that refuses a NON-STOP record stops the walk (nothing sent after it); a STOP's refused record never holds the STOP", async () => {
    const { e, pkg } = await pkgOf([robotStop("s1"), ot("m1")], "jr-e");
    const t = io({
      dropped: true,
      authorize: async () => ({ ok: true, authorization: {} as never, claims: { jti: randomUUID(), approval: null }, ttlMs: 10_000, reqNonce: "n".repeat(32), requestSentMonoMs: 0 }),
    });
    const store = createEdgeRunStore(pkg, { ...t.io, runId: e.runId });
    await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store).catch(() => undefined);
    expect(h.sent.map((s) => s.stepId)).toEqual(["s1"]);
  });

  it("★ createEdgeRunStore refuses a package of another run / claim; a central store never walks an edge package", async () => {
    const { e, pkg } = await pkgOf([ot("m1")], "cs-e");
    expect(() => createEdgeRunStore(pkg, { ...io().io, runId: e.runId + 1 })).toThrow(/not for run/);
    expect(() => createEdgeRunStore(pkg, { ...io().io, runId: e.runId, claimSeq: 2 })).toThrow(/claim/);
    const { centralRunStore } = await import("./foeRunStore");
    expect(((await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, centralRunStore)) as any).refused).toMatch(/edge store/);
    expect(h.sent).toEqual([]);
  });

  it("★ STOP re-send from a signed sweep picture: only the VERIFIED STOPs not confirmed are sent, never motion; too old ⇒ refused", async () => {
    const { resendStopsOfAbortedRun } = await import("./foeEngine");
    const { createEdgeSweepStore } = await import("../../edge/edgeRunStore");
    const { pkg } = await pkgOf([move("r1"), robotStop("s1"), robotStop("s2")], "rs-e");
    const picture = { ...pkg, kind: "sweep_picture", prior: { ...pkg.prior, abortSentBefore: ["s2"], settled: ["r1"], attempted: ["r1"], startOrder: ["r1"] } } as unknown as import("../../edge/edgeProtocol").EdgeSweepPicture;
    const outcomes: unknown[] = [];
    const store = createEdgeSweepStore(picture, { abortStop: (rec) => void outcomes.push(rec) });
    const r = await resendStopsOfAbortedRun(picture, { id: 0, role: "system", name: "edge" }, store);
    expect(r).toMatchObject({ ok: true, resend: true, abortStops: { sent: ["s1"], failed: [] } });
    expect(h.sent.map((s) => s.stepId)).toEqual(["s1"]); // s2 was confirmed before; r1 is motion
    expect(h.sent[0].edge as any).toMatchObject({ authorization: null });
    expect(outcomes).toEqual([expect.objectContaining({ kind: "abort_stop", stepId: "s1", status: "completed" })]);
    const old = { ...picture, issuedAt: Date.now() - 16 * 60_000 } as typeof picture;
    const r2 = await resendStopsOfAbortedRun(old, { id: 0, role: "system", name: "edge" }, createEdgeSweepStore(old, { abortStop: () => undefined }));
    expect(r2).toMatchObject({ ok: false, reason: "resendTooOld" });
    expect(h.sent.length).toBe(1);
  });
});

describe("doc 81 Đợt 10 C — central applies an edge segment end with the walk's rules (group B's sink)", () => {
  async function liveEdgeRun(steps: WorkflowStep[], ref: string) {
    const e = await edgeAssignedRun(def(ref, steps));
    runRow(e.runId).status = "running";
    return { e, d: rows("orchestration_workflows").find((w) => w.id === runRow(e.runId).workflowId)!.definitionJson as WorkflowDefinition };
  }
  const end = (d: WorkflowDefinition, x: Record<string, unknown>) => ({ nodeCode: "EDGE-A", claimSeq: 1, def: d, ...x }) as never;
  const w = (x: Partial<Row>) => ({ stepId: "m1", stepType: "command", status: "running", attempt: 0, startedAt: null, finishedAt: null, error: null, result: undefined, ...x }) as never;

  it("★ completed only when every top-level step row is completed / skipped and nothing runs — else not_finished, nothing written", async () => {
    const { e, d } = await liveEdgeRun([ot("m1"), ot("m2")], "ap-c");
    await recordEdgeStepRows(fake as never, e.runId, [w({ status: "completed", attempt: 1 })]);
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, end(d, { outcome: "completed" }))).toMatchObject({ ok: false, code: "not_finished" });
    expect(runRow(e.runId).status).toBe("running");
    await recordEdgeStepRows(fake as never, e.runId, [w({ stepId: "m2", status: "running" })]);
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, end(d, { outcome: "completed" }))).toMatchObject({ ok: false, code: "not_finished" });
    await recordEdgeStepRows(fake as never, e.runId, [w({ stepId: "m2", status: "skipped" })]);
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, end(d, { outcome: "completed" }))).toMatchObject({ ok: true, status: "completed", changed: true });
    expect(runRow(e.runId).status).toBe("completed");
    // a late report never regresses a finished run
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, end(d, { outcome: "failed", error: "late" }))).toMatchObject({ ok: true, status: "completed", changed: false });
  });

  it("★ a stopped run (aborted, or a rejection's claim) is never changed; 'aborted' from an edge alone is a failure; held marks the run", async () => {
    const a = await liveEdgeRun([ot("m1")], "ap-a");
    runRow(a.e.runId).status = "aborted";
    expect(await applyEdgeSegmentEnd(fake as never, a.e.runId, end(a.d, { outcome: "completed" }))).toMatchObject({ changed: false, status: "aborted" });
    const { FOE_REJECT_CLAIM_CTX_KEY } = await import("./foeGateApproval");
    const r = await liveEdgeRun([ot("m1")], "ap-r");
    runRow(r.e.runId).contextJson = { [FOE_REJECT_CLAIM_CTX_KEY]: "tok" };
    expect(await applyEdgeSegmentEnd(fake as never, r.e.runId, end(r.d, { outcome: "failed" }))).toMatchObject({ changed: false, status: "running" });
    const f = await liveEdgeRun([ot("m1")], "ap-f");
    expect(await applyEdgeSegmentEnd(fake as never, f.e.runId, end(f.d, { outcome: "aborted" }))).toMatchObject({ status: "failed", changed: true });
    expect(String(runRow(f.e.runId).error)).toMatch(/aborted without a central abort/);
    const hl = await liveEdgeRun([ot("m1")], "ap-h");
    expect(await applyEdgeSegmentEnd(fake as never, hl.e.runId, end(hl.d, { outcome: "held", heldReason: "centralUnreachable" }))).toMatchObject({ status: "held", changed: true });
    expect(runRow(hl.e.runId).contextJson).toMatchObject({ edgeHeld: "centralUnreachable", interrupted: true, edgeHeldNode: "EDGE-A" });
    expect(runRow(hl.e.runId).currentStepId).toBeNull();
    const q = await liveEdgeRun([ot("m1")], "ap-q");
    runRow(q.e.runId).status = "queued";
    expect(await applyEdgeSegmentEnd(fake as never, q.e.runId, end(q.d, { outcome: "failed" }))).toMatchObject({ changed: false, status: "queued" });
  });

  it("★ paused at a step that is not a gate ⇒ held (a person decides), never awaiting_confirm; an approved gate row is never reopened", async () => {
    const p = await liveEdgeRun([gate(), ot("m1")], "ap-p");
    expect(await applyEdgeSegmentEnd(fake as never, p.e.runId, end(p.d, { outcome: "paused", gateStepId: "m1" }))).toMatchObject({ status: "held" });
    expect(runRow(p.e.runId).contextJson).toMatchObject({ edgeHeld: "pausedAtNonGate" });
    const q = await liveEdgeRun([gate(), ot("m1")], "ap-q2");
    await recordEdgeStepRows(fake as never, q.e.runId, [w({ stepId: "g1", stepType: "hitl_gate", status: "completed", result: { approved: true } })]);
    expect(await applyEdgeSegmentEnd(fake as never, q.e.runId, end(q.d, { outcome: "paused", gateStepId: "g1" }))).toMatchObject({ status: "awaiting_confirm" });
    expect(runRow(q.e.runId).currentStepId).toBe("g1");
    expect(stepRows(q.e.runId).find((s) => s.stepId === "g1")).toMatchObject({ status: "completed", resultJson: { approved: true } });
  });

  it("★ recordEdgeStepRows keeps upsertStep's rules: running never regresses a finished row; a failed abort row never a completed one; no result keeps it", async () => {
    const { e } = await liveEdgeRun([ot("m1")], "rows-e");
    await recordEdgeStepRows(fake as never, e.runId, [w({ result: { routedTo: "ot-dispatcher", accepted: true } }), w({ status: "completed", attempt: 1 }), w({ status: "running" })]);
    expect(stepRows(e.runId).find((s) => s.stepId === "m1")).toMatchObject({ status: "completed", attempt: 1, resultJson: { routedTo: "ot-dispatcher", accepted: true } });
    await recordEdgeStepRows(fake as never, e.runId, [w({ stepId: "abort:s1", status: "completed", result: { abortStop: "sent" } }), w({ stepId: "abort:s1", status: "failed", result: { abortStop: "failed" } })]);
    expect(stepRows(e.runId).find((s) => s.stepId === "abort:s1")).toMatchObject({ status: "completed", resultJson: { abortStop: "sent" } });
    await recordEdgeStepRows(fake as never, e.runId, [w({ stepId: "abort:s2", status: "failed", result: { abortStop: "failed" } }), w({ stepId: "abort:s2", status: "completed", result: { abortStop: "sent" } })]);
    expect(stepRows(e.runId).find((s) => s.stepId === "abort:s2")).toMatchObject({ status: "completed" });
  });

  it("★ edgePriorPictureOf = the walk's own reading of the rows (completed set, settled, attempted, order, branches, confirmed STOPs)", () => {
    const t = (n: number) => new Date(T0.getTime() + n);
    const p = edgePriorPictureOf([
      { id: 1, stepId: "g1", status: "completed", resultJson: { approved: true }, startedAt: null },
      { id: 2, stepId: "m1", status: "completed", resultJson: { routedTo: "ot-dispatcher" }, startedAt: t(2) },
      { id: 3, stepId: "b1", status: "running", resultJson: { branch: "else" }, startedAt: t(1) },
      { id: 4, stepId: "x1", status: "skipped", resultJson: null, startedAt: null },
      { id: 5, stepId: "abort:s1", status: "completed", resultJson: { stepId: "s1" }, startedAt: t(3) },
    ]);
    expect(p).toEqual({
      completed: ["g1", "m1", "x1"],
      settled: ["g1", "m1", "x1"],
      attempted: ["g1", "m1", "b1"],
      startOrder: ["b1", "m1", "g1"],
      branches: [{ stepId: "b1", branch: "else" }],
      abortSentBefore: ["s1"],
      unknown: false,
    });
    expect(edgePriorPictureOf(null)).toMatchObject({ unknown: true, completed: [] });
  });
});
