// Schema domain: Fleet RESOURCE / SKILL / CHARGING (Khối 2, doc 16 §7 parts c & d / §15 G2)
//                — flag FLEET_RESOURCE_ENABLED (default OFF)
//
// ════════════════════════════════════════════════════════════════════════════
// G2 completes Khối 2 on top of the G1 base (tasks / zones / zone_reservations in
// fleet.ts). It adds, behind FLEET_RESOURCE_ENABLED:
//
//   G2-a Operation → Skill → Program registry
//     • operation_codes        — a MES operation/routing-step code → the canonical
//                                 capability it needs + the operator/device skills it
//                                 requires (jsonb array referencing masterdata.skills)
//                                 + tool type + cycle estimate. The allocator can
//                                 refine matching against this (advisory, flag-gated).
//     • operation_program_map   — maps an operation to QUALIFIED robot programs / URDF
//                                 artifacts in the versioned programming store
//                                 (program_projects). One row per (operation, program,
//                                 deviceKind); `compatible` flags a vetted pairing.
//
//   G2-b A/B program variants
//     • program_variants        — A | B | control split of a program_project with a
//                                 weighted traffic split + status + rolling metrics.
//                                 The dispatcher picks a variant deterministically
//                                 (seeded) when launching a program for an operation.
//
//   G2-c Shared resource registry (jig / gripper / fixture / tool_changer / other)
//     • shared_resources        — a claimable physical resource with current owner +
//                                 status + home zone. Mirrors zones' discipline.
//     • resource_reservations   — a device/task's claim on a resource for a window;
//                                 active | queued | released | rejected (mirrors
//                                 zone_reservations: derived availability, FIFO queue
//                                 promote on release).
//
//   G2-d Predictive charging
//     • charger_stations        — a charge point in a zone (type + power).
//     • battery_charging_plans   — a preemptive charge scheduled for a device when its
//                                 projected battery would drop below the G1 floor
//                                 before its task queue completes.
//
// TENANT SCOPE: every table carries `corporateCode` (varchar) + `factoryId` (int)
// like fleet.ts / production_orders. RLS is wired in migration 0143 with the shared
// inert-by-default app_tenant_allows() helper on corporateCode (mirrors 0142) — a
// no-op until TENANT_RLS_ENABLED.
//
// status / type columns are varchar (NOT new pg enums) on purpose → the migration
// stays additive (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE), matching fleet.ts
// (0142) / integration_outbox (0141) / federation (0138/0139).
//
// SAFETY: these are pure orchestration STATE tables. NOTHING here commands a device —
// dispatch stays with robotCommandDispatcher / commandDispatcher (HITL + dry-run).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, jsonb, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// ════════════════════════════════════════════════════════════════════════════
// G2-a — Operation → Skill → Program registry
// ════════════════════════════════════════════════════════════════════════════

/**
 * Operation Code — a MES routing-step / operation a task realises. Resolved by
 * skillRegistry.resolveOperation(code) into { requiredCapability, requiredSkillIds,
 * qualifiedPrograms[] } so the allocator (when FLEET_RESOURCE_ENABLED) can refine
 * device matching beyond the G1 bare capability verb.
 *
 *  requiredCapability — canonical capabilityModel command verb (e.g. "run_job",
 *                       "select_recipe"). The allocator HARD-filters on this exactly
 *                       like G1's task.requiredCapability.
 *  requiredSkillIds   — jsonb int[] referencing masterdata.skills.id. For operator
 *                       (human) realisation, matched against userCertifications.
 *  scope              — free-form grouping (line / cell / product family) — advisory.
 */
export const operationCodes = pgTable("operation_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull(),
  description: text("description"),
  // Canonical capabilityModel command verb the realising device must support.
  requiredCapability: varchar("requiredCapability", { length: 64 }).notNull(),
  // int[] of masterdata.skills.id (relate by id; no DB FK to stay additive/safe).
  requiredSkillIds: jsonb("requiredSkillIds").$type<number[]>(),
  // The tool/fixture class this operation needs (matched against shared_resources.type).
  toolType: varchar("toolType", { length: 32 }),
  // Nominal cycle time for scheduling / charging energy model (milliseconds).
  estimatedCycleMs: integer("estimatedCycleMs"),
  scope: varchar("scope", { length: 64 }),
  isActive: boolean("isActive").default(true).notNull(),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_operation_codes_code").on(table.code),
  index("idx_operation_codes_capability").on(table.requiredCapability),
]);

