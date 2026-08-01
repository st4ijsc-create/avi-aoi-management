// Schema domain: Safety Audit & Mixed Workforce (Khối 3, doc 16 §8 / §15 S1)
//                — flags WORKFORCE_ENABLED + SAFETY_AUDIT_ENABLED (default OFF)
//
// ════════════════════════════════════════════════════════════════════════════
// S1 is the SOFTWARE-ONLY slice of Khối 3 (Human-Robot Collaboration). It adds,
// behind WORKFORCE_ENABLED + SAFETY_AUDIT_ENABLED:
//
//   S1-a Mixed-workforce assignments + human↔robot handover
//     • operator_assignments  — who (a human operator) is rostered to which
//                                line/station for a shift window, with a skill level
//                                and a confirm step. Humans AND robots are surfaced
//                                together in the "current board" (robots come from the
//                                fleet `tasks` + `robots` registry, not from this table).
//     • collaboration_sessions — a single human↔robot handover handshake for one
//                                task/operation: phase human_prep → robot_work →
//                                human_verify → done. ADVISORY coordination only.
//
//   S1-b/d Safety event audit + near-miss CV advisory
//     • safety_events          — an append-style ADVISORY record of every
//                                e-stop/collision/intrusion/force-limit/speed-violation/
//                                near-miss the software OBSERVES. SIL-tagged columns
//                                (responseTimeMs/detectedBy/outcome/isNearMiss) for
//                                ISO/TS 15066 + ISO 10218 PDCA reporting.
//
// ════════════════════════════════════════════════════════════════════════════
// CRITICAL HONESTY / SAFETY (read this):
//   NOTHING here is safety-rated. safety_events is an ADVISORY monitoring/logging
//   record — it is NOT a substitute for a safety-rated controller. The software does
//   NOT perform a SIL 2/3 stop and provides NO sub-second guarantee. A real
//   hardware-rated stop (Safety PLC / UWB / LiDAR) is deferred to S2. Every write
//   here is monitoring/logging/orchestration STATE only — it opens NO device-control
//   path. Actual robot/device commands still route through the EXISTING gated
//   dispatchers (robotCommandDispatcher / commandDispatcher, dry-run by default).
//
// TENANT SCOPE: every table carries a `scope` tag + (where relevant) `corporateCode`
// (varchar) + `factoryId` (int) like fleet.ts / production_orders. RLS is wired in
// migration 0145 with the shared inert-by-default app_tenant_allows() helper on
// corporateCode (mirrors 0142/0143) — a no-op until TENANT_RLS_ENABLED.
//
// status / type columns are varchar (NOT new pg enums) on purpose → the migration
// stays additive (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE), matching fleet.ts
// (0142) / fleetResource (0143) / twin (0144).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// ════════════════════════════════════════════════════════════════════════════
// S1-a — Mixed-workforce assignments
// ════════════════════════════════════════════════════════════════════════════

/**
 * Operator Assignment — a human operator rostered to a line/station for a shift
 * window. `role` is kept 'human' (robots are NOT stored here; they come from the
 * fleet registry/tasks for the current-board view). skillLevel mirrors the
 * masterdata certification levels (trainee|qualified|expert|trainer).
 *
 *  status : planned | active | completed | cancelled
 *           planned   → rostered, not yet confirmed/started
 *           active    → confirmed and currently at the station
 *           completed → terminal (shift/assignment ended cleanly)
 *           cancelled → terminal (reassigned / no-show / cancelled)
 *
 * CONFLICT detection (workforceService): a human may not be double-booked across two
 * OVERLAPPING active/planned assignments; a skill/cert mismatch (no active
 * userCertification for the station's required skill) is WARNED, not blocked.
 */
export const operatorAssignments = pgTable("operator_assignments", {
  id: serial("id").primaryKey(),
  // FK -> users.id (the human operator). No DB FK (additive/safe, mirrors masterdata).
  operatorId: integer("operatorId").notNull(),
  lineId: integer("lineId"),
  stationId: integer("stationId"),
  // FK -> shift_configs.id (which shift this assignment belongs to).
  shiftConfigId: integer("shiftConfigId"),
  // Mirrors masterdata.certificationLevelEnum values (stored as text, not an enum FK).
  skillLevel: varchar("skillLevel", { length: 24 }),
  // Kept 'human' — robots are surfaced in the board from the fleet registry, not here.
  role: varchar("role", { length: 16 }).default("human").notNull(),
  status: varchar("status", { length: 16 }).default("planned").notNull(),
  assignedStart: timestamp("assignedStart"),
  assignedEnd: timestamp("assignedEnd"),
  // Two-step confirm: a supervisor/operator confirms the planned assignment.
  confirmedBy: integer("confirmedBy"),
  confirmedAt: timestamp("confirmedAt"),
  // Provenance của hành động close (ai đã đóng assignment) — W2-7 / migration 0166.
  closedBy: integer("closedBy"),
  notes: text("notes"),
  // Tenant scope (mirrors fleet tables). `scope` is a free tag (e.g. corporate:factory).
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_opassign_operator").on(table.operatorId),
  index("idx_opassign_line").on(table.lineId),
  index("idx_opassign_station").on(table.stationId),
  index("idx_opassign_status").on(table.status),
  index("idx_opassign_shift").on(table.shiftConfigId),
]);

