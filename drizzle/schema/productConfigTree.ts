// Schema domain: Product CONFIG tree (teach/template side), Pha 1A (migration 0338).
//
// Cây cấu hình 4 cấp: surface → position → capture → component. `measurement_point_defs`
// (drizzle/schema/product.ts) TRỞ THÀNH chính cấp component qua cột `captureRowId` — KHÔNG có
// bảng `product_components` thứ hai (nó đã mang limits/tolerance/criteria/variant/delta-sync).
//
// Đây là phía TEACH/TEMPLATE — chưa nối đường ghi kết quả (product_inspections/
// measurement_results không đụng ở đây, đó là Task 3).
import { pgTable, serial, integer, varchar, numeric, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { productModels } from "./product";

/**
 * Cấp 1 — mặt sản phẩm (VD: top / bottom / side). Mỗi surface mang ảnh template riêng để
 * dạy vị trí (position) lên trên.
 */
export const productSurfaces = pgTable("product_surfaces", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull()
    .references(() => productModels.id, { onDelete: "cascade" }),
  surfaceName: varchar("surfaceName", { length: 100 }).notNull(),
  surfaceExtId: varchar("surfaceExtId", { length: 64 }),
  templateImageUrl: text("templateImageUrl"),
  templateImageKey: varchar("templateImageKey", { length: 255 }),
  orderIndex: integer("orderIndex").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_product_surfaces_model_name").on(table.productModelId, table.surfaceName),
]);

export type ProductSurface = typeof productSurfaces.$inferSelect;
export type InsertProductSurface = typeof productSurfaces.$inferInsert;

/**
 * Cấp 2 — vị trí trên một surface (VD: một khối linh kiện, một vùng kiểm). `positionId` là
 * khoá do máy cấp (không phải id nội bộ) — join sang teach data. Toạ độ `relX/relY` TƯƠNG
 * ĐỐI 0..1 trên ảnh template của surface cha; máy LUÔN gửi giá trị đã resolve, payload thiếu
 * là lỗi hợp đồng, không phải cần suy đoán.
 */
export const productPositions = pgTable("product_positions", {
  id: serial("id").primaryKey(),
  surfaceRowId: integer("surfaceRowId").notNull()
    .references(() => productSurfaces.id, { onDelete: "cascade" }),
  positionId: varchar("positionId", { length: 64 }).notNull(),
  positionIndex: integer("positionIndex"),
  name: varchar("name", { length: 255 }),
  shape: varchar("shape", { length: 20 }),
  markerWidth: numeric("markerWidth", { precision: 10, scale: 4 }),
  markerHeight: numeric("markerHeight", { precision: 10, scale: 4 }),
  markerRadius: numeric("markerRadius", { precision: 10, scale: 4 }),
  // Toạ độ TƯƠNG ĐỐI 0..1 — đặt tên relX/relY để không lẫn với roiX/roiY (PIXEL TUYỆT ĐỐI)
  // trên measurement_point_defs.
  relX: numeric("relX", { precision: 10, scale: 8 }),
  relY: numeric("relY", { precision: 10, scale: 8 }),
  templateImageUrl: text("templateImageUrl"),
  templateImageKey: varchar("templateImageKey", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_product_positions_surface_posid").on(table.surfaceRowId, table.positionId),
]);

export type ProductPosition = typeof productPositions.$inferSelect;
export type InsertProductPosition = typeof productPositions.$inferInsert;

/**
 * Cấp 3 — lượt chụp (capture) tại một position. `captureExtId` = Capture.Id phía máy (GUID) —
 * khoá join sang manifest ảnh VÀ sang teach data.
 */
export const productCaptures = pgTable("product_captures", {
  id: serial("id").primaryKey(),
  positionRowId: integer("positionRowId").notNull()
    .references(() => productPositions.id, { onDelete: "cascade" }),
  captureExtId: varchar("captureExtId", { length: 64 }).notNull(),
  captureName: varchar("captureName", { length: 255 }),
  captureIndex: integer("captureIndex"),
  templateImageUrl: text("templateImageUrl"),
  templateImageKey: varchar("templateImageKey", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_product_captures_position_extid").on(table.positionRowId, table.captureExtId),
]);

export type ProductCapture = typeof productCaptures.$inferSelect;
export type InsertProductCapture = typeof productCaptures.$inferInsert;

// Cấp 4 (component) KHÔNG có bảng riêng — xem `measurementPointDefs` ở drizzle/schema/product.ts
// (cột captureRowId/componentExtId/roiX/roiY/roiWidth/roiHeight, migration 0338).
