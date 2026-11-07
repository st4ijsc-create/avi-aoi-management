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
import { describe, it, expect, vi, afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const h = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  failPlan: new Map<string, number>(), // stepId → how many attempts fail (Infinity ⇒ always)
  /** fix review 1 — while an EDGE walk runs, the database THROWS (and every attempt is counted): "reads no DB" is measured */
  dbThrows: false,
  dbCalls: 0,
  /** fix review 5 — device ownership as central reads it (B's edgeCentralCommon; raw SQL there ⇒ modelled here) */
  foreignRobots: new Set<number>(),
  foreignAdapters: new Set<number>(),
  ownershipThrows: false,
  /** fix review 3 — the edge dispatch's LEDGER record (journaled inside sendCommand, BEFORE the walker's result row) */
  onLedger: null as null | ((cmd: Record<string, any>, ok: boolean) => void),
  telemetry: [] as Array<{ key: string; value: unknown }>,
  /** R1b-2b-2a A2(o) AMENDMENT 2 — these steps' NEXT dispatch is refused by the edge's config gate (CONFIG_STALE: nothing sent) */
  staleDispatch: new Set<string>(),
  /** A2(o) r3 F4 — these steps' NEXT dispatch is refused by the config gate with SAFETY_CONFIG_MISSING (nothing sent) */
  missingDispatch: new Set<string>(),
  /** R1b-2b-2a A2(n) — these steps' dispatch answers `timeout` (sent, outcome unknown) */
  timeoutDispatch: new Set<string>(),
  /** A2(n) extension — these steps' NEXT dispatch alone answers `timeout` */
  timeoutOnce: new Set<string>(),
  /** A2(n) — the URGENT alerts raised (recorded) */
  alerts: [] as Array<Record<string, any>>,
  /** A2(n) T0 — phanLoaiStopGhimChoFoe's scripted answer (null ⇒ read fine, not pinned); ghimLan: the questions that reached it */
  ghim: null as null | ((d: unknown, i: { commandType: string }) => Promise<{ pinnedStop: boolean; loiDocGhim: string | null }>),
  ghimLan: [] as string[],
  /** A2(n) T0 — classifyOtStop throws, as the pin read of a verifier; classifyLan: the calls that reached it */
  classifyLoi: false,
  classifyLan: 0,
  /** A2(n) T0 — runningConnectionMatchesAdapterRow's answer; connLan: the calls that reached it */
  connOk: true,
  connLan: 0,
  /** A2(n) T0 — these steps' dispatch answers this many ms later */
  slow: new Map<string, number>(),
  /** A2(n) T0 — a dispatch that went answers `acked` (a real device path) instead of `simulated` */
  acked: false,
  /** A2(n) T0 — what the alert reports through `baoBen`: was the URGENT stored? */
  alertDurable: true,
  /** A2(n) T0 — these steps' dispatch is refused by a consumeAuthorization past its bound (the disk lot's round C): nothing sent, the journal says it overran */
  consumeQuaHan: new Set<string>(),
  /** A2(n) T0 — the REAL alert ran (its CRITICAL line): a mock that did not reach its target. Stays 0 */
  canhBaoThat: 0,
  /** A2(n) T3+T4 — answers of `timeout` given so far: from the first one the latch can fall; a command that reaches the fake after it is marked `sauKhoa` */
  traTimeout: 0,
  /** A2(n) T3+T4 — with h.acked: the status of the answer (the read-back's acked_verified) */
  ackStatus: "acked",
  /** A2(n) T3+T4 — what a case allows after the latch beyond a STOP: a compensation a person approved */
  duocSauKhoa: new Set<string>(),
}));

vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return {
    isStopCommandType: orig.isStopCommandType,
    classifyOtStop: (...a: Parameters<typeof orig.classifyOtStop>) => {
      h.classifyLan++;
      if (h.classifyLoi) throw new Error("pin read down (test)");
      return orig.classifyOtStop(...a);
    },
    runningConnectionMatchesAdapterRow: async () => {
      h.connLan++;
      return h.connOk;
    },
    phanLoaiStopGhimChoFoe: async (d: unknown, i: { commandType: string }) => {
      h.ghimLan.push(i.commandType);
      return h.ghim ? h.ghim(d, i) : { pinnedStop: false, loiDocGhim: null };
    },
    dispatch: vi.fn(),
  };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: vi.fn() }));
vi.mock("../../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../robot/criticalStopAlert")>();
  return {
    ...orig,
    raiseCriticalStopAlert: async (a: Record<string, any>) => {
      h.alerts.push(a);
      a.baoBen?.(h.alertDurable);
    },
  };
});
vi.mock("../../edge/edgeCentralCommon", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../edge/edgeCentralCommon")>();
  const owned = (foreign: Set<number>) => async (_d: unknown, _node: number, ids: readonly number[]) => {
    if (h.ownershipThrows) throw new Error("ownership unreadable");
    return new Set(ids.filter((id) => !foreign.has(id)));
  };
  return { ...orig, ownedRobotIds: owned(h.foreignRobots), ownedAdapterIds: owned(h.foreignAdapters) };
});
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
      h.sent.push({ kind, stepId, name: cmd.name, adapterId: cmd.adapterId ?? null, robotId: cmd.robotId ?? null, writes: cmd.writes ?? null, job: cmd.job ?? null, edge: cmd.edge ?? null, hitl: cmd.hitl, sauKhoa: h.traTimeout > 0 });
      const cham = h.slow.get(stepId);
      if (cham) await new Promise((r) => setTimeout(r, cham));
      if (h.consumeQuaHan.has(stepId)) return { ok: false, status: "rejected", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: "JOURNAL_CONSUME_FAILED", detail: { edge: true, stop: false, reason: "JOURNAL_CONSUME_FAILED", refusal: "io_error" } };
      if (h.timeoutDispatch.has(stepId) || h.timeoutOnce.delete(stepId)) {
        h.traTimeout++;
        return { ok: false, status: "timeout", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: `no answer from ${stepId}` };
      }
      if (h.staleDispatch.delete(stepId)) {
        // exactly what equipmentAdapter's edge route returns for edgeNonStopConfigGate's CONFIG_STALE (before driver / consume)
        return { ok: false, status: "rejected", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: "CONFIG_STALE", detail: { edge: true, stop: false, reason: "CONFIG_STALE", refusal: "central announced config v4 3 s ago; this edge still holds v3 (issued 95 s ago) — non-STOP writes are refused until the refresh succeeds (STOPs still go)" } };
      }
      if (h.missingDispatch.delete(stepId)) {
        // exactly what equipmentAdapter's edge route returns for edgeNonStopConfigGate's SAFETY_CONFIG_MISSING (before driver / consume)
        return { ok: false, status: "rejected", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: "SAFETY_CONFIG_MISSING", detail: { edge: true, stop: false, reason: "SAFETY_CONFIG_MISSING", refusal: "signed safety-PLC config(s) #7 absent from the verified config v3 (issued 95 s ago) — the preflight could not consult them; refused, a refresh is requested" } };
      }
      const left = h.failPlan.get(stepId) ?? 0;
      h.onLedger?.(cmd, left === 0); // the REAL ordering: the ledger result is recorded before the walker writes its result row
      if (left > 0) {
        h.failPlan.set(stepId, left - 1);
        return { ok: false, status: "rejected", routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", error: `scripted failure of ${stepId}` };
      }
      if (h.acked) return { ok: true, status: h.ackStatus, routedTo: kind === "robot" ? "robot-dispatcher" : "ot-dispatcher", detail: {} };
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
vi.mock("../../../db/connection", () => ({
  getDb: vi.fn(async () => {
    if (h.dbThrows) {
      h.dbCalls++;
      throw new Error("EDGE: this process has no database");
    }
    return fake;
  }),
}));

import { orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows, machines, deviceAdapters, deviceTags, robots, permissions } from "../../../../drizzle/schema";
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
  autoResumeInterruptedRuns,
  FOE_GATE_REQUIRED,
} from "./foeEngine";
import { EDGE_HELD_CTX_KEY, buTruLaStopGhimTrungTam, chuBuTruTrongDinhNghia, findSeparateGateApproval, withResolvedAdapter } from "./foeRunStore";
import { CANH_BAO_KHONG_RO_KIND, KET_CUC_KHONG_RO_CHOT_CTX_KEY, KET_CUC_KHONG_RO_CTX_KEY, buTruBiChanKhongRo, canhBaoKetCucKhongRo, chotTuHang } from "./foeKetCucKhongRo";
import { getDb } from "../../../db/connection";
import { raiseCriticalStopAlert } from "../../robot/criticalStopAlert";
import { logCrudOperation } from "../../auditTrailService";
import { FOE_NOT_SENT_RUN_LATCHED, edgeResumeStateOf } from "./foeRunStore";
import { verifiedStopStepIds } from "./foeStepClass";
import { edgeContextPatchOf } from "../../edge/edgeContextPolicy";
import { createEdgeRunStore, type EdgeRunRecordIn, type EdgeStepAuthorizeOutcome, type EdgeStepAuthorizeRequest } from "../../edge/edgeRunStore";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";
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

/**
 * A2(n) T0 — a mock that did not reach its target. Two concurrent `import()` of one mocked module from one importer: vitest 2.1.9 (requestWithMock) hands the later one the REAL module,
 * not only on the first load, so loading the mock early does not help. The engine's modules go through napMotLan (foeNapMotLan.ts) and foeNapMotLan.test.ts holds them to it; the
 * real alert's CRITICAL line is counted here, so a leak is a red case, not a noise in the log. Fire-and-forget: the case that follows a leak may be the one that shows it.
 */
beforeAll(() => {
  const goc = console.error;
  console.error = (...a: unknown[]) => {
    if (String(a[0]).startsWith("[StopAlert] CRITICAL")) h.canhBaoThat++;
    goc(...a);
  };
});
afterEach(() => {
  expect(h.canhBaoThat, "the REAL alert ran: a mock did not reach its target").toBe(0);
});

