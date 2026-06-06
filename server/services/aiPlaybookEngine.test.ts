/**
 * Sprint G2.3b — Playbook engine tests.
 *
 * SAFETY INVARIANTS proven here (mirror the orchestrator):
 *  - startPlaybook GATES requiredPermission FIRST; denied ⇒ no session row, no run.
 *  - A `tool` playbook step maps to a write step → proposeAction (HITL); the
 *    engine NEVER calls tool.execute() and NEVER auto-confirms.
 *  - navigate/prefill steps map to client directives and do NOT call any DB
 *    mutation (the write path proposeAction/confirmAction is asserted untouched
 *    for those steps).
 *  - argsTemplate is interpolated from the runtime context.
 *  - branch steps are deterministic (advanced past, recorded skipped).
 *  - The engine source NEVER imports commandDispatcher and NEVER calls .execute().
 *
 * getDb, the HITL action service, checkPermission, and the playbook loader are
 * all mocked — no model and no real DB required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake in-memory ai_agent_sessions store + drizzle-like builder (same as orchestrator test). ──
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

// ── Mock the HITL action service (the ONLY write path; engine must never bypass it). ──
const proposeAction = vi.fn();
const confirmAction = vi.fn();
const cancelAction = vi.fn(async () => ({ ok: true, status: "cancelled" }));
vi.mock("./aiCopilotActions", () => ({
  proposeAction: (...a: unknown[]) => proposeAction(...a),
  confirmAction: (...a: unknown[]) => confirmAction(...a),
  cancelAction: (...a: unknown[]) => cancelAction(...a),
}));

// ── Mock checkPermission (RBAC gate). ──
const checkPermission = vi.fn(async () => true);
vi.mock("../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermission(...a),
}));

// ── Mock the tool registry: a write tool + the two client tools. ──
const writeExecute = vi.fn(async () => ({}));
const navBuild = vi.fn(() => ({ action: "navigate", route: "/datasettings", message: "go" }));
const prefillBuild = vi.fn(() => ({ action: "prefill_form", route: "/datasettings", values: {}, message: "fill" }));
const tools: Record<string, any> = {
  set_spec_limits: {
    name: "set_spec_limits", kind: "write", parameters: {}, triggers: [],
    requiredPermission: { module: "settings_measurement_points", action: "canEdit" },
    summarize: () => "w", preview: async () => ({}), execute: writeExecute,
  },
  navigate: { name: "navigate", kind: "client", parameters: {}, triggers: [], buildClientAction: navBuild },
  prefill_form: { name: "prefill_form", kind: "client", parameters: {}, triggers: [], buildClientAction: prefillBuild },
};
vi.mock("./aiLocalTools/toolRegistry", () => ({
  getTool: (name: string) => tools[name],
  isWriteTool: (t: any) => !!t && t.kind === "write",
  isClientTool: (t: any) => !!t && t.kind === "client",
}));

// ── Mock the playbook loader: deterministic playbooks. ──
const getPlaybookById = vi.fn();
const getPlaybooks = vi.fn(() => [] as any[]);
vi.mock("./aiPlaybookLoader", () => ({
  getPlaybookById: (...a: unknown[]) => getPlaybookById(...a),
  getPlaybooks: (...a: unknown[]) => getPlaybooks(...a),
}));

import { startPlaybook, listPlaybooks, interpolateTemplate, buildPlanFromPlaybook } from "./aiPlaybookEngine";
import { approvePlan } from "./aiAgentOrchestrator";

const L = (s: string) => ({ vi: s, en: s, zh: s });
const MANAGER = { id: 10, role: "manager", name: "M" } as const;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  process.env.AI_AGENTIC_ENABLED = "1";
  process.env.AGENT_MAX_WRITES_PER_SESSION = "3";
  checkPermission.mockResolvedValue(true);
  navBuild.mockReturnValue({ action: "navigate", route: "/datasettings", message: "go" });
  prefillBuild.mockReturnValue({ action: "prefill_form", route: "/datasettings", values: {}, message: "fill" });
});

describe("interpolateTemplate", () => {
  it("replaces {{key}} with the context value, preserving type, dropping unresolved keys", () => {
    const out = interpolateTemplate(
      { id: "{{measurementPointDefId}}", usl: "{{usl}}", lit: "fixed", missing: "{{nope}}" },
      { measurementPointDefId: 42, usl: 1.5 },
    );
    expect(out).toEqual({ id: 42, usl: 1.5, lit: "fixed" });
  });
});

describe("buildPlanFromPlaybook step mapping", () => {
  it("maps tool→write, navigate→navigate, prefill→prefill, branch→branch, guidance/confirm→guidance", () => {
    const pb = {
      id: "m", title: L("t"),
      steps: [
        { type: "guidance", text: L("g") },
        { type: "navigate", route: "/datasettings", text: L("n") },
        { type: "prefill", route: "/datasettings", valuesTemplate: { code: "{{code}}" }, text: L("p") },
        { type: "tool", tool: "set_spec_limits", argsTemplate: { measurementPointDefId: "{{id}}" }, text: L("w") },
        { type: "confirm", text: L("c") },
        { type: "branch", branch: [{ key: "a", text: L("A") }], text: L("b") },
      ],
    };
    const plan = buildPlanFromPlaybook(pb as any, "vi", { code: "C1", id: 7 });
    expect(plan.steps.map((s) => s.kind)).toEqual(["guidance", "navigate", "prefill", "write", "guidance", "branch"]);
    expect(plan.steps[2].args).toEqual({ route: "/datasettings", values: { code: "C1" } });
    expect(plan.steps[3].args).toEqual({ measurementPointDefId: 7 });
    expect(plan.steps[3].tool).toBe("set_spec_limits");
  });
});

describe("startPlaybook — RBAC gate", () => {
  it("denied permission ⇒ no session row, no run", async () => {
    getPlaybookById.mockReturnValue({
      id: "pb", title: L("t"),
      requiredPermission: { module: "settings_measurement_points", action: "canEdit" },
      steps: [{ type: "tool", tool: "set_spec_limits", argsTemplate: {}, text: L("w") }],
    });
    checkPermission.mockResolvedValue(false);

    const res = await startPlaybook("pb", { user: MANAGER as any, lang: "vi" });

    expect(res.ok).toBe(false);
    expect(res.sessionId).toBeUndefined();
    expect(store.size).toBe(0);
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it("unknown playbook id ⇒ not ok, no row", async () => {
    getPlaybookById.mockReturnValue(undefined);
    const res = await startPlaybook("nope", { user: MANAGER as any });
    expect(res.ok).toBe(false);
    expect(store.size).toBe(0);
  });

  it("allowed ⇒ parks at awaiting_approval with playbookId set", async () => {
    getPlaybookById.mockReturnValue({
      id: "pb", title: L("t"),
      requiredPermission: { module: "settings_measurement_points", action: "canEdit" },
      steps: [{ type: "guidance", text: L("g") }],
    });
    const res = await startPlaybook("pb", { user: MANAGER as any });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("awaiting_approval");
    const row = store.get(res.sessionId!)!;
    expect(row.playbookId).toBe("pb");
    expect(row.status).toBe("awaiting_approval");
  });
});

describe("startPlaybook + advance — tool step goes through HITL (no execute)", () => {
  it("a tool step proposes (HITL) and STOPS; execute/confirm are NOT called", async () => {
    getPlaybookById.mockReturnValue({
      id: "pb", title: L("t"),
      requiredPermission: { module: "settings_measurement_points", action: "canEdit" },
      steps: [
        { type: "guidance", text: L("g") },
        { type: "tool", tool: "set_spec_limits", argsTemplate: { measurementPointDefId: "{{id}}" }, text: L("w") },
      ],
    });
    proposeAction.mockResolvedValue({ ok: true, pendingAction: { actionId: "ACT1", token: "ACT1" } });

    const s = await startPlaybook("pb", { user: MANAGER as any, context: { id: 99 } });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.status).toBe("awaiting_confirm");
    expect(adv.pendingActionId).toBe("ACT1");
    expect(proposeAction).toHaveBeenCalledTimes(1);
    // interpolated args reached proposeAction
    expect(proposeAction.mock.calls[0][1]).toEqual({ measurementPointDefId: 99 });
    expect(confirmAction).not.toHaveBeenCalled();    // never auto-confirms
    expect(writeExecute).not.toHaveBeenCalled();      // engine never executes
  });
});

describe("startPlaybook + advance — navigate/prefill do NOT touch the write path", () => {
  it("navigate + prefill steps run as client directives; proposeAction/confirmAction never called", async () => {
    getPlaybookById.mockReturnValue({
      id: "pb", title: L("t"),
      steps: [
        { type: "navigate", route: "/datasettings", text: L("n") },
        { type: "prefill", route: "/datasettings", valuesTemplate: { code: "{{code}}" }, text: L("p") },
      ],
    });

    const s = await startPlaybook("pb", { user: MANAGER as any, context: { code: "C1" } });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.status).toBe("done"); // both client steps ran, plan complete
    expect(navBuild).toHaveBeenCalledTimes(1);
    expect(prefillBuild).toHaveBeenCalledTimes(1);
    expect(proposeAction).not.toHaveBeenCalled(); // no DB write path for client steps
    expect(confirmAction).not.toHaveBeenCalled();
    expect(writeExecute).not.toHaveBeenCalled();
    const row = store.get(s.sessionId!)!;
    expect(row.status).toBe("done");
  });
});

describe("branch is deterministic", () => {
  it("a branch step is advanced past (recorded skipped) without proposing", async () => {
    getPlaybookById.mockReturnValue({
      id: "pb", title: L("t"),
      steps: [
        { type: "branch", branch: [{ key: "a", text: L("A") }, { key: "b", text: L("B") }], text: L("br") },
        { type: "guidance", text: L("g") },
      ],
    });

    const s = await startPlaybook("pb", { user: MANAGER as any });
    const adv = await approvePlan(s.sessionId!, { user: MANAGER as any });

    expect(adv.status).toBe("done");
    expect(proposeAction).not.toHaveBeenCalled();
    const row = store.get(s.sessionId!)!;
    expect(row.stepResults.find((r: any) => r.kind === "branch")?.status).toBe("skipped");
  });
});

describe("listPlaybooks — permission filter", () => {
  it("filters out playbooks whose requiredPermission the user lacks", async () => {
    getPlaybooks.mockReturnValue([
      { id: "open", title: L("o"), steps: [{ type: "guidance", text: L("g") }] },
      { id: "gated", title: L("g"), requiredPermission: { module: "settings_machines", action: "canCreate" }, steps: [{ type: "guidance", text: L("g") }] },
    ]);
    // open: no perm → kept; gated: checkPermission false → dropped
    checkPermission.mockResolvedValue(false);

    const list = await listPlaybooks(MANAGER as any);
    expect(list.map((p) => p.id)).toEqual(["open"]);
  });
});

describe("SAFETY INVARIANT — engine source", () => {
  it("aiPlaybookEngine.ts NEVER imports commandDispatcher and NEVER calls .execute()", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = fileURLToPath(new URL("./aiPlaybookEngine.ts", import.meta.url));
    const src = readFileSync(path, "utf8");
    const code = src.replace(/^\/\*\*[\s\S]*?\*\//, ""); // strip leading doc block
    expect(/from\s+["'][^"']*commandDispatcher/.test(code)).toBe(false);
    expect(/import\(["'][^"']*commandDispatcher/.test(code)).toBe(false);
    expect(/\.execute\s*\(/.test(code)).toBe(false);
  });
});
