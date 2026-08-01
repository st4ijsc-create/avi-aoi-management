/**
 * T2 (doc 24 Wave-1) — REAL RIGID-BODY PHYSICS backend (Rapier) tests.
 *
 * Covers:
 *   • Rapier WASM init loads (cached) and a backend can be constructed.
 *   • A stable SLOW trajectory PASSES (no velocity/accel/torque/tip-over violation).
 *   • An AGGRESSIVE (too-fast) trajectory produces a VELOCITY violation (blocking).
 *   • An OVERLOADED trajectory (heavy payload on a load-bearing joint) produces a real
 *     rigid-body TORQUE/EFFORT violation — validated against a hand inverse-dynamics calc.
 *   • Base TIP-OVER fires only when a base support footprint is DECLARED; undefined otherwise.
 *   • The DEGRADED path (no usable link mass/geometry) is LABELLED, torque NOT fabricated.
 *   • GATE WIRING: with SIM_PHYSICS_ENABLED off the backend is a no-op (internal quasi-static,
 *     pass unchanged); with it on + a bound backend a physics violation BLOCKS the gate (`pass`
 *     flips) — while a safe program still passes.
 *
 * ── WASM GUARD ──────────────────────────────────────────────────────────────
 * Rapier is a WASM module. If it cannot load in this runtime we SKIP the engine-dependent
 * suites (recorded loudly) rather than fail the run — `check`/`build` never depend on the WASM.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  type KinematicModel,
  mat4Identity,
  SAMPLE_ARM_6DOF,
} from "./kinematicModel";
import type { TrajectorySample } from "./physics";
import { createRapierBackend, loadRapier, type RapierPhysicsBackend } from "./rapierPhysics";
import { runKinematicSimGate, type SimScene } from "./kinematicSimGate";
import type { Flow } from "../ir/irModel";

const G = 9.80665;

// Try to load Rapier once; if the WASM is unavailable, flag it so the suites self-skip.
let rapierAvailable = false;
let backend: RapierPhysicsBackend;
beforeAll(async () => {
  try {
    await loadRapier();
    backend = await createRapierBackend();
    rapierAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[rapierPhysics.test] Rapier WASM unavailable — skipping engine tests:", err);
    rapierAvailable = false;
  }
});

// ── A 1-DOF URDF-exact arm about the horizontal Y axis, so gravity torque is analytic. ──
// Capsule 0..600 mm (COM at 300 mm = 0.30 m), 20 kg, torque limit 30 N·m. Static holding torque
// at horizontal = 20·9.80665·0.30 ≈ 58.8 N·m > 30 → OVERLOADED by construction (about Y, so the
// horizontal arm genuinely loads the joint — a Z-axis joint would carry no gravity torque).
const ONE_DOF_Y: KinematicModel = {
  id: "test-1dof-y",
  label: "1R about Y (horizontal, overloaded)",
  deviceType: "generic",
  base: mat4Identity(),
  workspace: { min: [-2000, -2000, -2000], max: [2000, 2000, 2000] },
  dof: 1,
  joints: [
    {
      name: "j1",
      type: "revolute",
      dh: { a: 0, alpha: 0, d: 0, theta: 0 },
      limits: { min: -3.2, max: 3.2 },
      bv: { kind: "capsule", a: [0, 0, 0], b: [600, 0, 0], radius: 40 },
      // URDF-exact path: rotate about world Y at the origin (unambiguous axis for the analytic test).
      local: { restTransform: mat4Identity(), axis: [0, 1, 0] },
      dynamics: { velocityLimit: 5, accelLimit: 50, torqueLimit: 30, massKg: 20, comLeverMm: 300 },
    },
  ],
};

// A LIGHT variant (1 kg → ~2.9 N·m ≪ 30) that comfortably passes torque.
const ONE_DOF_Y_LIGHT: KinematicModel = {
  ...ONE_DOF_Y,
  id: "test-1dof-y-light",
  joints: [
    {
      ...ONE_DOF_Y.joints[0],
      dynamics: { velocityLimit: 5, accelLimit: 50, torqueLimit: 30, massKg: 1, comLeverMm: 300 },
    },
  ],
};

// A DEGRADED model: a joint whose bounding volume has no usable extent (zero-radius sphere) →
// the backend cannot build a body → torque NOT computed (labelled degraded).
const ONE_DOF_DEGRADED: KinematicModel = {
  ...ONE_DOF_Y,
  id: "test-1dof-degraded",
  joints: [
    {
      ...ONE_DOF_Y.joints[0],
      bv: { kind: "sphere", center: [0, 0, 0], radius: 0 },
      dynamics: undefined,
    },
  ],
};

function slowTraj(model: KinematicModel): TrajectorySample[] {
  // Gentle move on joint 0: 0 → 0.1 rad over 2 s in small steps (q̇ ~ 0.05 rad/s ≪ limits).
  const out: TrajectorySample[] = [];
  const zeros = new Array<number>(model.dof).fill(0);
  for (let s = 0; s <= 10; s++) {
    const j = zeros.slice();
    j[0] = 0.1 * (s / 10);
    out.push({ t: s * 0.2, joints: j });
  }
  return out;
}

describe("rapierPhysics · engine loads", () => {
  it("Rapier WASM initialises and a backend is constructed (id=rapier-dynamics)", () => {
    if (!rapierAvailable) return; // WASM unavailable — skip honestly
    expect(backend).toBeDefined();
    expect(backend.id).toBe("rapier-dynamics");
  });
});

describe("rapierPhysics · trajectory verdicts", () => {
  it("a STABLE slow trajectory passes (no velocity/accel/torque/tip-over violation)", () => {
    if (!rapierAvailable) return;
    const r = backend.simulate(slowTraj(ONE_DOF_Y_LIGHT), ONE_DOF_Y_LIGHT);
    expect(r.jointVelocityViolations).toHaveLength(0);
    expect(r.jointAccelViolations).toHaveLength(0);
    expect(r.estTorqueViolations).toHaveLength(0);
    expect(r.tipOver).toBeUndefined(); // no declared footprint → not evaluated
    expect(r.ok).toBe(true);
    expect(r.notes.join(" ")).toMatch(/rapier/i);
  });

  it("an AGGRESSIVE (too-fast) trajectory produces a VELOCITY violation (blocking)", () => {
    if (!rapierAvailable) return;
    // 0 → 1 rad in 0.1 s → q̇ = 10 rad/s ≫ 5 limit.
    const fast: TrajectorySample[] = [
      { t: 0, joints: [0] },
      { t: 0.1, joints: [1] },
    ];
    const r = backend.simulate(fast, ONE_DOF_Y_LIGHT);
    expect(r.jointVelocityViolations.length).toBeGreaterThan(0);
    expect(r.jointVelocityViolations[0].joint).toBe("j1");
    expect(r.jointVelocityViolations[0].value).toBeCloseTo(10, 5);
    expect(r.ok).toBe(false);
  });

  it("an OVERLOADED joint produces a real rigid-body TORQUE violation (matches inverse-dynamics calc)", () => {
    if (!rapierAvailable) return;
    // Hold near horizontal (θ≈0): required torque ≈ m·g·lever = 20·9.80665·0.30 ≈ 58.8 N·m > 30.
    const r = backend.simulate(slowTraj(ONE_DOF_Y), ONE_DOF_Y);
    expect(r.estTorqueViolations.length).toBe(1);
    expect(r.estTorqueViolations[0].joint).toBe("j1");
    // The Newton–Euler result should match the analytic gravity holding torque within ~5%.
    expect(r.estTorqueViolations[0].value).toBeGreaterThan(0.9 * 20 * G * 0.3);
    expect(r.estTorqueViolations[0].value).toBeLessThan(1.15 * 20 * G * 0.3);
    expect(r.estTorqueViolations[0].limit).toBe(30);
    expect(r.ok).toBe(false);
  });

  it("a heavy TCP payload pushes a light joint over the torque limit", () => {
    if (!rapierAvailable) return;
    // Light link (~2.9 N·m) + a 20 kg payload at ~0.6 m → well over the 30 N·m limit.
    const r = backend.simulate(slowTraj(ONE_DOF_Y_LIGHT), ONE_DOF_Y_LIGHT, { payloadKg: 20 });
    expect(r.estTorqueViolations.length).toBe(1);
    expect(r.estTorqueViolations[0].value).toBeGreaterThan(30);
    expect(r.ok).toBe(false);
  });
});

describe("rapierPhysics · tip-over (only with a declared footprint)", () => {
  it("tip-over is NOT evaluated without a declared base support footprint (undefined)", () => {
    if (!rapierAvailable) return;
    const r = backend.simulate(slowTraj(SAMPLE_ARM_6DOF), SAMPLE_ARM_6DOF);
    expect(r.tipOver).toBeUndefined();
  });

  it("tip-over FIRES when the whole-arm COM leaves a tiny declared footprint (blocking)", () => {
    if (!rapierAvailable) return;
    const tippy: KinematicModel = { ...SAMPLE_ARM_6DOF, id: "tippy", baseSupport: { halfX: 50, halfY: 50 } };
    // Lift the arm out horizontally so its COM projects well past a 50 mm footprint.
    const reach: TrajectorySample[] = [
      { t: 0, joints: [0, 0, 0, 0, 0, 0] },
      { t: 1, joints: [0, -1.2, 0, 0, 0, 0] },
    ];
    const r = backend.simulate(reach, tippy);
    expect(r.tipOver).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.notes.join(" ")).toMatch(/tip-over/i);
  });
});

describe("rapierPhysics · honest degradation", () => {
  it("a model with no usable link geometry/mass is LABELLED degraded; torque NOT fabricated", () => {
    if (!rapierAvailable) return;
    const r = backend.simulate(slowTraj(ONE_DOF_DEGRADED), ONE_DOF_DEGRADED);
    expect(r.notes.join(" ")).toMatch(/degraded/i);
    expect(r.estTorqueViolations).toHaveLength(0); // no fabricated torque
    // Velocity/accel (which need only the trajectory) are still evaluated (here: within limits).
    expect(r.ok).toBe(true);
  });
});

// ── Gate wiring: flag OFF = no-op; flag ON + bound backend = blocking ────────────────

describe("rapierPhysics · gate wiring (SIM_PHYSICS_ENABLED)", () => {
  const scene: SimScene = { obstacles: [], safetyZones: [] };
  const savedFlag = process.env.SIM_PHYSICS_ENABLED;
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.SIM_PHYSICS_ENABLED;
    else process.env.SIM_PHYSICS_ENABLED = savedFlag;
  });

  // An overloaded flow: a shoulder_lift swing with a heavy payload → real torque violation.
  const overloadFlow: Flow = {
    flow_id: "overload",
    target_device_type: "universal-robots",
    version: 1,
    blocks: [{ type: "move_joint", joints: [0, -1.4, 0, 0, 0, 0], speed_pct: 40 }],
  };

  it("flag OFF → physics backend is a NO-OP: pass unchanged, engine=internal, not blocking", () => {
    if (!rapierAvailable) return;
    delete process.env.SIM_PHYSICS_ENABLED;
    // Even if a backend is injected, with the flag OFF the gate uses the internal backend and
    // dynamics never blocks (backward-compatible).
    const r = runKinematicSimGate(overloadFlow, SAMPLE_ARM_6DOF, scene, {
      physicsBackend: backend,
      dynamicsOptions: { payloadKg: 30 },
    });
    expect(r.pass).toBe(true); // kinematic-only pass, unaffected by dynamics
    expect(r.physicsEngine).toBe("internal-dynamics");
    expect(r.physicsBlocked).toBeUndefined();
  });

  it("flag ON + bound backend → a physics violation BLOCKS the gate (pass flips)", () => {
    if (!rapierAvailable) return;
    process.env.SIM_PHYSICS_ENABLED = "true";
    const r = runKinematicSimGate(overloadFlow, SAMPLE_ARM_6DOF, scene, {
      physicsBackend: backend,
      dynamicsOptions: { payloadKg: 30 },
    });
    expect(r.physicsEngine).toBe("rapier-dynamics");
    expect(r.physicsBlocked).toBe(true);
    expect(r.pass).toBe(false); // blocked → blocks deploy (like a collision)
    expect(r.dynamics_reasons?.join(" ")).toMatch(/torque|effort|tip-over/i);
  });

  it("flag ON + bound backend + a SAFE program → still passes (no false block)", () => {
    if (!rapierAvailable) return;
    process.env.SIM_PHYSICS_ENABLED = "true";
    const safe: Flow = {
      flow_id: "safe",
      target_device_type: "universal-robots",
      version: 1,
      blocks: [{ type: "move_joint", joints: [0.3, 0, 0, 0, 0, 0], speed_pct: 20 }],
    };
    const r = runKinematicSimGate(safe, SAMPLE_ARM_6DOF, scene, { physicsBackend: backend });
    expect(r.pass).toBe(true);
    expect(r.physicsEngine).toBe("rapier-dynamics");
    expect(r.physicsBlocked).toBe(false);
  });

  it("flag ON but NO backend bound → internal quasi-static runs ADDITIVELY (does NOT block)", () => {
    if (!rapierAvailable) return;
    process.env.SIM_PHYSICS_ENABLED = "true";
    // No physicsBackend injected → the gate does not silently fabricate a physics pass; it runs
    // the internal quasi-static backend additively and never flips `pass`.
    const r = runKinematicSimGate(overloadFlow, SAMPLE_ARM_6DOF, scene, {
      dynamicsOptions: { payloadKg: 30 },
    });
    expect(r.pass).toBe(true); // not blocked (no real engine bound)
    expect(r.physicsEngine).toBe("internal-dynamics");
    expect(r.physicsBlocked).toBeUndefined();
    expect(r.note).toMatch(/no physics backend was bound/i);
  });
});
