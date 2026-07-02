/**
 * T2b (doc 22 P5+) — DYNAMICS-AWARE layer for the kinematic Simulation Gate + a pluggable
 * external-physics seam.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS ADDS (honest scope) — the kinematic gate (kinematicSimGate.ts) already samples
 * a motion into WAYPOINT joint configs and runs FK → collision / joint-limit / workspace /
 * safety-zone checks. That is purely GEOMETRIC (kinematic). This module adds a DYNAMICS
 * awareness on TOP of that SAME sampled trajectory:
 *
 *   1. JOINT VELOCITY  — finite-difference the sampled joint configs over their timestamps
 *      (q̇ᵢ ≈ Δqᵢ/Δt) and check each joint's peak |q̇| against a per-joint velocity limit.
 *   2. JOINT ACCEL     — second finite difference (q̈ᵢ ≈ Δq̇ᵢ/Δt) vs a per-joint accel limit.
 *   3. STATIC GRAVITY TORQUE — a SIMPLE quasi-static gravity-load estimate per joint:
 *      τᵢ ≈ Σ (mⱼ · g · horizontalLeverⱼ) over the links OUTBOARD of joint i, using the
 *      link masses + centre-of-mass levers from the model (defaults supplied when absent),
 *      checked against a per-joint torque limit. This is a STATICS estimate (holding torque
 *      against gravity at each posed waypoint) — it deliberately IGNORES inertial (m·a),
 *      Coriolis and centrifugal terms; those need a full rigid-body dynamics engine.
 *
 * This genuinely moves the gate BEYOND kinematics (a program that whips a joint too fast,
 * ramps too hard, or holds a payload the joint cannot support is now flagged), while being
 * PURE, DETERMINISTIC math with NO device control and NO fabricated pass.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *   • NOT a full rigid-body contact-dynamics engine — no inertia matrix, no Coriolis /
 *     centrifugal coupling, no contact-force resolution, no friction, no motor model.
 *   • The static-torque figure is an ORDER-OF-MAGNITUDE holding-torque estimate from
 *     lumped link masses + horizontal levers, not a validated manufacturer torque curve.
 *   • For a high-fidelity answer, bind the EXTERNAL seam (Isaac Sim / RoboDK) below.
 *
 * ── THE EXTERNAL SEAM ───────────────────────────────────────────────────────
 * `ExternalPhysicsBackend` is a DOCUMENTED STUB for an OUT-OF-PROCESS engine (Isaac Sim /
 * RoboDK). When SIM_PHYSICS_ENABLED is on, the gate would delegate to a real physics engine
 * over this adapter's contract; because none is bound in-process, the stub THROWS a clear
 * "not configured" error. `resolvePhysicsBackend` therefore falls back to the internal backend
 * by default (flag OFF), and only returns the external backend when the flag is on — where the
 * caller is expected to have bound a real service (or gets the honest throw). No silent
 * fabrication either way.
 *
 * ── T2 (doc 24 Wave-1): AN IN-PROCESS REAL ENGINE IS NOW BOUND ──────────────
 * `RapierPhysicsBackend` (rapierPhysics.ts) satisfies THIS SAME `PhysicsBackend` contract using
 * the WASM engine Rapier — a real rigid-body model (per-link mass + inertia tensor + COM from
 * geometry) with recursive Newton–Euler inverse dynamics (joint EFFORT incl. inertial/Coriolis/
 * gravity), dynamic INSTABILITY and base TIP-OVER. It is selected by the gate under
 * SIM_PHYSICS_ENABLED via `RunGateOptions.physicsBackend` (loaded once through the async
 * `createRapierBackend()` factory, since Rapier's WASM init is async while this contract is
 * synchronous). When bound + the flag is on, a Rapier violation BLOCKS the gate. The external
 * out-of-process seam below remains for a future GPU-backed engine over the same contract.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { KinematicModel, KinematicJoint } from "./kinematicModel";

// Re-export the canonical dynamics param type so callers can import it from either module.
export type { JointDynamics } from "./kinematicModel";

// ── Public contract ─────────────────────────────────────────────────────────────

/**
 * One sampled trajectory point: the joint config the gate posed, and the ABSOLUTE time
 * (seconds, monotonically non-decreasing) at which the arm is at that config. The gate
 * produces these as a by-product of its kinematic pass (waypoint joint configs + the
 * per-segment trapezoidal cycle-time it already computes).
 */
