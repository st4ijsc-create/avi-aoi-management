// Schema domain: Inspection tables
import { pgTable, pgEnum, serial, integer, text, timestamp, varchar, decimal, boolean, bigint, index, json } from "drizzle-orm/pg-core";
import { overallResultEnum, originalResultEnum } from "./enums";

export const productInspections = pgTable("product_inspections", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  productModelId: integer("productModelId"), // Liên kết với Product Model
  corporateCode: varchar("corporateCode", { length: 50 }), // Mã tập đoàn
  factoryCode: varchar("factoryCode", { length: 50 }), // Mã nhà máy
  serialNumber: varchar("serialNumber", { length: 100 }).notNull(),
  productModel: varchar("productModel", { length: 100 }), // Backward compatibility
  batchNumber: varchar("batchNumber", { length: 100 }),
  overallResult: overallResultEnum("overallResult").notNull(),
  originalResult: originalResultEnum("originalResult").notNull(),
  ntfConfirmedBy: integer("ntfConfirmedBy"),
  ntfConfirmedAt: timestamp("ntfConfirmedAt"),
  ntfReason: text("ntfReason"),
  inspectionTime: timestamp("inspectionTime").notNull(),
  cycleTime: decimal("cycleTime", { precision: 10, scale: 2 }),
  // Batch operations fields
  notes: text("notes"),
  tags: text("tags"), // JSON array of tags
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  isArchived: boolean("isArchived").default(false),
  archivedAt: timestamp("archivedAt"),
  archivedBy: integer("archivedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_inspections_machine").on(table.machineId),
  index("idx_inspections_serial").on(table.serialNumber),
  index("idx_inspections_time").on(table.inspectionTime),
  index("idx_inspections_result").on(table.overallResult),
  index("idx_inspections_product_model").on(table.productModelId),
  index("idx_inspections_corporate").on(table.corporateCode),
  index("idx_inspections_factory").on(table.factoryCode),
  // Composite index for common queries
  index("idx_inspections_machine_time").on(table.machineId, table.inspectionTime),
  index("idx_inspections_corporate_factory").on(table.corporateCode, table.factoryCode),
]);

export type ProductInspection = typeof productInspections.$inferSelect;
export type InsertProductInspection = typeof productInspections.$inferInsert;

/**
 * Measurement Result - Kết quả đo thực tế
 */
export const measurementResults = pgTable("measurement_results", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspectionId").notNull(),
  pointDefId: integer("pointDefId").notNull(),
  measuredValue: decimal("measuredValue", { precision: 15, scale: 6 }),
  measuredValueText: varchar("measuredValueText", { length: 255 }), // Giá trị dạng texts
  result: overallResultEnum("result").notNull(),
  imageUrl: text("imageUrl"), // Ảnh thực tế của điểm đo
  imageKey: varchar("imageKey", { length: 255 }),
  remark: text("remark"),
  aiAnalysisResult: text("aiAnalysisResult"), // Kết quả phân tích AI
  aiConfidence: decimal("aiConfidence", { precision: 5, scale: 4 }),
  aiComparisonScore: decimal("aiComparisonScore", { precision: 5, scale: 4 }), // Điểm so sánh với ảnh mẫu
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_results_inspection").on(table.inspectionId),
  index("idx_results_point").on(table.pointDefId),
  index("idx_results_result").on(table.result),
  // Composite indexes for optimized queries
  index("idx_results_inspection_result").on(table.inspectionId, table.result),
  index("idx_results_point_result").on(table.pointDefId, table.result),
]);

export type MeasurementResult = typeof measurementResults.$inferSelect;
export type InsertMeasurementResult = typeof measurementResults.$inferInsert;

// ============================================================
// Inspection Packages - Gói ZIP ảnh AOI
// ============================================================

export const packageStatusEnum = pgEnum("packagestatusenum", [
  "pending",      // Presign URL generated, waiting for upload
  "uploading",    // ZIP upload in progress
  "uploaded",     // ZIP uploaded to storage, not yet committed
  "committed",    // Metadata parsed and linked to inspection
  "failed",       // Upload or processing failed
]);

/**
 * Inspection Packages - Gói ZIP ảnh AOI
 * Mỗi gói chứa ảnh các điểm đo của một lần kiểm tra
 */
export const inspectionPackages = pgTable("inspection_packages", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspectionId"),                    // Linked after commit
  machineId: integer("machineId").notNull(),                // Máy AOI/AVI
  
  // Package identity
  packageId: varchar("packageId", { length: 100 }).notNull().unique(), // UUID or inspectionId from agent
  storageKey: varchar("storageKey", { length: 500 }),       // S3/MinIO object key
  storageUrl: text("storageUrl"),                           // Download URL
  
  // Metadata from meta.json
  serialNumber: varchar("serialNumber", { length: 100 }),
  productModel: varchar("productModel", { length: 100 }),
  factoryCode: varchar("factoryCode", { length: 50 }),
  lineCode: varchar("lineCode", { length: 50 }),
  machineCode: varchar("machineCode", { length: 50 }),
  inspectionTime: timestamp("inspectionTime"),
  overallResult: overallResultEnum("overallResult"),
  totalPoints: integer("totalPoints").default(0),
  okCount: integer("okCount").default(0),
  ngCount: integer("ngCount").default(0),
  
  // File info
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }),
  imageCount: integer("imageCount").default(0),
  
  // Status tracking
  status: packageStatusEnum("status").default("pending").notNull(),
  errorMessage: text("errorMessage"),
  presignExpiresAt: timestamp("presignExpiresAt"),
  uploadedAt: timestamp("uploadedAt"),
  committedAt: timestamp("committedAt"),
  
  // Metadata
  metaJson: json("metaJson"),                               // Full meta.json content
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_pkg_inspection").on(table.inspectionId),
  index("idx_pkg_machine").on(table.machineId),
  index("idx_pkg_package_id").on(table.packageId),
  index("idx_pkg_serial").on(table.serialNumber),
  index("idx_pkg_status").on(table.status),
  index("idx_pkg_inspection_time").on(table.inspectionTime),
  index("idx_pkg_machine_time").on(table.machineId, table.inspectionTime),
]);

