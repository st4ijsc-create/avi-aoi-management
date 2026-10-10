/**
 * doc 81 Đợt 5 task E4 (items 35 + 36) — an orchestrated STOP never waits on a hung database for its own bookkeeping.
 *   • A ROBOT STOP creates NO ai_pending_actions row (the robot dispatcher never reads a stop's row; the row only named
 *     whoever drove the walk as "confirmer" — item 35 — and cost an unbounded DB wait — item 36).
 *   • An OT STOP keeps its (self-confirmed) row, but ensureOrchestrationAction AND the step's upsertStep('running') before
 *     it are bounded by STOP_DB_STEP_DEADLINE_MS; past the deadline the STOP continues to the dispatcher, whose own error
 *     path decides (here a counter; for real: no row ⇒ NOT_CONFIRMED, visibly).
 *   • The post-dispatch writes of a STOP are bounded too: a SECOND stop of the same walk is never held behind them.
 *   • Control: a NON-stop step's writes are unchanged (a hung write still holds it — nothing is relaxed for motion).
 * The hung DB is explicit: a select / insert issued from the named engine function never answers (FakeDb otherwise healthy).
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
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return { ...orig, resolveUserFoeScope: () => null };
});

const fake = new FakeDb();
/** A HUNG DB for chosen engine functions only: a select / insert issued from one of them never answers. */
const HANG = { fns: new Set<string>(), hits: [] as string[] };
{
  const hungBuilder = (): any => {
    const h: any = new Proxy(
      {},
      { get: (_t, k) => (k === "then" ? () => undefined : () => h) },
    );
    return h;
  };
  const hit = () => {
    const stack = new Error().stack ?? "";
    const fn = [...HANG.fns].find((f) => stack.includes(f));
    if (fn) HANG.hits.push(fn);
    return fn;
  };
  const realSelect = fake.select.bind(fake);
  (fake as any).select = (proj?: Record<string, any>) => (hit() ? hungBuilder() : realSelect(proj));
  const realInsert = (fake as any).insert.bind(fake);
  (fake as any).insert = (t: any) => (hit() ? hungBuilder() : realInsert(t));
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

import { orchestrationRunSteps, machines, deviceAdapters, robots } from "../../../../drizzle/schema";
import { deployWorkflow, startRun } from "./foeEngine";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";

const OWNER = { id: 10, role: "engineer", name: "owner" };
type Row = Record<string, any>;
const actions = (): Row[] => fake.store.get("ai_pending_actions") ?? [];

async function within<T>(p: Promise<T>, ms: number): Promise<T | "HUNG"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([p, new Promise<"HUNG">((res) => (t = setTimeout(() => res("HUNG"), ms)))]);
  clearTimeout(t);
  return r;
}

let warn: ReturnType<typeof vi.spyOn>;
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
  HANG.fns.clear();
  HANG.hits.length = 0;
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

const RB_ABORT = { id: "ra", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } } as const;
const OT_STOP = { id: "os", type: "command", machineId: 1, command: "stop", args: { adapterId: 501 } } as const;

describe("doc 81 Đợt 5 task E4 — an orchestrated STOP never waits on a hung DB for its bookkeeping", () => {
  it("★ item 35: a robot STOP creates NO authorisation row (healthy DB) and is sent once; an OT STOP still gets its row", async () => {
    await deployWorkflow({ ref: "rows", name: "rows", steps: [RB_ABORT, OT_STOP] }, OWNER);
    const res = await startRun("rows", {}, OWNER);
    expect(res.status).toBe("completed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(actions().map((a) => a.summary)).toEqual(["FOE orchestration: step os"]);
  });

  it("★ robot STOP + HUNG authorisation lookup ⇒ never asked; sent well under the deadline", async () => {
    await deployWorkflow({ ref: "rh", name: "rh", steps: [RB_ABORT] }, OWNER);
    HANG.fns.add("ensureOrchestrationAction");
    const t0 = Date.now();
    const res = await within(startRun("rh", {}, OWNER), STOP_DB_STEP_DEADLINE_MS + 2000);
    expect(res).not.toBe("HUNG");
    expect(Date.now() - t0).toBeLessThan(STOP_DB_STEP_DEADLINE_MS / 2);
    expect(HANG.hits).toEqual([]);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ item 36: OT STOP + HUNG ensureOrchestrationAction ⇒ the STOP reaches the dispatcher within the deadline (logged)", async () => {
    await deployWorkflow({ ref: "oh", name: "oh", steps: [OT_STOP] }, OWNER);
    HANG.fns.add("ensureOrchestrationAction");
    const t0 = Date.now();
    const res = await within(startRun("oh", {}, OWNER), STOP_DB_STEP_DEADLINE_MS + 2000);
    expect(res, "OT STOP held by the authorisation row write").not.toBe("HUNG");
    expect(Date.now() - t0).toBeLessThan(STOP_DB_STEP_DEADLINE_MS + 700);
    expect(HANG.hits).toContain("ensureOrchestrationAction");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(actions()).toHaveLength(0); // no row ⇒ the real OT dispatcher would refuse NOT_CONFIRMED (its own path)
    expect(warn.mock.calls.flat().join(" ")).toMatch(/authorisation row not written in time/);
  });

  it("★ item 36: OT STOP + HUNG upsertStep (every step-row write) ⇒ BOTH stops of the walk reach their dispatchers, each bounded", async () => {
    await deployWorkflow({ ref: "uh", name: "uh", steps: [OT_STOP, { ...RB_ABORT }] }, OWNER);
    HANG.fns.add("upsertStep");
    const t0 = Date.now();
    const res = await within(startRun("uh", {}, OWNER), 6 * STOP_DB_STEP_DEADLINE_MS + 2000);
    expect(res, "a STOP held by a hung step-row write").not.toBe("HUNG");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    // OT stop: running + result + completed rows (3 bounded waits); robot stop: running + result + completed (3)
    expect(Date.now() - t0).toBeLessThan(6 * STOP_DB_STEP_DEADLINE_MS + 1500);
    expect(HANG.hits.filter((h) => h === "upsertStep").length).toBeGreaterThanOrEqual(2);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/running row not written in time/);
  });

  it("★ the FIRST stop is dispatched within ONE deadline of the start, even with every step-row write hung", async () => {
    await deployWorkflow({ ref: "first", name: "first", steps: [OT_STOP] }, OWNER);
    HANG.fns.add("upsertStep");
    const t0 = Date.now();
    let sentAt = 0;
    otDispatchMock.mockImplementationOnce(async () => {
      sentAt = Date.now();
      return { ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] };
    });
    await within(startRun("first", {}, OWNER), 4 * STOP_DB_STEP_DEADLINE_MS + 2000);
    expect(sentAt).toBeGreaterThan(0);
    expect(sentAt - t0).toBeLessThan(STOP_DB_STEP_DEADLINE_MS + 700);
  });

  it("control: a NON-stop step with a hung step-row write is held as before (nothing relaxed for motion)", async () => {
    await deployWorkflow({ ref: "mv", name: "mv", steps: [{ id: "w", type: "command", machineId: 1, command: "start", args: { adapterId: 501 } }] }, OWNER);
    HANG.fns.add("upsertStep");
    const res = await within(startRun("mv", {}, OWNER), 3 * STOP_DB_STEP_DEADLINE_MS + 500);
    expect(res).toBe("HUNG");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" "), "a motion step's write must not be bounded/skipped").not.toMatch(/not written in time/);
  });
});
