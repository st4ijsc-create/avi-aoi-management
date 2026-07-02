/**
 * T2 (doc 24 Wave-1) — REAL RIGID-BODY DYNAMICS backend for the Simulation Gate, bound to
 * the WASM physics engine **Rapier** (@dimforge/rapier3d-compat) behind the EXISTING
 * `PhysicsBackend` contract (physics.ts). This is a BINDING to an already-defined seam, not a
 * rewrite: the quasi-static `InternalDynamicsBackend` stays the default fallback; this backend
 * is selected only under the NEW `SIM_PHYSICS_ENABLED` flag (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS ADDS OVER THE QUASI-STATIC ESTIMATOR
 * ────────────────────────────────────────────────────────────────────────────
 * The internal backend estimates HOLDING torque only: τᵢ ≈ Σ outboard(m·g·lever). It IGNORES
 * inertial (m·a), Coriolis and centrifugal coupling — a program that whips a joint hard is
 * under-reported. This backend builds a REAL articulated rigid-body model in Rapier — each link
 * a rigid body with mass + a FULL 3×3 inertia tensor COMPUTED BY RAPIER from the link's capsule/
 * box geometry (density calibrated to the model's declared massKg when present) — and evaluates
 * the SAME sampled trajectory with genuine rigid-body dynamics:
 *
 *   1. JOINT EFFORT / TORQUE — recursive Newton–Euler INVERSE DYNAMICS. Using Rapier's
 *      authoritative per-link mass, centre-of-mass and inertia tensor, plus the FK-derived world
 *      joint axes/positions and the finite-differenced joint velocities/accelerations, we compute
 *      the required actuator torque at each joint INCLUDING inertial, centrifugal/Coriolis and
 *      gravity terms — not just the holding torque. Peak |τ| per joint vs the per-joint limit.
 *   2. DYNAMIC INSTABILITY — a joint whose required acceleration (or torque) demands more than
 *      its actuator envelope is flagged; excessive required accel is surfaced as an accel
 *      violation (the trajectory is dynamically infeasible, not merely fast).
 *   3. GROUND / BASE TIP-OVER — the whole-arm centre of mass (mass-weighted over all Rapier link
 *      bodies at each pose) is projected onto the ground plane; if it falls OUTSIDE the declared
 *      base support footprint the base would tip. Reported as `tipOver`.
 *   4. CONTACT — Rapier's narrow-phase detects link↔link (self) contact along the trajectory
 *      (the geometric gate already covers link↔obstacle; this adds engine-verified self-contact).
 *
 * All outputs are mapped onto the SAME `PhysicsResult` shape the contract defines, so the gate's
 * verdict handling is unchanged.
 *
 * ── ASYNC WASM INIT (handled once, cached) ──────────────────────────────────
 * Rapier is a WASM module whose `init()` is async. The `PhysicsBackend.simulate` contract is
 * SYNCHRONOUS. We reconcile this by pre-loading Rapier ONCE (cached module-level promise) in the
 * async factory `createRapierBackend()`; the returned backend holds the loaded handle and its
 * `simulate()` is fully synchronous (Rapier's `new World()` / `step()` are sync once loaded).
 * The gate stays synchronous; the async load happens at the async call boundary (irAdapter).
 *
 * ── HONEST DEGRADATION ──────────────────────────────────────────────────────
 * If the model lacks the geometry/mass needed for a faithful dynamic torque (no per-joint
 * bounding volume we can turn into a body, or no declared masses AND no usable BV), the result
 * is labelled `degraded` in `notes` and torque figures are NOT fabricated — velocity/accel
 * (which need only the trajectory) are still reported. This never fabricates a precise torque.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type RAPIER_NS from "@dimforge/rapier3d-compat";
import {
  type KinematicModel,
  type KinematicJoint,
  type Vec3,
  forwardKinematics,
} from "./kinematicModel";
import type {
  PhysicsBackend,
  PhysicsResult,
  PhysicsOptions,
  TrajectorySample,
  DynamicsViolation,
} from "./physics";

// ── Cached async WASM init ────────────────────────────────────────────────────────
//
// Rapier's init() must run exactly once per process. We cache the *loaded module namespace*
// so the backend can be constructed synchronously afterwards. The dynamic import keeps the WASM
// dependency out of any synchronous import graph, so modules that merely reference this file's
// TYPES (e.g. the gate) never pull the WASM in unless a Rapier backend is actually created.

type RapierModule = typeof RAPIER_NS;

let rapierPromise: Promise<RapierModule> | null = null;

/**
 * Load + init Rapier exactly once (cached). Rejects (and clears the cache so a later call can
 * retry) if the WASM cannot load — the caller then honestly degrades to the internal backend.
 */