export type InspectionPackage = typeof inspectionPackages.$inferSelect;
export type InsertInspectionPackage = typeof inspectionPackages.$inferInsert;

/**
 * Package Images - Thông tin từng ảnh trong gói ZIP
 * Được parse từ meta.json khi commit
 */
export const packageImages = pgTable("package_images", {
  id: serial("id").primaryKey(),
  packageId: integer("packageId").notNull(),               // FK -> inspection_packages.id
  
  // Point info from meta.json
  pointCode: varchar("pointCode", { length: 50 }).notNull(),
  pointName: varchar("pointName", { length: 255 }),
  fileName: varchar("fileName", { length: 255 }).notNull(), // e.g. "MP001.jpg"
  result: overallResultEnum("result"),
  measurementValue: varchar("measurementValue", { length: 100 }),
  
  // Cache info
  cachedUrl: text("cachedUrl"),                             // Extracted & cached URL 
  cachedAt: timestamp("cachedAt"),
  cacheExpiresAt: timestamp("cacheExpiresAt"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_pkgimg_package").on(table.packageId),
  index("idx_pkgimg_point").on(table.pointCode),
]);

export type PackageImage = typeof packageImages.$inferSelect;
export type InsertPackageImage = typeof packageImages.$inferInsert;

/**
 * Upload Queue Metrics - Theo dõi hàng đợi upload từ các máy
 * Agent gửi metrics định kỳ
 */
export const uploadQueueMetrics = pgTable("upload_queue_metrics", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  
  // Queue stats
  queuedCount: integer("queuedCount").default(0).notNull(),
  uploadingCount: integer("uploadingCount").default(0).notNull(),
  failedCount: integer("failedCount").default(0).notNull(),
  completedCount: integer("completedCount").default(0).notNull(),
  
  // Disk stats
  diskUsedBytes: bigint("diskUsedBytes", { mode: "number" }),
  diskFreeBytes: bigint("diskFreeBytes", { mode: "number" }),
  
  // Performance
  avgUploadLatencyMs: integer("avgUploadLatencyMs"),
  lastUploadAt: timestamp("lastUploadAt"),
  lastErrorMessage: text("lastErrorMessage"),
  
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_uqm_machine").on(table.machineId),
  index("idx_uqm_recorded").on(table.recordedAt),
]);

// ============================================================
// Package Activity Logs - Nhật ký hoạt động upload gói tin AOI
// Ghi lại mọi sự kiện: presign, upload, commit, lỗi, xem, tải
// ============================================================
export const packageActivityLogEventEnum = pgEnum("package_activity_log_event", [
  "presign",        // Agent yêu cầu presigned URL
  "upload_start",   // Bắt đầu upload ZIP
  "upload_success", // Upload thành công
  "upload_fail",    // Upload thất bại
  "commit_start",   // Bắt đầu commit (parse ZIP)
  "commit_success", // Commit thành công
  "commit_fail",    // Commit thất bại (parse lỗi, meta.json sai, ...)
  "retry",          // Agent retry upload
  "image_view",     // User xem ảnh trong gói tin
  "zip_download",   // User tải ZIP gốc
  "status_change",  // Thay đổi trạng thái khác
]);

export const packageActivityLogs = pgTable("package_activity_logs", {
  id: serial("id").primaryKey(),
  packageDbId: integer("packageDbId").notNull(),            // FK -> inspection_packages.id
  packageId: varchar("packageId", { length: 100 }).notNull(), // Human-readable package ID
  machineId: integer("machineId"),                          // Máy thực hiện (nếu có)
  
  // Event info
  event: packageActivityLogEventEnum("event").notNull(),
  level: varchar("level", { length: 10 }).notNull().default("info"), // info, warn, error
  message: text("message").notNull(),                       // Mô tả sự kiện
  detail: text("detail"),                                   // Chi tiết lỗi / stack trace / thông tin thêm
  
  // Context
  source: varchar("source", { length: 30 }),                // "agent" | "server" | "user"
  userId: integer("userId"),                                // User nào thao tác (nếu có)
  userName: varchar("userName", { length: 100 }),           // Tên user (cache)
  ipAddress: varchar("ipAddress", { length: 45 }),          // IP máy client
  userAgent: varchar("userAgent", { length: 500 }),         // Browser/Agent user-agent
  
  // Metrics (optional)
  durationMs: integer("durationMs"),                        // Thời gian xử lý (ms)
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }), // Kích thước file liên quan
  
  // Metadata blob
  metadata: json("metadata"),                               // Dữ liệu thêm dạng JSON
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_pal_package").on(table.packageDbId),
  index("idx_pal_package_id").on(table.packageId),
  index("idx_pal_event").on(table.event),
  index("idx_pal_created").on(table.createdAt),
  index("idx_pal_machine").on(table.machineId),
]);

export type PackageActivityLog = typeof packageActivityLogs.$inferSelect;
export type InsertPackageActivityLog = typeof packageActivityLogs.$inferInsert;
