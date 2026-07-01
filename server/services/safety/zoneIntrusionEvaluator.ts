/**
 * S2a (doc 20 §2/§5 / doc 16 §8) — PURE zone-intrusion evaluator.  No DB, no I/O.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Given SIMULATED human positions, robot positions, and a set of safety zones with
 * three graduated reaction thresholds, computes — per robot — the required REACTION
 * LEVEL from pure geometry. Deterministic and fully unit-testable.
 *
 * Reaction levels (outer → inner; closest threshold wins, rated_stop innermost):
 *   'none'         — nearest human outside the speed-reduce band (or zone disabled)
 *   'speed_reduce' — human within speedReduceDistanceMm (but not nearer)
 *   'stop'         — human within stopDistanceMm (but not nearer)
 *   'rated_stop'   — human within ratedStopDistanceMm (innermost)
 *
 * The "distance" used for banding is the min human↔robot Euclidean distance, further
 * REDUCED by how far the human has intruded INTO the zone footprint: a human already
 * inside the zone's AABB/polygon uses distance 0 to the footprint boundary is NOT
 * enough on its own — we band on the human↔robot distance (the robot is the hazard),
 * and the zone's geometry gates WHETHER this human is considered for this zone at all
 * (a human far outside the zone footprint is ignored for that zone). This keeps the
 * geometry honest: the zone is the region we monitor; the robot is what we protect
 * the human FROM; the thresholds are measured to the robot.
 *
 * ⚠ CRITICAL HONESTY / SAFETY: this is ADVISORY geometry. 'rated_stop' is a DETECTED
 *   FINDING — a real rated stop is HARDWARE (certified Safety PLC + UWB/LiDAR), S2,
 *   deferred. This module NEVER commands a device; it only returns levels.
 * ════════════════════════════════════════════════════════════════════════════
 */

export type ReactionLevel = "none" | "speed_reduce" | "stop" | "rated_stop";

export interface Point3 {
  x: number;
  y: number;
  z?: number;
}

export interface HumanPos extends Point3 {
  id: string | number;
  /** Detection confidence 0..1 — humans below minConfidence are ignored. */
  confidence: number;
}

export interface RobotPos extends Point3 {
  id: string | number;
}

/** A safety zone (subset of the DB row) needed for evaluation. */
export interface SafetyZoneSpec {
  id: number;
  robotId?: number | null;
  deviceId?: number | null;
  stationId?: number | null;
  lineId?: number | null;
  enabled?: boolean | null;
  geometry?: ZoneGeometryLite | null;
  speedReduceDistanceMm: number;
  stopDistanceMm: number;
  ratedStopDistanceMm: number;
  reactionSpeedPct?: number | null;
}

export interface ZoneGeometryLite {
  aabb?: { min: Point3; max: Point3 };
  polygon?: { points: Array<[number, number]> };
}

export interface ZoneReaction {
  robotId: number | string;
  level: ReactionLevel;
  nearestHumanId: string | number | null;
  nearestDistanceMm: number | null;
  triggeringZoneId: number | null;
  reactionSpeedPct: number | null;
  /** Human-readable, honest note (esp. for rated_stop). */
  note: string;
}

// ════════════════════════════════════════════════════════════════════════════
// PURE GEOMETRY HELPERS (exported for unit testing)
// ════════════════════════════════════════════════════════════════════════════