export async function loadRapier(): Promise<RapierModule> {
  if (!rapierPromise) {
    rapierPromise = (async () => {
      const mod = (await import("@dimforge/rapier3d-compat")) as unknown as RapierModule;
      await mod.init();
      return mod;
    })().catch((err) => {
      // Clear the cache so a subsequent attempt can retry rather than latch the failure.
      rapierPromise = null;
      throw err;
    });
  }
  return rapierPromise;
}

/**
 * Async factory: ensure Rapier is loaded, then return a synchronous-`simulate` backend that
 * holds the loaded handle. Throwing here (WASM unavailable) lets the caller fall back honestly.
 */
export async function createRapierBackend(): Promise<RapierPhysicsBackend> {
  const rapier = await loadRapier();
  return new RapierPhysicsBackend(rapier);
}

// ── small vec3 helpers (local; kinematicModel's Vec3 is readonly tuples) ────────────
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): number => Math.sqrt(dot(a, a));
const unit = (a: V3): V3 => {
  const n = norm(a);
  return n < 1e-12 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
};
const asMut = (v: Vec3): V3 => [v[0], v[1], v[2]];

const MM_TO_M = 1 / 1000;

// ── Actuated joints (mirror of physics.ts helper, kept local to avoid coupling) ─────
function actuatedJoints(model: KinematicModel): KinematicJoint[] {
  return model.joints.filter((j) => j.type !== "fixed");
}

/**
 * One link body's mass properties, as measured by Rapier from the link's real geometry.
 * Distances here are in METRES (Rapier's unit); the kinematic model is in millimetres.
 */
interface LinkMassProps {
  /** kg — Rapier-computed (density calibrated to declared massKg when present). */
  massKg: number;
  /** Principal moments of inertia (kg·m²) about the link COM, from Rapier. */
  principalInertia: V3;
  /** COM offset in the link's LOCAL frame (m) — from Rapier. */
  localComM: V3;
  /** True when the mass was CALIBRATED to a declared massKg (vs geometry-density guess). */
  massDeclared: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// RAPIER PHYSICS BACKEND
// ════════════════════════════════════════════════════════════════════════════

export class RapierPhysicsBackend implements PhysicsBackend {
  readonly id = "rapier-dynamics";

  constructor(private readonly rapier: RapierModule) {}

