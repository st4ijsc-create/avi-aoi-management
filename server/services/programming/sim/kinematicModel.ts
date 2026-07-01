/**
 * T2b (doc 20 §1/§5 · doc 16 §11.2) — KINEMATIC MODEL + forward kinematics (FK).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A compact, authored kinematic-chain schema + a PURE forward-kinematics solver that
 * turns joint values → each link's world transform, plus a per-link bounding volume so
 * the collision stage (collision.ts) has geometry to test. This is the swappable ENGINE
 * behind the Simulation Gate (kinematicSimGate.ts): the math here can later be replaced
 * by a PyBullet / Isaac backend while the gate's contract stays identical.
 *
 * WHY authored models (honest): there is NO real URDF asset yet — the twin model
 * registry only tracks glTF/URDF provenance (conversionStatus), it holds no geometry we
 * can solve. Real URDF import is T2a. Until then T2b runs on the SAMPLE models below
 * (a UR5-ish 6-DOF arm + a SCARA) and a URDF→chain parser STUB (urdfToChainStub) that is
 * shaped for T2a to fill in. Nothing here is faked as "real hardware".
 *
 * ── MATH CHOICE ─────────────────────────────────────────────────────────────
 * A SMALL self-contained 4×4 / vec3 module (below). `three` is a dep, but importing its
 * Matrix4/Vector3 pulls three's browser-oriented side-effects server-side; `gl-matrix` is
 * NOT a dep. A ~120-line pure math kernel is deterministic, dependency-free and testable.
 *
 * ── FK CONVENTION (documented, so tests can assert analytically) ────────────
 *   • Homogeneous 4×4 transforms, COLUMN-MAJOR storage (m[col*4 + row]) — the same
 *     column-major layout WebGL/three use, so a future glTF/three viewer consumes the
 *     matrices unchanged.
 *   • Right-handed coordinate frame. Lengths in MILLIMETRES, angles in RADIANS.
 *   • Each joint is placed by standard Denavit–Hartenberg (DH) parameters
 *     (a, alpha, d, theta). The per-joint transform is the classic DH product
 *     Rot_z(theta)·Trans_z(d)·Trans_x(a)·Rot_x(alpha). A REVOLUTE joint adds its value to
 *     theta; a PRISMATIC joint adds its value to d. Link i's world frame is the running
 *     product base·T1·…·Ti. The bounding volume of link i is expressed in link i's frame
 *     and transformed to world by that running product.
 * ════════════════════════════════════════════════════════════════════════════
 */
// NOTE on the import below: this forms a controlled cycle with the T2a pipeline
// (urdfToKinematicChain imports the math helpers from THIS file). It is safe because
// neither side calls the other at module-eval time — the pipeline functions are only
// invoked inside urdfToChainStub()'s body, so ESM live-bindings are always resolved.
import { parseUrdf } from "../../twin/pipeline/urdfParser";
import { urdfToKinematicChain } from "../../twin/pipeline/urdfToKinematicChain";

// ── vec3 ──────────────────────────────────────────────────────────────────────
export type Vec3 = readonly [number, number, number];

export function v3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}
export function v3sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function v3add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function v3scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function v3dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function v3len(a: Vec3): number {
  return Math.sqrt(v3dot(a, a));
}
export function v3dist(a: Vec3, b: Vec3): number {
  return v3len(v3sub(a, b));
}

// ── 4×4 homogeneous matrix (column-major: m[col*4 + row]) ──────────────────────
export type Mat4 = number[]; // length 16

/** Identity 4×4. */
export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Column-major 4×4 multiply: returns A·B. */
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = s;
    }
  }
  return out;
}

/** Apply a 4×4 to a point (w=1). Returns the transformed Vec3. */
export function mat4TransformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Translation column of a transform (the world origin of the frame). */
export function mat4Origin(m: Mat4): Vec3 {
  return [m[12], m[13], m[14]];
}

