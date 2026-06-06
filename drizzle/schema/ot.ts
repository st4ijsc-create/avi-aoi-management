// Schema domain: OT Connectivity Framework (Sprint F1.1)
//
// Industrial (OT) device connectivity tables, sitting in PARALLEL to the existing
// machine/MQTT/OPC-UA scaffold (backward-compatible, no regression to AOI/MQTT).
//   - deviceAdapters: one configured connection to a PLC/SCADA/device (protocol + endpoint)
//   - deviceTags:     individual addressable points read from an adapter
//   - otTelemetry:    time-series samples ingested from tags
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, json, index, unique } from "drizzle-orm/pg-core"; // `unique` used by deviceTags composite key
import { otProtocolEnum, otDataTypeEnum, otAdapterStatusEnum } from "./enums";

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
  id: serial("id").primaryKey(),
  adapterId: integer("adapterId").notNull(),
  machineId: integer("machineId"),
  tagKey: varchar("tagKey", { length: 128 }).notNull(),
  valueNumeric: decimal("valueNumeric", { precision: 18, scale: 6 }),
  valueText: varchar("valueText", { length: 500 }),
  quality: varchar("quality", { length: 16 }).default("good").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ot_telemetry_adapter").on(table.adapterId),
  index("idx_ot_telemetry_machine").on(table.machineId),
  index("idx_ot_telemetry_tag_time").on(table.tagKey, table.timestamp),
  index("idx_ot_telemetry_timestamp").on(table.timestamp),
]);

export type OtTelemetry = typeof otTelemetry.$inferSelect;
export type InsertOtTelemetry = typeof otTelemetry.$inferInsert;
