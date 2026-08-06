/**
 * GĐ4 / Wave 3, task D1 — real agent loop: observe→replan (bounded) +
 * deterministic branch resolution.
 *
 * Extends aiAgentOrchestrator.test.ts (which still proves the pre-D1
 * invariants unchanged — see its updated planner mock) with the NEW behavior:
 *  - After a `read` step yields a result, advance() calls the (mocked)
 *    planner's replanFromObservations() to adapt the not-yet-executed tail —
 *    bounded by a per-session replan budget (AGENT_MAX_REPLANS), the step cap
 *    (AGENT_MAX_STEPS), and the write cap (MAX_WRITES_PER_SESSION); the
 *    cursor only ever moves forward, and already-executed steps are never
 *    touched/re-run.
 *  - `branch` steps resolve a deterministic condition (no LLM at eval time)
 *    against the observations gathered so far. A missing/malformed condition
 *    or an out-of-bounds/backward target fails safe to fall-through (today's
 *    unconditional-skip behavior) — never a crash, never a loop.
 *  - HITL is untouched: a replanned write step still stops for confirmStep();
 *    the orchestrator never auto-executes it.
 *
 * getDb (ai_agent_sessions), the planner, and the HITL action service are all
 * mocked — no model and no real DB required (same mock style as
 * aiAgentOrchestrator.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Fake in-memory ai_agent_sessions store + drizzle-like builder (same shape
//    as aiAgentOrchestrator.test.ts). ──
type Row = Record<string, any>;
const store = new Map<string, Row>();

function makeFakeDb() {
  return {
    insert: (_t: unknown) => ({
      values: async (vals: Row) => {
        store.set(vals.id, { ...vals });
      },
    }),
    select: (_c?: unknown) => ({
      from: (_t: unknown) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async (_n: number) => {
            for (const r of store.values()) if (pred(r)) return [r];
            return [];
          },
        }),
      }),
    }),
    update: (_t: unknown) => ({
      set: (patch: Row) => ({
        where: async (pred: (r: Row) => boolean) => {
          let count = 0;
          for (const r of store.values()) {
            if (pred(r)) {
              Object.assign(r, patch);
              count++;
            }
          }
          return { rowCount: count };
        },
      }),
    }),
  };
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...preds: Array<(r: Row) => boolean>) => (r: Row) => preds.every((p) => p(r)),
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

vi.mock("../../drizzle/schema", () => ({
  aiAgentSessions: {
    id: { __name: "id" },
    status: { __name: "status" },
    userId: { __name: "userId" },
    expiresAt: { __name: "expiresAt" },
  },
}));

// ── Mock the HITL action service (the ONLY write path the orchestrator may use). ──
const proposeAction = vi.fn();
const confirmAction = vi.fn();
const cancelAction = vi.fn(async () => ({ ok: true, status: "cancelled" }));
vi.mock("./aiCopilotActions", () => ({
  proposeAction: (...a: unknown[]) => proposeAction(...a),
  confirmAction: (...a: unknown[]) => confirmAction(...a),
  cancelAction: (...a: unknown[]) => cancelAction(...a),
}));

// ── Mock the planner: BOTH planGoal (up-front plan) and replanFromObservations
//    (observe→replan) are fully controllable per test. ──
const planGoal = vi.fn();
const replanFromObservations = vi.fn();
vi.mock("./aiAgentPlanner", () => ({
  planGoal: (...a: unknown[]) => planGoal(...a),
  replanFromObservations: (...a: unknown[]) => replanFromObservations(...a),
  AGENT_MAX_STEPS: 6,
  AGENT_MAX_REPLANS: 2,
}));

// ── Mock the tool registry: one read tool, one write tool. ──
const readHandler = vi.fn(async () => ({ type: "today_stats", title: "t", data: { n: 1 }, textSummary: "" }));
const tools: Record<string, any> = {
  read_thing: { name: "read_thing", kind: "read", parameters: {}, triggers: [], handler: readHandler },
  write_thing: {
    name: "write_thing",
    kind: "write",
    parameters: {},
    triggers: [],
    requiredPermission: { module: "m", action: "canEdit" },
    summarize: () => "w",
    preview: async () => ({}),
    execute: vi.fn(async () => ({})),
  },
};
// RR-1 (Task 5, re-review round) — see aiAgentOrchestrator.test.ts for the full
// explanation: keep the REAL `argsWithAuthCtx` alive via `importOriginal()` (leaf
// module, only imports `zod`) so `tool.handler(argsWithAuthCtx(...))` doesn't throw
// on `undefined` for every read step; only override getTool/isWriteTool/isClientTool.
vi.mock("./aiLocalTools/toolRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./aiLocalTools/toolRegistry")>();
  return {
    ...actual,
    getTool: (name: string) => tools[name],
    isWriteTool: (t: any) => !!t && t.kind === "write",
    isClientTool: (t: any) => !!t && t.kind === "client",
  };
});

import { startSession, approvePlan, confirmStep } from "./aiAgentOrchestrator";

const MANAGER = { id: 10, role: "manager", name: "M" } as const;

// Spy on console.warn so FIX-1 (branch fail-safe must LOG) is verifiable —
// reset fresh each test, restored after.
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  process.env.AI_AGENTIC_ENABLED = "1";
  process.env.AGENT_MAX_WRITES_PER_SESSION = "3";
  delete process.env.AGENT_MAX_REPLANS;
  delete process.env.AGENT_MAX_STEPS;
  readHandler.mockResolvedValue({ type: "today_stats", title: "t", data: { n: 1 }, textSummary: "" });
  replanFromObservations.mockResolvedValue({ changed: false, steps: [], available: true });
  tools.write_thing.execute.mockClear();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

function plan(steps: any[]) {
  planGoal.mockResolvedValue({ plan: { steps }, available: true });
}

describe("observe→replan", () => {
  it("a read step's observation feeds replanFromObservations; the orchestrator runs the ADAPTED tail (cursor never goes backward)", async () => {
    plan([
      { kind: "read", tool: "read_thing", args: {} }, // idx0
      { kind: "guidance", rationale: "stale-tail" }, // idx1 — must be REPLACED, must never run as-is
    ]);
    replanFromObservations.mockResolvedValue({
      changed: true,
      steps: [{ kind: "write", tool: "write_thing", args: { id: 1 } }],
      available: true,
    });
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    // replanFromObservations was called with the goal, the executed read (with
    // its observation), and the STALE remaining tail.
    expect(replanFromObservations).toHaveBeenCalledTimes(1);
    const call = replanFromObservations.mock.calls[0][0];
    expect(call.goal).toBe("goal");
    expect(call.remaining).toEqual([{ kind: "guidance", rationale: "stale-tail" }]);
    expect(call.executed).toHaveLength(1);
    expect(call.executed[0].result.status).toBe("done");
    expect(call.executed[0].result.payload).toMatchObject({ data: { n: 1 } });

    // The ADAPTED tail (write_thing) ran instead of the stale guidance step.
    expect(adv.status).toBe("awaiting_confirm");
    expect(proposeAction).toHaveBeenCalledTimes(1);
    expect(proposeAction.mock.calls[0][0]).toBe(tools.write_thing);
    expect(adv.cursor).toBe(1); // forward from 0 — never backward

    const row = store.get(s.sessionId!)!;
    expect(row.planJson.steps).toHaveLength(2);
    expect(row.planJson.steps[1]).toMatchObject({ kind: "write", tool: "write_thing" });
    // Audit trail: a REPLANNED note is persisted (visible/traceable per the brief).
    expect(row.stepResults.some((r: any) => r.message === "REPLANNED")).toBe(true);
  });
});

describe("replan audit note never corrupts the progress counter (FIX-2)", () => {
  it("a replan that TRUNCATES the tail marks the synthetic note as non-step (index<0); completed over REAL steps never exceeds total", async () => {
    plan([
      { kind: "read", tool: "read_thing", args: {} }, // idx0
      { kind: "guidance", rationale: "stale-tail" }, // idx1 — truncated away entirely
    ]);
    replanFromObservations.mockResolvedValue({
      changed: true,
      steps: [], // truncate: the planner decides the goal is already complete
      available: true,
    });

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.status).toBe("done");
    const row = store.get(s.sessionId!)!;
    const total: number = row.planJson.steps.length;
    expect(total).toBe(1); // truncated: only the already-executed read remains

    const replannedNote = row.stepResults.find((r: any) => r.message === "REPLANNED");
    expect(replannedNote).toBeDefined();
    expect(replannedNote.status).toBe("done"); // indistinguishable by status alone...
    expect(replannedNote.index).toBeLessThan(0); // ...but marked non-step by index — MUST be excluded from progress

    // Recompute "completed" the way a correct consumer (server test proxy for
    // AgentPlanCard's client-side calc) must: only REAL (index >= 0) step
    // results count toward progress.
    const realCompleted = row.stepResults.filter(
      (r: any) => r.index >= 0 && (r.status === "done" || r.status === "skipped" || r.status === "failed"),
    ).length;
    expect(realCompleted).toBeLessThanOrEqual(total); // never overflows past 100%

    // Demonstrates the bug this fix prevents: naively counting ALL entries
    // (including the synthetic note, indistinguishable by status) DOES
    // overflow past `total` — proving the index<0 exclusion is load-bearing.
    const naiveCompleted = row.stepResults.filter(
      (r: any) => r.status === "done" || r.status === "skipped" || r.status === "failed",
    ).length;
    expect(naiveCompleted).toBeGreaterThan(total);
  });
});

describe("replan budget (AGENT_MAX_REPLANS)", () => {
  it("stops attempting once the budget is exhausted", async () => {
    process.env.AGENT_MAX_REPLANS = "1";
    plan([
      { kind: "read", tool: "read_thing", args: {} }, // idx0
      { kind: "read", tool: "read_thing", args: {} }, // idx1
    ]);

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.status).toBe("done");
    expect(readHandler).toHaveBeenCalledTimes(2); // both reads ran
    expect(replanFromObservations).toHaveBeenCalledTimes(1); // the 2nd read did NOT trigger another attempt
  });

  it("the step cap still binds after a replan (a bigger tail than fits is clamped)", async () => {
    process.env.AGENT_MAX_STEPS = "3";
    plan([{ kind: "read", tool: "read_thing", args: {} }]); // idx0 only
    replanFromObservations.mockResolvedValue({
      changed: true,
      steps: [
        { kind: "write", tool: "write_thing", args: { id: 1 } },
        { kind: "write", tool: "write_thing", args: { id: 2 } },
        { kind: "write", tool: "write_thing", args: { id: 3 } }, // must be clamped away
      ],
      available: true,
    });
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });

    const s = await startSession("goal", { user: MANAGER as any });
    await approvePlan(s.sessionId!, { user: MANAGER as any });

    const row = store.get(s.sessionId!)!;
    // maxSteps(3) - cursor(1) = 2 slots → only 2 of the 3 proposed writes kept.
    expect(row.planJson.steps).toHaveLength(3); // [read, write#1, write#2]
    expect(row.planJson.steps[2]).toMatchObject({ args: { id: 2 } });
  });

  it("the write cap still binds after a replan (extra write pauses; never auto-executed)", async () => {
    process.env.AGENT_MAX_WRITES_PER_SESSION = "1";
    plan([{ kind: "read", tool: "read_thing", args: {} }]);
    replanFromObservations.mockResolvedValue({
      changed: true,
      steps: [
        { kind: "write", tool: "write_thing", args: { id: 1 } },
        { kind: "write", tool: "write_thing", args: { id: 2 } },
      ],
      available: true,
    });
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });
    confirmAction.mockResolvedValue({ ok: true, status: "executed", result: {} });

    const s = await startSession("goal", { user: MANAGER as any });
    await approvePlan(s.sessionId!, { user: MANAGER as any }); // stops at write#1
    const res = await confirmStep(s.sessionId!, "ACT1", "ACT1", { user: MANAGER as any }); // tries write#2

    expect(res.status).toBe("paused");
    expect(proposeAction).toHaveBeenCalledTimes(1); // write#2 never proposed
    expect(tools.write_thing.execute).not.toHaveBeenCalled();
  });
});

describe("HITL preserved after a replan", () => {
  it("a replanned write step still stops for confirmStep — never auto-executed", async () => {
    plan([{ kind: "read", tool: "read_thing", args: {} }]);
    replanFromObservations.mockResolvedValue({
      changed: true,
      steps: [{ kind: "write", tool: "write_thing", args: { id: 9 } }],
      available: true,
    });
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT9", token: "ACT9" } });

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.status).toBe("awaiting_confirm");
    expect(adv.pendingActionId).toBe("ACT9");
    expect(confirmAction).not.toHaveBeenCalled();
    expect(tools.write_thing.execute).not.toHaveBeenCalled();
  });
});

describe("branch resolution (deterministic, no model)", () => {
  function planWithBranch(condition: any) {
    plan([
      { kind: "read", tool: "read_thing", args: {} }, // idx0
      { kind: "branch", condition }, // idx1
      { kind: "guidance", rationale: "A" }, // idx2
      { kind: "guidance", rationale: "B" }, // idx3
    ]);
  }

  it("condition true → follows thenGoto", async () => {
    readHandler.mockResolvedValue({ type: "today_stats", title: "t", data: { n: 5 }, textSummary: "" });
    planWithBranch({ when: { path: "data.n", op: "gt", value: 1 }, thenGoto: 3, elseGoto: 2 });

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.ok).toBe(true);
    expect(adv.status).toBe("done");
    const row = store.get(s.sessionId!)!;
    const branchResult = row.stepResults.find((r: any) => r.kind === "branch");
    expect(branchResult.status).toBe("done");
    expect(branchResult.message).toBe("branch→3");
  });

  it("condition false → follows elseGoto", async () => {
    readHandler.mockResolvedValue({ type: "today_stats", title: "t", data: { n: 0 }, textSummary: "" });
    planWithBranch({ when: { path: "data.n", op: "gt", value: 1 }, thenGoto: 3, elseGoto: 2 });

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.ok).toBe(true);
    const row = store.get(s.sessionId!)!;
    const branchResult = row.stepResults.find((r: any) => r.kind === "branch");
    expect(branchResult.status).toBe("done");
    expect(branchResult.message).toBe("branch→2");
  });

  it("a malformed condition (unknown op) fails safe to fall-through — never crashes, and LOGS (FIX-1)", async () => {
    planWithBranch({ when: { path: "data.n", op: "bogus" }, thenGoto: 3 });

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.ok).toBe(true);
    expect(adv.status).toBe("done");
    const row = store.get(s.sessionId!)!;
    const branchResult = row.stepResults.find((r: any) => r.kind === "branch");
    expect(branchResult.status).toBe("skipped");
    expect(branchResult.message).toBe("branch");

    // FIX-1: the caught malformed-condition error must be logged (with enough
    // context to diagnose — session id, offending op) not silently swallowed.
    expect(warnSpy).toHaveBeenCalled();
    const [msg, detail] = warnSpy.mock.calls[0];
    expect(msg).toContain("branch condition failed to evaluate");
    expect(msg).toContain(s.sessionId!);
    expect(JSON.stringify(detail)).toContain("bogus");
  });

  it("a backward target is rejected (forward-only) — falls through instead of looping, and LOGS (FIX-1)", async () => {
    // idx0 (read) is BEFORE the branch (idx1) → illegal backward jump.
    planWithBranch({ when: { path: "data.n", op: "exists" }, thenGoto: 0 });

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.status).toBe("done"); // the loop terminated normally — it did NOT get stuck
    const row = store.get(s.sessionId!)!;
    const branchResult = row.stepResults.find((r: any) => r.kind === "branch");
    expect(branchResult.status).toBe("skipped"); // fell through — the illegal target was rejected

    // FIX-1: a rejected out-of-bounds/backward target must ALSO be logged.
    expect(warnSpy).toHaveBeenCalled();
    const [msg] = warnSpy.mock.calls[0];
    expect(msg).toContain("branch target rejected");
    expect(msg).toContain(s.sessionId!);
  });

  it("an out-of-bounds (beyond plan length) target is rejected — falls through and LOGS (FIX-1)", async () => {
    planWithBranch({ when: { path: "data.n", op: "exists" }, thenGoto: 999 });

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.status).toBe("done");
    const row = store.get(s.sessionId!)!;
    const branchResult = row.stepResults.find((r: any) => r.kind === "branch");
    expect(branchResult.status).toBe("skipped");

    expect(warnSpy).toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("branch target rejected");
  });

  it("no condition at all → behaves EXACTLY like the old unconditional skip (backward compatible)", async () => {
    plan([
      { kind: "read", tool: "read_thing", args: {} },
      { kind: "branch" }, // no condition — old-style branch step
      { kind: "guidance", rationale: "after" },
    ]);

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.status).toBe("done");
    const row = store.get(s.sessionId!)!;
    const branchResult = row.stepResults.find((r: any) => r.kind === "branch");
    expect(branchResult.status).toBe("skipped");
    expect(branchResult.message).toBe("branch");
  });
});

describe("offline / degrade", () => {
  it("replanner reports no change (offline) → session continues on the EXISTING plan, no crash", async () => {
    plan([
      { kind: "read", tool: "read_thing", args: {} },
      { kind: "guidance", rationale: "kept" },
    ]);
    replanFromObservations.mockResolvedValue({ changed: false, steps: [], available: false, message: "offline" });

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.ok).toBe(true);
    expect(adv.status).toBe("done");
    const row = store.get(s.sessionId!)!;
    expect(row.planJson.steps).toHaveLength(2); // untouched
    expect(row.planJson.steps[1]).toMatchObject({ kind: "guidance", rationale: "kept" });
    expect(row.stepResults.some((r: any) => r.message === "REPLANNED")).toBe(false); // nothing changed → no audit note
  });

  it("replanFromObservations throwing never crashes the session", async () => {
    plan([{ kind: "read", tool: "read_thing", args: {} }]);
    replanFromObservations.mockRejectedValue(new Error("boom"));

    const s = await startSession("goal", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.ok).toBe(true);
    expect(adv.status).toBe("done");
  });
});
