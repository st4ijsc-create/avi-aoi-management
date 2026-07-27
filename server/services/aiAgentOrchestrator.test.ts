/**
 * GĐ3b — AI Agent Orchestrator tests.
 *
 * SAFETY INVARIANTS proven here:
 *  - advance() STOPS at a write step (status awaiting_confirm) and does NOT
 *    advance the cursor until confirmStep executes it.
 *  - confirmStep calls the CORE confirmAction (re-used 100%); only after it
 *    returns `executed` does the cursor move and the plan resume.
 *  - The orchestrator NEVER calls tool.execute() and NEVER auto-confirms (it
 *    only ever invokes proposeAction + confirmAction, both mocked & asserted).
 *  - MAX_WRITES_PER_SESSION → paused. RBAC-denied propose → paused cleanly.
 *  - A failing read step → paused with a clean step trail.
 *  - The agentic gate uses the SERVER role: worker/engineer → { enabled:false }.
 *
 * getDb (ai_agent_sessions), the planner, and the HITL action service are all
 * mocked, so no model and no real DB are required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake in-memory ai_agent_sessions store + drizzle-like builder ──
type Row = Record<string, any>;
const store = new Map<string, Row>();

function makeFakeDb() {
  return {
    insert: (_t: unknown) => ({
      values: async (vals: Row) => { store.set(vals.id, { ...vals }); },
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
          for (const r of store.values()) if (pred(r)) { Object.assign(r, patch); count++; }
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

// ── E2-4 — spy on the realtime nudge choke points call as their LAST step.
// Mocked (not the real eventBus) so these existing behavioral tests stay
// decoupled from the realtime channel; aiAgentRealtime.test.ts covers the
// publish/bridge mechanics themselves.
const publishAiAgentEvent = vi.fn();
vi.mock("./aiAgentRealtime", () => ({
  publishAiAgentEvent: (...a: unknown[]) => publishAiAgentEvent(...a),
}));

// ── Mock the planner (deterministic plans). replanFromObservations defaults to
//    "no change" so pre-existing tests (which don't care about replanning) see
//    IDENTICAL behavior to before D1 — see aiAgentOrchestrator.replan.test.ts
//    for the observe→replan / branch-condition test suite. ──
const planGoal = vi.fn();
const replanFromObservations = vi.fn(async () => ({ changed: false, steps: [], available: true }));
vi.mock("./aiAgentPlanner", () => ({
  planGoal: (...a: unknown[]) => planGoal(...a),
  replanFromObservations: (...a: unknown[]) => replanFromObservations(...a),
  AGENT_MAX_STEPS: 6,
  AGENT_MAX_REPLANS: 2,
}));

// ── Mock the tool registry: provide read/write/client tools. ──
const readHandler = vi.fn(async () => ({ type: "today_stats", title: "t", data: { n: 1 }, textSummary: "" }));
const tools: Record<string, any> = {
  read_thing: { name: "read_thing", kind: "read", parameters: {}, triggers: [], handler: readHandler },
  write_thing: {
    name: "write_thing", kind: "write", parameters: {}, triggers: [],
    requiredPermission: { module: "m", action: "canEdit" },
    summarize: () => "w", preview: async () => ({}), execute: vi.fn(async () => ({})),
  },
};
vi.mock("./aiLocalTools/toolRegistry", () => ({
  getTool: (name: string) => tools[name],
  isWriteTool: (t: any) => !!t && t.kind === "write",
  isClientTool: (t: any) => !!t && t.kind === "client",
}));

import {
  startSession,
  approvePlan,
  advance,
  confirmStep,
  cancelSession,
  canUseAgentic,
} from "./aiAgentOrchestrator";

const MANAGER = { id: 10, role: "manager", name: "M" } as const;
const WORKER = { id: 20, role: "worker", name: "W" } as const;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  process.env.AI_AGENTIC_ENABLED = "1";
  process.env.AGENT_MAX_WRITES_PER_SESSION = "3";
  readHandler.mockResolvedValue({ type: "today_stats", title: "t", data: { n: 1 }, textSummary: "" });
});

function plan(steps: any[]) {
  planGoal.mockResolvedValue({ plan: { steps }, available: true });
}

describe("agentic gate (server role)", () => {
  it("manager is allowed; worker/engineer are not", () => {
    expect(canUseAgentic(MANAGER)).toBe(true);
    expect(canUseAgentic(WORKER)).toBe(false);
    expect(canUseAgentic({ role: "engineer" })).toBe(false);
  });

  it("startSession for a disallowed role returns { enabled:false } and creates NO row", async () => {
    plan([{ kind: "read", tool: "read_thing", args: {} }]);
    const res = await startSession("goal", { user: WORKER as any });
    expect(res.enabled).toBe(false);
    expect(res.sessionId).toBeUndefined();
    expect(store.size).toBe(0);
    expect(planGoal).not.toHaveBeenCalled();
  });

  it("disabled flag blocks even an allowed role", async () => {
    process.env.AI_AGENTIC_ENABLED = "0";
    expect(canUseAgentic(MANAGER)).toBe(false);
  });
});

describe("startSession + plan cut", () => {
  it("parks at awaiting_approval and caps steps at AGENT_MAX_STEPS", async () => {
    plan(Array.from({ length: 9 }, () => ({ kind: "read", tool: "read_thing", args: {} })));
    const res = await startSession("goal", { user: MANAGER as any });
    expect(res.enabled).toBe(true);
    expect(res.status).toBe("awaiting_approval");
    expect(res.plan!.steps.length).toBe(6); // capped
    expect(store.get(res.sessionId!)!.status).toBe("awaiting_approval");
  });
});

describe("advance — write step STOPS at awaiting_confirm (no execute, no auto-chain)", () => {
  it("read then write: advance runs read, proposes write, STOPS; cursor stays on write", async () => {
    plan([
      { kind: "read", tool: "read_thing", args: {} },
      { kind: "write", tool: "write_thing", args: { id: 1 } },
      { kind: "read", tool: "read_thing", args: {} }, // must NOT run yet
    ]);
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });

    const s = await startSession("g", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.status).toBe("awaiting_confirm");
    expect(adv.pendingActionId).toBe("ACT1");
    expect(adv.cursor).toBe(1); // parked ON the write step, NOT advanced past it
    expect(proposeAction).toHaveBeenCalledTimes(1);
    expect(confirmAction).not.toHaveBeenCalled(); // never auto-confirms
    expect(readHandler).toHaveBeenCalledTimes(1); // only the first read ran
    expect(tools.write_thing.execute).not.toHaveBeenCalled(); // orchestrator never executes

    const row = store.get(s.sessionId!)!;
    expect(row.status).toBe("awaiting_confirm");
    expect(row.writeCount).toBe(1);
    expect(row.linkedActionIds).toEqual(["ACT1"]);
  });

  it("propose uses the SERVER user (ctx.user), not client input", async () => {
    plan([{ kind: "write", tool: "write_thing", args: { id: 1 } }]);
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "A", token: "A" } });
    const s = await startSession("g", { user: MANAGER as any });
    await approvePlan(s.sessionId!, { user: MANAGER as any });
    const ctxArg = proposeAction.mock.calls[0][2];
    expect(ctxArg.user).toMatchObject({ id: MANAGER.id, role: MANAGER.role });
  });
});

describe("confirmStep — calls core confirmAction, THEN advances", () => {
  async function setupAtWrite() {
    plan([
      { kind: "write", tool: "write_thing", args: { id: 1 } },
      { kind: "read", tool: "read_thing", args: {} },
    ]);
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });
    const s = await startSession("g", { user: MANAGER as any });
    await approvePlan(s.sessionId!, { user: MANAGER as any });
    return s.sessionId!;
  }

  it("confirmStep invokes confirmAction; on executed the cursor advances and the plan resumes to done", async () => {
    const sid = await setupAtWrite();
    confirmAction.mockResolvedValue({ ok: true, status: "executed", result: { done: true } });

    const res = await confirmStep(sid, "ACT1", "ACT1", { user: MANAGER as any });

    expect(confirmAction).toHaveBeenCalledTimes(1);
    // confirmAction(actionId, token, user, lang, req)
    expect(confirmAction.mock.calls[0][0]).toBe("ACT1");
    expect(confirmAction.mock.calls[0][2]).toMatchObject({ id: MANAGER.id });
    expect(res.status).toBe("done"); // resumed past the write, ran the trailing read
    expect(readHandler).toHaveBeenCalledTimes(1);
    expect(store.get(sid)!.status).toBe("done");
  });

  it("confirmStep does NOT advance the cursor before confirmAction reports executed (denied → paused)", async () => {
    const sid = await setupAtWrite();
    const before = store.get(sid)!.cursor;
    confirmAction.mockResolvedValue({ ok: false, status: "denied", message: "no perm" });

    const res = await confirmStep(sid, "ACT1", "ACT1", { user: MANAGER as any });

    expect(res.status).toBe("paused");
    expect(store.get(sid)!.cursor).toBe(before); // cursor did NOT move
    expect(readHandler).not.toHaveBeenCalled(); // plan did NOT resume
  });
});

describe("limits & clean failure", () => {
  it("MAX_WRITES_PER_SESSION exceeded → paused (no extra propose)", async () => {
    process.env.AGENT_MAX_WRITES_PER_SESSION = "1";
    plan([
      { kind: "write", tool: "write_thing", args: { id: 1 } },
      { kind: "write", tool: "write_thing", args: { id: 2 } },
    ]);
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });
    confirmAction.mockResolvedValue({ ok: true, status: "executed", result: {} });

    const s = await startSession("g", { user: MANAGER as any });
    await approvePlan(s.sessionId!, { user: MANAGER as any }); // stops at write #1
    const res = await confirmStep(s.sessionId!, "ACT1", "ACT1", { user: MANAGER as any }); // tries write #2

    expect(res.status).toBe("paused");
    expect(proposeAction).toHaveBeenCalledTimes(1); // second write never proposed
    expect(store.get(s.sessionId!)!.status).toBe("paused");
  });

  it("RBAC-denied propose → paused cleanly (cursor stays, no awaiting_confirm)", async () => {
    plan([{ kind: "write", tool: "write_thing", args: { id: 1 } }]);
    proposeAction.mockResolvedValue({ ok: false, denied: true, reason: "MISSING_PERMISSION", message: "denied" });

    const s = await startSession("g", { user: MANAGER as any });
    const res = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(res.status).toBe("paused");
    expect(res.pendingActionId).toBeFalsy();
    const row = store.get(s.sessionId!)!;
    expect(row.status).toBe("paused");
    expect(row.cursor).toBe(0);
    expect(row.writeCount).toBe(0);
    expect(row.linkedActionIds).toEqual([]);
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("a failing read step → paused with a clean step trail", async () => {
    plan([{ kind: "read", tool: "read_thing", args: {} }]);
    readHandler.mockRejectedValue(new Error("query boom"));

    const s = await startSession("g", { user: MANAGER as any });
    const res = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(res.status).toBe("paused");
    const row = store.get(s.sessionId!)!;
    expect(row.status).toBe("paused");
    expect(row.stepResults.at(-1)).toMatchObject({ status: "failed" });
  });
});

describe("SAFETY INVARIANTS", () => {
  it("orchestrator source NEVER imports commandDispatcher and NEVER calls tool.execute()", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = fileURLToPath(new URL("./aiAgentOrchestrator.ts", import.meta.url));
    const src = readFileSync(path, "utf8");
    // Strip the leading block comment (which documents the invariant) before scanning code.
    const code = src.replace(/^\/\*\*[\s\S]*?\*\//, "");
    expect(/from\s+["'][^"']*commandDispatcher/.test(code), "must not import commandDispatcher").toBe(false);
    expect(/import\(["'][^"']*commandDispatcher/.test(code), "must not dynamic-import commandDispatcher").toBe(false);
    expect(/\.execute\s*\(/.test(code), "must not call .execute()").toBe(false);
  });

  it("after approving a write plan, only proposeAction is called — execute/confirm are NOT", async () => {
    plan([{ kind: "write", tool: "write_thing", args: { id: 1 } }]);
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });

    const s = await startSession("g", { user: MANAGER as any });
    await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(proposeAction).toHaveBeenCalledTimes(1);
    expect(confirmAction).not.toHaveBeenCalled(); // orchestrator does NOT confirm
    expect(tools.write_thing.execute).not.toHaveBeenCalled(); // and does NOT execute
    // The action is parked awaiting user confirm (proposed), not executed.
    expect(store.get(s.sessionId!)!.status).toBe("awaiting_confirm");
  });
});

describe("cancelSession", () => {
  it("aborts the session and cancels the pending action", async () => {
    plan([{ kind: "write", tool: "write_thing", args: { id: 1 } }]);
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });
    const s = await startSession("g", { user: MANAGER as any });
    await approvePlan(s.sessionId!, { user: MANAGER as any });

    const res = await cancelSession(s.sessionId!, { user: MANAGER as any });
    expect(res.status).toBe("aborted");
    expect(cancelAction).toHaveBeenCalledWith("ACT1", expect.objectContaining({ id: MANAGER.id }), undefined);
    expect(store.get(s.sessionId!)!.status).toBe("aborted");
  });
});

describe("E2-4 — realtime nudge at each choke point", () => {
  it("startSession publishes session_started with the new sessionId, AFTER the row is persisted", async () => {
    plan([{ kind: "read", tool: "read_thing", args: {} }]);
    const s = await startSession("g", { user: MANAGER as any });
    expect(publishAiAgentEvent).toHaveBeenCalledWith("session_started", s.sessionId);
    // the row must already be awaiting_approval by the time we publish
    expect(store.get(s.sessionId!)!.status).toBe("awaiting_approval");
  });

  it("startSession for a disallowed role does NOT publish (no state change)", async () => {
    plan([{ kind: "read", tool: "read_thing", args: {} }]);
    await startSession("g", { user: WORKER as any });
    expect(publishAiAgentEvent).not.toHaveBeenCalled();
  });

  it("advance (via approvePlan) publishes 'advanced' with the sessionId", async () => {
    plan([{ kind: "write", tool: "write_thing", args: { id: 1 } }]);
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });
    const s = await startSession("g", { user: MANAGER as any });
    publishAiAgentEvent.mockClear();
    await approvePlan(s.sessionId!, { user: MANAGER as any });
    expect(publishAiAgentEvent).toHaveBeenCalledWith("advanced", s.sessionId);
  });

  it("confirmStep publishes 'confirmed' (plus the inner advance's 'advanced')", async () => {
    plan([
      { kind: "write", tool: "write_thing", args: { id: 1 } },
      { kind: "read", tool: "read_thing", args: {} },
    ]);
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });
    confirmAction.mockResolvedValue({ ok: true, status: "executed", result: {} });
    const s = await startSession("g", { user: MANAGER as any });
    await approvePlan(s.sessionId!, { user: MANAGER as any });
    publishAiAgentEvent.mockClear();
    await confirmStep(s.sessionId!, "ACT1", "ACT1", { user: MANAGER as any });
    expect(publishAiAgentEvent).toHaveBeenCalledWith("confirmed", s.sessionId);
    expect(publishAiAgentEvent).toHaveBeenCalledWith("advanced", s.sessionId);
  });

  it("cancelSession publishes 'cancelled'", async () => {
    plan([{ kind: "write", tool: "write_thing", args: { id: 1 } }]);
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });
    const s = await startSession("g", { user: MANAGER as any });
    await approvePlan(s.sessionId!, { user: MANAGER as any });
    publishAiAgentEvent.mockClear();
    await cancelSession(s.sessionId!, { user: MANAGER as any });
    expect(publishAiAgentEvent).toHaveBeenCalledWith("cancelled", s.sessionId);
  });

  it("a THROWING publishAiAgentEvent never breaks the choke point (advance still returns normally)", async () => {
    plan([{ kind: "read", tool: "read_thing", args: {} }]);
    publishAiAgentEvent.mockImplementation(() => {
      throw new Error("nudge boom");
    });
    const s = await startSession("g", { user: MANAGER as any });
    expect(s.enabled).toBe(true);
    expect(s.status).toBe("awaiting_approval");
    const res = await approvePlan(s.sessionId!, { user: MANAGER as any });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("done");
  });

  // ── FIX (E2-4 review, Important) — nudge only on a REAL state change. ──
  // confirmStep/cancelSession/advance are protectedProcedure (ANY authenticated
  // user); before this fix a low-privilege user could loop garbage/foreign
  // sessionIds and force a broadcast to every Command Center viewer even though
  // nothing ever changed. Every no-op guard below must nudge NOTHING.
  describe("nudge gating — no-op paths must NOT publish", () => {
    it("advance() on a NOT-FOUND sessionId does not nudge", async () => {
      const res = await advance("does-not-exist", { user: MANAGER as any });
      expect(res.ok).toBe(false);
      expect(res.status).toBe("failed");
      expect(publishAiAgentEvent).not.toHaveBeenCalled();
    });

    it("advance() on ANOTHER user's session (wrong owner) does not nudge", async () => {
      plan([{ kind: "read", tool: "read_thing", args: {} }]);
      const s = await startSession("g", { user: MANAGER as any });
      publishAiAgentEvent.mockClear();
      const res = await advance(s.sessionId!, { user: WORKER as any });
      expect(res.ok).toBe(false);
      expect(publishAiAgentEvent).not.toHaveBeenCalled();
    });

    it("advance() on a session that is NOT `running` (e.g. still awaiting_approval) does not nudge", async () => {
      plan([{ kind: "read", tool: "read_thing", args: {} }]);
      const s = await startSession("g", { user: MANAGER as any });
      publishAiAgentEvent.mockClear();
      const res = await advance(s.sessionId!, { user: MANAGER as any });
      expect(res.ok).toBe(false);
      expect(res.status).toBe("awaiting_approval");
      expect(publishAiAgentEvent).not.toHaveBeenCalled();
    });

    it("confirmStep() on a NOT-FOUND sessionId does not nudge", async () => {
      const res = await confirmStep("does-not-exist", "ACT1", "ACT1", { user: MANAGER as any });
      expect(res.ok).toBe(false);
      expect(publishAiAgentEvent).not.toHaveBeenCalled();
    });

    it("confirmStep() on a session that is NOT awaiting_confirm does not nudge", async () => {
      // read-only plan runs straight through to `done` — never parks awaiting_confirm.
      plan([{ kind: "read", tool: "read_thing", args: {} }]);
      const s = await startSession("g", { user: MANAGER as any });
      await approvePlan(s.sessionId!, { user: MANAGER as any });
      publishAiAgentEvent.mockClear();
      const res = await confirmStep(s.sessionId!, "ACT1", "ACT1", { user: MANAGER as any });
      expect(res.ok).toBe(false);
      expect(res.status).toBe("done");
      expect(publishAiAgentEvent).not.toHaveBeenCalled();
    });

    it("confirmStep() with a MISMATCHED actionId (session IS awaiting_confirm) does not nudge", async () => {
      plan([{ kind: "write", tool: "write_thing", args: { id: 1 } }]);
      proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });
      const s = await startSession("g", { user: MANAGER as any });
      await approvePlan(s.sessionId!, { user: MANAGER as any });
      publishAiAgentEvent.mockClear();
      const res = await confirmStep(s.sessionId!, "SOME-OTHER-ACTION-ID", "tok", { user: MANAGER as any });
      expect(res.ok).toBe(false);
      expect(confirmAction).not.toHaveBeenCalled();
      expect(publishAiAgentEvent).not.toHaveBeenCalled();
    });

    it("cancelSession() on a NOT-FOUND sessionId does not nudge", async () => {
      const res = await cancelSession("does-not-exist", { user: MANAGER as any });
      expect(res.ok).toBe(false);
      expect(publishAiAgentEvent).not.toHaveBeenCalled();
    });

    it("cancelSession() on an ALREADY-TERMINAL session (double cancel) does not nudge the 2nd time", async () => {
      plan([{ kind: "write", tool: "write_thing", args: { id: 1 } }]);
      proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });
      const s = await startSession("g", { user: MANAGER as any });
      await approvePlan(s.sessionId!, { user: MANAGER as any });
      const first = await cancelSession(s.sessionId!, { user: MANAGER as any });
      expect(first.ok).toBe(true);
      expect(publishAiAgentEvent).toHaveBeenCalledWith("cancelled", s.sessionId);
      publishAiAgentEvent.mockClear();
      const second = await cancelSession(s.sessionId!, { user: MANAGER as any });
      expect(second.ok).toBe(false);
      expect(second.status).toBe("aborted");
      expect(publishAiAgentEvent).not.toHaveBeenCalled();
    });
  });
});
