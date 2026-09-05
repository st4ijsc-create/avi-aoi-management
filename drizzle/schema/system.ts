// Schema domain: System tables
import { pgTable, serial, integer, text, timestamp, varchar, boolean, json, jsonb, index } from "drizzle-orm/pg-core";
import { statusEnum_2, reportTypeEnum, scheduleEnum, reportFormatEnum, statusEnum_3, dataTypeEnum, typeEnum, priorityEnum, templateTypeEnum_1 } from "./enums";
import { users } from "./auth";

// 0349 (Lô 10 Mục 1, BG-93) — DB THẬT có PK ghép PRIMARY KEY (id, "createdAt")
// sau khi trở thành hypertable (create_hypertable đòi cột partition trong PK,
// xem drizzle/0349_audit_logs_hypertable_retention.sql). `id: serial().primaryKey()`
// dưới đây CỐ Ý giữ nguyên đơn cột — cùng quy ước 5 hypertable khác của repo này
// (drizzle/0172_inspection_hypertables.sql rewrite PK ở DB nhưng KHÔNG mirror
// composite PK vào drizzle/schema/*.ts, xem productInspections/measurementResults
// ở inspection.ts): schema file này chỉ phục vụ typing + drizzle-kit generate,
// không phải nguồn sự thật của các hypertable PK — nguồn sự thật là migration SQL.
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("userId"), // Null for system actions or failed logins
  userName: varchar("userName", { length: 255 }), // Store name at time of action
  action: varchar("action", { length: 100 }).notNull(), // login, logout, create, update, delete, etc.
  entityType: varchar("entityType", { length: 100 }), // user, machine, product, inspection, etc.
  entityId: integer("entityId"), // ID of affected entity
  entityName: varchar("entityName", { length: 255 }), // Name of affected entity for display
  details: text("details"), // JSON string with additional details
  ipAddress: varchar("ipAddress", { length: 45 }), // IPv4 or IPv6
  userAgent: varchar("userAgent", { length: 500 }),
  status: statusEnum_2("status").default("success").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_logs_user").on(table.userId),
  index("idx_audit_logs_action").on(table.action),
  index("idx_audit_logs_entity").on(table.entityType, table.entityId),
  index("idx_audit_logs_created").on(table.createdAt),
]);
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * System Settings - Cài đặt hệ thống
 */
export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  settingKey: varchar("settingKey", { length: 100 }).notNull().unique(),
  settingValue: text("settingValue"),
  description: text("description"),
  category: varchar("category", { length: 50 }), // security, general, notification
  updatedBy: integer("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_system_settings_key").on(table.settingKey),
  index("idx_system_settings_category").on(table.category),
]);
export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;

export const scheduledReports = pgTable("scheduled_reports", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  reportType: reportTypeEnum("reportType").default("NG_VISUAL").notNull(),
  schedule: scheduleEnum("schedule").default("DAILY").notNull(),
  scheduleTime: varchar("scheduleTime", { length: 10 }).default("08:00").notNull(), // HH:mm format
  scheduleDayOfWeek: integer("scheduleDayOfWeek"), // 0-6 for weekly (0=Sunday)
  scheduleDayOfMonth: integer("scheduleDayOfMonth"), // 1-31 for monthly
  recipients: json("recipients").$type<string[]>().notNull(), // Array of email addresses
  factoryId: integer("factoryId"), // Optional filter by factory
  workshopId: integer("workshopId"), // Optional filter by workshop
  lineId: integer("lineId"), // Optional filter by line
  includeWorkstationHeatmap: boolean("includeWorkstationHeatmap").default(true).notNull(),
  includeTopNGPoints: boolean("includeTopNGPoints").default(true).notNull(),
  includeTrendChart: boolean("includeTrendChart").default(true).notNull(),
  includeComparison: boolean("includeComparison").default(true).notNull(),
  // Report Customization
  reportFormat: reportFormatEnum("reportFormat").default("HTML").notNull(),
  logoUrl: varchar("logoUrl", { length: 500 }), // Custom logo URL
  primaryColor: varchar("primaryColor", { length: 20 }).default("#3b82f6"), // Primary color for email
  footerText: text("footerText"), // Custom footer text
  isActive: boolean("isActive").default(true).notNull(),
  // W5-D (doc 27 A11) — optional pluggable delivery-channel config. NULL =
  // legacy semantics (direct e-mail to `recipients`, exactly the pre-0185
  // behaviour). See DeliveryChannelsConfig in services/reportDeliveryService.
  deliveryChannels: jsonb("deliveryChannels").$type<{
    email?: { enabled: boolean };
    webhook?: { enabled: boolean; url: string; secret?: string };
    inApp?: { enabled: boolean; userIds?: number[] };
  } | null>(),
  lastSentAt: timestamp("lastSentAt"),
  nextScheduledAt: timestamp("nextScheduledAt"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_scheduled_reports_type").on(table.reportType),
  index("idx_scheduled_reports_schedule").on(table.schedule),
  index("idx_scheduled_reports_active").on(table.isActive),
  index("idx_scheduled_reports_next").on(table.nextScheduledAt),
  index("idx_scheduled_reports_factory").on(table.factoryId),
]);

