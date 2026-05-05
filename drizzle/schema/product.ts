// Schema domain: Product tables
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, json, index } from "drizzle-orm/pg-core";
import { lifecycleStatusEnum, measurementTypeEnum, syncOperationEnum, syncStatusEnum } from "./enums";

/**
 * Product Model - Mẫu sản phẩm với ảnh tham chiếu
 */
export const productModels = pgTable("product_models", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Product hierarchy
  category: varchar("category", { length: 100 }), // Product family/category (legacy text field)
  categoryId: integer("categoryId"), // Foreign key to product_categories table
  productLine: varchar("productLine", { length: 100 }), // Product line
  variant: varchar("variant", { length: 100 }), // Product variant
  // Lifecycle status
  lifecycleStatus: lifecycleStatusEnum("lifecycleStatus").default("active").notNull(),
  // Reference image
  referenceImageUrl: text("referenceImageUrl"), // Ảnh mẫu sản phẩm
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  imageWidth: integer("imageWidth"), // Kích thước ảnh gốc
  imageHeight: integer("imageHeight"),
  imageDisplayMode: varchar("imageDisplayMode", { length: 20 }).default("contain"), // contain | cover | stretch | none
  // Quality targets
  targetYieldRate: decimal("targetYieldRate", { precision: 5, scale: 2 }), // Target FPY %
  minYieldRate: decimal("minYieldRate", { precision: 5, scale: 2 }), // Minimum acceptable FPY %
  // Points config version - incremented when measurement points change
  pointsConfigVersion: integer("pointsConfigVersion").default(1).notNull(),
  // Image hash for deduplication (SHA-256)
  imageHash: varchar("imageHash", { length: 64 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_product_models_code").on(table.code),
  index("idx_product_models_category").on(table.category),
  index("idx_product_models_category_id").on(table.categoryId),
  index("idx_product_models_lifecycle").on(table.lifecycleStatus),
]);

export type ProductModel = typeof productModels.$inferSelect;
export type InsertProductModel = typeof productModels.$inferInsert;

/**
 * Measurement Point Definition - Định nghĩa điểm đo với tọa độ trên ảnh mẫu
 * Mỗi sản phẩm có thể có 30-50 điểm đo
 */
export const measurementPointDefs = pgTable("measurement_point_defs", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(), // Liên kết với Product Model
  machineId: integer("machineId"), // Optional: máy cụ thể sử dụng điểm đo này
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  measurementType: measurementTypeEnum("measurementType").notNull(),
  unit: varchar("unit", { length: 20 }),
  lowerLimit: decimal("lowerLimit", { precision: 15, scale: 6 }),
  upperLimit: decimal("upperLimit", { precision: 15, scale: 6 }),
  nominalValue: decimal("nominalValue", { precision: 15, scale: 6 }),
  // Tọa độ điểm đo trên ảnh mẫu (vẽ đường tròn)
  positionX: integer("positionX").notNull(), // Tâm X của đường tròn
  positionY: integer("positionY").notNull(), // Tâm Y của đường tròn
  radius: integer("radius").default(20).notNull(), // Bán kính đường tròn
  // Normalized coordinates (0.0 - 1.0) relative to reference image dimensions
  // Ensures coordinate portability across different image resolutions
  normalizedX: decimal("normalizedX", { precision: 10, scale: 8 }),
  normalizedY: decimal("normalizedY", { precision: 10, scale: 8 }),
  normalizedRadius: decimal("normalizedRadius", { precision: 10, scale: 8 }),
  // Ảnh mẫu riêng cho điểm đo này (crop từ ảnh sản phẩm)
  referenceImageUrl: text("referenceImageUrl"),
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  // Kích thước vùng cắt ảnh mẫu (tâm là positionX, positionY)
  cropWidth: integer("cropWidth").default(100).notNull(), // Chiều rộng vùng cắt
  cropHeight: integer("cropHeight").default(100).notNull(), // Chiều cao vùng cắt
  orderIndex: integer("orderIndex").default(0).notNull(), // Thứ tự điểm đo
  workstationId: integer("workstationId"), // Công trạm thực hiện sản xuất điểm đo này
  // Image hash for deduplication (SHA-256)
  imageHash: varchar("imageHash", { length: 64 }),
  // Last modified timestamp for delta sync
  lastModifiedAt: timestamp("lastModifiedAt").defaultNow(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_point_defs_product").on(table.productModelId),
  index("idx_point_defs_machine").on(table.machineId),
  index("idx_point_defs_code").on(table.code),
  index("idx_point_defs_last_modified").on(table.lastModifiedAt),
  index("idx_point_defs_product_modified").on(table.productModelId, table.lastModifiedAt),
  index("idx_point_defs_image_hash").on(table.imageHash),
]);

export type MeasurementPointDef = typeof measurementPointDefs.$inferSelect;
export type InsertMeasurementPointDef = typeof measurementPointDefs.$inferInsert;

/**
 * Product-Machine Mapping - Gán sản phẩm cho máy
 * Một máy có thể kiểm tra nhiều sản phẩm, một sản phẩm có thể được kiểm tra trên nhiều máy
 */
export const productMachineMappings = pgTable("product_machine_mappings", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  machineId: integer("machineId").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  priority: integer("priority").default(0).notNull(), // Ưu tiên sản phẩm trên máy
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_pm_mapping_product").on(table.productModelId),
  index("idx_pm_mapping_machine").on(table.machineId),
]);

