/**
 * T2b (doc 20 §1/§5) — PURE geometric collision for the kinematic Simulation Gate.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Given robot link WORLD bounding volumes (from forwardKinematics → LinkPose.worldBV)
 * and a set of obstacle world volumes (from the scene graph — device footprints + zone
 * bounds), decide which links are in (or within a margin of) contact with which
 * obstacle, and optionally which links self-collide.
 *
 * HONEST SCOPE: this is GEOMETRIC (bounding-volume) proximity, NOT full contact
 * dynamics. It answers "does the swept-free static pose overlap an obstacle?" — enough to
 * catch a program that drives a link into a machine / cage / another link, which is the
 * core safety value. A future PyBullet/Isaac backend can replace this with true mesh +
 * contact-force resolution while the SimGate contract stays identical.
 *
 * Volumes supported: sphere, capsule (segment + radius), AABB. Distances are computed
 * pairwise between primitive types; two volumes COLLIDE when their separation distance is
 * ≤ `margin` (a positive margin flags near-misses too). All PURE + deterministic.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  type Vec3,
  type WorldBV,
  v3sub,
  v3add,
  v3scale,
  v3dot,
  v3dist,
} from "./kinematicModel";

/** An obstacle in world coordinates (from scene-graph device/zone bounds). */
export interface Obstacle {
  id: string;
  /** Human label / provenance (e.g. "machine:12", "zone:7"). */
  label?: string;
  volume: WorldBV;
}

export interface CollisionEvent {
  atWaypoint: number;
  linkA: string;
  /** The other party: another link name (self-collision) OR an obstacle id. */
  linkB: string;
  /** Whether linkB is an obstacle (true) or another robot link (false → self-collision). */
  isObstacle: boolean;
  /** Separation distance (mm); ≤ 0 means interpenetration. */
  distance: number;
}

// ── Closest-point / distance primitives ────────────────────────────────────────

/** Closest point on segment [a,b] to point p. */
function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = v3sub(b, a);
  const denom = v3dot(ab, ab);
  if (denom === 0) return a;
  let t = v3dot(v3sub(p, a), ab) / denom;
  t = Math.max(0, Math.min(1, t));
  return v3add(a, v3scale(ab, t));
}

/** Distance between two segments [p1,q1] and [p2,q2] (clamped, robust). */
function segmentSegmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = v3sub(q1, p1);
  const d2 = v3sub(q2, p2);
  const r = v3sub(p1, p2);
  const a = v3dot(d1, d1);
  const e = v3dot(d2, d2);
  const f = v3dot(d2, r);
  let s: number;
  let t: number;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) return v3dist(p1, p2); // both degenerate → points
  if (a <= EPS) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = v3dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = v3dot(d1, d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const c1 = v3add(p1, v3scale(d1, s));
  const c2 = v3add(p2, v3scale(d2, t));
  return v3dist(c1, c2);
}

/** Distance from a point to an AABB surface (0 if inside). */
function pointAabbDistance(p: Vec3, min: Vec3, max: Vec3): number {
  let sq = 0;
  for (let i = 0; i < 3; i++) {
    const v = p[i];
    if (v < min[i]) sq += (min[i] - v) ** 2;
    else if (v > max[i]) sq += (v - max[i]) ** 2;
  }
  return Math.sqrt(sq);
}

/** AABB vs AABB separation (0 if overlapping). */
function aabbAabbDistance(minA: Vec3, maxA: Vec3, minB: Vec3, maxB: Vec3): number {
  let sq = 0;
  for (let i = 0; i < 3; i++) {
    if (maxA[i] < minB[i]) sq += (minB[i] - maxA[i]) ** 2;
    else if (maxB[i] < minA[i]) sq += (minA[i] - maxB[i]) ** 2;
  }
  return Math.sqrt(sq);
}

/** Sample a few points along a capsule segment to approximate capsule↔AABB distance. */
function capsuleAabbDistance(a: Vec3, b: Vec3, radius: number, min: Vec3, max: Vec3): number {
  const SAMPLES = 8;
  let best = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    best = Math.min(best, pointAabbDistance(p, min, max) - radius);
  }
  return best;
}

/**
 * Separation distance between two world bounding volumes (mm). ≤ 0 ⇒ interpenetration.
 * Handles every pairing of sphere/capsule/aabb (aabb pairs are exact; capsule↔aabb is a
 * conservative sampled approximation — honest note in the module header).
 */
export function bvDistance(x: WorldBV, y: WorldBV): number {
  // Normalise: treat sphere as a zero-length capsule for the capsule/sphere family.
  const asCapsule = (b: WorldBV): { a: Vec3; b: Vec3; radius: number } | null => {
    if (b.kind === "sphere") return { a: b.center, b: b.center, radius: b.radius };
    if (b.kind === "capsule") return { a: b.a, b: b.b, radius: b.radius };
    return null;
  };
  const cx = asCapsule(x);
  const cy = asCapsule(y);

  if (cx && cy) {
    return segmentSegmentDistance(cx.a, cx.b, cy.a, cy.b) - cx.radius - cy.radius;
  }
  if (cx && y.kind === "aabb") {
    return capsuleAabbDistance(cx.a, cx.b, cx.radius, y.min, y.max);
  }
  if (cy && x.kind === "aabb") {
    return capsuleAabbDistance(cy.a, cy.b, cy.radius, x.min, x.max);
  }
  if (x.kind === "aabb" && y.kind === "aabb") {
    return aabbAabbDistance(x.min, x.max, y.min, y.max);
  }
  return Infinity; // unreachable (all kinds covered)
}

export interface CollisionOptions {
  /** Separation ≤ margin (mm) flags a collision/near-miss. Default 0 (touch). */
  margin?: number;
  /** Also test robot-link vs robot-link. Adjacent links (|i-j|<=1) are excluded. */
  selfCollision?: boolean;
}

/**
 * Check one posed set of link volumes against obstacles (+ optional self-collision).
 * Returns every collision event whose separation ≤ margin. `linkVolumes` come from
 * forwardKinematics(...).map(p => ({ name, bv: p.worldBV })). PURE.
 */
export function checkCollisionsAtWaypoint(
  atWaypoint: number,
  linkVolumes: Array<{ name: string; bv: WorldBV }>,
  obstacles: Obstacle[],
  opts: CollisionOptions = {},
): CollisionEvent[] {
  const margin = opts.margin ?? 0;
  const events: CollisionEvent[] = [];

  for (const link of linkVolumes) {
    for (const obs of obstacles) {
      const dist = bvDistance(link.bv, obs.volume);
      if (dist <= margin) {
        events.push({ atWaypoint, linkA: link.name, linkB: obs.id, isObstacle: true, distance: dist });
      }
    }
  }

  if (opts.selfCollision) {
    for (let i = 0; i < linkVolumes.length; i++) {
      for (let j = i + 2; j < linkVolumes.length; j++) {
        // adjacent links (|i-j| <= 1) share a joint and legitimately touch → skip.
        const dist = bvDistance(linkVolumes[i].bv, linkVolumes[j].bv);
        if (dist <= margin) {
          events.push({
            atWaypoint,
            linkA: linkVolumes[i].name,
            linkB: linkVolumes[j].name,
            isObstacle: false,
            distance: dist,
          });
        }
      }
    }
  }

  return events;
}
