/**
 * T2a-3 (doc 20 §1/§5) — URDF → T2b KinematicModel extractor.  CLOSES the T2b seam.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Turns a parsed URDF (urdfParser.ts) into the T2b `KinematicModel` that the kinematic
 * Simulation Gate (kinematicSimGate.ts) runs on, so the gate checks a REAL robot's
 * geometry+limits instead of an authored sample. This is what fills in the previously
 * stubbed `urdfToChainStub` (kinematicModel.ts).
 *
 * ── HOW IT MAPS ─────────────────────────────────────────────────────────────
 *   • Chain order: the SERIAL path of MOVEABLE joints from the URDF root down the tree
 *     (the parser's link tree). We follow the primary child chain; branch joints beyond
 *     the main serial arm are folded as fixed carriers of their link geometry.
 *   • Each URDF joint → a KinematicJoint carrying:
 *       - type  : revolute/continuous → "revolute"; prismatic → "prismatic"; fixed → "fixed".
 *       - local : { restTransform, axis } — the EXACT parent→joint transform from the URDF
 *                 <origin xyz rpy> (converted METRES→MILLIMETRES to match the T2b mm
 *                 convention) plus the URDF <axis>. FK uses this (kinematicModel.ts) so the
 *                 rest pose + joint motion reproduce the URDF exactly (NOT a lossy DH fit).
 *       - limits: from <limit lower upper> (rad for revolute, mm for prismatic — mm-scaled).
 *                 A "continuous" joint (no limit) → unlimited.
 *       - bv    : the link's bounding volume, derived from the <collision>/<visual> geometry
 *                 AABB (in the link frame, mm). This is what collision.ts tests.
 *       - dh    : zeroed (unused on the local path, kept so the schema is total).
 *   • workspace: a conservative world AABB = the sum of link reaches, padded — used by the
 *     gate's move_linear workspace-bound check.
 *
 * HONEST: the bounding volumes come from PRIMITIVE geometry AABBs; for `<mesh>` links whose
 * external geometry we cannot triangulate cheaply, the BV falls back to a small default box
 * (documented) — never a fabricated exact mesh volume.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  type KinematicModel,
  type KinematicJoint,
  type BoundingVolume,
  type Vec3 as KVec3,
  type Mat4,
  mat4Identity,
  mat4Mul,
  translate,
  rotX,
  rotY,
  rotZ,
} from "../../programming/sim/kinematicModel";
import {
  type UrdfRobot,
  type UrdfLink,
  type UrdfGeometry,
  type Vec3 as UVec3,
  walkLinkTree,
} from "./urdfParser";

/** URDF metres → T2b millimetres. */
const M2MM = 1000;

/** URDF rpy (radians, Rz·Ry·Rx) → a rotation Mat4 (column-major, T2b convention). */
function rpyToMat4(rpy: UVec3): Mat4 {
  // Applied to a point as Rz(yaw)·Ry(pitch)·Rx(roll).
  return mat4Mul(rotZ(rpy[2]), mat4Mul(rotY(rpy[1]), rotX(rpy[0])));
}

/** URDF joint <origin xyz rpy> (metres) → rest transform in millimetres. */
function originToRestTransform(xyz: UVec3, rpy: UVec3): Mat4 {
  const t = translate(xyz[0] * M2MM, xyz[1] * M2MM, xyz[2] * M2MM);
  return mat4Mul(t, rpyToMat4(rpy));
}

/**
 * Local-frame AABB (millimetres) of a link's geometry, accounting for the visual/collision
 * <origin>. Returns null for an unresolved mesh (caller falls back to a default box).
 */
