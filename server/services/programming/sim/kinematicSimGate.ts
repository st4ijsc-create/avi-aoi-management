/**
 * T2b (doc 20 §1/§5 · doc 16 §11.2) — KINEMATIC SIMULATION GATE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The REAL Simulation Gate that replaces D1's structural-preview simulate() STUB when
 * SIM_KINEMATIC_ENABLED is on. Given an IR Flow + a target kinematic model + a scene
 * (obstacles + safety zones), it:
 *   1. samples the motion into WAYPOINTS (interpolating move_joint in joint-space and
 *      move_linear in Cartesian-space, per speed/blend),
 *   2. runs forward-kinematics at each waypoint,
 *   3. checks: geometric COLLISION, JOINT-LIMIT violations, WORKSPACE bound,
 *      SAFETY-ZONE intrusion (a link entering a human_shared/safety zone volume), and
 *   4. estimates CYCLE-TIME (sum of segment times from speed + distance + a simple
 *      trapezoidal accel model).
 *
 * Returns EXACTLY the design's Simulation-Gate contract:
 *   { pass, collision_events, joint_limit_violations, cycle_time_actual,
 *     safety_zone_violations, waypointsChecked }
 * `pass` = no collisions AND no joint-limit violations AND no safety-zone violations.
 *
 * ── DYNAMICS-AWARE layer (additive, physics.ts) ─────────────────────────────
 *   • After the kinematic pass, an INTERNAL dynamics backend runs on the SAME sampled
 *     trajectory: finite-difference joint VELOCITY + ACCEL vs per-joint limits, and a
 *     quasi-static gravity TORQUE estimate vs a torque limit. This is ADDITIVE — it sets
 *     new `dynamicsPass` / `dynamics` / `dynamics_reasons` fields and NEVER changes `pass`
 *     (existing callers are unaffected). Runs under the SAME SIM_KINEMATIC_ENABLED gate.
 *   • An EXTERNAL physics seam (Isaac Sim / RoboDK) is behind SIM_PHYSICS_ENABLED (default
 *     OFF → internal backend). See physics.ts for the honest stub + integration contract.
 *   • Still NOT a full rigid-body contact-dynamics engine (no inertia/Coriolis/contact).
 *
 * ── HONEST scope / seams ────────────────────────────────────────────────────
 *   • KINEMATIC + quasi-static dynamics, not full contact dynamics — swappable engine.
 *   • move_joint drives REAL FK (joint values → link poses → collision). move_linear
 *     carries a Cartesian target; the gate now SAMPLES waypoints along the Cartesian path
 *     and solves NUMERICAL INVERSE KINEMATICS (ik.ts, DLS) at each, seeded from the previous
 *     solution for path continuity, then runs the SAME full-arm collision / joint-limit /
 *     workspace / safety-zone checks as move_joint. If IK cannot reach a waypoint it is a
 *     REACHABILITY failure (pass:false) — never a silent pass.
 *   • IK is numerical, single-arm, position-target, no redundancy resolution beyond seeding
 *     (documented in ik.ts). Sample models until real URDF (T2a). No hardware, no device path.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { walkBlocks, type Flow, type IrBlock, type Pose } from "../ir/irModel";
import {
  type KinematicModel,
  type Vec3,
  forwardKinematics,
  checkJointLimits,
  resolveKinematicModel,
} from "./kinematicModel";
import { solveIk } from "./ik";
import {
  type Obstacle,
  type CollisionEvent,
  checkCollisionsAtWaypoint,
} from "./collision";
import {
  type TrajectorySample,
  type PhysicsResult,
  type PhysicsOptions,
  type PhysicsBackend,
  InternalDynamicsBackend,
  simPhysicsEnabled,
} from "./physics";

// ── Contract types ──────────────────────────────────────────────────────────────

export interface JointLimitViolation {
  atWaypoint: number;
  joint: string;
  value: number;
  min: number;
  max: number;
}

export interface SafetyZoneViolation {
  atWaypoint: number;
  link: string;
  zoneId: string;
  zoneType: string;
  distance: number;
}

/** The EXACT Simulation-Gate contract the design (doc 20 §1) specifies. */
export interface SimGateResult {
  pass: boolean;
  collision_events: CollisionEvent[];
  joint_limit_violations: JointLimitViolation[];
  cycle_time_actual: number; // seconds
  safety_zone_violations: SafetyZoneViolation[];
  waypointsChecked: number;
  /** Honest provenance — engine, model, and any scope caveats. NOT part of the pure contract. */
  note?: string;