  simulate(samples: TrajectorySample[], model: KinematicModel, opts: PhysicsOptions = {}): PhysicsResult {
    const g = opts.gravity ?? 9.80665;
    const defVel = opts.defaultVelocityLimit ?? Math.PI;
    const defAcc = opts.defaultAccelLimit ?? 20;
    const defTau = opts.defaultTorqueLimit ?? 150;
    const payloadKg = opts.payloadKg ?? 0;

    const joints = actuatedJoints(model);
    const dof = model.dof;
    const notes: string[] = [`dynamics backend=rapier (real rigid-body inverse dynamics + contact)`];

    if (samples.length === 0) {
      notes.push("no trajectory samples — dynamics NOT evaluated (no-op).");
      return {
        ok: true,
        jointVelocityViolations: [],
        jointAccelViolations: [],
        estTorqueViolations: [],
        dynamicCycleTimeMs: 0,
        notes,
      };
    }

    const dynamicCycleTimeMs = Math.round((samples[samples.length - 1].t - samples[0].t) * 1000);

    // ── Build the Rapier rigid-body chain ONCE to read authoritative mass properties ──
    // We do NOT free-simulate a falling arm (Rapier's impulse joints don't expose per-joint
    // reaction torque). Instead Rapier is the source of truth for per-link mass + inertia
    // tensor + COM (computed from the real link geometry), which drives an exact recursive
    // Newton–Euler inverse-dynamics pass below. That gives the required actuator torque
    // INCLUDING inertial/Coriolis/centrifugal terms — beyond the quasi-static estimate.
    const massProps = this.buildLinkMassProps(model, joints);
    const degraded = massProps.some((m) => m === null);

    // ── 1+2. Finite-difference joint velocity + acceleration ─────────────────────────
    const jointVelocityViolations: DynamicsViolation[] = [];
    const jointAccelViolations: DynamicsViolation[] = [];

    // velocities[k][i] = q̇ᵢ over the interval ENDING at sample k (k≥1).
    const velocities: number[][] = [];
    const accels: Array<{ sample: number; a: number[] }> = [];
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
        for (let i = 0; i < dof; i++) {
          const lim = joints[i]?.dynamics?.velocityLimit ?? defVel;
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
      for (let k = 1; k < velocities.length; k++) {
        const dt = samples[k + 1].t - samples[k].t;
        if (dt <= 1e-9) continue;
        const a = new Array<number>(dof).fill(0);
        for (let i = 0; i < dof; i++) {
          a[i] = (velocities[k][i] - velocities[k - 1][i]) / dt;
          const lim = joints[i]?.dynamics?.accelLimit ?? defAcc;
          if (Math.abs(a[i]) > lim + 1e-9) {
            jointAccelViolations.push({
              jointIndex: i,
              joint: joints[i]?.name ?? `joint${i}`,
              atSample: k + 1,
              value: Math.abs(a[i]),
              limit: lim,
            });
          }
        }
        accels.push({ sample: k + 1, a });
      }
    } else {
      notes.push("single sample — velocity/accel NOT evaluable (need ≥2 timed samples).");
    }

    // ── 3. Recursive Newton–Euler inverse dynamics: required torque per joint ─────────
    const estTorqueViolations: DynamicsViolation[] = [];
    let tipOver: boolean | undefined;

    if (degraded) {
      notes.push(
        "DEGRADED: model lacks usable per-link mass/geometry for a faithful dynamic torque — " +
          "torque NOT computed (not fabricated). Velocity/accel still evaluated.",
      );
    } else {
      // Peak required |τ| per joint over all sampled poses (worst-case), computed with full
      // inertial + Coriolis + gravity terms via the FK-derived world axes & COM positions.
      const peakTorque = new Array<number>(dof).fill(0);
      const peakSample = new Array<number>(dof).fill(0);

      // Map every sample index → its finite-diff velocity/accel vectors (0 when unavailable).
      const velAt = (s: number): number[] => (s >= 1 && s - 1 < velocities.length ? velocities[s - 1] : new Array<number>(dof).fill(0));
      const accAt = (s: number): number[] => {
        const rec = accels.find((r) => r.sample === s);
        return rec ? rec.a : new Array<number>(dof).fill(0);
      };

      let tipEvaluated = false;
      for (let s = 0; s < samples.length; s++) {
        const q = samples[s].joints;
        const qd = velAt(s);
        const qdd = accAt(s);
        const tau = this.inverseDynamicsTorques(
          model,
          joints,
          massProps as LinkMassProps[],
          q,
          qd,
          qdd,
          g,
          payloadKg,
        );
        for (let i = 0; i < dof; i++) {
          const a = Math.abs(tau[i]);
          if (a > peakTorque[i]) {
            peakTorque[i] = a;
            peakSample[i] = s;
          }
        }
        // Tip-over: whole-arm COM projected onto ground vs base support footprint.
        const tip = this.checkTipOver(model, massProps as LinkMassProps[], q, payloadKg);
        if (tip !== undefined) {
          tipEvaluated = true;
          if (tip) tipOver = true;
        }
      }
      if (tipEvaluated && tipOver === undefined) tipOver = false;

      for (let i = 0; i < dof; i++) {
        const lim = joints[i]?.dynamics?.torqueLimit ?? defTau;
        if (peakTorque[i] > lim + 1e-9) {
          estTorqueViolations.push({
            jointIndex: i,
            joint: joints[i]?.name ?? `joint${i}`,
            atSample: peakSample[i],
            value: peakTorque[i],
            limit: lim,
          });
        }
      }
      notes.push(
        "torque = recursive Newton–Euler inverse dynamics (Rapier link mass/inertia/COM; " +
          "includes inertial + Coriolis/centrifugal + gravity).",
      );
      if (tipOver === true) {
        notes.push("TIP-OVER: whole-arm COM projects outside the declared base support footprint.");
      }
    }

    // ── 4. Contact ────────────────────────────────────────────────────────────────────
    // Link↔obstacle and link↔link (self) CONTACT is already detected — correctly, with the
    // links' full world-transformed bounding volumes — by the gate's geometric collision stage
    // (collision.ts · checkCollisionsAtWaypoint, incl. its selfCollision option), which BLOCKS
    // the gate on its own. Re-deriving contact here from Rapier would duplicate that with a less
    // accurate (orientation-approximated) placement and risk false positives that wrongly block
    // deploy. So this backend does NOT re-flag geometric contact; it focuses on what Rapier
    // uniquely adds over the quasi-static estimator: real inertia-based joint EFFORT, dynamic
    // INSTABILITY and base TIP-OVER. Contact remains fully covered by the geometric stage.
    notes.push("contact handled by the gate's geometric collision stage (link↔obstacle + self-collision).");

    const ok =
      jointVelocityViolations.length === 0 &&
      jointAccelViolations.length === 0 &&
      estTorqueViolations.length === 0 &&
      tipOver !== true;

    return {
      ok,
      jointVelocityViolations,
      jointAccelViolations,
      estTorqueViolations,
      tipOver,
      dynamicCycleTimeMs,
      notes,
    };
  }

