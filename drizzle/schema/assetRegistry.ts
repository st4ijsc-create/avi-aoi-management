// Schema domain: Asset Registry — config-drift control (doc 44 W2-A2, gap G1.11).
//
// ════════════════════════════════════════════════════════════════════════════
// SYNAPSE Tầng-1 spec §6.4 "Kiểm soát trôi cấu hình": so khớp cấu hình ĐANG CHẠY
// của một entity kết nối (device_adapter + tập device_tags của nó) với bản ĐÃ
// DUYỆT; cảnh báo khi lệch. One row per (entity_type, entity_id):
//   • config_hash        — sha256 của cấu hình hiện tại (secret ĐÃ loại trước
//                          khi băm — xem configDriftService.redactSecrets).
//   • approved_hash      — hash tại thời điểm duyệt (NULL = chưa duyệt lần nào).
//   • status             — 'unapproved' | 'in_sync' | 'drift' (text, app-validated
//                          — repo convention, no pg enum).
//   • payload_summary    — tóm tắt KHÔNG-secret (tên adapter, protocol, đếm tag)
//                          để UI/API hiển thị mà không lộ connection credentials.
// Maintained by server/services/assetRegistry/configDriftService (sweep gated by
// CONFIG_DRIFT_ENABLED, default OFF). Migration: drizzle/0252_config_drift.sql.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/** App-validated entity kinds a config snapshot can cover. */
export const CONFIG_SNAPSHOT_ENTITY_TYPES = ["adapter", "machine_tags"] as const;
export type ConfigSnapshotEntityType = (typeof CONFIG_SNAPSHOT_ENTITY_TYPES)[number];

/** App-validated drift statuses. */
export const CONFIG_SNAPSHOT_STATUSES = ["unapproved", "in_sync", "drift"] as const;
export type ConfigSnapshotStatus = (typeof CONFIG_SNAPSHOT_STATUSES)[number];

export const configSnapshots = pgTable("config_snapshots", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").$type<ConfigSnapshotEntityType>().notNull(),
  entityId: integer("entity_id").notNull(),
  /** sha256 hex of the CURRENT (secret-redacted, stable-stringified) config. */
  configHash: text("config_hash").notNull(),
  /** Hash captured by approveCurrentConfig; NULL until first approval. */
  approvedHash: text("approved_hash"),
  /** users.id of the approver (NULL for API-key principals — name goes in payload_summary). */
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  /** First moment the CURRENT drift episode was detected (cleared on approve/in_sync). */
  driftDetectedAt: timestamp("drift_detected_at"),
  status: text("status").$type<ConfigSnapshotStatus>().default("unapproved").notNull(),
  /** Non-secret summary: { adapterCode, adapterName, protocol, tagCount, ... }. NEVER credentials. */
  payloadSummary: jsonb("payload_summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_config_snapshots_entity").on(table.entityType, table.entityId),
  index("idx_config_snapshots_status").on(table.status),
]);

export type ConfigSnapshot = typeof configSnapshots.$inferSelect;
export type InsertConfigSnapshot = typeof configSnapshots.$inferInsert;