beforeEach(() => {
  h.foreignRobots.clear();
  h.foreignAdapters.clear();
  h.ownershipThrows = false;
  h.onLedger = (cmd, ok) => {
    const a = cmd.edge?.authorization;
    if (!a) return;
    for (const r of fake.store.get("edge_step_authorizations") ?? []) {
      if (r.runId === a.runId && r.stepId === a.stepId && r.attempt === a.attempt) Object.assign(r, { resultReportedAt: new Date(), resultStatus: ok ? "simulated" : "rejected" });
    }
  };
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
  h.staleDispatch.clear();
  h.missingDispatch.clear();
  h.timeoutDispatch.clear();
  h.timeoutOnce.clear();
  h.alerts.length = 0;
  h.ghim = null;
  h.ghimLan.length = 0;
  h.classifyLoi = false;
  h.classifyLan = 0;
  h.connOk = true;
  h.connLan = 0;
  h.slow.clear();
  h.acked = false;
  h.alertDurable = true;
  h.consumeQuaHan.clear();
  h.traTimeout = 0;
  h.ackStatus = "acked";
  h.duocSauKhoa.clear();
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
/** A2(n) T0 — an OT STOP on the pinned tag of seedHalt(): verified, a stop for the dispatcher */
const otStop = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "halt", value: true }, ...extra }) as never;
const seedHalt = () => fake.seed(deviceTags, [...rows("device_tags"), { id: 75, adapterId: 501, tagKey: "halt", address: "00001", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true }]);
/** A2(n) T0 — answers of h.ghim: a STOP on a readable pin; the pins not readable */
const PIN_OK = async (_d: unknown, i: { commandType: string }) => ({ pinnedStop: i.commandType === "stop", loiDocGhim: null });
const PIN_BAD = async () => ({ pinnedStop: false, loiDocGhim: "pin read timed out (test)" });
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
  /** fix review 2 — the complete request lost its outcome-unknown list / prefix (E did not forward it) */
  stripEndUnknown?: boolean;
  /** fix review 1 — the journal refuses the record matching this (once refused, every later non-STOP record too) */
  refuse?: (rec: EdgeRunRecordIn) => boolean;
  /** the walker's run-status calls on the edge stores of every segment (central only applies the segment END) */
  statuses: string[];
  records: EdgeRunRecordIn[];
  authorizeCalls: EdgeStepAuthorizeRequest[];
  /** unavailable from this authorize call on (D5) */
  offline: boolean;
  /** fix review 1 — central unreachable for these steps' authorisations only */
  offlineSteps?: Set<string>;
  /** "stopped" answered by central from now on */
  stopped: boolean;
  /** R1b-2b-2a A2(o) AMENDMENT 2 — the edge config source's staleness (absent ⇒ never stale) */
  staleness?: () => { centralVersion: number; localVersion: number; sinceMs: number; configIssuedAt: number | null } | null;
  /** events-stream records of every segment (anomalies) */
  events?: Array<Record<string, any>>;
  /** A2(o) AMENDMENT 2 — authorisations the edge reported NEVER used (central supersedes them, as edgeReportsCentral.applyAuthUnused) */
  unused?: Array<Record<string, any>>;
  /** R1b-2b-2a A2(n) N8 — the auth_unused journal / report FAILS (reportUnused answers false): the authorisation stays issued on central */
  unusedFails?: boolean;
  /** A2(n) F10 — the report never answers (a stalled journal) */
  unusedHangs?: boolean;
  /** A2(n) (I-5) — the events journal refuses (a full journal): the anomaly never leaves the edge */
  eventsRefused?: boolean;
  /** A2(n) extension — /authorize answers these steps this many ms later */
  authorizeDelay?: Map<string, number>;
  /** A2(n) T3+T4 — the journal takes this long over a step's records: a walker stands before its sink, a verified STOP included (it never asks /authorize) */
  journalDelay?: Map<string, number>;
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
  const all = (steps: WorkflowStep[] | undefined): WorkflowStep[] => (steps ?? []).flatMap((s) => [s, ...all((s as any).steps), ...all((s as any).then), ...all((s as any).else), ...(s.compensation ? all([s.compensation]) : [])]);
  const v = await verifiedStopStepIds(d, machineMap, fake as never); // central's classifier (B: edgeRunAnalysis) — pins from the rows
  const resolved: Array<{ stepId: string; adapterId: number }> = [];
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
    verifiedStops: [...v.ids].map((stepId) => {
      const st = all(d.steps).find((x) => x.id === stepId) as { machineId: number; args?: Record<string, unknown> };
      if (st.machineId === 2) return { kind: "robot" as const, stepId, robotId: 2 };
      const pins = rows("device_tags").filter((t) => t.adapterId === 501 && t.stopValue != null).map((t) => ({ tagKey: t.tagKey, value: t.stopValue }));
      return { kind: "ot" as const, stepId, adapterId: 501, pins };
    }),
    stopsUnsure: [...v.unsure],
    prior: edgePriorPictureOf(stepRows(x.runId) as unknown as Parameters<typeof edgePriorPictureOf>[0]), // hàng FakeDb = Record<string, any> (không khai stepId/status) — cùng mảng, chỉ đổi kiểu
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
function fakeAuthorize(x: EdgeHarness, d: WorkflowDefinition, primed?: Awaited<ReturnType<typeof findSeparateGateApproval>>) {
  return {
    async authorize(input: EdgeStepAuthorizeRequest): Promise<EdgeStepAuthorizeOutcome> {
      x.authorizeCalls.push(input);
      const tre = x.authorizeDelay?.get(input.stepId);
      if (tre) await new Promise((r) => setTimeout(r, tre));
      if (x.offline || x.offlineSteps?.has(input.stepId)) return { ok: false, verdict: "unavailable", code: "network" };
      if (x.stopped) return { ok: false, verdict: "stopped", code: "stopped" };
      // the real /authorize: one authorisation per (run, claim, step, attempt) — a second ask answers 409 already_authorized (edgeAuthorizeCentral)
      if ((fake.store.get("edge_step_authorizations") ?? []).some((a) => a.runId === x.runId && a.claimSeq === input.claimSeq && a.stepId === input.stepId && a.attempt === input.attempt)) return { ok: false, verdict: "refused", code: "already_authorized" };
      // the real /authorize step 5b (A2(n) (b)): the same pure check, on central's context and rows (edgeAuthorizeCentral)
      const chu = chuBuTruTrongDinhNghia(d.steps, input.stepId);
      if (chu && buTruBiChanKhongRo(runRow(x.runId).contextJson, stepRows(x.runId) as never, chu.step.id, chu.comp.id)) return { ok: false, verdict: "refused", code: "outcome_unknown_held" };
      const found = primed ?? (await findSeparateGateApproval({ runId: x.runId, def: d, startedViaApi: false }));
      if ("reason" in found) return { ok: false, verdict: "refused", code: "gate_required", reason: found.reason };
      // central's authorisation ledger (0372) — B's /authorize writes it; resultReportedAt stays null until a result is applied
      const jti = randomUUID();
      fake.store.set("edge_step_authorizations", [...(fake.store.get("edge_step_authorizations") ?? []), { jti, runId: x.runId, claimSeq: input.claimSeq, stepId: input.stepId, attempt: input.attempt, resultReportedAt: null, supersededAt: null }]);
      return {
        ok: true,
        authorization: { typ: "avi-edge-auth+v1", alg: "EdDSA", kid: "edk_test", payload: "{}", sig: "x" } as never,
        claims: { jti, approval: { approvedBy: found.approval.approvedBy, gateStepId: found.approval.gateStepId } },
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
  // central's gate decision for this segment (B's /authorize decides it on central — the edge never reads it)
  const primed = await findSeparateGateApproval({ runId: x.runId, def: d, startedViaApi: false });
  let refusing = false;
  const store = createEdgeRunStore(pkg, {
    runId: x.runId,
    claimSeq,
    claimToken: "ect_" + "a".repeat(43),
    sink: {
      async run(_runId, _claim, rec, o) {
        const tre = rec.kind === "step" ? x.journalDelay?.get(rec.stepId) : undefined;
        if (tre) await new Promise((r) => setTimeout(r, tre));
        if (x.refuse && (refusing || x.refuse(rec)) && !o?.stop) {
          refusing = true;
          return { seq: null, dropped: true, reason: "journal_full" };
        }
        x.records.push(rec);
        return { seq: x.records.length, durable: true };
      },
      async event(rec) {
        if (x.eventsRefused) return { seq: null, dropped: true, reason: "journal_full" };
        x.events?.push(rec as Record<string, any>);
        return { seq: 1, durable: true };
      },
    },
    consume: { admitNonStop: () => true, consumeOverran: () => h.consumeQuaHan.size > 0 },
    authorize: fakeAuthorize(x, d, primed),
    ...(x.staleness ? { config: { staleness: x.staleness } } : {}),
    async reportUnused(u) {
      if (x.unusedHangs) await new Promise<void>(() => undefined);
      if (x.unusedFails) return false;
      x.unused?.push({ ...u });
      for (const r of fake.store.get("edge_step_authorizations") ?? []) if (r.jti === u.jti && r.resultReportedAt == null) r.supersededAt = new Date();
      return true;
    },
  });
  // ★ the edge walk (and a local abort sweep) run against a database that THROWS — and is never even asked
  h.dbThrows = true;
  h.dbCalls = 0;
  let out: Record<string, any>;
  try {
    const drive = driveEdgeRunFromPackage(pkg, { runId: x.runId, claimSeq, claimToken: "ect_" + "a".repeat(43) }, store);
    if (opts.beforeEnd) await opts.beforeEnd(drive);
    out = (await drive) as Record<string, any>;
  } finally {
    h.dbThrows = false;
  }
  expect(h.dbCalls, "the edge walk asked for a database").toBe(0);
  x.statuses.push(...store.statusLog());
  // central applies the reported rows (step / abort_stop / context) — as edgeReportsCentral does — and the segment end
  const seg = x.records.slice(from);
  const write = seg.filter((r) => r.kind === "step" || r.kind === "abort_stop").map((r: any) =>
    r.kind === "step"
      ? { stepId: r.stepId, stepType: r.stepType, status: r.status, attempt: r.attempt, startedAt: r.startedAt == null ? null : new Date(r.startedAt), finishedAt: r.finishedAt == null ? null : new Date(r.finishedAt), error: r.error, result: r.result ?? undefined }
      : { stepId: `abort:${r.stepId}`, stepType: "command", status: r.status, attempt: 0, startedAt: new Date(r.at), finishedAt: new Date(r.at), error: null, result: { ...(r.result ?? {}), stepId: r.stepId } },
  );
  await recordEdgeStepRows(fake as never, x.runId, write);
  // fix review 2 — through THE context filter (edgeContextPolicy — the one B's report endpoint uses), and only while the run is
  // live (as edgeReportsCentral: a context record of a stopped / ended run is evidence only)
  for (const r of seg) {
    if (r.kind !== "context") continue;
    const row = runRow(x.runId);
    if (row.status !== "running" && row.status !== "compensating") continue;
    row.contextJson = { ...(row.contextJson ?? {}), ...edgeContextPatchOf(r.patch, row.contextJson).patch };
  }
  const end = x.stripEndUnknown && out.outcome ? { ...out, outcomeUnknown: undefined, error: undefined } : out;
  if (end.outcome) await applyEdgeSegmentEnd(fake as never, x.runId, { ...(end as any), nodeCode: "EDGE-A", claimSeq, def: d });
  return { out, segment: seg };
}

/**
 * R1b-2b-2a A2(n) (n3) — the Continue of a run HELD for an unknown outcome: a person with machine-control rights (OTHER is a supervisor ⇒ an
 * explicit machine_control/canCreate row) and a REQUIRED reason; without the reason it is refused before anything changes.
 */
function grantMachineControl() {
  if (!rows("permissions").some((p) => p.userId === OTHER.id && p.moduleName === "machine_control")) {
    fake.seed(permissions, [{ id: 9001, userId: OTHER.id, category: "machine", moduleName: "machine_control", canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false, expiresAt: null }]);
  }
}
async function continueOutcomeUnknown(x: EdgeHarness, note: string) {
  grantMachineControl();
  const view = (await getRun(x.runId, { bindingDigest: true }))!;
  return resumeRun(x.runId, { approved: true, note, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
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
    const sortSent = (l: ReturnType<typeof sentCommands>) => [...l].sort((a, b) => ((a.stepId as string) < (b.stepId as string) ? -1 : 1));
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
    // fix review 1 — the abort sweep's write sequence is the walk's too (per step: the sweep row is written concurrently)
    expect(perStep(walkerWritesEdge(e))).toEqual(perStep(walkerWritesCentral(c)));
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

  /** a Continue of a HELD edge run (resumeRun ⇒ queued for its node again) */
  async function continueHeld(x: EdgeHarness) {
    const view = (await getRun(x.runId, { bindingDigest: true }))!;
    const r = await resumeRun(x.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(r).toMatchObject({ ok: true, status: "queued" });
  }
  const STALE = () => ({ centralVersion: 4, localVersion: 3, sinceMs: Date.now() - 3_000, configIssuedAt: Date.now() - 95_000 });

  it("★ A2(o) AMENDMENT 2: the config changes MID-RUN (stale before r2's authorisation) ⇒ r2 HELD (configStale: nothing asked, nothing sent, 0 compensations, anomaly with the config's age); after the refresh + Continue r2 runs EXACTLY ONCE under a NEW authorisation", async () => {
    const e = await edgeAssignedRun(def("a2o-mid", [gate(), move("r1", { compensation: ot("c1") }), move("r2", { maxAttempts: 2, compensation: ot("c2") }), robotStop("s9")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    let stale = false;
    e.staleness = () => (stale ? STALE() : null);
    const ledger = h.onLedger;
    h.onLedger = (cmd, ok) => {
      ledger?.(cmd, ok);
      if (String(cmd.idempotencyKey).includes("-r1-")) stale = true; // central announces a new config right after r1
    };
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r1"]); // r2 / s9 / any compensation never reached the equipment
    expect(e.authorizeCalls.filter((a) => a.claimSeq === 2).map((a) => a.stepId)).toEqual(["r1"]); // r2 never asked under the old config
    const r2 = stepRows(e.runId).find((s) => s.stepId === "r2")!;
    expect(r2).toMatchObject({ status: "held" });
    expect(String(r2.error)).toMatch(/^EDGE_HELD\(configStale\)/);
    expect(String(r2.error)).toMatch(/issued [0-9]+ s ago/);
    expect(e.events).toMatchObject([{ kind: "anomaly", code: "EDGE_CONFIG_STALE", runId: e.runId }]);
    expect(e.events[0].detail).toMatch(/central announced config v4 [0-9]+ s ago; this edge still holds v3 \(issued 9[0-9] s ago\)/);
    expect(runRow(e.runId).status).toBe("held");
    // the refresh never arrives ⇒ a Continue holds it AGAIN (indefinitely: never a failure, never compensated)
    await continueHeld(e);
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(e.events.map((x) => x.code)).toEqual(["EDGE_CONFIG_STALE", "EDGE_CONFIG_STALE"]);
    // the refresh arrives ⇒ Continue ⇒ r2 re-authorised under the new claim and sent once; the run completes
    stale = false;
    h.onLedger = ledger;
    await continueHeld(e);
    const s4 = await edgeSegment(e, 4);
    expect(s4.out).toMatchObject({ outcome: "completed" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r1", "r2", "s9"]); // r2 EXACTLY once, r1 not again
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").map((a) => a.claimSeq)).toEqual([4]);
    expect(h.sent.some((s) => s.stepId === "c1" || s.stepId === "c2")).toBe(false); // 0 compensations
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toBeUndefined();
    expect(stepRows(e.runId).find((s) => s.stepId === "c2")).toBeUndefined();
    expect(runRow(e.runId).status).toBe("completed");
  });

  it("★ A2(o) AMENDMENT 2: the config goes stale AFTER r2's authorisation (the edge dispatch gate answers CONFIG_STALE) ⇒ HELD, not failed: no retry, no compensation; Continue ⇒ re-authorised under the new claim (never the old authorisation) and sent once", async () => {
    const e = await edgeAssignedRun(def("a2o-disp", [gate(), move("r2", { maxAttempts: 3, compensation: ot("c2") })]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    e.unused = [];
    h.staleDispatch.add("r2");
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r2"]); // ONE dispatch attempt (the gate refused it: nothing reached a device) — no retry
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").map((a) => [a.claimSeq, a.attempt])).toEqual([[2, 1]]);
    const r2 = stepRows(e.runId).find((s) => s.stepId === "r2")!;
    expect(r2).toMatchObject({ status: "held" });
    expect(String(r2.error)).toMatch(/^EDGE_HELD\(configStale\).*issued 95 s ago/);
    expect(e.events.map((x) => x.code)).toEqual(["EDGE_CONFIG_STALE"]);
    // the refused authorisation is journaled + reported NEVER used (central supersedes it): it can never be reused
    expect(e.unused).toMatchObject([{ runId: e.runId, claimSeq: 2, stepId: "r2", attempt: 1, reason: "config_stale" }]);
    expect(String(r2.error)).toContain("reported unused");
    expect(h.sent.some((s) => s.stepId === "c2")).toBe(false);
    expect(runRow(e.runId).status).toBe("held");
    await continueHeld(e);
    const s3 = await edgeSegment(e, 3);
    expect(s3.out, JSON.stringify({ out: s3.out, rows: stepRows(e.runId) })).toMatchObject({ outcome: "completed" });
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").map((a) => a.claimSeq)).toEqual([2, 3]); // a NEW authorisation under the new claim
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r2", "r2"]); // refused once (nothing out), then sent once
    expect(h.sent.some((s) => s.stepId === "c2")).toBe(false);
    expect(runRow(e.runId).status).toBe("completed");
  });

  it("★ A2(n) N8 (n4): the A2(o) auth_unused report FAILS ⇒ held (configStale, nothing sent); Continue ⇒ central counts the step as possibly sent (EDGE_OUTCOME_UNKNOWN) ⇒ its NON-STOP compensation is HELD for a person — 0 sent (before A2(n): an automatic 'undo' of a command that never left)", async () => {
    const e = await edgeAssignedRun(def("a2n-n8", [gate(), move("r2", { maxAttempts: 3, compensation: ot("c2") })]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    e.unusedFails = true;
    h.staleDispatch.add("r2");
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r2")!.error)).toContain("could NOT be reported unused");
    await continueHeld(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r2: { state: "outcomeUnknown" } }); // the issued authorisation counts as sent
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r2"]); // the refused dispatch only: r2 never again, ★ c2 NEVER sent
    expect(stepRows(e.runId).find((s) => s.stepId === "c2")).toMatchObject({ status: "held" });
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r2")!.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN/);
    expect(runRow(e.runId).contextJson.foeKetCucKhongRo).toMatchObject({ stepId: "r2", compId: "c2" });
    expect(e.events.filter((x) => x.code === "FOE_OUTCOME_UNKNOWN_COMPENSATION")).toHaveLength(1);
  });

  it("★ A2(o) r3 F4: a safety-PLC config MISSING at the edge dispatch (SAFETY_CONFIG_MISSING, before the consume: nothing sent) ⇒ HELD like a stale config: no retry, no compensation, the authorisation reported unused; after the refresh + Continue ⇒ re-authorised and sent exactly once", async () => {
    const e = await edgeAssignedRun(def("a2o-miss", [gate(), move("r2", { maxAttempts: 3, compensation: ot("c2") })]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    e.unused = [];
    h.missingDispatch.add("r2");
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r2"]); // ONE dispatch attempt, refused by the gate: no retry (maxAttempts 3)
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").map((a) => [a.claimSeq, a.attempt])).toEqual([[2, 1]]);
    const r2 = stepRows(e.runId).find((s) => s.stepId === "r2")!;
    expect(r2).toMatchObject({ status: "held" });
    expect(String(r2.error)).toMatch(/^EDGE_HELD\(configStale\).*signed safety-PLC config\(s\) #7 absent/);
    expect(String(r2.error)).toContain("reported unused");
    // r4 (review m-1): the hold adds NO EDGE_CONFIG_STALE — the dispatch gate's EDGE_SAFETY_CONFIG_MISSING (journaled by the gate,
    // mocked out here) is the one anomaly for it; the stale-config hold above still writes its EDGE_CONFIG_STALE
    expect(e.events.map((x) => x.code)).toEqual([]);
    expect(e.unused).toMatchObject([{ runId: e.runId, claimSeq: 2, stepId: "r2", attempt: 1, reason: "config_stale" }]);
    expect(h.sent.some((s) => s.stepId === "c2")).toBe(false);
    expect(runRow(e.runId).status).toBe("held");
    // the edge's refresh brings the PLC config ⇒ Continue ⇒ a NEW authorisation, sent once, completed; 0 compensations
    await continueHeld(e);
    const s3 = await edgeSegment(e, 3);
    expect(s3.out, JSON.stringify({ out: s3.out, rows: stepRows(e.runId) })).toMatchObject({ outcome: "completed" });
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").map((a) => a.claimSeq)).toEqual([2, 3]);
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["r2", "r2"]); // refused once (nothing out), then sent once
    expect(h.sent.some((s) => s.stepId === "c2")).toBe(false);
    expect(stepRows(e.runId).find((s) => s.stepId === "c2")).toBeUndefined();
    expect(runRow(e.runId).status).toBe("completed");
  });

  it("★ A2(o) AMENDMENT 2: a STOP never waits for the config — with the config stale the robot abort before the held step still goes out (L-7)", async () => {
    const e = await edgeAssignedRun(def("a2o-stop", [gate(), robotStop("s1"), move("r1")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.staleness = STALE;
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "configStale" });
    expect(h.sent.slice(n0).map((s) => s.stepId)).toEqual(["s1"]);
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

  // A2(n) T0 — this case used to end on `expect(h.sent).toEqual([])`, right after the walk, under "the walk never actuated, its STOP is not needed". The sweep is not awaited: the STOP went
  // every time (its abortStopSent line stands in the old logs), a slow import() only kept it behind the assertion. m1's `running` row counts as acted (R-6-b reads the rows too).
  it("★ a stale claim WITH abortRequested ⇒ stopped: the local sweep sends the STOP (m1's running row counts as acted)", async () => {
    const { e, pkg } = await pkgOf([ot("m1"), robotStop("s1")], "stale2-e");
    const t = io({ authorize: async () => ({ ok: false, verdict: "stale", code: "claim_stale", abortRequested: true }) });
    const store = createEdgeRunStore(pkg, { ...t.io, runId: e.runId });
    const r = (await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)) as Record<string, any>;
    expect(r).toMatchObject({ outcome: "aborted" });
    await waitFor(() => h.sent.length > 0, "the local sweep's STOP");
    expect(h.sent.map((s) => s.stepId)).toEqual(["s1"]);
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

  it("★ a stopped run (aborted, or a rejection's claim) is never changed; the walk's own 'aborted' (precondition) ends aborted as on central; held marks the run", async () => {
    const a = await liveEdgeRun([ot("m1")], "ap-a");
    runRow(a.e.runId).status = "aborted";
    expect(await applyEdgeSegmentEnd(fake as never, a.e.runId, end(a.d, { outcome: "completed" }))).toMatchObject({ changed: false, status: "aborted" });
    const { FOE_REJECT_CLAIM_CTX_KEY } = await import("./foeGateApproval");
    const r = await liveEdgeRun([ot("m1")], "ap-r");
    runRow(r.e.runId).contextJson = { [FOE_REJECT_CLAIM_CTX_KEY]: "tok" };
    expect(await applyEdgeSegmentEnd(fake as never, r.e.runId, end(r.d, { outcome: "failed" }))).toMatchObject({ changed: false, status: "running" });
    const f = await liveEdgeRun([ot("m1")], "ap-f");
    expect(await applyEdgeSegmentEnd(fake as never, f.e.runId, end(f.d, { outcome: "aborted", error: "Precondition failed" }))).toMatchObject({ status: "aborted", changed: true });
    expect(String(runRow(f.e.runId).error)).toMatch(/^aborted on edge node EDGE-A: Precondition failed/);
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

describe("doc 81 Đợt 10 C — central's half for edge runs: Continue clears the edge marks (N4); the approval digest from node reports (D7)", () => {
  const capable = { protocol: "stub", connectionOptions: { simProgram: "P1" } };
  async function heldEdgeRun(ref: string, mark: Record<string, unknown>) {
    const e = await edgeAssignedRun(def(ref, [gate(), ot("m1")]));
    const r = runRow(e.runId);
    r.status = "held";
    r.currentStepId = null;
    r.contextJson = { ...(r.contextJson ?? {}), "branch:b9": "then", ...mark };
    return e;
  }

  it("★ N4: Continue of an edge run held 'edge unreachable' / 'edge held' re-queues it and CLEARS the marks (the badge goes); the doubt stays recorded", async () => {
    const at = new Date().toISOString();
    for (const [ref, mark] of [
      ["n4-u", { edgeUnreachable: true, edgeUnreachableAt: at, edgeUnreachableNode: "EDGE-A", interrupted: true, interruptedAt: at, interruptedFrom: "queued", interruptedBy: "edge unreachable" }],
      ["n4-h", { edgeHeld: "centralUnreachable", edgeHeldAt: at, edgeHeldNode: "EDGE-A", interrupted: true, interruptedAt: at, interruptedFrom: "running", interruptedBy: "edge held: centralUnreachable" }],
    ] as const) {
      const e = await heldEdgeRun(ref, mark);
      const view = (await getRun(e.runId, { bindingDigest: true }))!;
      const r = await resumeRun(e.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
      expect(r).toMatchObject({ ok: true, status: "queued" });
      const ctx = runRow(e.runId).contextJson;
      for (const k of Object.keys(mark)) expect(ctx).not.toHaveProperty(k);
      expect(ctx).toMatchObject({ "branch:b9": "then", interruptedEarlier: true }); // the run's own context is kept
    }
  });

  it("★ N4: a central (non-edge) Continue is unchanged — its interrupted mark is not touched", async () => {
    expect((await deployWorkflow(def("n4-c", [gate(), ot("m1")]), OWNER)).ok).toBe(true);
    const runId = (await startRun("n4-c", {}, OWNER)).runId!;
    const r = runRow(runId);
    r.status = "held";
    r.currentStepId = null;
    r.contextJson = { interrupted: true, interruptedBy: "restart" };
    await resumeRun(runId, { approved: true, note: "auto-resume (FOE_DURABLE)" }, { id: 0, role: "system", name: "FOE auto-resume" });
    expect(runRow(runId).contextJson).toMatchObject({ interrupted: true, interruptedBy: "restart" });
  });

  it("★ the abort sweep keeps counting an edge run whose interruption a Continue cleared as possibly acted (interruptedEarlier)", async () => {
    const e = await heldEdgeRun("n4-s", { interrupted: true, interruptedBy: "edge restart" });
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    await resumeRun(e.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(runRow(e.runId).contextJson).toMatchObject({ interruptedEarlier: true });
    // a central abort of a run whose rows say it never acted: its STOPs are "not needed" — UNLESS an earlier interruption
    // (cleared by a Continue) leaves the doubt, then they count as due (R-6-c)
    for (const [ref, ctx, expected] of [
      ["n4-s2", {}, { sent: [], notNeeded: ["s1"] }],
      ["n4-s3", { interruptedEarlier: true }, { sent: ["s1"], notNeeded: [] }],
    ] as const) {
      expect((await deployWorkflow(def(ref, [gate(), move("m1"), robotStop("s1")]), OWNER)).ok).toBe(true);
      const runId = (await startRun(ref, {}, OWNER)).runId!; // paused at g1, m1 never attempted
      runRow(runId).contextJson = { ...ctx };
      const ab = await abortRun(runId, OWNER, "doubt");
      expect(ab.abortStops).toMatchObject(expected);
    }
  });

  it("★ D7: the approver's digest of an EDGE run uses the node's fresh program report of its owned adapter — central never reads that controller", async () => {
    const e = await edgeAssignedRun(def("d7-e", [gate(), ot("m1")]));
    await edgeSegment(e, 1); // paused at g1
    const a = rows("device_adapters").find((x) => x.id === 501)!;
    Object.assign(a, capable, { edgeNodeId: NODE, ownerEpoch: 3 });
    // no report ⇒ a capable edge-owned controller is unreadable ⇒ no digest ⇒ cannot be approved (central has no session to read it)
    let view = (await getRun(e.runId, { bindingDigest: true }))!;
    expect(view.bindingDigest).toBeNull();
    expect(view.programChecks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 501, status: "unreadable" })]));
    // a fresh report of the node, same owner epoch ⇒ verified with the REPORTED checksum
    fake.seed({ [Symbol.for("drizzle:Name")]: "edge_node_program_reports" } as never, [{ edgeNodeId: NODE, adapterId: 501, status: "verified", checksum: "sha:abc", reason: null, readAt: new Date(), receivedAt: new Date(), ownerEpoch: 3 }]);
    view = (await getRun(e.runId, { bindingDigest: true }))!;
    expect(view.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(view.programChecks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 501, status: "verified", checksum: "sha:abc", source: "edge" })]));
    // the approval records exactly that reading
    await resumeRun(e.runId, { approved: true, expectedStepId: "g1", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(stepRows(e.runId).find((s) => s.stepId === "g1")!.resultJson).toMatchObject({ bindingDigest: view.bindingDigest, programChecks: expect.arrayContaining([expect.objectContaining({ id: 501, status: "verified", checksum: "sha:abc" })]) });
  });

  it("★ D7: a stale report, another owner epoch, or another node's report never counts (unreadable ⇒ no digest)", async () => {
    const e = await edgeAssignedRun(def("d7-x", [gate(), ot("m1")]));
    await edgeSegment(e, 1);
    Object.assign(rows("device_adapters").find((x) => x.id === 501)!, capable, { edgeNodeId: NODE, ownerEpoch: 3 });
    const report = (x: Record<string, unknown>) => fake.seed({ [Symbol.for("drizzle:Name")]: "edge_node_program_reports" } as never, [{ edgeNodeId: NODE, adapterId: 501, status: "verified", checksum: "sha:abc", reason: null, readAt: new Date(), receivedAt: new Date(), ownerEpoch: 3, ...x }]);
    for (const bad of [{ readAt: new Date(Date.now() - 10 * 60_000) }, { readAt: new Date(Date.now() + 10 * 60_000) }, { ownerEpoch: 2 }, { edgeNodeId: NODE + 1 }]) {
      report(bad);
      const view = (await getRun(e.runId, { bindingDigest: true }))!;
      expect(view.bindingDigest, JSON.stringify(bad)).toBeNull();
    }
    // an edge-reported "unsupported" for a controller central's config says is capable is not believed
    report({ status: "unsupported", checksum: null });
    expect((await getRun(e.runId, { bindingDigest: true }))!.bindingDigest).toBeNull();
  });

  it("★ D7: a CENTRAL run is unchanged — its (central-owned) controllers are read as before", async () => {
    expect((await deployWorkflow(def("d7-c", [gate(), ot("m1")]), OWNER)).ok).toBe(true);
    const runId = (await startRun("d7-c", {}, OWNER)).runId!;
    const view = (await getRun(runId, { bindingDigest: true }))!;
    expect(view.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(view.programChecks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 501, status: "unsupported" })]));
  });
});

describe("doc 81 Đợt 10 C — mutation follow-ups (each pins one rule the first mutation run showed unmeasured)", () => {
  const okAuth = async (): Promise<EdgeStepAuthorizeOutcome> => ({ ok: true, authorization: {} as never, claims: { jti: randomUUID(), approval: null }, ttlMs: 10_000, reqNonce: "n".repeat(32) });
  const ioOf = (runId: number, authorize: (i: EdgeStepAuthorizeRequest) => Promise<EdgeStepAuthorizeOutcome>, records: EdgeRunRecordIn[] = []) => ({
    runId,
    claimSeq: 1,
    claimToken: "ect_" + "c".repeat(43),
    sink: { run: async (_r: number, _c: number, rec: EdgeRunRecordIn) => (records.push(rec), { seq: records.length }) },
    authorize: { authorize },
  });

  it("★ D5 inside a PARALLEL: a held branch holds the run (never 'completed' with an unsent step)", async () => {
    const e = await edgeAssignedRun(def("par-h", [{ id: "p1", type: "parallel", steps: [ot("m1"), move("r1")] } as never]));
    const pkg = await claimPackage(e, 1);
    const store = createEdgeRunStore(pkg, ioOf(e.runId, async () => ({ ok: false, verdict: "unavailable", code: "network" })));
    expect(await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)).toMatchObject({ outcome: "held", heldReason: "centralUnreachable" });
    expect(h.sent).toEqual([]);
  });

  it("★ a live sweep never re-sends a STOP an EARLIER segment's sweep confirmed (prior abortSentBefore)", async () => {
    const e = await edgeAssignedRun(def("prior-s", [move("r1"), { id: "d1", type: "delay", ms: 60_000 } as never, robotStop("s1")]));
    const pkg = await claimPackage(e, 1);
    (pkg.prior as { abortSentBefore: string[] }).abortSentBefore = ["s1"];
    const records: EdgeRunRecordIn[] = [];
    const store = createEdgeRunStore(pkg, ioOf(e.runId, okAuth, records));
    const drive = driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store);
    await waitFor(() => records.some((r: any) => r.kind === "step" && r.stepId === "d1" && r.status === "running"), "d1 running");
    const live = await stopLiveRunForCentralAbort(e.runId, { id: 0, role: "system", name: "edge: central abort" });
    await drive;
    expect(live.abortStops?.sent).toEqual([]);
    expect(h.sent.map((s) => s.stepId)).toEqual(["r1"]);
  });

  it("★ a command that names nothing to authorise (no adapter resolved) is refused on the edge without asking central", async () => {
    const e = await edgeAssignedRun(def("unres", [ot("m1")]));
    const pkg = await claimPackage(e, 1);
    (pkg as { resolvedAdapters: unknown[] }).resolvedAdapters = [];
    const asked: unknown[] = [];
    const records: EdgeRunRecordIn[] = [];
    const store = createEdgeRunStore(pkg, ioOf(e.runId, async (i) => (asked.push(i), okAuth()), records));
    expect(await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)).toMatchObject({ outcome: "failed" });
    expect(asked).toEqual([]);
    expect((records.filter((r: any) => r.kind === "step" && r.stepId === "m1").pop() as any).error).toMatch(/^EDGE_AUTHORIZE_REFUSED\(commandUnresolved\)/);
  });

  it("★ applyEdgeSegmentEnd: 'completed' is refused while ANY non-abort row still runs (also below the top level)", async () => {
    const e = await edgeAssignedRun(def("ap-run", [ot("m1"), ot("m2", { compensation: ot("c9") })]));
    runRow(e.runId).status = "running";
    const d = rows("orchestration_workflows").find((w) => w.id === runRow(e.runId).workflowId)!.definitionJson as WorkflowDefinition;
    const w = (stepId: string, status: string) => ({ stepId, stepType: "command", status, attempt: 1, startedAt: null, finishedAt: null, error: null, result: undefined });
    await recordEdgeStepRows(fake as never, e.runId, [w("m1", "completed"), w("m2", "completed"), w("c9", "running")]);
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, { outcome: "completed", nodeCode: "EDGE-A", claimSeq: 1, def: d } as never)).toMatchObject({ ok: false, code: "not_finished" });
    await recordEdgeStepRows(fake as never, e.runId, [w("abort:x", "running")].map((r) => ({ ...r, stepId: "abort:x" })));
    await recordEdgeStepRows(fake as never, e.runId, [w("c9", "compensated")]);
    expect(await applyEdgeSegmentEnd(fake as never, e.runId, { outcome: "completed", nodeCode: "EDGE-A", claimSeq: 1, def: d } as never)).toMatchObject({ ok: true, status: "completed" });
  });

  it("★ applyEdgeSegmentEnd writes only while the run is STILL live when the write lands (a concurrent hold / abort wins)", async () => {
    const e = await edgeAssignedRun(def("ap-race", [ot("m1")]));
    runRow(e.runId).status = "held"; // what the row says when the write lands …
    const d = rows("orchestration_workflows").find((w) => w.id === runRow(e.runId).workflowId)!.definitionJson as WorkflowDefinition;
    // … while the endpoint's read still saw it 'running' (it changed in between)
    const sel = fake.select.bind(fake);
    let once = true;
    (fake as any).select = (p?: unknown) => {
      const b = sel(p as never);
      const from = b.from.bind(b);
      b.from = (t: any) => {
        const r = from(t);
        if (once && t?.[Symbol.for("drizzle:Name")] === "orchestration_runs") {
          once = false;
          const then = r.then.bind(r);
          r.then = (res: any, rej: any) => then((rowsOut: Row[]) => res(rowsOut.map((x) => ({ ...x, status: "running" }))), rej);
        }
        return r;
      };
      return b;
    };
    try {
      expect(await applyEdgeSegmentEnd(fake as never, e.runId, { outcome: "failed", error: "x", nodeCode: "EDGE-A", claimSeq: 1, def: d } as never)).toMatchObject({ changed: false });
    } finally {
      (fake as any).select = sel;
    }
    expect(runRow(e.runId).status).toBe("held");
  });
});

describe("doc 81 Đợt 10 C fix review 1 — compensation hold (R-10-y), journal refusal, robot STOP, precondition abort, OT pinned STOP", () => {
  it("★ R-10-y parity: a compensation whose authorisation is unavailable HOLDS the run at it (nothing sent, nothing failed); Continue resumes the COMPENSATION — final rows = central's", async () => {
    const cp = (ref: string) => def(ref, [gate(), move("r1", { compensation: ot("c1", { args: { tagKey: "speed", value: 0 } }) })]);
    h.failPlan.set("r1", Infinity);
    const c = await centralRun(cp("ch-c"), 1);
    const n0 = h.sent.length;
    const e = await edgeAssignedRun(cp("ch-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    // r1 is authorised and fails; central is unreachable for c1's authorisation
    e.offlineSteps = new Set(["c1"]);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "centralUnreachable" });
    expect(runRow(e.runId).status).toBe("held");
    expect(stepRows(e.runId).find((s) => s.stepId === "r1")).toMatchObject({ status: "failed" });
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toMatchObject({ status: "held" });
    expect(String(stepRows(e.runId).find((s) => s.stepId === "c1")!.error)).toMatch(/^EDGE_HELD\(centralUnreachable\)/);
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1"]); // c1 NOT sent
    // Continue: the compensation is resumed — r1 is never run again
    e.offlineSteps = undefined;
    await approveEdgeGate(e);
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "failed" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1", "c1"]);
    expect(e.authorizeCalls.map((a) => a.stepId).filter((x) => x === "r1")).toHaveLength(1);
    expect(runRow(c).status).toBe("failed");
    expect(runRow(e.runId).status).toBe("failed");
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(sentCommands(0, n0));
    expect(runRow(e.runId).contextJson.foeCompensationHeld).toBeUndefined(); // R-10-ae — no context mark: the ROWS decided
  });

  it("★ journal refuses a record BEFORE the send: the step is not sent, it is HELD; the segment ends held(journalFull)", async () => {
    const e = await edgeAssignedRun(def("jb-e", [gate(), move("r1"), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    const n0 = h.sent.length;
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "r1" && rec.status === "running";
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "journalFull" });
    expect(s2.out.error).toMatch(/^EDGE_HELD\(journalFull\)/);
    expect(h.sent.slice(n0)).toEqual([]);
    expect(e.authorizeCalls.filter((a) => a.claimSeq === 2)).toEqual([]); // nothing even asked
    expect(runRow(e.runId).status).toBe("held");
  });

  it("★ journal refuses the POST-SEND result: the step is OUTCOME-UNKNOWN — never sent again (no retry, not on Continue either); run held, then the step counts as failed", async () => {
    const e = await edgeAssignedRun(def("ja-e", [gate(), move("r1", { maxAttempts: 2, compensation: ot("c1") }), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    const n0 = h.sent.length;
    h.failPlan.set("r1", 1); // the first send is refused by the device ⇒ the walker would retry …
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "r1" && typeof (rec.result as any)?.routedTo === "string";
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "journalFull", outcomeUnknown: ["r1"] });
    expect(s2.out.error).toMatch(/^EDGE_OUTCOME_UNKNOWN\(r1\)/);
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1"]); // … but never re-sends it; r2 / c1 never sent
    expect(runRow(e.runId).status).toBe("held");
    expect(runRow(e.runId).contextJson.foeOutcomeUnknown).toEqual(["r1"]);
    // Continue: r1 is NOT sent again — it is a failure. R1b-2b-2a A2(n) (n4/n5): its compensation c1 is NOT a pinned STOP ⇒ it is NOT sent
    // automatically on a device whose state is unknown: the segment ends held(outcomeUnknown) + an anomaly central turns into the URGENT alert
    e.refuse = undefined;
    e.events = [];
    await approveEdgeGate(e);
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1"]); // ★ c1 not written
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r1")!.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN/);
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toMatchObject({ status: "held" });
    expect(runRow(e.runId).status).toBe("held");
    expect(runRow(e.runId).contextJson.foeKetCucKhongRo).toMatchObject({ stepId: "r1", compId: "c1", ma: "EDGE_OUTCOME_UNKNOWN", lan: "claim3" });
    expect(e.events!.filter((x) => x.code === "FOE_OUTCOME_UNKNOWN_COMPENSATION").map((x) => JSON.parse(x.detail))).toEqual([expect.objectContaining({ loai: "held", stepId: "r1", compId: "c1", claimSeq: 3 })]);
    // n3 — refused (nothing changes) for a supervisor WITHOUT machine-control rights, then without a reason; with both, ONLY c1 is sent
    // (r1 never again), the run fails
    await expect(approveEdgeGate(e)).rejects.toThrow(/only a person with machine-control rights/);
    grantMachineControl();
    await expect(approveEdgeGate(e)).rejects.toThrow(/reason is required/);
    expect(runRow(e.runId).status).toBe("held");
    expect((await continueOutcomeUnknown(e, "checked on site: r1 not applied")).status).toBe("queued");
    expect(runRow(e.runId).contextJson.foeKetCucKhongRo).toBeUndefined(); // the marker is cleared by that Continue
    const s4 = await edgeSegment(e, 4);
    expect(s4.out).toMatchObject({ outcome: "failed" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1", "c1"]);
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toMatchObject({ status: "compensated" });
  });

  it("★ a robot STOP job is a STOP for the edge even when the package does not list it (local classifier): it never asks, also offline", async () => {
    const e = await edgeAssignedRun(def("rs-local", [robotStop("s1")]));
    const pkg = await claimPackage(e, 1);
    (pkg as { verifiedStops: unknown[] }).verifiedStops = [];
    const asked: unknown[] = [];
    const store = createEdgeRunStore(pkg, {
      runId: e.runId,
      claimSeq: 1,
      claimToken: "ect_" + "d".repeat(43),
      sink: { run: async () => ({ seq: 1 }) },
      authorize: { authorize: async (i) => (asked.push(i), { ok: false, verdict: "unavailable", code: "network" }) },
    });
    expect(await driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store)).toMatchObject({ outcome: "completed" });
    expect(asked).toEqual([]);
    expect(h.sent.map((x) => x.stepId)).toEqual(["s1"]);
  });

  it("★ precondition abort: the edge segment ends ABORTED and central applies 'aborted' — as central's own walk", async () => {
    const pa = (ref: string) => def(ref, [gate(), move("r1", { precondition: { source: "telemetry", machineId: 1, key: "temp", op: "lt", value: 0 }, onPreconditionFail: "abort" }), move("r2")]);
    const c = await centralRun(pa("pa-c"), 1);
    const e = await edgeAssignedRun(pa("pa-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "aborted" });
    expect(runRow(c).status).toBe("aborted");
    expect(runRow(e.runId).status).toBe("aborted");
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(h.sent).toEqual([]);
  });

  it("★ OT PINNED STOP on the edge: never asks (L-7), sent with the package's pins — rows, commands and outcome = central's", async () => {
    fake.seed(deviceTags, [
      ...rows("device_tags"),
      { id: 73, adapterId: 501, tagKey: "halt", address: "00001", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true },
    ]);
    const ps = (ref: string) => def(ref, [gate(), ot("m1"), { id: "st", type: "command", machineId: 1, command: "stop", args: { tagKey: "halt", value: true } } as never]);
    const c = await centralRun(ps("ps-c"), 1);
    const n0 = h.sent.length;
    const e = await edgeAssignedRun(ps("ps-e"));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    await edgeSegment(e, 2);
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["m1", "st"]);
    expect(e.authorizeCalls.map((a) => a.stepId)).toEqual(["m1"]); // ★ the pinned STOP never asked
    expect((h.sent.slice(n0).find((x) => x.stepId === "st")!.edge as any).authorization).toBeNull();
    expect(walkerWritesEdge(e)).toEqual(walkerWritesCentral(c));
    expect(finalRows(e.runId)).toEqual(finalRows(c));
    expect(sentCommands(n0)).toEqual(sentCommands(0, n0));
    expect(runRow(e.runId).status).toBe("completed");
  });
});

describe("doc 81 Đợt 10 C fix review 1 — THE edge program-report rule (R-10-m) and the resend window from abortedAt", () => {
  it("★ one predicate: key, central capability, owner epoch (stored only), freshness — anything else is unreadable", async () => {
    const { edgeProgramCheckOf, edgeProgramPreOf, EDGE_HOLD_MARK_KEYS } = await import("../../edge/edgeProgramReportRule");
    const now = 1_800_000_000_000;
    const capable = { id: 501, edgeNodeId: 7, ownerEpoch: 3, protocol: "stub", connectionOptions: { simProgram: "P" }, code: "A501" };
    const r = (x: Record<string, unknown> = {}) => ({ adapterId: 501, edgeNodeId: 7, status: "verified", checksum: "c1", readAt: now - 1_000, ownerEpoch: 3, ...x });
    const S = { source: "stored" as const, nowMs: now, maxAgeMs: 120_000, skewMs: 5_000 };
    expect(edgeProgramCheckOf(7, capable, r(), S)).toMatchObject({ status: "verified", checksum: "c1", label: "A501", source: "edge" });
    expect(edgeProgramCheckOf(8, capable, r({ edgeNodeId: 8 }), S)).toMatchObject({ status: "unreadable" }); // not the owner
    expect(edgeProgramCheckOf(7, capable, r({ edgeNodeId: 8 }), S)).toMatchObject({ status: "unreadable" }); // another node's reading
    expect(edgeProgramCheckOf(7, capable, r({ adapterId: 502 }), S)).toMatchObject({ status: "unreadable" });
    expect(edgeProgramCheckOf(7, capable, r({ ownerEpoch: 2 }), S)).toMatchObject({ status: "unreadable", reason: "inconsistent" });
    expect(edgeProgramCheckOf(7, capable, r({ ownerEpoch: null }), S)).toMatchObject({ status: "unreadable" });
    expect(edgeProgramCheckOf(7, capable, r({ ownerEpoch: undefined }), { ...S, source: "live" })).toMatchObject({ status: "verified" }); // a live request reading
    expect(edgeProgramCheckOf(7, capable, r({ readAt: now - 126_000 }), S)).toMatchObject({ status: "unreadable", reason: "timeout" });
    expect(edgeProgramCheckOf(7, capable, r({ readAt: now - 124_000 }), S)).toMatchObject({ status: "verified" }); // within age + skew
    expect(edgeProgramCheckOf(7, capable, r({ readAt: now + 6_000 }), S)).toMatchObject({ status: "unreadable", reason: "timeout" });
    expect(edgeProgramCheckOf(7, capable, r({ status: "unsupported", checksum: null }), S)).toMatchObject({ status: "unreadable", reason: "inconsistent" });
    expect(edgeProgramCheckOf(7, capable, r({ status: "unreadable", checksum: null, reason: "notConnected" }), S)).toMatchObject({ status: "unreadable", reason: "notConnected" });
    expect(edgeProgramCheckOf(7, { ...capable, protocol: "modbus", connectionOptions: {} }, r(), S)).toMatchObject({ status: "unsupported" }); // central's capability
    const pre = edgeProgramPreOf(7, [capable, { ...capable, id: 9, edgeNodeId: 8 }], [r()], S);
    expect([...pre.keys()]).toEqual([501]);
    expect(pre.get(9)).toMatchObject({ status: "unreadable" }); // an unknown id is never read centrally
    expect(EDGE_HOLD_MARK_KEYS).toEqual(expect.arrayContaining(["edgeUnreachable", "edgeWaiting", "edgeWaitingAt", "edgeWaitingNode", "edgeHeld", "interrupted"]));
  });

  it("★ N4: Continue clears B's 'waiting' marks too", async () => {
    const e = await edgeAssignedRun(def("n4-w", [gate(), ot("m1")]));
    const r = runRow(e.runId);
    Object.assign(r, { status: "held", currentStepId: null, contextJson: { edgeWaiting: "capacity", edgeWaitingAt: "x", edgeWaitingNode: "EDGE-A", interrupted: true } });
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    await resumeRun(e.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(runRow(e.runId).contextJson).toEqual({ interruptedEarlier: true, edgeResumedBy: { userId: OTHER.id, at: expect.any(Number) } });
  });

  it("★ the edge's resend window counts from the ABORT (abortedAt), issuedAt only when it is absent", async () => {
    const { resendStopsOfAbortedRun } = await import("./foeEngine");
    const { createEdgeSweepStore } = await import("../../edge/edgeRunStore");
    const e = await edgeAssignedRun(def("rw-e", [move("r1"), robotStop("s1")]));
    const pkg = await claimPackage(e, 1);
    const pic = (x: Record<string, unknown>) => ({ ...pkg, kind: "sweep_picture", prior: { ...pkg.prior, settled: ["r1"], attempted: ["r1"] }, issuedAt: Date.now(), ...x }) as unknown as import("../../edge/edgeProtocol").EdgeSweepPicture;
    const user = { id: 0, role: "system", name: "edge" };
    const old = pic({ abortedAt: Date.now() - 16 * 60_000 }); // a fresh picture of an OLD abort
    expect(await resendStopsOfAbortedRun(old, user, createEdgeSweepStore(old, { abortStop: () => undefined }))).toMatchObject({ ok: false, reason: "resendTooOld" });
    expect(h.sent).toEqual([]);
    const recent = pic({ abortedAt: Date.now() - 60_000, issuedAt: Date.now() - 60 * 60_000 }); // abort recent ⇒ allowed
    expect(await resendStopsOfAbortedRun(recent, user, createEdgeSweepStore(recent, { abortStop: () => undefined }))).toMatchObject({ ok: true });
    expect(h.sent.map((x) => x.stepId)).toEqual(["s1"]);
    const { edgeSweepPictureSchema } = await import("../../edge/edgeProtocol");
    expect(edgeSweepPictureSchema.shape.abortedAt).toBeDefined(); // the signed picture can carry it
  });
});

describe("doc 81 Đợt 10 C fix review 1 — the edge assignment is read once and its read error is never swallowed", () => {
  it("★ assignment unreadable ⇒ the approver's screen gets NO digest (never a central controller read) and an approval is refused 'retry'", async () => {
    expect((await deployWorkflow(def("ae-c", [gate(), ot("m1")]), OWNER)).ok).toBe(true);
    const runId = (await startRun("ae-c", {}, OWNER)).runId!;
    const ok = (await getRun(runId, { bindingDigest: true }))!;
    expect(ok.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    const sel = FakeDb.prototype.select.bind(fake);
    (fake as any).select = (p?: unknown) => {
      const b = sel(p as never);
      const from = b.from.bind(b);
      b.from = (t: any) => {
        if (t?.[Symbol.for("drizzle:Name")] === "orchestration_run_edge_assignments") throw Object.assign(new Error("connection reset"), { code: "08006" });
        return from(t);
      };
      return b;
    };
    try {
      expect((await getRun(runId, { bindingDigest: true }))!.bindingDigest).toBeNull();
      const r = await resumeRun(runId, { approved: true, expectedStepId: "g1", expectedDefHash: ok.defHash!, expectedBindingDigest: ok.bindingDigest! }, OTHER);
      expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/could not be read — retry/) });
    } finally {
      (fake as any).select = sel;
    }
    expect(runRow(runId).status).toBe("awaiting_confirm");
  });
});

describe("doc 81 Đợt 10 C fix review 1 — the robot STOP classifier also feeds the local abort sweep", () => {
  it("★ a robot STOP the package does not list is still SENT by a local abort sweep (never left as a non-STOP)", async () => {
    const e = await edgeAssignedRun(def("rs-sweep", [move("r1"), { id: "d1", type: "delay", ms: 60_000 } as never, robotStop("s1")]));
    const pkg = await claimPackage(e, 1);
    (pkg as { verifiedStops: unknown[] }).verifiedStops = [];
    const records: EdgeRunRecordIn[] = [];
    const store = createEdgeRunStore(pkg, {
      runId: e.runId,
      claimSeq: 1,
      claimToken: "ect_" + "e".repeat(43),
      sink: { run: async (_r, _c, rec) => (records.push(rec), { seq: records.length }) },
      authorize: { authorize: async () => ({ ok: true, authorization: {} as never, claims: { jti: randomUUID(), approval: null }, ttlMs: 10_000, reqNonce: "n".repeat(32) }) },
    });
    const drive = driveEdgeRunFromPackage(pkg, { runId: e.runId, claimSeq: 1 }, store);
    await waitFor(() => records.some((r: any) => r.kind === "step" && r.stepId === "d1" && r.status === "running"), "d1 running");
    const live = await stopLiveRunForCentralAbort(e.runId, { id: 0, role: "system", name: "edge: central abort" });
    await drive;
    expect(live.abortStops).toMatchObject({ sent: ["s1"] });
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "s1"]);
  });
});

describe("doc 81 Đợt 10 C fix review 2 (R-10-ae) — what a Continue must never redo is read from the STEP ROWS", () => {
  const cp = (ref: string) => def(ref, [gate(), move("r1", { compensation: ot("c1", { args: { tagKey: "speed", value: 0 } }) })]);
  async function heldAtCompensation(ref: string, opts: { refuseContext?: boolean } = {}) {
    h.failPlan.set("r1", Infinity);
    const e = await edgeAssignedRun(cp(ref));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.offlineSteps = new Set(["c1"]);
    if (opts.refuseContext) e.refuse = (rec) => rec.kind === "context";
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held" });
    expect(runRow(e.runId).status).toBe("held");
    e.offlineSteps = undefined;
    e.refuse = undefined;
    return e;
  }

  it("★ the context mark STRIPPED (whatever a filter keeps): Continue still runs ONLY the compensation — r1 is never re-sent", async () => {
    const e = await heldAtCompensation("ae-strip");
    const ctx = runRow(e.runId).contextJson ?? {};
    delete ctx.foeCompensationHeld;
    delete ctx.foeOutcomeUnknown;
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r1: { state: "compensationHeld" } }); // central-written, from the rows
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "c1"]);
    expect(runRow(e.runId).status).toBe("failed");
  });

  it("★ the journal REFUSES the context record of the held segment: Continue still never re-sends r1", async () => {
    const e = await heldAtCompensation("ae-ctxref", { refuseContext: true });
    expect(runRow(e.runId).contextJson.foeCompensationHeld).toBeUndefined();
    await approveEdgeGate(e);
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "c1"]);
    expect(stepRows(e.runId).find((s) => s.stepId === "c1")).toMatchObject({ status: "compensated" });
  });

  it("★ a forged / stale context mark never decides: rows win (a 'held compensation' mark for a step the rows show completed changes nothing)", async () => {
    const e = await edgeAssignedRun(def("ae-forge", [gate(), ot("m1", { compensation: ot("c1") }), move("r2")]));
    await edgeSegment(e, 1);
    runRow(e.runId).contextJson = { ...(runRow(e.runId).contextJson ?? {}), foeCompensationHeld: { m1: "forged" }, foeResumeState: { m1: { state: "doneFailed", error: "forged" } } };
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toBeUndefined(); // replaced by the rows' (empty) state
    await edgeSegment(e, 2);
    expect(h.sent.map((x) => x.stepId)).toEqual(["m1", "r2"]);
    expect(runRow(e.runId).status).toBe("completed");
  });

  it("★ ambiguous rows (a compensation row, but the forward step's row does not say it failed) ⇒ the Continue is REFUSED, nothing changes", async () => {
    const e = await heldAtCompensation("ae-amb");
    stepRows(e.runId).find((s) => s.stepId === "r1")!.status = "held";
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    const r = await resumeRun(e.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/^EDGE_RESUME_AMBIGUOUS\(r1\)/) });
    expect(runRow(e.runId).status).toBe("held");
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1"]);
  });

  it("★ outcome unknown WITHOUT the prefix (the complete lost it): the authorisation ledger shows r1 issued with no result ⇒ never re-sent", async () => {
    const e = await edgeAssignedRun(def("ae-nopfx", [gate(), move("r1", { compensation: ot("c1") }), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "r1" && typeof (rec.result as any)?.routedTo === "string";
    e.stripEndUnknown = true;
    await edgeSegment(e, 2);
    expect(runRow(e.runId).contextJson.foeOutcomeUnknown).toBeUndefined(); // the hint never arrived
    e.refuse = undefined;
    e.stripEndUnknown = false;
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r1: { state: "outcomeUnknown" } });
    const s3 = await edgeSegment(e, 3);
    // R1b-2b-2a A2(n) — r1 once; its (non-STOP) compensation is HELD for a person, never sent by itself after the unknown outcome
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1"]);
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r1")!.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN/);
    // the Continue (person + reason) ⇒ the resume state derived from the rows carries the unknown flag; c1 sent once
    await continueOutcomeUnknown(e, "checked: r1 never moved");
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r1: { state: "compensationHeld", khongRo: true } });
    await edgeSegment(e, 4);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "c1"]);
  });

  it("★ edgeResumeStateOf: the rows' rule (sent ⇒ unknown, failed + comp held / running / absent ⇒ compensation, comp ended ⇒ done, else ambiguous)", async () => {
    const { edgeResumeStateOf } = await import("./foeRunStore");
    const d = def("x", [ot("a"), ot("b", { compensation: ot("bc") }), ot("c", { compensation: ot("cc") }), ot("e", { compensation: ot("ec") }), ot("f", { compensation: ot("fc") }), ot("g"), ot("h")]);
    const row = (stepId: string, status: string, x: Record<string, unknown> = {}) => ({ stepId, status, resultJson: null, error: null, ...x });
    const out = edgeResumeStateOf(
      d,
      [
        row("a", "running", { resultJson: { routedTo: "ot-dispatcher" } }), // sent, no final ⇒ unknown
        row("b", "failed", { error: "boom" }),
        row("bc", "held"), // ⇒ compensation resumed
        row("c", "failed"),
        row("cc", "compensated"), // ⇒ done
        row("e", "completed"),
        row("ec", "held"), // forward completed but its compensation held ⇒ ambiguous
        row("f", "failed"), // compensation never started ⇒ resumed
        row("g", "running"), // authorised, no result ⇒ unknown (ledger)
        row("h", "completed"),
        row("abort:a", "completed"),
      ],
      new Set(["g", "h"]),
    );
    expect(out.state).toEqual({
      a: expect.objectContaining({ state: "outcomeUnknown" }),
      g: expect.objectContaining({ state: "outcomeUnknown" }),
      b: { state: "compensationHeld", error: "boom" },
      c: { state: "doneFailed", error: "" },
      f: { state: "compensationHeld", error: "" },
    });
    expect(out.ambiguous).toEqual(["e"]);
    expect(edgeResumeStateOf(d, [row("a", "held")], new Set(), ["a"]).state).toMatchObject({ a: { state: "outcomeUnknown" } }); // a hint only ADDS
  });

  it("★ the real context filter: only the walker's own keys pass; central's keys are refused (and reported when they would change)", () => {
    const r = edgeContextPatchOf(
      { "branch:b1": "then", foeDispatchedSteps: ["m1"], telemetry: {}, states: {}, foeResumeState: { r1: { state: "doneFailed" } }, foeOutcomeUnknown: [], interrupted: false, startedViaApi: false },
      { foeOutcomeUnknown: [] },
    );
    expect(Object.keys(r.patch).sort()).toEqual(["branch:b1", "foeDispatchedSteps", "states", "telemetry"]);
    expect(r.refusedKeys.sort()).toEqual(["foeResumeState", "interrupted", "startedViaApi"]);
  });
});

describe("doc 81 Đợt 10 C fix review 2 — a COMPENSATION sent with an unknown outcome is never sent again", () => {
  it("★ c1 sent, its result refused by the journal ⇒ held; Continue: neither r1 nor c1 is sent again, the run fails", async () => {
    h.failPlan.set("r1", Infinity);
    const e = await edgeAssignedRun(def("ae-cu", [gate(), move("r1", { compensation: ot("c1") })]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "c1" && typeof (rec.result as any)?.routedTo === "string";
    e.stripEndUnknown = true; // and the prefix is lost too: the rows + the ledger alone decide
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held" });
    e.refuse = undefined;
    e.stripEndUnknown = false;
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r1: { state: "compensationHeld" }, c1: { state: "outcomeUnknown" } });
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "c1"]);
    expect(String(stepRows(e.runId).find((s) => s.stepId === "c1")!.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN/);
    expect(runRow(e.runId).status).toBe("failed");
  });
});

describe("doc 81 Đợt 10 C fix review 3 (R-10-ao) — ANY authorisation on a non-final row means sent; STOPs are always re-sent; only 42P01 means no ledger", () => {
  it("★ N1 real ordering: the ledger result reached central (resultReportedAt set) but the result row and the prefix were lost ⇒ r1 is never re-sent", async () => {
    const e = await edgeAssignedRun(def("ao-n1", [gate(), move("r1"), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "r1" && typeof (rec.result as any)?.routedTo === "string";
    e.stripEndUnknown = true;
    await edgeSegment(e, 2);
    expect((fake.store.get("edge_step_authorizations") ?? []).find((a) => a.runId === e.runId && a.stepId === "r1")!.resultReportedAt).toBeInstanceOf(Date);
    e.refuse = undefined;
    e.stripEndUnknown = false;
    await approveEdgeGate(e);
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1"]);
    expect(String(stepRows(e.runId).find((s) => s.stepId === "r1")!.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN/);
  });

  it("★ N1 compensation + retry: a compensation and a retried attempt whose ledger result is reported are not re-sent either", async () => {
    const { edgeResumeStateOf } = await import("./foeRunStore");
    const d = def("x", [move("r1", { maxAttempts: 2, compensation: ot("c1") })]);
    const row = (stepId: string, status: string) => ({ stepId, status, resultJson: null, error: null });
    // r1 failed, c1 authorised + its result reported, row still running ⇒ c1 unknown; r1 resumes only the (unknown) compensation
    expect(edgeResumeStateOf(d, [row("r1", "failed"), row("c1", "running")], new Set(["c1"])).state).toMatchObject({ c1: { state: "outcomeUnknown" }, r1: { state: "compensationHeld" } });
    // r1 retried: attempt 2 authorised (any result) on a running row ⇒ unknown
    expect(edgeResumeStateOf(d, [row("r1", "running")], new Set(["r1"])).state).toMatchObject({ r1: { state: "outcomeUnknown" } });
  });

  it("★ N2 a STOP is never outcome-unknown: on Continue it is SENT again (L-7) — rows, ledger and hints alike", async () => {
    const e = await edgeAssignedRun(def("ao-n2", [gate(), move("r1"), robotStop("s1"), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    // held at r2; the STOP's FINAL row is lost (its row still 'running' with a dispatch result) and the end names it unknown
    e.offlineSteps = new Set(["r2"]);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held" });
    Object.assign(stepRows(e.runId).find((s) => s.stepId === "s1")!, { status: "running" });
    runRow(e.runId).contextJson = { ...(runRow(e.runId).contextJson ?? {}), foeOutcomeUnknown: ["s1"] };
    e.offlineSteps = undefined;
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState?.s1).toBeUndefined();
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "s1", "s1"]); // the STOP again; r1 never; r2 not sent: the end named a command unknown, the run is latched (A2(n) extension)
    const { edgeResumeStateOf } = await import("./foeRunStore");
    const d = def("y", [robotStop("s9")]);
    expect(edgeResumeStateOf(d, [{ stepId: "s9", status: "running", resultJson: { routedTo: "robot-dispatcher" } }], new Set(["s9"]), ["s9"], new Set(["s9"])).state).toEqual({});
  });

  it("★ N3 only 42P01 (no table) means 'no ledger'; any other ledger error (42703, 42883, a connection error) refuses the Continue", async () => {
    for (const [code, refused] of [["42703", true], ["42883", true], ["08006", true], ["42P01", false]] as const) {
      const e = await edgeAssignedRun(def(`ao-n3-${code}`, [gate(), ot("m1")]));
      await edgeSegment(e, 1);
      const sel = FakeDb.prototype.select.bind(fake);
      (fake as any).select = (p?: unknown) => {
        const b = sel(p as never);
        const from = b.from.bind(b);
        b.from = (t: any) => {
          if (t?.[Symbol.for("drizzle:Name")] === "edge_step_authorizations") throw Object.assign(new Error("ledger"), { code });
          return from(t);
        };
        return b;
      };
      try {
        const view = (await getRun(e.runId, { bindingDigest: true }))!;
        const r = await resumeRun(e.runId, { approved: true, expectedStepId: "g1", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
        if (refused) expect(r, code).toMatchObject({ ok: false, message: expect.stringMatching(/could not be read to continue it safely/) });
        else expect(r, code).toMatchObject({ ok: true, status: "queued" });
      } finally {
        (fake as any).select = sel;
      }
    }
  });
});

describe("doc 81 Đợt 10 C fix review 4 (B F-B2-1) — a Continue of a held edge run records the RESUMER; /authorize uses that role", () => {
  it("★ Continue records edgeResumedBy {userId, at} (central-only); a gate approval does not; an edge patch can never set it; B's actor rule then takes the resumer", async () => {
    const { EDGE_RESUMED_BY_CTX_KEY, edgeEngineActorOf } = await import("../../edge/edgeAuthorizeCentral");
    const e = await edgeAssignedRun(def("rb-e", [gate(), move("r1"), move("r2")]));
    await edgeSegment(e, 1);
    await approveEdgeGate(e); // gate path: OTHER approves g1
    expect(runRow(e.runId).contextJson?.[EDGE_RESUMED_BY_CTX_KEY]).toBeUndefined();
    const gateAt = new Date(stepRows(e.runId).find((s) => s.stepId === "g1")!.finishedAt).getTime();
    expect(edgeEngineActorOf(runRow(e.runId).contextJson, { approvedBy: OTHER.id, at: gateAt })).toEqual({ userId: OTHER.id, path: "gate" });
    e.offlineSteps = new Set(["r2"]);
    await edgeSegment(e, 2); // held at r2
    expect(runRow(e.runId).status).toBe("held");
    e.offlineSteps = undefined;
    const RESUMER = { id: 14, role: "supervisor", name: "resumer" };
    // A2 test — the resume must land in a LATER millisecond than the gate approval: on a tie edgeEngineActorOf is (rightly)
    // unknown, and a fast run used to make both stamps equal (flaky {gate} / now {unknown}). Wait until the clock has passed gateAt.
    while (Date.now() <= gateAt) await new Promise((r) => setTimeout(r, 1));
    const t0 = Date.now();
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    expect((await resumeRun(e.runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, RESUMER)).status).toBe("queued");
    const rec = runRow(e.runId).contextJson[EDGE_RESUMED_BY_CTX_KEY];
    expect(rec).toMatchObject({ userId: RESUMER.id });
    expect(rec.at).toBeGreaterThanOrEqual(t0);
    expect(rec.at).toBeGreaterThan(gateAt);
    // B's /authorize rule: the held path ⇒ the RESUMER (its role is then read for the engine policy)
    expect(edgeEngineActorOf(runRow(e.runId).contextJson, { approvedBy: OTHER.id, at: gateAt })).toEqual({ userId: RESUMER.id, path: "held" });
    // an edge context patch can never set (or overwrite) it
    const forged = edgeContextPatchOf({ [EDGE_RESUMED_BY_CTX_KEY]: { userId: OTHER.id, at: Date.now() + 1 }, "branch:x": "then" }, runRow(e.runId).contextJson);
    expect(forged.patch).toEqual({ "branch:x": "then" });
    expect(forged.refusedKeys).toEqual([EDGE_RESUMED_BY_CTX_KEY]);
  });

  it("★ the key is the same name B reads; a CENTRAL (non-edge) Continue writes nothing new", async () => {
    const rule = await import("../../edge/edgeProgramReportRule");
    const b = await import("../../edge/edgeAuthorizeCentral");
    expect(rule.EDGE_RESUMED_BY_CTX_KEY).toBe(b.EDGE_RESUMED_BY_CTX_KEY);
    expect((await deployWorkflow(def("rb-c", [gate(), ot("m1")]), OWNER)).ok).toBe(true);
    const runId = (await startRun("rb-c", {}, OWNER)).runId!;
    Object.assign(runRow(runId), { status: "held", currentStepId: null, contextJson: { interrupted: true } });
    await resumeRun(runId, { approved: true, note: "auto-resume (FOE_DURABLE)" }, { id: 0, role: "system", name: "FOE auto-resume" });
    expect(runRow(runId).contextJson).toMatchObject({ interrupted: true });
    expect(runRow(runId).contextJson).not.toHaveProperty("edgeResumedBy");
  });
});

describe("doc 81 Đợt 10 C fix review 5 (R-10-bn) — an edge assignment names only devices the node owns", () => {
  it("★ a robot / adapter the node does not own, an unresolvable device, or unreadable ownership ⇒ the run is NOT created; owned ⇒ created; central runs unaffected", async () => {
    const runsBefore = () => rows("orchestration_runs").length;
    expect((await deployWorkflow(def("own-r", [gate(), move("m1")]), OWNER)).ok).toBe(true);
    h.foreignRobots.add(2);
    let n = runsBefore();
    const r1 = await startRun("own-r", {}, OWNER, { edgeNodeId: NODE });
    expect(r1).toMatchObject({ ok: false, message: expect.stringMatching(/does not own \(robot 2\)/) });
    expect(runsBefore()).toBe(n);
    expect(rows("orchestration_run_edge_assignments")).toEqual([]);
    // the same definition walked centrally is unaffected
    expect((await startRun("own-r", {}, OWNER)).status).toBe("awaiting_confirm");
    h.foreignRobots.clear();
    expect(await startRun("own-r", {}, OWNER, { edgeNodeId: NODE })).toMatchObject({ ok: true, status: "queued" });
    // an OT adapter it does not own — a STOP step's target counts too
    expect((await deployWorkflow(def("own-a", [gate(), robotStop("s0"), ot("m1")]), OWNER)).ok).toBe(true);
    h.foreignAdapters.add(501);
    n = runsBefore();
    expect(await startRun("own-a", {}, OWNER, { edgeNodeId: NODE })).toMatchObject({ ok: false, message: expect.stringMatching(/adapter 501/) });
    h.foreignAdapters.clear();
    h.foreignRobots.add(2);
    expect(await startRun("own-a", {}, OWNER, { edgeNodeId: NODE })).toMatchObject({ ok: false, message: expect.stringMatching(/robot 2/) }); // the STOP's robot
    h.foreignRobots.clear();
    expect(runsBefore()).toBe(n);
    // ownership unreadable ⇒ refused (fail closed)
    h.ownershipThrows = true;
    expect(await startRun("own-a", {}, OWNER, { edgeNodeId: NODE })).toMatchObject({ ok: false, message: expect.stringMatching(/could not be verified/) });
    h.ownershipThrows = false;
    // an OT step whose adapter cannot be resolved (two enabled adapters on its machine) ⇒ refused
    fake.seed(deviceAdapters, [...rows("device_adapters"), { id: 502, machineId: 1, isEnabled: true, updatedAt: T0, protocol: "stub", code: "A502" }]);
    expect(await startRun("own-a", {}, OWNER, { edgeNodeId: NODE })).toMatchObject({ ok: false, stepIds: ["m1"], message: expect.stringMatching(/cannot be resolved \(m1\)/) });
    expect(runsBefore()).toBe(n);
  });
});

describe("R1b-2b-2a A2(n) fix round 1 — the edge routes of an unknown outcome (C-1, C-2 (b)(c)(d), I-5, R-2)", () => {
  const box = (id: string, steps: WorkflowStep[], compensation: WorkflowStep): WorkflowStep => ({ id, type: "sequence", steps, compensation }) as never;
  const par = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: true, steps }) as never;
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    return e;
  }

  it("★ C-1 + R-2 a robot STOP on the container goes out at once behind the held child; Continue (person + reason) sends only the child's compensation, the STOP never again", async () => {
    const e = await denBuoc(def("n1-c1", [gate(), box("box", [move("r1", { compensation: ot("c1") })], robotStop("bs"))]));
    h.timeoutDispatch.add("r1");
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1", "bs"]); // ★ the STOP, no person; the reset-like c1 not
    await continueOutcomeUnknown(e, "checked");
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "failed" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1", "bs", "c1"]); // bs is not re-sent
  });

  it("★ R-2 a robot STOP compensation runs by itself on the edge too (no hold)", async () => {
    const e = await denBuoc(def("n1-r2", [gate(), move("r1", { compensation: robotStop("bs") })]));
    h.timeoutDispatch.add("r1");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "failed" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "bs"]);
  });

  it("★ C-2 (b) a gate in a sibling branch: held(outcomeUnknown), not paused; the approval needs the check", async () => {
    const e = await denBuoc(def("n1-b", [gate(), par("p", [move("r1", { compensation: ot("c1") }), gate("g2")])]));
    h.timeoutDispatch.add("r1");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(runRow(e.runId).status).toBe("held");
    grantMachineControl();
    await expect(approveEdgeGate(e)).rejects.toThrow(/reason is required/);
    expect(h.sent.some((x) => x.stepId === "c1")).toBe(false);
  });

  it("★ C-2 (c) a sibling's held reason never overwrites outcomeUnknown (one field, last write wins before): the marker and the check stay", async () => {
    // the sibling's refusal comes AFTER the hold (a delay first), so a plain last-write-wins field would end on its reason
    const later = { id: "later", type: "sequence", steps: [{ id: "w", type: "delay", ms: 80 }, move("r2")] } as never;
    const e = await denBuoc(def("n1-c", [gate(), par("p", [later, move("r1", { compensation: ot("c1") })])]));
    h.timeoutDispatch.add("r1");
    e.offlineSteps = new Set(["r2"]);
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(runRow(e.runId).contextJson.foeKetCucKhongRo).toMatchObject({ stepId: "r1", compId: "c1" });
    await expect(approveEdgeGate(e)).rejects.toThrow(/machine-control rights/);
  });

  it("★ C-2 (c) + I-5 a full journal during the hold: the run stream refused the compensation's row, the events journal the anomaly ⇒ still held(outcomeUnknown), the marker, the check, and the URGENT rides on the segment end", async () => {
    const e = await denBuoc(def("n1-j", [gate(), move("r1", { compensation: ot("c1") })]));
    h.timeoutDispatch.add("r1");
    e.refuse = (rec) => rec.kind === "step" && rec.stepId === "c1";
    e.eventsRefused = true;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(runRow(e.runId).contextJson.foeKetCucKhongRo).toMatchObject({ stepId: "r1", compId: "c1", lan: "claim2" });
    expect(String(runRow(e.runId).error)).not.toContain("[[A2N"); // stripped: never in the run's error
    await waitFor(() => h.alerts.length > 0, "the URGENT");
    expect(h.alerts[0]).toMatchObject({ kind: "foe_outcome_unknown_compensation_held", dedupKey: `foe_outcome_unknown_compensation_held:${e.runId}:r1:c1:claim2` });
    expect(h.alerts[0]!.recipients).toContain(OWNER.id); // ★ it reaches a person
    e.refuse = undefined;
    await expect(approveEdgeGate(e)).rejects.toThrow(/machine-control rights/);
    expect(h.sent.some((x) => x.stepId === "c1")).toBe(false);
  });

  it("★ the STOP case too: a full events journal does not lose 'STOP compensation sent' (the segment end carries it)", async () => {
    const e = await denBuoc(def("n1-js", [gate(), move("r1", { compensation: robotStop("bs") })]));
    h.timeoutDispatch.add("r1");
    e.eventsRefused = true;
    await edgeSegment(e, 2);
    await waitFor(() => h.alerts.length > 0, "the URGENT");
    expect(h.alerts[0]!.kind).toMatch(/^foe_outcome_unknown_stop_compensation_/);
  });

  it("★ C-2 (d) the node died after the step's failed row, before the compensation row: no marker, a plain interrupted hold ⇒ the Continue still needs person + reason; the walker writes it only then", async () => {
    const e = await denBuoc(def("n1-d", [gate(), move("r1", { compensation: ot("c1") })]));
    runRow(e.runId).status = "running";
    await recordEdgeStepRows(fake as never, e.runId, [{ stepId: "r1", stepType: "command", status: "failed", attempt: 1, startedAt: null, finishedAt: new Date(), error: "EDGE_OUTCOME_UNKNOWN: command r1", result: undefined }]);
    runRow(e.runId).status = "held";
    runRow(e.runId).contextJson = { interrupted: true };
    await expect(approveEdgeGate(e)).rejects.toThrow(/machine-control rights/);
    grantMachineControl();
    await expect(approveEdgeGate(e)).rejects.toThrow(/reason is required/);
    expect(runRow(e.runId).status).toBe("held");
    expect((await continueOutcomeUnknown(e, "checked: r1 did not move")).status).toBe("queued");
    expect(runRow(e.runId).contextJson.foeKetCucKhongRoDuyet).toMatchObject({ stepIds: ["r1"], by: OTHER.id });
    await edgeSegment(e, 2);
    expect(h.sent.map((x) => x.stepId)).toEqual(["c1"]);
  });

  it("★ C-2 the walker keys on the same fact: a resume state that names a held compensation WITHOUT a Continue's approval is never written — it is split again", async () => {
    const e = await denBuoc(def("n1-w", [gate(), move("r1", { compensation: ot("c1") })]));
    runRow(e.runId).contextJson = { ...(runRow(e.runId).contextJson ?? {}), foeResumeState: { r1: { state: "compensationHeld", error: "EDGE_OUTCOME_UNKNOWN: x", khongRo: true } } };
    const s = await edgeSegment(e, 2);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.some((x) => x.stepId === "c1")).toBe(false);
  });

  it("★ I-4 edge: Continue writes the held compensation and nothing forward: a failed sibling with no compensation is doneFailed, not re-sent", async () => {
    h.failPlan.set("r2", 1);
    const e = await denBuoc(def("n1-f", [gate(), par("p", [move("r1", { compensation: ot("c1") }), move("r2")])]));
    h.timeoutDispatch.add("r1");
    await edgeSegment(e, 2);
    const n0 = h.sent.length;
    await continueOutcomeUnknown(e, "checked");
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r2: { state: "doneFailed" }, r1: { state: "compensationHeld", khongRo: true } });
    await edgeSegment(e, 3);
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["c1"]);
  });
});

