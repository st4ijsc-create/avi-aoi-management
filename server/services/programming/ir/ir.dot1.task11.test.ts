/**
 * Doc 80 Đợt 1 Task 11 — IR reserved-name hardening (PURE / in-memory, real transpiler
 * output — no mocks). Two gaps found by re-reading `irSafeTokens.ts` against the ROS2
 * transpiler's own generated helpers:
 *
 *   1. `_plan_and_execute` / `_gripper` / `_io_pub` (irToRos2.ts HELPER_ORDER) were NOT in
 *      `RESERVED` — a user function_block named e.g. `_gripper` passed the identifier
 *      whitelist, and because helpers are emitted BEFORE a flow's own function_block
 *      methods (irToRos2.ts: helpers loop, then function_blocks loop), the user's method
 *      SILENTLY SHADOWED the real bound gripper helper for every later `grip`/`release`
 *      call in the SAME class — a "grip" block would stop actually closing the gripper
 *      and instead run whatever the (still-whitelisted, but wrong) FB body does.
 *   2. The URScript MAIN routine name (`def <sanitizeName(flow_id)>():`) was sanitised for
 *      charset/leading-char only, never checked against RESERVED — a flow_id that
 *      sanitises to a builtin (e.g. "movel") emitted `def movel():`, SHADOWING the
 *      builtin motion primitive for the rest of the script (every `movel(...)` call after
 *      the def line would recurse into the flow's own routine instead of moving anything).
 */
import { describe, it, expect } from "vitest";
import type { Flow, FunctionBlockDef } from "./irModel";
import { lintFlow } from "./irSafetyLinter";
import { transpileToUrscript } from "./transpilers/irToUrscript";
import { transpileToRos2 } from "./transpilers/irToRos2";
import { IrUnsafeTokenError } from "./irSafeTokens";

function base(fb: FunctionBlockDef): Flow {
  return {
    flow_id: "fz-task11",
    target_device_type: "universal-robots",
    version: 1,
    blocks: [{ id: "a", type: "call_block", fb_name: fb.name, args: [] }],
    function_blocks: [fb],
  };
}

describe("IR reserved-name hardening (doc 80 Đợt 1 Task 11) — function_block named after a ROS2 bound helper", () => {
  for (const helperName of ["_gripper", "_io_pub", "_plan_and_execute"] as const) {
    const fb: FunctionBlockDef = { id: "fb1", name: helperName, params: [], body: [{ id: "c", type: "wait", ms: 10 }] };
    const flow = base(fb);

    it(`lint flags function_block "${helperName}" as invalid-identifier`, () => {
      const r = lintFlow(flow);
      expect(r.ok).toBe(false);
      expect(r.diagnostics.some((d) => d.rule === "invalid-identifier")).toBe(true);
    });

    it(`URScript emitter refuses to emit "${helperName}" (defence layer 2 — no code, no shadowed def)`, () => {
      expect(() => transpileToUrscript(flow)).toThrow(IrUnsafeTokenError);
    });

    it(`ROS2 emitter refuses to emit "${helperName}" (the exact name it would otherwise shadow)`, () => {
      expect(() => transpileToRos2(flow)).toThrow(IrUnsafeTokenError);
    });
  }

  it("a NON-colliding function_block name still transpiles fine (no false positive)", () => {
    const fb: FunctionBlockDef = { id: "fb1", name: "pick_part", params: [], body: [{ id: "c", type: "wait", ms: 10 }] };
    const flow = base(fb);
    expect(lintFlow(flow).ok).toBe(true);
    expect(transpileToUrscript(flow).code).toContain("def pick_part(");
    expect(transpileToRos2(flow).code).toContain("def pick_part(self):");
  });
});

describe("IR reserved-name hardening (doc 80 Đợt 1 Task 11) — URScript MAIN routine name vs builtin", () => {
  const moveLin: Flow["blocks"][number] = {
    id: "m1", type: "move_linear",
    target_pose: { x: 100, y: 100, z: 300, rx: 0, ry: 0, rz: 0 },
    speed_mms: 100, acceleration: 500, blend_radius: 0,
  };

  it('flow_id "movel" (a URScript builtin) does NOT shadow the real motion primitive', () => {
    const flow: Flow = { flow_id: "movel", target_device_type: "universal-robots", version: 1, blocks: [moveLin] };
    const code = transpileToUrscript(flow).code;
    // The main routine must NOT be named after the builtin it calls.
    expect(code).not.toMatch(/^def movel\(\):$/m);
    // It must still be a valid, prefixed, non-colliding name.
    expect(code).toMatch(/^def flow_movel\(\):$/m);
    // The REAL motion primitive call inside the body is unaffected (not itself renamed).
    expect(code).toMatch(/^\s*movel\(p\[/m);
  });

  it('flow_id "def" (a Python/URScript keyword, not just a builtin) is also prefixed', () => {
    const flow: Flow = { flow_id: "def", target_device_type: "universal-robots", version: 1, blocks: [moveLin] };
    const code = transpileToUrscript(flow).code;
    expect(code).not.toMatch(/^def def\(\):$/m);
    expect(code).toMatch(/^def flow_def\(\):$/m);
  });

  it("an ordinary flow_id keeps its plain sanitised name (no unnecessary prefix)", () => {
    const flow: Flow = { flow_id: "line-a-pick", target_device_type: "universal-robots", version: 1, blocks: [moveLin] };
    const code = transpileToUrscript(flow).code;
    expect(code).toMatch(/^def line_a_pick\(\):$/m);
  });
});
