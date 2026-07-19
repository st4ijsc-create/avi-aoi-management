// Schema domain: Equipment Standardization & Governance (Khối 5, doc 16 §10 / §15 E1)
//                — flag EQ_GOVERN_ENABLED (default OFF)
//
// ════════════════════════════════════════════════════════════════════════════
// E1 adds a GOVERNANCE / STANDARDIZATION LAYER on top of the existing capability
// model (server/services/equipment/capabilityModel.ts + packml.ts). It does NOT
// replace or fork them — the registry SEEDS from those profiles and versions them.
//
//   E1-a Versioned Device Type Hierarchy + Schema Registry
//     • device_types — a versioned, multi-level inheritance tree of device types
//                      (Equipment → Robot → CollaborativeRobot, plus the AOI/CNC/…
//                      classes). Each level adds attributes; `extensionFields` is
//                      preserved at every level (vendor-specific). status draft|
//                      published|archived; version is a SemVer string.
//
//   E1-b ISA-18.2 Alarm Taxonomy
//     • alarm_taxonomy — map a vendor's NATIVE alarm code → a standard internal code
//                        + ISA-18.2 severity (critical|high|medium|low|diagnostic) +
//                        recommended action. Lets adapters/andon normalize raw codes.
//
//   E1-c Equipment Standards Board change-request workflow
//     • device_type_change_requests — submit → review → approve → publish a NEW
//                        device_types version. Backward-compat is ENFORCED: a publish
//                        may only ADD fields (minor|patch); removing/altering a
//                        published field requires a major bump and is FLAGGED.
//                        Conformance gate (pending|pass|fail) + staging→production.
//
// ════════════════════════════════════════════════════════════════════════════
// SAFETY / NO-OP: every write here is GOVERNANCE METADATA only — versioning,
// taxonomy, change-requests, conformance results. It opens NO device-control path.
// Actual device commands still route through the EXISTING gated dispatchers
// (commandDispatcher / robotCommandDispatcher, dry-run by default).
//
// TENANT SCOPE: every table carries a free `scope` tag + `corporateCode` (varchar) +
// `factoryId` (int) like fleet.ts / safetyWorkforce.ts. RLS is wired in migration
// 0146 with the shared inert-by-default app_tenant_allows() helper on corporateCode
// (mirrors 0142–0145) — a no-op until TENANT_RLS_ENABLED.
//
// status / kind / severity columns are varchar (NOT new pg enums) on purpose → the
// migration stays additive (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE), matching
// fleet.ts (0142) / fleetResource (0143) / twin (0144) / safetyWorkforce (0145).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, jsonb, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { CommandDescriptor, TelemetryDescriptor } from "../../server/services/equipment/capabilityModel";
import type { PackmlState } from "../../server/services/equipment/packml";

// ════════════════════════════════════════════════════════════════════════════
// E1-a — Versioned Device Type Hierarchy + Schema Registry
// ════════════════════════════════════════════════════════════════════════════

/** ONE attribute slot in a device type's attributesSchema (JSON-schema-ish). */
export interface DeviceTypeAttribute {
  name: string;
  label?: string;
  dataType: "bool" | "int" | "float" | "string" | "json" | "enum";
  unit?: string;
  required?: boolean;
  options?: Array<string | number>;
  description?: string;
}

/**
 * Device Type — ONE versioned node in the inheritance tree. typeKey is the stable
 * identity (e.g. "Equipment", "Robot", "CollaborativeRobot", "AOI"); parentTypeKey
 * links to its parent for multi-level inheritance. A (typeKey, version) pair is
 * unique. Resolution merges parent→child (deviceTypeRegistry.resolveType).
 *
 *  status : draft | published | archived
 *           draft     → editable, not yet governed/usable as a published contract
 *           published → immutable, the contract conformance/compliance is measured against
 *           archived  → superseded by a newer published version
 */
export const deviceTypes = pgTable("device_types", {
  id: serial("id").primaryKey(),
  // Stable identity of the type (NOT unique alone — unique per (typeKey, version)).
  typeKey: varchar("typeKey", { length: 64 }).notNull(),
  // Parent type for multi-level inheritance (nullable for the Equipment root).
  parentTypeKey: varchar("parentTypeKey", { length: 64 }),
  // SemVer string (e.g. "1.0.0"). Stored as text; parsed/compared in the service.
  version: varchar("version", { length: 24 }).notNull().default("1.0.0"),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  label: varchar("label", { length: 128 }),
  description: text("description"),
  // The attribute contract this LEVEL adds (merged with ancestors on resolve).
  attributesSchema: jsonb("attributesSchema").$type<DeviceTypeAttribute[]>().default([]),
  // CommandDescriptor[] this level supports (shape mirrors capabilityModel).
  supportedCommands: jsonb("supportedCommands").$type<CommandDescriptor[]>().default([]),
  // PackmlState[] this level can occupy (subset of the 17).
  supportedStates: jsonb("supportedStates").$type<PackmlState[]>().default([]),
  // Vendor/extension free-form fields — PRESERVED (never dropped) at every level.
  extensionFields: jsonb("extensionFields").$type<Record<string, unknown>>().default({}),
  // Which equipmentClass machineType(s) this type maps to (for machine→type lookup).
  mappedMachineTypes: jsonb("mappedMachineTypes").$type<string[]>().default([]),
  // Default adapter kind for this type (mirrors capabilityModel.adapterKind).
  adapterKind: varchar("adapterKind", { length: 32 }),
  changelog: text("changelog"),
  publishedAt: timestamp("publishedAt"),
  // 'seed' marks rows imported from capabilityModel; 'manual' for board-published.
  origin: varchar("origin", { length: 16 }).notNull().default("manual"),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_devtype_key_version").on(table.typeKey, table.version),
  index("idx_devtype_key").on(table.typeKey),
  index("idx_devtype_parent").on(table.parentTypeKey),
  index("idx_devtype_status").on(table.status),
]);

