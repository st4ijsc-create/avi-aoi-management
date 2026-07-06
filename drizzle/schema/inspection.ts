// Schema domain: Inspection tables
//
// W3-A (doc 27 §2 M1/M11, migrations 0179/0180): FK declarations below mirror
// what 0180 enforces at the DB. ⚠ CONDITIONAL-ENFORCEMENT CAVEAT: when 0172 has
// converted product_inspections/measurement_results to TimescaleDB hypertables,
// the DB CANNOT hold an FK **to** a hypertable — 0180 then SKIPS
// fk_measurement_results_inspection (recorded in db_feature_status) and the
// weekly integrityScanService orphan scan covers it. The .references() here are
// metadata-only for runtime queries (migrations are hand-written SQL).
import { sql } from "drizzle-orm";
import { pgTable, pgEnum, serial, integer, text, timestamp, varchar, decimal, boolean, bigint, index, json, jsonb, real } from "drizzle-orm/pg-core";
import { overallResultEnum, originalResultEnum, aiDecisionEnum } from "./enums";
import { machines } from "./hierarchy";
import { measurementPointDefs, defectCatalog } from "./product";

export const productInspections = pgTable("product_inspections", {
  id: serial("id").primaryKey(),
  // W3-A (0180): fk_product_inspections_machine, ON DELETE RESTRICT — a machine
  // with inspection history cannot be hard-deleted (deletes are soft anyway).
  // High-volume table: FK adds a cheap per-insert PK lookup on `machines`.
  machineId: integer("machineId").notNull()
    .references(() => machines.id, { onDelete: "restrict" }),
  productModelId: integer("productModelId"), // Liên kết với Product Model
  corporateCode: varchar("corporateCode", { length: 50 }), // Mã tập đoàn
  factoryCode: varchar("factoryCode", { length: 50 }), // Mã nhà máy
  workshopCode: varchar("workshopCode", { length: 50 }), // Mã nhà xưởng
  lineCode: varchar("lineCode", { length: 50 }), // Mã dây chuyền
  stageCode: varchar("stageCode", { length: 50 }), // Mã công đoạn
  productionOrderCode: varchar("productionOrderCode", { length: 100 }), // Mã lệnh sản xuất
  // Mã công nhân vận hành — doc 29 §3.2: re-defined as the BADGE CODE the machine
  // sends (operator_badges.badgeCode). Kept varchar (hypertable — no type rewrite);
  // resolve to users.id via operatorBadgeService / the stamped operatorUserId below.
  operatorId: varchar("operatorId", { length: 50 }),
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
  // AI Quality Gate fields
  aiDecision: aiDecisionEnum("aiDecision"),
  aiConfidence: decimal("aiConfidence", { precision: 5, scale: 4 }),
  aiModelId: integer("aiModelId"),
  aiProcessedAt: timestamp("aiProcessedAt"),
  aiDetails: json("aiDetails").$type<{
    predictions?: Array<{ label: string; confidence: number }>;
    ensembleResults?: Array<{ modelId: number; topLabel: string; confidence: number }>;
    processingTimeMs?: number;
    reviewReason?: string;
    // Doc 27 W7-A (V18) — honest AI-down marker from the INLINE ingest path:
    // 'ai_unavailable' (circuit breaker open) | 'ai_error' (gate threw).
    // Present ⇒ aiDecision=NEEDS_REVIEW was routed WITHOUT an inference verdict
    // (aiConfidence/aiModelId stay NULL).
    skipped?: "ai_unavailable" | "ai_error";
    inline?: boolean;
    source?: string;
  }>(),
  // ============ P4.C G16 — Specialized subforms ============
  // Discriminator (e.g. "FAI" | "IQC" | "OQC" | "AOI" | "FCT" ...). NULLABLE for back-compat.
  inspectionType: varchar("inspectionType", { length: 40 }),
  // Polymorphic payload validated server-side via inspectionVariant.validatePayload.
  variantPayload: jsonb("variantPayload").$type<Record<string, unknown>>(),
  // ============ end G16 ============
  // Doc 27 W2-C/W2-D (gap C4/M8, migration 0178) — SOFT commissioning gate tag.
  // "commissioning" = the machine had no signed commissioning record at ingest
  // time (submission accepted but TAGGED, never rejected). NULL = production.
  ingestMode: varchar("ingestMode", { length: 20 }),
  // Doc 27 W7-A (Đợt 7, migration 0187) — Đợt-3 deferred stamping: the RELEASED
  // inspection_program_releases.id in force for (productModelId, machineId) at
  // ingest time. SOFT ref (product_inspections may be a hypertable — see file
  // header; 0182/0183 convention). NULL = no released program / legacy row.
  // Stamped fail-open by processInspectionSubmission via getActiveRelease.
  programReleaseId: integer("programReleaseId"),
  // Doc 27 W7-B (gap V3, migration 0188) — heuristic false-call likelihood
  // (0..1) from ntfPredictorService (repeat-offender + near-limit margin +
  // machine trend). NULL = not scored. ADVISORY ONLY: pre-sorts the operator
  // verify queue and drives the "Nghi báo giả" badge — never changes a verdict.
  ntfScore: real("ntfScore"),
  // ── Doc 29 §2.3/§3.2 — W8-B (migration 0192, hypertable-safe metadata-only adds) ──
  // Panel multi-up: the machine-reported panel serial/identifier (st4i header
  // panel_id) and 1-based board index inside the panel (product_panel_boards.
  // boardIndex of the product's panel def). NULL = single-board / legacy ingest;
  // analytics must stay null-safe (COALESCE(boardIndex, 1)).
  panelSerial: varchar("panelSerial", { length: 100 }),
  boardIndex: integer("boardIndex"),
  // Operator/badge master: users.id resolved from operatorId (the BADGE CODE the
  // machine sends — see operator_badges) at ingest time. Stamped fail-open by
  // processInspectionSubmission via operatorBadgeService; NULL = badge unknown/
  // unassigned or pre-0192 row (those resolve on read).
  operatorUserId: integer("operatorUserId"),
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
  index("idx_inspections_workshop").on(table.workshopCode),
  index("idx_inspections_line").on(table.lineCode),
  index("idx_inspections_production_order").on(table.productionOrderCode),
  index("idx_inspections_type").on(table.inspectionType),
]);