/**
 * Collaboration Session — one human↔robot handover handshake for a task/operation.
 *
 *  phase         : human_prep | robot_work | human_verify | done
 *                  human_prep   → human stages the part / fixture
 *                  robot_work   → robot performs its step
 *                  human_verify → human inspects / signs off
 *                  done         → terminal
 *  handshakeState: pending | ack | clear (the explicit "your turn / acknowledged /
 *                  zone clear" signal exchanged at each phase boundary). ADVISORY —
 *                  this is coordination metadata, NOT a safety interlock.
 *
 * The phase machine is enforced (forward-only, with an explicit abort) by the
 * collaborationService state machine. NO device command is issued here.
 */
export const collaborationSessions = pgTable("collaboration_sessions", {
  id: serial("id").primaryKey(),
  // The task this handover serves (fleet tasks.id) or a free operation code.
  taskId: integer("taskId"),
  operationCode: varchar("operationCode", { length: 64 }),
  // FK -> users.id (human) and robots.id (robot) — no DB FK (additive/safe).
  humanOperatorId: integer("humanOperatorId"),
  robotDeviceId: integer("robotDeviceId"),
  phase: varchar("phase", { length: 24 }).default("human_prep").notNull(),
  handshakeState: varchar("handshakeState", { length: 16 }).default("pending").notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  endedAt: timestamp("endedAt"),
  // Provenance của hành động abort (ai đã hủy phiên) — W2-7 / migration 0166.
  abortedBy: integer("abortedBy"),
  notes: text("notes"),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_collab_task").on(table.taskId),
  index("idx_collab_human").on(table.humanOperatorId),
  index("idx_collab_robot").on(table.robotDeviceId),
  index("idx_collab_phase").on(table.phase),
]);

// ════════════════════════════════════════════════════════════════════════════
// S1-b / S1-d — Safety event audit (SIL-TAGGED, ADVISORY)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Safety Event — an ADVISORY, append-style record of a safety-relevant observation.
 *
 *  ⚠ This table is SIL-TAGGED for ISO/TS 15066 + ISO 10218 PDCA reporting, but it is
 *    an ADVISORY MONITORING RECORD ONLY. It is NOT a safety-rated controller and is
 *    NOT a substitute for one. The software does NOT perform a safety-rated stop and
 *    gives NO sub-second guarantee — a real hardware-rated stop is deferred to S2.
 *
 *  eventType : estop | collision | intrusion | force_limit | speed_violation | near_miss
 *  detectedBy: vision | interlock | operator | telemetry   (who observed it)
 *  handledBy : interlock_engine | operator | advisory      (who/what responded)
 *  outcome   : stopped | reduced_speed | manual_override | logged_only
 *              (logged_only is the HONEST default for telemetry-observed e-stops:
 *               the software only logged it; it did NOT cause the stop)
 *
 * sourceInterlockEventId links to interlock_events when the interlock engine raised
 * the underlying stop/reduce. humanPosition/robotState are advisory snapshots.
 */
export const safetyEvents = pgTable("safety_events", {
  id: serial("id").primaryKey(),
  eventType: varchar("eventType", { length: 24 }).notNull(),
  // robots.id (the robot involved) — `deviceId` kept for non-robot devices later.
  robotId: integer("robotId"),
  deviceId: integer("deviceId"),
  lineId: integer("lineId"),
  stationId: integer("stationId"),
  // Link back to the interlock_events row that raised the underlying stop/reduce.
  sourceInterlockEventId: integer("sourceInterlockEventId"),
  // Advisory snapshots at the moment of the event (no schema imposed).
  humanPosition: jsonb("humanPosition").$type<Record<string, unknown>>(),
  robotState: jsonb("robotState").$type<Record<string, unknown>>(),
  // Observed/estimated response time in ms (ADVISORY — software measurement, not SIL).
  responseTimeMs: integer("responseTimeMs"),
  detectedBy: varchar("detectedBy", { length: 16 }),
  handledBy: varchar("handledBy", { length: 24 }),
  outcome: varchar("outcome", { length: 24 }).default("logged_only").notNull(),
  isNearMiss: boolean("isNearMiss").default(false).notNull(),
  notes: text("notes"),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // Human PDCA audit of the record (who reviewed it, when).
  auditedAt: timestamp("auditedAt"),
  auditedBy: integer("auditedBy"),
}, (table) => [
  index("idx_safetyev_type").on(table.eventType),
  index("idx_safetyev_robot").on(table.robotId),
  index("idx_safetyev_station").on(table.stationId),
  index("idx_safetyev_created").on(table.createdAt),
  index("idx_safetyev_nearmiss").on(table.isNearMiss),
  index("idx_safetyev_source_interlock").on(table.sourceInterlockEventId),
]);

export type OperatorAssignment = typeof operatorAssignments.$inferSelect;
export type InsertOperatorAssignment = typeof operatorAssignments.$inferInsert;
export type CollaborationSession = typeof collaborationSessions.$inferSelect;
export type InsertCollaborationSession = typeof collaborationSessions.$inferInsert;
export type SafetyEvent = typeof safetyEvents.$inferSelect;
export type InsertSafetyEvent = typeof safetyEvents.$inferInsert;