export type ScheduledReport = typeof scheduledReports.$inferSelect;
export type InsertScheduledReport = typeof scheduledReports.$inferInsert;

/**
 * Scheduled Report Logs - Lịch sử gửi báo cáo
 */
export const scheduledReportLogs = pgTable("scheduled_report_logs", {
  id: serial("id").primaryKey(),
  reportId: integer("reportId").notNull(),
  status: statusEnum_3("status").default("PENDING").notNull(),
  recipientCount: integer("recipientCount").default(0).notNull(),
  successCount: integer("successCount").default(0).notNull(),
  failedCount: integer("failedCount").default(0).notNull(),
  errorMessage: text("errorMessage"),
  reportData: json("reportData"), // Snapshot of report data at time of sending
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_report_logs_report").on(table.reportId),
  index("idx_report_logs_status").on(table.status),
  index("idx_report_logs_sent").on(table.sentAt),
]);

export type ScheduledReportLog = typeof scheduledReportLogs.$inferSelect;
export type InsertScheduledReportLog = typeof scheduledReportLogs.$inferInsert;

/**
 * Report Deliveries (W5-D, doc 27 §6 A11) — per-channel delivery ledger for
 * scheduled reports. One row per (report run × channel); the delivery worker
 * drains queued/failed rows with exponential backoff and dead-letters rows
 * that exhaust the attempt budget. Migration 0185.
 */
export const reportDeliveries = pgTable("report_deliveries", {
  id: serial("id").primaryKey(),
  scheduledReportId: integer("scheduledReportId").notNull(),
  /** 'email' | 'webhook' | 'in_app' */
  channel: varchar("channel", { length: 20 }).notNull(),
  /** email: comma-joined recipients · webhook: URL · in_app: user id list */
  target: text("target").notNull(),
  /** 'queued' | 'sent' | 'failed' | 'dead' */
  status: varchar("status", { length: 10 }).default("queued").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("lastError"),
  /** Subject / reportType / attachment name+size snapshot for the history UI. */
  payloadMeta: jsonb("payloadMeta").$type<Record<string, unknown> | null>(),
  nextAttemptAt: timestamp("nextAttemptAt").defaultNow().notNull(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_report_deliveries_report").on(table.scheduledReportId, table.createdAt),
  index("idx_report_deliveries_due").on(table.status, table.nextAttemptAt),
]);

export type ReportDelivery = typeof reportDeliveries.$inferSelect;
export type InsertReportDelivery = typeof reportDeliveries.$inferInsert;

// SMTP Configuration Table
export const smtpConfig = pgTable("smtp_config", {
  id: integer("id").primaryKey(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(587),
  secure: boolean("secure").notNull().default(false), // true for 465, false for other ports
  username: varchar("username", { length: 255 }).notNull(),
  password: text("password").notNull(), // Encrypted
  fromEmail: varchar("from_email", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }).notNull().default("AVI/AOI Management System"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SmtpConfig = typeof smtpConfig.$inferSelect;
export type InsertSmtpConfig = typeof smtpConfig.$inferInsert;

export const systemConfig = pgTable("system_config", {
  id: serial("id").primaryKey(),
  configKey: varchar("configKey", { length: 100 }).notNull().unique(), // Unique key
  configValue: text("configValue").notNull(), // JSON or string value
  description: text("description"), // Mô tả cấu hình
  dataType: dataTypeEnum("dataType").default("STRING").notNull(),
  isEditable: boolean("isEditable").default(true).notNull(), // Có thể chỉnh sửa qua UI không
  requiresRestart: boolean("requiresRestart").default(false).notNull(), // Cần restart server sau khi thay đổi
  updatedBy: integer("updatedBy"), // FK to users
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_system_config_key").on(table.configKey),
]);

export type SystemConfig = typeof systemConfig.$inferSelect;
export type InsertSystemConfig = typeof systemConfig.$inferInsert;

export const emailTemplateConfig = pgTable("email_template_config", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().default("default"),
  // Branding
  logoUrl: text("logoUrl"), // URL logo công ty
  companyName: varchar("companyName", { length: 255 }), // Tên công ty hiển thị
  // Colors
  primaryColor: varchar("primaryColor", { length: 20 }).default("#2563eb"), // Màu chính (hex)
  secondaryColor: varchar("secondaryColor", { length: 20 }).default("#64748b"), // Màu phụ
  accentColor: varchar("accentColor", { length: 20 }).default("#10b981"), // Màu nhấn (success)
  warningColor: varchar("warningColor", { length: 20 }).default("#f59e0b"), // Màu cảnh báo
  dangerColor: varchar("dangerColor", { length: 20 }).default("#ef4444"), // Màu nguy hiểm
  backgroundColor: varchar("backgroundColor", { length: 20 }).default("#f8fafc"), // Màu nền
  // Typography
  fontFamily: varchar("fontFamily", { length: 100 }).default("Arial, sans-serif"),
  // Footer
  footerText: text("footerText"), // Nội dung footer tùy chỉnh
  footerLinks: text("footerLinks"), // JSON array of {label, url}
  // Contact info
  contactEmail: varchar("contactEmail", { length: 255 }),
  contactPhone: varchar("contactPhone", { length: 50 }),
  contactAddress: text("contactAddress"),
  // Social links
  socialLinks: text("socialLinks"), // JSON object {facebook, linkedin, website}
  // Active status
  isDefault: boolean("isDefault").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  createdBy: integer("createdBy"), // FK to users
}, (table) => [
  index("idx_email_template_name").on(table.name),
  index("idx_email_template_default").on(table.isDefault),
]);

export type EmailTemplateConfig = typeof emailTemplateConfig.$inferSelect;
export type InsertEmailTemplateConfig = typeof emailTemplateConfig.$inferInsert;


// ============= Notifications System =============

/**
 * Notifications - Thông báo hệ thống cho user
 */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users (recipient)
  type: typeEnum("type").default("INFO").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  // Link to related entity
  entityType: varchar("entityType", { length: 50 }), // 'inspection', 'report', 'alert', etc.
  entityId: integer("entityId"), // ID of related entity
  actionUrl: varchar("actionUrl", { length: 500 }), // URL to navigate when clicked
  // Status
  isRead: boolean("isRead").default(false).notNull(),
  readAt: timestamp("readAt"),
  // Priority
  priority: priorityEnum("priority").default("NORMAL").notNull(),
  // Expiration
  expiresAt: timestamp("expiresAt"), // Optional expiration time
  // Metadata
  metadata: json("metadata").$type<Record<string, any>>(), // Additional data
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_notifications_user").on(table.userId),
  index("idx_notifications_type").on(table.type),
  index("idx_notifications_read").on(table.isRead),
  index("idx_notifications_priority").on(table.priority),
  index("idx_notifications_created").on(table.createdAt),
  index("idx_notifications_user_unread").on(table.userId, table.isRead),
]);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * User Notification Preferences - Cài đặt thông báo của user
 */
export const userNotificationPreferences = pgTable("user_notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(), // FK to users
  // Email notifications
  emailEnabled: boolean("emailEnabled").default(true).notNull(),
  emailAlerts: boolean("emailAlerts").default(true).notNull(),
  emailReports: boolean("emailReports").default(true).notNull(),
  emailSystem: boolean("emailSystem").default(true).notNull(),
  // Push notifications
  pushEnabled: boolean("pushEnabled").default(true).notNull(),
  pushAlerts: boolean("pushAlerts").default(true).notNull(),
  pushReports: boolean("pushReports").default(true).notNull(),
  pushSystem: boolean("pushSystem").default(true).notNull(),
  // In-app notifications
  inAppEnabled: boolean("inAppEnabled").default(true).notNull(),
  inAppAlerts: boolean("inAppAlerts").default(true).notNull(),
  inAppReports: boolean("inAppReports").default(true).notNull(),
  inAppSystem: boolean("inAppSystem").default(true).notNull(),
  // Sound
  soundEnabled: boolean("soundEnabled").default(true).notNull(),
  // Quiet hours
  quietHoursEnabled: boolean("quietHoursEnabled").default(false).notNull(),
  quietHoursStart: varchar("quietHoursStart", { length: 10 }).default("22:00"), // HH:mm
  quietHoursEnd: varchar("quietHoursEnd", { length: 10 }).default("07:00"), // HH:mm
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_notif_prefs_user").on(table.userId),
]);

