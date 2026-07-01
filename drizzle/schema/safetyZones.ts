// Schema domain: S2a — Dynamic Safety Zones (doc 20 §2/§5 S2a, doc 16 §8)
//                — flag SAFETY_ZONE_SW_ENABLED (default OFF)
//
// ════════════════════════════════════════════════════════════════════════════
// S2a is the SOFTWARE-ADVISORY slice of Khối 3 / S2. It adds, behind
// SAFETY_ZONE_SW_ENABLED, a model of DYNAMIC SAFETY ZONES with GRADUATED 3-level
// reaction thresholds around a robot/station/line, plus a PURE intrusion evaluator
// that (given simulated human + robot positions) computes the required reaction
// LEVEL. It DETECTS and LOGS/PROPOSES — it does NOT actuate.
//
//   safety_zones — a zone that PROTECTS a robot/device/station/line. It carries
//     three graduated distance thresholds (outer → inner):
//       speedReduceDistanceMm  — human within this ⇒ propose speed reduction
//       stopDistanceMm         — human within this ⇒ propose a stop
//       ratedStopDistanceMm    — human within this ⇒ LOG a rated-stop FINDING only
//     (invariant: speedReduce ≥ stop ≥ ratedStop). geometry is jsonb: an AABB
//     {min,max} and/or a polygon {points:[[x,y],…]} — advisory geometry, no map yet.
//
// SAFETY zones are DISTINCT from G1 fleet `zones` (fleet.ts). Those are TRAFFIC
// zones (zoneType incl. human_shared) with a concurrency cap — they are about robot
// occupancy backpressure. A safety zone carries graduated REACTION distances for
// human↔robot proximity. A NEW table is cleaner than overloading fleet `zones`
// (different columns, different lifecycle, different consumer) — so we add one.
//
// Zone-intrusion advisory events REUSE safety_events (safetyWorkforce.ts) with
// eventType 'zone_intrusion' | 'speed_violation' (no new table) so the S1 PDCA feed
// stays the single source of truth. No safety_zone_events table is added.
//
// ════════════════════════════════════════════════════════════════════════════
// ⚠ CRITICAL HONESTY / SAFETY (read this):
//   NOTHING here is safety-rated. safety_zones + the evaluator are ADVISORY. The
//   software DETECTS the 3 reaction levels (incl. rated_stop) and LOGS/PROPOSES — it
//   does NOT perform a safety-rated stop and gives NO sub-second guarantee. A
//   'rated_stop' finding is LOGGED with an explicit note that a certified Safety PLC
//   (SIL 2/3 + UWB/LiDAR + <100ms dual-channel) must perform the ACTUAL rated stop —
//   that is S2 HARDWARE, deferred. speed_reduce/stop are only ever PROPOSED through
//   the EXISTING gated dispatchers (robotCommandDispatcher / commandDispatcher,
//   dry-run by default); this schema opens NO new device-control path. Human
//   positions are SIMULATED until real UWB/LiDAR/vision (S2b).
//
// TENANT SCOPE: corporateCode (varchar) + factoryId (int) + a free `scope` tag mirror
// safetyWorkforce.ts / fleet.ts. RLS is wired in migration 0153 with the shared
// inert-by-default app_tenant_allows() helper on corporateCode — a no-op until
// TENANT_RLS_ENABLED.
//
// type/status columns are varchar (NOT new pg enums) → the migration stays additive
// (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE), matching safetyWorkforce.ts (0145).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/** Zone geometry (advisory). Either an AABB, a polygon, or both. Units are mm. */
export interface ZoneGeometry {
  /** Axis-aligned bounding box: min/max corners in world mm. */
  aabb?: { min: { x: number; y: number; z?: number }; max: { x: number; y: number; z?: number } };
  /** Polygon footprint (2D, XY plane) — points in world mm. */
  polygon?: { points: Array<[number, number]> };
}

/**
 * Safety Zone — a dynamic protective zone around a robot/device/station/line with
 * three GRADUATED reaction distance thresholds.
 *
 *  scope column semantics (`protects`): what the zone guards — resolved from whichever
 *  of robotId/deviceId/stationId/lineId is set (robot first). At least one SHOULD be
 *  set; a zone with none is a free/global advisory zone.
 *
 *  Thresholds (outer → inner, all in mm, invariant speedReduce ≥ stop ≥ ratedStop):
 *    speedReduceDistanceMm → human nearer than this ⇒ reaction 'speed_reduce'
 *    stopDistanceMm        → human nearer than this ⇒ reaction 'stop'
 *    ratedStopDistanceMm   → human nearer than this ⇒ reaction 'rated_stop' (LOG-only)
 *  reactionSpeedPct — target robot speed % while in the speed-reduce band (advisory).
 */
export const safetyZones = pgTable("safety_zones", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  // What the zone protects (robots.id first; deviceId for non-robot devices). No DB FK.
  robotId: integer("robotId"),
  deviceId: integer("deviceId"),
  stationId: integer("stationId"),
  lineId: integer("lineId"),
  // Advisory geometry (AABB and/or polygon). No real occupancy map yet.
  geometry: jsonb("geometry").$type<ZoneGeometry>(),
  // Three graduated reaction thresholds (mm), outer → inner.
  speedReduceDistanceMm: integer("speedReduceDistanceMm").default(2000).notNull(),
  stopDistanceMm: integer("stopDistanceMm").default(1000).notNull(),
  ratedStopDistanceMm: integer("ratedStopDistanceMm").default(500).notNull(),
  // Target robot speed % while in the speed-reduce band (advisory).
  reactionSpeedPct: integer("reactionSpeedPct").default(30).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  notes: text("notes"),
  // Tenant scope (mirrors safetyWorkforce.ts). `scope` is a free tag.
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_safetyzone_code").on(table.code),
  index("idx_safetyzone_robot").on(table.robotId),
  index("idx_safetyzone_station").on(table.stationId),
  index("idx_safetyzone_line").on(table.lineId),
  index("idx_safetyzone_enabled").on(table.enabled),
]);

export type SafetyZone = typeof safetyZones.$inferSelect;
export type InsertSafetyZone = typeof safetyZones.$inferInsert;