  // ── ADDITIVE dynamics layer (physics.ts) — backward-compatible ──────────────────
  // These fields are NEW. Callers that only read the kinematic contract above are
  // unaffected: `pass` keeps its original meaning (collision/limit/zone only). A dynamics
  // violation sets `dynamicsPass:false` + reasons WITHOUT flipping `pass`, so existing
  // gating logic is unchanged while dynamics-aware callers can additionally require
  // `dynamicsPass`. Undefined when no model / dynamics did not run (honest no-op).

  /**
   * True when the dynamics backend found NO velocity/accel/torque violation on the
   * sampled trajectory. Undefined when dynamics was not evaluated (no samples). NEVER
   * fabricated — a no-op leaves it undefined rather than true.
   */
  dynamicsPass?: boolean;
  /** The full dynamics verdict (velocity/accel/torque violations + notes). Undefined when not run. */
  dynamics?: PhysicsResult;
  /** Human-readable dynamics violation reasons (empty when clean / not run). */
  dynamics_reasons?: string[];
  /**
   * Which dynamics engine produced `dynamics` — "internal" (quasi-static, default) or
   * "rapier" (real rigid-body, when SIM_PHYSICS_ENABLED + a bound backend). Undefined when
   * dynamics did not run. Honest provenance so a caller/UI knows whether the physics engine ran.
   */
  physicsEngine?: string;
  /**
   * True when SIM_PHYSICS_ENABLED is on AND a real physics backend flagged a BLOCKING
   * dynamic violation (effort/instability/tip-over/contact). This is the ONLY path by which a
   * dynamics result flips `pass`: when the physics flag is ON, a physics violation blocks the
   * gate (→ blocks deploy) exactly like a collision. When the flag is OFF this stays undefined
   * and `pass` keeps its original kinematic-only meaning (fully backward-compatible).
   */
  physicsBlocked?: boolean;
}

/** A safety/human-shared zone as a world AABB volume (from scene-graph zone bounds). */
export interface SafetyZone {
  id: string;
  zoneType: string; // "human_shared" | "safety" | ...
  min: Vec3;
  max: Vec3;
}

export interface SimScene {
  obstacles: Obstacle[];
  safetyZones: SafetyZone[];
}

// ── Flag + tunables (read at call time so ops/tests can toggle) ──────────────────
export function simKinematicEnabled(): boolean {
  return process.env.SIM_KINEMATIC_ENABLED === "true" || process.env.SIM_KINEMATIC_ENABLED === "1";
}

function num(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Waypoint resolution: max samples PER motion segment (interpolation density). */
function waypointResolution(): number {
  return Math.max(1, Math.round(num("SIM_WAYPOINT_RESOLUTION", 8)));
}
/** Collision margin (mm): separation ≤ margin flags a collision/near-miss. */
function collisionMargin(): number {
  return num("SIM_COLLISION_MARGIN_MM", 0);
}

// ── Flatten the Flow's motion into an ordered list of motion segments ────────────

type MotionSeg =
  | { kind: "joint"; block: string; joints: number[]; speedPct: number }
  | { kind: "linear"; block: string; pose: Pose; speedMms: number; accel: number };

/**
 * Walk the flow (depth-first, branches/loops flattened once — a static motion preview,
 * not a runtime trace) and collect its motion blocks in order. Non-motion blocks
 * (grip/wait/io/if/loop) do not move the arm and are skipped for kinematics.
 */
function collectMotion(flow: Flow): MotionSeg[] {
  const segs: MotionSeg[] = [];
  walkBlocks(flow.blocks, (b: IrBlock, path: string) => {
    if (b.type === "move_joint") {
      segs.push({ kind: "joint", block: b.id ?? path, joints: b.joints, speedPct: b.speed_pct });
    } else if (b.type === "move_linear") {
      segs.push({ kind: "linear", block: b.id ?? path, pose: b.target_pose, speedMms: b.speed_mms, accel: b.acceleration });
    }
  });
  return segs;
}

/** Linear interpolate two joint vectors (pads the shorter with 0). */
function lerpJoints(from: number[], to: number[], t: number): number[] {
  const n = Math.max(from.length, to.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = from[i] ?? 0;
    const b = to[i] ?? 0;
    out[i] = a + (b - a) * t;
  }
  return out;
}

/** Is a world point inside an AABB zone? */
function pointInAabb(p: Vec3, min: Vec3, max: Vec3): boolean {
  return p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1] && p[2] >= min[2] && p[2] <= max[2];
}

