// Schema domain: OT Connectivity Framework (Sprint F1.1)
//
// Industrial (OT) device connectivity tables, sitting in PARALLEL to the existing
// machine/MQTT/OPC-UA scaffold (backward-compatible, no regression to AOI/MQTT).
//   - deviceAdapters: one configured connection to a PLC/SCADA/device (protocol + endpoint)
//   - deviceTags:     individual addressable points read from an adapter
//   - otTelemetry:    time-series samples ingested from tags
import { pgTable, serial, bigserial, integer, text, timestamp, varchar, decimal, boolean, doublePrecision, json, jsonb, index, unique, uniqueIndex } from "drizzle-orm/pg-core"; // `unique` used by deviceTags composite key; `uniqueIndex` used by the partial active-recipe index
import { sql } from "drizzle-orm"; // partial-index predicate (WHERE status='active')
import { otProtocolEnum, otDataTypeEnum, otAdapterStatusEnum, machineTypeEnum, recipeStatusEnum, deploymentStatusEnum, commandStatusEnum, commandTriggerKindEnum, telemetryProtocolEnum, telemetryQualityEnum } from "./enums";
// W3-A (doc 27 M1, 0180): machineRecipes/recipeDeployments now carry real FKs to machines.
import { machines } from "./hierarchy";

/**
 * Device Adapters — một kết nối OT đã cấu hình (protocol + endpoint) tới PLC/SCADA/thiết bị.
 * Chỉ adapter `stub` hoạt động thực trong F1.1; các protocol khác là khung (F1.2/F1.3).
 */
export const deviceAdapters = pgTable("device_adapters", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId"),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  protocol: otProtocolEnum("protocol").notNull(),
  endpoint: varchar("endpoint", { length: 500 }).notNull(),
  // Free-form driver options. doc 24 Wave-3 / C3: the OPTIONAL secondary
  // (hot-standby) endpoint for connection HA/failover lives ADDITIVELY inside
  // this json under `ha` — connectionOptions.ha.secondaryEndpoint (string)
  // [+ optional .secondaryOptions] — so no schema migration is needed and older
  // rows without it remain single-endpoint (backward-compatible). Consumed only
  // when OT_CONN_HA_ENABLED === "true" (see connectionSupervisor.ts).
  connectionOptions: json("connectionOptions").$type<Record<string, unknown>>(),
  pollIntervalMs: integer("pollIntervalMs").default(5000).notNull(),
  status: otAdapterStatusEnum("status").default("disabled").notNull(),
  lastConnectedAt: timestamp("lastConnectedAt"),
  lastErrorAt: timestamp("lastErrorAt"),
  lastError: text("lastError"),
  isEnabled: boolean("isEnabled").default(false).notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_device_adapters_machine").on(table.machineId),
  index("idx_device_adapters_protocol").on(table.protocol),
  index("idx_device_adapters_enabled").on(table.isEnabled),
]);

export type DeviceAdapter = typeof deviceAdapters.$inferSelect;
export type InsertDeviceAdapter = typeof deviceAdapters.$inferInsert;

/**
 * Device Tags — các điểm địa chỉ đọc được từ một adapter (1 adapter : N tag).
 */
export const deviceTags = pgTable("device_tags", {
  id: serial("id").primaryKey(),
  adapterId: integer("adapterId").notNull(),
  tagKey: varchar("tagKey", { length: 128 }).notNull(),
  address: varchar("address", { length: 255 }).notNull(),
  dataType: otDataTypeEnum("dataType").notNull(),
  unit: varchar("unit", { length: 50 }),
  scale: decimal("scale", { precision: 18, scale: 6 }).default("1"),
  offset: decimal("offset", { precision: 18, scale: 6 }).default("0"),
  writable: boolean("writable").default(false).notNull(),
  isEnabled: boolean("isEnabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_device_tags_adapter").on(table.adapterId),
  unique("uq_device_tags_adapter_key").on(table.adapterId, table.tagKey),
]);