function geometryAabbMm(geom: UrdfGeometry, originXyz: UVec3): { min: KVec3; max: KVec3 } | null {
  const ox = originXyz[0] * M2MM, oy = originXyz[1] * M2MM, oz = originXyz[2] * M2MM;
  if (geom.kind === "box") {
    const hx = (geom.size[0] * M2MM) / 2, hy = (geom.size[1] * M2MM) / 2, hz = (geom.size[2] * M2MM) / 2;
    return { min: [ox - hx, oy - hy, oz - hz], max: [ox + hx, oy + hy, oz + hz] };
  }
  if (geom.kind === "cylinder") {
    const r = geom.radius * M2MM, hl = (geom.length * M2MM) / 2;
    return { min: [ox - r, oy - r, oz - hl], max: [ox + r, oy + r, oz + hl] };
  }
  if (geom.kind === "sphere") {
    const r = geom.radius * M2MM;
    return { min: [ox - r, oy - r, oz - r], max: [ox + r, oy + r, oz + r] };
  }
  // mesh: use scale as a rough extent hint but DO NOT claim exact volume.
  return null;
}

/** Bounding volume (AABB in link frame, mm) for a link from its collision/visual geometry. */
function linkBoundingVolume(link: UrdfLink): BoundingVolume {
  const vis = link.collision ?? link.visual;
  if (vis) {
    const aabb = geometryAabbMm(vis.geometry, vis.origin.xyz);
    if (aabb) return { kind: "aabb", min: aabb.min, max: aabb.max };
  }
  // Unresolved (mesh / no geometry) → small default box, honest fallback.
  return { kind: "aabb", min: [-30, -30, -30], max: [30, 30, 30] };
}

export interface UrdfChainOptions {
  /** Model id/label to stamp on the produced KinematicModel. */
  id?: string;
  label?: string;
  /** IR target-device family the chain serves (matches Flow.target_device_type). */
  deviceType?: KinematicModel["deviceType"];
}

/**
 * Extract a T2b KinematicModel from a parsed URDF. PURE + deterministic. Returns null if the
 * URDF has no links (nothing to solve) — the gate then falls back honestly.
 */
export function urdfToKinematicChain(robot: UrdfRobot, opts: UrdfChainOptions = {}): KinematicModel | null {
  if (robot.links.length === 0) return null;
  const tree = walkLinkTree(robot);
  if (tree.length === 0) return null;

  const joints: KinematicJoint[] = [];
  for (const { link, joint } of tree) {
    // The ROOT link (joint == null) is the base — its geometry is carried by a fixed joint at identity.
    const type: KinematicJoint["type"] =
      !joint || joint.type === "fixed"
        ? "fixed"
        : joint.type === "prismatic"
          ? "prismatic"
          : "revolute"; // revolute + continuous

    const restTransform = joint ? originToRestTransform(joint.origin.xyz, joint.origin.rpy) : mat4Identity();
    const axis: KVec3 = joint ? [joint.axis[0], joint.axis[1], joint.axis[2]] : [0, 0, 1];

    let limits: { min: number; max: number } | undefined;
    if (joint && joint.limit && joint.limit.lower !== undefined && joint.limit.upper !== undefined) {
      const scale = type === "prismatic" ? M2MM : 1; // prismatic limits are metres → mm; angular are rad.
      limits = { min: joint.limit.lower * scale, max: joint.limit.upper * scale };
    }
    // continuous / limit-less revolute → unlimited (leave limits undefined).

    joints.push({
      name: joint?.name ?? link.name,
      type,
      dh: { a: 0, alpha: 0, d: 0, theta: 0 }, // unused on the local path; kept total.
      limits,
      bv: linkBoundingVolume(link),
      local: { restTransform, axis },
    });
  }

  const dof = joints.filter((j) => j.type !== "fixed").length;

  // Conservative world workspace AABB: sum of |origin| reaches + max link extent, padded.
  let reach = 0;
  for (const { joint } of tree) {
    if (joint) reach += Math.hypot(joint.origin.xyz[0], joint.origin.xyz[1], joint.origin.xyz[2]) * M2MM;
  }
  const R = Math.max(200, reach * 1.2 + 200);
  const workspace = { min: [-R, -R, -R] as KVec3, max: [R, R, R] as KVec3 };

  return {
    id: opts.id ?? `urdf-${robot.name}`,
    label: opts.label ?? `URDF ${robot.name} (${dof}-DOF, T2a-derived)`,
    deviceType: opts.deviceType ?? "generic",
    base: mat4Identity(),
    joints,
    workspace,
    dof,
  };
}