describe("R1b-2b-2a A2(n) fix round 2 — the edge: the unknown flag outranks a sibling, a Continue walks the held compensations only (C-A, I-A, I-E)", () => {
  const box = (id: string, steps: WorkflowStep[], compensation?: WorkflowStep): WorkflowStep => ({ id, type: "sequence", steps, ...(compensation ? { compensation } : {}) }) as never;
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as never;
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    return e;
  }
  const lai = { id: "w", type: "delay", ms: 60 } as never;

  it("★ C-A (a) a gate beside the unknown branch: the container's robot STOP goes at once, the segment ends paused, and the paused end carries the URGENT on a full events journal", async () => {
    const e = await denBuoc(def("n2-a", [gate(), par("p", [move("r1"), gate("g2")], { compensation: robotStop("bs") })]));
    h.timeoutDispatch.add("r1");
    e.eventsRefused = true;
    const n0 = h.sent.length;
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "paused", gateStepId: "g2" });
    expect(h.sent.slice(n0).map((x) => x.stepId)).toEqual(["r1", "bs"]); // ★ no approval needed
    // two reports ride on this end (the I-L one too): both are read from the rider, because two concurrent first imports of the mocked alert in one test race the vi.mock factory (seen: the second gets the real one)
    expect(String(s2.out.error)).toMatch(/"loai":"stop[A-Za-z]+","stepId":"p","compId":"bs"/);
    await waitFor(() => h.alerts.length > 0, "the URGENT");
    expect(String(runRow(e.runId).error ?? "")).not.toContain("[[A2N");
  });

  it("★ C-A (c) a sibling held for ANOTHER reason: the container's STOP still goes, and it is told", async () => {
    const e = await denBuoc(def("n2-c", [gate(), par("p", [move("r1"), box("later", [lai, move("r2")])], { compensation: robotStop("bs") })]));
    h.timeoutDispatch.add("r1");
    e.offlineSteps = new Set(["r2"]);
    e.events = [];
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "bs"]);
    expect(e.events.filter((x) => x.code === "FOE_OUTCOME_UNKNOWN_COMPENSATION" && !String(x.detail).includes('"noCompensation"'))).toHaveLength(1); // the I-L one goes too
  });

  it("★ I-E an unknown step with no compensation is NEVER re-sent on a new claim: gate sibling, approval, next segment", async () => {
    const e = await denBuoc(def("n2-e", [gate(), par("p", [move("r1"), gate("g2")]), move("r9")]));
    h.timeoutDispatch.add("r1");
    await edgeSegment(e, 2);
    h.timeoutDispatch.clear();
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState).toMatchObject({ r1: { state: "doneFailed", khongRo: true } });
    const n1 = h.sent.length;
    const s3 = await edgeSegment(e, 3);
    expect(h.sent.slice(n1).map((x) => x.stepId)).toEqual([]); // ★ neither r1 again nor forward
    expect(s3.out).toMatchObject({ outcome: "failed" });
  });

  it("★ I-E the walker's crash after the failed row, a plain Continue: r1 is not re-sent (the first review's second shape)", async () => {
    const e = await denBuoc(def("n2-e2", [gate(), move("r1")]));
    runRow(e.runId).status = "running";
    await recordEdgeStepRows(fake as never, e.runId, [{ stepId: "r1", stepType: "command", status: "failed", attempt: 1, startedAt: null, finishedAt: new Date(), error: "FOE_OUTCOME_UNKNOWN: command r1", result: undefined }]);
    runRow(e.runId).status = "held";
    runRow(e.runId).contextJson = { interrupted: true };
    await approveEdgeGate(e); // no compensation pending: an ordinary Continue
    await edgeSegment(e, 2);
    expect(h.sent.map((x) => x.stepId)).toEqual([]);
    expect(runRow(e.runId).status).toBe("failed");
  });

  it("★ I-A the walk under a Continue reads no precondition and sends nothing forward: a sibling held by the edge stays unsent, the next step too", async () => {
    const e = await denBuoc(def("n2-i", [gate(), par("p", [move("r1", { compensation: ot("c1") }), box("later", [lai, move("r2")])]), move("r9")]));
    h.timeoutDispatch.add("r1");
    e.offlineSteps = new Set(["r2"]);
    await edgeSegment(e, 2);
    e.offlineSteps = undefined;
    h.timeoutDispatch.clear();
    const n1 = h.sent.length;
    await continueOutcomeUnknown(e, "checked");
    const s3 = await edgeSegment(e, 3);
    expect(h.sent.slice(n1).map((x) => x.stepId)).toEqual(["c1"]);
    expect(s3.out).toMatchObject({ outcome: "failed" });
  });

  it("★ M-1 a lost final row: running + a held compensation row keeps the flag, the Continue needs person + reason", async () => {
    const e = await denBuoc(def("n2-m", [gate(), move("r1", { compensation: ot("c1") })]));
    runRow(e.runId).status = "running";
    await recordEdgeStepRows(fake as never, e.runId, [
      { stepId: "r1", stepType: "command", status: "running", attempt: 1, startedAt: new Date(), finishedAt: null, error: null, result: undefined },
      { stepId: "c1", stepType: "command", status: "held", attempt: 0, startedAt: null, finishedAt: new Date(), error: "x", result: undefined },
    ]);
    runRow(e.runId).status = "held";
    runRow(e.runId).contextJson = { interrupted: true };
    await expect(approveEdgeGate(e)).rejects.toThrow(/machine-control rights/);
    expect(h.sent).toEqual([]);
  });

  it("★ M-2 a forged report on the end never raises an alert: another claim, a step that is not in the definition", async () => {
    const e = await denBuoc(def("n2-f", [gate(), move("r1")]));
    runRow(e.runId).status = "running";
    const { ganBaoCaoKhongRoEdge } = await import("./foeKetCucKhongRo");
    const d = rows("orchestration_workflows").find((w) => w.id === runRow(e.runId).workflowId)!.definitionJson as WorkflowDefinition;
    const gia = ganBaoCaoKhongRoEdge(
      "x",
      [
        { loai: "held", stepId: "forged", compId: "c", ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 2 },
        { loai: "held", stepId: "r1", compId: "-", ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 9 },
      ],
      4_000,
    );
    await applyEdgeSegmentEnd(fake as never, e.runId, { outcome: "failed", error: gia, nodeCode: "EDGE-A", claimSeq: 2, def: d });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.alerts).toEqual([]);
  });
});