export type DeviceTag = typeof deviceTags.$inferSelect;
export type InsertDeviceTag = typeof deviceTags.$inferInsert;

/**
 * OT Telemetry — THE single canonical telemetry sample store (doc 12 §5 / P2).
 *
 * Every device protocol (MQTT / OPC-UA / Modbus / S7 / EtherNet-IP / MTConnect /
 * Sparkplug) AND the inspection pipeline write their normalized samples into THIS
 * one table — no more per-protocol silos. One row = one (ts, machine/device,
 * metric) observation. Numeric → numValue (double precision); bool → boolValue;
 * string/json → textValue. `meta` carries the raw payload / extra fields.
 *
 * TIMESCALE-READY (not yet a hypertable): this is a plain table today. The
 * DEFERRED migration drizzle/0133_*.sql converts it to a TimescaleDB hypertable
 * on `ts` + continuous aggregates + compression/retention, to be applied by an
 * operator ONCE the timescaledb extension is installed. We deliberately do NOT
 * use native declarative partitioning (it would conflict with hypertable
 * conversion). `id` is a plain bigserial PK now; 0133 widens the PK to (id, ts)
 * so the hypertable partition key is part of the primary key.
 */
export const otTelemetry = pgTable("ot_telemetry", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  // Event time (source/device timestamp) — the hypertable partition column.
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  // Soft ref to machines.id (nullable for not-yet-mapped devices). No FK so a
  // high-volume insert path is never blocked by referential checks.
  machineId: integer("machineId"),
  // External/source device identifier (broker client id, OPC node, etc.).
  deviceId: text("deviceId"),
  protocol: telemetryProtocolEnum("protocol").notNull(),
  // Normalized tag/metric name (e.g. "temperature", "spindle_speed").
  metric: text("metric").notNull(),
  // Exactly one of numValue / textValue / boolValue is typically set per row.
  numValue: doublePrecision("numValue"),
  textValue: text("textValue"),
  boolValue: boolean("boolValue"),
  unit: text("unit"),
  quality: telemetryQualityEnum("quality").default("good").notNull(),
  // Raw payload / extra fields that don't map to a typed column.
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  // Server receive time (vs `ts` = source event time) — defaults to now().
  ingestedAt: timestamp("ingestedAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // High-volume read patterns: latest-per-machine, per-metric series, per-protocol.
  index("idx_ot_telemetry_machine_ts").on(table.machineId, table.ts.desc()),
  index("idx_ot_telemetry_metric_ts").on(table.metric, table.ts.desc()),
  index("idx_ot_telemetry_protocol_ts").on(table.protocol, table.ts.desc()),
]);

export type OtTelemetry = typeof otTelemetry.$inferSelect;
export type InsertOtTelemetry = typeof otTelemetry.$inferInsert;

// ─── Sprint F4a — Machine control (recipe versioning + deploy + command log) ───
//
// SAFETY: these tables back the HITL-gated control framework. In F4a the
// commandDispatcher runs in DRY-RUN (OT_CONTROL_ENABLED=false) → commandLog rows
// are written with status='simulated' and NO driver.writeTags is ever called.

/**
 * Machine Recipes — versioned recipe/parameter sets for a machine (or a machine
 * type). A logical recipe is keyed by `code`; each save bumps `version`. Exactly
 * one version per code is `active` (the deployed one); others are draft/archived.
 */