/**
 * Operation → Program map — which versioned programs (program_projects, the git-like
 * program store from doc 09 / Phase D0) are QUALIFIED to realise an operation, per
 * device kind. `compatible=false` records a vetted-incompatible pairing (e.g. a
 * program that failed simulation on that device kind) so it is not re-picked.
 *
 *  programProjectId — program_projects.id (no DB FK to stay additive).
 *  deviceKind       — robotKindEnum-like string ("arm" | "scara" | "cobot" | "agv")
 *                     or a machine class — advisory varchar (not a pg enum).
 */
export const operationProgramMap = pgTable("operation_program_map", {
  id: serial("id").primaryKey(),
  operationCodeId: integer("operationCodeId").notNull(),
  programProjectId: integer("programProjectId").notNull(),
  deviceKind: varchar("deviceKind", { length: 32 }),
  compatible: boolean("compatible").default(true).notNull(),
  notes: text("notes"),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_op_prog_map_operation").on(table.operationCodeId),
  index("idx_op_prog_map_program").on(table.programProjectId),
  // a (operation, program, deviceKind) pairing is recorded once
  uniqueIndex("uq_op_prog_map").on(table.operationCodeId, table.programProjectId, table.deviceKind),
]);

// ════════════════════════════════════════════════════════════════════════════
// G2-b — A/B program variants
// ════════════════════════════════════════════════════════════════════════════

/**
 * Program Variant — an A | B | control arm of a program_project with a weighted
 * traffic split. variantPicker.pickVariant() chooses an active arm deterministically
 * (seeded hash → stable for testability / for a stable per-task assignment) by
 * trafficSplitPct, then recordVariantOutcome() folds an outcome into `metrics`.
 *
 *  variant         — 'A' | 'B' | 'control'
 *  trafficSplitPct — 0..100 share of traffic for THIS arm; the picker normalises
 *                    the active arms' weights so they need not sum to exactly 100.
 *  status          — 'active' | 'paused'  (paused arms are excluded from the pick)
 *  metrics         — rolling jsonb { runs, successes, failures, avgCycleMs, ... }
 */
export const programVariants = pgTable("program_variants", {
  id: serial("id").primaryKey(),
  programProjectId: integer("programProjectId").notNull(),
  variant: varchar("variant", { length: 16 }).notNull(),
  trafficSplitPct: integer("trafficSplitPct").default(0).notNull(),
  status: varchar("status", { length: 16 }).default("active").notNull(),
  rolloutStartAt: timestamp("rolloutStartAt"),
  metrics: jsonb("metrics").$type<Record<string, unknown>>(),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_program_variants_program").on(table.programProjectId),
  index("idx_program_variants_status").on(table.status),
  // one row per (program, variant arm)
  uniqueIndex("uq_program_variant").on(table.programProjectId, table.variant),
]);

// ════════════════════════════════════════════════════════════════════════════
// G2-c — Shared resource registry
// ════════════════════════════════════════════════════════════════════════════

/**
 * Shared Resource — a claimable physical asset shared across devices/tasks.
 *
 *  type   : jig | gripper | fixture | tool_changer | other
 *  status : available | reserved | in_use | maintenance
 *           (status is a CACHED hint; the AUTHORITATIVE availability is DERIVED from
 *            active resource_reservations, mirroring zones' derived occupancy — the
 *            cached status is updated by resourceManager on claim/release.)
 *  currentOwnerDeviceId — robots.id (nullable) currently holding it, if any.
 */
export const sharedResources = pgTable("shared_resources", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }),
  type: varchar("type", { length: 24 }).default("other").notNull(),
  currentOwnerDeviceId: integer("currentOwnerDeviceId"),
  status: varchar("status", { length: 16 }).default("available").notNull(),
  locationZoneId: integer("locationZoneId"),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_shared_resources_code").on(table.code),
  index("idx_shared_resources_type").on(table.type),
  index("idx_shared_resources_status").on(table.status),
]);