describe("R1b-2b-2a A2(n) fix round 3 — the edge: S-1, C-B", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown>): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    return e;
  }

  it("★ C-B a container with a retry budget: r1 is not asked again, its reset is NOT sent, held(outcomeUnknown), the row keeps the code", async () => {
    const e = await denBuoc(def("n3-b", [gate(), box("box", [move("r1")], { maxAttempts: 1, compensation: ot("boxUndo") })]));
    h.timeoutDispatch.add("r1");
    e.events = [];
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1"]);
    expect(e.authorizeCalls.filter((a) => a.stepId === "r1" && a.claimSeq === 2)).toHaveLength(1);
    expect(String(stepRows(e.runId).find((x) => x.stepId === "r1")!.error)).toMatch(/OUTCOME_UNKNOWN/);
  });

  // write-only: GREEN under mutant S1a, RED under S1b (see the unit file)
  it("S1W edge: a container's non-STOP compensation is not sent", async () => {
    const e = await denBuoc(def("n3-s", [gate(), box("box", [move("r1")], { compensation: ot("boxUndo") })]));
    h.timeoutDispatch.add("r1");
    await edgeSegment(e, 2);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1"]);
  });

  // a re-walk: the deciding branch is gone, only the state central derived says unknown; the container's own branches send its STOP
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown>): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as never;
  const trangThai = (e: EdgeHarness, r: Record<string, unknown>) => void (runRow(e.runId).contextJson = { ...(runRow(e.runId).contextJson ?? {}), foeResumeState: r });
  it("★ C-1 on a re-walk: the child held again by the walker, the container's STOP goes", async () => {
    const e = await denBuoc(def("n3-w1", [gate(), box("box", [move("r1", { compensation: ot("c1") })], { compensation: robotStop("bs") })]));
    trangThai(e, { r1: { state: "compensationHeld", error: "EDGE_OUTCOME_UNKNOWN: x", khongRo: true } });
    await edgeSegment(e, 2);
    expect(h.sent.map((x) => x.stepId)).toEqual(["bs"]);
  });
  it("★ C-A on a re-walk: a gate beside the unknown branch, the container's STOP goes", async () => {
    const e = await denBuoc(def("n3-w2", [gate(), par("p", [move("r1"), gate("g2")], { compensation: robotStop("bs") })]));
    trangThai(e, { r1: { state: "doneFailed", error: "EDGE_OUTCOME_UNKNOWN: x", khongRo: true } });
    const s = await edgeSegment(e, 2);
    expect(s.out).toMatchObject({ outcome: "paused" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["bs"]);
  });
  it("★ C-A on a re-walk: a sibling held for another reason, the container's STOP goes", async () => {
    const e = await denBuoc(def("n3-w3", [gate(), par("p", [move("r1"), move("r2")], { compensation: robotStop("bs") })]));
    trangThai(e, { r1: { state: "doneFailed", error: "EDGE_OUTCOME_UNKNOWN: x", khongRo: true } });
    e.offlineSteps = new Set(["r2"]);
    const s = await edgeSegment(e, 2);
    expect(s.out).toMatchObject({ outcome: "held" });
    expect(h.sent.map((x) => x.stepId)).toEqual(["bs"]);
  });

  it("S-1 edge: a re-walk reads the latch from the resume state: a KNOWN failure of the segment is held, its compensation not sent", async () => {
    const e = await denBuoc(def("n3-r", [gate(), box("box", [move("r1", { compensation: ot("c1") })], { compensation: ot("boxUndo") })]));
    h.timeoutDispatch.add("r1");
    await edgeSegment(e, 2);
    await continueOutcomeUnknown(e, "checked");
    await edgeSegment(e, 3);
    expect(h.sent.map((x) => x.stepId)).toEqual(["r1", "c1"]); // the approved one only
    expect(stepRows(e.runId).find((x) => x.stepId === "boxUndo")).toMatchObject({ status: "held" });
  });
});