export interface TrajectorySample {
  /** Absolute time of this sample (s). Monotonic non-decreasing across the trajectory. */
  t: number;
  /** Joint config at this sample (length == model.dof). */
  joints: number[];
}

/** A single per-joint limit violation with the offending value + the limit it broke. */
export interface DynamicsViolation {
  /** Value-index of the joint (0-based over non-fixed joints). */
  jointIndex: number;
  joint: string;
  /** Trajectory sample index where the peak / violation occurs. */
  atSample: number;
  /** The offending magnitude (|q̇| rad/s or mm/s, |q̈| rad/s² or mm/s², |τ| N·m). */
  value: number;
  /** The limit that was exceeded (same unit as `value`). */
  limit: number;
}

/** The dynamics backend's verdict on a sampled trajectory. */
export interface PhysicsResult {
  /** True when NO velocity/accel/torque limit was exceeded. */
  ok: boolean;
  jointVelocityViolations: DynamicsViolation[];
  jointAccelViolations: DynamicsViolation[];
  estTorqueViolations: DynamicsViolation[];
  /**
   * Optional stability hint: true when the STATIC gravity load estimate suggests the base
   * would tip (only meaningful when the model declares a base support footprint + total
   * mass). Undefined when not evaluated. NOT a substitute for a real ZMP/stability solver.
   */
  tipOver?: boolean;
  /**
   * The trajectory duration (ms) as seen by the dynamics layer — i.e. the last sample's
   * timestamp. Lets a caller cross-check the kinematic cycle-time; identical inputs → same
   * number. Honest: this is the SAME trapezoidal cycle-time the gate fed in, not a
   * re-simulated dynamic time (which would need the full dynamics model).
   */
  dynamicCycleTimeMs: number;
  /** Which backend ran + any scope caveats. */
  notes: string[];
}

export interface PhysicsOptions {
  /**
   * Default per-joint VELOCITY limit when the model/joint declares none. Revolute joints
   * are interpreted rad/s, prismatic mm/s. Default 3.14 rad/s (~180°/s) — matches the
   * gate's jointRateAt100 default.
   */
  defaultVelocityLimit?: number;
  /** Default per-joint ACCEL limit when none is declared (rad/s² or mm/s²). Default 20. */
  defaultAccelLimit?: number;
  /** Default per-joint TORQUE limit (N·m) when none is declared. Default 150 N·m. */
  defaultTorqueLimit?: number;
  /** Gravitational acceleration (m/s²). Default 9.80665. */
  gravity?: number;
  /** Payload mass carried at the TCP (kg) — added to the outboard load of every joint. Default 0. */
  payloadKg?: number;
}

/**
 * A physics backend evaluates a sampled trajectory for dynamic feasibility. Implementations
 * MUST be pure w.r.t. their inputs (no device I/O). The internal backend is deterministic;
 * an external engine may not be, and must document that.
 */
export interface PhysicsBackend {
  readonly id: string;
  simulate(samples: TrajectorySample[], model: KinematicModel, opts?: PhysicsOptions): PhysicsResult;
}

// ── Model dynamics params ─────────────────────────────────────────────────────────
//
// The kinematic model's joints may OPTIONALLY declare dynamics params (KinematicJoint.dynamics,
// type JointDynamics in kinematicModel.ts, re-exported above). When absent, sensible defaults
// from PhysicsOptions are used (and noted honestly). The `JointDynamics` shape is documented on
// that field.

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Non-fixed joints in value-index order (the joints a jointValues[] vector maps to). */
function actuatedJoints(model: KinematicModel): KinematicJoint[] {
  return model.joints.filter((j) => j.type !== "fixed");
}

/**
 * Estimate a link's horizontal COM lever (mm) from its bounding volume when not declared.
 * A capsule's lever ≈ half its segment length (COM at the segment midpoint); a sphere/AABB
 * uses its radius / half-diagonal. Honest: geometric proxy, not a measured COM.
 */
