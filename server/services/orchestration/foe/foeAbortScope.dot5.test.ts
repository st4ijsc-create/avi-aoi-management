/**
 * doc 81 Đợt 5 task E fix 1 (ruling R-5-i, review #5) — the factory-scope check of an ABORT and of a gate REJECTION (both
 * reduce actuation) is bounded by the STOP DB deadline and never fails closed on doubt:
 *   • scope lookup hung / failed ⇒ the abort / rejection PROCEEDS within STOP_DB_STEP_DEADLINE_MS, audited "scopeUnverified";
 *   • a DECIDED out-of-scope ⇒ the SAME answer as a missing run (R-5-d), the run untouched;
 *   • an APPROVAL stays fail-closed (it lets actuation proceed).
 * Also (review #9): startRun resolves the caller's scope for a MISSING ref too (same path as an existing one).
 * The scope resolver (foeScope.makeScopeJudge) is driven by the test; everything else is the real engine on the FakeDb.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const { otDispatchMock, audit, judge } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(async (_cmd?: unknown) => ({ ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] })),
  audit: vi.fn(async (_ctx: unknown, _e: Record<string, any>) => ({ id: 1 })),
  judge: { mode: "in" as "in" | "out" | "fail" | "hang", calls: 0 },
}));
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return { isStopCommandType: orig.isStopCommandType, classifyOtStop: orig.classifyOtStop, dispatch: otDispatchMock };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: vi.fn() }));
vi.mock("../../auditTrailService", () => ({ createAuditContext: (x: unknown) => x, logCrudOperation: audit }));
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  const none = { machines: [], robots: [], adapters: [] };
  return {
    ...orig,
    resolveUserFoeScope: (u: { id: number; role: string }) => ({ userId: u.id, userRole: u.role }),
    makeScopeJudge: async () => {
      judge.calls += 1;
      switch (judge.mode) {
        case "in":
          return { unrestricted: true, failed: false, outOf: async () => none };
        case "out":
          return { unrestricted: false, failed: false, outOf: async () => ({ machines: [1], robots: [], adapters: [] }) };
        case "fail":
          return { unrestricted: false, failed: true, outOf: async () => ({ machines: [1], robots: [], adapters: [] }) };
        case "hang":
          return new Promise(() => undefined);
      }
    },
  };
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

import { orchestrationRunSteps, machines, deviceAdapters } from "../../../../drizzle/schema";
import { deployWorkflow, startRun, resumeRun, abortRun } from "./foeEngine";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";

const OWNER = { id: 10, role: "engineer", name: "owner" };
const OTHER = { id: 12, role: "engineer", name: "other-factory" };
type Row = Record<string, any>;
const runRow = (id: number): Row => (fake.store.get("orchestration_runs") ?? []).find((r: Row) => r.id === id)!;
const unverified = () => audit.mock.calls.map((c) => c[1]).filter((e) => e?.details?.operation === "foe_scope_unverified");

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [{ id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 }]);
  fake.seed(deviceAdapters, [{ id: 501, machineId: 1, isEnabled: true }]);
  otDispatchMock.mockClear();
  audit.mockClear();
  judge.mode = "in";
  judge.calls = 0;
  process.env.FOE_ENABLED = "true";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
});

async function pausedRun(): Promise<number> {
  await deployWorkflow({ ref: "g", name: "g", steps: [{ id: "g", type: "hitl_gate", prompt: "p" }, { id: "w", type: "command", machineId: 1, command: "start" }] }, OWNER);
  const s = await startRun("g", {}, OWNER);
  expect(s.status).toBe("awaiting_confirm");
  return s.runId!;
}

async function timed<T>(p: Promise<T>): Promise<{ v: T; ms: number }> {
  const t0 = Date.now();
  const v = await p;
  return { v, ms: Date.now() - t0 };
}

describe("doc 81 Đợt 5 E fix 1 (R-5-i) — abort / reject scope check: bounded, proceeds on doubt, refuses only a decided out-of-scope", () => {
  for (const mode of ["hang", "fail"] as const) {
    it(`★ abort with the scope lookup ${mode === "hang" ? "HUNG" : "FAILING"} ⇒ the abort PROCEEDS within the STOP deadline, audited scopeUnverified`, async () => {
      const runId = await pausedRun();
      judge.mode = mode;
      const { v, ms } = await timed(abortRun(runId, OTHER, "stop now"));
      expect(v.status).toBe("aborted");
      expect(ms).toBeLessThan(STOP_DB_STEP_DEADLINE_MS + 700);
      expect(runRow(runId).status).toBe("aborted");
      await vi.waitFor(() => expect(unverified().map((e) => e.details.metadata)).toEqual([{ runId, action: "abort", reason: "scopeUnverified" }]));
    });

    it(`★ gate REJECTION with the scope lookup ${mode === "hang" ? "HUNG" : "FAILING"} ⇒ the rejection proceeds (run aborted, nothing sent), audited`, async () => {
      const runId = await pausedRun();
      judge.mode = mode;
      const { v, ms } = await timed(resumeRun(runId, { approved: false, note: "no" }, OTHER));
      expect(v.status).toBe("aborted");
      expect(ms).toBeLessThan(STOP_DB_STEP_DEADLINE_MS + 700);
      expect(otDispatchMock).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(unverified().map((e) => e.details.metadata.action)).toEqual(["reject"]));
    });
  }

  it("★ a DECIDED out-of-scope abort / rejection ⇒ the SAME answer as a missing run, the run untouched, no audit", async () => {
    const runId = await pausedRun();
    judge.mode = "out";
    const N = 999_999;
    const fix = (r: unknown, id: number) => JSON.stringify(r).split(String(id)).join("ID");
    expect(fix(await abortRun(runId, OTHER, "x"), runId)).toBe(fix(await abortRun(N, OTHER, "x"), N));
    expect(fix(await resumeRun(runId, { approved: false }, OTHER), runId)).toBe(fix(await resumeRun(N, { approved: false }, OTHER), N));
    expect(runRow(runId).status).toBe("awaiting_confirm");
    expect(unverified()).toEqual([]);
  });

  it("an APPROVAL stays fail-closed: a failing scope lookup ⇒ 'not found', the gate is not approved", async () => {
    const runId = await pausedRun();
    judge.mode = "fail";
    const r = await resumeRun(runId, { approved: true }, OTHER);
    expect(r).toEqual({ ok: false, enabled: true, message: `Run ${runId} not found.` });
    expect(runRow(runId).status).toBe("awaiting_confirm");
    expect(otDispatchMock).not.toHaveBeenCalled();
  });

  it("review #9: startRun resolves the caller's scope for a MISSING ref too (same path as an existing ref)", async () => {
    judge.calls = 0;
    const r = await startRun("no-such-ref", {}, OWNER);
    expect(r).toEqual({ ok: false, enabled: true, message: `Workflow "no-such-ref" not found.` });
    expect(judge.calls).toBe(1);
  });
});