export type ProductMachineMapping = typeof productMachineMappings.$inferSelect;
export type InsertProductMachineMapping = typeof productMachineMappings.$inferInsert;

/**
 * Measurement Point Template - Mẫu điểm đo có thể tái sử dụng
 */
export const measurementPointTemplates = pgTable("measurement_point_templates", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }), // VD: "Electronics", "Mechanical", "Optical"
  points: json("points").$type<Array<{
    code: string;
    name: string;
    description?: string;
    measurementType: "DIMENSION" | "VISUAL" | "ELECTRICAL" | "POSITION" | "COLOR" | "SURFACE" | "OTHER";
    unit?: string;
    lowerLimit?: string;
    upperLimit?: string;
    nominalValue?: string;
    positionX: number;
    positionY: number;
    radius: number;
    cropWidth: number;
    cropHeight: number;
    orderIndex: number;
  }>>().notNull(), // Danh sách điểm đo trong template
  pointCount: integer("pointCount").notNull(), // Số lượng điểm đo
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_templates_code").on(table.code),
  index("idx_templates_category").on(table.category),
  index("idx_templates_active").on(table.isActive),
]);

export type MeasurementPointTemplate = typeof measurementPointTemplates.$inferSelect;
export type InsertMeasurementPointTemplate = typeof measurementPointTemplates.$inferInsert;

/**
 * Product Categories - Danh mục sản phẩm tập trung
 */
export const productCategories = pgTable("product_categories", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Parent category for hierarchical structure
  parentId: integer("parentId"), // FK to self (null = root category)
  // Display settings
  color: varchar("color", { length: 20 }).default("#3b82f6"),
  icon: varchar("icon", { length: 50 }), // Lucide icon name
  orderIndex: integer("orderIndex").default(0).notNull(),
  // Stats
  productCount: integer("productCount").default(0).notNull(), // Cached count of products in this category
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_product_categories_code").on(table.code),
  index("idx_product_categories_parent").on(table.parentId),
  index("idx_product_categories_order").on(table.orderIndex),
  index("idx_product_categories_active").on(table.isActive),
]);

export type ProductCategory = typeof productCategories.$inferSelect;
export type InsertProductCategory = typeof productCategories.$inferInsert;

/**
 * Sync Logs - Lịch sử đồng bộ điểm đo và ảnh giữa máy và server
 */
export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 50 }).notNull(),
  productModelId: integer("productModelId"),
  productModelCode: varchar("productModelCode", { length: 100 }),
  syncOperation: syncOperationEnum("syncOperation").notNull(),
  syncStatus: syncStatusEnum("syncStatus").default("SUCCESS").notNull(),
  // Sync details
  pointsSynced: integer("pointsSynced").default(0),
  pointsCreated: integer("pointsCreated").default(0),
  pointsUpdated: integer("pointsUpdated").default(0),
  pointsFailed: integer("pointsFailed").default(0),
  errorDetails: json("errorDetails").$type<Array<{ code: string; message: string }>>(),
  // Coordinate transformation info
  sourceImageWidth: integer("sourceImageWidth"),
  sourceImageHeight: integer("sourceImageHeight"),
  serverImageWidth: integer("serverImageWidth"),
  serverImageHeight: integer("serverImageHeight"),
  coordTransformations: integer("coordTransformations").default(0),
  // Delta sync info
  fromVersion: integer("fromVersion"),
  toVersion: integer("toVersion"),
  // Image sync info
  imageHashBefore: varchar("imageHashBefore", { length: 64 }),
  imageHashAfter: varchar("imageHashAfter", { length: 64 }),
  imageSizeBytes: integer("imageSizeBytes"),
  imageSkipped: boolean("imageSkipped").default(false),
  // Performance
  durationMs: integer("durationMs"),
  requestSizeBytes: integer("requestSizeBytes"),
  // Metadata
  clientVersion: varchar("clientVersion", { length: 50 }),
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_sync_logs_machine").on(table.machineId),
  index("idx_sync_logs_machine_code").on(table.machineCode),
  index("idx_sync_logs_product").on(table.productModelId),
  index("idx_sync_logs_operation").on(table.syncOperation),
  index("idx_sync_logs_status").on(table.syncStatus),
  index("idx_sync_logs_created_at").on(table.createdAt),
  index("idx_sync_logs_machine_product").on(table.machineId, table.productModelId),
]);

export type SyncLog = typeof syncLogs.$inferSelect;
export type InsertSyncLog = typeof syncLogs.$inferInsert;

/**
 * Product Documents - Tài liệu đính kèm sản phẩm (PDF, Word, etc.)
 */
export const productDocuments = pgTable("product_documents", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileSize: integer("fileSize"),          // bytes
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  uploadedBy: integer("uploadedBy"),      // user id
  uploadedByName: varchar("uploadedByName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_product_documents_product").on(table.productModelId),
]);

export type ProductDocument = typeof productDocuments.$inferSelect;
export type InsertProductDocument = typeof productDocuments.$inferInsert;