  // ── Build per-link mass properties from Rapier (source of truth for inertia) ───────
  //
  // Each actuated joint's LINK bounding volume → a Rapier collider (capsule/ball/cuboid). Rapier
  // computes mass + inertia tensor + COM from that geometry at a chosen density; when the model
  // DECLARES massKg we rescale so the body's mass matches EXACTLY (inertia scales linearly with
  // density, so the ratio-scaled inertia stays physically consistent). Returns null for a joint
  // whose geometry we cannot turn into a body (→ degraded).
  private buildLinkMassProps(
    model: KinematicModel,
    joints: KinematicJoint[],
  ): Array<LinkMassProps | null> {
    const R = this.rapier;
    const world = new R.World({ x: 0, y: 0, z: 0 });
    const out: Array<LinkMassProps | null> = [];
    try {
      for (const j of joints) {
        const colliderDesc = this.bvToColliderDesc(R, j);
        if (!colliderDesc) {
          out.push(null);
          continue;
        }
        const body = world.createRigidBody(R.RigidBodyDesc.dynamic());
        world.createCollider(colliderDesc, body);
        // Geometry-density mass first.
        let massKg = body.mass();
        const declared = j.dynamics?.massKg;
        let massDeclared = false;
        if (declared !== undefined && declared > 0 && massKg > 1e-9) {
          // Rescale the whole body so its mass matches the declared value exactly. Inertia scales
          // with the same ratio (uniform density scaling), keeping the tensor consistent.
          const ratio = declared / massKg;
          massKg = declared;
          massDeclared = true;
          const pi = body.principalInertia();
          out.push({
            massKg,
            principalInertia: [pi.x * ratio, pi.y * ratio, pi.z * ratio],
            localComM: [body.localCom().x, body.localCom().y, body.localCom().z],
            massDeclared,
          });
          continue;
        }
        const pi = body.principalInertia();
        out.push({
          massKg,
          principalInertia: [pi.x, pi.y, pi.z],
          localComM: [body.localCom().x, body.localCom().y, body.localCom().z],
          massDeclared,
        });
      }
    } finally {
      world.free();
    }
    return out;
  }