/**
 * Estimate the time (seconds) for one motion segment under a trapezoidal velocity model:
 * accelerate to cruise, cruise, decelerate. distance in mm, vMax mm/s, accel mm/s².
 */
function segmentTime(distanceMm: number, vMaxMms: number, accelMmS2: number): number {
  if (distanceMm <= 0 || vMaxMms <= 0) return 0;
  const a = accelMmS2 > 0 ? accelMmS2 : vMaxMms * 4; // sane default accel if unspecified
  const dAccel = (vMaxMms * vMaxMms) / a; // distance to reach vMax then back to 0
  if (distanceMm >= dAccel) {
    // trapezoid: ramp up + cruise + ramp down
    const tRamp = vMaxMms / a; // each ramp
    const dCruise = distanceMm - dAccel;
    return 2 * tRamp + dCruise / vMaxMms;
  }
  // triangular: never reaches vMax
  const vPeak = Math.sqrt(distanceMm * a);
  return 2 * (vPeak / a);
}

// ── The gate ────────────────────────────────────────────────────────────────────

export interface RunGateOptions {
  waypointResolution?: number;
  collisionMargin?: number;
  selfCollision?: boolean;
  /** Joint speed (%) → joint angular rate scale (rad/s at 100%). Default 3.14 (~180°/s). */
  jointRateAt100?: number;
  /** IK convergence tolerance on TCP position error (mm) for move_linear waypoints. Default 2. */
  ikPositionToleranceMm?: number;
  /** IK iteration cap per move_linear waypoint (determinism). Default 200. */
  ikMaxIterations?: number;
  /**
   * Skip the additive internal-dynamics pass (velocity/accel/static-torque). Default false
   * (dynamics runs). Purely additive — disabling it never changes the kinematic `pass`.
   */
  skipDynamics?: boolean;
  /** Tunables + defaults forwarded to the dynamics backend (physics.ts). */
  dynamicsOptions?: PhysicsOptions;
  /**
   * OPTIONAL pre-loaded physics backend (T2, doc 24 Wave-1). When SIM_PHYSICS_ENABLED is on the
   * caller may inject a real rigid-body backend here (e.g. RapierPhysicsBackend from
   * createRapierBackend()). Because the gate is SYNCHRONOUS and Rapier's WASM init is async, the
   * caller does the async load ONCE at its own boundary (irAdapter) and passes the ready backend
   * in. When provided AND the flag is on, this backend runs INSTEAD of the internal quasi-static
   * one and its violations BLOCK the gate (flip `pass`). When absent — or the flag is off — the
   * internal quasi-static backend runs additively and NEVER changes `pass` (today's behaviour).
   */
  physicsBackend?: PhysicsBackend;
}

/**
 * Run the kinematic Simulation Gate. PURE — no DB, no device I/O. Deterministic given
 * (flow, model, scene, options).
 */
