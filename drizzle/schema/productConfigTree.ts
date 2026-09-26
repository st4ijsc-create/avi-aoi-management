// Schema domain: Product CONFIG tree (teach/template side), Pha 1A (migration 0338).
//
// Cây cấu hình 4 cấp: surface → position → capture → component. `measurement_point_defs`
// (drizzle/schema/product.ts) TRỞ THÀNH chính cấp component qua cột `captureRowId` — KHÔNG có
// bảng `product_components` thứ hai (nó đã mang limits/tolerance/criteria/variant/delta-sync).
//
// Đây là phía TEACH/TEMPLATE — chưa nối đường ghi kết quả (product_inspections/
// measurement_results không đụng ở đây, đó là Task 3).
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, numeric, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { productModels } from "./product";

/**
 * Cấp 1 — mặt sản phẩm (VD: top / bottom / side). Mỗi surface mang ảnh template riêng để
 * dạy vị trí (position) lên trên.
 */
export const productSurfaces = pgTable("product_surfaces", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull()
    .references(() => productModels.id, { onDelete: "cascade" }),
  // Khối B Task 5 (0347) — GỐC của chiều MÁY. Soft ref `machines(id)` (cùng quy ước
  // 0182/0187 và `measurement_point_defs.machineId`, đo `pg_constraint`: không FK).
  // Ba cấp dưới KHÔNG tự khai máy — chúng thừa hưởng qua khoá ngoại GHÉP, nên chiều
  // này có ĐÚNG MỘT nguồn sự thật.
  machineId: integer("machineId").notNull(),
  surfaceName: varchar("surfaceName", { length: 100 }).notNull(),
  surfaceExtId: varchar("surfaceExtId", { length: 64 }),
  templateImageUrl: text("templateImageUrl"),
  templateImageKey: varchar("templateImageKey", { length: 255 }),
  orderIndex: integer("orderIndex").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  // Khối B Task 5 (0347) — THAY `uq_product_surfaces_model_name` (productModelId,
  // surfaceName). Khoá cũ khiến máy B UPDATE đúng hàng của máy A khi hai máy dạy
  // CÙNG một product model: ghi đè IM LẶNG (mối lo #4 của Task 2).
  uniqueIndex("uq_product_surfaces_model_may_name")
    .on(table.productModelId, table.machineId, table.surfaceName),
  // Đích cho khoá ngoại GHÉP của product_positions.
  uniqueIndex("uq_product_surfaces_id_may").on(table.id, table.machineId),
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
  // = `product_surfaces.machineId` của cha. KHÔNG phải một lời khai độc lập: khoá
  // ngoại GHÉP `fk_positions_surface_may (surfaceRowId, machineId)` (0347) làm cho
  // một giá trị khác cha là `23503`, không phải một hàng lệch im lặng.
  machineId: integer("machineId").notNull(),
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
  // KHÔNG thêm machineId vào khoá này: `surfaceRowId` ĐÃ thuộc phạm vi một máy
  // (0347), nên machineId ở đây là hàm của cột kia — thêm vào chỉ làm to index.
  uniqueIndex("uq_product_positions_surface_posid").on(table.surfaceRowId, table.positionId),
  uniqueIndex("uq_product_positions_id_may").on(table.id, table.machineId),
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
  // = `product_positions.machineId` của cha, cưỡng chế bằng `fk_captures_position_may` (0347).
  machineId: integer("machineId").notNull(),
  captureExtId: varchar("captureExtId", { length: 64 }).notNull(),
  captureName: varchar("captureName", { length: 255 }),
  captureIndex: integer("captureIndex"),
  templateImageUrl: text("templateImageUrl"),
  templateImageKey: varchar("templateImageKey", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_product_captures_position_extid").on(table.positionRowId, table.captureExtId),
  uniqueIndex("uq_product_captures_id_may").on(table.id, table.machineId),
]);

export type ProductCapture = typeof productCaptures.$inferSelect;
export type InsertProductCapture = typeof productCaptures.$inferInsert;

// Cấp 4 (component) KHÔNG có bảng riêng — xem `measurementPointDefs` ở drizzle/schema/product.ts
// (cột captureRowId/componentExtId/roiX/roiY/roiWidth/roiHeight, migration 0338).

