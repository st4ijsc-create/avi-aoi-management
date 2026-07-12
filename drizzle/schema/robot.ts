// Schema domain: Robotics (Phase 3) — robot registry, state telemetry, motion jobs.
//
// Mirrors the OT framework's safety model: a logical "robot" is configured here;
// the runtime connects via a vendor driver, polls state into robot_telemetry, and
// every motion command is recorded (append-only) in robot_jobs. Real device control
// is gated (dry-run by default) — see server/services/robot/robotCommandDispatcher.ts.
import {
  pgTable, serial, integer, varchar, text, boolean, timestamp, jsonb, decimal, index, unique, pgEnum,
} from "drizzle-orm/pg-core";

// "vda5050" added by migration 0161 (doc 24 C4) so an AGV/AMR driven over the open
// VDA 5050 MQTT standard is a first-class robot vendor (motion still gated by the
// robotCommandDispatcher HITL/dry-run path — this is only a registry vendor).
export const robotVendorEnum = pgEnum("robotvendorenum", ["fanuc", "mitsubishi", "delta", "techman", "sim", "vda5050", "ur"]);
export const robotKindEnum = pgEnum("robotkindenum", ["arm", "scara", "cobot", "agv"]);
export const robotJobTypeEnum = pgEnum("robotjobtypeenum", ["move", "pick_place", "dispense", "screw", "home", "abort", "custom"]);
export const robotJobStatusEnum = pgEnum("robotjobstatusenum", ["draft", "pending", "confirmed", "running", "done", "failed", "simulated", "rejected"]);

/** Robot registry — one row per physical robot/AGV the platform manages. */
export const robots = pgTable("robots", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  vendor: robotVendorEnum("vendor").notNull(),
  model: varchar("model", { length: 128 }),
  kind: robotKindEnum("kind").default("arm").notNull(),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  connectionOptions: jsonb("connectionOptions").$type<Record<string, unknown>>(),
  pollIntervalMs: integer("pollIntervalMs").default(5000).notNull(),
  // Disabled by default — a newly-registered robot must be explicitly enabled.
  isEnabled: boolean("isEnabled").default(false).notNull(),
  status: varchar("status", { length: 32 }).default("offline").notNull(),
  lineId: integer("lineId"),
  stationId: integer("stationId"),
  lastSeenAt: timestamp("lastSeenAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_robots_vendor").on(table.vendor),
  index("idx_robots_enabled").on(table.isEnabled),
]);

/** Robot state telemetry (time-series) — polled snapshots of robot status. */
export const robotTelemetry = pgTable("robot_telemetry", {
  id: serial("id").primaryKey(),
  robotId: integer("robotId").notNull(),
  mode: varchar("mode", { length: 32 }),
  busy: boolean("busy"),
  estop: boolean("estop"),
  poseJson: jsonb("poseJson").$type<Record<string, unknown>>(),
  payloadKg: decimal("payloadKg", { precision: 8, scale: 3 }),
  speedPct: integer("speedPct"),
  errorText: text("errorText"),
  // X1-a (doc 16 §5) — UDM/UEM extension columns (additive, nullable). Behind
  // FIELD_V2_ENABLED on the read/surface side; the columns themselves are always
  // safe to write (a producer that has no value writes an honest NULL).
  //   batteryLevel    — AGV charge % (wired from the VDA5050 battery extraction).
  //   jointStates     — per-joint pose/velocity (SEAM: only when a driver provides it).
  //   safetyZoneId    — the zone the device occupies (best-effort; null otherwise).
  //   firmwareVersion — device firmware (SEAM: only when a driver provides it).
  //   lastHeartbeat   — liveness timestamp; drives the X1-b heartbeat TTL stale sweep.
  batteryLevel: decimal("battery_level", { precision: 6, scale: 2 }),
  jointStates: jsonb("joint_states").$type<Array<Record<string, unknown>>>(),
  safetyZoneId: integer("safety_zone_id"),
  firmwareVersion: varchar("firmware_version", { length: 64 }),
  lastHeartbeat: timestamp("last_heartbeat"),
  timestamp: timestamp("timestamp").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_robot_telemetry_robot_time").on(table.robotId, table.timestamp),
  index("idx_robot_telemetry_timestamp").on(table.timestamp),
]);

/** Robot motion job log (append-only) — every command across all branches. */
export const robotJobs = pgTable("robot_jobs", {
  id: serial("id").primaryKey(),
  robotId: integer("robotId").notNull(),
  jobType: robotJobTypeEnum("jobType").notNull(),
  params: jsonb("params").$type<Record<string, unknown>>(),
  status: robotJobStatusEnum("status").default("simulated").notNull(),
  // What triggered the job. 'hitl' = human-confirmed AI action; 'manual' = operator.
  triggerKind: varchar("triggerKind", { length: 16 }).default("hitl").notNull(),
  actionId: varchar("actionId", { length: 64 }),
  requestedBy: integer("requestedBy"),
  confirmedBy: integer("confirmedBy"),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).unique(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  errorText: text("errorText"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
}, (table) => [
  index("idx_robot_jobs_robot").on(table.robotId),
  index("idx_robot_jobs_status").on(table.status),
  index("idx_robot_jobs_created").on(table.createdAt),
]);

export type Robot = typeof robots.$inferSelect;
export type InsertRobot = typeof robots.$inferInsert;
export type RobotTelemetry = typeof robotTelemetry.$inferSelect;
export type RobotJob = typeof robotJobs.$inferSelect;
export type InsertRobotJob = typeof robotJobs.$inferInsert;
