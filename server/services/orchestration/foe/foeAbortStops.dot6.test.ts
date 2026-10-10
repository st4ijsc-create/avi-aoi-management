/**
 * doc 81 Đợt 6 (owner decision 2026-10-11, "Huỷ vẫn chạy bước DỪNG") — an ABORT skips every non-STOP step and still SENDS
 * the run's remaining REAL STOP steps and its due STOP compensations.
 *   • REAL STOP = the shared Đợt 5 classifier (foeStepClass): a robot stop job, or an OT PINNED stop over a running
 *     connection that matches the adapter row — never the command name (R-5-j): an unpinned "stop" is NOT sent;
 *   • nested STOPs (sequence / parallel / taken branch) are sent; a branch never evaluated is not guessed (listed);
 *   • a STOP behind an unpassed gate is sent (QĐ-4a); an API-started run's STOPs are sent;
 *   • the STOP compensations of steps that completed / were running are sent, newest start first; a non-STOP one is not;
 *   • a STOP already handed to the dispatcher is let finish and never sent twice;
 *   • every abort STOP goes out WITHOUT a gate approval (the dispatchers' own checks decide), audited and shown as a row;
 *   • a hung DB never holds the abort past its documented bound;
 *   • fix 1 (R-6-a): a gate REJECTION does the same, only after its claim WON (a loser sends nothing), STOPs before the QT
 *     compensation hook; (R-6-b) a run that never actuated sends none (abortStopNotNeeded); (#1) sent once on a double
 *     abort; (#2) a failed OT STOP is sent again by a retried abort under a new key; (#8) outOfScopeTarget in the audit.
 * Everything is the real engine + the real stop classifier (classifyOtStop, runningConnectionMatchesAdapterRow) on the
 * FakeDb; only the dispatchers' device side and the running connection fingerprint are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const { otDispatchMock, robotDispatchMock, audit, conn, order } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    otDispatchMock: vi.fn(async (input?: unknown) => {
      order.push(`ot:${(input as { commandType: string }).commandType}`);
      return { ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] };
    }),
    robotDispatchMock: vi.fn(async (job?: unknown) => {
      order.push(`robot:${(job as { jobType?: string; job?: { jobType?: string } })?.jobType ?? (job as { job?: { jobType?: string } })?.job?.jobType ?? "?"}`);
      return { ok: true, status: "simulated" as const, jobId: 7 };
    }),
    audit: vi.fn(async (_ctx: unknown, _e: Record<string, any>) => ({ id: 1 })),
    conn: { fp: new Map<number, string>() },
  };
});
/** fix 1 #8 — when `outMachines` is set, the factory-scope judge treats those machines as OUTSIDE the caller's scope. */
const scopeCtl = vi.hoisted(() => ({ outMachines: null as number[] | null }));
/** fix 1 #9 — a hook on INSERTs: return a promise to hold that insert until it resolves. */
const insertHook = vi.hoisted(() => ({ fn: null as null | ((table: string, values: Record<string, any>) => Promise<void> | undefined) }));
/** fix 1 — a hook run just before an UPDATE's patch is applied (e.g. another decision claims the run first). */
const updateHook = vi.hoisted(() => ({ fn: null as null | ((patch: Record<string, any>) => void) }));
vi.mock("../../ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/otManager")>();
  return { ...orig, getActiveConnectionFingerprint: (adapterId: number) => conn.fp.get(adapterId) };
});
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return {
    isStopCommandType: orig.isStopCommandType,
    classifyOtStop: orig.classifyOtStop,
    runningConnectionMatchesAdapterRow: orig.runningConnectionMatchesAdapterRow,
    dispatch: otDispatchMock,
  };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));
vi.mock("../../auditTrailService", () => ({ createAuditContext: (x: unknown) => x, logCrudOperation: audit }));
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return {
    ...orig,
    resolveUserFoeScope: () => null,
    makeScopeJudge: async (scope: unknown) => {
      const out = scopeCtl.outMachines;
      if (!out) return orig.makeScopeJudge(scope as never);
      const pick = (m: Map<number, boolean>, o?: { nonStopOnly?: boolean }) => [...m.entries()].filter(([, ns]) => !o?.nonStopOnly || ns).map(([id]) => id);
      return {
        unrestricted: false,
        failed: false,
        outOf: async (tg: { machines: Map<number, boolean> }, o?: { nonStopOnly?: boolean }) => ({ machines: pick(tg.machines, o).filter((id) => out.includes(id)), robots: [], adapters: [] }),
      };
    },
  };
});

