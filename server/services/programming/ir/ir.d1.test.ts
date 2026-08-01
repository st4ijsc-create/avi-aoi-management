/**
 * D1 (doc 16 §11.1 / Khối 6) — IR programming layer tests.  PURE / in-memory only.
 *
 * Covers:
 *   • IR shape validate (parseFlow + assignIds + walk).
 *   • Semantic safety linter: flags speed-over-limit, out-of-workspace, force-over-limit,
 *     bad grip timeout; passes a safe flow. Errors → ok:false (blocks transpile).
 *   • Transpile HARD GATE: a flow with a linter error yields no code.
 *   • URScript + ROS2 GOLDEN regression (incl. IR-comment presence + irCommentMap).
 *   • IR adapter validate/compile through the ProgrammingAdapter contract.
 *   • Flag-off no-op for the IR mutations (dpcIrV2Enabled false → guard throws).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  parseFlow,
  parseFlowJson,
  assignIds,
  countBlocks,
  walkBlocks,
  type Flow,
} from "./irModel";
import { lintFlow, resolveLimits } from "./irSafetyLinter";
import { transpileFlow, defaultTargetFor } from "./transpilers/registry";
import { transpileToUrscript } from "./transpilers/irToUrscript";
import { transpileToRos2 } from "./transpilers/irToRos2";
import { IrProgrammingAdapter, previewTranspile, summariseFlow } from "./irAdapter";
import { SAMPLE_FLOW } from "./__fixtures__/sampleFlow";

const FIX = join(__dirname, "__fixtures__");
const goldenUr = readFileSync(join(FIX, "pick_and_place.urscript.golden"), "utf8");
const goldenRos = readFileSync(join(FIX, "pick_and_place.ros2.golden"), "utf8");

/** A minimal safe single-move flow within default limits. */
function safeMoveFlow(): Flow {
  return {
    flow_id: "safe_move",
    target_device_type: "universal-robots",
    version: 1,
    blocks: [
      { type: "move_linear", target_pose: { x: 100, y: 100, z: 300, rx: 0, ry: 0, rz: 0 }, speed_mms: 100, acceleration: 1, blend_radius: 0 },
    ],
  };
}

describe("IR shape validation (irModel)", () => {
  it("parses a valid flow", () => {
    const res = parseFlow(SAMPLE_FLOW);
    expect(res.ok).toBe(true);
  });

  it("rejects a flow missing required fields", () => {
    const res = parseFlow({ flow_id: "x", blocks: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.length).toBeGreaterThan(0);
  });

  it("rejects a move_linear with a negative speed", () => {
    const res = parseFlow({
      flow_id: "x",
      target_device_type: "generic",
      blocks: [{ type: "move_linear", target_pose: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }, speed_mms: -5, acceleration: 1 }],
    });
    expect(res.ok).toBe(false);
  });

  it("assignIds fills missing ids deterministically and countBlocks counts nested", () => {
    const flow: Flow = {
      flow_id: "f", target_device_type: "generic", version: 1,
      blocks: [
        { type: "if_condition", signal_ref: "1", operator: "eq", value: true,
          true_branch: [{ type: "wait", ms: 10 }], false_branch: [] },
      ],
    };
    const withIds = assignIds(flow);
    const ids: string[] = [];
    walkBlocks(withIds.blocks, (b) => ids.push(b.id!));
    expect(ids).toEqual(["b1", "b2"]);
    expect(countBlocks(flow)).toBe(2);
  });

  it("parseFlowJson reports invalid JSON", () => {
    const res = parseFlowJson("{ not json");
    expect(res.ok).toBe(false);
  });
});

describe("semantic safety linter (irSafetyLinter)", () => {
  it("passes a safe flow (no errors → ok true)", () => {
    const r = lintFlow(safeMoveFlow());
    expect(r.ok).toBe(true);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("flags speed OVER the limit as an error (blocks transpile)", () => {
    const flow = safeMoveFlow();
    (flow.blocks[0] as any).speed_mms = 9999;
    const r = lintFlow(flow);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.rule === "speed-limit" && d.severity === "error")).toBe(true);
  });

  it("flags a pose OUTSIDE the workspace AABB as an error", () => {
    const flow = safeMoveFlow();
    (flow.blocks[0] as any).target_pose.x = 99999;
    const r = lintFlow(flow);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.rule === "workspace-bounds")).toBe(true);
  });

  it("flags grip force OVER the limit + an unbounded timeout", () => {
    const flow: Flow = {
      flow_id: "g", target_device_type: "generic", version: 1,
      blocks: [{ type: "grip", tool_id: "t", force_limit_n: 5000, timeout_ms: 0 }],
    };
    const r = lintFlow(flow);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.rule === "force-limit")).toBe(true);
    expect(r.diagnostics.some((d) => d.rule === "grip-timeout")).toBe(true);
  });

  it("respects an explicit limit override", () => {
    const flow = safeMoveFlow();
    (flow.blocks[0] as any).speed_mms = 300;
    expect(lintFlow(flow).ok).toBe(false); // > default 250
    expect(lintFlow(flow, { maxSpeedMms: 500 }).ok).toBe(true);
  });

  it("resolveLimits reads env tunables", () => {
    const prev = process.env.DPC_IR_MAX_SPEED_MMS;
    process.env.DPC_IR_MAX_SPEED_MMS = "42";
    expect(resolveLimits().maxSpeedMms).toBe(42);
    if (prev === undefined) delete process.env.DPC_IR_MAX_SPEED_MMS;
    else process.env.DPC_IR_MAX_SPEED_MMS = prev;
  });
});

