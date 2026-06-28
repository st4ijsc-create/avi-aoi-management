// Schema domain: Integration tables (webhook, backup, marketplace, export)
import { pgTable, pgEnum, serial, integer, text, timestamp, varchar, decimal, boolean, index, json } from "drizzle-orm/pg-core";
import { actionEnum, statusEnum_4, scheduleEnum_1, storageTypeEnum, lastRunStatusEnum, scheduleEnum, exportFormatEnum, resultFilterEnum, timeRangeTypeEnum, statusEnum_3, statusEnum_7 } from "./enums";

export const backupLogs = pgTable("backup_logs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users
  action: actionEnum("action").notNull(),
  categories: json("categories").$type<string[]>().notNull(), // Categories được backup/restore
  status: statusEnum_4("status").notNull(),
  fileSize: integer("fileSize"), // Kích thước file backup (bytes)
  fileName: varchar("fileName", { length: 255 }), // Tên file backup
  fileUrl: text("fileUrl"), // URL file backup (nếu lưu S3)
  recordCount: integer("recordCount"), // Số records được backup/restore
  errorMessage: text("errorMessage"), // Thông báo lỗi nếu có
  metadata: json("metadata").$type<Record<string, any>>(), // Metadata bổ sung
  ipAddress: varchar("ipAddress", { length: 45 }), // IP address của người thực hiện
  userAgent: text("userAgent"), // User agent
  duration: integer("duration"), // Thời gian thực hiện (ms)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_backup_logs_user").on(table.userId),
  index("idx_backup_logs_action").on(table.action),
  index("idx_backup_logs_status").on(table.status),
  index("idx_backup_logs_created").on(table.createdAt),
]);

export type BackupLog = typeof backupLogs.$inferSelect;
export type InsertBackupLog = typeof backupLogs.$inferInsert;

/**
 * Scheduled Backups - Cấu hình backup tự động
 */
export const scheduledBackups = pgTable("scheduled_backups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  categories: json("categories").$type<string[]>().notNull(), // Categories để backup
  schedule: scheduleEnum_1("schedule").notNull(),
  scheduleTime: varchar("scheduleTime", { length: 5 }).notNull(), // HH:MM format
  scheduleDayOfWeek: integer("scheduleDayOfWeek"), // 0-6 for weekly (0 = Sunday)
  scheduleDayOfMonth: integer("scheduleDayOfMonth"), // 1-31 for monthly
  retentionCount: integer("retentionCount").default(7).notNull(), // Số bản backup giữ lại
  storageType: storageTypeEnum("storageType").default("s3").notNull(),
  isEnabled: boolean("isEnabled").default(true).notNull(),
  lastRunAt: timestamp("lastRunAt"),
  lastRunStatus: lastRunStatusEnum("lastRunStatus"),
  nextRunAt: timestamp("nextRunAt"),
  createdBy: integer("createdBy").notNull(), // FK to users
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_scheduled_backups_enabled").on(table.isEnabled),
  index("idx_scheduled_backups_next_run").on(table.nextRunAt),
]);

export type ScheduledBackup = typeof scheduledBackups.$inferSelect;
export type InsertScheduledBackup = typeof scheduledBackups.$inferInsert;

/**
 * Template Marketplace - Templates được chia sẻ
 */
export const templateMarketplace = pgTable("template_marketplace", {
  id: serial("id").primaryKey(),
  templateId: integer("templateId").notNull(), // FK to dashboardTemplates
  publisherId: integer("publisherId").notNull(), // FK to users
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }), // production, quality, monitoring, etc.
  tags: json("tags").$type<string[]>(), // Tags cho tìm kiếm
  thumbnailUrl: text("thumbnailUrl"), // Ảnh preview
  previewData: json("previewData").$type<Record<string, any>>(), // Data để preview
  downloadCount: integer("downloadCount").default(0).notNull(),
  rating: decimal("rating", { precision: 2, scale: 1 }).default("0"), // 0-5
  ratingCount: integer("ratingCount").default(0).notNull(),
  isPublished: boolean("isPublished").default(true).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  version: varchar("version", { length: 20 }).default("1.0.0").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_marketplace_publisher").on(table.publisherId),
  index("idx_marketplace_category").on(table.category),
  index("idx_marketplace_published").on(table.isPublished),
  index("idx_marketplace_featured").on(table.isFeatured),
  index("idx_marketplace_rating").on(table.rating),
  index("idx_marketplace_downloads").on(table.downloadCount),
]);