// ════════════════════════════════════════════════════════════════════════════
// E1-b — ISA-18.2 Alarm Taxonomy
// ════════════════════════════════════════════════════════════════════════════

/**
 * Alarm Taxonomy entry — maps a vendor's native alarm code (for a given machineType/
 * deviceType) onto a STANDARD internal code + an ISA-18.2 severity + a recommended
 * action. alarmTaxonomy.mapAlarm(vendor, nativeCode) reads this; adapters/andon use
 * it to normalize raw codes.
 *
 *  severity (ISA-18.2 priority bands): critical | high | medium | low | diagnostic
 */
export const alarmTaxonomy = pgTable("alarm_taxonomy", {
  id: serial("id").primaryKey(),
  // Vendor key (e.g. "fanuc", "universal_robots", "mitsubishi"). Lower-cased on write.
  vendor: varchar("vendor", { length: 48 }).notNull(),
  // Either a legacy machineType (AOI/ROBOT/…) or a deviceTypeKey — optional scoping.
  machineType: varchar("machineType", { length: 32 }),
  deviceTypeKey: varchar("deviceTypeKey", { length: 64 }),
  // The vendor's raw/native alarm code (e.g. "SRVO-050", "C153").
  nativeCode: varchar("nativeCode", { length: 64 }).notNull(),
  // The standardized internal code (e.g. "COLLISION_DETECT", "OVERTEMP").
  standardCode: varchar("standardCode", { length: 64 }).notNull(),
  severity: varchar("severity", { length: 16 }).notNull().default("medium"),
  description: text("description"),
  recommendedAction: text("recommendedAction"),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_alarmtax_vendor_native").on(table.vendor, table.nativeCode),
  index("idx_alarmtax_vendor").on(table.vendor),
  index("idx_alarmtax_standard").on(table.standardCode),
  index("idx_alarmtax_machinetype").on(table.machineType),
]);

// ════════════════════════════════════════════════════════════════════════════
// W5-21 (doc 25) — ISA-18.2 / EEMUA-191 MASTER ALARM DATABASE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Master Alarm — ONE rationalized alarm point in the ISA-18.2 master alarm database.
 * Where alarm_taxonomy is only a vendor dictionary (nativeCode → standardCode + severity),
 * master_alarms adds the RATIONALIZATION core the standard requires:
 *   • priority       — DERIVED from consequence × timeToRespond (EEMUA-191 matrix),
 *                      stored so it is auditable. See alarmMasterService.derivePriority.
 *   • setpoint       — the alarm trip point (free text: value + unit).
 *   • deadband       — the return-to-normal hysteresis (free text) — chattering control.
 *   • consequence    — severity of the consequence if the operator does NOT respond
 *                      (none | minor | major | severe).
 *   • timeToRespond  — minutes the operator has to act before the consequence occurs.
 *   • rationalization— the free-text justification (why this alarm exists / what to do).
 *   • shelvedUntil   — ISA-18.2 SHELVING: a temporary operator-set silence window. While
 *                      in the future the runtime bridge does NOT raise this alarm.
 *   • isSuppressed   — permanent design suppression (out-of-service / maintenance mode).
 *
 * alarmKey joins to alarm_taxonomy.standardCode (the normalized code the runtime raises).
 * assetType scopes the master alarm to a machineType/deviceType class (nullable = global).
 *
 * SAFETY / NO-OP: this is GOVERNANCE + SIGNAL metadata only. Shelving/suppression only
 * ever SUPPRESSES an Andon (a visual signal) — it opens no device-control path.
 *
 * status/priority/consequence are varchar (NOT new pg enums) → the migration stays
 * additive (CREATE TABLE/INDEX/POLICY only), matching the sibling E1 tables above.
 */