/** Rot about X by `t` rad (column-major). */
export function rotX(t: number): Mat4 {
  const c = Math.cos(t), s = Math.sin(t);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
/** Rot about Z by `t` rad (column-major). */
export function rotZ(t: number): Mat4 {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
/** Rot about Y by `t` rad (column-major). */
export function rotY(t: number): Mat4 {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
/** Pure translation. */
export function translate(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/**
 * Rotation about an ARBITRARY unit axis by `t` rad (Rodrigues, column-major). Used by the
 * URDF-derived chain path where a joint's axis is not a canonical DH Z. A zero/degenerate
 * axis returns identity (a fixed joint).
 */
export function rotAxis(axis: Vec3, t: number): Mat4 {
  let [x, y, z] = axis;
  const n = Math.sqrt(x * x + y * y + z * z);
  if (n < 1e-9) return mat4Identity();
  x /= n; y /= n; z /= n;
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  // Column-major m[col*4+row].
  return [
    c + x * x * C, y * x * C + z * s, z * x * C - y * s, 0,
    x * y * C - z * s, c + y * y * C, z * y * C + x * s, 0,
    x * z * C + y * s, y * z * C - x * s, c + z * z * C, 0,
    0, 0, 0, 1,
  ];
}

/** Translation along an arbitrary axis by distance `d` (for prismatic URDF joints). */
export function translateAxis(axis: Vec3, d: number): Mat4 {
  const n = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
  if (n < 1e-9) return mat4Identity();
  return translate((axis[0] / n) * d, (axis[1] / n) * d, (axis[2] / n) * d);
}

/**
 * One standard Denavit–Hartenberg link transform:
 *   Rot_z(theta) · Trans_z(d) · Trans_x(a) · Rot_x(alpha)
 */
export function dhTransform(a: number, alpha: number, d: number, theta: number): Mat4 {
  let m = rotZ(theta);
  m = mat4Mul(m, translate(0, 0, d));
  m = mat4Mul(m, translate(a, 0, 0));
  m = mat4Mul(m, rotX(alpha));
  return m;
}

// ── Bounding volumes (per link) ────────────────────────────────────────────────
//
// Three primitive volumes, each expressed in the OWNING LINK's frame; FK transforms
// them to world. A sphere/capsule keeps the collision math to point↔point distance
// (fast, exact); an AABB (in link frame) is transformed by its 8 corners into a WORLD
// AABB (conservative — never misses a collision, may over-report — honest + safe).

export interface SphereBV {
  kind: "sphere";
  /** Centre in link frame (mm). */
  center: Vec3;
  radius: number;
}
export interface CapsuleBV {
  kind: "capsule";
  /** Segment endpoints in link frame (mm). */
  a: Vec3;
  b: Vec3;
  radius: number;
}
export interface AabbBV {
  kind: "aabb";
  /** Half-extents from the link-frame origin (mm). */
  min: Vec3;
  max: Vec3;
}
export type BoundingVolume = SphereBV | CapsuleBV | AabbBV;

// ── Joint + chain schema ────────────────────────────────────────────────────────

export type JointType = "revolute" | "prismatic" | "fixed";

export interface KinematicJoint {
  name: string;
  type: JointType;
  /** DH parameters (mm / rad). The joint VALUE adds to theta (revolute) or d (prismatic). */
  dh: { a: number; alpha: number; d: number; theta: number };
  /** Joint limits (rad for revolute, mm for prismatic). Omitted → unlimited. */
  limits?: { min: number; max: number };
  /** Bounding volume of the LINK that this joint carries, in the link's own frame. */
  bv: BoundingVolume;
  /**
   * URDF-DERIVED EXACT PATH (T2a). When present, FK uses this instead of the DH product:
   * the link frame is `restTransform · axisMotion(value)`, where restTransform is the fixed
   * parent→joint transform from the URDF <origin> and axisMotion rotates (revolute) or
   * translates (prismatic) the joint VALUE about the URDF <axis>. Authored samples leave this
   * undefined and keep the DH path. This lets FK reproduce real URDF geometry exactly, not
   * a lossy DH approximation.
   */
  local?: { restTransform: Mat4; axis: Vec3 };
}

export interface KinematicModel {
  id: string;
  label: string;
  /** Which IR target device family this model serves (matches Flow.target_device_type). */
  deviceType: "universal-robots" | "ros2" | "generic";
  /** Base transform placing the robot in world (mm). Default identity. */
  base?: Mat4;
  joints: KinematicJoint[];
  /** Declared reachable workspace AABB in world coords (mm) — for the workspace check. */
  workspace: { min: Vec3; max: Vec3 };
  /** How many joint values the chain expects (== count of non-fixed joints). */
  dof: number;
}

/** One link's world placement after FK. */
export interface LinkPose {
  jointIndex: number;
  name: string;
  /** World transform of the link frame (column-major 4×4). */
  world: Mat4;
  /** The link's bounding volume, TRANSFORMED into world coordinates. */
  worldBV: WorldBV;
  /** World origin of the link frame (convenience — == mat4Origin(world)). */
  origin: Vec3;
}

/** A bounding volume already resolved to WORLD coordinates (what collision.ts consumes). */
export type WorldBV =
  | { kind: "sphere"; center: Vec3; radius: number }
  | { kind: "capsule"; a: Vec3; b: Vec3; radius: number }
  | { kind: "aabb"; min: Vec3; max: Vec3 };

/** Transform a link-frame bounding volume into world coordinates. */
export function bvToWorld(bv: BoundingVolume, world: Mat4): WorldBV {
  if (bv.kind === "sphere") {
    return { kind: "sphere", center: mat4TransformPoint(world, bv.center), radius: bv.radius };
  }
  if (bv.kind === "capsule") {
    return { kind: "capsule", a: mat4TransformPoint(world, bv.a), b: mat4TransformPoint(world, bv.b), radius: bv.radius };
  }
  // AABB: transform all 8 corners → conservative world AABB.
  const c = [bv.min, bv.max];
  let mn: Vec3 = [Infinity, Infinity, Infinity];
  let mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p: Vec3 = [c[(i >> 0) & 1][0], c[(i >> 1) & 1][1], c[(i >> 2) & 1][2]];
    const w = mat4TransformPoint(world, p);
    mn = [Math.min(mn[0], w[0]), Math.min(mn[1], w[1]), Math.min(mn[2], w[2])];
    mx = [Math.max(mx[0], w[0]), Math.max(mx[1], w[1]), Math.max(mx[2], w[2])];
  }
  return { kind: "aabb", min: mn, max: mx };
}

/**
 * FORWARD KINEMATICS — joint values → each link's world pose + world bounding volume.
 *
 * `jointValues` are indexed over the NON-fixed joints in order (length == model.dof).
 * Fixed joints consume no value. Returns one LinkPose per joint (including fixed ones,
 * so the caller can render/collide every link). PURE + deterministic.
 */
export function forwardKinematics(model: KinematicModel, jointValues: number[]): LinkPose[] {
  const poses: LinkPose[] = [];
  let acc: Mat4 = model.base ? [...model.base] : mat4Identity();
  let valueIdx = 0;
  model.joints.forEach((joint, i) => {
    let value = 0;
    if (joint.type === "revolute" || joint.type === "prismatic") {
      value = jointValues[valueIdx] ?? 0;
      valueIdx += 1;
    }
    let local: Mat4;
    if (joint.local) {
      // URDF-derived EXACT path: rest transform · motion(value) about the URDF axis.
      let motion: Mat4;
      if (joint.type === "revolute") motion = rotAxis(joint.local.axis, value);
      else if (joint.type === "prismatic") motion = translateAxis(joint.local.axis, value);
      else motion = mat4Identity();
      local = mat4Mul(joint.local.restTransform, motion);
    } else {
      // Authored DH path (sample models).
      const theta = joint.dh.theta + (joint.type === "revolute" ? value : 0);
      const d = joint.dh.d + (joint.type === "prismatic" ? value : 0);
      local = dhTransform(joint.dh.a, joint.dh.alpha, d, theta);
    }
    acc = mat4Mul(acc, local);
    poses.push({
      jointIndex: i,
      name: joint.name,
      world: acc,
      worldBV: bvToWorld(joint.bv, acc),
      origin: mat4Origin(acc),
    });
  });
  return poses;
}

/** Tool-centre-point (world origin of the LAST link) after FK — for cycle-time distance. */
export function tcpPosition(model: KinematicModel, jointValues: number[]): Vec3 {
  const poses = forwardKinematics(model, jointValues);
  return poses.length ? poses[poses.length - 1].origin : mat4Origin(model.base ?? mat4Identity());
}

/**
 * Check joint values against the model's per-joint limits.
 * Returns one entry per VIOLATING joint. Fixed joints and joints without declared
 * limits never violate.
 */
export function checkJointLimits(
  model: KinematicModel,
  jointValues: number[],
): Array<{ joint: string; value: number; min: number; max: number }> {
  const out: Array<{ joint: string; value: number; min: number; max: number }> = [];
  let valueIdx = 0;
  for (const joint of model.joints) {
    if (joint.type === "fixed") continue;
    const value = jointValues[valueIdx] ?? 0;
    valueIdx += 1;
    if (joint.limits) {
      if (value < joint.limits.min || value > joint.limits.max) {
        out.push({ joint: joint.name, value, min: joint.limits.min, max: joint.limits.max });
      }
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE MODELS — authored until real URDF import (T2a). Numbers are UR5-ish /
// generic-SCARA-ish, chosen so the geometry is sane, NOT vendor-exact. Honest.
// ════════════════════════════════════════════════════════════════════════════

const DEG = Math.PI / 180;

/**
 * A generic 6-DOF articulated arm (UR5-ish DH chain). Link lengths (mm) in the UR5
 * ballpark. Each link carries a capsule roughly spanning its physical extent so
 * collision has real volume. Joint limits ±360°/±180° UR-style.
 */
export const SAMPLE_ARM_6DOF: KinematicModel = {
  id: "sample-arm-6dof",
  label: "Generic 6-DOF arm (UR5-ish, authored)",
  deviceType: "universal-robots",
  base: mat4Identity(),
  workspace: { min: [-900, -900, -100], max: [900, 900, 1300] },
  dof: 6,
  joints: [
    { name: "shoulder_pan", type: "revolute", dh: { a: 0, alpha: 90 * DEG, d: 89.2, theta: 0 },
      limits: { min: -2 * Math.PI, max: 2 * Math.PI }, bv: { kind: "capsule", a: [0, 0, -50], b: [0, 0, 50], radius: 70 } },
    { name: "shoulder_lift", type: "revolute", dh: { a: -425, alpha: 0, d: 0, theta: 0 },
      limits: { min: -2 * Math.PI, max: 2 * Math.PI }, bv: { kind: "capsule", a: [0, 0, 0], b: [-425, 0, 0], radius: 55 } },
    { name: "elbow", type: "revolute", dh: { a: -392, alpha: 0, d: 0, theta: 0 },
      limits: { min: -Math.PI, max: Math.PI }, bv: { kind: "capsule", a: [0, 0, 0], b: [-392, 0, 0], radius: 45 } },
    { name: "wrist_1", type: "revolute", dh: { a: 0, alpha: 90 * DEG, d: 109.3, theta: 0 },
      limits: { min: -2 * Math.PI, max: 2 * Math.PI }, bv: { kind: "sphere", center: [0, 0, 0], radius: 45 } },
    { name: "wrist_2", type: "revolute", dh: { a: 0, alpha: -90 * DEG, d: 94.75, theta: 0 },
      limits: { min: -2 * Math.PI, max: 2 * Math.PI }, bv: { kind: "sphere", center: [0, 0, 0], radius: 40 } },
    { name: "wrist_3", type: "revolute", dh: { a: 0, alpha: 0, d: 82.5, theta: 0 },
      limits: { min: -2 * Math.PI, max: 2 * Math.PI }, bv: { kind: "sphere", center: [0, 0, 0], radius: 35 } },
  ],
};

/**
 * A generic SCARA (RRPR): two revolute arm links in a plane, a prismatic Z, and a
 * revolute tool. Prismatic limit 0..150 mm.
 */
export const SAMPLE_SCARA: KinematicModel = {
  id: "sample-scara",
  label: "Generic SCARA RRPR (authored)",
  deviceType: "generic",
  base: mat4Identity(),
  workspace: { min: [-700, -700, -200], max: [700, 700, 400] },
  dof: 4,
  joints: [
    { name: "j1", type: "revolute", dh: { a: 300, alpha: 0, d: 200, theta: 0 },
      limits: { min: -140 * DEG, max: 140 * DEG }, bv: { kind: "capsule", a: [0, 0, 0], b: [300, 0, 0], radius: 40 } },
    { name: "j2", type: "revolute", dh: { a: 250, alpha: Math.PI, d: 0, theta: 0 },
      limits: { min: -150 * DEG, max: 150 * DEG }, bv: { kind: "capsule", a: [0, 0, 0], b: [250, 0, 0], radius: 35 } },
    { name: "z", type: "prismatic", dh: { a: 0, alpha: 0, d: 0, theta: 0 },
      limits: { min: 0, max: 150 }, bv: { kind: "capsule", a: [0, 0, 0], b: [0, 0, -150], radius: 30 } },
    { name: "tool", type: "revolute", dh: { a: 0, alpha: 0, d: 0, theta: 0 },
      limits: { min: -Math.PI, max: Math.PI }, bv: { kind: "sphere", center: [0, 0, 0], radius: 25 } },
  ],
};

/** Registry of the authored sample models, keyed by id. */
export const SAMPLE_MODELS: Record<string, KinematicModel> = {
  [SAMPLE_ARM_6DOF.id]: SAMPLE_ARM_6DOF,
  [SAMPLE_SCARA.id]: SAMPLE_SCARA,
};

/**
 * Resolve a kinematic model for an IR Flow target device type. Returns the authored
 * sample for the family, or null when NONE is available (honest — the gate then returns
 * a "no model — structural only" result rather than fabricating a pass).
 *
 * When T2a lands real URDF import, this is where a resolved-from-registry chain would be
 * returned in preference to the sample.
 */
export function resolveKinematicModel(
  deviceType: "universal-robots" | "ros2" | "generic",
): KinematicModel | null {
  if (deviceType === "universal-robots") return SAMPLE_ARM_6DOF;
  if (deviceType === "generic") return SAMPLE_SCARA;
  // ros2 has no authored sample yet — honest null (structural-only fallback).
  return null;
}

/**
 * URDF → kinematic-chain — the T2a seam, NOW REAL.
 *
 * Parses a URDF XML string and extracts a T2b KinematicModel (exact rest transforms +
 * axes + limits + per-link bounding volumes) via the T2a pipeline, so the Simulation Gate
 * runs on real robot geometry. Returns null when the input is empty/whitespace or does NOT
 * parse / has no links — the gate then falls back to the authored sample / honest no-model
 * result (the T2b contract is unchanged; only the body of the seam is filled in).
 *
 * The import is done lazily (dynamic require through an indirection) so kinematicModel.ts —
 * a pure, dependency-light math module — does not statically depend on the twin/pipeline
 * layer (which depends back on this file). Pure + deterministic given the input.
 */
export function urdfToChainStub(urdfXml: string, opts?: UrdfChainAdapterOptions): KinematicModel | null {
  if (!urdfXml || urdfXml.trim() === "") return null;
  try {
    const robot = parseUrdf(urdfXml);
    if (!robot.links.length) return null;
    return urdfToKinematicChain(robot, opts);
  } catch {
    // Malformed URDF → honest null (fallback), never a fabricated chain.
    return null;
  }
}

/** Options forwarded to the T2a chain extractor (id/label/deviceType). */
export interface UrdfChainAdapterOptions {
  id?: string;
  label?: string;
  deviceType?: KinematicModel["deviceType"];
}