export function runKinematicSimGate(
  flow: Flow,
  model: KinematicModel,
  scene: SimScene,
  opts: RunGateOptions = {},
): SimGateResult {
  const res = opts.waypointResolution ?? waypointResolution();
  const margin = opts.collisionMargin ?? collisionMargin();
  const jointRate = opts.jointRateAt100 ?? Math.PI; // ~180°/s at 100%

  const segs = collectMotion(flow);
  const collision_events: CollisionEvent[] = [];
  const joint_limit_violations: JointLimitViolation[] = [];
  const safety_zone_violations: SafetyZoneViolation[] = [];
  let cycle_time_actual = 0;
  let waypointsChecked = 0;
  let linearSolvedWithIk = false;

  // Track the running joint state so consecutive move_joint segments interpolate from the
  // previous target. Also SEEDS the IK for move_linear (path continuity). Start at all-zero (home).
  let jointState = new Array<number>(model.dof).fill(0);

  // Sampled trajectory for the ADDITIVE dynamics pass (physics.ts): each posed waypoint joint
  // config + its ABSOLUTE time (s). Timestamps come from the SAME per-segment trapezoidal
  // cycle-time the gate already computes, distributed linearly across that segment's waypoints.
  // Seeded with the home config at t=0 so the first move has a velocity baseline.
  const trajectory: TrajectorySample[] = [{ t: 0, joints: jointState.slice() }];
  let tAccum = 0;

  // IK tunables (read at call time; conservative defaults suited to the mm-length models).
  const ikTolerance = opts.ikPositionToleranceMm ?? num("SIM_IK_TOLERANCE_MM", 2);
  const ikMaxIter = opts.ikMaxIterations ?? Math.round(num("SIM_IK_MAX_ITERATIONS", 200));

  const checkPose = (atWaypoint: number, jointValues: number[]) => {
    waypointsChecked += 1;
    // Joint limits.
    for (const jl of checkJointLimits(model, jointValues)) {
      joint_limit_violations.push({ atWaypoint, ...jl });
    }
    // FK → link volumes.
    const poses = forwardKinematics(model, jointValues);
    const linkVolumes = poses.map((p) => ({ name: p.name, bv: p.worldBV }));
    // Collision vs obstacles (+ optional self-collision).
    collision_events.push(
      ...checkCollisionsAtWaypoint(atWaypoint, linkVolumes, scene.obstacles, { margin, selfCollision: opts.selfCollision }),
    );
    // Safety-zone intrusion: any link ORIGIN inside a zone AABB → violation.
    for (const p of poses) {
      for (const z of scene.safetyZones) {
        if (pointInAabb(p.origin, z.min, z.max)) {
          safety_zone_violations.push({ atWaypoint, link: p.name, zoneId: z.id, zoneType: z.zoneType, distance: 0 });
        }
      }
    }
  };

  let waypointIdx = 0;
  for (const seg of segs) {
    if (seg.kind === "joint") {
      const target = seg.joints.slice(0, model.dof);
      // Angular travel (max joint delta) → segment time from the joint speed %.
      let maxDelta = 0;
      for (let i = 0; i < model.dof; i++) maxDelta = Math.max(maxDelta, Math.abs((target[i] ?? 0) - (jointState[i] ?? 0)));
      const rate = jointRate * Math.max(0.01, seg.speedPct / 100); // rad/s
      const segTime = rate > 0 ? maxDelta / rate : 0;
      cycle_time_actual += segTime;
      // Interpolate res+1 waypoints from current state → target, timestamping each within the
      // segment's own time budget (linear along the segment — matches the joint-space lerp).
      for (let s = 1; s <= res; s++) {
        const t = s / res;
        const jv = lerpJoints(jointState, target, t);
        checkPose(waypointIdx++, jv);
        trajectory.push({ t: tAccum + t * segTime, joints: jv.slice() });
      }
      tAccum += segTime;
      jointState = lerpJoints(jointState, target, 1);
    } else {
      // move_linear: Cartesian target → SAMPLE the straight-line TCP path and solve IK at
      // each waypoint, then run the SAME full-arm checks as move_joint. The path START is the
      // current TCP (FK of jointState); the END is the target pose. IK is seeded from the
      // previous solution for continuity, so consecutive waypoints track one branch.
      linearSolvedWithIk = true;
      const startTcp = forwardKinematics(model, jointState);
      const from: Vec3 = startTcp.length
        ? startTcp[startTcp.length - 1].origin
        : [0, 0, 0];
      const to: Vec3 = [seg.pose.x, seg.pose.y, seg.pose.z];
      const ws = model.workspace;

      // Cycle-time from the straight-line Cartesian distance.
      const segTime = segmentTime(
        Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]),
        seg.speedMms,
        seg.accel,
      );
      cycle_time_actual += segTime;

      let seed = jointState.slice();
      for (let s = 1; s <= res; s++) {
        const t = s / res;
        const p: Vec3 = [
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          from[2] + (to[2] - from[2]) * t,
        ];
        const atWaypoint = waypointIdx++;

        // Workspace bound first (cheap gate; also flags targets IK could never reach).
        if (!pointInAabb(p, ws.min, ws.max)) {
          waypointsChecked += 1;
          joint_limit_violations.push({
            atWaypoint,
            joint: `<workspace:${seg.block}>`,
            value: 0,
            min: 0,
            max: 0,
          });
          continue; // outside workspace → do not attempt IK for this waypoint
        }

        // Solve IK for this Cartesian waypoint, seeded from the previous solution.
        const ik = solveIk(model, p, {
          seed,
          positionToleranceMm: ikTolerance,
          maxIterations: ikMaxIter,
        });
        if (!ik.reached) {
          // Reachability failure — the arm cannot achieve this pose (out of reach, or a
          // joint-limit-locked configuration). Treat as a joint-limit-class violation so it
          // BLOCKS. NEVER a silent pass.
          waypointsChecked += 1;
          joint_limit_violations.push({
            atWaypoint,
            joint: `<unreachable:${seg.block}>`,
            value: Math.round(ik.errorMm),
            min: 0,
            max: 0,
          });
          // Keep the best-effort config as the next seed to preserve continuity.
          seed = ik.joints;
          continue;
        }
        seed = ik.joints;
        // Run the EXISTING full-arm checks (joint limits + FK collision + workspace links +
        // safety zones) on the SOLVED joint config — identical to a move_joint waypoint.
        checkPose(atWaypoint, ik.joints);
        // Record the SOLVED joint config for the dynamics pass, timestamped within this
        // segment's time budget. Skipped (workspace/unreachable) waypoints carry no joint
        // config and are intentionally omitted from the trajectory.
        trajectory.push({ t: tAccum + t * segTime, joints: ik.joints.slice() });
      }
      tAccum += segTime;
      // Advance the running joint state to the final solved config (path continuity into any
      // subsequent segment).
      jointState = seed;
    }
  }

  // Kinematic pass (collision/limit/zone). Kept `let` so that — ONLY when SIM_PHYSICS_ENABLED
  // is on and a real physics backend flags a blocking dynamic violation — the gate can also
  // fail here. When the physics flag is OFF this value is exactly the original kinematic pass.
  let pass =
    collision_events.length === 0 &&
    joint_limit_violations.length === 0 &&
    safety_zone_violations.length === 0;

  const notes: string[] = [
    `kinematic-simgate engine=self-contained-FK model=${model.id} (${model.label})`,
  ];
  if (linearSolvedWithIk) {
    notes.push(
      "move_linear paths sampled + solved via numerical IK (DLS, position-target, single-arm, seed-continuity); full-arm collision/limits/zones checked at each waypoint. IK non-convergence is reported as an unreachable (blocking) violation, never a silent pass.",
    );
  }
  if (segs.length === 0) notes.push("flow has no motion blocks — trivially passes kinematics.");

  // ── DYNAMICS pass (physics.ts) — behind SIM_KINEMATIC_ENABLED (same gate) ─────────────────
  // Backend SELECTION (T2, doc 24 Wave-1):
  //   • DEFAULT / flag OFF → InternalDynamicsBackend (quasi-static). ADDITIVE: sets
  //     `dynamicsPass`/`dynamics`/`dynamics_reasons` and NEVER touches `pass`. Today's behaviour.
  //   • SIM_PHYSICS_ENABLED on + an injected real backend (opts.physicsBackend, e.g. Rapier) →
  //     that backend runs on the SAME sampled trajectory with real rigid-body dynamics, and a
  //     violation BLOCKS the gate (flips `pass` → blocks deploy) just like a collision. This is
  //     the ONLY path where dynamics affects `pass`, and it is opt-in via flag + injected engine.
  //   • Flag on but NO backend injected → we do NOT silently fabricate a physics pass: the
  //     internal quasi-static backend still runs additively (pass unchanged) and a note records
  //     that no external engine was bound (honest — the caller failed to load Rapier).
  let dynamicsPass: boolean | undefined;
  let dynamics: PhysicsResult | undefined;
  let dynamics_reasons: string[] | undefined;
  let physicsEngine: string | undefined;
  let physicsBlocked: boolean | undefined;
  const hasMotionSamples = trajectory.length >= 2;
  const physicsFlag = simPhysicsEnabled();
  const usePhysicsBlocking = physicsFlag && opts.physicsBackend !== undefined;

  if (!opts.skipDynamics && hasMotionSamples) {
    const backend = usePhysicsBlocking ? opts.physicsBackend! : new InternalDynamicsBackend();
    dynamics = backend.simulate(trajectory, model, opts.dynamicsOptions);
    dynamicsPass = dynamics.ok;
    physicsEngine = backend.id;
    dynamics_reasons = [];
    if (dynamics.jointVelocityViolations.length) {
      const v = dynamics.jointVelocityViolations[0];
      dynamics_reasons.push(
        `VELOCITY: ${dynamics.jointVelocityViolations.length} violation(s) — e.g. ${v.joint} peak ${v.value.toFixed(2)} > ${v.limit.toFixed(2)}.`,
      );
    }
    if (dynamics.jointAccelViolations.length) {
      const a = dynamics.jointAccelViolations[0];
      dynamics_reasons.push(
        `ACCEL: ${dynamics.jointAccelViolations.length} violation(s) — e.g. ${a.joint} peak ${a.value.toFixed(2)} > ${a.limit.toFixed(2)}.`,
      );
    }
    if (dynamics.estTorqueViolations.length) {
      const tq = dynamics.estTorqueViolations[0];
      const label = usePhysicsBlocking ? "rigid-body inverse dynamics" : "static-gravity estimate";
      const valueStr = Number.isFinite(tq.value) ? `${tq.value.toFixed(1)} N·m` : "self-contact";
      dynamics_reasons.push(
        `TORQUE/EFFORT: ${dynamics.estTorqueViolations.length} violation(s) — e.g. ${tq.joint} ${valueStr} > ${tq.limit.toFixed(1)} (${label}).`,
      );
    }
    if (dynamics.tipOver === true) {
      dynamics_reasons.push("TIP-OVER: whole-arm COM projects outside the base support footprint.");
    }
    notes.push(...dynamics.notes);

    // BLOCKING only under SIM_PHYSICS_ENABLED + a real backend. A physics violation fails the
    // gate exactly like a collision (which blocks deploy via `pass`). Flag OFF → never blocks.
    if (usePhysicsBlocking) {
      physicsBlocked = !dynamics.ok || dynamics.tipOver === true;
      if (physicsBlocked) {
        pass = false;
        notes.push(
          `PHYSICS BLOCK: SIM_PHYSICS_ENABLED on and the ${backend.id} backend found a blocking ` +
            `dynamic violation — gate FAILS (blocks deploy) like a collision.`,
        );
      }
    } else if (physicsFlag) {
      notes.push(
        "SIM_PHYSICS_ENABLED is on but NO physics backend was bound (Rapier not loaded) — ran the " +
          "internal quasi-static backend ADDITIVELY (does NOT block). Bind a backend via opts.physicsBackend.",
      );
    }
  } else if (!opts.skipDynamics) {
    notes.push("dynamics NOT evaluated — no motion (need ≥2 timed trajectory samples). Honest no-op.");
  }

  const result: SimGateResult = {
    pass,
    collision_events,
    joint_limit_violations,
    cycle_time_actual,
    safety_zone_violations,
    waypointsChecked,
    note: notes.join(" "),
  };
  // Attach the ADDITIVE dynamics fields ONLY when dynamics actually ran, so a skipped / no-op
  // gate returns the EXACT original contract shape (no extra keys) for callers/tests that
  // enumerate the object. Byte-for-byte backward-compatible when dynamics is not evaluated.
  if (dynamics !== undefined) {
    result.dynamics = dynamics;
    result.dynamicsPass = dynamicsPass;
    result.dynamics_reasons = dynamics_reasons;
    result.physicsEngine = physicsEngine;
    if (physicsBlocked !== undefined) result.physicsBlocked = physicsBlocked;
  }
  return result;
}