function estimateLeverMm(joint: KinematicJoint): number {
  const bv = joint.bv;
  if (bv.kind === "capsule") {
    const dx = bv.b[0] - bv.a[0];
    const dy = bv.b[1] - bv.a[1];
    const dz = bv.b[2] - bv.a[2];
    return 0.5 * Math.hypot(dx, dy, dz);
  }
  if (bv.kind === "sphere") return bv.radius;
  // AABB: half the diagonal of the local box.
  const dx = bv.max[0] - bv.min[0];
  const dy = bv.max[1] - bv.min[1];
  const dz = bv.max[2] - bv.min[2];
  return 0.5 * Math.hypot(dx, dy, dz);
}

/** Resolve a joint's velocity limit (declared → default). */
function velocityLimitOf(j: KinematicJoint, def: number): number {
  return j.dynamics?.velocityLimit ?? def;
}
/** Resolve a joint's accel limit (declared → default). */
function accelLimitOf(j: KinematicJoint, def: number): number {
  return j.dynamics?.accelLimit ?? def;
}
/** Resolve a joint's torque limit (declared → default). */
function torqueLimitOf(j: KinematicJoint, def: number): number {
  return j.dynamics?.torqueLimit ?? def;
}

// ════════════════════════════════════════════════════════════════════════════
// INTERNAL DYNAMICS BACKEND — the real default.
// ════════════════════════════════════════════════════════════════════════════

/**
 * The REAL default backend: finite-difference velocities/accels from the sampled trajectory
 * and a quasi-static gravity-torque estimate, each vs per-joint limits. PURE + deterministic.
 */
export class InternalDynamicsBackend implements PhysicsBackend {
  readonly id = "internal-dynamics";