describe("transpile hard gate (registry)", () => {
  it("blocks codegen when the linter reports an error (ok false, no code)", () => {
    const flow = safeMoveFlow();
    (flow.blocks[0] as any).speed_mms = 9999;
    const r = transpileFlow(flow);
    expect(r.ok).toBe(false);
    expect(r.code).toBeUndefined();
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("defaultTargetFor maps device types", () => {
    expect(defaultTargetFor("universal-robots")).toBe("urscript");
    expect(defaultTargetFor("ros2")).toBe("ros2");
  });
});

describe("transpiler golden regression", () => {
  it("URScript matches the golden and carries IR↔source comments", () => {
    const { code, irCommentMap } = transpileToUrscript(SAMPLE_FLOW);
    expect(code).toBe(goldenUr);
    expect(code).toContain("# [IR move_linear #b2]");
    expect(code).toContain("movel(");
    // every block id appears in the comment map
    expect(irCommentMap["# [IR move_linear #b2]"]).toBe("b2");
    expect(Object.keys(irCommentMap).length).toBe(countBlocks(SAMPLE_FLOW));
  });

  it("ROS2 matches the golden and carries IR↔source comments", () => {
    const { code, irCommentMap } = transpileToRos2(SAMPLE_FLOW);
    expect(code).toBe(goldenRos);
    expect(code).toContain("# [IR grip #b3]");
    // BOUND MoveIt program (Doc 24 Tier-2): real MoveGroupCommander motion + plan/execute.
    expect(code).toContain("import moveit_commander");
    expect(code).toContain("moveit_commander.MoveGroupCommander(PLANNING_GROUP)");
    expect(code).toContain("self.move_group.set_pose_target([");
    expect(code).toContain("self.move_group.set_joint_value_target([");
    expect(code).toContain("self.move_group.plan()");
    expect(code).toContain("self.move_group.execute(");
    expect(irCommentMap["# [IR grip #b3]"]).toBe("b3");
  });

  it("output is deterministic across runs", () => {
    expect(transpileToUrscript(SAMPLE_FLOW).code).toBe(transpileToUrscript(SAMPLE_FLOW).code);
    expect(transpileToRos2(SAMPLE_FLOW).code).toBe(transpileToRos2(SAMPLE_FLOW).code);
  });
});

describe("IR ProgrammingAdapter (flows through the existing contract)", () => {
  const adapter = new IrProgrammingAdapter();
  const src = (flow: Flow) => ({ kind: "ir-flow" as const, language: "ir-json", content: JSON.stringify(flow) });

  it("validate() ok for a safe flow", async () => {
    const v = await adapter.validate(src(safeMoveFlow()));
    expect(v.ok).toBe(true);
  });

  it("validate() surfaces linter errors as diagnostics (not ok)", async () => {
    const bad = safeMoveFlow();
    (bad.blocks[0] as any).speed_mms = 9999;
    const v = await adapter.validate(src(bad));
    expect(v.ok).toBe(false);
    expect(v.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("compile() emits transpiled code in meta for a safe flow", async () => {
    const b = await adapter.compile(src(SAMPLE_FLOW));
    expect(b.ok).toBe(true);
    expect(String(b.meta?.code)).toContain("movel(");
    expect(b.meta?.irCommentMap).toBeDefined();
    expect(b.outputRef).toMatch(/^ir:\/\/urscript\//);
  });

  it("compile() BLOCKS codegen on a linter error (non-ok build, no code)", async () => {
    const bad = safeMoveFlow();
    (bad.blocks[0] as any).speed_mms = 9999;
    const b = await adapter.compile(src(bad));
    expect(b.ok).toBe(false);
    expect(b.meta?.code).toBeUndefined();
    expect(b.meta?.blocked).toBe(true);
  });

  it("compile() rejects invalid IR JSON", async () => {
    const b = await adapter.compile({ kind: "ir-flow", language: "ir-json", content: "{ bad" });
    expect(b.ok).toBe(false);
  });

  it("simulate() is an honest structural preview (mentions T2 physics)", async () => {
    const b = await adapter.compile(src(SAMPLE_FLOW));
    const sim = await adapter.simulate(b, {});
    expect(sim.ok).toBe(true);
    expect(sim.warnings.join(" ")).toMatch(/physics/i);
  });

  it("deploy() has no device path — always simulated", async () => {
    const b = await adapter.compile(src(SAMPLE_FLOW));
    const dep = await adapter.deploy(b, { stage: "staging", idempotencyKey: "k", hitl: { actionId: "a", requestedBy: 1 } });
    expect(dep.simulated).toBe(true);
    expect(dep.status).toBe("simulated");
  });

  it("previewTranspile + summariseFlow helpers work", () => {
    const p = previewTranspile(SAMPLE_FLOW, "ros2");
    expect(p.ok).toBe(true);
    expect(p.code).toContain("rclpy");
    const s = summariseFlow(SAMPLE_FLOW);
    expect(s.blockCount).toBe(countBlocks(SAMPLE_FLOW));
    expect(s.blockTypes).toContain("grip");
  });
});

describe("flag gating (DPC_IR_V2_ENABLED)", () => {
  it("dpcIrV2Enabled reflects the env flag; requireFlag no-ops the mutation path when off", async () => {
    const { dpcIrV2Enabled } = await import("../../../routers/irRouter");
    const prev = process.env.DPC_IR_V2_ENABLED;
    delete process.env.DPC_IR_V2_ENABLED;
    expect(dpcIrV2Enabled()).toBe(false);
    process.env.DPC_IR_V2_ENABLED = "true";
    expect(dpcIrV2Enabled()).toBe(true);
    if (prev === undefined) delete process.env.DPC_IR_V2_ENABLED;
    else process.env.DPC_IR_V2_ENABLED = prev;
  });
});
