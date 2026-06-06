// Schema domain: Giai đoạn 3 — Energy/Sustainability (G14), ML Feature Store (G10/ML-Ops),
// HA/DR verify-restore log (G12). Additive, migration-safe; không thay đổi bảng hiện có.
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { energySourceEnum, complianceViewEnum, drCheckStatusEnum } from "./enums";

// =============================================================
// G14 — Energy monitoring & EnPI (ISO 50001)
// =============================================================

/**
 * Energy Readings - Số đo tiêu thụ năng lượng theo máy/khu vực.
 * Nguồn: meter IoT, OPC-UA gateway, hoặc nhập tay. Hypertable-ready (timestamp).
 */
export const energyReadings = pgTable("energy_readings", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId"),                  // null = đo cấp khu vực/nhà máy
  layoutId: integer("layoutId"),                    // FK -> factory_layouts (khu vực)
  source: energySourceEnum("source").default("electricity").notNull(),
  value: decimal("value", { precision: 14, scale: 4 }).notNull(), // giá trị tức thời
  unit: varchar("unit", { length: 16 }).default("kWh").notNull(),
  powerKw: decimal("powerKw", { precision: 12, scale: 4 }),        // công suất tức thời (kW)
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_energy_machine").on(table.machineId),
  index("idx_energy_source").on(table.source),
  index("idx_energy_ts").on(table.timestamp),
]);

export type EnergyReading = typeof energyReadings.$inferSelect;
export type InsertEnergyReading = typeof energyReadings.$inferInsert;

/**
 * EnPI Metrics - Chỉ số hiệu suất năng lượng (Energy Performance Indicator).
 * energyPerUnit = tổng kWh / số đơn vị tốt; baseline cho theo dõi ISO 50001.
 */
export const enpiMetrics = pgTable("enpi_metrics", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId"),
  layoutId: integer("layoutId"),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  totalKwh: decimal("totalKwh", { precision: 16, scale: 4 }).notNull(),
  goodUnits: integer("goodUnits").default(0).notNull(),
  energyPerUnit: decimal("energyPerUnit", { precision: 16, scale: 6 }),    // kWh/đơn vị
  baselineEnergyPerUnit: decimal("baselineEnergyPerUnit", { precision: 16, scale: 6 }),
  carbonKg: decimal("carbonKg", { precision: 16, scale: 4 }),              // phát thải CO2 quy đổi
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_enpi_machine").on(table.machineId),
  index("idx_enpi_period").on(table.periodStart),
]);

export type EnpiMetric = typeof enpiMetrics.$inferSelect;
export type InsertEnpiMetric = typeof enpiMetrics.$inferInsert;

// =============================================================
// G10 / ML-Ops — Feature store & inference audit
// =============================================================

/**
 * ML Feature Cache - Lưu vector đặc trưng đã tính sẵn cho model serving.
 * featureSet định danh nhóm đặc trưng; features là JSON {name: value}.
 */
export const mlFeatureCache = pgTable("ml_feature_cache", {
  id: serial("id").primaryKey(),
  entityType: varchar("entityType", { length: 64 }).notNull(),   // "machine" | "product" | "lot"...
  entityId: varchar("entityId", { length: 128 }).notNull(),
  featureSet: varchar("featureSet", { length: 128 }).notNull(),  // tên nhóm feature / version
  features: jsonb("features").notNull(),                          // {featureName: value}
  computedAt: timestamp("computedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mlfeat_entity").on(table.entityType, table.entityId),
  index("idx_mlfeat_set").on(table.featureSet),
  index("idx_mlfeat_expires").on(table.expiresAt),
]);

export type MlFeatureCache = typeof mlFeatureCache.$inferSelect;
export type InsertMlFeatureCache = typeof mlFeatureCache.$inferInsert;

/**
 * ML Inference Audit - Nhật ký inference đầy đủ phục vụ truy vết & active-learning.
 */
export const mlInferenceAudit = pgTable("ml_inference_audit", {
  id: serial("id").primaryKey(),
  modelName: varchar("modelName", { length: 128 }).notNull(),
  modelVersion: varchar("modelVersion", { length: 64 }),
  entityType: varchar("entityType", { length: 64 }),
  entityId: varchar("entityId", { length: 128 }),
  input: jsonb("input"),
  output: jsonb("output"),
  confidence: decimal("confidence", { precision: 6, scale: 4 }),
  latencyMs: integer("latencyMs"),
  groundTruth: jsonb("groundTruth"),     // điền sau khi có nhãn thực — đóng vòng active-learning
  flaggedForReview: boolean("flaggedForReview").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mlaudit_model").on(table.modelName),
  index("idx_mlaudit_entity").on(table.entityType, table.entityId),
  index("idx_mlaudit_review").on(table.flaggedForReview),
  index("idx_mlaudit_created").on(table.createdAt),
]);

export type MlInferenceAudit = typeof mlInferenceAudit.$inferSelect;
export type InsertMlInferenceAudit = typeof mlInferenceAudit.$inferInsert;

// =============================================================
// G12 — HA/DR verify-restore log
// =============================================================

/**
 * DR Restore Checks - Nhật ký kiểm tra khôi phục tự động (verify-restore).
 * Theo dõi RPO/RTO: rpoSeconds = độ trễ dữ liệu, rtoSeconds = thời gian khôi phục.
 */
export const drRestoreChecks = pgTable("dr_restore_checks", {
  id: serial("id").primaryKey(),
  checkType: varchar("checkType", { length: 64 }).default("verify_restore").notNull(),
  status: drCheckStatusEnum("status").default("running").notNull(),
  rpoSeconds: integer("rpoSeconds"),       // Recovery Point Objective thực đo
  rtoSeconds: integer("rtoSeconds"),       // Recovery Time Objective thực đo
  backupRef: varchar("backupRef", { length: 256 }), // tham chiếu WAL/snapshot
  details: text("details"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_drcheck_status").on(table.status),
  index("idx_drcheck_started").on(table.startedAt),
]);

export type DrRestoreCheck = typeof drRestoreChecks.$inferSelect;
export type InsertDrRestoreCheck = typeof drRestoreChecks.$inferInsert;
