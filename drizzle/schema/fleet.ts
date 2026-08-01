// Schema domain: Fleet & Task Orchestration (Khối 2, doc 16 §7 / §15 G1) — flag FLEET_ORCH_ENABLED
//
// ════════════════════════════════════════════════════════════════════════════
// The Khối-2 core entities behind the Dynamic Task Allocation Engine
// (server/services/fleet/taskAllocator.ts) and the Zone / Traffic & Path manager
// (server/services/fleet/trafficManager.ts):
//
//   • tasks             — a unit of work decomposed from a production order. The
//                         allocator scores candidate devices (capability match +
//                         distance + battery + queue length + order priority) and
//                         assigns the best one. Status walks pending → assigned →
//                         running → completed | failed | cancelled. NO device
//                         control happens here — actual dispatch still routes
//                         through robotCommandDispatcher / commandDispatcher (gated).
//   • zones             — a physical/logical area with a concurrency cap. The
//                         traffic manager enforces max_concurrent_robots and runs a
//                         "virtual traffic light" per shared zone.
//   • zone_reservations — a claim on a zone for a device for a time window. The
//                         traffic manager grants/queues these (reservation-based
//                         navigation) and detects deadlocks via the wait-graph.
//
// TENANT SCOPE: these tables carry `corporateCode` (varchar) + `factoryId` (int) to
// match the neighbouring production tables (production_orders.companyCode/factoryId).
// RLS is wired in migration 0142 with the shared inert-by-default app_tenant_allows()
// helper on `corporateCode` (mirrors 0122) — so it is a no-op until TENANT_RLS_ENABLED.
//
// status columns are varchar (NOT new pg enums) on purpose → the migration stays
// additive (CREATE TABLE/INDEX only, no ALTER TYPE on an existing enum), matching
// integration_outbox (0141) / federation (0138/0139).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm"; // partial-index predicate (WHERE status='active')

/**
 * Task — one unit of orchestratable work. Created (idempotently) by decomposing a
 * production order on the `order.created` event, or manually by an admin.
 *
 *  status : pending | assigned | running | completed | failed | cancelled
 *           pending   → not yet matched to a device
 *           assigned  → allocator picked assignedDeviceId (not yet dispatched/running)
 *           running   → in flight on the device
 *           completed → terminal success
 *           failed    → terminal failure (retryCount tracks attempts)
 *           cancelled → terminal, operator/system cancelled
 *
 * assignedDeviceKind disambiguates assignedDeviceId across registries: 'robot'
 * (robots.id) is the only kind G1 allocates; 'machine' is reserved for later phases.
 */
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  // Stable external key — lets order-decomposition be idempotent (uniqueIndex below).
  taskKey: varchar("taskKey", { length: 128 }).notNull(),
  // The production order this task was decomposed from (nullable for manual tasks).
  sourceWorkOrderId: integer("sourceWorkOrderId"),
  // Canonical capability verb the assigned device must support (capabilityModel command name).
  requiredCapability: varchar("requiredCapability", { length: 64 }).notNull(),
  // 1..5 (higher = more urgent). Defaults to 3 (mirrors dispatchingService default).
  priority: integer("priority").default(3).notNull(),
  status: varchar("status", { length: 16 }).default("pending").notNull(),
  // Device this task is assigned to (robots.id when assignedDeviceKind='robot').
  assignedDeviceId: integer("assignedDeviceId"),
  assignedDeviceKind: varchar("assignedDeviceKind", { length: 16 }),
  // Optional spatial hints — zone codes the work starts/ends in (drive distance scoring).
  locationStart: varchar("locationStart", { length: 64 }),
  locationEnd: varchar("locationEnd", { length: 64 }),
  // Estimated / actual wall-clock duration in milliseconds.
  estimatedDurationMs: integer("estimatedDurationMs"),
  actualDurationMs: integer("actualDurationMs"),
  // Number of (re)assignment attempts — bumped by rebalancing on device-offline.
  retryCount: integer("retryCount").default(0).notNull(),
  // Free-form per-task payload (job spec params, decomposition metadata).
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  // Tenant scope (mirrors production_orders). corporateCode used by RLS predicate.
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  // Last failure / cancel reason for forensics.
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  assignedAt: timestamp("assignedAt"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
}, (table) => [
  // Allocator hot path: scan pending tasks by capability ordered by priority.
  index("idx_tasks_status").on(table.status),
  index("idx_tasks_capability").on(table.requiredCapability),
  index("idx_tasks_priority").on(table.priority),
  index("idx_tasks_status_capability").on(table.status, table.requiredCapability),
  // Find a device's open tasks (queue length + rebalancing on offline).
  index("idx_tasks_device").on(table.assignedDeviceId),
  index("idx_tasks_source_order").on(table.sourceWorkOrderId),
]);