const fake = new FakeDb();
/** HANG: a select / insert issued from a named engine function never answers; a run-status UPDATE to a listed status never answers. */
const HANG = { fns: new Set<string>(), statuses: new Set<string>() };
/** A SELECT from a named table never answers (table-level, independent of the call stack). */
const HUNG_TABLES = new Set<string>();
{
  const hungBuilder = (): any => {
    const h: any = new Proxy({}, { get: (_t, k) => (k === "then" ? () => undefined : () => h) });
    return h;
  };
  const hit = () => {
    const stack = new Error().stack ?? "";
    return [...HANG.fns].some((f) => stack.includes(f));
  };
  const realSelect = fake.select.bind(fake);
  (fake as any).select = (proj?: Record<string, any>) => {
    if (hit()) return hungBuilder();
    const b = realSelect(proj);
    const from = b.from.bind(b);
    b.from = (t: any) => (HUNG_TABLES.has(t?.[Symbol.for("drizzle:Name")]) ? hungBuilder() : from(t));
    return b;
  };
  const realInsert = (fake as any).insert.bind(fake);
  (fake as any).insert = (t: any) => {
    if (hit()) return hungBuilder();
    if (!insertHook.fn) return realInsert(t);
    const name = t?.[Symbol.for("drizzle:Name")] as string;
    return {
      values(v: Record<string, any>) {
        const held = insertHook.fn?.(name, v);
        if (!held) return realInsert(t).values(v);
        return { then: (res: any, rej: any) => held.then(() => realInsert(t).values(v)).then(res, rej) };
      },
    };
  };
  const realUpdate = (fake as any).update.bind(fake);
  (fake as any).update = (t: any) => {
    const u = realUpdate(t);
    return {
      ...u,
      set: (patch: Record<string, any>) => {
        updateHook.fn?.(patch);
        return HANG.statuses.has(patch?.status) ? hungBuilder() : u.set(patch);
      },
    };
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
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { orchestrationRunSteps, machines, deviceAdapters, deviceTags, robots } from "../../../../drizzle/schema";
import { deployWorkflow, startRun, resumeRun, abortRun } from "./foeEngine";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";
import { adapterTargetFingerprint } from "../../ot/adapterTarget";
import type { WorkflowDefinition } from "./workflowModel";

const D = STOP_DB_STEP_DEADLINE_MS;
const OWNER = { id: 10, role: "engineer", name: "owner" };
const SUP = { id: 12, role: "supervisor", name: "sup" };
type Row = Record<string, any>;

const GATE = { id: "gate0", type: "hitl_gate", prompt: "approve" } as const;
const START = { id: "start", type: "command", machineId: 1, command: "start", args: { adapterId: 501, writes: [{ tagKey: "run", value: true }] } } as const;
const DELAY = { id: "d", type: "delay", ms: 5000 } as const;
/** a PINNED stop: writes exactly adapter 501's stop pin (estop = true) */
const OT_STOP = { id: "stop", type: "command", machineId: 1, command: "stop", args: { adapterId: 501, writes: [{ tagKey: "estop", value: true }] } } as const;
/** stop-TYPED but NOT pinned: it writes an arbitrary tag (R-4-x) — not a real STOP */
const UNPINNED = { id: "stopU", type: "command", machineId: 1, command: "stop", args: { adapterId: 501, writes: [{ tagKey: "speed", value: 0 }] } } as const;
const RB_STOP = { id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } } as const;

const runRows = (): Row[] => fake.store.get("orchestration_runs") ?? [];
const runRow = (id: number): Row => runRows().find((r) => r.id === id)!;
const stepRow = (runId: number, stepId: string): Row | undefined =>
  (fake.store.get("orchestration_run_steps") ?? []).find((s: Row) => s.runId === runId && s.stepId === stepId);
const otCommands = () => otDispatchMock.mock.calls.map((c) => c[0] as { commandType: string; writes?: Array<{ tagKey: string; value: unknown }> });
const auditsOf = (op: string) => audit.mock.calls.map((c) => c[1]).filter((e) => e?.details?.operation === op).map((e) => e.details.metadata);

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
async function within<T>(p: Promise<T>, ms: number): Promise<T | "HUNG"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([p, new Promise<"HUNG">((res) => (t = setTimeout(() => res("HUNG"), ms)))]);
  clearTimeout(t);
  return r;
}

async function deploy(ref: string, steps: unknown[]): Promise<void> {
  const r = await deployWorkflow({ ref, name: ref, steps } as unknown as WorkflowDefinition, OWNER);
  expect(r.ok, JSON.stringify(r)).toBe(true);
}
/** Start + approve gate0 (SUP ≠ owner ⇒ motion may run), return when step `at` is running; the walk keeps going. */
async function liveRunAt(ref: string, steps: unknown[], at: string): Promise<{ runId: number; walk: Promise<unknown> }> {
  await deploy(ref, [GATE, ...steps]);
  const s = await startRun(ref, {}, OWNER);
  expect(s.status).toBe("awaiting_confirm");
  const walk = resumeRun(s.runId!, { approved: true }, SUP);
  await waitFor(() => stepRow(s.runId!, at)?.status === "running");
  return { runId: s.runId!, walk };
}

const GATE1 = { id: "gate1", type: "hitl_gate", prompt: "second gate" } as const;
/** A run that ACTUATED (START sent after gate0 was approved by SUP) and is now paused at gate1 — no live driver. */
async function pausedAfterMotion(ref: string, rest: unknown[]): Promise<number> {
  await deploy(ref, [GATE, START, GATE1, ...rest]);
  const s = await startRun(ref, {}, OWNER);
  const r = await resumeRun(s.runId!, { approved: true }, SUP);
  expect(r.status).toBe("awaiting_confirm");
  expect(otCommands().map((c) => c.commandType)).toEqual(["start"]);
  return s.runId!;
}