/**
 * Resource Reservation — a device/task's claim on a shared resource for a window.
 * Mirrors zone_reservations exactly (so the discipline is uniform):
 *
 *  status : active | queued | released | rejected
 *           active   → currently held (counts toward "in use")
 *           queued   → waiting for the resource (FIFO; promoted on release)
 *           released → terminal (freed)
 *           rejected → terminal (denied: in use and not queued)
 */
export const resourceReservations = pgTable("resource_reservations", {
  id: serial("id").primaryKey(),
  resourceId: integer("resourceId").notNull(),
  taskId: integer("taskId"),
  deviceId: integer("deviceId").notNull(),
  deviceKind: varchar("deviceKind", { length: 16 }).default("robot").notNull(),
  status: varchar("status", { length: 16 }).default("active").notNull(),
  reservedFrom: timestamp("reservedFrom").defaultNow().notNull(),
  reservedUntil: timestamp("reservedUntil"),
  releasedAt: timestamp("releasedAt"),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_res_res_resource_status").on(table.resourceId, table.status),
  index("idx_res_res_device").on(table.deviceId),
  index("idx_res_res_task").on(table.taskId),
]);

// ════════════════════════════════════════════════════════════════════════════
// G2-d — Predictive charging
// ════════════════════════════════════════════════════════════════════════════

/** Charger Station — a charge point in a zone. */
export const chargerStations = pgTable("charger_stations", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }),
  locationZoneId: integer("locationZoneId"),
  chargerType: varchar("chargerType", { length: 32 }).default("contact").notNull(),
  powerWatts: integer("powerWatts"),
  status: varchar("status", { length: 16 }).default("available").notNull(),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_charger_stations_code").on(table.code),
  index("idx_charger_stations_zone").on(table.locationZoneId),
  index("idx_charger_stations_status").on(table.status),
]);

/**
 * Battery Charging Plan — a preemptive charge scheduled for a device by the
 * chargingPlanner when its projected battery (current % − energy needed for its
 * remaining task queue) would dip below the G1 BATTERY_FLOOR_PCT.
 *
 *  status : planned | active | done | cancelled
 *  reason : free text (e.g. "projected 12% < floor 20% after 4 tasks")
 */
export const batteryChargingPlans = pgTable("battery_charging_plans", {
  id: serial("id").primaryKey(),
  deviceId: integer("deviceId").notNull(),
  deviceKind: varchar("deviceKind", { length: 16 }).default("robot").notNull(),
  chargerStationId: integer("chargerStationId"),
  plannedStartAt: timestamp("plannedStartAt"),
  estimatedDurationMs: integer("estimatedDurationMs"),
  currentEnergyPct: integer("currentEnergyPct"),
  reason: text("reason"),
  status: varchar("status", { length: 16 }).default("planned").notNull(),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_charging_plans_device").on(table.deviceId),
  index("idx_charging_plans_status").on(table.status),
]);

// ── inferred types ───────────────────────────────────────────────────────────
export type OperationCode = typeof operationCodes.$inferSelect;
export type InsertOperationCode = typeof operationCodes.$inferInsert;
export type OperationProgramMap = typeof operationProgramMap.$inferSelect;
export type InsertOperationProgramMap = typeof operationProgramMap.$inferInsert;
export type ProgramVariant = typeof programVariants.$inferSelect;
export type InsertProgramVariant = typeof programVariants.$inferInsert;
export type SharedResource = typeof sharedResources.$inferSelect;
export type InsertSharedResource = typeof sharedResources.$inferInsert;
export type ResourceReservation = typeof resourceReservations.$inferSelect;
export type InsertResourceReservation = typeof resourceReservations.$inferInsert;
export type ChargerStation = typeof chargerStations.$inferSelect;
export type InsertChargerStation = typeof chargerStations.$inferInsert;
export type BatteryChargingPlan = typeof batteryChargingPlans.$inferSelect;
export type InsertBatteryChargingPlan = typeof batteryChargingPlans.$inferInsert;