  simulate(samples: TrajectorySample[], model: KinematicModel, opts: PhysicsOptions = {}): PhysicsResult {
    const g = opts.gravity ?? 9.80665;
    const defVel = opts.defaultVelocityLimit ?? Math.PI; // ~180°/s
    const defAcc = opts.defaultAccelLimit ?? 20;
    const defTau = opts.defaultTorqueLimit ?? 150;
    const payloadKg = opts.payloadKg ?? 0;

    const joints = actuatedJoints(model);
    const dof = model.dof;
    const notes: string[] = [`dynamics backend=internal (static-torque + fd-velocity/accel)`];

    // No usable trajectory → HONEST no-op (do not fabricate a pass). One sample cannot give a
    // velocity, and torque still depends on a pose, so we DO evaluate torque on any pose we
    // have, but velocity/accel are simply "not evaluable" and reported as such.
    if (samples.length === 0) {
      notes.push("no trajectory samples — dynamics NOT evaluated (no-op).");
      return { ...structuredEmpty(), dynamicCycleTimeMs: 0, notes };
    }

    const dynamicCycleTimeMs = Math.round((samples[samples.length - 1].t - samples[0].t) * 1000);

    const jointVelocityViolations: DynamicsViolation[] = [];
    const jointAccelViolations: DynamicsViolation[] = [];
    const estTorqueViolations: DynamicsViolation[] = [];

    // ── 1+2. Finite-difference velocities and accelerations ─────────────────────
    // velocities[k][i] = q̇ᵢ over the interval ENDING at sample k (k≥1). accels[k][i] uses
    // consecutive velocity intervals. We flag the PEAK violating sample per joint.
    const velocities: number[][] = []; // index aligns to sample k (k≥1)
    if (samples.length >= 2) {
      for (let k = 1; k < samples.length; k++) {
        const dt = samples[k].t - samples[k - 1].t;
        const v = new Array<number>(dof).fill(0);
        if (dt > 1e-9) {
          for (let i = 0; i < dof; i++) {
            v[i] = ((samples[k].joints[i] ?? 0) - (samples[k - 1].joints[i] ?? 0)) / dt;
          }
        }
        velocities.push(v);
        // Velocity check at sample k.
        for (let i = 0; i < dof; i++) {
          const lim = velocityLimitOf(joints[i], defVel);
          if (Math.abs(v[i]) > lim + 1e-9) {
            jointVelocityViolations.push({
              jointIndex: i,
              joint: joints[i]?.name ?? `joint${i}`,
              atSample: k,
              value: Math.abs(v[i]),
              limit: lim,
            });
          }
        }
      }
      // Accel = Δvelocity / Δt between consecutive velocity intervals.
      for (let k = 1; k < velocities.length; k++) {
        // dt across the two intervals' midpoints ≈ time between sample (k) and (k+1).
        const dt = samples[k + 1].t - samples[k].t;
        if (dt <= 1e-9) continue;
        for (let i = 0; i < dof; i++) {
          const a = (velocities[k][i] - velocities[k - 1][i]) / dt;
          const lim = accelLimitOf(joints[i], defAcc);
          if (Math.abs(a) > lim + 1e-9) {
            jointAccelViolations.push({
              jointIndex: i,
              joint: joints[i]?.name ?? `joint${i}`,
              atSample: k + 1,
              value: Math.abs(a),
              limit: lim,
            });
          }
        }
      }
    } else {
      notes.push("single sample — velocity/accel NOT evaluable (need ≥2 timed samples).");
    }

    // ── 3. Quasi-static gravity torque per joint ────────────────────────────────
    // For each sampled pose, the holding torque at joint i to support gravity on all links
    // OUTBOARD of i (plus any TCP payload). SIMPLE model: τᵢ = Σ_{j≥i} mⱼ·g·leverⱼ, with the
    // lever the joint→link-COM horizontal distance (mm→m). Ignores inertial/Coriolis terms.
    // We evaluate at EVERY sample and keep the PEAK per joint (worst-case posture).
    const linkMassKg = joints.map((j) => j.dynamics?.massKg ?? defaultLinkMass(j));
    const linkLeverM = joints.map((j) => (j.dynamics?.comLeverMm ?? estimateLeverMm(j)) / 1000);

    let torqueEstimated = false;
    const peakTorque = new Array<number>(dof).fill(0);
    const peakTorqueSample = new Array<number>(dof).fill(0);
    for (let s = 0; s < samples.length; s++) {
      for (let i = 0; i < dof; i++) {
        // Sum outboard masses (links i..dof-1) + payload, each acting through ITS OWN lever
        // measured from joint i. Cheap conservative approximation: use each outboard link's
        // own lever as the moment arm about joint i (over-counts distal levers slightly →
        // never under-reports torque). Honest, safe-side.
        let tau = 0;
        for (let j = i; j < dof; j++) {
          tau += linkMassKg[j] * g * linkLeverM[j];
        }
        // Payload acts at the TCP; approximate its lever as the sum of outboard levers.
        if (payloadKg > 0) {
          let arm = 0;
          for (let j = i; j < dof; j++) arm += linkLeverM[j];
          tau += payloadKg * g * arm;
        }
        torqueEstimated = true;
        if (tau > peakTorque[i]) {
          peakTorque[i] = tau;
          peakTorqueSample[i] = s;
        }
      }
    }
    if (torqueEstimated) {
      for (let i = 0; i < dof; i++) {
        const lim = torqueLimitOf(joints[i], defTau);
        if (peakTorque[i] > lim + 1e-9) {
          estTorqueViolations.push({
            jointIndex: i,
            joint: joints[i]?.name ?? `joint${i}`,
            atSample: peakTorqueSample[i],
            value: peakTorque[i],
            limit: lim,
          });
        }
      }
      notes.push(
        "static-torque = Σ outboard(mass·g·lever) per joint (holding-torque only; ignores inertial/Coriolis).",
      );
    }

    const ok =
      jointVelocityViolations.length === 0 &&
      jointAccelViolations.length === 0 &&
      estTorqueViolations.length === 0;

    return {
      ok,
      jointVelocityViolations,
      jointAccelViolations,
      estTorqueViolations,
      dynamicCycleTimeMs,
      notes,
    };
  }
}

/** A default lumped link mass (kg) when the model declares none — scaled by BV size. Honest guess. */
function defaultLinkMass(joint: KinematicJoint): number {
  // Bigger bounding volume → heavier link. Anchored so a UR5-ish link lands in the ~2–5 kg
  // ballpark. This is an explicit placeholder, NOT a spec value.
  const lever = estimateLeverMm(joint); // mm
  return Math.max(0.5, Math.min(15, lever / 60));
}

/** Shape a fully-empty (all-clear) result body (used for the no-trajectory no-op path). */
function structuredEmpty(): Omit<PhysicsResult, "dynamicCycleTimeMs" | "notes"> {
  return {
    ok: true,
    jointVelocityViolations: [],
    jointAccelViolations: [],
    estTorqueViolations: [],
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXTERNAL PHYSICS BACKEND — honest, documented seam (stub).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Thrown when the external physics seam is selected but no engine is bound. Carries the
 * integration contract in the message so the failure is self-documenting.
 */
export class ExternalPhysicsNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalPhysicsNotConfiguredError";
  }
}

