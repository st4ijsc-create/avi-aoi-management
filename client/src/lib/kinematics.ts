/**
 * Client-side forward kinematics (FK) — doc 24 Wave-1 T1.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A faithful PORT of the server FK kernel (server/services/programming/sim/
 * kinematicModel.ts) so the live twin can ARTICULATE a robot arm from a streamed
 * joint-angle vector: joint values → each link's world transform (column-major
 * 4×4), which the 3D view turns into a posed link chain.
 *
 * WHY a port (not a shared import): kinematicModel.ts pulls the twin/pipeline URDF
 * layer (server-only, Node deps) at module scope, so it cannot be imported into the
 * browser bundle. This file re-implements ONLY the pure math + the authored SAMPLE
 * models the client needs, using the SAME conventions so client and server agree
 * bit-for-bit on any given joint vector:
 *   • Homogeneous 4×4, COLUMN-MAJOR storage (m[col*4 + row]) — the exact layout
 *     three.js `Matrix4.fromArray` consumes, so a computed `world` maps to a mesh
 *     transform with zero re-ordering.
 *   • Right-handed frame, lengths in MILLIMETRES, angles in RADIANS.
 *   • Each joint placed by standard Denavit–Hartenberg (a, alpha, d, theta):
 *     Rot_z(theta)·Trans_z(d)·Trans_x(a)·Rot_x(alpha). Revolute adds its value to
 *     theta; prismatic adds to d. Link i's world frame is base·T1·…·Ti.
 *
 * The authored sample chains below are byte-for-byte the same numbers as the
 * server's SAMPLE_ARM_6DOF / SAMPLE_SCARA (kept in sync manually — small, stable).
 * These are honest SAMPLE chains, NOT vendor-exact URDF (real URDF import is T2a).
 * ════════════════════════════════════════════════════════════════════════════
 */

// ── vec3 ──────────────────────────────────────────────────────────────────────
export type Vec3 = readonly [number, number, number];

// ── 4×4 homogeneous matrix (column-major: m[col*4 + row]) ──────────────────────
export type Mat4 = number[]; // length 16

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