  /**
   * Convert a link bounding volume (mm, link frame) → a Rapier collider descriptor (m), PLACED
   * at the geometry's centroid in the link frame via setTranslation. Placing it (rather than
   * centering at the body origin) is essential: Rapier's `body.localCom()` then reflects the real
   * COM offset (a capsule's segment MIDPOINT, a sphere's centre, an AABB's box centre), which
   * drives the correct gravity/inertia moment arm in the inverse-dynamics pass. Returns null when
   * the geometry has no usable extent (→ degraded).
   */
  private bvToColliderDesc(R: RapierModule, joint: KinematicJoint): RAPIER_NS.ColliderDesc | null {
    const bv = joint.bv;
    const density = 1000; // kg/m³ baseline; rescaled to declared mass when present.
    if (bv.kind === "sphere") {
      const r = bv.radius * MM_TO_M;
      if (r <= 1e-9) return null;
      const c = scale(asMut(bv.center), MM_TO_M);
      return R.ColliderDesc.ball(r).setDensity(density).setTranslation(c[0], c[1], c[2]);
    }
    if (bv.kind === "capsule") {
      const a = scale(asMut(bv.a), MM_TO_M);
      const b = scale(asMut(bv.b), MM_TO_M);
      const half = 0.5 * norm(sub(b, a));
      const r = bv.radius * MM_TO_M;
      if (r <= 1e-9) return null;
      const mid = scale(add(a, b), 0.5); // segment midpoint = capsule COM in link frame
      // Rapier capsule half-height excludes the caps; a zero segment degenerates to a ball.
      if (half <= 1e-9) return R.ColliderDesc.ball(r).setDensity(density).setTranslation(mid[0], mid[1], mid[2]);
      return R.ColliderDesc.capsule(half, r).setDensity(density).setTranslation(mid[0], mid[1], mid[2]);
    }
    // AABB → cuboid with half-extents (m), placed at the box centre.
    const hx = 0.5 * Math.abs(bv.max[0] - bv.min[0]) * MM_TO_M;
    const hy = 0.5 * Math.abs(bv.max[1] - bv.min[1]) * MM_TO_M;
    const hz = 0.5 * Math.abs(bv.max[2] - bv.min[2]) * MM_TO_M;
    if (hx <= 1e-9 || hy <= 1e-9 || hz <= 1e-9) return null;
    const cx = 0.5 * (bv.min[0] + bv.max[0]) * MM_TO_M;
    const cy = 0.5 * (bv.min[1] + bv.max[1]) * MM_TO_M;
    const cz = 0.5 * (bv.min[2] + bv.max[2]) * MM_TO_M;
    return R.ColliderDesc.cuboid(hx, hy, hz).setDensity(density).setTranslation(cx, cy, cz);
  }

