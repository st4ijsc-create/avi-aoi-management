// Schema domain: OT Connectivity Framework (Sprint F1.1)
//
// Industrial (OT) device connectivity tables, sitting in PARALLEL to the existing
// machine/MQTT/OPC-UA scaffold (backward-compatible, no regression to AOI/MQTT).
//   - deviceAdapters: one configured connection to a PLC/SCADA/device (protocol + endpoint)
//   - deviceTags:     individual addressable points read from an adapter
//   - otTelemetry:    time-series samples ingested from tags
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, json, jsonb, index, unique, primaryKey } from "drizzle-orm/pg-core"; // `unique` used by deviceTags composite key; `primaryKey` for hypertable composite PK
import { otProtocolEnum, otDataTypeEnum, otAdapterStatusEnum, machineTypeEnum, recipeStatusEnum, deploymentStatusEnum, commandStatusEnum, commandTriggerKindEnum } from "./enums";

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
 * OT Telemetry — chuỗi thời gian các giá trị tag đã ingest.
 * Số → valueNumeric; bool/string/json → valueText (xem ingest.mapSampleToRow).
 */
export const otTelemetry = pgTable("ot_telemetry", {
  // Composite PK (id, timestamp) — required for the TimescaleDB hypertable
  // (see drizzle/0118_timescale_hypertables.sql). `id` keeps its serial default.
  id: serial("id"),
  adapterId: integer("adapterId").notNull(),
  machineId: integer("machineId"),
  tagKey: varchar("tagKey", { length: 128 }).notNull(),
  valueNumeric: decimal("valueNumeric", { precision: 18, scale: 6 }),
  valueText: varchar("valueText", { length: 500 }),
  quality: varchar("quality", { length: 16 }).default("good").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.id, table.timestamp] }),
  index("idx_ot_telemetry_adapter").on(table.adapterId),
  index("idx_ot_telemetry_machine").on(table.machineId),
  index("idx_ot_telemetry_tag_time").on(table.tagKey, table.timestamp),
  index("idx_ot_telemetry_timestamp").on(table.timestamp),
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
  machineId: integer("machineId"),
  machineType: machineTypeEnum("machineType"),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  version: integer("version").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  checksum: varchar("checksum", { length: 128 }),
  status: recipeStatusEnum("status").default("draft").notNull(),
  notes: text("notes"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  unique("uq_machine_recipes_code_version").on(table.code, table.version),
  index("idx_machine_recipes_machine").on(table.machineId),
  index("idx_machine_recipes_type").on(table.machineType),
  index("idx_machine_recipes_status").on(table.status),
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
  recipeId: integer("recipeId").notNull(),
  machineId: integer("machineId").notNull(),
  adapterId: integer("adapterId"),
  deployedBy: integer("deployedBy").notNull(),
  deployedAt: timestamp("deployedAt").defaultNow().notNull(),
  previousRecipeId: integer("previousRecipeId"),
  status: deploymentStatusEnum("status").default("pending").notNull(),
  commandLogId: integer("commandLogId"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_recipe_deployments_recipe").on(table.recipeId),
  index("idx_recipe_deployments_machine").on(table.machineId),
  index("idx_recipe_deployments_deployed").on(table.deployedAt),
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
