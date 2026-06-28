/**
 * AI RCA Copilot tests.
 *
 * SAFETY INVARIANTS proven here:
 *  - rankAndValidateHypotheses (PURE): orders by confidence desc, clamps to [0,1],
 *    drops below-min hypotheses, caps at top N.
 *  - A WRITE fix is kept (oneTap=true) ONLY when the tool EXISTS, is a write-tool,
 *    and args pass the tool's zod schema. A fabricated tool / out-of-bounds args
 *    is DOWNGRADED to MANUAL (if steps) or INVESTIGATE — never a fake WRITE.
 *  - runRca is FAIL-SAFE (never throws) and FLAG-GATED: default OFF → ok:false,
 *    no hypotheses, needsHumanInvestigation, note=AI_RCA_COPILOT_DISABLED.
 *
 * The pure helper needs no mocks; the flag tests call runRca directly.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { z } from "zod";

// Keep the "flag ON" fail-safe test a fast UNIT test: stub the heavy evidence
// sources so we never load a real model or DB. Each returns empty/throws so the
// pipeline must honestly degrade (no meaningful evidence → needs investigation).
vi.mock("./db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("./paretoAnalysisService", () => ({ paretoByDefectType: vi.fn(async () => ({ items: [] })) }));
vi.mock("./aiInspectionAnalytics", () => ({ getControlChart: vi.fn(async () => ({ summary: { cpk: null, outOfControlCount: 0, spcViolations: [] } })) }));
vi.mock("./aiAnomalyDetection", () => ({ getAnomalyStats: vi.fn(async () => null) }));
vi.mock("./aiLocalKnowledgeService", () => ({ retrieveKnowledge: vi.fn(async () => ({ citations: [] })) }));
vi.mock("./aiCausalGraph", () => ({ hybridDefectContext: vi.fn(async () => ({ causal: { defect: null, machine: null, causes: [] }, causalText: "", kbHits: [] })) }));

import { rankAndValidateHypotheses, runRca } from "./aiRcaCopilot";
import type { Tool } from "./aiLocalTools/toolRegistry";

// A fake write-tool whose args must be { machineId>0, value 0..100 }.
const fakeWriteTool: Tool<any, any> = {
  name: "fake_write",
  description: "test",
  kind: "write",
  requiredPermission: { module: "x", action: "canEdit" },
  parameters: z.object({ machineId: z.number().int().positive(), value: z.number().min(0).max(100) }).strict(),
  summarize: () => "fake",
  preview: async () => ({ entityType: "x", changes: [], warnings: [], humanSummary: "fake" }),
  execute: async () => ({ type: "action_result", title: "ok", data: {}, textSummary: "ok" }),
  triggers: [],
};
const lookup = (name: string) => (name === "fake_write" ? fakeWriteTool : undefined);

describe("rankAndValidateHypotheses — ranking", () => {
  it("orders by confidence descending and caps at top 3", () => {
    const raw = [
      { cause: "C-low", confidence: 0.3, evidence: [], recommendedFix: { kind: "INVESTIGATE", rationale: "r" } },
      { cause: "C-high", confidence: 0.9, evidence: [], recommendedFix: { kind: "INVESTIGATE", rationale: "r" } },
      { cause: "C-mid", confidence: 0.6, evidence: [], recommendedFix: { kind: "INVESTIGATE", rationale: "r" } },
      { cause: "C-x", confidence: 0.5, evidence: [], recommendedFix: { kind: "INVESTIGATE", rationale: "r" } },
    ];
    const out = rankAndValidateHypotheses(raw, { lookupTool: lookup, minConfidence: 0 });
    expect(out.map((h) => h.cause)).toEqual(["C-high", "C-mid", "C-x"]);
    expect(out.length).toBe(3);
  });

  it("clamps confidence to [0,1] and drops below-min", () => {
    const raw = [
      { cause: "over", confidence: 1.7, evidence: [], recommendedFix: { kind: "MANUAL", rationale: "r" } },
      { cause: "weak", confidence: 0.05, evidence: [], recommendedFix: { kind: "MANUAL", rationale: "r" } },
      { cause: "neg", confidence: -2, evidence: [], recommendedFix: { kind: "MANUAL", rationale: "r" } },
    ];
    const out = rankAndValidateHypotheses(raw, { lookupTool: lookup, minConfidence: 0.2 });
    expect(out.length).toBe(1);
    expect(out[0].cause).toBe("over");
    expect(out[0].confidence).toBe(1); // clamped
  });

  it("skips entries with no cause", () => {
    const raw = [{ cause: "", confidence: 0.9, evidence: [], recommendedFix: { kind: "MANUAL", rationale: "r" } }];
    expect(rankAndValidateHypotheses(raw as any, { lookupTool: lookup, minConfidence: 0 })).toHaveLength(0);
  });
});

describe("rankAndValidateHypotheses — WRITE fix validation (no fabrication)", () => {
  it("keeps a valid WRITE fix (in-bounds args, known tool) as oneTap", () => {
    const raw = [{
      cause: "kem hàn dư", confidence: 0.86, evidence: ["pareto", "cpk"],
      recommendedFix: { kind: "WRITE", tool: "fake_write", args: { machineId: 5, value: 4 }, rationale: "tighten" },
    }];
    const out = rankAndValidateHypotheses(raw, { lookupTool: lookup, minConfidence: 0 });
    expect(out[0].recommendedFix.kind).toBe("WRITE");
    expect(out[0].recommendedFix.oneTap).toBe(true);
    expect(out[0].recommendedFix.tool).toBe("fake_write");
    expect(out[0].recommendedFix.args).toEqual({ machineId: 5, value: 4 });
  });

  it("DOWNGRADES out-of-bounds WRITE args to INVESTIGATE (never a fake WRITE)", () => {
    const raw = [{
      cause: "x", confidence: 0.8, evidence: [],
      recommendedFix: { kind: "WRITE", tool: "fake_write", args: { machineId: 5, value: 999 }, rationale: "r" },
    }];
    const out = rankAndValidateHypotheses(raw, { lookupTool: lookup, minConfidence: 0 });
    expect(out[0].recommendedFix.kind).toBe("INVESTIGATE");
    expect(out[0].recommendedFix.oneTap).toBe(false);
  });

  it("DOWNGRADES out-of-bounds WRITE to MANUAL when steps are present", () => {
    const raw = [{
      cause: "x", confidence: 0.8, evidence: [],
      recommendedFix: { kind: "WRITE", tool: "fake_write", args: { value: 999 }, steps: ["do A", "do B"], rationale: "r" },
    }];
    const out = rankAndValidateHypotheses(raw, { lookupTool: lookup, minConfidence: 0 });
    expect(out[0].recommendedFix.kind).toBe("MANUAL");
    expect(out[0].recommendedFix.oneTap).toBe(false);
    expect(out[0].recommendedFix.steps).toEqual(["do A", "do B"]);
  });

  it("DOWNGRADES WRITE referencing an UNKNOWN tool (fabricated) — not oneTap", () => {
    const raw = [{
      cause: "x", confidence: 0.8, evidence: [],
      recommendedFix: { kind: "WRITE", tool: "totally_made_up_tool", args: { foo: 1 }, rationale: "r" },
    }];
    const out = rankAndValidateHypotheses(raw, { lookupTool: lookup, minConfidence: 0 });
    expect(out[0].recommendedFix.kind).toBe("INVESTIGATE");
    expect(out[0].recommendedFix.oneTap).toBe(false);
  });
});

describe("runRca — flag gate + fail-safe", () => {
  const prev = process.env.AI_RCA_COPILOT_ENABLED;
  afterAll(() => { process.env.AI_RCA_COPILOT_ENABLED = prev; });

  it("flag OFF (default) → no-op: ok:false, no hypotheses, needs investigation", async () => {
    delete process.env.AI_RCA_COPILOT_ENABLED;
    const r = await runRca({ machineId: 5, defectType: "chân chì" });
    expect(r.ok).toBe(false);
    expect(r.hypotheses).toHaveLength(0);
    expect(r.needsHumanInvestigation).toBe(true);
    expect(r.note).toBe("AI_RCA_COPILOT_DISABLED");
  });

  it("never throws; flag ON with no DB → degrades to 'need investigation'", async () => {
    process.env.AI_RCA_COPILOT_ENABLED = "true";
    // No DB / no model wired in this unit context → all evidence sources reject
    // (fail-safe) → insufficient evidence → honest degrade, NOT a throw.
    const r = await runRca({ machineId: 999, defectType: "no-data-defect" });
    expect(r.ok).toBe(true);
    expect(r.needsHumanInvestigation).toBe(true);
    expect(r.hypotheses).toHaveLength(0);
  });
});