describe("R1b-2b-2a A2(n) fix round 4 — the edge: THE fact crosses a segment boundary, THE sink is the same line, /authorize is the second check", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown>): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown>): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    return e;
  }
  const ids = () => h.sent.map((x) => x.stepId);
  const baoCua = (e: EdgeHarness, loai: keyof typeof CANH_BAO_KHONG_RO_KIND) => (e.events ?? []).filter((v) => v.kind === "anomaly" && String(v.detail).includes(`"loai":"${loai}"`));
  const dieuTiep = async (e: EdgeHarness) => {
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    return resumeRun(e.runId, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  };

  it("★ C-C (P1) a compensation's own unknown beside a gate: the row has the code, the gate approval carries the latch, the container's compensation is HELD, a person told", async () => {
    const e = await denBuoc(def("n4-p1", [gate(), par("box", [move("x", { compensation: ot("u") }), gate("g2")], { compensation: ot("boxUndo") })]));
    h.failPlan.set("x", 1);
    h.timeoutDispatch.add("u");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "paused" });
    expect(String(stepRows(e.runId).find((r) => r.stepId === "u")!.error)).toMatch(/^FOE_OUTCOME_UNKNOWN/);
    expect(baoCua(e, "compensationUnknown")).toHaveLength(1); // I-I on the edge
    h.timeoutDispatch.delete("u");
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toBeTruthy();
    const s3 = await edgeSegment(e, 3);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(ids()).toEqual(["x", "u"]);
    expect(baoCua(e, "held")).toHaveLength(1);
    expect(stepRows(e.runId).find((r) => r.stepId === "boxUndo")).toMatchObject({ status: "held" });
  });

  it("★ C-C (P2) a STOP-typed step unknown beside a gate; its next answer is known: the container's compensation is HELD", async () => {
    const e = await denBuoc(def("n4-p2", [gate(), par("box", [robotStop("st"), gate("g2")], { compensation: ot("boxUndo") })]));
    h.timeoutDispatch.add("st");
    await edgeSegment(e, 2);
    expect(String(stepRows(e.runId).find((r) => r.stepId === "st")!.error)).toMatch(/OUTCOME_UNKNOWN/);
    h.timeoutDispatch.delete("st");
    h.failPlan.set("st", 1);
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "st" });
    const s3 = await edgeSegment(e, 3);
    expect(ids().filter((x) => x === "boxUndo")).toHaveLength(0);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
  });

  it("★ C-C (P3) the same behind a held sibling and a PLAIN Continue: the compensation is held, a person told; its Continue needs the n3 check", async () => {
    const e = await denBuoc(def("n4-p3", [gate(), par("box", [move("x", { compensation: ot("u") }), move("r2")], { compensation: ot("boxUndo") })]));
    h.failPlan.set("x", 1);
    h.timeoutDispatch.add("u");
    e.offlineSteps = new Set(["r2"]);
    await edgeSegment(e, 2);
    h.timeoutDispatch.delete("u");
    e.offlineSteps = undefined;
    await dieuTiep(e);
    const s3 = await edgeSegment(e, 3);
    expect(ids().filter((x) => x === "boxUndo")).toHaveLength(0);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(baoCua(e, "held").length).toBeGreaterThan(0);
    await expect(dieuTiep(e)).rejects.toThrow(/machine-control rights/); // n3: no plain Continue past this hold
    await continueOutcomeUnknown(e, "checked");
    await edgeSegment(e, 4);
    expect(ids().filter((x) => x === "boxUndo")).toHaveLength(1);
  });

  it("★ C-C the rider of the end is lost: the ROWS alone carry the latch across the hand-back", async () => {
    const e = await denBuoc(def("n4-p1r", [gate(), par("box", [move("x", { compensation: ot("u") }), gate("g2")], { compensation: ot("boxUndo") })]));
    h.failPlan.set("x", 1);
    h.timeoutDispatch.add("u");
    e.stripEndUnknown = true;
    await edgeSegment(e, 2);
    e.stripEndUnknown = false;
    expect(runRow(e.runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toBeUndefined();
    h.timeoutDispatch.delete("u");
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "u", ma: "FOE_OUTCOME_UNKNOWN" });
    const s3 = await edgeSegment(e, 3);
    expect(ids().filter((x) => x === "boxUndo")).toHaveLength(0);
    expect(s3.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
  });

  it("★ (b) the fact is on the row at the moment of decision: the segment dies before its end, the rows already say it", async () => {
    const e = await denBuoc(def("n4-b", [gate(), move("x", { compensation: ot("u") })]));
    h.timeoutDispatch.add("x");
    const s = await edgeSegment(e, 2);
    const r = s.segment.filter((v: any) => v.kind === "step" && v.stepId === "x");
    const i = r.findIndex((v: any) => /OUTCOME_UNKNOWN/.test(String(v.error)));
    expect(i).toBeGreaterThanOrEqual(0);
    expect((r[i] as any).status).toBe("running"); // the record of the decision, before the failed row
  });

  it("(b) a row of a step already decided keeps the code: a later row with no error does not wipe the fact", async () => {
    const e = await denBuoc(def("n4-b2", [gate(), box("b", [{ ...(robotStop("st") as object), maxAttempts: 2 } as never], {})]));
    h.timeoutDispatch.add("st");
    const s = await edgeSegment(e, 2);
    expect(String(stepRows(e.runId).find((r) => r.stepId === "st")!.error)).toMatch(/OUTCOME_UNKNOWN/);
    const r = s.segment.filter((v: any) => v.kind === "step" && v.stepId === "st") as any[];
    const i = r.findIndex((v) => /OUTCOME_UNKNOWN/.test(String(v.error)));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(r.length - 1); // the later attempt wrote rows after the decision
    for (const v of r.slice(i)) expect(String(v.error)).toMatch(/OUTCOME_UNKNOWN/); // a crash between any two of them leaves the fact on the row
  });

  it("(b) a report on the segment end is the fact even if the rows were lost (full journal): the latch is central's", async () => {
    const e = await denBuoc(def("n4-b3", [gate(), move("x", { compensation: ot("u") })]));
    h.timeoutDispatch.add("x");
    e.refuse = (rec) => rec.kind === "step" && /OUTCOME_UNKNOWN/.test(String((rec as { error?: unknown }).error));
    await edgeSegment(e, 2);
    expect(runRow(e.runId).status).toBe("held");
    expect(runRow(e.runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toBeTruthy();
  });

  it("★ (b) /authorize is the second check: the walker does not know (its package predates the row), central refuses, the walker holds + reports, nothing sent", async () => {
    const e = await denBuoc(def("n4-a", [gate(), move("x", { compensation: ot("u") })]));
    h.failPlan.set("x", 1);
    const orig = e.authorizeCalls.length;
    // a row with the code reaches central after the claim: the context the walker read says nothing
    fake.store.get("orchestration_run_steps")!.push({ id: 99_001, runId: e.runId, stepId: "zz", stepType: "command", status: "failed", error: "FOE_OUTCOME_UNKNOWN: late row", attempt: 0, resultJson: null, startedAt: null, finishedAt: null });
    const s = await edgeSegment(e, 2);
    expect(e.authorizeCalls.slice(orig).some((a) => a.stepId === "u")).toBe(true);
    expect(ids()).toEqual(["x"]);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(baoCua(e, "held")).toHaveLength(1);
    await continueOutcomeUnknown(e, "checked");
    await edgeSegment(e, 3);
    expect(ids()).toEqual(["x", "u"]); // approved exactly: /authorize lets it through
  });

  it("★ C-D edge (U1): a compensation admitted before the latch is not sent after it; a verified STOP in the body goes + reported", async () => {
    const e = await denBuoc(def("n4-d", [gate(), par("box", [move("b", { compensation: box("uS", [delay("w", 120), ot("rz")], {}) }), move("m")], {})]));
    h.failPlan.set("b", 1);
    h.timeoutDispatch.add("m");
    const s = await edgeSegment(e, 2);
    expect(ids().filter((x) => x === "rz")).toHaveLength(0);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    const e2 = await denBuoc(def("n4-d2", [gate(), par("box", [move("b2", { compensation: box("uS2", [delay("w2", 120), robotStop("rs")], {}) }), move("m2")], {})]));
    h.failPlan.set("b2", 1);
    h.timeoutDispatch.add("m2");
    await edgeSegment(e2, 2);
    expect(ids().filter((x) => x === "rs")).toHaveLength(1);
    expect((e2.events ?? []).filter((v) => /"loai":"stop/.test(String(v.detail)))).toHaveLength(1); // the sink's own report
  });

  it("m-O edge: a verified STOP inside a multi-step compensation goes, the rest is held", async () => {
    const e = await denBuoc(def("n4-o", [gate(), move("r1", { compensation: box("c", [ot("rz"), robotStop("rs")], {}) })]));
    h.timeoutDispatch.add("r1");
    const s = await edgeSegment(e, 2);
    expect(ids().filter((x) => x === "rz")).toHaveLength(0);
    expect(ids().filter((x) => x === "rs")).toHaveLength(1);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
  });

  it("(a) an OT verified STOP passes the sink by the package's word: sent, never asked, no hold", async () => {
    fake.seed(deviceTags, [
      ...rows("device_tags"),
      { id: 74, adapterId: 501, tagKey: "halt", address: "00001", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true },
    ]);
    const e = await denBuoc(def("n4-otstop", [gate(), move("r1", { compensation: { id: "st", type: "command", machineId: 1, command: "stop", args: { tagKey: "halt", value: true } } as never })]));
    h.timeoutDispatch.add("r1");
    const n = e.authorizeCalls.length;
    const s = await edgeSegment(e, 2);
    expect(ids()).toEqual(["r1", "st"]);
    expect(e.authorizeCalls.slice(n).some((a) => a.stepId === "st")).toBe(false);
    expect(s.out.outcome).toBe("failed");
  });

  it("(a) n6 on the edge: an unlatched compensation asks /authorize and goes as before", async () => {
    const e = await denBuoc(def("n4-n6", [gate(), move("x", { compensation: ot("u") })]));
    h.failPlan.set("x", 1);
    const s = await edgeSegment(e, 2);
    expect(ids()).toEqual(["x", "u"]);
    expect(s.out).toMatchObject({ outcome: "failed" });
  });

  // ── A2(n) extension (owner's ruling): the forward sink. Probes A, B, C of the brief ──
  const khongGui = new RegExp(`^${FOE_NOT_SENT_RUN_LATCHED}: not sent: run latched`);
  const hang = (e: { runId: number }, id: string) => stepRows(e.runId).find((r) => r.stepId === id);
  const parF = (id: string, steps: WorkflowStep[], failFast: boolean, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast, steps, ...extra }) as never;
  const stopTyped = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "speed", value: 0 }, ...extra }) as never;

  it("★ probe A edge: r2 offline held, a PLAIN Continue, the next segment does NOT send r2: failed with the code, the run ends failed", async () => {
    const e = await denBuoc(def("x-a", [gate(), par("box", [move("x", { compensation: ot("u") }), move("r2")], {})]));
    h.failPlan.set("x", 1);
    h.timeoutDispatch.add("u");
    e.offlineSteps = new Set(["r2"]);
    await edgeSegment(e, 2);
    e.offlineSteps = undefined;
    h.timeoutDispatch.delete("u");
    await dieuTiep(e);
    const n = e.authorizeCalls.filter((a) => a.stepId === "r2").length;
    const s3 = await edgeSegment(e, 3);
    expect(ids()).toEqual(["x", "u"]);
    expect(String(hang(e, "r2")!.error)).toMatch(khongGui);
    expect(hang(e, "r2")).toMatchObject({ status: "failed" });
    expect(e.authorizeCalls.filter((a) => a.stepId === "r2").length).toBe(n + 1); // one attempt, no retry
    expect(s3.out).toMatchObject({ outcome: "failed" });
  });

  for (const failFast of [true, false]) {
    it(`★ probe B edge, failFast ${failFast}: r3 behind a delay is NOT sent after x went unknown; failed with the code; an edge audit; its authorisation reported unused`, async () => {
      const e = await denBuoc(def(`x-b${failFast}`, [gate(), parF("p", [move("x"), box("b", [delay("w", 80), move("r3")], {})], failFast)]));
      e.unused = [];
      h.timeoutDispatch.add("x");
      const s = await edgeSegment(e, 2);
      expect(ids()).toEqual(["x"]);
      expect(String(hang(e, "r3")!.error)).toMatch(khongGui);
      expect(hang(e, "r3")).toMatchObject({ status: "failed" });
      expect(s.out).toMatchObject({ outcome: "failed" });
      expect(e.authorizeCalls.filter((a) => a.stepId === "r3")).toHaveLength(1);
      expect((e.events ?? []).filter((v) => v.kind === "anomaly" && v.code === "notSentRunLatched")).toHaveLength(1);
      expect(e.unused).toEqual([expect.objectContaining({ stepId: "r3", reason: "run_latched" })]); // (4) — the forward authorisation is superseded too
      expect(e.records.filter((r) => r.kind === "step" && r.stepId === "r3" && r.status === "failed").map((r) => (r as { jti?: unknown }).jti)).toEqual([null]); // a quoted jti is evidence of use
      expect((fake.store.get("edge_step_authorizations") ?? []).find((a) => a.stepId === "r3")!.supersededAt).toBeInstanceOf(Date);
    });
    it(`★ probe B central, failFast ${failFast}: the same one line`, async () => {
      const d = def(`x-bc${failFast}`, [gate(), parF("p", [move("x"), box("b", [delay("w", 80), move("r3")], {})], failFast)]);
      h.timeoutDispatch.add("x");
      const runId = await centralRun(d, 1);
      expect(ids()).toEqual(["x"]);
      expect(String(stepRows(runId).find((r) => r.stepId === "r3")!.error)).toMatch(khongGui);
      expect(runRow(runId).status).toBe("failed");
    });
  }

  it("★ probe C edge: a sequential sibling: r3 refused, r4 behind it is never reached, neither sent", async () => {
    const e = await denBuoc(def("x-c", [gate(), parF("p", [move("x"), box("b", [delay("w", 80), move("r3"), move("r4")], {})], false)]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x"]);
    expect(String(hang(e, "r3")!.error)).toMatch(khongGui);
    expect(hang(e, "r4")).toBeUndefined();
  });
  it("★ probe C central: the same", async () => {
    h.timeoutDispatch.add("x");
    const runId = await centralRun(def("x-cc", [gate(), parF("p", [move("x"), box("b", [delay("w", 80), move("r3"), move("r4")], {})], false)]), 1);
    expect(ids()).toEqual(["x"]);
    expect(stepRows(runId).some((r) => r.stepId === "r4")).toBe(false);
  });

  it("★ a forward robot stop job after the latch IS sent, central and edge; a forward OT verified STOP IS sent on the edge (stopXacMinh is set at that line)", async () => {
    const e = await denBuoc(def("x-s", [gate(), parF("p", [move("x"), box("b", [delay("w", 60), robotStop("rs")], {})], false)]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x", "rs"]);
    h.sent.length = 0;
    h.timeoutDispatch.clear();
    h.timeoutDispatch.add("x2");
    await centralRun(def("x-sc", [gate(), parF("p", [move("x2"), box("b", [delay("w", 60), robotStop("rs2")], {})], false)]), 1);
    expect(ids()).toEqual(["x2", "rs2"]);
    h.sent.length = 0;
    fake.seed(deviceTags, [...rows("device_tags"), { id: 75, adapterId: 501, tagKey: "halt", address: "00001", dataType: "bool", scale: null, offset: null, updatedAt: T0, writable: true, isEnabled: true, stopValue: true }]);
    const e3 = await denBuoc(def("x-so", [gate(), parF("p", [move("x3"), box("b", [delay("w", 60), { id: "st", type: "command", machineId: 1, command: "stop", args: { tagKey: "halt", value: true } } as never], {})], false)]));
    h.timeoutDispatch.add("x3");
    await edgeSegment(e3, 2);
    expect(ids()).toEqual(["x3", "st"]);
  });

  it("★ a forward STOP-typed step that is not verified: not sent, the code; maxAttempts: 3 on a forward step: 0 hand-overs, one authorisation, no a2", async () => {
    const e = await denBuoc(def("x-u", [gate(), parF("p", [move("x"), box("b", [delay("w", 60), stopTyped("st")], {})], false)]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x"]);
    expect(String(hang(e, "st")!.error)).toMatch(khongGui);
    h.sent.length = 0;
    const e2 = await denBuoc(def("x-m", [gate(), parF("p", [move("x2"), box("b", [delay("w", 60), move("r3", { maxAttempts: 3 })], {})], false)]));
    h.timeoutDispatch.add("x2");
    await edgeSegment(e2, 2);
    expect(ids()).toEqual(["x2"]);
    expect(e2.authorizeCalls.filter((a) => a.stepId === "r3").map((a) => a.attempt)).toEqual([1]);
    expect(hang(e2, "r3")).toMatchObject({ status: "failed", attempt: 1 });
  });

  it("★ a container with a retry budget, whose only failure is the refusal, is not walked again on the edge: one /authorize (central's walk has the resume state too)", async () => {
    const e = await denBuoc(def("x-r", [gate(), parF("p", [box("b", [move("r5")], {})], false, { maxAttempts: 2 })]));
    runRow(e.runId).contextJson = { ...(runRow(e.runId).contextJson ?? {}), [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { stepId: "zz", ma: "FOE_OUTCOME_UNKNOWN", at: "t" } };
    await edgeSegment(e, 2);
    expect(ids()).toEqual([]);
    expect(e.authorizeCalls.filter((a) => a.stepId === "r5")).toHaveLength(1);
  });

  it("★ a finding on the edge: a robot STOP unknown once, confirmed next, forward work dropped: a person IS told", async () => {
    const e = await denBuoc(def("x-f", [gate(), { ...(robotStop("st") as object), maxAttempts: 1 } as never, move("r3")]));
    h.timeoutOnce.add("st");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["st", "st"]);
    expect(String(hang(e, "r3")!.error)).toMatch(khongGui);
    expect(baoCua(e, "forwardNotSent")).toHaveLength(1);
  });

  it("★ a refused forward step on a later segment: its compensation is not due (central's derived state: doneFailed), the run is not held for it, nothing is sent", async () => {
    const e = await denBuoc(def("x-g", [gate(), parF("p", [move("x"), gate("g2"), box("b", [delay("w", 60), move("r3", { compensation: ot("c3") })], {})], false)]));
    h.timeoutDispatch.add("x");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "paused" });
    h.timeoutDispatch.delete("x");
    await approveEdgeGate(e);
    expect(runRow(e.runId).contextJson.foeResumeState?.r3).toMatchObject({ state: "doneFailed" });
    const s3 = await edgeSegment(e, 3);
    expect(ids()).toEqual(["x"]);
    expect(s3.out).toMatchObject({ outcome: "failed" });
    expect(hang(e, "c3")).toBeUndefined();
    const d = def("y", [move("a", { compensation: ot("b") })]);
    const r = (stepId: string, error: string) => ({ stepId, status: "failed", resultJson: null, error });
    expect(edgeResumeStateOf(d, [r("a", `${FOE_NOT_SENT_RUN_LATCHED}: not sent`)], new Set()).state.a).toEqual({ state: "doneFailed", error: `${FOE_NOT_SENT_RUN_LATCHED}: not sent` });
    expect(edgeResumeStateOf(d, [r("a", "rejected")], new Set()).state.a).toMatchObject({ state: "compensationHeld" }); // n6
  });

  it("★ the trap on the edge: a STOP-typed step, not verified, whose attempt went unknown: the next attempt is not sent, it stays unknown, never 'not sent'", async () => {
    const e = await denBuoc(def("x-t", [gate(), stopTyped("st", { maxAttempts: 1 })]));
    h.timeoutDispatch.add("st");
    e.unused = [];
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["st"]);
    expect(String(hang(e, "st")!.error)).toMatch(/^FOE_OUTCOME_UNKNOWN/);
    expect(String(hang(e, "st")!.error)).not.toMatch(/not sent: run latched/);
    expect(e.unused.map((u) => [u.stepId, u.attempt])).toEqual([["st", 2]]); // the second authorisation only: the first may have been used
  });
  it("★ the trap on the edge: a row left running by an earlier segment (central does not derive a STOP-typed step): stays unknown, not sent", async () => {
    const e = await denBuoc(def("x-t2", [gate(), parF("p", [move("x"), stopTyped("st")], false)]));
    h.timeoutDispatch.add("x");
    e.offlineSteps = new Set(["st"]);
    await edgeSegment(e, 2);
    e.offlineSteps = undefined;
    Object.assign(hang(e, "st")!, { status: "running", error: null });
    await dieuTiep(e);
    await edgeSegment(e, 3);
    expect(ids()).toEqual(["x"]);
    expect(String(hang(e, "st")!.error)).toMatch(/^FOE_OUTCOME_UNKNOWN/);
  });

  it("★ not stuck on the edge: Continue (n3) sends the compensation only, the forward work is dropped, the run ends failed", async () => {
    const e = await denBuoc(def("x-n", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [delay("w", 60), move("r3")], {})], false)]));
    h.timeoutDispatch.add("x");
    const s2 = await edgeSegment(e, 2);
    expect(s2.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    h.timeoutDispatch.delete("x");
    await continueOutcomeUnknown(e, "checked");
    const s3 = await edgeSegment(e, 3);
    expect(ids()).toEqual(["x", "u"]);
    expect(s3.out).toMatchObject({ outcome: "failed" });
    expect(runRow(e.runId).status).toBe("failed");
  });
  it("★ not stuck on the edge: Abort ends the same run, nothing forward", async () => {
    const e = await denBuoc(def("x-na", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [delay("w", 60), move("r3")], {})], false)]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await abortRun(e.runId, OWNER, "checked");
    expect(runRow(e.runId).status).toBe("aborted");
    expect(ids()).toEqual(["x"]);
  });

  // (4) — a compensation authorised before the latch and held at the sink: the authorisation is reported never used
  const autDuocTruocChot = async (ref: string) => {
    const e = await denBuoc(def(ref, [gate(), par("box", [move("b", { compensation: ot("rz") }), move("m")], {})]));
    h.failPlan.set("b", 1);
    h.timeoutDispatch.add("m");
    e.unused = [];
    e.authorizeDelay = new Map([["m", 30], ["rz", 90]]); // rz is admitted and asks before m's outcome is known, and answers after it
    return e;
  };
  it("★ (4) held at the sink after its authorisation: reported unused (run_latched), central supersedes it, no 'an earlier segment sent it'; the Continue sends it once", async () => {
    const e = await autDuocTruocChot("x-4");
    const s = await edgeSegment(e, 2);
    expect(s.out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(ids().filter((x) => x === "rz")).toHaveLength(0);
    expect(e.unused).toEqual([expect.objectContaining({ stepId: "rz", reason: "run_latched", attempt: 1 })]);
    expect(new Set(e.records.filter((r) => r.kind === "step" && r.stepId === "rz" && r.status === "held").map((r) => (r as { jti?: unknown }).jti))).toEqual(new Set([null]));
    await continueOutcomeUnknown(e, "checked");
    e.events = [];
    await edgeSegment(e, 3);
    expect(ids().filter((x) => x === "rz")).toHaveLength(1);
    expect(baoCua(e, "compensationUnknown")).toHaveLength(0);
  });
  it("(4) the report failed: central still reads it the safe way (never sent again) and the words say 'may have'", async () => {
    const e = await autDuocTruocChot("x-4b");
    e.unusedFails = true;
    await edgeSegment(e, 2);
    await continueOutcomeUnknown(e, "checked");
    e.events = [];
    await edgeSegment(e, 3);
    expect(ids().filter((x) => x === "rz")).toHaveLength(0);
    expect(baoCua(e, "compensationUnknown").length).toBeGreaterThan(0);
  });

  // F10 — the report of an unused authorisation is bounded: a stalled journal holds neither the walk nor a STOP behind it
  const trong = (p: Promise<unknown>, ms: number) => Promise.race([p.then(() => "ended"), new Promise((r) => setTimeout(() => r("blocked"), ms))]);
  const tuChoiCoStopBen = (ref: string) => denBuoc(def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 40), move("r3")], { compensation: robotStop("bs") })], false)]));
  it("★ F10 (R3) the report hangs at the sink's refusal: the segment ends and the container's STOP goes", async () => {
    const e = await tuChoiCoStopBen("f10-r3");
    h.timeoutDispatch.add("x");
    e.unusedHangs = true;
    try {
      expect(await trong(edgeSegment(e, 2), 3 * STOP_DB_STEP_DEADLINE_MS), "the segment stood on the report").toBe("ended");
    } finally {
      h.dbThrows = false;
    }
    expect(ids()).toEqual(["x", "bs"]);
  });
  it("F10 (R3b) the report answers false at the sink's refusal: as above, nothing stands", async () => {
    const e = await tuChoiCoStopBen("f10-r3b");
    h.timeoutDispatch.add("x");
    e.unusedFails = true;
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x", "bs"]);
  });
  it("★ F10 the report hangs while held at the sink: the segment ends held, the compensation not sent", async () => {
    const e = await autDuocTruocChot("f10-giu");
    e.unusedHangs = true;
    const seg = edgeSegment(e, 2);
    try {
      expect(await trong(seg, 3 * STOP_DB_STEP_DEADLINE_MS), "the segment stood on the report").toBe("ended");
    } finally {
      h.dbThrows = false;
    }
    expect((await seg).out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(ids().filter((x) => x === "rz")).toHaveLength(0);
  });
});