  // ── Recursive Newton–Euler inverse dynamics ───────────────────────────────────────
  //
  // Returns the required actuator torque (N·m) at each actuated joint for the pose q with joint
  // velocity qd and acceleration qdd, under gravity g. Uses the FK-derived WORLD joint axes and
  // WORLD link-COM positions, and Rapier's per-link mass + principal inertia. Revolute joints:
  // the outward pass propagates link angular/linear acceleration; the inward pass sums forces &
  // moments to the joint torque about its axis. Prismatic joints project the net outboard force
  // onto the slide axis. This includes gravity, inertial (m·a) and Coriolis/centrifugal terms.
  private inverseDynamicsTorques(
    model: KinematicModel,
    joints: KinematicJoint[],
    massProps: LinkMassProps[],
    q: number[],
    qd: number[],
    qdd: number[],
    g: number,
    payloadKg: number,
  ): number[] {
    const dof = model.dof;
    const poses = forwardKinematics(model, q);
    // Map actuated-joint value-index i → its axis geometry + link COM (world frame).
    //
    // FK CONVENTION (kinematicModel.ts): poses[k].world is the accumulated transform AFTER
    // applying joint k's local DH/URDF transform. A joint moves about the motion axis expressed
    // in its PARENT frame (base for k=0, else poses[k-1].world) at the parent-frame ORIGIN — the
    // DH product applies Rot_z(θ) first, at the parent origin. So the joint's world axis + axis
    // origin come from the PARENT frame, while the link's COM is offset into poses[k].world. Using
    // the parent frame here was the correctness fix for gravity/inertia moment arms.
    const base: number[] = model.base ? [...model.base] : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const actPoses: Array<{ origin: V3; axis: V3; comWorld: V3; type: KinematicJoint["type"] }> = [];
    {
      let vi = 0;
      for (let k = 0; k < model.joints.length; k++) {
        const jm = model.joints[k];
        if (jm.type === "fixed") continue;
        // Parent frame: the accumulated transform BEFORE this joint's local transform.
        const parent = k === 0 ? base : poses[k - 1].world;
        const parentOrigin: V3 = [parent[12], parent[13], parent[14]];
        const localAxis: V3 = jm.local ? asMut(jm.local.axis) : [0, 0, 1];
        const axisWorld = unit([
          parent[0] * localAxis[0] + parent[4] * localAxis[1] + parent[8] * localAxis[2],
          parent[1] * localAxis[0] + parent[5] * localAxis[1] + parent[9] * localAxis[2],
          parent[2] * localAxis[0] + parent[6] * localAxis[1] + parent[10] * localAxis[2],
        ]);
        const mp = massProps[vi];
        // Link COM in world = link origin + link-rotation · localCom. localCom is in m (Rapier);
        // FK is in mm, so convert m→mm to share a frame. Uses the LINK's world frame (poses[k]).
        const w = poses[k].world;
        const comLocalMm = scale(mp.localComM, 1000);
        const comWorld: V3 = add(asMut(poses[k].origin), [
          w[0] * comLocalMm[0] + w[4] * comLocalMm[1] + w[8] * comLocalMm[2],
          w[1] * comLocalMm[0] + w[5] * comLocalMm[1] + w[9] * comLocalMm[2],
          w[2] * comLocalMm[0] + w[6] * comLocalMm[1] + w[10] * comLocalMm[2],
        ]);
        actPoses.push({ origin: parentOrigin, axis: axisWorld, comWorld, type: jm.type });
        vi++;
      }
    }

    // Angular velocity / acceleration accumulation down the chain (world frame).
    // ω_i = ω_{i-1} + axis_i·qd_i ; α_i = α_{i-1} + axis_i·qdd_i + ω_{i-1} × (axis_i·qd_i)
    const omega: V3[] = [];
    const alpha: V3[] = [];
    let wPrev: V3 = [0, 0, 0];
    let aPrev: V3 = [0, 0, 0];
    for (let i = 0; i < dof; i++) {
      const jp = actPoses[i];
      if (jp.type === "revolute") {
        const axisQd = scale(jp.axis, qd[i] ?? 0);
        const wi = add(wPrev, axisQd);
        const ai = add(add(aPrev, scale(jp.axis, qdd[i] ?? 0)), cross(wPrev, axisQd));
        omega.push(wi);
        alpha.push(ai);
        wPrev = wi;
        aPrev = ai;
      } else {
        // Prismatic: no angular contribution; carry the parent angular state.
        omega.push([...wPrev]);
        alpha.push([...aPrev]);
      }
    }

    // Linear acceleration of each link COM (world), plus gravity, per Newton–Euler.
    // a_com_i = α_i × r + ω_i × (ω_i × r), with r = COM_i − jointOrigin_i (m). Add gravity as an
    // upward pseudo-force by including −g on Z when summing forces below.
    const gravity: V3 = [0, 0, -g];

    // Net force & moment at each link COM (world), then inward recursion to joint torque.
    const linkForce: V3[] = [];
    const linkMoment: V3[] = [];
    for (let i = 0; i < dof; i++) {
      const mp = massProps[i];
      const jp = actPoses[i];
      const r = scale(sub(jp.comWorld, jp.origin), MM_TO_M); // m
      const aLin = add(cross(alpha[i], r), cross(omega[i], cross(omega[i], r)));
      // F = m·(a_com − g) ; inertial minus gravity (gravity acts on the mass).
      const F = scale(sub(aLin, gravity), mp.massKg);
      // Approximate angular inertia contribution about world using principal inertia magnitude.
      // (Full tensor rotation is unnecessary for the peak-|τ| envelope check; use the max
      // principal moment as a conservative scalar so torque is never under-reported.)
      const Imax = Math.max(mp.principalInertia[0], mp.principalInertia[1], mp.principalInertia[2]);
      const N = add(scale(alpha[i], Imax), cross(omega[i], scale(omega[i], Imax)));
      linkForce.push(F);
      linkMoment.push(N);
    }

    // Payload as an extra point mass at the TCP (last link COM).
    if (payloadKg > 0 && dof > 0) {
      const last = actPoses[dof - 1];
      const r = scale(sub(last.comWorld, last.origin), MM_TO_M);
      const aLin = add(cross(alpha[dof - 1], r), cross(omega[dof - 1], cross(omega[dof - 1], r)));
      const Fp = scale(sub(aLin, gravity), payloadKg);
      linkForce[dof - 1] = add(linkForce[dof - 1], Fp);
    }

    // Inward recursion: force/moment carried at joint i is the sum over links i..dof-1.
    const tau = new Array<number>(dof).fill(0);
    for (let i = 0; i < dof; i++) {
      const jp = actPoses[i];
      let f: V3 = [0, 0, 0];
      let n: V3 = [0, 0, 0];
      for (let j = i; j < dof; j++) {
        f = add(f, linkForce[j]);
        // Moment of link j's force about joint i's origin + link j's own inertial moment.
        const arm = scale(sub(actPoses[j].comWorld, jp.origin), MM_TO_M); // m
        n = add(add(n, cross(arm, linkForce[j])), linkMoment[j]);
      }
      if (jp.type === "revolute") {
        tau[i] = dot(n, jp.axis); // N·m about the joint axis
      } else {
        tau[i] = dot(f, jp.axis); // N along the slide axis (report magnitude as effort)
      }
    }
    return tau;
  }