export const masterAlarms = pgTable("master_alarms", {
  id: serial("id").primaryKey(),
  // Standard alarm code (joins alarm_taxonomy.standardCode) — the rationalized key.
  alarmKey: varchar("alarmKey", { length: 64 }).notNull(),
  // Optional asset class scope (machineType/deviceTypeKey). Null = applies to all.
  assetType: varchar("assetType", { length: 48 }),
  // Optional vendor+native correlation (so a raw vendor alarm can match a master row too).
  vendor: varchar("vendor", { length: 48 }),
  nativeCode: varchar("nativeCode", { length: 64 }),
  label: varchar("label", { length: 128 }),
  // DERIVED priority (low|medium|high|critical) — computed from consequence×timeToRespond.
  priority: varchar("priority", { length: 16 }).notNull().default("low"),
  // Consequence band if unattended: none|minor|major|severe.
  consequence: varchar("consequence", { length: 16 }).notNull().default("minor"),
  // Minutes the operator has to respond before the consequence occurs.
  timeToRespond: integer("timeToRespond"),
  // Free-text trip point + hysteresis (chattering control).
  setpoint: varchar("setpoint", { length: 96 }),
  deadband: varchar("deadband", { length: 96 }),
  rationalization: text("rationalization"),
  // doc 63 DEP-06 (mig 0296) — ISA-18.2 mandatory field #4: probable CAUSE, authored at
  // rationalization time and joined into the live operator alarm feed (AUD-02).
  cause: text("cause"),
  // ISA-18.2 shelving: silence until this instant (future = shelved). Null = not shelved.
  shelvedUntil: timestamp("shelvedUntil"),
  // Permanent design suppression (out-of-service). true = never raise.
  isSuppressed: boolean("isSuppressed").notNull().default(false),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_masteralarm_key_asset").on(table.alarmKey, table.assetType),
  index("idx_masteralarm_key").on(table.alarmKey),
  index("idx_masteralarm_priority").on(table.priority),
  index("idx_masteralarm_vendor").on(table.vendor),
]);

// ════════════════════════════════════════════════════════════════════════════
// E1-c — Equipment Standards Board change-request workflow
// ════════════════════════════════════════════════════════════════════════════

/**
 * Device Type Change Request — the governance workflow record. A board member submits
 * a CR (new_type | modify | deprecate); a reviewer approves/rejects; on approve+publish
 * a NEW device_types version is created (governanceService.publishChangeRequest).
 *
 *  kind             : new_type | modify | deprecate
 *  status           : pending | in_review | approved | rejected | published
 *  conformanceStatus: pending | pass | fail   (the conformance gate result)
 *  stage            : none | staging | production   (promotion stage)
 *  semverBump       : major | minor | patch   (computed/declared; major REQUIRED for
 *                     any field removal/alteration — see governanceService backward-compat)
 *
 * proposedSchema carries the proposed device-type payload (attributesSchema +
 * supportedCommands + supportedStates + extensionFields + parentTypeKey …).
 */
export const deviceTypeChangeRequests = pgTable("device_type_change_requests", {
  id: serial("id").primaryKey(),
  // Stable human/UI key for the CR (e.g. "CR-1720000000-abc"). Unique.
  crKey: varchar("crKey", { length: 64 }).notNull(),
  targetTypeKey: varchar("targetTypeKey", { length: 64 }).notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  proposedSchema: jsonb("proposedSchema").$type<Record<string, unknown>>().default({}),
  requestedBy: integer("requestedBy"),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  reviewedBy: integer("reviewedBy"),
  reviewNotes: text("reviewNotes"),
  conformanceStatus: varchar("conformanceStatus", { length: 16 }).notNull().default("pending"),
  stage: varchar("stage", { length: 16 }).notNull().default("none"),
  semverBump: varchar("semverBump", { length: 8 }),
  // Set when published — the device_types version this CR produced.
  publishedVersion: varchar("publishedVersion", { length: 24 }),
  // Backward-compat flag: true when the proposal removes/alters a published field.
  backwardIncompatible: varchar("backwardIncompatible", { length: 8 }),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
  publishedAt: timestamp("publishedAt"),
}, (table) => [
  uniqueIndex("uq_devtype_cr_key").on(table.crKey),
  index("idx_devtype_cr_target").on(table.targetTypeKey),
  index("idx_devtype_cr_status").on(table.status),
  index("idx_devtype_cr_kind").on(table.kind),
]);

export type DeviceType = typeof deviceTypes.$inferSelect;
export type InsertDeviceType = typeof deviceTypes.$inferInsert;
export type AlarmTaxonomyEntry = typeof alarmTaxonomy.$inferSelect;
export type InsertAlarmTaxonomyEntry = typeof alarmTaxonomy.$inferInsert;
export type DeviceTypeChangeRequest = typeof deviceTypeChangeRequests.$inferSelect;
export type InsertDeviceTypeChangeRequest = typeof deviceTypeChangeRequests.$inferInsert;
export type MasterAlarm = typeof masterAlarms.$inferSelect;
export type InsertMasterAlarm = typeof masterAlarms.$inferInsert;
