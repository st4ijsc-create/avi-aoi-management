// Schema domain: Field & Device Abstraction (Khối 1, doc 16 §5 / §15 X1)
//                — flag FIELD_V2_ENABLED (default OFF)
//
// ════════════════════════════════════════════════════════════════════════════
// X1 COMPLETES the field/device abstraction layer. This domain adds ONE table —
// field_device_health — that the heartbeat TTL stale-detection sweep (X1-b),
// the push-streaming gateway (X1-c) and the hot-plug discovery path (X1-d) share:
//
//   field_device_health — ONE row per device, tracking its latest observed
//     heartbeat + the derived liveness `state`. The sweep marks a device
//     'lost_connection' once now()-lastHeartbeat exceeds its TTL (per-device
//     heartbeatTtlMs, else the global FIELD_HEARTBEAT_TTL_MS). Discovery records a
//     candidate here on registration (discoveredVia/endpoint).
//
//     state : live | stale | lost_connection | unknown
//             live            → heartbeat within TTL
//             stale           → heartbeat older than TTL but within the lost grace
//             lost_connection → heartbeat older than the lost-connection threshold
//             unknown         → no heartbeat observed yet (e.g. just discovered)
//
// ⚠ SAFETY: monitoring/STATE only — opens NO device-control path. A 'lost_connection'
//   transition EMITS an advisory event (safety/fleet may react via the existing gated
//   paths); it performs NO safety-rated stop and is NOT a substitute for one.
//
// TENANT SCOPE: corporateCode (varchar) + factoryId (int) + a free `scope` tag mirror
// fleet / safetyWorkforce. RLS is wired in 0148 with the shared inert-by-default
// app_tenant_allows() helper on corporateCode — a no-op until TENANT_RLS_ENABLED.
//
// state/kind columns are varchar (NOT pg enums) → the migration stays additive.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Field Device Health — liveness ledger for the heartbeat TTL stale-detection.
 *
 * `deviceKey` is the logical device id ("robot:<id>" | "machine:<id>" |
 * "device:<externalId>") and is UNIQUE (one health row per device).
 */
export const fieldDeviceHealth = pgTable("field_device_health", {
  id: serial("id").primaryKey(),
  deviceKey: varchar("deviceKey", { length: 128 }).notNull().unique(),
  deviceKind: varchar("deviceKind", { length: 24 }).default("robot").notNull(),
  // Soft FK -> robots.id / machines.id (no DB FK — additive/safe, mirrors masterdata).
  robotId: integer("robotId"),
  machineId: integer("machineId"),
  state: varchar("state", { length: 24 }).default("unknown").notNull(),
  lastHeartbeat: timestamp("lastHeartbeat"),
  // Per-device TTL override in ms (NULL → use the global FIELD_HEARTBEAT_TTL_MS).
  heartbeatTtlMs: integer("heartbeatTtlMs"),
  // X1-d discovery provenance: how this device entered the registry.
  discoveredVia: varchar("discoveredVia", { length: 24 }),
  endpoint: varchar("endpoint", { length: 255 }),
  lastEventAt: timestamp("lastEventAt"),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_fielddevhealth_state").on(table.state),
  index("idx_fielddevhealth_robot").on(table.robotId),
  index("idx_fielddevhealth_machine").on(table.machineId),
  index("idx_fielddevhealth_heartbeat").on(table.lastHeartbeat),
]);

export type FieldDeviceHealth = typeof fieldDeviceHealth.$inferSelect;
export type InsertFieldDeviceHealth = typeof fieldDeviceHealth.$inferInsert;
