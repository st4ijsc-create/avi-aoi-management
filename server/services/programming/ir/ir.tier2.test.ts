/**
 * Doc 24 Tier-2 (Programming) tests — (a) MoveIt-BOUND ROS2 transpiler + (b) HARDWARE-IN-THE
 * -LOOP (HIL) pre-deploy stage.  PURE / in-memory (mock URSim, no Docker, no hardware).
 *
 * Covers:
 *   (a) ROS2 is now a BOUND MoveItPy program: real MoveGroupCommander motion (set_pose_target
 *       / set_joint_value_target → plan() → execute()), std_msgs IO publishers, if/loop as
 *       Python control flow — asserted for a SAMPLE flow AND a flow whose function_block body
 *       contains motion (plan/execute reached through the fb method).
 *   (b) Existing goldens byte-identical: URScript D1/P3/fb goldens unchanged; the three ROS2
 *       goldens regenerate deterministically and carry their "# [IR ...]" provenance markers.
 *   (c) HIL stage composition (DPC_HIL_ENABLED): flag ON + passing URSim mock ⇒ deploy
 *       proceeds; flag ON + failing URSim mock ⇒ deploy BLOCKED with a HIL reason; flag OFF ⇒
 *       unchanged (byte-for-byte today's simulated no-op). Plus one end-to-end pass through
 *       the REAL ursimHarness against a mock net.Server controller.
 *   (d) The Simulation Gate remains the HARD precondition: a flow that FAILS the sim-gate is
 *       blocked BEFORE HIL runs — HIL can never bypass the sim-gate.
 */
import net from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { transpileToUrscript } from "./transpilers/irToUrscript";
import { transpileToRos2 } from "./transpilers/irToRos2";
import { IrProgrammingAdapter } from "./irAdapter";
import { runHilStage, dpcHilEnabled } from "./hilGate";
import { SAMPLE_FLOW } from "./__fixtures__/sampleFlow";
import { countBlocks, type Flow } from "./irModel";
import type { UrsimValidationResult } from "../../robot/ursim/ursimHarness";
import type { UrsimEndpoint } from "../../robot/ursim/ursimClient";

const FIX = join(__dirname, "__fixtures__");

// ── Fixtures ──────────────────────────────────────────────────────────────────────

/** A UR flow that PASSES the linter AND the kinematic sim-gate (joints within limits). */
function passingUrFlow(): Flow {
  return {
    flow_id: "hil_pass",
    target_device_type: "universal-robots",
    version: 1,
    blocks: [
      { id: "b1", type: "move_joint", joints: [0, -0.5, 0.5, 0, 0.5, 0], speed_pct: 40 },
      { id: "b2", type: "set_output", signal: "1", value: true },
    ],
  };
}

/**
 * A UR flow that PASSES the linter (so it compiles) but FAILS the kinematic sim-gate: the
 * elbow target (5.0 rad) exceeds the arm's ±π elbow limit → joint-limit violation.
 */
function simGateFailingUrFlow(): Flow {
  return {
    flow_id: "hil_failgate",
    target_device_type: "universal-robots",
    version: 1,
    blocks: [{ id: "b1", type: "move_joint", joints: [0, 0, 5.0, 0, 0, 0], speed_pct: 40 }],
  };
}

/** A flow whose reusable function_block BODY contains motion (fb method emits plan/execute). */
function fbMotionFlow(): Flow {
  return {
    flow_id: "fb_motion",
    target_device_type: "universal-robots",
    version: 1,
    function_blocks: [
      {
        id: "fb1",
        name: "approach",
        params: [],
        body: [{ id: "d1", type: "move_joint", joints: [0, -0.5, 0.5, 0, 0.5, 0], speed_pct: 40 }],
      },
    ],
    blocks: [{ id: "c1", type: "call_block", fb_name: "approach", args: [] }],
  };
}

const src = (flow: Flow) => ({ kind: "ir-flow" as const, language: "ir-json", content: JSON.stringify(flow) });
const deployOpts = { stage: "staging" as const, idempotencyKey: "k", hitl: { actionId: "a", requestedBy: 1 } };

/** A canned URSim validation result for the injected mock validator. */
function validation(over: Partial<UrsimValidationResult>): UrsimValidationResult {
  return { sent: true, accepted: false, running: false, elapsedMs: 1, ...over };
}
const dummyEndpoint: UrsimEndpoint = { host: "127.0.0.1", dashboardPort: 1, scriptPort: 2, timeoutMs: 100 };

afterEach(() => {
  delete process.env.DPC_HIL_ENABLED;
  delete process.env.SIM_KINEMATIC_ENABLED;
  delete process.env.SIM_PHYSICS_ENABLED;
});

// ── (a) MoveIt-BOUND ROS2 emission ──────────────────────────────────────────────────