/**
 * A2(n) T0 — an injection counts only if it reaches its target: on, the target throws or answers the other way; off, it does not. The targets behind an `import()` are asked by
 * DONG_THOI concurrent callers from one module, the shape that lost a mock to the real module; every question must arrive, in each of VONG rounds. The dispatch's injections sit on
 * a static import (equipmentRegistry): their own cases below and the cases of the sections above prove them.
 */
describe("A2(n) T0 — every injection of this harness reaches its target", () => {
  const VONG = 10;
  const DONG_THOI = 6;
  const dongThoi = <T>(f: (i: number) => Promise<T>) => Promise.all(Array.from({ length: DONG_THOI }, (_, i) => f(i)));
  const mayMap = () => new Map<number, MachineForValidation>(rows("machines").map((m) => [m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities }] as const));
  const rc = () => ({ runId: 1, machineById: mayMap(), user: OWNER }) as never;
  const hoi = (st: WorkflowStep) => dongThoi(() => verifiedStopStepIds(def("t0", [st]), mayMap(), fake as never));

  it("★ classifyOtStop (the verifier): on, the read throws and the STOP is only unsure; off, verified; 6 concurrent questions arrive, 10 rounds", async () => {
    seedHalt();
    for (let v = 0; v < VONG; v++) {
      h.classifyLoi = true;
      h.classifyLan = 0;
      for (const r of await hoi(otStop("st"))) expect(r).toMatchObject({ failed: true, ids: new Set(), unsure: new Set(["st"]) });
      expect(h.classifyLan).toBe(DONG_THOI);
      h.classifyLoi = false;
      h.classifyLan = 0;
      for (const r of await hoi(otStop("st"))) expect(r).toMatchObject({ failed: false, ids: new Set(["st"]) });
      expect(h.classifyLan).toBe(DONG_THOI);
    }
  });

  it("★ h.connOk (the running connection): on, the pinned STOP is not verified; off, it is; 6 concurrent questions arrive, 10 rounds", async () => {
    seedHalt();
    for (let v = 0; v < VONG; v++) {
      h.connOk = false;
      h.connLan = 0;
      for (const r of await hoi(otStop("st"))) expect(r).toMatchObject({ ids: new Set(), unsure: new Set(["st"]) });
      expect(h.connLan).toBe(DONG_THOI);
      h.connOk = true;
      h.connLan = 0;
      for (const r of await hoi(otStop("st"))) expect(r).toMatchObject({ ids: new Set(["st"]) });
      expect(h.connLan).toBe(DONG_THOI);
    }
  });

  it("★ h.ghim (phanLoaiStopGhimChoFoe): throws, unreadable, not pinned ⇒ not a pinned STOP; pinned ⇒ one; 6 concurrent questions arrive, 10 rounds", async () => {
    seedHalt();
    const st = otStop("st");
    const lan = async (ghim: typeof h.ghim, ky: boolean) => {
      h.ghim = ghim;
      h.ghimLan.length = 0;
      expect(await dongThoi(() => buTruLaStopGhimTrungTam(rc(), st))).toEqual(Array(DONG_THOI).fill(ky));
      expect(h.ghimLan).toEqual(Array(DONG_THOI).fill("stop"));
    };
    for (let v = 0; v < VONG; v++) {
      await lan(async () => {
        throw new Error("pin read down (test)");
      }, false);
      await lan(PIN_BAD, false);
      await lan(null, false);
      await lan(PIN_OK, true);
    }
  });

  it("★ the alert: 6 concurrent URGENTs of foeKetCucKhongRo all reach the mock, none reaches the real one, 10 rounds", async () => {
    for (let v = 0; v < VONG; v++) {
      h.alerts.length = 0;
      await dongThoi((i) => canhBaoKetCucKhongRo({ loai: "held", runId: 77, stepId: `m${i}`, compId: "c", error: "e", lan: `L${v}`, owner: OWNER.id }));
      expect(h.alerts).toHaveLength(DONG_THOI);
    }
    expect(h.canhBaoThat).toBe(0);
  });

  it("h.alertDurable: the mock's answer through baoBen, off and on, 10 rounds (the engine asks for it from T2 on)", async () => {
    for (let v = 0; v < VONG; v++) {
      const nghe: boolean[] = [];
      h.alertDurable = false;
      await raiseCriticalStopAlert({ baoBen: (b: boolean) => nghe.push(b) } as never);
      h.alertDurable = true;
      await raiseCriticalStopAlert({ baoBen: (b: boolean) => nghe.push(b) } as never);
      expect(nghe).toEqual([false, true]);
    }
  });

  it("h.alertDurable reaches the engine's alert (T2): 6 concurrent calls, off false, on true, 10 rounds", async () => {
    const goi = (v: number, lan: string) => dongThoi((i) => canhBaoKetCucKhongRo({ loai: "held", runId: 78, stepId: `m${i}`, compId: "c", error: "e", lan: `${lan}${v}`, owner: OWNER.id }));
    for (let v = 0; v < VONG; v++) {
      h.alertDurable = false;
      expect(await goi(v, "tat")).toEqual(Array(DONG_THOI).fill(false));
      h.alertDurable = true;
      expect(await goi(v, "bat")).toEqual(Array(DONG_THOI).fill(true));
    }
    expect(h.canhBaoThat).toBe(0);
  });

  it("h.ownershipThrows (edgeCentralCommon, behind an import()): on, 6 concurrent assignments are all refused; off, they all go, 10 rounds", async () => {
    const d = def("t0-o", [move("r1")]);
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    for (let v = 0; v < VONG; v++) {
      h.ownershipThrows = true;
      for (const r of await dongThoi(() => startRun(d.ref, {}, OWNER, { edgeNodeId: NODE }))) expect(r.ok).toBe(false);
      h.ownershipThrows = false;
      for (const r of await dongThoi(() => startRun(d.ref, {}, OWNER, { edgeNodeId: NODE }))) expect(r.ok).toBe(true);
    }
  });

  it("h.dbThrows: on, getDb throws and counts; off, it answers, and counts nothing, 10 rounds", async () => {
    try {
      for (let v = 0; v < VONG; v++) {
        h.dbThrows = true;
        h.dbCalls = 0;
        await expect(getDb()).rejects.toThrow("no database");
        expect(h.dbCalls).toBe(1);
        h.dbThrows = false;
        expect(await getDb()).toBe(fake);
        expect(h.dbCalls).toBe(1);
      }
    } finally {
      h.dbThrows = false;
    }
  });

  it("h.slow: on, the dispatch answers that much later; off, it does not wait", async () => {
    const CHAM = 120;
    const chay = async (ref: string) => {
      const t = performance.now();
      await centralRun(def(ref, [gate(), ot("m1")]), 1);
      return performance.now() - t;
    };
    for (let v = 0; v < VONG; v++) {
      h.slow.set("m1", CHAM);
      expect(await chay(`t0-s${v}`)).toBeGreaterThanOrEqual(CHAM - 5);
      h.slow.clear();
      expect(await chay(`t0-n${v}`)).toBeLessThan(CHAM);
    }
  });

  it("h.acked: on, the dispatch answers acked; off, simulated", async () => {
    const chay = async (ref: string) => {
      const c = await centralRun(def(ref, [gate(), ot("m1")]), 1);
      return (stepRows(c).find((r) => r.stepId === "m1")!.resultJson as Row).status;
    };
    h.acked = true;
    expect(await chay("t0-a")).toBe("acked");
    h.acked = false;
    expect(await chay("t0-b")).toBe("simulated");
  });
});

/**
 * A2(n) T0 — the disk lot's round C (a consumeAuthorization past its bound turns a `failed` segment into held(journalFull)) stops at the latch. On a latched run held(journalFull) has no
 * KET_CUC_KHONG_RO mark, so the Continue would ask no person and no reason (resumeRun, M-4). A latched segment ends as the latched path ends it. An unlatched one keeps round C:
 * these cases and robotEdgeDiskStall.a2n.test.ts.
 */
