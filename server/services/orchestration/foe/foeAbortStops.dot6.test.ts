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
 *   • a hung DB never holds the abort past its documented bound.
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
  return { ...orig, resolveUserFoeScope: () => null };
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
  (fake as any).insert = (t: any) => (hit() ? hungBuilder() : realInsert(t));
  const realUpdate = (fake as any).update.bind(fake);
  (fake as any).update = (t: any) => {
    const u = realUpdate(t);
    return { ...u, set: (patch: Record<string, any>) => (HANG.statuses.has(patch?.status) ? hungBuilder() : u.set(patch)) };
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

  it("★ a STOP behind an UNPASSED gate is sent (paused run, no live driver); the motion after it is not", async () => {
    await deploy("gated", [GATE, START, OT_STOP, RB_STOP]);
    const s = await startRun("gated", {}, OWNER);
    expect(s.status).toBe("awaiting_confirm");
    const ab = await abortRun(s.runId!, SUP);
    expect(ab).toMatchObject({ ok: true, status: "aborted" });
    expect(ab.abortStops?.sent).toEqual(["stop", "ra"]);
    expect(otCommands().map((c) => c.commandType)).toEqual(["stop"]);
    expect(runRow(s.runId!).status).toBe("aborted");
  });

  it("★ abort of an API-started run still sends its STOPs (never its motion)", async () => {
    await deploy("api", [GATE, START, OT_STOP, RB_STOP]);
    const s = await startRun("api", {}, { id: 0, role: "api_key", name: "key" }, { viaApi: true, ownerUserId: OWNER.id });
    expect(s.status).toBe("awaiting_confirm");
    expect(runRow(s.runId!).paramsJson).toMatchObject({}); // marker written server side
    const ab = await abortRun(s.runId!, SUP);
    expect(ab.abortStops?.sent).toEqual(["stop", "ra"]);
    expect(otCommands().map((c) => c.commandType)).toEqual(["stop"]);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ the abort STOP carries NO gate approval (self-confirmed engine row by the aborter) even when the run had an approved gate", async () => {
    const { runId, walk } = await liveRunAt("noappr", [START, DELAY, OT_STOP], "d");
    await abortRun(runId, SUP);
    const rows = (fake.store.get("ai_pending_actions") ?? []) as Row[];
    const abortRow = rows.find((r) => r.id === `foe-run${runId}-stop-abort`)!;
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
      [{ id: "br", type: "branch", condition: { source: "const", key: "x", op: "eq", value: "x" }, then: [DELAY, OT_STOP], else: [RB_STOP] }],
      "d",
    );
    const ab = await abortRun(runId, SUP);
    expect(ab.abortStops).toMatchObject({ sent: ["stop"], untakenBranch: [] });
    expect(robotDispatchMock).not.toHaveBeenCalled();
    await walk;
  });

  it("★ a pinned stop whose running connection is DOWN cannot be verified ⇒ NOT sent, audited abortStopUnverified; the robot stop still goes", async () => {
    await deploy("down", [GATE, START, OT_STOP, RB_STOP]);
    const s = await startRun("down", {}, OWNER);
    conn.fp.delete(501);
    const ab = await abortRun(s.runId!, SUP);
    expect(ab.abortStops).toMatchObject({ sent: ["ra"], unverified: ["stop"] });
    expect(otDispatchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(auditsOf("abortStopUnverified")).toEqual([{ runId: s.runId, stepIds: ["stop"], rowsKnown: true }]));
  });

  it("★ a STOP already handed to the dispatcher is let finish and NEVER sent twice; the next STOP is sent by the abort", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    otDispatchMock.mockImplementationOnce(async (input?: unknown) => {
      order.push(`ot:${(input as { commandType: string }).commandType}`);
      await held;
      return { ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] };
    });
    await deploy("inflight", [GATE, OT_STOP, RB_STOP]);
    const s = await startRun("inflight", {}, OWNER);
    const walk = resumeRun(s.runId!, { approved: true }, SUP);
    await waitFor(() => otDispatchMock.mock.calls.length === 1);
    const ab = await abortRun(s.runId!, SUP);
    expect(ab.abortStops?.sent).toEqual(["ra"]);
    release();
    expect((await walk as { status: string }).status).toBe("aborted");
    expect(otDispatchMock).toHaveBeenCalledTimes(1); // the in-flight stop finished, was not re-sent
    expect(robotDispatchMock).toHaveBeenCalledTimes(1); // ra: by the abort only (the walk never reached it)
  });

  it("★ paused run (stored rows): a STOP that already COMPLETED before the gate is not sent again; its STOP compensation is due and sent; the STOP after the gate is sent", async () => {
    await deploy("stored", [{ ...OT_STOP, compensation: { ...RB_STOP, id: "crb" } }, GATE, { ...RB_STOP, id: "ra2" }]);
    const s = await startRun("stored", {}, OWNER);
    expect(s.status).toBe("awaiting_confirm");
    expect(otCommands().map((c) => c.commandType)).toEqual(["stop"]); // the STOP before the gate ran (no gate needed)
    expect(stepRow(s.runId!, "stop")?.status).toBe("completed");
    const ab = await abortRun(s.runId!, SUP);
    expect(ab.abortStops?.sent).toEqual(["ra2", "crb"]);
    expect(otDispatchMock).toHaveBeenCalledTimes(1); // never re-sent
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