let warn: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "ROBOT", capabilities: null, code: "R1", name: "Robot-1", operationStatus: "stopped", stationId: 1 },
  ]);
  fake.seed(deviceAdapters, [{ id: 501, machineId: 1, isEnabled: true, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", connectionOptions: null }]);
  fake.seed(deviceTags, [{ id: 9001, adapterId: 501, tagKey: "estop", dataType: "bool", stopValue: true, writable: true, isEnabled: true }]);
  fake.seed(robots, [{ id: 2, code: "R2", isEnabled: true }]);
  conn.fp = new Map([[501, adapterTargetFingerprint({ protocol: "modbus", endpoint: "tcp://127.0.0.1:1", machineId: 1, connectionOptions: null } as never)]]);
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  audit.mockClear();
  order.length = 0;
  HANG.fns.clear();
  HANG.statuses.clear();
  HUNG_TABLES.clear();
  scopeCtl.outMachines = null;
  insertHook.fn = null;
  updateHook.fn = null;
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  err = vi.spyOn(console, "error").mockImplementation(() => undefined);
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  err.mockRestore();
  log.mockRestore();
});

describe("doc 81 Đợt 6 — abort still sends the remaining REAL STOP steps", () => {
  it("★ 'start → delay → stop' aborted during the delay ⇒ the pinned stop AND the robot stop are sent, the run ends 'aborted'", async () => {
    const { runId, walk } = await liveRunAt("sds", [START, DELAY, OT_STOP, RB_STOP], "d");
    expect(otCommands().map((c) => c.commandType)).toEqual(["start"]);
    const ab = await abortRun(runId, SUP, "halt");
    expect(ab).toMatchObject({ ok: true, status: "aborted" });
    expect(ab.abortStops).toMatchObject({ sent: ["stop", "ra"], failed: [], pending: [], unverified: [], untakenBranch: [], notPinned: [] });
    expect(otCommands().map((c) => [c.commandType, c.writes])).toEqual([
      ["start", [{ tagKey: "run", value: true }]],
      ["stop", [{ tagKey: "estop", value: true }]],
    ]);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["ot:start", "ot:stop", "robot:abort"]); // definition order
    expect((await walk as { status: string }).status).toBe("aborted");
    expect(runRow(runId).status).toBe("aborted");
    expect(String(runRow(runId).error)).toContain("halt");
    // timeline rows + audit
    await waitFor(() => stepRow(runId, "abort:stop")?.status === "completed" && stepRow(runId, "abort:ra")?.status === "completed");
    expect(stepRow(runId, "abort:stop")!.resultJson).toMatchObject({ abortStop: "sent", stepId: "stop", accepted: true });
    await vi.waitFor(() => expect(auditsOf("abortStopSent").map((m) => m.stepId).sort()).toEqual(["ra", "stop"]));
  });

  it("★ an UNPINNED 'stop' (stop-typed, writes another tag) is NOT sent — not a real STOP (R-5-j); listed as notPinned", async () => {
    const { runId, walk } = await liveRunAt("unp", [START, DELAY, UNPINNED], "d");
    const ab = await abortRun(runId, SUP);
    expect(ab.ok).toBe(true);
    expect(ab.abortStops).toMatchObject({ sent: [], notPinned: ["stopU"], unverified: [] });
    expect(otCommands().map((c) => c.commandType)).toEqual(["start"]);
    expect(stepRow(runId, "abort:stopU")).toBeUndefined();
    await vi.waitFor(() => expect(auditsOf("abortStopNotPinned")).toEqual([{ runId, stepIds: ["stopU"] }])); // not silent
    await walk;
  });

  it("★ nested STOPs inside a sequence and a parallel are sent; the motion step next to them is not", async () => {
    const { runId, walk } = await liveRunAt(
      "nest",
      [START, DELAY, { id: "sq", type: "sequence", steps: [OT_STOP] }, { id: "pl", type: "parallel", steps: [RB_STOP, { ...START, id: "move2" }] }],
      "d",
    );
    const ab = await abortRun(runId, SUP);
    expect(ab.abortStops?.sent).toEqual(["stop", "ra"]);
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop"]); // move2 (motion) never sent
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    await walk;
  });

  it("★ STOP compensations of steps that completed / were running are sent, newest start first; a NON-STOP compensation is not", async () => {
    const { runId, walk } = await liveRunAt(
      "comp",
      [
        { ...START, compensation: { ...OT_STOP, id: "cstop" } },
        { ...START, id: "move2", compensation: { ...START, id: "cmove" } }, // non-STOP compensation
        { ...START, id: "move3", compensation: { ...RB_STOP, id: "crb" } },
        DELAY,
        { ...START, id: "later", compensation: { ...RB_STOP, id: "cnever" } }, // never started ⇒ not due
      ],
      "d",
    );
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "start", "start"]);
    order.length = 0;
    const ab = await abortRun(runId, SUP);
    expect(ab.abortStops?.sent).toEqual(["crb", "cstop"]);
    expect(order).toEqual(["robot:abort", "ot:stop"]); // move3's compensation before start's (reverse start order)
    expect(otCommands().filter((c) => c.commandType === "start")).toHaveLength(3); // cmove (motion) not sent
    await walk;
  });

  it("★ a STOP behind an UNPASSED gate is sent (paused run that actuated, no live driver); the motion after it is not", async () => {
    const runId = await pausedAfterMotion("gated", [OT_STOP, { ...START, id: "move2" }, RB_STOP]);
    const ab = await abortRun(runId, SUP);
    expect(ab).toMatchObject({ ok: true, status: "aborted" });
    expect(ab.abortStops?.sent).toEqual(["stop", "ra"]);
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop"]); // move2 never
    expect(runRow(runId).status).toBe("aborted");
  });

  it("★ abort of an API-started run: the API marker never blocks its STOPs (an actuation on record ⇒ sent, never its motion)", async () => {
    await deploy("api", [GATE, START, OT_STOP, RB_STOP]);
    const s = await startRun("api", {}, { id: 0, role: "api_key", name: "key" }, { viaApi: true, ownerUserId: OWNER.id });
    expect(s.status).toBe("awaiting_confirm");
    // R-6-b: an API run never sends its motion itself (option C) — a command on record as handed over is what makes its
    // STOPs due (counted conservatively: a failed row with a dispatcher result).
    (fake.store.get("orchestration_run_steps") as Row[]).push({ id: 9_999, runId: s.runId, stepId: "start", stepType: "command", status: "failed", attempt: 1, resultJson: { routedTo: "ot-dispatcher" }, startedAt: new Date() });
    const ab = await abortRun(s.runId!, SUP);
    expect(ab.abortStops?.sent).toEqual(["stop", "ra"]);
    expect(otCommands().map((c) => c.commandType)).toEqual(["stop"]);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ the abort STOP carries NO gate approval (self-confirmed engine row by the aborter) even when the run had an approved gate", async () => {
    const { runId, walk } = await liveRunAt("noappr", [START, DELAY, OT_STOP], "d");
    await abortRun(runId, SUP);
    const rows = (fake.store.get("ai_pending_actions") ?? []) as Row[];
    const abortRow = rows.find((r) => String(r.id).startsWith(`foe-run${runId}-stop-abort-`))!;
    expect(abortRow).toBeTruthy();
    expect(abortRow.userId).toBe(SUP.id);
    expect(JSON.stringify(abortRow.previewJson)).not.toMatch(/approvedBy|gateStepId/);
    // the run's own motion row DID carry the approval (control: the fixture can show one)
    const startRowAction = rows.find((r) => r.id === `foe-run${runId}-start-a1`)!;
    expect(JSON.stringify(startRowAction.previewJson)).toMatch(/approvedBy/);
    await walk;
  });

  it("★ a branch whose condition was never evaluated is not guessed: its STOPs are listed (abortStopSkippedUntakenBranch), not sent", async () => {
    await deploy("untaken", [GATE, { id: "br", type: "branch", condition: { source: "const", key: "x", op: "eq", value: "x" }, then: [OT_STOP], else: [RB_STOP] }]);
    const s = await startRun("untaken", {}, OWNER);
    const ab = await abortRun(s.runId!, SUP);
    expect(ab.abortStops).toMatchObject({ sent: [], untakenBranch: ["stop", "ra"] });
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(robotDispatchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(auditsOf("abortStopSkippedUntakenBranch")).toEqual([{ runId: s.runId, stepIds: ["stop", "ra"] }]));
  });

  it("★ a branch already TAKEN: its STOP is sent; the other path's STOP is not", async () => {
    const { runId, walk } = await liveRunAt(
      "taken",
      [START, { id: "br", type: "branch", condition: { source: "const", key: "x", op: "eq", value: "x" }, then: [DELAY, OT_STOP], else: [RB_STOP] }],
      "d",
    );
    const ab = await abortRun(runId, SUP);
    expect(ab.abortStops).toMatchObject({ sent: ["stop"], untakenBranch: [] });
    expect(robotDispatchMock).not.toHaveBeenCalled();
    await walk;
  });

  it("★ a pinned stop whose running connection is DOWN cannot be verified ⇒ NOT sent, audited abortStopUnverified; the robot stop still goes", async () => {
    const runId = await pausedAfterMotion("down", [OT_STOP, RB_STOP]);
    conn.fp.delete(501);
    const ab = await abortRun(runId, SUP);
    expect(ab.abortStops).toMatchObject({ sent: ["ra"], unverified: ["stop"] });
    expect(otCommands().map((c) => c.commandType)).toEqual(["start"]);
    await vi.waitFor(() => expect(auditsOf("abortStopUnverified")).toEqual([{ runId, stepIds: ["stop"], rowsKnown: true }]));
  });

  it("★ a STOP already handed to the dispatcher is let finish and NEVER sent twice; the next STOP is sent by the abort", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    otDispatchMock.mockImplementationOnce(async (input?: unknown) => {
      order.push(`ot:${(input as { commandType: string }).commandType}`);
      return { ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] };
    });
    otDispatchMock.mockImplementationOnce(async (input?: unknown) => {
      order.push(`ot:${(input as { commandType: string }).commandType}`);
      await held;
      return { ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] };
    });
    await deploy("inflight", [GATE, START, OT_STOP, RB_STOP]);
    const s = await startRun("inflight", {}, OWNER);
    const walk = resumeRun(s.runId!, { approved: true }, SUP);
    await waitFor(() => otDispatchMock.mock.calls.length === 2);
    const ab = await abortRun(s.runId!, SUP);
    expect(ab.abortStops?.sent).toEqual(["ra"]);
    release();
    expect((await walk as { status: string }).status).toBe("aborted");
    expect(otDispatchMock).toHaveBeenCalledTimes(2); // start + the in-flight stop, which finished and was not re-sent
    expect(robotDispatchMock).toHaveBeenCalledTimes(1); // ra: by the abort only (the walk never reached it)
  });

  it("★ paused run (stored rows): a STOP that already COMPLETED before the gate is not sent again; its STOP compensation is due and sent; the STOP after the gate is sent", async () => {
    await deploy("stored", [GATE, START, { ...OT_STOP, compensation: { ...RB_STOP, id: "crb" } }, GATE1, { ...RB_STOP, id: "ra2" }]);
    const s = await startRun("stored", {}, OWNER);
    expect((await resumeRun(s.runId!, { approved: true }, SUP)).status).toBe("awaiting_confirm");
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop"]); // the STOP before gate1 ran
    expect(stepRow(s.runId!, "stop")?.status).toBe("completed");
    const ab = await abortRun(s.runId!, SUP);
    expect(ab.abortStops?.sent).toEqual(["ra2", "crb"]);
    expect(otDispatchMock).toHaveBeenCalledTimes(2); // the stop never re-sent
    expect(robotDispatchMock).toHaveBeenCalledTimes(2);
  });

  it("control: abort of a run with no STOP left sends nothing (motion never)", async () => {
    const { runId, walk } = await liveRunAt("nostop", [START, DELAY, { ...START, id: "move2" }], "d");
    const ab = await abortRun(runId, SUP);
    expect(ab.abortStops).toMatchObject({ sent: [], failed: [], unverified: [], notPinned: [] });
    expect(otCommands().map((c) => c.commandType)).toEqual(["start"]);
    await walk;
  });
});

