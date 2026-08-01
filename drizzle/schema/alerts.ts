// Schema domain: Alert tables
import { pgTable, serial, integer, varchar, decimal, boolean, timestamp, text, index } from "drizzle-orm/pg-core";
import { alertTypeEnum, comparisonOperatorEnum, metricTypeEnum, comparisonOperatorEnum_1 } from "./enums";

export const alertSettings = pgTable("alert_settings", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // Người tạo cảnh báo
  name: varchar("name", { length: 255 }).notNull(),
  alertType: alertTypeEnum("alertType").notNull(),
  threshold: decimal("threshold", { precision: 10, scale: 2 }).notNull(), // Ngưỡng cảnh báo
  comparisonOperator: comparisonOperatorEnum("comparisonOperator").default("lt").notNull(),
  machineId: integer("machineId"), // Null = tất cả máy
  factoryId: integer("factoryId"), // Null = tất cả nhà máy
  isActive: boolean("isActive").default(true).notNull(),
  notifyEmail: boolean("notifyEmail").default(true).notNull(),
  notifySms: boolean("notifySms").default(false).notNull(),
  notifyInApp: boolean("notifyInApp").default(true).notNull(),
  cooldownMinutes: integer("cooldownMinutes").default(60).notNull(), // Thời gian chờ giữa các cảnh báo
  lastTriggeredAt: timestamp("lastTriggeredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_alert_user").on(table.userId),
  index("idx_alert_active").on(table.isActive),
  index("idx_alert_type").on(table.alertType),
]);

export type AlertSetting = typeof alertSettings.$inferSelect;
export type InsertAlertSetting = typeof alertSettings.$inferInsert;

/**
 * Alert History - Lịch sử cảnh báo đã gửi
 */
export const alertHistory = pgTable("alert_history", {
  id: serial("id").primaryKey(),
  alertSettingId: integer("alertSettingId").notNull(),
  triggeredValue: decimal("triggeredValue", { precision: 10, scale: 2 }).notNull(),
  message: text("message").notNull(),
  sentEmail: boolean("sentEmail").default(false).notNull(),
  sentSms: boolean("sentSms").default(false).notNull(),
  sentInApp: boolean("sentInApp").default(false).notNull(),
  acknowledgedAt: timestamp("acknowledgedAt"),
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedByName: varchar("acknowledgedByName", { length: 255 }), // 0186: human-readable identity (mobile / master-key auth)
  ackComment: text("ackComment"), // 0186: lý do/ghi chú khi acknowledge (MB6)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_alert_history_setting").on(table.alertSettingId),
  index("idx_alert_history_created").on(table.createdAt),
]);

export type AlertHistory = typeof alertHistory.$inferSelect;
export type InsertAlertHistory = typeof alertHistory.$inferInsert;

export const yieldAlertThresholds = pgTable("yield_alert_thresholds", {
  id: serial("id").primaryKey(),
  metricType: metricTypeEnum("metricType").notNull(),
  warningThreshold: decimal("warningThreshold", { precision: 10, scale: 4 }).notNull(), // Ngưỡng cảnh báo
  criticalThreshold: decimal("criticalThreshold", { precision: 10, scale: 4 }).notNull(), // Ngưỡng nghiêm trọng
  targetValue: decimal("targetValue", { precision: 10, scale: 4 }), // Giá trị mục tiêu
  comparisonOperator: comparisonOperatorEnum_1("comparisonOperator").default("gte").notNull(), // Toán tử so sánh
  isEnabled: boolean("isEnabled").default(true).notNull(),
  notifyOnWarning: boolean("notifyOnWarning").default(true).notNull(),
  notifyOnCritical: boolean("notifyOnCritical").default(true).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_yield_thresholds_type").on(table.metricType),
  index("idx_yield_thresholds_enabled").on(table.isEnabled),
]);

export type YieldAlertThreshold = typeof yieldAlertThresholds.$inferSelect;
export type InsertYieldAlertThreshold = typeof yieldAlertThresholds.$inferInsert;


/**
 * Yield Threshold History - Lịch sử thay đổi ngưỡng cảnh báo
 */
export const yieldThresholdHistory = pgTable("yield_threshold_history", {
  id: serial("id").primaryKey(),
  thresholdId: integer("thresholdId").notNull(), // Reference to yieldAlertThresholds
  metricType: metricTypeEnum("metricType").notNull(),
  previousWarning: decimal("previousWarning", { precision: 10, scale: 4 }),
  newWarning: decimal("newWarning", { precision: 10, scale: 4 }).notNull(),
  previousCritical: decimal("previousCritical", { precision: 10, scale: 4 }),
  newCritical: decimal("newCritical", { precision: 10, scale: 4 }).notNull(),
  previousTarget: decimal("previousTarget", { precision: 10, scale: 4 }),
  newTarget: decimal("newTarget", { precision: 10, scale: 4 }),
  changeReason: text("changeReason"),
  changedBy: integer("changedBy"), // User ID who made the change
  changedByName: varchar("changedByName", { length: 255 }),
  // Performance metrics at time of change
  actualValueAtChange: decimal("actualValueAtChange", { precision: 10, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_threshold_history_threshold").on(table.thresholdId),
  index("idx_threshold_history_type").on(table.metricType),
  index("idx_threshold_history_date").on(table.createdAt),
]);

export type YieldThresholdHistory = typeof yieldThresholdHistory.$inferSelect;
export type InsertYieldThresholdHistory = typeof yieldThresholdHistory.$inferInsert;
