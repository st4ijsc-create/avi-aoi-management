/**
 * doc 81 Đợt 7 final wave F1 (security scan #26/#27, final review #1) — the QT-4 SIM-GATE and the QT handler registry are bound
 * to the RUN, not to a ref string (FakeDb; the real engine resolver `resolveWorkflowByRef`; the factory-scope JUDGE is driven by
 * the test: user 10 = factory A ('f:1', machine 1), user 11 = factory B ('f:2', machine 2), admin = unrestricted):
 *   • the sim token is checked against the ONE workflow `simWorkflowRef` names within the run owner's scope — a token of
 *     factory B's same-ref workflow no longer passes factory A's NPI run;
 *   • every failure after the parameters (wrong token, missing ref, invisible ref, ambiguous, undecidable, unknown owner, no
 *     DB) gives the SAME note — no cross-namespace ref-existence oracle in the run's step results;
 *   • QT business handlers / compensations only for a run of the GLOBAL QT template row (a factory workflow carrying a QT ref
 *     in its own namespace gets none).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const { judge } = vi.hoisted(() => ({ judge: { failed: false, keyFail: false } }));
vi.mock("../foe/foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../foe/foeScope")>();
  return {
    ...orig,
    workflowScopeKeyOf: async (scope: { userId?: number; userRole?: string } | null) => {
      if (judge.keyFail) throw new Error("scope lookup failed");
      if (scope === null || scope.userRole === "admin") return "global";
      return scope.userId === 11 ? "f:2" : scope.userId === 10 || scope.userId === 13 ? "f:1" : "f:"; // 13: a DISABLED account of factory A
    },
    makeScopeJudge: async (scope: { userId?: number; userRole?: string } | null) => {
      const pick = (m: Map<number, boolean>, o?: { nonStopOnly?: boolean }) => [...m.entries()].filter(([, ns]) => !o?.nonStopOnly || ns).map(([id]) => id);
      if (scope === null || scope.userRole === "admin") return { unrestricted: true, failed: false, outOf: async () => ({ machines: [], robots: [], adapters: [] }) };
      const mine = scope.userId === 11 ? 2 : scope.userId === 10 || scope.userId === 13 ? 1 : -1;
      return {
        unrestricted: false,
        failed: judge.failed,
        outOf: async (t: { machines: Map<number, boolean>; robots: Map<number, boolean>; adapters: Map<number, boolean> }, o?: { nonStopOnly?: boolean }) => ({
          machines: pick(t.machines, o).filter((id) => judge.failed || id !== mine),
          robots: pick(t.robots, o),
          adapters: pick(t.adapters, o),
        }),
      };
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
  const desc = (col: { name: string }) => ({ name: col.name, dir: "desc" as const });
  return { ...actual, eq: makeEq, and: makeAnd, ne, inArray, notInArray, isNull, desc };
});
const conn = vi.hoisted(() => ({ up: true }));
const svc = vi.hoisted(() => ({ cancelOrder: vi.fn(async (orderId: number) => ({ orderId, state: "failed", via: "compensation" })) }));
vi.mock("../../orders/orderLifecycleService", () => ({ cancelOrder: svc.cancelOrder, allocateOrder: vi.fn(), transitionOrder: vi.fn(), getOrderDetail: vi.fn() }));
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => (conn.up ? fake : null)) }));

import { machines, orchestrationRuns, orchestrationRunSteps, orchestrationWorkflows, users } from "../../../../drizzle/schema";
import { issueSimToken } from "../foe/foeEngine";
import { findQtBusinessStep, qtTemplateRefOfRun, SIM_GATE_FAIL_NOTE } from "./qtStepHandlers";
import { QT1_REF, QT4_REF } from "./qtTemplates";

type Row = Record<string, any>;
const defA = { ref: "prod-x", name: "A's X", steps: [{ id: "a", type: "command", machineId: 1, command: "start" }] };
const defB = { ref: "prod-x", name: "B's X", steps: [{ id: "b", type: "command", machineId: 2, command: "start" }] };
const defG = { ref: "glob-y", name: "global Y", steps: [{ id: "a", type: "command", machineId: 1, command: "start" }] };
const defBonly = { ref: "b-only", name: "B only", steps: [{ id: "b", type: "command", machineId: 2, command: "start" }] };

const gate = () => findQtBusinessStep(QT4_REF, "qt4-sim-gate")!;
const runAs = (startedBy: number | null, id = 77) => {
  fake.seed(orchestrationRuns, [...((fake.store.get("orchestration_runs") as Row[]) ?? []).filter((r) => r.id !== id), { id, workflowId: 1, workflowRef: QT4_REF, status: "awaiting_confirm", startedBy, paramsJson: {} }]);
  return id;
};
const check = (runId: number, simWorkflowRef: string, simToken: string) => gate().run!({ runId, params: { npi: true, simWorkflowRef, simToken } });

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  judge.failed = false;
  judge.keyFail = false;
  conn.up = true;
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "A", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "AUTOMATION", capabilities: null, code: "M2", name: "B", operationStatus: "stopped", stationId: 2 },
  ]);
  fake.seed(users, [
    { id: 10, role: "engineer", isActive: true },
    { id: 11, role: "engineer", isActive: true },
    { id: 12, role: "admin", isActive: true },
    { id: 13, role: "engineer", isActive: false },
  ]);
  fake.seed(orchestrationWorkflows, [
    { id: 1, ref: QT4_REF, scopeKey: "global", name: "QT4", version: 1, status: "active", definitionJson: { ref: QT4_REF, name: "QT4", steps: [] } },
    { id: 2, ref: "prod-x", scopeKey: "f:1", name: "A's X", version: 1, status: "active", definitionJson: defA },
    { id: 3, ref: "prod-x", scopeKey: "f:2", name: "B's X", version: 1, status: "active", definitionJson: defB },
    { id: 4, ref: "glob-y", scopeKey: "global", name: "Y", version: 1, status: "active", definitionJson: defG },
    { id: 5, ref: "b-only", scopeKey: "f:2", name: "B only", version: 1, status: "active", definitionJson: defBonly },
    { id: 6, ref: QT1_REF, scopeKey: "f:1", name: "A's copy of a QT ref", version: 1, status: "active", definitionJson: { ref: QT1_REF, name: "x", steps: [] } },
    { id: 7, ref: QT1_REF, scopeKey: "global", name: "QT1", version: 1, status: "active", definitionJson: { ref: QT1_REF, name: "QT1", steps: [] } },
  ]);
});

describe("final wave F1 — the QT-4 sim-gate checks the token against the run's OWN view of simWorkflowRef", () => {
  it("★ factory A's NPI run: A's own X token ⇒ PASS; B's same-ref X token ⇒ refused (it passed before, any namespace matched)", async () => {
    const run = runAs(10);
    const ok = await check(run, "prod-x", issueSimToken(defA as never));
    expect(ok.ok).toBe(true);
    expect(ok.note).toContain("workflow #2");
    expect(await check(run, "prod-x", issueSimToken(defB as never))).toEqual({ ok: false, note: SIM_GATE_FAIL_NOTE });
    // and B's NPI run accepts B's token, not A's
    const runB = runAs(11, 78);
    expect((await check(runB, "prod-x", issueSimToken(defB as never))).ok).toBe(true);
    expect((await check(runB, "prod-x", issueSimToken(defA as never))).ok).toBe(false);
  });

  it("★ ONE note for every failure: missing ref, a ref only another factory uses (with ITS valid token), wrong token — no existence oracle", async () => {
    const run = runAs(10);
    const answers = [
      await check(run, "no-such-ref", issueSimToken(defBonly as never)),
      await check(run, "b-only", issueSimToken(defBonly as never)), // valid token of a workflow A cannot see
      await check(run, "prod-x", "not-a-token"),
      await check(run, "glob-y", issueSimToken(defA as never)),
    ];
    for (const a of answers) expect(a).toEqual({ ok: false, note: SIM_GATE_FAIL_NOTE });
    expect((await check(run, "glob-y", issueSimToken(defG as never))).ok).toBe(true); // a visible global workflow passes
  });

  it("★ undecidable ⇒ refused with the same note: scope judge failed, namespace unresolvable, ambiguous (admin owner, two factory X, no global), unknown / disabled owner, no DB", async () => {
    const tokA = issueSimToken(defA as never);
    const run = runAs(10);
    judge.failed = true;
    expect(await check(run, "prod-x", tokA)).toEqual({ ok: false, note: SIM_GATE_FAIL_NOTE });
    judge.failed = false;
    judge.keyFail = true;
    expect(await check(run, "prod-x", tokA)).toEqual({ ok: false, note: SIM_GATE_FAIL_NOTE });
    judge.keyFail = false;
    expect(await check(runAs(12, 79), "prod-x", tokA)).toEqual({ ok: false, note: SIM_GATE_FAIL_NOTE }); // admin sees f:1 + f:2
    expect(await check(runAs(13, 80), "prod-x", tokA)).toEqual({ ok: false, note: SIM_GATE_FAIL_NOTE }); // disabled owner
    expect(await check(runAs(99, 81), "prod-x", tokA)).toEqual({ ok: false, note: SIM_GATE_FAIL_NOTE }); // unknown owner
    expect(await check(4242, "prod-x", tokA)).toEqual({ ok: false, note: SIM_GATE_FAIL_NOTE }); // no run row
    conn.up = false;
    expect(await check(run, "prod-x", tokA)).toEqual({ ok: false, note: SIM_GATE_FAIL_NOTE });
    conn.up = true;
    expect((await check(run, "prod-x", tokA)).ok).toBe(true); // control: same inputs, decidable ⇒ PASS
  });

  it("a system-started run (no owner) resolves in the EMPTY scope it was started with: a target-bearing workflow is not visible ⇒ refused", async () => {
    expect(await check(runAs(null), "glob-y", issueSimToken(defG as never))).toEqual({ ok: false, note: SIM_GATE_FAIL_NOTE });
  });

  it("missing parameters keep their own explicit note; npi=false skips", async () => {
    const run = runAs(10);
    expect((await gate().run!({ runId: run, params: { npi: true } })).note).toMatch(/thiếu simToken\/simWorkflowRef/);
    expect(await gate().run!({ runId: run, params: { npi: false } })).toMatchObject({ ok: true, skipped: true });
  });
});

describe("final wave F1 — QT handlers are keyed on the run's GLOBAL template row, not the ref string", () => {
  it("★ the global QT row ⇒ its ref; a factory workflow carrying a QT ref in its own namespace ⇒ null (no QT handlers / compensations)", async () => {
    expect(await qtTemplateRefOfRun({ workflowId: 7 })).toBe(QT1_REF);
    expect(await qtTemplateRefOfRun({ workflowId: 1 })).toBe(QT4_REF);
    expect(await qtTemplateRefOfRun({ workflowId: 6 })).toBeNull(); // same ref, namespace f:1
    expect(await qtTemplateRefOfRun({ workflowId: 4 })).toBeNull(); // global, not a QT ref
    expect(await qtTemplateRefOfRun({ workflowId: 404 })).toBeNull(); // missing
    conn.up = false;
    expect(await qtTemplateRefOfRun({ workflowId: 7 })).toBeNull(); // no DB ⇒ no handler (the gate waits for a person)
  });

  it("★ pumpQtRun on a paused run of the FACTORY copy of a QT ref runs NO handler (waiting_external — the gate waits for a person)", async () => {
    process.env.FOE_ENABLED = "true";
    const { pumpQtRun } = await import("./qtRunner");
    fake.seed(orchestrationRuns, [
      { id: 90, workflowId: 6, workflowRef: QT1_REF, status: "awaiting_confirm", currentStepId: "qt1-allocate", startedBy: 10, paramsJson: {} },
    ]);
    const r = await pumpQtRun(90);
    expect(r).toMatchObject({ ok: true, status: "waiting_external", pausedStepId: "qt1-allocate" });
    expect(r.notes).toEqual([]); // no handler ran
    expect((fake.store.get("orchestration_runs") as Row[]).find((x) => x.id === 90)!.status).toBe("awaiting_confirm");
  });

  it("★ an external REJECTION (resolveQtGate) of the factory copy runs NO QT compensation; of the global template row it does", async () => {
    process.env.FOE_ENABLED = "true";
    const { resolveQtGate } = await import("./qtRunner");
    const seedRun = (id: number, workflowId: number) => {
      fake.seed(orchestrationRuns, [
        ...(((fake.store.get("orchestration_runs") as Row[]) ?? []).filter((r) => r.id !== id)),
        { id, workflowId, workflowRef: QT1_REF, status: "awaiting_confirm", currentStepId: "qt1-monitor", startedBy: 10, paramsJson: { orderId: 11, lineId: 2 } },
      ]);
      fake.seed(orchestrationRunSteps, [
        ...(((fake.store.get("orchestration_run_steps") as Row[]) ?? []).filter((r) => r.runId !== id)),
        { id: id * 10, runId: id, stepId: "qt1-allocate", stepType: "hitl_gate", status: "completed", attempt: 1 },
      ]);
    };
    seedRun(91, 6); // factory copy
    svc.cancelOrder.mockClear();
    const copy = await resolveQtGate(91, { approved: false, note: "stop" });
    expect(copy.status).toBe("aborted");
    expect(svc.cancelOrder).not.toHaveBeenCalled();
    expect(copy.notes.filter((n) => n.startsWith("bù trừ:"))).toEqual([]);
    seedRun(92, 7); // the global QT-1 template row (control: the instrument sees a compensation)
    const tpl = await resolveQtGate(92, { approved: false, note: "stop" });
    expect(tpl.status).toBe("aborted");
    expect(svc.cancelOrder.mock.calls.map((c) => c[0])).toEqual([11]);
  });
});