describe("A2(n) T0 — the disk lot's round C applies only to a segment not latched", () => {
  const parF = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: false, steps, ...extra }) as never;
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    return e;
  }
  const ctxCua = (e: EdgeHarness) => runRow(e.runId).contextJson as Record<string, unknown>;
  const dieuTiepTran = async (e: EdgeHarness) => {
    const view = (await getRun(e.runId, { bindingDigest: true }))!;
    return resumeRun(e.runId, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  };

  it("★ C-KHOA failed: x unknown, m2's consume past its bound: the segment ends as without the overrun, not held(journalFull); the code stays on the rows; no Continue past it", async () => {
    const e = await denBuoc(def("c-khoa", [gate(), parF("p", [move("x"), move("m2")])]));
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    h.consumeQuaHan.add("m2");
    const { out } = await edgeSegment(e, 2);
    expect.soft(out).toMatchObject({ outcome: "failed" });
    expect.soft(out.heldReason).toBeUndefined();
    expect.soft(runRow(e.runId).status).toBe("failed");
    expect.soft(EDGE_HELD_CTX_KEY in ctxCua(e)).toBe(false);
    expect.soft(chotTuHang(stepRows(e.runId) as never)).not.toBeNull();
    grantMachineControl();
    const tiep = await dieuTiepTran(e).catch((err: Error) => ({ ok: false, message: err.message }));
    expect.soft(tiep.ok, "a Continue with no person's reason went through").toBe(false);
    expect.soft(h.sent.map((x) => x.stepId).sort()).toEqual(["m2", "x"]);
  });

  it("đối chứng C-KHOA: the same run with an ordinary refusal of m2 ends the same way", async () => {
    const e = await denBuoc(def("c-khoa-dc", [gate(), parF("p", [move("x"), move("m2")])]));
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    h.failPlan.set("m2", 1);
    const { out } = await edgeSegment(e, 2);
    expect(out).toMatchObject({ outcome: "failed" });
    expect(runRow(e.runId).status).toBe("failed");
  });

  it("★ C-KHOA held: a compensation held for x, m2's consume past its bound: held(outcomeUnknown), the mark stands, the Continue asks a person and a reason", async () => {
    const e = await denBuoc(def("c-khoa-h", [gate(), parF("p", [move("x", { compensation: ot("u") }), move("m2")])]));
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    h.consumeQuaHan.add("m2");
    const { out } = await edgeSegment(e, 2);
    expect(out).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(runRow(e.runId).status).toBe("held");
    expect(KET_CUC_KHONG_RO_CTX_KEY in ctxCua(e)).toBe(true);
    await expect(dieuTiepTran(e)).rejects.toThrow(/machine-control|reason/);
    await expect(continueOutcomeUnknown(e, "")).rejects.toThrow(/reason/);
    expect((await continueOutcomeUnknown(e, "checked on site")).ok).toBe(true);
  });

  it("★ C-KHOA next segment: latched by an earlier segment (central's context), the approved compensation's consume past its bound: failed, not held(journalFull)", async () => {
    const e = await denBuoc(def("c-khoa-s", [gate(), move("x", { compensation: ot("u") })]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(runRow(e.runId).status).toBe("held");
    await continueOutcomeUnknown(e, "checked on site");
    h.consumeQuaHan.add("u");
    const { out } = await edgeSegment(e, 3);
    expect.soft(out).toMatchObject({ outcome: "failed" });
    expect.soft(runRow(e.runId).status).toBe("failed");
    expect.soft(EDGE_HELD_CTX_KEY in ctxCua(e)).toBe(false);
  });

  it("đối chứng C: a segment not latched keeps held(journalFull) and the disk lot's mark", async () => {
    const e = await denBuoc(def("c-tu-do", [gate(), move("m2")]));
    h.consumeQuaHan.add("m2");
    const { out } = await edgeSegment(e, 2);
    expect(out).toMatchObject({ outcome: "held", heldReason: "journalFull" });
    expect(String(out.error)).toContain("EDGE_HELD(journalFull)");
    expect(runRow(e.runId).status).toBe("held");
    expect(ctxCua(e)[EDGE_HELD_CTX_KEY]).toBe("journalFull");
    expect(KET_CUC_KHONG_RO_CTX_KEY in ctxCua(e)).toBe(false);
  });
});

/**
 * A2(n) T3+T4 — one gate: after the latch nothing goes forward, a due STOP goes now, and it never waits for a slow sibling. Case names carry the plan's codes (section 17). Every
 * case passes through the afterEach below: a command that reached the fake after the first `timeout` answer must be a STOP (or what a person approved, h.duocSauKhoa).
 */
describe("A2(n) T3+T4 — the door, the planner, the STOP passes", () => {
  const box = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "sequence", steps, ...extra }) as never;
  const parF = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: false, steps, ...extra }) as never;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as never;
  const brn = (id: string, thenS: WorkflowStep[], elseS: WorkflowStep[] = []): WorkflowStep => ({ id, type: "branch", condition: { source: "telemetry", machineId: 2, key: "temp", op: "lt", value: 100 }, then: thenS, else: elseS }) as never;
  /** stop-typed on a tag with no pin: not a STOP (R-5-j) */
  const stopTyped = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "run", value: 0 }, ...extra }) as never;
  const ids = () => h.sent.map((x) => x.stepId as string);
  const hang = (runId: number, id: string) => stepRows(runId).find((r) => r.stepId === id);
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const authCua = (e: EdgeHarness, id: string) => e.authorizeCalls.filter((a) => a.stepId === id).length;
  const hangUyQuyen = (id: string) => (fake.store.get("ai_pending_actions") ?? []).filter((a) => String(a.id).includes(`-${id}-`)).length;
  const khongGui = new RegExp(`^${FOE_NOT_SENT_RUN_LATCHED}: `);
  const auditKhongGui = () => vi.mocked(logCrudOperation).mock.calls.filter((c) => (c[1] as { details?: { operation?: string } }).details?.operation === "notSentRunLatched");
  async function denBuoc(d: WorkflowDefinition) {
    const e = await edgeAssignedRun(d);
    await edgeSegment(e, 1);
    await approveEdgeGate(e);
    e.events = [];
    return e;
  }
  /** approve the gate and leave the walk running: a sibling is hanging, the case looks at what went meanwhile */
  async function diKhongCho(d: WorkflowDefinition) {
    expect((await deployWorkflow(d, OWNER)).ok).toBe(true);
    const s = await startRun(d.ref, {}, OWNER);
    const view = (await getRun(s.runId!, { bindingDigest: true }))!;
    const di = resumeRun(s.runId!, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    return { runId: s.runId!, di };
  }
  /** `xong` must come true within `ms` of now, while the walk is still out; the walk is awaited either way (an edge walk leaves the database throwing until it returns) */
  async function trongLuc(di: Promise<unknown>, xong: () => boolean, label: string, ms: number) {
    await Promise.allSettled([waitFor(xong, label, ms).then(() => (daDen = true)), di]);
    expect(daDen, `not in time: ${label}`).toBe(true);
    daDen = false;
  }
  let daDen = false;
  /** the rows a crash leaves on a latched run: the latch in the context, nothing told. `sua` changes the world before the boot */
  function chet(runId: number, keep: string[], sua?: () => void) {
    process.env.FOE_DURABLE = "true";
    const chot = runRow(runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY];
    expect(chot).toBeTruthy();
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== runId || keep.includes(r.stepId)));
    const latched = stepRows(runId).find((r) => r.stepId === chot.stepId);
    if (latched) Object.assign(latched, { status: "running", error: null, finishedAt: null });
    Object.assign(runRow(runId), { status: "held", finishedAt: null, error: null, contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: chot, interrupted: true } });
    sua?.();
    h.sent.length = 0;
    h.alerts.length = 0;
    h.traTimeout = 1;
  }

  const LA_STOP = new Set(["abort", "stop", "e_stop"]);
  const BANG: string[] = [];
  beforeEach(() => vi.mocked(logCrudOperation).mockClear());
  afterEach(() => {
    delete process.env.FOE_DURABLE;
    const sau = h.sent.filter((x) => x.sauKhoa === true);
    BANG.push(`${String(expect.getState().currentTestName).split(" > ").pop()?.slice(0, 70)} | ${sau.map((x) => `${String(x.stepId)}:${String(x.name)}`).join(" ") || "-"}`);
    // by the PIN, not by the command's name: an OT `stop` counts only when every write it carries is a pin of its adapter; a robot's `abort` is the robot rule
    const ghim = (x: Record<string, unknown>) => {
      if (x.robotId != null) return x.name === "abort";
      const w = (x.writes ?? []) as Array<{ tagKey: string }>;
      return w.length > 0 && w.every((v) => rows("device_tags").some((t) => t.adapterId === x.adapterId && t.tagKey === v.tagKey && t.stopValue != null));
    };
    const la = sau.filter((x) => !(LA_STOP.has(String(x.name)) && ghim(x)) && !h.duocSauKhoa.has(String(x.stepId)));
    expect(la.map((x) => x.stepId), "a command that is no pinned STOP reached the dispatcher after the latch").toEqual([]);
  });
  afterAll(() => {
    for (const l of BANG) console.log(`[PROBE sau-khoa] ${l}`);
  });

  // ── the door ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const nong = { precondition: { source: "telemetry", machineId: 2, key: "temp", op: "lt", value: 100 } };
  const hot = () => (h.telemetry = [{ key: "temp", value: 150 }]);
  for (const mode of ["hold", "skip", "abort"] as const) {
    it(`C1 precondition ${mode} after a crash: not read again, x stays unknown, its STOP compensation goes, URGENT`, async () => {
      h.timeoutDispatch.add("x");
      const c = await centralRun(def(`c1-${mode}`, [gate(), move("x", { ...nong, onPreconditionFail: mode, compensation: robotStop("rs") })]), 1);
      chet(c, ["g1", "x"], hot);
      await autoResumeInterruptedRuns([c]);
      await waitFor(() => ids().includes("rs"), "the STOP compensation");
      expect(ids()).toEqual(["rs"]);
      expect(hang(c, "x")).toMatchObject({ status: "failed" });
      expect(String(hang(c, "x")!.error)).toMatch(/OUTCOME_UNKNOWN/);
      expect(h.alerts.length).toBeGreaterThan(0);
      expect(runRow(c).status).toBe("failed");
    });
  }
  it("C1 the precondition of the container around x: not read again, x stays unknown", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("c1-box", [gate(), box("b", [move("x")], { ...nong, onPreconditionFail: "hold", compensation: robotStop("rs") })]), 1);
    chet(c, ["g1", "b", "x"], hot);
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("rs"), "the STOP compensation");
    expect(hang(c, "b")?.status).not.toBe("held");
    expect(String(hang(c, "x")!.error)).toMatch(/OUTCOME_UNKNOWN/);
  });
  it("C2 a gate approval that no longer counts at a boot: no FOE_GATE_REQUIRED, the STOP goes, URGENT", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("c2", [gate(), move("x", { compensation: robotStop("rs") })]), 1);
    chet(c, ["g1", "x"], () => {
      const g = hang(c, "g1")!;
      g.resultJson = { ...g.resultJson, defHash: "stale" };
    });
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("rs"), "the STOP compensation");
    expect(stepRows(c).filter((r) => String(r.error ?? "").includes(FOE_GATE_REQUIRED))).toEqual([]);
    expect(String(hang(c, "x")!.error)).toMatch(/OUTCOME_UNKNOWN/);
    expect(h.alerts.length).toBeGreaterThan(0);
  });
  it("C3 central: a forward step reached after the latch: 0 hand-overs, no authorisation row, NOT_SENT, an audit row", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("c3", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), ot("r3")])])]), 1);
    expect(ids()).toEqual(["x"]);
    expect(hangUyQuyen("r3")).toBe(0);
    expect(String(hang(c, "r3")!.error)).toMatch(khongGui);
    expect(hang(c, "r3")).toMatchObject({ status: "failed" });
    await waitFor(() => auditKhongGui().length === 1, "the audit row");
    expect(runRow(c).status).not.toBe("completed");
  });
  it("C3 edge: the same, 0 /authorize", async () => {
    const e = await denBuoc(def("c3e", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), ot("r3")])])]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x"]);
    expect(authCua(e, "r3")).toBe(0);
    expect(String(hang(e.runId, "r3")!.error)).toMatch(khongGui);
    expect((e.events ?? []).filter((v) => v.kind === "anomaly" && v.code === "notSentRunLatched")).toHaveLength(1);
  });
  it("C3b a step with a device's own error from an earlier walk, at the door: not sent, its row keeps the error (F12-9)", async () => {
    h.timeoutDispatch.add("x");
    h.failPlan.set("y", 1);
    const c = await centralRun(def("c3b", [gate(), parF("p", [move("x", { compensation: ot("u") }), move("y")])]), 1);
    chet(c, ["g1", "x", "y"], () => Object.assign(hang(c, "y")!, { status: "failed", error: "device said no" }));
    await autoResumeInterruptedRuns([c]);
    await wait(30);
    expect(String(hang(c, "y")!.error)).toBe("device said no");
  });
  it("C3b a container with its last word from an earlier walk: not walked again, its row keeps it", async () => {
    h.timeoutDispatch.add("x");
    h.failPlan.set("y", 1);
    const c = await centralRun(def("c3d", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [move("y")])])]), 1);
    chet(c, ["g1", "p", "x", "b", "y"], () => {
      Object.assign(hang(c, "y")!, { status: "failed", error: "device said no" });
      Object.assign(hang(c, "b")!, { status: "failed", error: "device said no" });
    });
    await autoResumeInterruptedRuns([c]);
    await wait(30);
    expect(String(hang(c, "b")!.error)).toBe("device said no");
  });
  it("C4 central: a command past the door when the latch falls: the sink keeps it, 0 hand-overs, its own STOP compensation goes (F11)", async () => {
    h.ghim = async (_d, i) => {
      if (i.commandType === "start") await wait(80);
      return { pinnedStop: false, loiDocGhim: null };
    };
    h.slow.set("x", 20);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("c4", [gate(), parF("p", [move("x"), ot("m2", { compensation: robotStop("cs") })])]), 1);
    await waitFor(() => ids().includes("cs"), "the refused step's STOP");
    expect(ids().filter((x) => x === "m2")).toEqual([]);
    expect(String(hang(c, "m2")!.error)).toMatch(khongGui);
  });
  it("C4 edge: the same, /authorize asked before the latch, the answer comes after it", async () => {
    const e = await denBuoc(def("c4e", [gate(), parF("p", [move("x"), move("m2", { compensation: robotStop("cs") })])]));
    e.authorizeDelay = new Map([["m2", 80]]);
    h.slow.set("x", 20);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    await waitFor(() => ids().includes("cs"), "the refused step's STOP");
    expect(ids().filter((x) => x === "m2")).toEqual([]);
    expect(authCua(e, "m2")).toBe(1);
  });
  it("C5 a container with maxAttempts, latched while its child fails: not walked again, one attempt", async () => {
    const e = await denBuoc(def("c5e", [gate(), parF("p", [move("x"), box("b", [move("f")], { maxAttempts: 2 })])]));
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    h.slow.set("f", 50);
    h.failPlan.set("f", 1);
    await edgeSegment(e, 2);
    expect(ids().filter((x) => x === "f")).toEqual(["f"]);
    expect(authCua(e, "f")).toBe(1);
    expect(hang(e.runId, "b")).toMatchObject({ status: "failed", attempt: 1 });
  });
  it("C6 central: a STOP behind a long delay goes from the planner, once; the walker reaching it later does not enter", async () => {
    const { runId: c, di } = await diKhongCho(def("c6", [gate(), parF("p", [move("x"), box("b", [delay("w", 250), robotStop("s")])])]));
    h.timeoutDispatch.add("x");
    await trongLuc(di, () => ids().includes("s"), "the STOP", 150);
    expect(ids().filter((x) => x === "s")).toEqual(["s"]);
    expect((centralWrites.get(c) ?? []).filter((w) => w.stepId === "s" && w.status === "running" && w.result === "-")).toHaveLength(1);
  });
  it("C6 edge: the same", async () => {
    const e = await denBuoc(def("c6e", [gate(), parF("p", [move("x"), box("b", [delay("w", 250), robotStop("s")])])]));
    h.timeoutDispatch.add("x");
    const seg = edgeSegment(e, 2);
    await trongLuc(seg, () => ids().includes("s"), "the STOP", 150);
    expect(ids().filter((x) => x === "s")).toEqual(["s"]);
    expect(e.records.filter((r: any) => r.kind === "step" && r.stepId === "s" && r.status === "running" && r.result == null)).toHaveLength(1);
  });
  it("C6b central: a STOP in authorizeCommand when the latch falls, walker and planner both at the sink: 1 hand-over", async () => {
    seedHalt();
    h.ghim = async (_d, i) => {
      if (i.commandType === "stop") await wait(70);
      return PIN_OK(_d, i);
    };
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("st", 60);
    const c = await centralRun(def("c6b", [gate(), parF("p", [move("x"), otStop("st")])]), 1);
    await wait(120);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(hang(c, "st")).toMatchObject({ status: "completed" });
  });
  it("C6b edge: a verified STOP between its running row and the sink when the latch falls: 1 hand-over", async () => {
    seedHalt();
    const e = await denBuoc(def("c6be", [gate(), parF("p", [move("x"), otStop("st")])]));
    e.journalDelay = new Map([["st", 60]]);
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("st", 120);
    await edgeSegment(e, 2);
    await wait(60);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("C7 central: a Continue on a run held before this code, a STOP never tried: it goes, not after the non-STOP compensation", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("c7", [gate(), move("x", { compensation: ot("u") }), robotStop("s")]), 1);
    expect(runRow(c).status).toBe("held");
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== c || r.stepId !== "s"));
    h.sent.length = 0;
    h.timeoutDispatch.clear();
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await waitFor(() => ids().includes("s"), "the STOP");
    await waitFor(() => ids().includes("u"), "the approved compensation");
    expect(ids()).toEqual(["s", "u"]);
  });
  it("C7 edge: the same", async () => {
    const e = await denBuoc(def("c7e", [gate(), move("x", { compensation: ot("u") }), robotStop("s")]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(runRow(e.runId).status).toBe("held");
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== e.runId || r.stepId !== "s"));
    h.sent.length = 0;
    h.timeoutDispatch.clear();
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown(e, "checked on site");
    await edgeSegment(e, 3);
    expect(ids()).toEqual(["s", "u"]);
  });

  // ── the sweep ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const sauThuBai = (st: WorkflowStep) => parF("p", [move("x"), box("b", [move("f"), st])]);
  it("B1 central, robot: a STOP in a container that failed before the latch goes", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    await centralRun(def("b1", [gate(), sauThuBai(robotStop("st"))]), 1);
    await waitFor(() => ids().includes("st"), "the STOP");
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("B1 central, OT pinned: the same", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    await centralRun(def("b1o", [gate(), sauThuBai(otStop("st"))]), 1);
    await waitFor(() => ids().includes("st"), "the STOP");
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("B1 edge: the same", async () => {
    seedHalt();
    const e = await denBuoc(def("b1e", [gate(), sauThuBai(otStop("st"))]));
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    await edgeSegment(e, 2);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(e.authorizeCalls.filter((a) => a.stepId === "st")).toHaveLength(0);
  });
  it("B2 central: the sweep's verifier cannot tell (connection unconfirmed), the dispatch sees a pinned STOP: handed to the dispatcher", async () => {
    seedHalt();
    h.connOk = false;
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    await centralRun(def("b2", [gate(), parF("p", [move("x"), box("b", [delay("w", 200), otStop("st")])])]), 1);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it.todo("B2 edge: unverified forward STOP goes to the edge dispatcher with no authorisation — T5, the route of R5");
  it("B3 an unverified compensation the split reads as not a STOP: held, not sent", async () => {
    seedHalt();
    h.connOk = false;
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("b3", [gate(), box("b", [move("x")], { compensation: otStop("cs") })]), 1);
    await wait(40);
    expect(ids()).toEqual(["x"]);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "cs")).toMatchObject({ status: "held" });
    expect(hangUyQuyen("cs")).toBe(0); // the split's own predicate stopped it: it never went as far as an authorisation
  });
  it("B4 central: a branch never evaluated: its STOPs are NOT sent, each is named in an URGENT (M1)", async () => {
    h.timeoutDispatch.add("x");
    h.telemetry = [{ key: "temp", value: 150 }];
    await centralRun(def("b4", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), brn("br", [robotStop("sThen"), move("mThen")], [robotStop("sElse")])])])]), 1);
    await wait(30);
    expect(ids()).toEqual(["x"]);
    const chu = h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.stopUntakenBranch).map((a) => `${a.title} ${a.message}`).join(" ");
    expect(chu).toContain('"sThen"');
    expect(chu).toContain('"sElse"');
  });
  it("B4 edge: the same, the anomaly names them", async () => {
    const e = await denBuoc(def("b4e", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), brn("br", [robotStop("sThen"), move("mThen")], [robotStop("sElse")])])])]));
    h.timeoutDispatch.add("x");
    h.telemetry = [{ key: "temp", value: 150 }];
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x"]);
    const bao = (e.events ?? []).filter((v) => v.kind === "anomaly" && String(v.detail).includes('"loai":"stopUntakenBranch"')).map((v) => String(v.detail)).join(" ");
    expect(bao).toContain('"stepId":"sThen"');
    expect(bao).toContain('"stepId":"sElse"');
  });
  it("B5 central: stop-typed, read, not pinned, reached the door: not sent, no authorisation row, its row says so", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("b5", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), stopTyped("nt")])])]), 1);
    expect(ids()).toEqual(["x"]);
    expect(hangUyQuyen("nt")).toBe(0);
    expect(String(hang(c, "nt")!.error)).toMatch(khongGui);
  });
  it("B5 edge: the same, 0 /authorize", async () => {
    const e = await denBuoc(def("b5e", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), stopTyped("nt")])])]));
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["x"]);
    expect(authCua(e, "nt")).toBe(0);
    expect(String(hang(e.runId, "nt")!.error)).toMatch(khongGui);
  });
  it("B6 a run that only ever sent a STOP: a latched walk has no 'not needed', the next STOP goes", async () => {
    h.timeoutDispatch.add("s1");
    await centralRun(def("b6", [gate(), { ...(robotStop("s1") as object), maxAttempts: 0 } as never, delay("w", 5), robotStop("s2")]), 1);
    await waitFor(() => ids().includes("s2"), "the next STOP");
    expect(ids().filter((x) => x === "s2")).toEqual(["s2"]);
  });
  it("B7 central: a sibling that did not fail keeps its STOP compensation: not sent", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    await centralRun(def("b7", [gate(), parF("p", [move("ok", { compensation: robotStop("cs") }), move("x")])]), 1);
    await wait(30);
    expect(ids().sort()).toEqual(["ok", "x"]);
  });
  it("B7 edge: the same", async () => {
    const e = await denBuoc(def("b7e", [gate(), parF("p", [move("ok", { compensation: robotStop("cs") }), move("x")])]));
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    expect(ids().sort()).toEqual(["ok", "x"]);
  });
  it("B8 central: a sibling hangs: the STOP goes while it is in flight", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("m", 300);
    const { di } = await diKhongCho(def("b8", [gate(), parF("p", [move("x"), box("b", [move("m"), robotStop("st")])])]));
    await trongLuc(di, () => ids().includes("st"), "the STOP", 150);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("B8 edge: the same", async () => {
    const e = await denBuoc(def("b8e", [gate(), parF("p", [move("x"), box("b", [move("m"), robotStop("st")])])]));
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("m", 300);
    const seg = edgeSegment(e, 2);
    await trongLuc(seg, () => ids().includes("st"), "the STOP", 150);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("B9 + F12-37 a compensation walking its own body: its STOP goes once, no second URGENT, the plan never sends it", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    const c = await centralRun(def("b9", [gate(), parF("p", [move("x"), move("f", { compensation: box("cb", [delay("w", 60), robotStop("cs")]) })])]), 1);
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect((centralWrites.get(c) ?? []).filter((w) => w.stepId === "cs" && w.status === "running" && w.result === "-"), "the plan walked it a second time").toHaveLength(1);
  });
  const thanHong = (ref: string) => def(ref, [gate(), parF("p", [move("x"), move("f", { compensation: box("cb", [move("q"), robotStop("cs")]) })])]);
  it("B9-truoc a body whose step failed before the latch: the pinned STOP behind that step goes, once, on the latched run", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    h.failPlan.set("q", 1);
    await centralRun(thanHong("b9t"), 1);
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("B9-sau the same, the body's step fails after the latch", async () => {
    h.slow.set("x", 20);
    h.timeoutDispatch.add("x");
    h.failPlan.set("f", 1);
    h.failPlan.set("q", 1);
    h.slow.set("q", 60);
    await centralRun(thanHong("b9s"), 1);
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  const dinhThan = (ref: string, cac: WorkflowStep[]) => def(ref, [gate(), move("f", { compensation: box("cb", cac) })]);
  it("THAN-KR central: a body's command goes unknown, the STOP behind it goes; the non-STOP step between stays", async () => {
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan("thankr", [move("q"), move("z"), robotStop("cs")]), 1);
    await waitFor(() => ids().includes("cs"), "the STOP behind the body's step");
    expect(ids()).toEqual(["f", "q", "cs"]);
    expect(hang(c, "z")).toBeUndefined();
  });
  it("THAN-KR edge: the same", async () => {
    const e = await denBuoc(dinhThan("thankre", [move("q"), move("z"), robotStop("cs")]));
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    await edgeSegment(e, 2);
    expect(ids()).toEqual(["f", "q", "cs"]);
    expect(authCua(e, "z")).toBe(0);
  });
  it("đối chứng O4: a body's step fails known on a run NOT latched: nothing changes, the STOP behind it stays unsent", async () => {
    h.failPlan.set("f", 1);
    h.failPlan.set("q", 1);
    const c = await centralRun(dinhThan("than-o4", [move("q"), robotStop("cs")]), 1);
    await wait(20);
    expect(ids()).toEqual(["f", "q"]);
    expect(hang(c, "cs")).toBeUndefined();
    expect(h.alerts).toEqual([]);
  });
  it("THAN-2-THU-TU a Continue's body and a pass reach one STOP: the pass first, the body takes its answer, one hand-over", async () => {
    seedHalt();
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("than2", [gate(), box("b", [move("x")], { compensation: box("cb", [ot("u"), delay("w", 40), otStop("cs")]) })]), 1);
    expect(runRow(c).status).toBe("held");
    expect(ids()).toEqual(["x"]);
    h.ghim = PIN_OK;
    h.sent.length = 0;
    h.timeoutDispatch.clear();
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect(ids()).toContain("u");
  });
  it("THAN-TUCHOI a body's STOP refused by its dispatcher: a row with the failure, an URGENT naming it; never no row and nobody told", async () => {
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    h.failPlan.set("cs", Infinity);
    const c = await centralRun(dinhThan("thantc", [move("q"), robotStop("cs")]), 1);
    await waitFor(() => ids().includes("cs"), "the STOP");
    await wait(20);
    expect(hang(c, "cs")).toMatchObject({ status: "failed" });
    expect(h.alerts.filter((a) => String(a.message).includes('"cs"')).length).toBeGreaterThan(0);
  });
  it("THAN-TUCHOI-T5 the same: the refused STOP is owed: the row carries the mark, the run is held, Abort sends it (state C)", async () => {
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    h.failPlan.set("cs", Infinity);
    const c = await centralRun(dinhThan("thant5", [move("q"), robotStop("cs")]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
  });
  const hoiTreo = (ref: string, comp: WorkflowStep) => def(ref, [gate(), parF("p", [move("x"), move("hang"), box("b", [delay("w", 30), move("r3", { compensation: comp })])])]);
  it("B10 + F12-38 central: a step stopped at the door, its own STOP compensation goes while a sibling hangs", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 400);
    const { runId: c, di } = await diKhongCho(hoiTreo("b10", robotStop("cs")));
    await trongLuc(di, () => ids().includes("cs"), "the refused step's STOP", 200);
    expect(ids()).not.toContain("r3");
    expect(String(hang(c, "r3")!.error)).toMatch(khongGui);
  });
  it("B10 edge: the same", async () => {
    const e = await denBuoc(hoiTreo("b10e", robotStop("cs")));
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 400);
    const seg = edgeSegment(e, 2);
    await trongLuc(seg, () => ids().includes("cs"), "the refused step's STOP", 200);
    expect(ids()).not.toContain("r3");
    expect(authCua(e, "r3")).toBe(0);
  });
  it("B13 a STOP compensation behind a slow STOP: not chained, it goes before the slow one answers", async () => {
    h.timeoutDispatch.add("x");
    h.slow.set("c1", 400);
    const { runId: c, di } = await diKhongCho(def("b13", [gate(), parF("p", [move("x"), box("a", [delay("wa", 20), move("r3", { compensation: robotStop("c1") })]), box("b", [delay("wb", 40), move("r4", { compensation: robotStop("c2") })])])]));
    await trongLuc(di, () => ids().includes("c2"), "the second STOP", 200);
    expect(ids().sort()).toEqual(["c1", "c2", "x"]);
    expect(hang(c, "c1"), "the walk ended before its STOP answered").toMatchObject({ status: "compensated" });
  });
  it("B13 two forward STOPs of one pass: the slow one holds no other", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("s1", 400);
    const { di } = await diKhongCho(def("b13p", [gate(), box("b", [move("x"), robotStop("s1"), robotStop("s2")])]));
    await trongLuc(di, () => ids().includes("s2"), "the second STOP", 200);
  });
  it("B14 central: B10 with a container compensation: its STOP goes while a sibling hangs", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 400);
    const { di } = await diKhongCho(hoiTreo("b14", box("cb", [robotStop("cs")])));
    await trongLuc(di, () => ids().includes("cs"), "the STOP inside the compensation", 200);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("B14 edge: the same", async () => {
    const e = await denBuoc(hoiTreo("b14e", box("cb", [robotStop("cs")])));
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 400);
    const seg = edgeSegment(e, 2);
    await trongLuc(seg, () => ids().includes("cs"), "the STOP inside the compensation", 200);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("F12-20 a verified STOP that failed on this very walk: not sent again, it had its attempts", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    h.failPlan.set("st", 1);
    const c = await centralRun(def("f12-20", [gate(), parF("p", [move("x"), { ...(robotStop("st") as object), maxAttempts: 0 } as never])]), 1);
    await wait(30);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(hang(c, "st")).toMatchObject({ status: "failed" });
  });
  it("F12-40 a refused step's non-STOP compensation: not due, no row", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("f12-40", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), move("r3", { compensation: ot("u") })])])]), 1);
    await wait(20);
    expect(ids()).toEqual(["x"]);
    expect(hang(c, "u")).toBeUndefined();
  });

  // ── asking again, one hand-over ────────────────────────────────────────────────────────────────────────────────────
  const dinhComp = (ref: string, comp: WorkflowStep) => def(ref, [gate(), parF("p", [move("x"), ot("f", { compensation: comp })])]);
  /** the pin read of a STOP takes 80 ms; the first one fails, the ones after it read `sau` */
  const ghimLan = (sau: (d: unknown, i: { commandType: string }) => Promise<{ pinnedStop: boolean; loiDocGhim: string | null }>) => {
    let n = 0;
    return async (d: unknown, i: { commandType: string }) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      await wait(80);
      return n++ === 0 ? PIN_BAD() : sau(d, i);
    };
  };
  it("COMP-RACE central, 10 laps: a STOP compensation asked before the latch, its pins unreadable then, asks again at the sink: it goes", async () => {
    const dem = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      h.sent.length = 0;
      h.alerts.length = 0;
      h.timeoutDispatch.clear();
      h.traTimeout = 0;
      h.ghimLan.length = 0;
      seedHalt();
      h.ghim = ghimLan(PIN_OK);
      h.timeoutDispatch.add("x");
      h.slow.set("x", 40);
      h.failPlan.set("f", 1);
      const c = await centralRun(dinhComp(`cr${i}`, otStop("cs")), 1);
      await wait(20);
      const k = `run=${runRow(c).status} cs=${ids().filter((x) => x === "cs").length} row=${hang(c, "cs")?.status} asks=${h.ghimLan.filter((x) => x === "stop").length}`;
      dem.set(k, (dem.get(k) ?? 0) + 1);
    }
    console.log("[PROBE COMP-RACE central laps]", JSON.stringify([...dem]));
    expect([...dem]).toEqual([["run=failed cs=1 row=compensated asks=2", 10]]);
  });
  it("COMP-RACE central control: pins read at the first ask: it goes, no second ask", async () => {
    seedHalt();
    h.ghim = async (d, i) => {
      if (i.commandType === "stop") await wait(80);
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    await centralRun(dinhComp("crq", otStop("cs")), 1);
    await wait(20);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect(h.ghimLan.filter((x) => x === "stop")).toHaveLength(1);
  });
  it("COMP-RACE central, read, not pinned: nothing goes, held", async () => {
    seedHalt();
    h.ghim = ghimLan(async () => ({ pinnedStop: false, loiDocGhim: null }));
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(dinhComp("crn", otStop("cs")), 1);
    await wait(20);
    expect(ids().filter((x) => x === "cs")).toEqual([]);
    expect(runRow(c).status).toBe("held");
  });
  it("COMP-RACE control non-STOP compensation: never asks again, 0 hand-overs", async () => {
    h.ghim = async (_d, i) => {
      if ((i as { writes?: Array<{ tagKey?: string }> }).writes?.[0]?.tagKey === "speed") await wait(80);
      return { pinnedStop: false, loiDocGhim: null };
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(dinhComp("crc", ot("cn", { args: { tagKey: "speed", value: 5 } })), 1);
    await wait(20);
    expect(ids().filter((x) => x === "cn")).toEqual([]);
    expect(h.ghimLan.filter((x) => x === "start")).toHaveLength(2); // f, cn: one ask each
    expect(runRow(c).status).toBe("held");
  });
  it("COMP-RACE edge control non-STOP compensation: one /authorize, 0 hand-overs", async () => {
    const e = await denBuoc(dinhComp("crce", ot("cn", { args: { tagKey: "speed", value: 5 } })));
    e.authorizeDelay = new Map([["cn", 60]]);
    h.timeoutDispatch.add("x");
    h.slow.set("x", 25);
    h.failPlan.set("f", 1);
    await edgeSegment(e, 2);
    expect(ids().filter((x) => x === "cn")).toEqual([]);
    expect(authCua(e, "cn")).toBe(1);
  });
  it("COMP-RACE edge, 10 laps: the package could not verify the STOP compensation: no second /authorize of the same attempt, 0 hand-overs, held", async () => {
    const dem = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      h.sent.length = 0;
      h.timeoutDispatch.clear();
      h.traTimeout = 0;
      seedHalt();
      h.connOk = false;
      const e = await denBuoc(dinhComp(`ecr${i}`, otStop("cs")));
      e.authorizeDelay = new Map([["cs", 60]]);
      h.timeoutDispatch.add("x");
      h.slow.set("x", 25);
      h.failPlan.set("f", 1);
      const s = await edgeSegment(e, 2);
      h.connOk = true;
      const k = `out=${s.out.outcome} cs=${ids().filter((x) => x === "cs").length} auth=${authCua(e, "cs")}`;
      dem.set(k, (dem.get(k) ?? 0) + 1);
    }
    console.log("[PROBE COMP-RACE edge laps]", JSON.stringify([...dem]));
    expect([...dem]).toEqual([["out=held cs=0 auth=1", 10]]);
  });
  it.todo("COMP-RACE central, pins unreadable for good: the marked row, the dispatcher decides, 0 PDU if not pinned — T5, the route of R4 (B11)");
  it.todo("COMP-RACE edge, pins unreadable for good: no authorisation, the edge dispatcher decides — T5, the route of R5 (B11)");
  it("FWD-RACE a forward STOP read too early: asks again at the sink once, reads pinned, one hand-over", async () => {
    seedHalt();
    h.ghim = ghimLan(PIN_OK);
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("fwd", [gate(), parF("p", [move("x"), otStop("st")])]), 1);
    await wait(20);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(hang(c, "st")).toMatchObject({ status: "completed" });
  });
  it("FWD-RACE the walker's first read and the pass's both fail: the ask again at the sink reads pinned, one hand-over", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      const lan = n++;
      await wait(70);
      return lan < 2 ? PIN_BAD() : PIN_OK(d, i);
    };
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("fwd2", [gate(), parF("p", [move("x"), otStop("st")])]), 1);
    await wait(30);
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    expect(hang(c, "st")).toMatchObject({ status: "completed" });
  });
  it("X4-ba a STOP compensation read wrong at the first ask AND at the ask again: the last pass reads it right, it goes", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      await wait(80);
      return n++ < 2 ? PIN_BAD() : PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(dinhComp("x4ba", otStop("cs")), 1);
    await wait(20);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
  });
  it("B14 two STOPs in one container compensation: the slow first one holds the second back no longer than the sibling", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    h.slow.set("hang", 500);
    h.slow.set("cs1", 350);
    const { di } = await diKhongCho(hoiTreo("b14h", box("cb", [robotStop("cs1"), robotStop("cs2")])));
    await trongLuc(di, () => ids().includes("cs2"), "the second STOP", 200);
    expect(ids().sort()).toEqual(["cs1", "cs2", "hang", "x"]);
  });

  // ── a container begun, the walk comes back ─────────────────────────────────────────────────────────────────────────
  const khung = (ref: string, cac: WorkflowStep[], comp: WorkflowStep = robotStop("cs")) => def(ref, [gate(), parF("p", [move("x"), box("b", cac, { compensation: comp })])]);
  const CAC = () => [move("a"), gate("g2"), move("r3")];
  const duyetG2 = async (c: number) => {
    const view = (await getRun(c, { bindingDigest: true }))!;
    return resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
  };
  const urgentCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND) => h.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND[kind]);
  async function denG2(ref: string, cac = CAC(), comp?: WorkflowStep, stop: string[] = []) {
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    const c = await centralRun(khung(ref, cac, comp), 1);
    expect(ids().filter((x) => !stop.includes(x)).sort()).toEqual(["a", "x"]); // a STOP of the container went at the latch
    h.sent.length = 0;
    h.alerts.length = 0;
    h.timeoutDispatch.clear();
    return c;
  }
  const dangDo = (c: number) => {
    expect(ids()).toEqual(["cs"]);
    expect(hang(c, "b")).toMatchObject({ status: "failed" });
    expect(String(hang(c, "r3")!.error)).toMatch(khongGui);
    expect(urgentCua("forwardNotSent").length, "forward work dropped: decision 3").toBeGreaterThan(0);
  };
  it("KHUNG g2 central: a container begun, its gate approved on a latched run: walked unread, r3 refused, the container's STOP goes, forwardNotSent", async () => {
    const c = await denG2("khung-g");
    await duyetG2(c);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    dangDo(c);
  });
  it("KHUNG boot central: the same, the walk comes from a boot with no memory of it", async () => {
    const c = await denG2("khung-b");
    process.env.FOE_DURABLE = "true";
    Object.assign(runRow(c), { status: "held", finishedAt: null, error: null, currentStepId: null, contextJson: { ...runRow(c).contextJson, interrupted: true } });
    Object.assign(hang(c, "g2")!, { status: "completed" });
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    dangDo(c);
  });
  it("KHUNG edge: the same, the next segment", async () => {
    const e = await denBuoc(khung("khung-e", CAC()));
    h.slow.set("x", 40);
    h.timeoutDispatch.add("x");
    await edgeSegment(e, 2);
    h.sent.length = 0;
    h.alerts.length = 0;
    h.timeoutDispatch.clear();
    await approveEdgeGate(e);
    await edgeSegment(e, 3);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(ids()).toEqual(["cs"]);
    expect(authCua(e, "r3")).toBe(0);
    expect(hang(e.runId, "b")).toMatchObject({ status: "failed" });
    expect(String(hang(e.runId, "r3")!.error)).toMatch(khongGui);
    expect((e.events ?? []).filter((v) => v.kind === "anomaly" && String(v.detail).includes('"loai":"forwardNotSent"')).length).toBeGreaterThan(0);
  });
  it("KHUNG a gate and a long delay behind r3: the STOP waits for neither, neither gets a row", async () => {
    const c = await denG2("khung-s", [move("a"), gate("g2"), move("r3"), gate("g3"), delay("w", 5_000)]);
    const t0 = Date.now();
    await duyetG2(c);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(hang(c, "g3")).toBeUndefined();
    expect(runRow(c).status).toBe("failed");
  });
  it("KHUNG a delay never started in front of r3: the door stops it, the STOP does not sleep through it, forwardNotSent", async () => {
    const c = await denG2("khung-d", [move("a"), gate("g2"), delay("w", 5_000), move("r3")]);
    const t0 = Date.now();
    await duyetG2(c);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(urgentCua("forwardNotSent").length).toBeGreaterThan(0);
  });
  it("KHUNG non-STOP compensation: held for a person, nothing sent, no /authorize of a child", async () => {
    const c = await denG2("khung-n", CAC(), ot("cn", { args: { tagKey: "speed", value: 5 } }));
    await duyetG2(c);
    await wait(40);
    expect(ids()).toEqual([]);
    expect(hangUyQuyen("r3")).toBe(0);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "cn")).toMatchObject({ status: "held" });
  });
  it("KHUNG boot a delay left running by a crash: a delay is no container: the door stops it, the STOP does not sleep through it", async () => {
    const c = await denG2("khung-r", [move("a"), gate("g2"), delay("w", 5_000), move("r3")]);
    process.env.FOE_DURABLE = "true";
    Object.assign(runRow(c), { status: "held", finishedAt: null, error: null, currentStepId: null, contextJson: { ...runRow(c).contextJson, interrupted: true } });
    Object.assign(hang(c, "g2")!, { status: "completed" });
    fake.seed(orchestrationRunSteps, [...rows("orchestration_run_steps"), { id: 99_100, runId: c, stepId: "w", stepType: "delay", status: "running", attempt: 0, startedAt: new Date(), finishedAt: null, error: null, resultJson: null }]);
    const t0 = Date.now();
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
  it("KHUNG a nested container never started: still stopped at the door: no row, no authorisation; the outer container's STOP goes", async () => {
    const c = await denG2("khung-l", [move("a"), gate("g2"), box("c", [move("r4")])]);
    await duyetG2(c);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(hang(c, "c")).toBeUndefined();
    expect(hang(c, "r4")).toBeUndefined();
    expect(hangUyQuyen("r4")).toBe(0);
    expect(urgentCua("forwardNotSent").length).toBeGreaterThan(0);
  });
  it("KHUNG a container not begun on a latched run: stopped at the door, its STOP compensation not due (nothing of it ran)", async () => {
    h.slow.set("x", 15);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("khung-c", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("b", [move("r3")], { compensation: robotStop("cs") })])])]), 1);
    await wait(20);
    expect(ids()).toEqual(["x"]);
    expect(hang(c, "b")).toBeUndefined();
  });
  it("B7-sau a container finished before the latch: its STOP compensation stays unsent on the walk that comes back", async () => {
    h.slow.set("x", 30);
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("b7s", [gate(), parF("p", [move("x"), box("b", [move("a")], { compensation: robotStop("cs") })]), gate("g3")]), 1);
    await wait(20);
    expect(ids().sort()).toEqual(["a", "x"]);
    expect(hang(c, "b")).toMatchObject({ status: "completed" });
  });

  // ── K2a: a held compensation of a step the door refused holds the run ──────────────────────────────────────────────
  const k2a = (ref: string) => def(ref, [gate(), parF("p", [move("x"), box("b", [delay("w", 30), move("r3", { compensation: otStop("cs") })])])]);
  for (const dang of ["khongGhim", "docLoi"] as const) {
    const sau = () => (dang === "khongGhim" ? { pinnedStop: false, loiDocGhim: null } : { pinnedStop: false, loiDocGhim: "pin read timed out (test)" });
    const denK2a = async (ref: string) => {
      seedHalt();
      let n = 0;
      h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n === 1 ? PIN_OK(d, i) : sau());
      h.timeoutDispatch.add("x");
      const c = await centralRun(k2a(ref), 1);
      await wait(30);
      expect(ids()).toEqual(["x"]);
      expect(runRow(c).status).toBe("held");
      expect(hang(c, "cs")).toMatchObject({ status: "held" });
      expect(urgentCua("held").length).toBeGreaterThan(0);
      h.ghim = PIN_OK;
      h.timeoutDispatch.clear();
      h.sent.length = 0;
      return c;
    };
    it(`K2a ${dang}, Continue: the URGENT said Continue: the read recovered, it works, the STOP goes once`, async () => {
      const c = await denK2a(`k2ac-${dang}`);
      const r = await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
      expect(String(r.message ?? "")).not.toMatch(/not resumable|already terminal/);
      await waitFor(() => ids().includes("cs"), "the STOP");
      await wait(20);
      expect(ids()).toEqual(["cs"]);
      expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
    });
    it(`K2a ${dang}, Abort: the URGENT said Abort: the read recovered, it works, the STOP goes once`, async () => {
      const c = await denK2a(`k2ab-${dang}`);
      const r = await abortRun(c, OWNER, "checked on site");
      expect(r.ok).toBe(true);
      await waitFor(() => ids().includes("cs"), "the STOP");
      await wait(20);
      expect(ids()).toEqual(["cs"]);
      expect(runRow(c).status).toBe("aborted");
    });
  }
  // K2 race, parity: the pass holds the container's STOP compensation; the a2n harness has no classifyOtStop, an Abort sweep verifies nothing there
  for (const dang of ["khongGhim", "docLoi"] as const) {
    it(`K2 ${dang}, Abort: the URGENT names Abort: the read recovered, it works, the STOP goes once, no 'already terminal'`, async () => {
      seedHalt();
      let n = 0;
      h.ghim = async (d, i) => {
        if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
        if (++n === 1) return PIN_OK(d, i);
        await wait(40);
        return dang === "khongGhim" ? { pinnedStop: false, loiDocGhim: null } : PIN_BAD();
      };
      h.timeoutDispatch.add("x");
      const c = await centralRun(def(`k2ab-${dang}`, [gate(), box("b", [move("x")], { compensation: otStop("cs") })]), 1);
      await wait(70);
      expect(runRow(c).status).toBe("held");
      expect(ids()).toEqual(["x"]);
      h.ghim = PIN_OK;
      h.timeoutDispatch.clear();
      h.sent.length = 0;
      const r = await abortRun(c, OWNER, "checked on site");
      expect(r.ok, r.message).toBe(true);
      await waitFor(() => ids().includes("cs"), "the STOP");
      await wait(20);
      expect(ids()).toEqual(["cs"]);
      expect(runRow(c).status).toBe("aborted");
    });
  }
  it("K2-THAN a container compensation of a door-refused step, its STOP not pinned at dispatch: held, the run holds; the read recovered, a Continue sends it once", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n === 1 ? PIN_OK(d, i) : { pinnedStop: false, loiDocGhim: null });
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("k2than", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), move("r3", { compensation: box("cb", [otStop("cs")]) })])])]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "cs")).toMatchObject({ status: "held" });
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    const r = await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    expect(String(r.message ?? "")).not.toMatch(/not resumable|already terminal/);
    await waitFor(() => ids().includes("cs"), "the STOP");
    await wait(20);
    expect(ids()).toEqual(["cs"]);
  });
  it("THAN-GIU a STOP behind a failed step of a body, not pinned at its dispatch: its row held, the run holds; the read recovered, a Continue sends that STOP and nothing of the body before it", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n === 1 ? PIN_OK(d, i) : { pinnedStop: false, loiDocGhim: null });
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan("thangiu", [move("q"), otStop("cs")]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
    expect(hang(c, "cs")).toMatchObject({ status: "held" });
    expect(runRow(c).contextJson.foeResumeState?.f, "the hold is that STOP's, not the body's: a Continue must not walk the body again").toBeUndefined();
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    const r = await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    expect(String(r.message ?? "")).not.toMatch(/not resumable|already terminal/);
    await waitFor(() => ids().includes("cs"), "the STOP");
    await wait(20);
    expect(ids()).toEqual(["cs"]);
  });
  // ── lượt sửa 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const denThanGiu = async (ref: string) => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n === 1 ? PIN_OK(d, i) : { pinnedStop: false, loiDocGhim: null });
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan(ref, [move("q"), otStop("cs")]), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
    return c;
  };
  it("THAN-GIU-ABORT-T7b the same held STOP, the read recovered, Abort: the URGENT named Abort, the sweep must reach it", async () => {
    const c = await denThanGiu("tg-ab");
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    await abortRun(c, OWNER, "checked on site");
    await wait(30);
    expect(ids()).toEqual(["cs"]);
    expect(hang(c, "cs")?.status).not.toBe("held");
  });
  it("THAN-GIU-ABORT-TUCHOI-T7b the same, the dispatcher refuses the Abort's STOP: abort:cs stays owed, a second Abort sends it", async () => {
    const c = await denThanGiu("tg-at");
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    h.failPlan.set("cs", 1);
    await abortRun(c, OWNER, "checked on site");
    await wait(30);
    expect(ids()).toEqual(["cs"]);
    expect(hang(c, "abort:cs")).toMatchObject({ status: "failed" });
    await abortRun(c, OWNER, "again");
    await wait(30);
    expect(ids()).toEqual(["cs", "cs"]);
    expect(hang(c, "abort:cs")).toMatchObject({ status: "completed" });
  });
  it("THAN-GIU-CONTINUE-T9 a Continue that only sends a STOP asks no reason and sends no non-STOP; the URGENT says so, no 'a reason is required', no 'waiting for a person'", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n === 1 ? PIN_OK(d, i) : { pinnedStop: false, loiDocGhim: null });
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan("tg-co", [move("q"), move("z"), otStop("cs")]), 1);
    await wait(30);
    const chu = urgentCua("held").map((a) => `${a.title} ${a.message}`).join(" ");
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    const view = (await getRun(c, { bindingDigest: true }))!;
    await resumeRun(c, { approved: true, expectedStepId: view.run.currentStepId, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    await waitFor(() => ids().includes("cs"), "the STOP");
    await wait(20);
    expect(ids()).toEqual(["cs"]);
    expect(chu).not.toBe("");
    expect(chu).not.toContain("a reason is required");
    expect(chu).not.toContain("waiting for a person");
  });
  it("THAN-GIU-BOOT-T10 a boot on the same hold goes through congBootStop: inside the bound from the durable latch mark it goes; past it, nothing goes, state C, an URGENT, a person decides", async () => {
    const chay = async (ref: string, luc: string) => {
      const c = await denThanGiu(ref);
      process.env.FOE_DURABLE = "true";
      const ctx = runRow(c).contextJson as Record<string, unknown>;
      Object.assign(runRow(c), { status: "held", error: null, contextJson: { ...ctx, interrupted: true, [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { ...(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY] as object), at: luc } } });
      h.ghim = PIN_OK;
      h.timeoutDispatch.clear();
      h.sent.length = 0;
      h.alerts.length = 0;
      await autoResumeInterruptedRuns([c]);
      await wait(40);
      return c;
    };
    await chay("tg-bt", new Date().toISOString());
    expect(ids()).toEqual(["cs"]);
    const c = await chay("tg-bq", new Date(Date.now() - 3_600_000).toISOString());
    expect(ids(), "past the bound a boot sends nothing by itself").toEqual([]);
    expect(runRow(c).status).toBe("held");
    expect(h.alerts.length).toBeGreaterThan(0);
  });
  it("THAN-DOC-T5 a STOP behind a failed step of a body, its pins unreadable from the start: a row with the mark, owed, an URGENT naming it, the run held", async () => {
    seedHalt();
    h.ghim = PIN_BAD;
    h.failPlan.set("f", 1);
    h.timeoutDispatch.add("q");
    const c = await centralRun(dinhThan("tdoc", [move("q"), otStop("cs")]), 1);
    await wait(30);
    expect(hang(c, "cs"), "no row, nobody told").toBeDefined();
    expect(h.alerts.filter((a) => String(a.message).includes('"cs"')).length).toBeGreaterThan(0);
    expect(runRow(c).status).toBe("held");
  });
  it("MAT-HANG-B boot, the container's own row lost, its children's rows there: it was begun: walked, the STOP goes, r3 is what was dropped, not a", async () => {
    const c = await denG2("mhb");
    process.env.FOE_DURABLE = "true";
    Object.assign(runRow(c), { status: "held", finishedAt: null, error: null, currentStepId: null, contextJson: { ...runRow(c).contextJson, interrupted: true } });
    Object.assign(hang(c, "g2")!, { status: "completed" });
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== c || r.stepId !== "b"));
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(ids()).toEqual(["cs"]);
    expect(String(hang(c, "r3")!.error)).toMatch(khongGui);
    expect(urgentCua("forwardNotSent").map((a) => a.dedupKey.split(":")[2])).toEqual(["r3"]);
  });
  const buocBo = () => urgentCua("forwardNotSent").map((a) => a.dedupKey.split(":")[2]);
  const bootMat = async (c: number, mat: string[], sua?: () => void) => {
    process.env.FOE_DURABLE = "true";
    Object.assign(runRow(c), { status: "held", finishedAt: null, error: null, currentStepId: null, contextJson: { ...runRow(c).contextJson, interrupted: true } });
    if (hang(c, "g2")) Object.assign(hang(c, "g2")!, { status: "completed" });
    fake.store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== c || !mat.includes(r.stepId)));
    sua?.();
    await autoResumeInterruptedRuns([c]);
  };
  it("MAT-HANG-SAU the row that proves it is a child two levels down, both containers' rows lost: begun, walked, the STOP goes", async () => {
    const c = await denG2("mhs", [box("c", [move("a"), gate("g2"), move("r3")])]);
    await bootMat(c, ["b", "c"]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(ids()).toEqual(["cs"]);
    expect(buocBo()).toEqual(["r3"]);
  });
  it("MAT-HANG-B phủ định: what is left behind the lost row is a STOP its dispatcher refuses: forwardNotSent still names it, never silent", async () => {
    h.failPlan.set("s", Infinity);
    const c = await denG2("mhp", [move("a"), gate("g2"), robotStop("s")], undefined, ["s", "cs"]); // s failed: its container's STOP went with the walk
    await bootMat(c, ["b"]);
    await waitFor(() => ids().includes("s"), "the STOP");
    await wait(30);
    expect(buocBo()).toEqual(["s"]);
  });
  it("MAT-HANG-B phủ định: nothing left behind the lost row: no forwardNotSent", async () => {
    const c = await denG2("mhn", [move("a"), gate("g2")]);
    await bootMat(c, ["b"]);
    await wait(40);
    expect(buocBo()).toEqual([]);
  });
  it("MAT-HET every row of the container and its children lost, the context's dispatched list kept: that list is the proof: the STOP goes, a is not called unsent", async () => {
    const c = await denG2("mhk");
    await bootMat(c, ["b", "a", "g2"]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    await wait(30);
    expect(ids()).toEqual(["cs"]);
    expect(buocBo()).not.toContain("a");
  });
  it.todo("MAT-HET-CS the same with the dispatched list lost too: no evidence the container began: cs does not go, no URGENT names it, forward_not_sent says a was not handed over (measured, reported to the coordinator, task not decided)");
  it("TEN-LOI a begun container, its row lost, a step with a device's error in it: the step behind it is named, not the one that answered", async () => {
    const c = await denG2("tl", [move("a"), gate("g2"), move("y"), move("m")]);
    fake.seed(orchestrationRunSteps, [...rows("orchestration_run_steps"), { id: 99_200, runId: c, stepId: "y", stepType: "command", status: "failed", attempt: 1, startedAt: new Date(), finishedAt: new Date(), error: "device said no", resultJson: null }]);
    await bootMat(c, ["b"]);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    await wait(30);
    expect(buocBo()).toEqual(["m"]);
  });
  it("TEN-NOTPIN phủ định: a stop-typed step that is no STOP stands at the door: it never went: named", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("tnp", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), stopTyped("nt")])])]), 1);
    await wait(30);
    expect(ids()).toEqual(["x"]);
    expect(buocBo()).toEqual(["nt"]);
  });
  it("TEN-TUCHOI phủ định: a STOP at the door its dispatcher refuses: it did not go: named", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    h.failPlan.set("s", Infinity);
    await centralRun(def("ttc", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), robotStop("s")])])]), 1);
    await wait(30);
    expect(buocBo()).toEqual(["s"]);
  });
  it("TEN-STOP a container never begun holding only a STOP the pass sends: nothing forward was dropped: no forwardNotSent", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("ts", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), box("c", [robotStop("s")])])])]), 1);
    await wait(30);
    expect(ids()).toEqual(["x", "s"]);
    expect(buocBo()).toEqual([]);
  });
  it("TEN-STOP-M a STOP at the door with a command behind it: the command is what was dropped", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("tsm", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), robotStop("s"), move("m")])])]), 1);
    await wait(30);
    expect(ids()).toEqual(["x", "s"]);
    expect(buocBo()).toEqual(["m"]);
  });
  it("TEN-DELAY a delay at the door, no command behind it: nothing forward was dropped", async () => {
    h.slow.set("x", 10);
    h.timeoutDispatch.add("x");
    await centralRun(def("td", [gate(), parF("p", [move("x"), box("v", [delay("w", 30), delay("w2", 10)])])]), 1);
    await wait(30);
    expect(buocBo()).toEqual([]);
  });
  it("TEN-XONG a container at the door with a finished step and a STOP in it, then a command: the command is named, never the finished step", async () => {
    const c = await denG2("tx", [move("a"), gate("g2"), delay("w", 5_000), robotStop("s"), move("m")], undefined, ["s"]);
    await duyetG2(c);
    await waitFor(() => ids().includes("cs"), "the container's STOP");
    expect(buocBo()).toEqual(["m"]);
  });
  it("KTB a container with a device's error from an earlier walk: its failure keeps its meaning, no forwardNotSent over it", async () => {
    h.timeoutDispatch.add("x");
    h.failPlan.set("y", 1);
    const c = await centralRun(def("ktb", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [move("y"), move("m")])])]), 1);
    chet(c, ["g1", "p", "x", "b", "y"], () => {
      Object.assign(hang(c, "y")!, { status: "failed", error: "device said no" });
      Object.assign(hang(c, "b")!, { status: "failed", error: "device said no" });
    });
    await autoResumeInterruptedRuns([c]);
    await wait(30);
    expect(buocBo()).toEqual([]);
  });
  // R5: a STOP that went at the last pass lifts the hold it was the reason of
  it("X4-ba a hold at the sink, the STOP went at the last pass: the run ends by its walk, failed, no hold left, nothing more to send", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      await wait(80);
      return n++ < 2 ? PIN_BAD() : PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(dinhComp("x4ba2", otStop("cs")), 1);
    await wait(20);
    expect(runRow(c).status).toBe("failed");
    expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("K2-HOI a hold by a pass, the last pass reads it pinned: failed, compensated, one STOP", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if (++n === 2) return (await wait(10), { pinnedStop: false, loiDocGhim: null });
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    const c = await centralRun(k2a("k2h"), 1);
    await wait(30);
    expect(runRow(c).status).toBe("failed");
    expect(hang(c, "cs")).toMatchObject({ status: "compensated" });
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("K2-HOI đối chứng: the last attempt does not go either: held", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => (i.commandType !== "stop" ? { pinnedStop: false, loiDocGhim: null } : ++n % 2 === 1 ? PIN_OK(d, i) : { pinnedStop: false, loiDocGhim: null });
    h.timeoutDispatch.add("x");
    const c = await centralRun(k2a("k2hd"), 1);
    await wait(30);
    expect(ids()).toEqual(["x"]);
    expect(runRow(c).status).toBe("held");
  });
  it("K2-HOI đối chứng: the last attempt goes and the dispatcher refuses: held", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if (++n === 2) return (await wait(10), { pinnedStop: false, loiDocGhim: null });
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.failPlan.set("cs", Infinity);
    const c = await centralRun(k2a("k2hr"), 1);
    await wait(30);
    expect(runRow(c).status).toBe("held");
  });
  const denHoi = async (ref: string) => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if (++n === 2) return (await wait(10), { pinnedStop: false, loiDocGhim: null });
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    const c = await centralRun(k2a(ref), 1);
    await wait(30);
    return c;
  };
  it("K2-HOI H2: handed over, not confirmed, the URGENT not durable: held, not sent again", async () => {
    h.alertDurable = false;
    const c = await denHoi("k2hb");
    expect(runRow(c).status).toBe("held");
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("K2-HOI confirmed: acked_verified with no durable URGENT: the run ends, by the one path, one STOP", async () => {
    h.acked = true;
    h.ackStatus = "acked_verified";
    h.alertDurable = false;
    const c = await denHoi("k2hx");
    expect(runRow(c).status).toBe("failed");
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
  });
  it("K2-HOI no answer at the last attempt: not known to have gone: held", async () => {
    h.timeoutDispatch.add("cs");
    const c = await denHoi("k2ht");
    expect(runRow(c).status).toBe("held");
  });
  it("HELD-CU-T9 the URGENT that said NOT sent, once the STOP went: a later word corrects it (T9)", async () => {
    await denHoi("k2hc");
    const sau = h.alerts.findIndex((a) => a.kind === CANH_BAO_KHONG_RO_KIND.stopSimulated || a.kind === CANH_BAO_KHONG_RO_KIND.stopSent);
    expect(sau).toBeGreaterThanOrEqual(0);
    expect(urgentCua("held").map((a) => String(a.title)).filter((t) => t.includes('"cs"')), "the held URGENT stands uncorrected").toEqual([]);
  });
  it("K2-HOI two holds, one STOP goes at the last pass, the other does not: the run stays held", async () => {
    seedHalt();
    let n = 0;
    let m = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if ((i as unknown as { writes: Array<{ value: unknown }> }).writes[0].value === false) return { pinnedStop: ++m % 2 === 1, loiDocGhim: null };
      if (++n === 2) return (await wait(10), { pinnedStop: false, loiDocGhim: null });
      return PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("k2h2", [gate(), parF("p", [move("x"), box("b", [delay("w", 30), move("r3", { compensation: otStop("cs") })]), box("e", [delay("w2", 60), move("r4", { compensation: otStop("cs2", { args: { tagKey: "halt", value: false } }) })])])]), 1);
    await wait(30);
    expect(ids().filter((x) => x === "cs")).toEqual(["cs"]);
    expect(ids().filter((x) => x === "cs2")).toEqual([]);
    expect(runRow(c).status).toBe("held");
    expect(urgentCua("held").filter((a) => a.dedupKey.includes(":r4:cs2:")).length, "the second hold told nobody").toBeGreaterThan(0);
    expect(runRow(c).contextJson.foeResumeState?.r4).toMatchObject({ state: "compensationHeld" });
  });
  it("X4-TO-TIEN the hold lifted, but a container around it still owes a compensation that is no STOP: the run stays held, it is not lost", async () => {
    seedHalt();
    let n = 0;
    h.ghim = async (d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      await wait(80);
      return n++ < 2 ? PIN_BAD() : PIN_OK(d, i);
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 40);
    h.failPlan.set("f", 1);
    const c = await centralRun(def("x4tt", [gate(), box("o", [parF("p", [move("x"), ot("f", { compensation: otStop("cs") })])], { compensation: ot("u", { args: { tagKey: "speed", value: 1 } }) })]), 1);
    await wait(20);
    expect(ids()).not.toContain("u");
    expect(runRow(c).status).toBe("held");
  });
  it("K2a đối chứng: the STOP goes at its dispatch: the run ends, it is not held", async () => {
    seedHalt();
    h.ghim = PIN_OK;
    h.timeoutDispatch.add("x");
    const c = await centralRun(k2a("k2a-dc"), 1);
    await wait(30);
    expect(ids().sort()).toEqual(["cs", "x"]);
    expect(runRow(c).status).toBe("failed");
  });
  it("DONE-FAILED a STOP the sink refused in an earlier walk: a later walk's STOP pass goes through its resume state; it is sent", async () => {
    seedHalt();
    h.ghim = PIN_BAD;
    h.timeoutDispatch.add("x");
    h.slow.set("x", 30);
    const c = await centralRun(def("df", [gate(), parF("p", [move("x", { compensation: ot("u") }), box("b", [delay("w", 60), otStop("st")])])]), 1);
    await wait(20);
    expect(ids().filter((x) => x === "st")).toEqual([]);
    expect(String(hang(c, "st")!.error)).toMatch(khongGui);
    expect(runRow(c).status).toBe("held");
    h.ghim = PIN_OK;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await waitFor(() => ids().includes("st"), "the STOP");
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("đối chứng a non-STOP step refused at the sink: a later walk never enters it", async () => {
    h.ghim = async (_d, i) => {
      if (i.commandType === "start") await wait(70);
      return { pinnedStop: false, loiDocGhim: null };
    };
    h.timeoutDispatch.add("x");
    h.slow.set("x", 20);
    const c = await centralRun(def("df-c", [gate(), parF("p", [move("x", { compensation: ot("u", { args: { tagKey: "speed", value: 1 } }) }), ot("m2")])]), 1);
    await wait(20);
    expect(String(hang(c, "m2")!.error)).toMatch(khongGui);
    h.ghim = null;
    h.timeoutDispatch.clear();
    h.sent.length = 0;
    h.duocSauKhoa.add("u");
    await continueOutcomeUnknown({ runId: c } as EdgeHarness, "checked on site");
    await wait(40);
    expect(ids()).not.toContain("m2");
  });
  it("Q-5 with routedTo: a verified STOP left running by a crash, its result recorded: boot sends it again", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("q5a", [gate(), parF("p", [move("x"), robotStop("st")])]), 1);
    chet(c, ["g1", "x", "st"], () => Object.assign(hang(c, "st")!, { status: "running", error: null, finishedAt: null, resultJson: { routedTo: "robot-dispatcher", status: "done", accepted: true } }));
    h.slow.set("st", 5);
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("st"), "the STOP");
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
  });
  it("Q-5 no routedTo: the row left running proves nothing: boot sends it, its row ends completed", async () => {
    h.timeoutDispatch.add("x");
    const c = await centralRun(def("q5b", [gate(), parF("p", [move("x"), robotStop("st")])]), 1);
    chet(c, ["g1", "x", "st"], () => Object.assign(hang(c, "st")!, { status: "running", error: null, finishedAt: null, resultJson: null }));
    await autoResumeInterruptedRuns([c]);
    await waitFor(() => ids().includes("st"), "the STOP");
    expect(ids().filter((x) => x === "st")).toEqual(["st"]);
    await waitFor(() => hang(c, "st")?.status === "completed", "the STOP's row");
  });
});