/** Euclidean distance between two points (z optional, treated as 0 when absent). */
export function distance3(a: Point3, b: Point3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Shortest distance from a point to an axis-aligned bounding box (0 if inside).
 * Per-axis clamp then Euclidean — the standard point↔AABB distance.
 */
export function distanceToAabb(p: Point3, aabb: { min: Point3; max: Point3 }): number {
  const clampDelta = (v: number, lo: number, hi: number): number => {
    if (v < lo) return lo - v;
    if (v > hi) return v - hi;
    return 0;
  };
  const dx = clampDelta(p.x, aabb.min.x, aabb.max.x);
  const dy = clampDelta(p.y, aabb.min.y, aabb.max.y);
  const dz = clampDelta(p.z ?? 0, aabb.min.z ?? 0, aabb.max.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Is a point inside (or on the edge of) an AABB? (2.5D — z checked when present.) */
export function pointInAabb(p: Point3, aabb: { min: Point3; max: Point3 }): boolean {
  if (p.x < aabb.min.x || p.x > aabb.max.x) return false;
  if (p.y < aabb.min.y || p.y > aabb.max.y) return false;
  if (aabb.min.z != null && aabb.max.z != null) {
    const z = p.z ?? 0;
    if (z < aabb.min.z || z > aabb.max.z) return false;
  }
  return true;
}

/**
 * Point-in-polygon (2D, XY plane) via the ray-casting / even-odd rule. Points on an
 * edge/vertex are treated as INSIDE (fail-safe: a human on the boundary counts).
 */
export function pointInPolygon(p: Point3, points: Array<[number, number]>): boolean {
  const n = points.length;
  if (n < 3) return false;
  const x = p.x;
  const y = p.y;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    // On-edge test (collinear + within segment bounds) → inside (fail-safe).
    if (onSegment2d(x, y, xi, yi, xj, yj)) return true;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Is (x,y) on the segment (x1,y1)-(x2,y2)? (collinear + within bounds, with epsilon). */
function onSegment2d(x: number, y: number, x1: number, y1: number, x2: number, y2: number): boolean {
  const cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
  if (Math.abs(cross) > 1e-6) return false;
  const dot = (x - x1) * (x - x2) + (y - y1) * (y - y2);
  return dot <= 1e-6;
}

/**
 * Is a human "in play" for a zone? True when the zone has no geometry (advisory
 * global zone) OR the human is inside the zone's AABB/polygon footprint. A human far
 * outside the footprint is ignored FOR THAT ZONE (the zone bounds what we monitor).
 */
export function humanInZoneFootprint(h: Point3, geometry?: ZoneGeometryLite | null): boolean {
  if (!geometry || (!geometry.aabb && !geometry.polygon)) return true; // no footprint ⇒ always monitored
  if (geometry.aabb && pointInAabb(h, geometry.aabb)) return true;
  if (geometry.polygon && pointInPolygon(h, geometry.polygon.points)) return true;
  return false;
}

/**
 * PURE — map a human↔robot distance to a reaction level for one zone's thresholds.
 * Closest threshold wins; rated_stop innermost. Thresholds are treated as
 * "strictly nearer than" bands (distance < threshold), so a human EXACTLY on the
 * speed-reduce boundary is 'none' (outside), matching nearMissAdvisor's `<` margin.
 */
export function levelForDistance(distanceMm: number, zone: SafetyZoneSpec): ReactionLevel {
  if (distanceMm < zone.ratedStopDistanceMm) return "rated_stop";
  if (distanceMm < zone.stopDistanceMm) return "stop";
  if (distanceMm < zone.speedReduceDistanceMm) return "speed_reduce";
  return "none";
}

const SEVERITY: Record<ReactionLevel, number> = { none: 0, speed_reduce: 1, stop: 2, rated_stop: 3 };

/** Does zone `z` apply to robot `r`? A zone bound to a robotId only applies to that
 *  robot; a zone bound only to station/line/device (no robotId) applies to ALL robots
 *  passed in (advisory: we can't resolve robot→station here without a scene). */
function zoneAppliesToRobot(z: SafetyZoneSpec, robotId: number | string): boolean {
  if (z.robotId != null) return String(z.robotId) === String(robotId);
  return true; // station/line/device-scoped or global → applies to every evaluated robot
}

const RATED_STOP_NOTE =
  "ADVISORY rated_stop DETECTED — a certified Safety PLC (SIL 2/3 + UWB/LiDAR, <100ms dual-channel) must perform the ACTUAL rated stop (S2 hardware, deferred). Software does NOT actuate.";

export interface EvaluateOptions {
  /** Ignore humans below this confidence (default 0.5). */
  minConfidence?: number;
}

/**
 * PURE — evaluate all zones against all humans/robots. Returns ONE ZoneReaction per
 * robot (the WORST — highest-severity — reaction across all applicable zones, using
 * the nearest human that drives it). Robots with no reaction still get a 'none' entry
 * so callers see the full set. Deterministic; no side effects.
 */
export function evaluateZones(
  humans: HumanPos[],
  robots: RobotPos[],
  zones: SafetyZoneSpec[],
  opts: EvaluateOptions = {},
): ZoneReaction[] {
  const minConfidence = opts.minConfidence ?? 0.5;
  const consideredHumans = humans.filter((h) => (h.confidence ?? 1) >= minConfidence);
  const activeZones = zones.filter((z) => z.enabled !== false);

  return robots.map((robot) => {
    let best: ZoneReaction = {
      robotId: robot.id,
      level: "none",
      nearestHumanId: null,
      nearestDistanceMm: null,
      triggeringZoneId: null,
      reactionSpeedPct: null,
      note: "no intrusion",
    };

    for (const zone of activeZones) {
      if (!zoneAppliesToRobot(zone, robot.id)) continue;
      for (const human of consideredHumans) {
        // Zone footprint gates whether this human is monitored for this zone.
        if (!humanInZoneFootprint(human, zone.geometry)) continue;
        const dist = distance3(human, robot);
        const level = levelForDistance(dist, zone);
        if (level === "none") continue;
        // Keep the worst level; tie-break on nearer distance.
        const better =
          SEVERITY[level] > SEVERITY[best.level] ||
          (SEVERITY[level] === SEVERITY[best.level] &&
            best.nearestDistanceMm != null &&
            dist < best.nearestDistanceMm);
        if (better) {
          best = {
            robotId: robot.id,
            level,
            nearestHumanId: human.id,
            nearestDistanceMm: dist,
            triggeringZoneId: zone.id,
            reactionSpeedPct: level === "speed_reduce" ? zone.reactionSpeedPct ?? null : null,
            note:
              level === "rated_stop"
                ? RATED_STOP_NOTE
                : level === "stop"
                  ? "ADVISORY stop PROPOSED via the existing gate (not a safety-rated stop)."
                  : "ADVISORY speed-reduce PROPOSED via the existing gate.",
          };
        }
      }
    }

    return best;
  });
}