/**
 * HONEST "no model" result — returned when a flow's device type has no kinematic model.
 * It does NOT fabricate a pass: pass:false with a clear note, so the caller/UI knows the
 * kinematic gate could not run and it fell back to structural-only.
 */
export function noModelResult(deviceType: string): SimGateResult {
  return {
    pass: false,
    collision_events: [],
    joint_limit_violations: [],
    cycle_time_actual: 0,
    safety_zone_violations: [],
    waypointsChecked: 0,
    note: `NO kinematic model for device type "${deviceType}" — structural-only preview; kinematic gate did NOT run (not a pass).`,
  };
}

/**
 * Resolve a model for the flow and run the gate; returns noModelResult when none exists.
 * The scene is caller-supplied (assembled from the T1 scene graph → obstacles + zones).
 */
export function runGateForFlow(flow: Flow, scene: SimScene, opts?: RunGateOptions): SimGateResult {
  const model = resolveKinematicModel(flow.target_device_type);
  if (!model) return noModelResult(flow.target_device_type);
  return runKinematicSimGate(flow, model, scene, opts);
}

/**
 * ASYNC gate runner that BINDS the real physics engine (Rapier) when SIM_PHYSICS_ENABLED is on
 * (T2, doc 24 Wave-1). This is the async boundary that reconciles the SYNCHRONOUS gate with
 * Rapier's async WASM init: it loads Rapier ONCE (cached), constructs the backend, and injects it
 * into the sync gate via `opts.physicsBackend`, so a physics violation BLOCKS the gate.
 *
 * HONEST DEGRADATION: if the flag is on but Rapier's WASM cannot load (unavailable in this
 * runtime), we DO NOT block on a phantom engine and DO NOT fabricate a pass — we run the gate with
 * the internal quasi-static backend (additive, non-blocking) and record the load failure in the
 * note. When the flag is OFF this is byte-for-byte identical to `runGateForFlow` (Rapier never
 * loaded, never imported). Callers that must remain synchronous can keep using `runGateForFlow`.
 */
