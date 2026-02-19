// Schema domain: Product tables
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, json, index } from "drizzle-orm/pg-core";
import { lifecycleStatusEnum, measurementTypeEnum } from "./enums";

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
  // Quality targets
  targetYieldRate: decimal("targetYieldRate", { precision: 5, scale: 2 }), // Target FPY %
  minYieldRate: decimal("minYieldRate", { precision: 5, scale: 2 }), // Minimum acceptable FPY %
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
  // Ảnh mẫu riêng cho điểm đo này (crop từ ảnh sản phẩm)
  referenceImageUrl: text("referenceImageUrl"),
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  // Kích thước vùng cắt ảnh mẫu (tâm là positionX, positionY)
  cropWidth: integer("cropWidth").default(100).notNull(), // Chiều rộng vùng cắt
  cropHeight: integer("cropHeight").default(100).notNull(), // Chiều cao vùng cắt
  orderIndex: integer("orderIndex").default(0).notNull(), // Thứ tự điểm đo
  workstationId: integer("workstationId"), // Công trạm thực hiện sản xuất điểm đo này
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_point_defs_product").on(table.productModelId),
  index("idx_point_defs_machine").on(table.machineId),
  index("idx_point_defs_code").on(table.code),
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