/**
 * Zone — a physical/logical area robots traverse, with a concurrency cap.
 *
 *  zoneType : production | transit | charging | human_shared
 *  bounds   : optional jsonb geometry (e.g. { polygon:[[x,y],…] } or { x,y,w,h }).
 *             G1 does NOT yet have a real occupancy-grid map — bounds is advisory
 *             metadata only; concurrency is enforced by counting active reservations.
 *
 * current_occupancy is NOT stored (it is DERIVED from active zone_reservations) to
 * avoid a denormalized counter drifting out of sync.
 */
export const zones = pgTable("zones", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  zoneType: varchar("zoneType", { length: 24 }).default("production").notNull(),
  // Max devices allowed inside concurrently (the "virtual traffic light" cap). >=1.
  maxConcurrentRobots: integer("maxConcurrentRobots").default(1).notNull(),
  // Optional geometry/bounds (advisory in G1 — no real map yet).
  bounds: jsonb("bounds").$type<Record<string, unknown>>(),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_zones_code").on(table.code),
  index("idx_zones_type").on(table.zoneType),
]);

/**
 * Zone Reservation — a device's claim on a zone for a time window.
 *
 *  status : active | released | rejected | queued
 *           active   → currently held (counts toward occupancy)
 *           queued   → waiting for capacity (reservation-based nav backpressure)
 *           released → terminal (device left the zone / claim freed)
 *           rejected → terminal (denied: capacity full and not queued)
 *
 * The traffic manager's deadlock detector builds a wait-graph over queued
 * reservations (device A waits on zone held by device B …) and reports cycles.
 */
export const zoneReservations = pgTable("zone_reservations", {
  id: serial("id").primaryKey(),
  zoneId: integer("zoneId").notNull(),
  // Device holding/seeking the reservation (robots.id for robots).
  deviceId: integer("deviceId").notNull(),
  deviceKind: varchar("deviceKind", { length: 16 }).default("robot").notNull(),
  // The task this reservation serves (nullable for manual reservations).
  taskId: integer("taskId"),
  status: varchar("status", { length: 16 }).default("active").notNull(),
  reservedFrom: timestamp("reservedFrom").defaultNow().notNull(),
  reservedUntil: timestamp("reservedUntil"),
  releasedAt: timestamp("releasedAt"),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  // Occupancy / concurrency check: active reservations for a zone.
  index("idx_zone_res_zone_status").on(table.zoneId, table.status),
  // A device's reservations (wait-graph + release on offline).
  index("idx_zone_res_device").on(table.deviceId),
  index("idx_zone_res_task").on(table.taskId),
  // W2-6 (doc 25 T5, migration 0164): a device may hold at most ONE active slot in a
  // zone (idempotent re-entry). Per-zone CAPACITY is a count, enforced in code under
  // the zone-row FOR UPDATE lock — not expressible as a uniqueness constraint.
  uniqueIndex("uq_zone_res_active_zone_device").on(table.zoneId, table.deviceId).where(sql`${table.status} = 'active'`),
]);

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;
export type Zone = typeof zones.$inferSelect;
export type InsertZone = typeof zones.$inferInsert;
export type ZoneReservation = typeof zoneReservations.$inferSelect;
export type InsertZoneReservation = typeof zoneReservations.$inferInsert;