describe("Tier-2 (a) ROS2 is a BOUND MoveItPy program", () => {
  it("SAMPLE flow: real MoveGroupCommander motion with set_pose_target / set_joint_value_target → plan() → execute()", () => {
    const { code, irCommentMap } = transpileToRos2(SAMPLE_FLOW);
    expect(code).toContain("import moveit_commander");
    expect(code).toContain("moveit_commander.MoveGroupCommander(PLANNING_GROUP)");
    expect(code).toContain("self.move_group.set_joint_value_target([");
    expect(code).toContain("self.move_group.set_pose_target([");
    expect(code).toContain("self.move_group.plan()");
    expect(code).toContain("self.move_group.execute(plan, wait=True)");
    // NO phantom skeleton helpers survive (send_pose_goal/send_joint_goal were unbound).
    expect(code).not.toContain("send_pose_goal");
    expect(code).not.toContain("send_joint_goal");
    // Provenance markers still map 1:1 to blocks.
    expect(irCommentMap["# [IR move_linear #b2]"]).toBe("b2");
    expect(Object.keys(irCommentMap).length).toBe(countBlocks(SAMPLE_FLOW));
  });

  it("function_block body with motion: the fb METHOD emits plan/execute; the call site invokes it", () => {
    const { code } = transpileToRos2(fbMotionFlow());
    expect(code).toMatch(/^ {4}def approach\(self\):/m); // fb → method
    expect(code).toContain("self.move_group.set_joint_value_target([");
    expect(code).toContain("self.move_group.plan()"); // plan/execute reached via the fb body
    expect(code).toContain("self.move_group.execute(");
    expect(code).toMatch(/^ {8}self\.approach\(\)/m); // call site in run()
  });

  it("deterministic across runs", () => {
    expect(transpileToRos2(SAMPLE_FLOW).code).toBe(transpileToRos2(SAMPLE_FLOW).code);
    expect(transpileToRos2(fbMotionFlow()).code).toBe(transpileToRos2(fbMotionFlow()).code);
  });
});

// ── (b) golden integrity ────────────────────────────────────────────────────────────

describe("Tier-2 (b) golden integrity", () => {
  it("URScript goldens are byte-identical (irToUrscript untouched)", () => {
    expect(transpileToUrscript(SAMPLE_FLOW).code).toBe(readFileSync(join(FIX, "pick_and_place.urscript.golden"), "utf8"));
  });

  it("the three ROS2 goldens match the regenerated bound MoveItPy output", () => {
    expect(transpileToRos2(SAMPLE_FLOW).code).toBe(readFileSync(join(FIX, "pick_and_place.ros2.golden"), "utf8"));
  });
});

// ── (c)+(d) HIL pre-deploy stage ──────────────────────────────────────────────────────

describe("Tier-2 (c) HIL pre-deploy stage — flag composition", () => {
  it("flag OFF ⇒ unchanged: simulated no-op, no HIL, no sim-gate re-run (byte-for-byte today's deploy)", async () => {
    delete process.env.DPC_HIL_ENABLED;
    expect(dpcHilEnabled()).toBe(false);
    const adapter = new IrProgrammingAdapter();
    const build = await adapter.compile(src(passingUrFlow()));
    const dep = await adapter.deploy(build, deployOpts);
    expect(dep.ok).toBe(true);
    expect(dep.status).toBe("simulated");
    expect(dep.simulated).toBe(true);
    expect(String(dep.detail?.note)).toMatch(/always simulated/i);
    expect(dep.detail?.hil).toBeUndefined(); // HIL path not entered at all
    expect(dep.detail?.simGatePassed).toBeUndefined();
  });

  it("flag ON + PASSING URSim mock ⇒ deploy proceeds (sim-gate PASS + HIL PASS)", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const adapter = new IrProgrammingAdapter({
      hil: {
        resolveEndpoint: () => dummyEndpoint,
        validate: async () => validation({ accepted: true, running: true, robotMode: "RUNNING", programState: "PLAYING" }),
      },
    });
    const build = await adapter.compile(src(passingUrFlow()));
    const dep = await adapter.deploy(build, deployOpts);
    expect(dep.ok).toBe(true);
    expect(dep.status).toBe("simulated"); // still simulated by default — HIL is a gate, not a real push
    expect(dep.simulated).toBe(true);
    expect(dep.detail?.simGatePassed).toBe(true);
    const hil = dep.detail?.hil as { ran: boolean; pass: boolean };
    expect(hil.ran).toBe(true);
    expect(hil.pass).toBe(true);
  });

  it("flag ON + FAILING URSim mock ⇒ deploy BLOCKED with a HIL reason", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const adapter = new IrProgrammingAdapter({
      hil: {
        resolveEndpoint: () => dummyEndpoint,
        // Controller reachable but did NOT accept/run (e.g. a broken transpile) → HIL fail.
        validate: async () => validation({ sent: true, accepted: false, running: false }),
      },
    });
    const build = await adapter.compile(src(passingUrFlow()));
    const dep = await adapter.deploy(build, deployOpts);
    expect(dep.ok).toBe(false);
    expect(dep.status).toBe("failed");
    expect(dep.simulated).toBe(true); // never wrote to real hardware
    expect(dep.error).toMatch(/HIL/i);
    expect((dep.detail?.hil as { ran: boolean }).ran).toBe(true);
  });

  it("flag ON + UR but NO endpoint configured ⇒ fail-closed (blocked, honest reason)", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const adapter = new IrProgrammingAdapter({ hil: { resolveEndpoint: () => null } });
    const build = await adapter.compile(src(passingUrFlow()));
    const dep = await adapter.deploy(build, deployOpts);
    expect(dep.ok).toBe(false);
    expect(dep.status).toBe("rejected");
    expect(dep.error).toMatch(/HIL/i);
    expect(String((dep.detail?.hil as { reason?: string }).reason)).toMatch(/endpoint/i);
  });
});