/**
 * ★★★ Khối B Task 5 (B-6, migration 0347) — SỔ BẢN DẠY do **MÁY** đẩy, phạm vi
 * `(machineId, productModelId)`.
 *
 * ⚠ KHÁC `inspection_program_releases` — ba khác biệt ĐO ĐƯỢC, không phải cảm tính:
 *   1. `uq_prog_rel_product_version` là UNIQUE `("productModelId", version)` ⇒ số
 *      phiên bản của sổ kia thuộc phạm vi SẢN PHẨM, không phải `(máy, model)`.
 *   2. Sổ kia đòi NGƯỜI duyệt có SoD (`approvedBy` ≠ `createdBy`); cho MÁY tự đẩy tới
 *      `released` là mở lỗ quản trị.
 *   3. `snapshot` của sổ kia là bộ điểm PHẲNG + ngưỡng, không phải cây bốn cấp.
 * ⇒ Hai sổ KHÔNG đụng nhau: sổ này ghi *"máy đã dạy gì"*, sổ kia ghi *"người đã ký gì"*.
 *
 * ⚠ MỘT LƯỢT ĐẨY **KHÔNG** LUÔN SINH MỘT PHIÊN BẢN. Trùng `checksum` với bản hiện
 * hành ⇒ chỉ chạm `lastSeenAt`. Đây là chỗ brief bị phép đo sửa: sinh phiên bản mỗi
 * lượt đẩy sẽ phá đúng bất biến HỘI TỤ mà Task 2 dựng (máy khởi động lại và đẩy lại
 * cây y hệt là chuyện thường), và làm sổ phình vô hạn mà không một nghĩa nào đổi.
 */
export const machineTemplateVersions = pgTable("machine_template_versions", {
  id: serial("id").primaryKey(),
  /** Soft ref `machines(id)` — cùng quy ước 0182/0187. Luôn là `auth.machine.id`. */
  machineId: integer("machineId").notNull(),
  productModelId: integer("productModelId").notNull()
    .references(() => productModels.id, { onDelete: "cascade" }),
  /** Đơn điệu theo `(machineId, productModelId)`. */
  version: integer("version").notNull(),
  /** sha256 ỔN ĐỊNH của cây đã hợp lệ hoá (khoá sắp xếp) — khoá chống-đẻ-phiên-bản. */
  checksum: varchar("checksum", { length: 64 }).notNull(),
  surfaceCount: integer("surfaceCount").default(0).notNull(),
  positionCount: integer("positionCount").default(0).notNull(),
  captureCount: integer("captureCount").default(0).notNull(),
  componentCount: integer("componentCount").default(0).notNull(),
  /**
   * BẤT BIẾN — cây NGUYÊN VĂN lúc đẩy. Đây là thứ DUY NHẤT trả lời được *"bo CŨ
   * chấm theo bản dạy nào"*: hàng `measurement_point_defs` bị lượt đẩy sau GHI ĐÈ
   * TẠI CHỖ (giá của bất biến hội tụ), nên không chụp ở đây thì nghĩa của dữ liệu
   * ĐÃ GHI sẽ đổi khi đẩy bản mới.
   */
  snapshot: jsonb("snapshot").notNull(),
  pushedAt: timestamp("pushedAt").defaultNow().notNull(),
  /** Lượt đẩy TRÙNG checksum gần nhất (máy còn sống, cây không đổi). */
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  /**
   * NULL = bản HIỆN HÀNH. Cùng `pushedAt` tạo KHOẢNG `[pushedAt, supersededAt)` —
   * cách tra "bo chấm lúc T theo bản dạy nào" mà KHÔNG phải thêm cột vào
   * `measurement_results` (hypertable ĐÃ NÉN).
   */
  supersededAt: timestamp("supersededAt"),
  previousVersionId: integer("previousVersionId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_mtv_may_model_version").on(table.machineId, table.productModelId, table.version),
  // ĐÚNG MỘT bản hiện hành cho mỗi (máy, model) — cưỡng chế ở DB, không ở lời hứa.
  uniqueIndex("uq_mtv_hien_hanh").on(table.machineId, table.productModelId)
    .where(sql`${table.supersededAt} IS NULL`),
  index("idx_mtv_khoang").on(table.machineId, table.productModelId, table.pushedAt),
]);

export type MachineTemplateVersion = typeof machineTemplateVersions.$inferSelect;
export type InsertMachineTemplateVersion = typeof machineTemplateVersions.$inferInsert;
