/**
 * GĐ3b — AI Agent Planner tests.
 *
 * Verifies: valid plans pass schema + registry validation; steps naming an
 * unknown tool are dropped; steps with args that fail tool.parameters are
 * dropped; the plan is truncated to AGENT_MAX_STEPS; and when GGUF is
 * unavailable the planner returns an EMPTY plan (offline-safe fallback).
 *
 * The GGUF engine is mocked so no model is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// ── Mock the GGUF engine: isGgufAvailable + generateJSON are controllable. ──
const isGgufAvailable = vi.fn(async () => true);
const generateJSON = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
  generateJSON: (...a: unknown[]) => generateJSON(...a),
}));

import { registerTool, clearRegistry, type Tool } from "./aiLocalTools/toolRegistry";
import { planGoal, AGENT_MAX_STEPS } from "./aiAgentPlanner";

// Controlled fake tools (read + write + client) so validation is deterministic.
function registerFakeTools() {
  clearRegistry();
  registerTool({
    name: "read_thing",
    description: "read a thing",
    parameters: z.object({ days: z.number().int().min(1).max(30).default(7) }),
    triggers: [],
    kind: "read",
    handler: async () => ({ type: "today_stats", title: "t", data: {}, textSummary: "" }) as any,
  } as Tool<any, any>);
  registerTool({
    name: "write_thing",
    description: "write a thing",
    parameters: z.object({ id: z.number().int() }),
    triggers: [],
    kind: "write",
    requiredPermission: { module: "m", action: "canEdit" },
    summarize: () => "do write",
    preview: async () => ({ entityType: "thing", changes: [], warnings: [], humanSummary: "" }),
    execute: async () => ({ type: "action_result", title: "ok", data: {}, textSummary: "" }) as any,
  } as Tool<any, any>);
  registerTool({
    name: "navigate",
    description: "navigate",
    parameters: z.object({ route: z.string() }),
    triggers: [],
    kind: "client",
    buildClientAction: (p: any) => ({ action: "navigate", route: p.route, message: "go" }),
  } as Tool<any, any>);
}

function mockPlan(steps: unknown[], summary = "plan") {
  generateJSON.mockResolvedValue({ data: { summary, steps }, raw: "", tokensGenerated: 0, tokensPrompt: 0, totalTimeMs: 0, tokensPerSecond: 0, modelId: "m" });
}

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
  registerFakeTools();
});

describe("planGoal", () => {
  it("produces a valid plan that passes schema + registry validation", async () => {
    mockPlan([
      { kind: "read", tool: "read_thing", args: { days: 7 }, rationale: "r1" },
      { kind: "write", tool: "write_thing", args: { id: 5 }, rationale: "r2" },
      { kind: "navigate", tool: "navigate", args: { route: "/x" } },
      { kind: "guidance", rationale: "explain" },
    ]);
    const res = await planGoal("làm gì đó", { lang: "vi" });
    expect(res.available).toBe(true);
    expect(res.plan.steps).toHaveLength(4);
    expect(res.plan.steps[0]).toMatchObject({ kind: "read", tool: "read_thing", args: { days: 7 } });
    expect(res.plan.steps[1]).toMatchObject({ kind: "write", tool: "write_thing", args: { id: 5 } });
    expect(res.plan.steps[3]).toMatchObject({ kind: "guidance", tool: null });
  });

  it("drops steps naming an unknown tool", async () => {
    mockPlan([
      { kind: "read", tool: "does_not_exist", args: {} },
      { kind: "read", tool: "read_thing", args: { days: 3 } },
    ]);
    const res = await planGoal("mục tiêu test", { lang: "vi" });
    expect(res.plan.steps).toHaveLength(1);
    expect(res.plan.steps[0].tool).toBe("read_thing");
  });

  it("drops steps whose args fail tool.parameters", async () => {
    mockPlan([
      { kind: "write", tool: "write_thing", args: { id: "not-a-number" } }, // invalid
      { kind: "write", tool: "write_thing", args: { id: 9 } }, // valid
    ]);
    const res = await planGoal("mục tiêu test", { lang: "vi" });
    expect(res.plan.steps).toHaveLength(1);
    expect(res.plan.steps[0].args).toEqual({ id: 9 });
  });

  it("drops a step whose kind does not match the tool capability", async () => {
    // read kind pointing at a write tool → dropped.
    mockPlan([{ kind: "read", tool: "write_thing", args: { id: 1 } }]);
    const res = await planGoal("mục tiêu test", { lang: "vi" });
    expect(res.plan.steps).toHaveLength(0);
  });

  it("truncates the plan to AGENT_MAX_STEPS", async () => {
    const many = Array.from({ length: AGENT_MAX_STEPS + 4 }, () => ({ kind: "read", tool: "read_thing", args: { days: 7 } }));
    mockPlan(many);
    const res = await planGoal("mục tiêu test", { lang: "vi" });
    expect(res.plan.steps.length).toBe(AGENT_MAX_STEPS);
  });

  it("returns an EMPTY plan + message when GGUF is unavailable (offline fallback)", async () => {
    isGgufAvailable.mockResolvedValue(false);
    const res = await planGoal("mục tiêu test", { lang: "vi" });
    expect(res.available).toBe(false);
    expect(res.plan.steps).toHaveLength(0);
    expect(res.message).toBeTruthy();
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("degrades to an empty plan when inference throws (no crash)", async () => {
    generateJSON.mockRejectedValue(new Error("boom"));
    const res = await planGoal("mục tiêu test", { lang: "vi" });
    expect(res.available).toBe(true);
    expect(res.plan.steps).toHaveLength(0);
  });
});
