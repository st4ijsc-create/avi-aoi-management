/**
 * Doc 24 Wave-2 P3 — richer IR block vocabulary tests (PURE / in-memory only).
 *
 * Covers the NEW blocks + the safe expression model, WITHOUT touching the existing D1
 * goldens (asserted separately in ir.d1.test.ts — those must stay byte-identical, which we
 * also re-assert here as a backward-compat guard):
 *   • Expression model (irExpr): parse round-trip, free-var collection, fail-closed eval,
 *     deterministic render — and NO eval / Function anywhere.
 *   • Schema round-trip for each new block (set_variable, counter, wait_until, set_analog,
 *     pid_control) + expression-valued set_output / wait.
 *   • Linter: undefined-variable use (error), counter-increment-before-declare (error),
 *     out-of-range PID gains (error), pid output bounds (error), wait_until timeout ceiling.
 *   • Transpile golden output (URScript + ROS2) for a flow exercising every new block, and
 *     the lint HARD-GATE (a bad-PID flow yields no code).
 *   • Existing SAMPLE_FLOW goldens remain byte-identical (backward-compat).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlow, assignIds, countBlocks, walkBlocks, type Flow } from "./irModel";
import {
  exprSchema, exprFreeVars, slotFreeVars, evalExpr, renderExpr, isExpr, type Expr,
} from "./irExpr";
import { lintFlow } from "./irSafetyLinter";
import { transpileFlow } from "./transpilers/registry";
import { transpileToUrscript } from "./transpilers/irToUrscript";
import { transpileToRos2 } from "./transpilers/irToRos2";
import { SAMPLE_FLOW } from "./__fixtures__/sampleFlow";

const FIX = join(__dirname, "__fixtures__");

// ── A flow exercising every P3 block, kept lint-clean under the default ceilings ──
function p3Flow(): Flow {
  return {
    flow_id: "p3_demo",
    target_device_type: "universal-robots",
    version: 1,
    blocks: [
      { id: "b1", type: "counter", name: "cycles", op: "reset", amount: 0 },
      { id: "b2", type: "set_variable", name: "target", expr: { kind: "lit", value: 5 } },
      // expression referencing a prior variable (add)
      { id: "b3", type: "set_analog", channel: "AO1", value: { kind: "binop", op: "add", left: { kind: "var", name: "target" }, right: { kind: "lit", value: 1 } }, unit: "V" },
      { id: "b4", type: "counter", name: "cycles", op: "increment", amount: 1 },
      // wait duration from an expression
      { id: "b5", type: "wait", ms: { kind: "binop", op: "mul", left: { kind: "var", name: "target" }, right: { kind: "lit", value: 100 } } },
      { id: "b6", type: "wait_until", condition: { kind: "binop", op: "gte", left: { kind: "var", name: "cycles" }, right: { kind: "var", name: "target" } }, timeout_ms: 5000, poll_ms: 100 },
      // set_output with a boolean-expression value
      { id: "b7", type: "set_output", signal: "DO2", value: { kind: "binop", op: "gt", left: { kind: "var", name: "cycles" }, right: { kind: "lit", value: 0 } } },
      { id: "b8", type: "pid_control", output_channel: "AO2", input_channel: "AI1", setpoint: { kind: "var", name: "target" }, kp: 2, ki: 0.5, kd: 0.1, output_min: 0, output_max: 10 },
    ],
  };
}

describe("P3 expression model (irExpr) — safe, no eval", () => {
  it("round-trips through the Zod schema", () => {
    const e: Expr = { kind: "binop", op: "add", left: { kind: "var", name: "x" }, right: { kind: "lit", value: 2 } };
    const parsed = exprSchema.parse(e);
    expect(parsed).toEqual(e);
  });

  it("rejects an out-of-whitelist operator (shape error, before any codegen)", () => {
    const bad = { kind: "binop", op: "pow", left: { kind: "lit", value: 2 }, right: { kind: "lit", value: 3 } };
    expect(exprSchema.safeParse(bad).success).toBe(false);
  });

  it("collects free variables from an expression tree", () => {
    const e: Expr = { kind: "binop", op: "and", left: { kind: "var", name: "a" }, right: { kind: "binop", op: "gt", left: { kind: "var", name: "b" }, right: { kind: "lit", value: 1 } } };
    expect(exprFreeVars(e).sort()).toEqual(["a", "b"]);
    // slotFreeVars: a bare literal slot has none.
    expect(slotFreeVars(3)).toEqual([]);
    expect(slotFreeVars(e).sort()).toEqual(["a", "b"]);
  });

  it("evaluates fail-closed: unknown var → 0, div-by-zero → 0, never throws", () => {
    expect(evalExpr({ kind: "var", name: "nope" })).toBe(0);
    expect(evalExpr({ kind: "binop", op: "div", left: { kind: "lit", value: 1 }, right: { kind: "lit", value: 0 } })).toBe(0);
    expect(evalExpr({ kind: "binop", op: "add", left: { kind: "lit", value: 2 }, right: { kind: "lit", value: 3 } }, {})).toBe(5);
    expect(evalExpr({ kind: "binop", op: "gt", left: { kind: "var", name: "x" }, right: { kind: "lit", value: 0 } }, { x: 4 })).toBe(true);
  });

  it("renders deterministically to a fully-parenthesised infix string", () => {
    const e: Expr = { kind: "binop", op: "mul", left: { kind: "var", name: "target" }, right: { kind: "lit", value: 100 } };
    const fmt = (n: number) => Number(n.toFixed(6)).toString();
    expect(renderExpr(e, fmt)).toBe("(target * 100)");
  });

  it("SOURCE contains no eval / Function constructor (safety invariant)", () => {
    const src = readFileSync(join(__dirname, "irExpr.ts"), "utf8");
    expect(src).not.toMatch(/\beval\s*\(/);
    expect(src).not.toMatch(/new\s+Function\b/);
  });

  it("isExpr type guard distinguishes literals from expr nodes", () => {
    expect(isExpr(3)).toBe(false);
    expect(isExpr(true)).toBe(false);
    expect(isExpr({ kind: "lit", value: 1 })).toBe(true);
  });
});

describe("P3 schema round-trip (parseFlow)", () => {
  it("parses a flow with every new block type", () => {
    const res = parseFlow(p3Flow());
    expect(res.ok).toBe(true);
    if (res.ok) {
      const types = new Set<string>();
      walkBlocks(res.flow.blocks, (b) => types.add(b.type));
      for (const t of ["set_variable", "counter", "wait_until", "set_analog", "pid_control"]) {
        expect(types.has(t)).toBe(true);
      }
    }
  });

  it("applies schema defaults (counter.amount, wait_until.poll_ms)", () => {
    const res = parseFlow({
      flow_id: "d", target_device_type: "generic",
      blocks: [
        { type: "counter", name: "c", op: "reset" },
        { type: "wait_until", condition: { kind: "lit", value: true }, timeout_ms: 1000 },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.flow.blocks[0] as { amount: number }).amount).toBe(1);
      expect((res.flow.blocks[1] as { poll_ms: number }).poll_ms).toBe(50);
    }
  });

  it("rejects pid_control with output_min >= output_max (refine)", () => {
    const res = parseFlow({
      flow_id: "d", target_device_type: "generic",
      blocks: [{ type: "pid_control", output_channel: "o", input_channel: "i", setpoint: 0, kp: 1, ki: 0, kd: 0, output_min: 10, output_max: 5 }],
    });
    expect(res.ok).toBe(false);
  });
});

describe("P3 semantic linter", () => {
  it("passes the demo flow (all vars declared before use, sane PID)", () => {
    const r = lintFlow(p3Flow());
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it("flags UNDEFINED-VARIABLE use as an error", () => {
    const flow: Flow = {
      flow_id: "u", target_device_type: "generic", version: 1,
      blocks: [{ id: "x", type: "set_analog", channel: "AO1", value: { kind: "var", name: "ghost" } }],
    };
    const r = lintFlow(flow);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.rule === "undefined-variable")).toBe(true);
  });

  it("flags counter INCREMENT-BEFORE-DECLARE as an error", () => {
    const flow: Flow = {
      flow_id: "c", target_device_type: "generic", version: 1,
      blocks: [{ id: "x", type: "counter", name: "n", op: "increment", amount: 1 }],
    };
    const r = lintFlow(flow);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.rule === "undefined-variable")).toBe(true);
  });

  it("accepts counter increment AFTER a reset (declares the handle)", () => {
    const flow: Flow = {
      flow_id: "c", target_device_type: "generic", version: 1,
      blocks: [
        { id: "a", type: "counter", name: "n", op: "reset", amount: 0 },
        { id: "b", type: "counter", name: "n", op: "increment", amount: 1 },
      ],
    };
    expect(lintFlow(flow).ok).toBe(true);
  });

  it("flags OUT-OF-RANGE PID gains (negative + over ceiling) as errors", () => {
    const negative: Flow = {
      flow_id: "p", target_device_type: "generic", version: 1,
      blocks: [{ id: "x", type: "pid_control", output_channel: "o", input_channel: "i", setpoint: 0, kp: -1, ki: 0, kd: 0, output_min: 0, output_max: 10 }],
    };
    const rNeg = lintFlow(negative);
    expect(rNeg.ok).toBe(false);
    expect(rNeg.diagnostics.some((d) => d.rule === "pid-gain")).toBe(true);

    const huge: Flow = {
      flow_id: "p", target_device_type: "generic", version: 1,
      blocks: [{ id: "x", type: "pid_control", output_channel: "o", input_channel: "i", setpoint: 0, kp: 999999, ki: 0, kd: 0, output_min: 0, output_max: 10 }],
    };
    const rHuge = lintFlow(huge);
    expect(rHuge.ok).toBe(false);
    expect(rHuge.diagnostics.some((d) => d.rule === "pid-gain")).toBe(true);
    // an explicit override raises the ceiling → passes.
    expect(lintFlow(huge, { maxPidGain: 2_000_000 }).ok).toBe(true);
  });

  it("warns on all-zero PID gains (inert loop) but does not block", () => {
    const flow: Flow = {
      flow_id: "p", target_device_type: "generic", version: 1,
      blocks: [{ id: "x", type: "pid_control", output_channel: "o", input_channel: "i", setpoint: 0, kp: 0, ki: 0, kd: 0, output_min: 0, output_max: 10 }],
    };
    const r = lintFlow(flow);
    expect(r.ok).toBe(true);
    expect(r.diagnostics.some((d) => d.rule === "pid-inert" && d.severity === "warn")).toBe(true);
  });

  it("flags a wait_until timeout OVER the ceiling as an error", () => {
    const flow: Flow = {
      flow_id: "w", target_device_type: "generic", version: 1,
      blocks: [{ id: "x", type: "wait_until", condition: { kind: "lit", value: true }, timeout_ms: 10_000_000, poll_ms: 50 }],
    };
    const r = lintFlow(flow);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.rule === "wait-timeout")).toBe(true);
  });
});

describe("P3 transpile golden regression (URScript + ROS2)", () => {
  const goldenUr = readFileSync(join(FIX, "p3_demo.urscript.golden"), "utf8");
  const goldenRos = readFileSync(join(FIX, "p3_demo.ros2.golden"), "utf8");

  it("URScript matches the golden + carries provenance markers for new blocks", () => {
    const { code, irCommentMap } = transpileToUrscript(p3Flow());
    expect(code).toBe(goldenUr);
    expect(code).toContain("# [IR pid_control #b8]");
    expect(code).toContain("# [IR set_variable #b2]");
    expect(irCommentMap["# [IR pid_control #b8]"]).toBe("b8");
    expect(Object.keys(irCommentMap).length).toBe(countBlocks(p3Flow()));
  });

  it("ROS2 matches the golden + carries provenance markers", () => {
    const { code, irCommentMap } = transpileToRos2(p3Flow());
    expect(code).toBe(goldenRos);
    expect(code).toContain("self.pid_control(");
    expect(irCommentMap["# [IR set_analog #b3]"]).toBe("b3");
  });

  it("is deterministic across runs", () => {
    expect(transpileToUrscript(p3Flow()).code).toBe(transpileToUrscript(p3Flow()).code);
    expect(transpileToRos2(p3Flow()).code).toBe(transpileToRos2(p3Flow()).code);
  });

  it("HARD GATE: a bad-PID flow yields NO code", () => {
    const flow = p3Flow();
    (flow.blocks[7] as { kp: number }).kp = -50; // negative gain → lint error
    const r = transpileFlow(flow);
    expect(r.ok).toBe(false);
    expect(r.code).toBeUndefined();
    expect(r.diagnostics.some((d) => d.rule === "pid-gain")).toBe(true);
  });
});

describe("P3 backward-compat: existing D1 goldens unchanged", () => {
  const goldenUr = readFileSync(join(FIX, "pick_and_place.urscript.golden"), "utf8");
  const goldenRos = readFileSync(join(FIX, "pick_and_place.ros2.golden"), "utf8");

  it("SAMPLE_FLOW URScript is byte-identical to the D1 golden", () => {
    expect(transpileToUrscript(SAMPLE_FLOW).code).toBe(goldenUr);
  });
  it("SAMPLE_FLOW ROS2 is byte-identical to the D1 golden", () => {
    expect(transpileToRos2(SAMPLE_FLOW).code).toBe(goldenRos);
  });
  it("assignIds still numbers only the pre-P3 sample deterministically", () => {
    const ids: string[] = [];
    walkBlocks(assignIds(SAMPLE_FLOW).blocks, (b) => ids.push(b.id!));
    expect(ids[0]).toBe("b1");
  });
});