export type ProductInspection = typeof productInspections.$inferSelect;
export type InsertProductInspection = typeof productInspections.$inferInsert;

/**
 * Measurement Result - Kết quả đo thực tế
 */
export const measurementResults = pgTable("measurement_results", {
  id: serial("id").primaryKey(),
  // W3-A (0180): fk_measurement_results_inspection, ON DELETE CASCADE — results
  // die with their inspection. ⚠ DB enforcement is CONDITIONAL: skipped when the
  // two tables are hypertables (Timescale forbids FKs referencing a hypertable);
  // the weekly orphan scan covers it there. See file header.
  inspectionId: integer("inspectionId").notNull()
    .references(() => productInspections.id, { onDelete: "cascade" }),
  // W3-A (0180): fk_measurement_results_point_def, ON DELETE RESTRICT (column is
  // NOT NULL so SET NULL is impossible; point defs are app-soft-deleted anyway).
  // Legacy hard-deleted defs left orphans → 0180 may leave this NOT VALID until
  // repaired (see integrity_scan_results).
  pointDefId: integer("pointDefId").notNull()
    .references(() => measurementPointDefs.id, { onDelete: "restrict" }),
  measuredValue: decimal("measuredValue", { precision: 15, scale: 6 }),
  measuredValueText: varchar("measuredValueText", { length: 255 }), // Giá trị dạng texts
  result: overallResultEnum("result").notNull(),
  imageUrl: text("imageUrl"), // Ảnh thực tế của điểm đo
  imageKey: varchar("imageKey", { length: 255 }),
  remark: text("remark"),
  aiAnalysisResult: text("aiAnalysisResult"), // Kết quả phân tích AI
  aiConfidence: decimal("aiConfidence", { precision: 5, scale: 4 }),
  aiComparisonScore: decimal("aiComparisonScore", { precision: 5, scale: 4 }), // Điểm so sánh với ảnh mẫu
  // ============ P2 — extended 3D / solder / xray measurement values ============
  // All NULLABLE; populated only when the matching point def opts into 3D inspection.
  valueZ: decimal("valueZ", { precision: 15, scale: 6 }),
  valueHeight: decimal("valueHeight", { precision: 15, scale: 6 }),
  valueArea: decimal("valueArea", { precision: 15, scale: 6 }),
  valueVolume: decimal("valueVolume", { precision: 15, scale: 6 }),
  valueVoidPct: decimal("valueVoidPct", { precision: 15, scale: 6 }),
  valueCoplanarity: decimal("valueCoplanarity", { precision: 15, scale: 6 }),
  valueWarpage: decimal("valueWarpage", { precision: 15, scale: 6 }),
  valueOffsetX: decimal("valueOffsetX", { precision: 15, scale: 6 }),
  valueOffsetY: decimal("valueOffsetY", { precision: 15, scale: 6 }),
  valueTilt: decimal("valueTilt", { precision: 15, scale: 6 }),
  valueThickness: decimal("valueThickness", { precision: 15, scale: 6 }),
  // W3-A (doc 27 M11, 0180): now a REAL FK — fk_measurement_results_defect_catalog,
  // ON DELETE SET NULL (deleting a catalog entry detaches, never breaks, results).
  defectCatalogId: integer("defectCatalogId")
    .references(() => defectCatalog.id, { onDelete: "set null" }),
  defectSeverity: varchar("defectSeverity", { length: 20 }),
  // Doc 31 Đợt B (OP3, migration 0194) — the RAW defect code as reported by the
  // machine/AI, retained even when it did NOT resolve to a defect_catalog row
  // (then defectCatalogId stays NULL). Honest, never-dropped fallback so an
  // unmatched code can be recovered/curated later (see unmatched_defect_codes).
  defectCodeRaw: varchar("defectCodeRaw", { length: 50 }),
  // ============ Defect location on board image (pixel coordinates) ============
  // Bounding box of defect region on the full board/panel image.
  // Enables: visual overlay in UI, AI training data (YOLO/COCO format), defect density heatmap.
  // Coordinates are in pixels relative to the top-left corner of imageUrl.
  defectBboxX: integer("defectBboxX"),       // left pixel
  defectBboxY: integer("defectBboxY"),       // top pixel
  defectBboxW: integer("defectBboxW"),       // width in pixels
  defectBboxH: integer("defectBboxH"),       // height in pixels
  defectCropUrl: text("defectCropUrl"),      // pre-cropped defect region image (optional, for fast display)
  defectCropKey: varchar("defectCropKey", { length: 255 }), // storage key for defectCropUrl
  // ============ end defect location ============
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_results_inspection").on(table.inspectionId),
  index("idx_results_point").on(table.pointDefId),
  index("idx_results_result").on(table.result),
  // Composite indexes for optimized queries
  index("idx_results_inspection_result").on(table.inspectionId, table.result),
  index("idx_results_point_result").on(table.pointDefId, table.result),
  // R-1 (doc 38, migration 0234): time-ordered scans of the hottest table by
  // measurement point (per-point trend / SPC / recent-results queries). The
  // (pointDefId, createdAt) composite lets the planner range-scan by point AND
  // time without a separate sort. Additive — see drizzle/0234_perf_indexes.sql.
  index("idx_results_pointdef_created").on(table.pointDefId, table.createdAt),
  // W3-A (0180): supports the ON DELETE SET NULL scan when a defect_catalog row
  // is deleted (partial — only rows that actually reference a defect).
  index("idx_results_defect_catalog").on(table.defectCatalogId).where(sql`${table.defectCatalogId} IS NOT NULL`),
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