export async function runGateForFlowAsync(
  flow: Flow,
  scene: SimScene,
  opts?: RunGateOptions,
): Promise<SimGateResult> {
  const model = resolveKinematicModel(flow.target_device_type);
  if (!model) return noModelResult(flow.target_device_type);

  // Flag OFF (or a backend already injected) → no Rapier load; identical to the sync path.
  if (!simPhysicsEnabled() || opts?.physicsBackend) {
    return runKinematicSimGate(flow, model, scene, opts);
  }

  // Flag ON → try to bind Rapier. Dynamic import keeps the WASM out of the sync import graph.
  try {
    const { createRapierBackend } = await import("./rapierPhysics");
    const physicsBackend = await createRapierBackend();
    return runKinematicSimGate(flow, model, scene, { ...opts, physicsBackend });
  } catch (err) {
    // Rapier unavailable → honest fallback (internal quasi-static, non-blocking) + a note.
    const res = runKinematicSimGate(flow, model, scene, opts);
    const reason = err instanceof Error ? err.message : String(err);
    res.note =
      (res.note ? res.note + " " : "") +
      `SIM_PHYSICS_ENABLED on but Rapier WASM failed to load (${reason}); ran internal ` +
      `quasi-static dynamics (non-blocking). No fabricated physics pass.`;
    return res;
  }
}