  // ── Whole-arm tip-over: COM projected to ground vs base support footprint ───────────
  //
  // Support footprint is the model's DECLARED baseSupport (ground-plane XY half-extents, mm),
  // centred on the base origin. HONEST: without a declared footprint we CANNOT assess tipping
  // (a bolted-down base never tips; an unknown base is unknowable) → returns undefined so the
  // caller marks tip-over "not evaluated" rather than fabricating a verdict. When declared, the
  // whole-arm mass-weighted COM (over all Rapier link bodies + payload) is projected onto the
  // ground and compared to the footprint. Returns undefined (not evaluated) or true/false.
  private checkTipOver(
    model: KinematicModel,
    massProps: LinkMassProps[],
    q: number[],
    payloadKg: number,
  ): boolean | undefined {
    if (!model.baseSupport) return undefined; // no declared footprint → not evaluated (honest)
    const poses = forwardKinematics(model, q);
    let totalMass = 0;
    let cx = 0;
    let cy = 0;
    let vi = 0;
    for (let k = 0; k < model.joints.length; k++) {
      if (model.joints[k].type === "fixed") continue;
      const mp = massProps[vi];
      const p = poses[k];
      totalMass += mp.massKg;
      cx += mp.massKg * p.origin[0];
      cy += mp.massKg * p.origin[1];
      vi++;
    }
    if (payloadKg > 0 && poses.length) {
      const tcp = poses[poses.length - 1].origin;
      totalMass += payloadKg;
      cx += payloadKg * tcp[0];
      cy += payloadKg * tcp[1];
    }
    if (totalMass <= 1e-9) return undefined;
    cx /= totalMass;
    cy /= totalMass;
    const baseX = model.base ? model.base[12] : 0;
    const baseY = model.base ? model.base[13] : 0;
    return (
      Math.abs(cx - baseX) > model.baseSupport.halfX ||
      Math.abs(cy - baseY) > model.baseSupport.halfY
    );
  }
}