export const machineRecipes = pgTable("machine_recipes", {
  id: serial("id").primaryKey(),
  // W3-A (doc 27 M1, 0180): fk_machine_recipes_machine, ON DELETE RESTRICT —
  // recipes are audit lineage; NULL is legitimate (machine-TYPE recipe).
  machineId: integer("machineId")
    .references(() => machines.id, { onDelete: "restrict" }),
  machineType: machineTypeEnum("machineType"),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  version: integer("version").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  checksum: varchar("checksum", { length: 128 }),
  status: recipeStatusEnum("status").default("draft").notNull(),
  notes: text("notes"),
  createdBy: integer("createdBy"),
  // W5-22 (doc 25 (a), migration 0170) — cờ GOLDEN/master: đánh dấu phiên bản
  // baseline (bộ tham số chuẩn) của một code để đối chiếu khi deploy/diff. Curator
  // flag ở tầng app (không ràng buộc unique ở DB).
  isGolden: boolean("isGolden").default(false).notNull(),
  // W2-9 (doc 25 T6, migration 0165) — second-approver (segregation of duties):
  // recipe phải được một người KHÁC người tạo (createdBy) trình duyệt trước khi deploy.
  approvedBy: integer("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  approvalNote: text("approvalNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  unique("uq_machine_recipes_code_version").on(table.code, table.version),
  index("idx_machine_recipes_machine").on(table.machineId),
  index("idx_machine_recipes_type").on(table.machineType),
  index("idx_machine_recipes_status").on(table.status),
  // W2-6 (doc 25 T5, migration 0164): DB-level guard for the "exactly one active
  // (=released) version per code" invariant. Also covers the equipment-integration
  // 'released' status which maps 1:1 onto the DB enum value 'active'.
  uniqueIndex("uq_machine_recipes_active_code").on(table.code).where(sql`${table.status} = 'active'`),
  // W5-22 (0170) — tra cứu nhanh phiên bản golden theo code.
  index("idx_machine_recipes_golden").on(table.code).where(sql`${table.isGolden} = true`),
]);

export type MachineRecipe = typeof machineRecipes.$inferSelect;
export type InsertMachineRecipe = typeof machineRecipes.$inferInsert;

/**
 * Recipe Deployments — an audit-grade record of deploying a recipe version to a
 * machine. `previousRecipeId` enables one-step rollback. `commandLogId` links to
 * the dispatched command (when the deploy pushed a select_recipe command).
 */
export const recipeDeployments = pgTable("recipe_deployments", {
  id: serial("id").primaryKey(),
  // W3-A (doc 27 M1, 0180): audit-grade deploy records — RESTRICT on both the
  // deployed recipe and the machine (a deploy record must never dangle).
  recipeId: integer("recipeId").notNull()
    .references(() => machineRecipes.id, { onDelete: "restrict" }),
  machineId: integer("machineId").notNull()
    .references(() => machines.id, { onDelete: "restrict" }),
  adapterId: integer("adapterId"),
  deployedBy: integer("deployedBy").notNull(),
  deployedAt: timestamp("deployedAt").defaultNow().notNull(),
  // W3-A (0180): one-step-rollback pointer — SET NULL (losing it degrades
  // gracefully; it must not block deleting an old archived recipe forever).
  previousRecipeId: integer("previousRecipeId")
    .references(() => machineRecipes.id, { onDelete: "set null" }),
  status: deploymentStatusEnum("status").default("pending").notNull(),
  commandLogId: integer("commandLogId"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_recipe_deployments_recipe").on(table.recipeId),
  index("idx_recipe_deployments_machine").on(table.machineId),
  index("idx_recipe_deployments_deployed").on(table.deployedAt),
  // W3-A (0180): supports the ON DELETE SET NULL scan on machine_recipes deletes.
  index("idx_recipe_deployments_previous").on(table.previousRecipeId).where(sql`${table.previousRecipeId} IS NOT NULL`),
]);

export type RecipeDeployment = typeof recipeDeployments.$inferSelect;
export type InsertRecipeDeployment = typeof recipeDeployments.$inferInsert;

/**
 * Command Log — append-only record of every command the dispatcher handled,
 * across ALL branches (rejected / failed / simulated / [F4b: sent/acked]).
 * `actionId` ties back to the ai_pending_actions row that was confirmed (HITL).
 * `idempotencyKey` is unique → at most one effective dispatch per key.
 */
export const commandLog = pgTable("command_log", {
  id: serial("id").primaryKey(),
  actionId: varchar("actionId", { length: 64 }),
  adapterId: integer("adapterId").notNull(),
  machineId: integer("machineId"),
  tagKey: varchar("tagKey", { length: 128 }),
  address: varchar("address", { length: 255 }),
  commandType: varchar("commandType", { length: 64 }),
  requestedValue: jsonb("requestedValue"),
  requestedBy: integer("requestedBy").notNull(),
  confirmedBy: integer("confirmedBy").notNull(),
  status: commandStatusEnum("status").default("simulated").notNull(),
  // ── Sprint F5b (additive, nullable; F4 HITL rows keep default 'hitl') ──────
  // What triggered this command. 'hitl' = human-confirmed AI write-action (F4);
  // 'interlock' = deterministic, human-approved interlock rule auto-firing (F5b).
  triggerKind: commandTriggerKindEnum("triggerKind").default("hitl").notNull(),
  // For triggerKind='interlock': the rule + event that authorized this command,
  // and the user who APPROVED that rule (they own responsibility for the auto-block).
  interlockRuleId: integer("interlockRuleId"),
  interlockEventId: integer("interlockEventId"),
  approvedBy: integer("approvedBy"),
  ackValue: jsonb("ackValue"),
  // Sprint G2.1 — value read back from the device AFTER a successful write
  // (already scaled to the user's value). null when read-back disabled/unavailable.
  // `verified` is NOT a separate column — it is encoded in status
  // (acked_verified vs acked_unverified).
  readBackValue: jsonb("readBackValue"),
  errorText: text("errorText"),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).unique(),
  sentAt: timestamp("sentAt"),
  ackedAt: timestamp("ackedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_command_log_action").on(table.actionId),
  index("idx_command_log_adapter").on(table.adapterId),
  index("idx_command_log_machine").on(table.machineId),
  index("idx_command_log_status").on(table.status),
  index("idx_command_log_created").on(table.createdAt),
]);

export type CommandLog = typeof commandLog.$inferSelect;
export type InsertCommandLog = typeof commandLog.$inferInsert;

// ─── Doc 24 / Wave-1 C2 — Hardware commissioning / FAT gate ───────────────────
//
// SAFETY (an ADDITIONAL gate, layered ON TOP of the mode gate; never weakens it):
//   A real (non-simulated) control write to an adapter is BLOCKED unless that
//   adapter has an ACTIVE, non-expired, SIGNED commissioning record — mirroring the
//   proven sim-gate → deploy precondition (programmingService). When the flag
//   OT_COMMISSIONING_REQUIRED is on (the DEFAULT) and the adapter is not commissioned,
//   commandDispatcher FORCES the 'simulated' path regardless of OT_CONTROL_ENABLED
//   (records a command_log row with errorText 'not_commissioned: …'; NO driver write).
//   This table is the sign-off ledger the gate consults.
//
// `status` is a plain varchar (NOT a pg enum) so the migration stays additive +
// idempotent (no ALTER TYPE): one of 'active' | 'revoked' | 'expired'. Only an
// 'active' row with (expiresAt IS NULL OR expiresAt > now()) commissions the adapter.

/**
 * Commissioning Records — an append-mostly sign-off ledger: proof that an adapter
 * passed its Factory Acceptance Test (FAT) / hardware commissioning and MAY receive
 * real control writes. Admin-gated create (sign) / revoke. `signedBy`/`signedAt`
 * capture who accepted responsibility; `fatReference` links the external FAT report.
 */
export const commissioningRecords = pgTable("commissioning_records", {
  id: serial("id").primaryKey(),
  adapterId: integer("adapterId").notNull(),
  // 'active' (signed & in force) | 'revoked' (manually rescinded) | 'expired'.
  // Only 'active' + non-expired commissions the adapter for real writes.
  status: varchar("status", { length: 16 }).default("active").notNull(),
  /** External FAT / commissioning report reference (doc id, ticket, checklist). */
  fatReference: varchar("fatReference", { length: 255 }),
  /** User (users.id) who signed off the commissioning — owns responsibility. */
  signedBy: integer("signedBy").notNull(),
  signedAt: timestamp("signedAt").defaultNow().notNull(),
  /** Optional validity expiry; NULL = no expiry. A past expiry ⇒ NOT commissioned. */
  expiresAt: timestamp("expiresAt"),
  /** Set when status becomes 'revoked' (who + when + why). */
  revokedBy: integer("revokedBy"),
  revokedAt: timestamp("revokedAt"),
  revokeReason: text("revokeReason"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_commissioning_records_adapter").on(table.adapterId),
  index("idx_commissioning_records_status").on(table.status),
  // Fast "is this adapter commissioned?" probe (adapter + status).
  index("idx_commissioning_records_adapter_status").on(table.adapterId, table.status),
]);

export type CommissioningRecord = typeof commissioningRecords.$inferSelect;
export type InsertCommissioningRecord = typeof commissioningRecords.$inferInsert;

// ─── Doc 24 / Connectivity — No-code Tag → UNS mapping designer ────────────────
//
// A HighByte-style "Intelligence Hub" model: map a raw OT adapter tag → an ISA-95
// UNS topic + a Sparkplug metric name, with per-tag CONDITIONING (rename, scale,
// offset, unit, type cast, deadband) configured in the UI instead of in code.
//
// SAFETY / SCOPE: this is a READ-DIRECTION publish concern ONLY. It reshapes how a
// telemetry sample is PUBLISHED to the UNS; it opens NO control path and never
// influences the inbound NCMD/DCMD → commandDispatcher safety. Consulted at publish
// time ONLY when UNS_MAPPING_ENABLED === "true" (default OFF ⇒ today's normalization
// is unchanged, and an unmapped tag always keeps the default behaviour).

/**
 * Per-tag conditioning applied to a raw value before it is published to the UNS.
 * All fields optional; an empty transform is a pass-through (value unchanged).
 *   - rename:   output metric/leaf name override (does NOT change the value); also
 *               usable as the {rename} placeholder in a unsTopic template.
 *   - scale/offset: numeric conditioning — value := value*scale + offset.
 *   - unit:     unit label attached to the published (JSON) payload.
 *   - cast:     coerce the final value to a concrete scalar type.
 *   - deadband: suppress a publish when |new − lastPublished| < deadband (numeric).
 */
export interface UnsTagTransform {
  rename?: string;
  scale?: number;
  offset?: number;
  unit?: string;
  cast?: "number" | "bool" | "string";
  deadband?: number;
}

/**
 * UNS Tag Mappings — one row maps (adapterId, tag) → a UNS topic template +
 * Sparkplug metric name + a conditioning transform. Unique per (adapterId, tag).
 */
export const unsTagMappings = pgTable("uns_tag_mappings", {
  id: serial("id").primaryKey(),
  adapterId: integer("adapterId").notNull(),
  /** Raw source tag key (matches deviceTags.tagKey / OtSample.tagKey). */
  tag: varchar("tag", { length: 128 }).notNull(),
  /**
   * Target UNS topic — an ISA-95 path. May be a literal path
   * (e.g. "AVI-AOI/Factory1/Line3/Press/temperature") or a template with
   * {enterprise} {adapterCode} {tag} {rename} {machineId} placeholders.
   */
  unsTopic: varchar("unsTopic", { length: 500 }).notNull(),
  /** Sparkplug-B metric name (nullable → falls back to rename, then tag). */
  sparkplugMetric: varchar("sparkplugMetric", { length: 255 }),
  /** Conditioning applied to the value before publish. */
  transform: jsonb("transform").$type<UnsTagTransform>(),
  enabled: boolean("enabled").default(true).notNull(),
  notes: text("notes"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  unique("uq_uns_tag_mappings_adapter_tag").on(table.adapterId, table.tag),
  index("idx_uns_tag_mappings_adapter").on(table.adapterId),
  index("idx_uns_tag_mappings_enabled").on(table.enabled),
]);

export type UnsTagMapping = typeof unsTagMappings.$inferSelect;
export type InsertUnsTagMapping = typeof unsTagMappings.$inferInsert;