/** World origin (translation column) of a transform. */
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
/** Pure translation. */
export function translate(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/**
 * One standard Denavit–Hartenberg link transform:
 *   Rot_z(theta) · Trans_z(d) · Trans_x(a) · Rot_x(alpha)
 * (identical to the server dhTransform).
 */
export function dhTransform(a: number, alpha: number, d: number, theta: number): Mat4 {
  let m = rotZ(theta);
  m = mat4Mul(m, translate(0, 0, d));
  m = mat4Mul(m, translate(a, 0, 0));
  m = mat4Mul(m, rotX(alpha));
  return m;
}

// ── Joint + chain schema (client subset — FK only, no bounding volumes) ─────────

export type JointType = "revolute" | "prismatic" | "fixed";

export interface KinematicJoint {
  name: string;
  type: JointType;
  /** DH parameters (mm / rad). The joint VALUE adds to theta (revolute) or d (prismatic). */
  dh: { a: number; alpha: number; d: number; theta: number };
}

export interface KinematicModel {
  id: string;
  label: string;
  /** Base transform placing the robot in world (mm). Default identity. */
  base?: Mat4;
  joints: KinematicJoint[];
  /** How many joint values the chain expects (== count of non-fixed joints). */
  dof: number;
}

/** One link's world placement after FK. */
export interface LinkPose {
  jointIndex: number;
  name: string;
  type: JointType;
  /** World transform of the link frame (column-major 4×4). */
  world: Mat4;
  /** World origin of the link frame (== mat4Origin(world)). */
  origin: Vec3;
}

/**
 * FORWARD KINEMATICS — joint values → each link's world pose (column-major 4×4).
 * `jointValues` are indexed over the NON-fixed joints in order (length == model.dof).
 * Fixed joints consume no value. PURE + deterministic; mirrors the server FK (DH path).
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
    const theta = joint.dh.theta + (joint.type === "revolute" ? value : 0);
    const d = joint.dh.d + (joint.type === "prismatic" ? value : 0);
    const local = dhTransform(joint.dh.a, joint.dh.alpha, d, theta);
    acc = mat4Mul(acc, local);
    poses.push({ jointIndex: i, name: joint.name, type: joint.type, world: acc, origin: mat4Origin(acc) });
  });
  return poses;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE MODELS — kept in lockstep with the server (SAMPLE_ARM_6DOF / SAMPLE_SCARA
// in server/services/programming/sim/kinematicModel.ts). Honest authored chains,
// NOT vendor-exact URDF (real URDF is T2a). DH numbers copied verbatim.
// ════════════════════════════════════════════════════════════════════════════

const DEG = Math.PI / 180;

/** Generic 6-DOF articulated arm (UR5-ish DH chain) — matches server SAMPLE_ARM_6DOF. */
export const SAMPLE_ARM_6DOF: KinematicModel = {
  id: "sample-arm-6dof",
  label: "Generic 6-DOF arm (UR5-ish, authored)",
  dof: 6,
  joints: [
    { name: "shoulder_pan", type: "revolute", dh: { a: 0, alpha: 90 * DEG, d: 89.2, theta: 0 } },
    { name: "shoulder_lift", type: "revolute", dh: { a: -425, alpha: 0, d: 0, theta: 0 } },
    { name: "elbow", type: "revolute", dh: { a: -392, alpha: 0, d: 0, theta: 0 } },
    { name: "wrist_1", type: "revolute", dh: { a: 0, alpha: 90 * DEG, d: 109.3, theta: 0 } },
    { name: "wrist_2", type: "revolute", dh: { a: 0, alpha: -90 * DEG, d: 94.75, theta: 0 } },
    { name: "wrist_3", type: "revolute", dh: { a: 0, alpha: 0, d: 82.5, theta: 0 } },
  ],
};

/** Generic SCARA RRPR — matches server SAMPLE_SCARA. */
export const SAMPLE_SCARA: KinematicModel = {
  id: "sample-scara",
  label: "Generic SCARA RRPR (authored)",
  dof: 4,
  joints: [
    { name: "j1", type: "revolute", dh: { a: 300, alpha: 0, d: 200, theta: 0 } },
    { name: "j2", type: "revolute", dh: { a: 250, alpha: Math.PI, d: 0, theta: 0 } },
    { name: "z", type: "prismatic", dh: { a: 0, alpha: 0, d: 0, theta: 0 } },
    { name: "tool", type: "revolute", dh: { a: 0, alpha: 0, d: 0, theta: 0 } },
  ],
};

const MODELS: Record<string, KinematicModel> = {
  [SAMPLE_ARM_6DOF.id]: SAMPLE_ARM_6DOF,
  [SAMPLE_SCARA.id]: SAMPLE_SCARA,
};

/**
 * Resolve a kinematic model by its id (as carried on the scene-graph node / delta).
 * Returns null for an unknown id (the caller then falls back to the sliding block).
 */
export function getKinematicModel(modelId: string | null | undefined): KinematicModel | null {
  if (!modelId) return null;
  return MODELS[modelId] ?? null;
}

/**
 * Map a robot `kind` → the sample kinematic-model id. MIRRORS the server's
 * robotKindToKinematicFamily + resolveKinematicModel mapping (assetCockpitService.ts):
 *   arm / cobot → sample-arm-6dof (6-DOF UR-ish)
 *   scara / agv / other → sample-scara (4-DOF)
 * Kept identical so a joints vector renders the same chain client- and server-side.
 */
export function robotKindToModelId(kind: string | null | undefined): string {
  const k = (kind ?? "").toLowerCase();
  if (k === "cobot" || k === "arm") return SAMPLE_ARM_6DOF.id;
  return SAMPLE_SCARA.id;
}