describe("doc 81 Đợt 6 — a hung DB never holds the abort past its documented bound (8·D)", () => {
  it("★ live run: step rows, authorisation rows AND the 'aborted' write hung ⇒ abort answers within 8·D (unconfirmed), both STOPs reach their dispatchers", async () => {
    const { runId } = await liveRunAt("hung", [START, DELAY, OT_STOP, RB_STOP], "d");
    HANG.fns.add("upsertStep");
    HANG.fns.add("ensureOrchestrationAction");
    HANG.statuses.add("aborted");
    const t0 = Date.now();
    const ab = await within(abortRun(runId, SUP), 8 * D + 2000);
    const ms = Date.now() - t0;
    expect(ab, "the abort hung").not.toBe("HUNG");
    expect(ms).toBeLessThan(8 * D + 700);
    expect(ab).toMatchObject({ ok: false, reason: "abortUnconfirmed", abortStops: { sent: ["stop", "ra"] } });
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop"]);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ paused run: step rows and stop-pin reads hung ⇒ abort answers within 8·D; the robot STOP is sent, the OT stop (unverifiable) is audited, not sent", async () => {
    await deploy("hungp", [GATE, START, OT_STOP, RB_STOP]);
    const s = await startRun("hungp", {}, OWNER);
    HUNG_TABLES.add("orchestration_run_steps");
    HUNG_TABLES.add("device_tags");
    const t0 = Date.now();
    const ab = await within(abortRun(s.runId!, SUP), 8 * D + 2000);
    const ms = Date.now() - t0;
    expect(ab, "the abort hung").not.toBe("HUNG");
    expect(ms).toBeLessThan(8 * D + 700);
    expect(ab).toMatchObject({ ok: true, status: "aborted", abortStops: { sent: ["ra"], unverified: ["stop"] } });
    expect(otDispatchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(auditsOf("abortStopUnverified")).toEqual([{ runId: s.runId, stepIds: ["stop"], rowsKnown: false }]));
  });

  it("★ the definition itself unreadable ⇒ nothing sent, audited abortStopUnverified (definitionUnreadable), still bounded", async () => {
    await deploy("nodef", [GATE, OT_STOP]);
    const s = await startRun("nodef", {}, OWNER);
    HUNG_TABLES.add("orchestration_workflows");
    const t0 = Date.now();
    const ab = await within(abortRun(s.runId!, SUP), 8 * D + 2000);
    expect(ab).not.toBe("HUNG");
    expect(Date.now() - t0).toBeLessThan(8 * D + 700);
    expect(ab).toMatchObject({ ok: true, abortStops: { sent: [] } });
    await vi.waitFor(() => expect(auditsOf("abortStopUnverified")).toEqual([{ runId: s.runId, stepIds: [], reason: "definitionUnreadable" }]));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 6 fix 1
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("doc 81 Đợt 6 fix 1 (R-6-b) — STOPs only when the run ACTUATED", () => {
  it("★ a paused run that never actuated (paused before its first motion) sends NO STOP — audited abortStopNotNeeded", async () => {
    await deploy("never", [GATE, START, OT_STOP, RB_STOP]);
    const s = await startRun("never", {}, OWNER);
    expect(s.status).toBe("awaiting_confirm");
    const ab = await abortRun(s.runId!, SUP);
    expect(ab).toMatchObject({ ok: true, status: "aborted", abortStops: { sent: [], notNeeded: ["stop", "ra"] } });
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(robotDispatchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(auditsOf("abortStopNotNeeded")).toEqual([{ runId: s.runId, stepIds: ["stop", "ra"], reason: "runNeverActuated" }]));
  });

  it("★ #9 a QUEUED async run aborted before it started sends NO STOP, and its driver never runs a step", async () => {
    await deploy("queued", [OT_STOP, RB_STOP]);
    const s = await startRun("queued", {}, OWNER, { async: true });
    expect(runRow(s.runId!).status).toBe("queued");
    const ab = await abortRun(s.runId!, SUP);
    expect(ab).toMatchObject({ ok: true, status: "aborted", abortStops: { sent: [], notNeeded: ["stop", "ra"] } });
    await new Promise((r) => setTimeout(r, 100)); // the setImmediate driver finds 'aborted' and stops
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(robotDispatchMock).not.toHaveBeenCalled();
    expect(runRow(s.runId!).status).toBe("aborted");
  });

  it("★ a run whose motion was ATTEMPTED but REFUSED by the dispatcher counts as actuated ⇒ its STOPs are sent", async () => {
    otDispatchMock.mockImplementationOnce(async (input?: unknown) => {
      order.push(`ot:${(input as { commandType: string }).commandType}`);
      return { ok: false, simulated: false, status: "rejected" as const, reason: "X", results: [], commandLogIds: [1] } as never;
    });
    const { runId, walk } = await liveRunAt("refused", [{ id: "pl", type: "parallel", steps: [START, { id: "sq", type: "sequence", steps: [DELAY, OT_STOP, RB_STOP] }] }], "d");
    const ab = await abortRun(runId, SUP);
    expect(ab.abortStops).toMatchObject({ sent: ["stop", "ra"], notNeeded: [] });
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop"]);
    await walk;
  });

  it("★ an UNPINNED stop-typed step that was handed over counts as actuation (it can write any tag — conservative)", async () => {
    await deploy("unpact", [GATE, UNPINNED, GATE1, OT_STOP]);
    const s = await startRun("unpact", {}, OWNER);
    expect((await resumeRun(s.runId!, { approved: true }, SUP)).status).toBe("awaiting_confirm");
    expect(otDispatchMock).toHaveBeenCalledTimes(1); // the unpinned 'stop' went out (its dispatcher decides it)
    const ab = await abortRun(s.runId!, SUP);
    expect(ab.abortStops).toMatchObject({ sent: ["stop"], notNeeded: [] });
  });
});

describe("doc 81 Đợt 6 fix 1 (R-6-b) — a STOP that ran is not an actuation", () => {
  it("★ live run whose step rows cannot be read at abort time: the actuation is known from the walk's memory ⇒ STOP sent", async () => {
    const { runId, walk } = await liveRunAt("memonly", [START, DELAY, OT_STOP], "d");
    HUNG_TABLES.add("orchestration_run_steps");
    const ab = await abortRun(runId, SUP);
    HUNG_TABLES.clear();
    expect(ab.abortStops).toMatchObject({ sent: ["stop"], notNeeded: [] });
    await walk;
  });

  it("★ only STOP steps ran (no non-STOP command attempted) ⇒ the remaining STOPs are NOT needed", async () => {
    await deploy("stoponly", [OT_STOP, GATE, RB_STOP]);
    const s = await startRun("stoponly", {}, OWNER);
    expect(s.status).toBe("awaiting_confirm");
    expect(otCommands().map((c) => c.commandType)).toEqual(["stop"]); // a STOP needs no gate
    const ab = await abortRun(s.runId!, SUP);
    expect(ab.abortStops).toMatchObject({ sent: [], notNeeded: ["ra"] });
    expect(robotDispatchMock).not.toHaveBeenCalled();
  });

  it("★ #1 an abort landing while a rejection's sweep is still in flight JOINS it — no STOP sent twice", async () => {
    const runId = await pausedAfterMotion("overlap", [OT_STOP, RB_STOP]);
    let abortP: Promise<unknown> | null = null;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    robotDispatchMock.mockImplementationOnce(async (job?: unknown) => {
      order.push("robot:abort");
      abortP = abortRun(runId, SUP, "meanwhile"); // the run is 'compensating' ⇒ its 'aborted' write lands
      await new Promise((r) => setTimeout(r, 50));
      release();
      void job;
      return { ok: true, status: "simulated" as const, jobId: 8 };
    });
    const r = await resumeRun(runId, { approved: false }, SUP, { compensate: async () => { await held; return "c"; } });
    expect(r.abortStops?.sent).toEqual(["stop", "ra"]);
    await abortP;
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop"]);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });
});

describe("doc 81 Đợt 6 fix 1 (#1 #2 #8 #9) — sent once, failed STOP retried, scope marker, retry cut, failFast", () => {
  it("★ #1 a DOUBLE abort (concurrent and sequential) sends each STOP ONCE", async () => {
    const runId = await pausedAfterMotion("double", [OT_STOP, RB_STOP]);
    const [a, b] = await Promise.all([abortRun(runId, SUP, "one"), abortRun(runId, SUP, "two")]);
    const third = await abortRun(runId, SUP, "three");
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(third.ok).toBe(false);
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop"]);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ #2 a retried abort after 'abortUnconfirmed' re-sends a FAILED OT STOP under a NEW key; a STOP that was sent is not sent again", async () => {
    const runId = await pausedAfterMotion("retry", [OT_STOP, RB_STOP]);
    HANG.statuses.add("aborted");
    otDispatchMock.mockImplementationOnce(async (input?: unknown) => {
      order.push(`ot:${(input as { commandType: string }).commandType}`);
      return { ok: false, simulated: false, status: "rejected" as const, reason: "DEVICE_BUSY", results: [], commandLogIds: [2] } as never;
    });
    const first = await abortRun(runId, SUP);
    expect(first).toMatchObject({ ok: false, reason: "abortUnconfirmed", abortStops: { sent: ["ra"], failed: ["stop"] } });
    expect(first.message).toContain("STOP steps confirmed sent: 1");
    await waitFor(() => stepRow(runId, "abort:ra")?.status === "completed" && stepRow(runId, "abort:stop")?.status === "failed");
    HANG.statuses.clear();
    const second = await abortRun(runId, SUP);
    expect(second).toMatchObject({ ok: true, status: "aborted", abortStops: { sent: ["stop"], failed: [] } });
    const stops = otDispatchMock.mock.calls.map((c) => c[0] as { commandType: string; idempotencyKey?: string }).filter((c) => c.commandType === "stop");
    expect(stops).toHaveLength(2);
    expect(stops[0].idempotencyKey).toBeTruthy();
    expect(stops[0].idempotencyKey).not.toBe(stops[1].idempotencyKey);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1); // sent the first time ⇒ never again
  });

  it("★ #8 a STOP to a target OUTSIDE the aborter's factory scope is sent and audited with outOfScopeTarget: true (in scope: false)", async () => {
    const runId = await pausedAfterMotion("oos", [OT_STOP, RB_STOP]);
    scopeCtl.outMachines = [2]; // the robot's machine is another factory's — referenced only by a STOP
    const ab = await abortRun(runId, SUP);
    expect(ab.abortStops?.sent).toEqual(["stop", "ra"]);
    await vi.waitFor(() => expect(auditsOf("abortStopSent").length).toBe(2));
    const byStep = Object.fromEntries(auditsOf("abortStopSent").map((m) => [m.stepId, m.outOfScopeTarget]));
    expect(byStep).toEqual({ stop: false, ra: true });
  });

  it("★ #9 a STOP REFUSED by its dispatcher, whose RETRY the abort cuts, is sent once more by the abort — never a third time", async () => {
    let releaseRetry!: () => void;
    const retryHeld = new Promise<void>((r) => (releaseRetry = r));
    let runIdSeen = 0;
    let abortP: Promise<unknown> | null = null;
    otDispatchMock.mockImplementationOnce(async (input?: unknown) => {
      order.push(`ot:${(input as { commandType: string }).commandType}`);
      return { ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] };
    });
    otDispatchMock.mockImplementationOnce(async (input?: unknown) => {
      order.push(`ot:${(input as { commandType: string }).commandType}`);
      return { ok: false, simulated: false, status: "rejected" as const, reason: "DEVICE_BUSY", results: [], commandLogIds: [2] } as never;
    });
    // the retry's authorisation row (attempt 2) is held until the abort has answered
    insertHook.fn = (table, v) => {
      if (table !== "ai_pending_actions" || !String(v.id).endsWith("-stop-a2")) return undefined;
      abortP = abortRun(runIdSeen, SUP).then((r) => {
        releaseRetry();
        return r;
      });
      return retryHeld;
    };
    await deploy("retrycut", [GATE, START, { ...OT_STOP, maxAttempts: 1 }]);
    const s = await startRun("retrycut", {}, OWNER);
    runIdSeen = s.runId!;
    const walked = await resumeRun(s.runId!, { approved: true }, SUP);
    expect(walked.status).toBe("aborted");
    const ab = (await abortP) as { abortStops?: { sent: string[] } };
    expect(ab.abortStops?.sent).toEqual(["stop"]);
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop", "stop"]); // refused, then the abort's — no third
  });

  it("★ #9 failFast parallel: aborted during its delay ⇒ the STOP inside is sent, its motion sibling is not sent again", async () => {
    const { runId, walk } = await liveRunAt(
      "ff",
      [{ id: "pl", type: "parallel", failFast: true, steps: [{ ...START, id: "m2" }, { id: "sq", type: "sequence", steps: [DELAY, OT_STOP] }] }],
      "d",
    );
    const ab = await abortRun(runId, SUP);
    expect(ab.abortStops?.sent).toEqual(["stop"]);
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop"]);
    await walk;
  });
});

describe("doc 81 Đợt 6 fix 1 (R-6-a) — a gate REJECTION sends the remaining STOPs like an abort", () => {
  it("★ reject a paused run that actuated ⇒ its STOP steps behind the gate are sent, its motion is not, the run ends 'aborted'", async () => {
    const runId = await pausedAfterMotion("rej", [OT_STOP, { ...START, id: "move2" }, RB_STOP]);
    const r = await resumeRun(runId, { approved: false, note: "no" }, SUP);
    expect(r).toMatchObject({ ok: false, status: "aborted", abortStops: { sent: ["stop", "ra"] } });
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop"]);
    expect(runRow(runId).status).toBe("aborted");
    expect(stepRow(runId, "gate1")?.status).toBe("failed");
  });

  it("★ reject: an UNPINNED stop is not sent; a run that never actuated sends none (abortStopNotNeeded)", async () => {
    const runId = await pausedAfterMotion("rejunp", [UNPINNED]);
    const r = await resumeRun(runId, { approved: false }, SUP);
    expect(r.abortStops).toMatchObject({ sent: [], notPinned: ["stopU"] });
    await deploy("rejnever", [GATE, OT_STOP]);
    const s = await startRun("rejnever", {}, OWNER);
    const r2 = await resumeRun(s.runId!, { approved: false }, SUP);
    expect(r2.abortStops).toMatchObject({ sent: [], notNeeded: ["stop"] });
    expect(otCommands().map((c) => c.commandType)).toEqual(["start"]);
  });

  it("★ the LOSING decision sends nothing: two concurrent rejections ⇒ one wins, each STOP sent once", async () => {
    const runId = await pausedAfterMotion("rejrace", [OT_STOP, RB_STOP]);
    const res = await Promise.allSettled([resumeRun(runId, { approved: false }, SUP), resumeRun(runId, { approved: false }, SUP)]);
    const won = res.filter((x) => x.status === "fulfilled" && (x.value as { status?: string }).status === "aborted" && (x.value as { abortStops?: unknown }).abortStops);
    expect(won).toHaveLength(1);
    expect(otCommands().map((c) => c.commandType)).toEqual(["start", "stop"]);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ a rejection that LOSES its claim (another decision claimed the run first) throws CONFLICT and sends NOTHING", async () => {
    const runId = await pausedAfterMotion("rejlose", [OT_STOP, RB_STOP]);
    updateHook.fn = (patch) => {
      if (patch.status === "aborted" && String(patch.error ?? "").includes("rejected by user")) {
        runRow(runId).status = "running"; // claimed meanwhile by an approval
        updateHook.fn = null;
      }
    };
    const err = await resumeRun(runId, { approved: false }, SUP).catch((e) => e);
    expect((err as { code?: string }).code).toBe("CONFLICT");
    await new Promise((r) => setTimeout(r, 50));
    expect(otCommands().map((c) => c.commandType)).toEqual(["start"]);
    expect(robotDispatchMock).not.toHaveBeenCalled();
    expect(auditsOf("abortStopNotNeeded")).toEqual([]);
  });

  it("★ reject of a 'held' (interrupted) run sends its remaining STOPs", async () => {
    const runId = await pausedAfterMotion("rejheld", [OT_STOP]);
    const row = runRow(runId);
    row.status = "held";
    row.currentStepId = null;
    row.contextJson = { ...(row.contextJson ?? {}), interrupted: true };
    const r = await resumeRun(runId, { approved: false }, SUP);
    expect(r).toMatchObject({ status: "aborted", abortStops: { sent: ["stop"] } });
  });

  it("★ the QT compensation hook runs AFTER the STOPs were handed over; the run ends 'aborted' with the hook's note", async () => {
    const runId = await pausedAfterMotion("rejhook", [OT_STOP, RB_STOP]);
    order.length = 0;
    const r = await resumeRun(runId, { approved: false, note: "bad" }, SUP, {
      compensate: async () => {
        order.push("hook");
        expect(runRow(runId).status).toBe("compensating");
        return "comp note";
      },
    });
    expect(r).toMatchObject({ status: "aborted", abortStops: { sent: ["stop", "ra"] } });
    expect(order).toEqual(["ot:stop", "robot:abort", "hook"]);
    expect(runRow(runId).status).toBe("aborted");
    expect(String(runRow(runId).error)).toContain("comp note");
  });

  it("★ hung DB: the claim never answers ⇒ answered within 2·D + slack, NOTHING sent (it may not have won)", async () => {
    const runId = await pausedAfterMotion("rejhung", [OT_STOP, RB_STOP]);
    HANG.statuses.add("aborted"); // the claim (no hook) writes 'aborted'
    const t0 = Date.now();
    const r = await within(resumeRun(runId, { approved: false }, SUP), 4 * D + 2000);
    expect(r).not.toBe("HUNG");
    expect(Date.now() - t0).toBeLessThan(2 * D + 700);
    expect(r).toMatchObject({ ok: false, reason: "abortUnconfirmed", abortStops: { sent: [] } });
    expect((r as { message: string }).message).toContain("STOP steps confirmed sent: 0");
    expect(otCommands().map((c) => c.commandType)).toEqual(["start"]);
    expect(robotDispatchMock).not.toHaveBeenCalled();
  });

  it("★ hung DB (hook path): the claim wins, the FINAL write hangs ⇒ the STOPs go, answered 'abortUnconfirmed' within 8·D", async () => {
    const runId = await pausedAfterMotion("rejhung2", [OT_STOP, RB_STOP]);
    HANG.statuses.add("aborted"); // only the final 'compensating' → 'aborted' write
    HANG.fns.add("upsertStep");
    const t0 = Date.now();
    const r = await within(resumeRun(runId, { approved: false }, SUP, { compensate: async () => "c" }), 8 * D + 2000);
    expect(r).not.toBe("HUNG");
    expect(Date.now() - t0).toBeLessThan(8 * D + 700);
    expect(r).toMatchObject({ ok: false, reason: "abortUnconfirmed", abortStops: { sent: ["stop", "ra"] } });
  });
});