export type UserNotificationPreference = typeof userNotificationPreferences.$inferSelect;
export type InsertUserNotificationPreference = typeof userNotificationPreferences.$inferInsert;

export const reportTemplates = pgTable("report_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(), // DAILY_QUALITY, WEEKLY_SUMMARY, MONTHLY_PERFORMANCE
  description: text("description"),
  templateType: templateTypeEnum_1("templateType").notNull(),
  // Content configuration
  sections: json("sections").$type<{
    includeYieldStats: boolean;
    includeNGAnalysis: boolean;
    includeMachineComparison: boolean;
    includeOEEMetrics: boolean;
    includeDowntimeAnalysis: boolean;
    includeTrendCharts: boolean;
    includeTopNGPoints: boolean;
    customSections?: string[];
  }>().notNull(),
  // Email configuration
  emailSubjectTemplate: varchar("emailSubjectTemplate", { length: 255 }),
  emailBodyTemplate: text("emailBodyTemplate"),
  // Schedule defaults
  defaultSchedule: varchar("defaultSchedule", { length: 50 }), // e.g., "0 8 * * *" for daily at 8am
  // Metadata
  isSystem: boolean("isSystem").default(false).notNull(), // System templates cannot be deleted
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: integer("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_report_templates_code").on(table.code),
  index("idx_report_templates_type").on(table.templateType),
  index("idx_report_templates_active").on(table.isActive),
]);

export type ReportTemplate = typeof reportTemplates.$inferSelect;
export type InsertReportTemplate = typeof reportTemplates.$inferInsert;