export type TemplateMarketplace = typeof templateMarketplace.$inferSelect;
export type InsertTemplateMarketplace = typeof templateMarketplace.$inferInsert;

/**
 * Template Reviews - Đánh giá templates
 */
export const templateReviews = pgTable("template_reviews", {
  id: serial("id").primaryKey(),
  marketplaceId: integer("marketplaceId").notNull(), // FK to templateMarketplace
  userId: integer("userId").notNull(), // FK to users
  rating: integer("rating").notNull(), // 1-5
  comment: text("comment"),
  isVerified: boolean("isVerified").default(false).notNull(), // Đã download và sử dụng
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_reviews_marketplace").on(table.marketplaceId),
  index("idx_reviews_user").on(table.userId),
  index("idx_reviews_rating").on(table.rating),
]);

export type TemplateReview = typeof templateReviews.$inferSelect;
export type InsertTemplateReview = typeof templateReviews.$inferInsert;

export const historyExportSchedules = pgTable("history_export_schedules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Schedule configuration
  scheduleType: scheduleEnum("scheduleType").default("DAILY").notNull(),
  scheduleTime: varchar("scheduleTime", { length: 10 }).default("08:00").notNull(), // HH:mm format
  scheduleDayOfWeek: integer("scheduleDayOfWeek"), // 0-6 for weekly (0=Sunday)
  scheduleDayOfMonth: integer("scheduleDayOfMonth"), // 1-31 for monthly
  // Export configuration
  exportFormat: exportFormatEnum("exportFormat").default("CSV").notNull(),
  // Filters
  factoryId: integer("factoryId"),
  workshopId: integer("workshopId"),
  lineId: integer("lineId"),
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  resultFilter: resultFilterEnum("resultFilter").default("ALL").notNull(),
  // Time range for export
  timeRangeType: timeRangeTypeEnum("timeRangeType").default("LAST_24H").notNull(),
  customDays: integer("customDays"), // For custom time range
  // Email recipients
  recipients: json("recipients").$type<string[]>().notNull(),
  // Include options
  includeImages: boolean("includeImages").default(false).notNull(),
  includeAnnotations: boolean("includeAnnotations").default(true).notNull(),
  includeMeasurements: boolean("includeMeasurements").default(true).notNull(),
  includeSummaryStats: boolean("includeSummaryStats").default(true).notNull(),
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  lastRunAt: timestamp("lastRunAt"),
  lastRunStatus: statusEnum_3("lastRunStatus").default("PENDING"),
  lastRunError: text("lastRunError"),
  nextRunAt: timestamp("nextRunAt"),
  // Metadata
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_export_schedule_type").on(table.scheduleType),
  index("idx_export_schedule_active").on(table.isActive),
  index("idx_export_schedule_next").on(table.nextRunAt),
  index("idx_export_schedule_creator").on(table.createdBy),
]);

export type HistoryExportSchedule = typeof historyExportSchedules.$inferSelect;
export type InsertHistoryExportSchedule = typeof historyExportSchedules.$inferInsert;

/**
 * History Export Logs - Lịch sử chạy export
 */
export const historyExportLogs = pgTable("history_export_logs", {
  id: serial("id").primaryKey(),
  scheduleId: integer("scheduleId").notNull(), // FK to historyExportSchedules
  status: statusEnum_7("status").default("PENDING").notNull(),
  // Export details
  recordCount: integer("recordCount").default(0).notNull(),
  fileSize: integer("fileSize").default(0).notNull(), // Bytes
  fileUrl: text("fileUrl"), // URL to exported file
  // Email delivery
  recipientCount: integer("recipientCount").default(0).notNull(),
  deliveredCount: integer("deliveredCount").default(0).notNull(),
  failedCount: integer("failedCount").default(0).notNull(),
  // Error handling
  errorMessage: text("errorMessage"),
  // Timing
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  processingTimeMs: integer("processingTimeMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_export_log_schedule").on(table.scheduleId),
  index("idx_export_log_status").on(table.status),
  index("idx_export_log_started").on(table.startedAt),
]);