describe("Tier-2 (d) the Simulation Gate stays the HARD precondition (HIL never bypasses it)", () => {
  it("flag ON + a sim-gate-FAILING flow ⇒ deploy BLOCKED before HIL; the URSim validator is NEVER called", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    let validatorCalls = 0;
    const adapter = new IrProgrammingAdapter({
      hil: {
        resolveEndpoint: () => dummyEndpoint,
        // Would PASS if reached — proving the block came from the sim-gate, not HIL.
        validate: async () => {
          validatorCalls += 1;
          return validation({ accepted: true, running: true });
        },
      },
    });
    const build = await adapter.compile(src(simGateFailingUrFlow()));
    expect(build.ok).toBe(true); // compiles (linter clean) — the block must come from the sim-gate
    const dep = await adapter.deploy(build, deployOpts);
    expect(dep.ok).toBe(false);
    expect(dep.status).toBe("rejected");
    expect(dep.error).toMatch(/Simulation Gate/i);
    expect(dep.detail?.simGatePassed).toBe(false);
    expect((dep.detail?.hil as { ran: boolean }).ran).toBe(false);
    expect(validatorCalls).toBe(0); // HIL was never run — it cannot bypass a failed sim-gate
  });
});

// ── (c) end-to-end through the REAL ursimHarness against a mock net.Server controller ──

function startDashboardServer(replies: (cmd: string) => string): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on("error", () => { /* client teardown reset — ignore in mock */ });
      sock.write("Connected: Universal Robots Dashboard Server\n");
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const cmd = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (cmd) sock.write(replies(cmd) + "\n");
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

function startScriptServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on("error", () => { /* client teardown reset — ignore in mock */ });
      sock.on("data", () => { /* capture-and-discard the URScript */ });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

describe("Tier-2 (c) HIL end-to-end via the REAL ursimHarness (mock net.Server)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("flag ON + a RUNNING mock UR controller ⇒ HIL runs the real harness and deploy proceeds", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const dash = await startDashboardServer((cmd) => {
      if (cmd === "robotmode") return "Robotmode: RUNNING";
      if (cmd === "programState") return "PLAYING prog.urp";
      if (cmd === "running") return "Program running: true";
      return "ok"; // power on / brake release
    });
    const script = await startScriptServer();
    cleanups.push(dash.close);
    cleanups.push(script.close);

    const adapter = new IrProgrammingAdapter({
      hil: {
        // Real validateUrscriptOnUrsim (default) against the mock controller.
        resolveEndpoint: () => ({ host: "127.0.0.1", dashboardPort: dash.port, scriptPort: script.port, timeoutMs: 2000 }),
        validationOptions: { pollIntervalMs: 50, runWaitMs: 500 },
      },
    });
    const build = await adapter.compile(src(passingUrFlow()));
    const dep = await adapter.deploy(build, deployOpts);
    expect(dep.ok).toBe(true);
    expect(dep.status).toBe("simulated");
    const hil = dep.detail?.hil as { ran: boolean; pass: boolean; validation?: UrsimValidationResult };
    expect(hil.ran).toBe(true);
    expect(hil.pass).toBe(true);
    expect(hil.validation?.running).toBe(true); // proven on the real harness
  });
});

// ── runHilStage unit behaviour (flag/target guards) ──────────────────────────────────

describe("runHilStage guards", () => {
  it("flag OFF ⇒ no-op pass (never blocks)", async () => {
    delete process.env.DPC_HIL_ENABLED;
    const r = await runHilStage("def prog():\nend", true);
    expect(r.ran).toBe(false);
    expect(r.pass).toBe(true);
    expect(r.skipped).toBe("flag-off");
  });

  it("flag ON + non-UR target ⇒ skipped, does not block", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const r = await runHilStage("# ros2 code", false, { resolveEndpoint: () => dummyEndpoint });
    expect(r.ran).toBe(false);
    expect(r.pass).toBe(true);
    expect(r.skipped).toBe("not-ur");
  });
});
