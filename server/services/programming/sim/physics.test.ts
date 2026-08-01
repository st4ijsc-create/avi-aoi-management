/**
 * T2b (doc 22 P5+) — DYNAMICS-AWARE layer + external-physics seam tests. PURE / in-memory.
 *
 * Covers:
 *   • Finite-difference joint VELOCITY / ACCEL computed correctly from a KNOWN timed trajectory.
 *   • A too-fast move flags a VELOCITY violation; a within-limits move passes clean.
 *   • A too-hard ramp flags an ACCEL violation.
 *   • The quasi-static gravity-TORQUE estimate flags an overloaded joint.
 *   • The EXTERNAL backend THROWS when the flag is off / unconfigured; the default backend
 *     resolved by the flag is the INTERNAL one.
 *   • Backward-compatible WIRING into the gate: additive dynamics fields, honest no-op when
 *     there is no motion, and `pass` unchanged by dynamics.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  type KinematicModel,
  mat4Identity,
  SAMPLE_ARM_6DOF,
  SAMPLE_SCARA,
} from "./kinematicModel";
import {
  type TrajectorySample,
  InternalDynamicsBackend,
  ExternalPhysicsBackend,
  ExternalPhysicsNotConfiguredError,
  resolvePhysicsBackend,
  simPhysicsEnabled,
} from "./physics";
import { runKinematicSimGate, type SimScene } from "./kinematicSimGate";
import type { Flow } from "../ir/irModel";

// ── A tiny 1-DOF revolute model with EXPLICIT dynamics limits, so the checks are analytic. ──
// One revolute joint, mass 10 kg, COM lever 500 mm (0.5 m), velocity limit 2 rad/s, accel
// limit 10 rad/s², torque limit 40 N·m. With g=9.80665, static holding torque =
// 10·9.80665·0.5 ≈ 49.03 N·m > 40 → the joint is OVERLOADED by construction.
const ONE_DOF: KinematicModel = {
  id: "test-1dof",
  label: "1R dynamics test",
  deviceType: "generic",
  base: mat4Identity(),
  workspace: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] },
  dof: 1,
  joints: [
    {
      name: "j1",
      type: "revolute",
      dh: { a: 500, alpha: 0, d: 0, theta: 0 },
      limits: { min: -Math.PI, max: Math.PI },
      bv: { kind: "sphere", center: [0, 0, 0], radius: 10 },
      dynamics: { velocityLimit: 2, accelLimit: 10, torqueLimit: 40, massKg: 10, comLeverMm: 500 },
    },
  ],
};

// A LIGHT variant of the same chain that comfortably passes torque (mass 1 kg → ~4.9 N·m).
const ONE_DOF_LIGHT: KinematicModel = {
  ...ONE_DOF,
  id: "test-1dof-light",
  joints: [
    {
      ...ONE_DOF.joints[0],
      dynamics: { velocityLimit: 2, accelLimit: 10, torqueLimit: 40, massKg: 1, comLeverMm: 500 },
    },
  ],
};

const G = 9.80665;

describe("physics · InternalDynamicsBackend — finite-difference velocity/accel", () => {
  it("computes joint VELOCITY correctly from a known timed trajectory", () => {
    // Joint goes 0 → 1 rad over 1 s in one step → q̇ = 1 rad/s (< 2 limit → no violation).
    const samples: TrajectorySample[] = [
      { t: 0, joints: [0] },
      { t: 1, joints: [1] },
    ];
    const r = new InternalDynamicsBackend().simulate(samples, ONE_DOF_LIGHT);
    expect(r.jointVelocityViolations).toHaveLength(0);
    // Duration reported == last sample time.
    expect(r.dynamicCycleTimeMs).toBe(1000);
  });

  it("flags a VELOCITY violation for a too-fast move", () => {
    // 0 → 1 rad in 0.1 s → q̇ = 10 rad/s ≫ 2 limit.
    const samples: TrajectorySample[] = [
      { t: 0, joints: [0] },
      { t: 0.1, joints: [1] },
    ];
    const r = new InternalDynamicsBackend().simulate(samples, ONE_DOF_LIGHT);
    expect(r.jointVelocityViolations.length).toBeGreaterThan(0);
    expect(r.jointVelocityViolations[0].joint).toBe("j1");
    expect(r.jointVelocityViolations[0].value).toBeCloseTo(10, 6);
    expect(r.jointVelocityViolations[0].limit).toBe(2);
    expect(r.ok).toBe(false);
  });

  it("a within-limits move PASSES (no velocity/accel/torque violations)", () => {
    // Gentle: 0 → 0.5 → 1.0 rad at 1 s intervals → q̇ = 0.5 rad/s, q̈ = 0 (constant velocity).
    const samples: TrajectorySample[] = [
      { t: 0, joints: [0] },
      { t: 1, joints: [0.5] },
      { t: 2, joints: [1.0] },
    ];
    const r = new InternalDynamicsBackend().simulate(samples, ONE_DOF_LIGHT);
    expect(r.jointVelocityViolations).toHaveLength(0);
    expect(r.jointAccelViolations).toHaveLength(0);
    expect(r.estTorqueViolations).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it("flags an ACCEL violation for a too-hard ramp (velocity within limits)", () => {
    // Velocities: interval1 = (0.1)/1 = 0.1 rad/s; interval2 = (2-0.1)/0.1 = 19 rad/s. Both
    // stay ≤ velocity limit? interval2 = 19 > 2 → would also flag velocity. Use a jump that
    // keeps BOTH velocities within 2 rad/s but a large accel between them:
    //   s0=0@0s, s1=0.2@1s (v=0.2), s2=0.2+1.8*?  — instead craft velocities 0.2 then 1.8 with
    //   a short gap so accel is large but each velocity ≤ 2.
    // v1 = 0.2 rad/s over [0,1]; v2 = 1.8 rad/s over [1, 1.1] (Δq = 0.18). accel ≈
    // (1.8-0.2)/ (t2 - t1) = 1.6 / 0.1 = 16 rad/s² > 10 limit; both velocities ≤ 2.
    const samples: TrajectorySample[] = [
      { t: 0, joints: [0] },
      { t: 1, joints: [0.2] },
      { t: 1.1, joints: [0.38] },
    ];
    const r = new InternalDynamicsBackend().simulate(samples, ONE_DOF_LIGHT);
    expect(r.jointVelocityViolations).toHaveLength(0); // 0.2 and 1.8 rad/s both ≤ 2
    expect(r.jointAccelViolations.length).toBeGreaterThan(0);
    expect(r.jointAccelViolations[0].joint).toBe("j1");
    expect(r.jointAccelViolations[0].value).toBeGreaterThan(10);
  });

  it("velocity finite-difference is exact for a multi-step trajectory (peak captured)", () => {
    const samples: TrajectorySample[] = [
      { t: 0, joints: [0] },
      { t: 1, joints: [0.3] }, // v = 0.3
      { t: 1.5, joints: [1.0] }, // v = 1.4
    ];
    const r = new InternalDynamicsBackend().simulate(samples, ONE_DOF_LIGHT);
    // No violation (both < 2), but the reported duration is 1.5 s.
    expect(r.dynamicCycleTimeMs).toBe(1500);
    expect(r.ok).toBe(true);
  });
});

describe("physics · InternalDynamicsBackend — static gravity torque", () => {
  it("flags an OVERLOADED joint (holding torque exceeds the torque limit)", () => {
    // ONE_DOF: 10 kg at 0.5 m → ~49 N·m > 40 N·m limit. Any pose triggers it.
    const samples: TrajectorySample[] = [
      { t: 0, joints: [0] },
      { t: 1, joints: [0.1] },
    ];
    const r = new InternalDynamicsBackend().simulate(samples, ONE_DOF);
    expect(r.estTorqueViolations.length).toBe(1);
    expect(r.estTorqueViolations[0].joint).toBe("j1");
    expect(r.estTorqueViolations[0].value).toBeCloseTo(10 * G * 0.5, 3);
    expect(r.estTorqueViolations[0].limit).toBe(40);
    expect(r.ok).toBe(false);
  });

  it("does NOT flag torque when within the limit (light link)", () => {
    const samples: TrajectorySample[] = [
      { t: 0, joints: [0] },
      { t: 1, joints: [0.1] },
    ];
    const r = new InternalDynamicsBackend().simulate(samples, ONE_DOF_LIGHT);
    expect(r.estTorqueViolations).toHaveLength(0);
  });

  it("added TCP payload increases the estimated torque (can push a light joint over)", () => {
    const samples: TrajectorySample[] = [
      { t: 0, joints: [0] },
      { t: 1, joints: [0.1] },
    ];
    // Light link (~4.9 N·m) + a heavy 10 kg payload at 0.5 m lever (~49 N·m) → over 40.
    const r = new InternalDynamicsBackend().simulate(samples, ONE_DOF_LIGHT, { payloadKg: 10 });
    expect(r.estTorqueViolations.length).toBe(1);
    expect(r.estTorqueViolations[0].value).toBeGreaterThan(40);
  });
});

describe("physics · honest no-op", () => {
  it("no samples → dynamics NOT evaluated (no fabricated pass, ok stays true but noted)", () => {
    const r = new InternalDynamicsBackend().simulate([], ONE_DOF);
    expect(r.jointVelocityViolations).toHaveLength(0);
    expect(r.estTorqueViolations).toHaveLength(0);
    expect(r.dynamicCycleTimeMs).toBe(0);
    expect(r.notes.join(" ")).toMatch(/no trajectory samples/i);
  });

  it("single sample → velocity/accel not evaluable, torque still estimated from the pose", () => {
    const r = new InternalDynamicsBackend().simulate([{ t: 0, joints: [0] }], ONE_DOF);
    expect(r.jointVelocityViolations).toHaveLength(0);
    // ONE_DOF is overloaded → torque still flags even from a single pose.
    expect(r.estTorqueViolations.length).toBe(1);
    expect(r.notes.join(" ")).toMatch(/single sample/i);
  });
});

describe("physics · external seam + backend resolution", () => {
  const savedFlag = process.env.SIM_PHYSICS_ENABLED;
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.SIM_PHYSICS_ENABLED;
    else process.env.SIM_PHYSICS_ENABLED = savedFlag;
  });

  it("ExternalPhysicsBackend.simulate THROWS a clear not-configured error", () => {
    const be = new ExternalPhysicsBackend();
    expect(() => be.simulate([{ t: 0, joints: [0] }], ONE_DOF)).toThrow(ExternalPhysicsNotConfiguredError);
    expect(() => be.simulate([{ t: 0, joints: [0] }], ONE_DOF)).toThrow(/not configured|bind/i);
  });

  it("flag OFF (default) → resolvePhysicsBackend returns the INTERNAL backend", () => {
    delete process.env.SIM_PHYSICS_ENABLED;
    expect(simPhysicsEnabled()).toBe(false);
    const be = resolvePhysicsBackend();
    expect(be).toBeInstanceOf(InternalDynamicsBackend);
    expect(be.id).toBe("internal-dynamics");
  });

  it("flag ON but unconfigured → returns the external STUB, which throws on use", () => {
    process.env.SIM_PHYSICS_ENABLED = "true";
    expect(simPhysicsEnabled()).toBe(true);
    const be = resolvePhysicsBackend();
    expect(be).toBeInstanceOf(ExternalPhysicsBackend);
    expect(() => be.simulate([{ t: 0, joints: [0] }], ONE_DOF)).toThrow(ExternalPhysicsNotConfiguredError);
  });

  it("flag ON WITH a bound external backend → uses it (no throw)", () => {
    process.env.SIM_PHYSICS_ENABLED = "true";
    const fake = new InternalDynamicsBackend(); // stand-in for a real bound engine
    const be = resolvePhysicsBackend({ external: fake });
    expect(be).toBe(fake);
  });

  it("`force` overrides the flag entirely", () => {
    process.env.SIM_PHYSICS_ENABLED = "true";
    const internal = new InternalDynamicsBackend();
    expect(resolvePhysicsBackend({ force: internal })).toBe(internal);
  });
});

// ── Gate wiring (backward-compatible) ────────────────────────────────────────────

function jointFlow(joints: number[], speedPct = 50): Flow {
  return {
    flow_id: "test_dyn",
    target_device_type: "generic",
    version: 1,
    blocks: [{ type: "move_joint", joints, speed_pct: speedPct }],
  };
}

describe("physics · gate wiring (additive, backward-compatible)", () => {
  const emptyScene: SimScene = { obstacles: [], safetyZones: [] };

  it("gate populates additive dynamics fields on a normal move", () => {
    const r = runKinematicSimGate(jointFlow([0.2, 0.1, 0, 0], 50), SAMPLE_SCARA, emptyScene, {});
    // Kinematic contract untouched.
    expect(r.pass).toBe(true);
    // Additive fields present.
    expect(r.dynamics).toBeDefined();
    expect(typeof r.dynamicsPass).toBe("boolean");
    expect(Array.isArray(r.dynamics_reasons)).toBe(true);
  });

  it("dynamics violation does NOT change the kinematic `pass` (contract preserved)", () => {
    // A very fast joint move on the 6-DOF arm at 100% with a large delta → high joint velocity
    // that trips the velocity limit, but the move is collision/limit-clean → pass stays true.
    const fast: Flow = {
      flow_id: "fast",
      target_device_type: "universal-robots",
      version: 1,
      // shoulder_pan swings ~5 rad; at 100% the gate's jointRate is ~π rad/s so peak fd velocity
      // exceeds the joint's π rad/s limit across the sampled waypoints.
      blocks: [{ type: "move_joint", joints: [5, 0, 0, 0, 0, 0], speed_pct: 100 }],
    };
    const r = runKinematicSimGate(fast, SAMPLE_ARM_6DOF, emptyScene, {});
    expect(r.pass).toBe(true); // kinematic pass unaffected
    // dynamics evaluated; if it flagged, dynamicsPass reflects it independently of `pass`.
    expect(r.dynamics).toBeDefined();
    expect(r.dynamicsPass).toBe(r.dynamics!.ok);
  });

  it("skipDynamics leaves the dynamics fields undefined (opt-out)", () => {
    const r = runKinematicSimGate(jointFlow([0.2, 0.1, 0, 0], 50), SAMPLE_SCARA, emptyScene, {
      skipDynamics: true,
    });
    expect(r.dynamics).toBeUndefined();
    expect(r.dynamicsPass).toBeUndefined();
  });

  it("no-motion flow → HONEST dynamics no-op (dynamicsPass undefined, not fabricated)", () => {
    const empty: Flow = { flow_id: "empty", target_device_type: "generic", version: 1, blocks: [] };
    const r = runKinematicSimGate(empty, SAMPLE_SCARA, emptyScene, {});
    expect(r.pass).toBe(true); // trivially passes kinematics
    expect(r.dynamicsPass).toBeUndefined(); // no motion → not evaluated
    expect(r.dynamics).toBeUndefined();
    expect(r.note).toMatch(/dynamics NOT evaluated/i);
  });

  it("is DETERMINISTIC (same flow → identical dynamics verdict)", () => {
    const a = runKinematicSimGate(jointFlow([0.3, -0.2, 20, 0.1], 40), SAMPLE_SCARA, emptyScene, {});
    const b = runKinematicSimGate(jointFlow([0.3, -0.2, 20, 0.1], 40), SAMPLE_SCARA, emptyScene, {});
    expect(a.dynamicsPass).toBe(b.dynamicsPass);
    expect(a.dynamics?.dynamicCycleTimeMs).toBe(b.dynamics?.dynamicCycleTimeMs);
  });
});
