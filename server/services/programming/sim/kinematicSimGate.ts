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
 * ── HONEST scope / seams ────────────────────────────────────────────────────
 *   • KINEMATIC, not full contact dynamics — swappable engine (PyBullet/Isaac later).
 *   • move_joint drives REAL FK (joint values → link poses → collision). move_linear
 *     carries a Cartesian target and there is NO inverse-kinematics solver yet, so a
 *     move_linear is checked for WORKSPACE bound + Cartesian TCP zone/obstacle proximity
 *     of the tool point and contributes to cycle-time; its full-arm collision needs IK
 *     (a later phase). This is stated in the result note, never silently passed.
 *   • Sample models until real URDF (T2a). No hardware, no device path.
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
import {
  type Obstacle,
  type CollisionEvent,
  checkCollisionsAtWaypoint,
} from "./collision";

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

/** Signed-ish distance of a point to an AABB (0 inside, positive outside). */
function pointAabbDist(p: Vec3, min: Vec3, max: Vec3): number {
  let sq = 0;
  for (let i = 0; i < 3; i++) {
    if (p[i] < min[i]) sq += (min[i] - p[i]) ** 2;
    else if (p[i] > max[i]) sq += (p[i] - max[i]) ** 2;
  }
  return Math.sqrt(sq);
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
  let linearNeedsIk = false;

  // Track the running joint state so consecutive move_joint segments interpolate from the
  // previous target. Start at all-zero (home).
  let jointState = new Array<number>(model.dof).fill(0);

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
      cycle_time_actual += rate > 0 ? maxDelta / rate : 0;
      // Interpolate res+1 waypoints from current state → target.
      for (let s = 1; s <= res; s++) {
        const t = s / res;
        const jv = lerpJoints(jointState, target, t);
        checkPose(waypointIdx++, jv);
      }
      jointState = lerpJoints(jointState, target, 1);
    } else {
      // move_linear: Cartesian target. No IK yet → check WORKSPACE + TCP point proximity.
      linearNeedsIk = true;
      const p: Vec3 = [seg.pose.x, seg.pose.y, seg.pose.z];
      waypointsChecked += 1;
      // Workspace bound (world AABB of the model).
      const ws = model.workspace;
      if (!pointInAabb(p, ws.min, ws.max)) {
        // A move outside the reachable workspace is treated as a joint-limit-class
        // violation (unreachable) so it BLOCKS — honest: it fails the gate.
        joint_limit_violations.push({
          atWaypoint: waypointIdx,
          joint: `<workspace:${seg.block}>`,
          value: 0,
          min: 0,
          max: 0,
        });
      }
      // TCP point vs obstacles (proximity of the tool point only — full-arm needs IK).
      for (const obs of scene.obstacles) {
        const bv = obs.volume;
        let dist = Infinity;
        if (bv.kind === "sphere") dist = Math.hypot(p[0] - bv.center[0], p[1] - bv.center[1], p[2] - bv.center[2]) - bv.radius;
        else if (bv.kind === "aabb") dist = pointAabbDist(p, bv.min, bv.max);
        else {
          // capsule: distance to segment
          const ab: Vec3 = [bv.b[0] - bv.a[0], bv.b[1] - bv.a[1], bv.b[2] - bv.a[2]];
          const denom = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
          let tt = denom > 0 ? ((p[0] - bv.a[0]) * ab[0] + (p[1] - bv.a[1]) * ab[1] + (p[2] - bv.a[2]) * ab[2]) / denom : 0;
          tt = Math.max(0, Math.min(1, tt));
          const cp: Vec3 = [bv.a[0] + ab[0] * tt, bv.a[1] + ab[1] * tt, bv.a[2] + ab[2] * tt];
          dist = Math.hypot(p[0] - cp[0], p[1] - cp[1], p[2] - cp[2]) - bv.radius;
        }
        if (dist <= margin) {
          collision_events.push({ atWaypoint: waypointIdx, linkA: `<tcp:${seg.block}>`, linkB: obs.id, isObstacle: true, distance: dist });
        }
      }
      // TCP vs safety zones.
      for (const z of scene.safetyZones) {
        if (pointInAabb(p, z.min, z.max)) {
          safety_zone_violations.push({ atWaypoint: waypointIdx, link: `<tcp:${seg.block}>`, zoneId: z.id, zoneType: z.zoneType, distance: 0 });
        }
      }
      // Cycle-time from Cartesian distance (from previous TCP, approx from origin if first).
      const dist = Math.hypot(p[0], p[1], p[2]); // conservative: distance from base origin
      cycle_time_actual += segmentTime(dist, seg.speedMms, seg.accel);
      waypointIdx += 1;
    }
  }

  const pass =
    collision_events.length === 0 &&
    joint_limit_violations.length === 0 &&
    safety_zone_violations.length === 0;

  const notes: string[] = [
    `kinematic-simgate engine=self-contained-FK model=${model.id} (${model.label})`,
  ];
  if (linearNeedsIk) {
    notes.push(
      "move_linear checked for workspace + TCP-point proximity only (no inverse-kinematics yet — full-arm collision for Cartesian moves is a later phase).",
    );
  }
  if (segs.length === 0) notes.push("flow has no motion blocks — trivially passes kinematics.");

  return {
    pass,
    collision_events,
    joint_limit_violations,
    cycle_time_actual,
    safety_zone_violations,
    waypointsChecked,
    note: notes.join(" "),
  };
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