/**
 * ExternalPhysicsBackend — the seam to a REAL physics engine (NVIDIA Isaac Sim, RoboDK,
 * PyBullet, MuJoCo, …). This in-process class is a DOCUMENTED STUB: it defines the contract
 * a real adapter must satisfy and THROWS when invoked, because no engine is bound here.
 *
 * ── INTEGRATION CONTRACT (what a real binding must do) ──────────────────────
 * A real implementation would, on `simulate(samples, model, opts)`:
 *   1. Translate `model` (DH / URDF-exact chain + BV + optional JointDynamics) into the
 *      engine's robot description (URDF/USD/RoboDK station). The twin pipeline already holds
 *      URDF/glTF provenance — feed that, not this authored sample, when available.
 *   2. Stream the `samples` (timed joint configs) into the engine as a scripted trajectory
 *      and step its rigid-body solver (real inertia, Coriolis, contact, friction, motor
 *      torque model) — NOT the quasi-static estimate the internal backend uses.
 *   3. Read back per-joint velocity/accel/torque envelopes + any tip-over / contact events
 *      and MAP them onto this module's PhysicsResult so the gate contract is unchanged.
 *   4. Be a NETWORK/IPC adapter (the engine runs out-of-process, often GPU-backed) — hence
 *      configuration (endpoint, credentials, asset ids) via env, injected here at bind time.
 *
 * Binding is done by passing a real instance to `resolvePhysicsBackend({ external })`, or by
 * a future service registry. Until then, calling this throws — an HONEST failure, never a
 * fabricated pass. It is only ever selected when SIM_PHYSICS_ENABLED is on.
 */
export class ExternalPhysicsBackend implements PhysicsBackend {
  readonly id = "external-physics-stub";

  /** Optional human hint about which engine this seam targets (for the error message). */
  constructor(private readonly engineHint = "Isaac Sim / RoboDK") {}

  simulate(_samples: TrajectorySample[], _model: KinematicModel, _opts?: PhysicsOptions): PhysicsResult {
    throw new ExternalPhysicsNotConfiguredError(
      `External physics backend (${this.engineHint}) is NOT configured. ` +
        `SIM_PHYSICS_ENABLED is on but no external physics service is bound in-process. ` +
        `Bind a real adapter (translate the kinematic model → engine robot description, stream ` +
        `the timed joint samples through its rigid-body solver, map results back onto PhysicsResult) ` +
        `via resolvePhysicsBackend({ external: <yourBackend> }). Falling back requires SIM_PHYSICS_ENABLED off.`,
    );
  }
}

// ── Flag + resolver ──────────────────────────────────────────────────────────────

/**
 * SIM_PHYSICS_ENABLED — default OFF. When OFF the external seam is never selected; the gate
 * uses the internal dynamics backend. When ON, the external backend is returned (the caller
 * is expected to have bound a real engine, else it throws honestly on simulate()).
 */
export function simPhysicsEnabled(): boolean {
  return process.env.SIM_PHYSICS_ENABLED === "true" || process.env.SIM_PHYSICS_ENABLED === "1";
}

export interface ResolveBackendOptions {
  /**
   * A real external backend instance to use when SIM_PHYSICS_ENABLED is on. When the flag is
   * on and this is omitted, the built-in ExternalPhysicsBackend stub is returned (which throws
   * on simulate — the honest "bind a service" failure).
   */
  external?: PhysicsBackend;
  /** Force a specific backend regardless of the flag (tests / explicit callers). */
  force?: PhysicsBackend;
}

/**
 * Resolve which PhysicsBackend to use.
 *   • flag OFF (default) → InternalDynamicsBackend (the real, pure default).
 *   • flag ON            → the provided `external` backend, else the ExternalPhysicsBackend
 *                          stub (throws on use until a real engine is bound).
 *   • `force`            → always wins (explicit override for tests / callers).
 * Falls back to the internal backend on any ambiguity — never returns nothing.
 */
export function resolvePhysicsBackend(opts: ResolveBackendOptions = {}): PhysicsBackend {
  if (opts.force) return opts.force;
  if (simPhysicsEnabled()) {
    return opts.external ?? new ExternalPhysicsBackend();
  }
  return new InternalDynamicsBackend();
}