export type HistoryExportLog = typeof historyExportLogs.$inferSelect;
export type InsertHistoryExportLog = typeof historyExportLogs.$inferInsert;

export const webhookEventTypeEnum = pgEnum("webhook_event_type", [
  "inspection.created",
  "inspection.updated",
  "alert.triggered",
  "machine.status_changed",
  "machine.offline",
  "production_order.created",
  "production_order.completed",
  "yield.threshold_exceeded",
  "backup.completed",
  "system.error"
]);

/**
 * Webhook Configs - Cấu hình webhook gửi event đến hệ thống bên ngoài
 */
export const webhookConfigs = pgTable("webhook_configs", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  url: text("url").notNull(), // Endpoint URL
  secret: varchar("secret", { length: 255 }), // HMAC secret for signature
  events: json("events").$type<string[]>().notNull(), // Subscribed events
  headers: json("headers").$type<Record<string, string>>(), // Custom headers
  isEnabled: boolean("isEnabled").default(true).notNull(),
  retryCount: integer("retryCount").default(3).notNull(), // Max retries
  retryDelayMs: integer("retryDelayMs").default(5000).notNull(), // Delay between retries
  timeoutMs: integer("timeoutMs").default(10000).notNull(), // Request timeout
  createdBy: integer("createdBy").notNull(), // FK to users
  lastTriggeredAt: timestamp("lastTriggeredAt"),
  successCount: integer("successCount").default(0).notNull(),
  failureCount: integer("failureCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_webhook_configs_enabled").on(table.isEnabled),
  index("idx_webhook_configs_created_by").on(table.createdBy),
]);

export type WebhookConfig = typeof webhookConfigs.$inferSelect;
export type InsertWebhookConfig = typeof webhookConfigs.$inferInsert;

/**
 * Webhook Delivery Logs - Lịch sử gửi webhook
 */
export const webhookDeliveryLogs = pgTable("webhook_delivery_logs", {
  id: serial("id").primaryKey(),
  webhookId: integer("webhookId").notNull(), // FK to webhookConfigs
  eventType: varchar("eventType", { length: 100 }).notNull(),
  payload: json("payload").notNull(), // Event payload sent
  responseStatus: integer("responseStatus"), // HTTP response status
  responseBody: text("responseBody"), // Response body (truncated)
  responseTimeMs: integer("responseTimeMs"), // Response time in ms
  success: boolean("success").default(false).notNull(),
  errorMessage: text("errorMessage"),
  attempt: integer("attempt").default(1).notNull(), // Retry attempt number
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_webhook_delivery_webhook").on(table.webhookId),
  index("idx_webhook_delivery_event").on(table.eventType),
  index("idx_webhook_delivery_success").on(table.success),
  index("idx_webhook_delivery_created").on(table.createdAt),
])

export type WebhookDeliveryLog = typeof webhookDeliveryLogs.$inferSelect;
export type InsertWebhookDeliveryLog = typeof webhookDeliveryLogs.$inferInsert;

/**
 * Phase E1 — Factory Control Plane: SCOPED API KEYS for the Unified Machine API
 * (/api/v1). A per-client credential authenticated via `Authorization: Bearer
 * <key>` (or `X-API-Key`), carrying a set of SCOPES (e.g. equipment:read,
 * equipment:command, ingest:write, orchestration:*) that each endpoint declares.
 *
 * Only a SHA-256 hash of the key is stored (never the plaintext). The MASTER_API_KEY
 * remains a super-key (all scopes) handled in the auth middleware — this table is for
 * additional, least-privilege external clients.
 */
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // SHA-256 hex of the secret. The plaintext is shown ONCE at creation, never stored.
  keyHash: varchar("keyHash", { length: 128 }).notNull(),
  // A short, non-secret prefix (e.g. "ak_3f9c") for display/identification.
  keyPrefix: varchar("keyPrefix", { length: 32 }),
  // Granted scopes (e.g. ["equipment:read","ingest:write"]). "*" = all scopes.
  scopes: json("scopes").$type<string[]>().notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  expiresAt: timestamp("expiresAt"),
  lastUsedAt: timestamp("lastUsedAt"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_api_keys_hash").on(table.keyHash),
  index("idx_api_keys_active").on(table.isActive),
]);

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;
