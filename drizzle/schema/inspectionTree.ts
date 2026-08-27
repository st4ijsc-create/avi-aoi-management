// Schema domain: Inspection RESULT tree (Pha 1A, migration 0339).
//
// Cây kết quả 3 cấp: inspection_surfaces → inspection_positions → inspection_captures.
// FK THẬT giữa ba bảng này (ON DELETE CASCADE) — chúng là bảng THƯỜNG, không phải
// hypertable. Liên kết LÊN `product_inspections` (drizzle/schema/inspection.ts) là
// SOFT REF: `inspectionId` KHÔNG `.references()` vì đích là hypertable — Postgres cấm
// FK trỏ TỚI hypertable (xem file header của inspection.ts).
//
// `inspectionTime` được SAO xuống mọi cấp để dọn theo cửa sổ thời gian mà KHÔNG phải
// join ngược vào hypertable cha.
//
// Mỗi cấp lưu CẢ "cái máy KHAI" (result/ntf) LẪN "cái CUỘN ra từ con" (rolledResult/
// rolledNtf) + declaredMismatch: lệch nhau ⇒ có bug ở máy hoặc ở ta, và PHÁT HIỆN
// ĐƯỢC — đừng gộp hai cặp field này lại, đó là điểm chẩn đoán của toàn bộ thiết kế.
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { overallResultEnum } from "./enums";

/**
 * Cấp 1 — kết quả một MẶT (surface) của một inspection. `inspectionId` là SOFT ref
 * (KHÔNG `.references()`) → product_inspections.id: product_inspections là hypertable,
 * Postgres cấm FK tới nó. `inspectionTime` sao từ header để lọc theo cửa sổ thời gian
 * không cần join ngược.
 */
export const inspectionSurfaces = pgTable("inspection_surfaces", {
  id: serial("id").primaryKey(),
  // SOFT ref — KHÔNG .references(). Đích product_inspections là hypertable.
  inspectionId: integer("inspectionId").notNull(),
  inspectionTime: timestamp("inspectionTime").notNull(),
  surfaceName: varchar("surfaceName", { length: 100 }).notNull(),
  surfaceExtId: varchar("surfaceExtId", { length: 64 }),
  // Cái MÁY KHAI cho cả mặt.
  result: overallResultEnum("result").notNull(),
  ntf: boolean("ntf").default(false).notNull(),
  ntfSource: varchar("ntfSource", { length: 10 }),
  // Cái TA CUỘN ra từ các position con (OR/aggregate). Lệch với result/ntf ở trên ⇒
  // declaredMismatch = true.
  rolledResult: overallResultEnum("rolledResult").notNull(),
  rolledNtf: boolean("rolledNtf").default(false).notNull(),
  declaredMismatch: boolean("declaredMismatch").default(false).notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_insp_surfaces_inspection").on(table.inspectionId),
  index("idx_insp_surfaces_time").on(table.inspectionTime),
  index("idx_insp_surfaces_mismatch").on(table.declaredMismatch).where(sql`${table.declaredMismatch}`),
  // Pha 1B (migration 0340, BG-11) — khử trùng cây KẾT QUẢ ở cấp surface: một inspection
  // không thể có hai surface CÙNG TÊN. surface định danh bằng TÊN trong phạm vi một bo
  // (QĐ-BG6) vì payload máy KHÔNG gửi id surface. Đích ON CONFLICT cho Task 5 (idempotent
  // ingest — gửi lại 1 bo không còn tạo 2 surface).
  uniqueIndex("uq_insp_surfaces_inspection_name").on(table.inspectionId, table.surfaceName),
]);

export type InspectionSurface = typeof inspectionSurfaces.$inferSelect;
export type InsertInspectionSurface = typeof inspectionSurfaces.$inferInsert;

/**
 * Cấp 2 — kết quả một VỊ TRÍ (position) trong một surface. `surfaceRowId` là FK THẬT
 * (ON DELETE CASCADE) — inspection_surfaces là bảng thường, không phải hypertable.
 */
export const inspectionPositions = pgTable("inspection_positions", {
  id: serial("id").primaryKey(),
  // FK THẬT — hai bảng thường, ON DELETE CASCADE (xoá surface ⇒ xoá position con).
  surfaceRowId: integer("surfaceRowId").notNull()
    .references(() => inspectionSurfaces.id, { onDelete: "cascade" }),
  inspectionId: integer("inspectionId").notNull(),
  inspectionTime: timestamp("inspectionTime").notNull(),
  positionId: varchar("positionId", { length: 64 }).notNull(),
  positionNumber: integer("positionNumber"),
  result: overallResultEnum("result").notNull(),
  ntf: boolean("ntf").default(false).notNull(),
  ntfSource: varchar("ntfSource", { length: 10 }),
  rolledResult: overallResultEnum("rolledResult").notNull(),
  rolledNtf: boolean("rolledNtf").default(false).notNull(),
  declaredMismatch: boolean("declaredMismatch").default(false).notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_insp_positions_surface").on(table.surfaceRowId),
  index("idx_insp_positions_time").on(table.inspectionTime),
  // Pha 1B (migration 0340, BG-11) — khử trùng cây KẾT QUẢ ở cấp position: một surface
  // không thể có hai position CÙNG positionId (khoá do máy cấp). Đích ON CONFLICT cho Task 5.
  uniqueIndex("uq_insp_positions_surface_posid").on(table.surfaceRowId, table.positionId),
]);

export type InspectionPosition = typeof inspectionPositions.$inferSelect;
export type InsertInspectionPosition = typeof inspectionPositions.$inferInsert;

/**
 * Cấp 3 — kết quả một LƯỢT CHỤP (capture) tại một position. `positionRowId` là FK THẬT
 * (ON DELETE CASCADE). Ở cấp này result/ntf là field TRỰC TIẾP từ pipeline máy (không
 * phải tự OR ngược từ components) ⇒ declaredMismatch ở đây có giá trị chẩn đoán mạnh
 * nhất trong cả cây.
 */
export const inspectionCaptures = pgTable("inspection_captures", {
  id: serial("id").primaryKey(),
  // FK THẬT — hai bảng thường, ON DELETE CASCADE (xoá position ⇒ xoá capture con).
  positionRowId: integer("positionRowId").notNull()
    .references(() => inspectionPositions.id, { onDelete: "cascade" }),
  inspectionId: integer("inspectionId").notNull(),
  inspectionTime: timestamp("inspectionTime").notNull(),
  captureExtId: varchar("captureExtId", { length: 64 }).notNull(),
  captureName: varchar("captureName", { length: 255 }),
  captureIndex: integer("captureIndex"),
  result: overallResultEnum("result").notNull(),
  ntf: boolean("ntf").default(false).notNull(),
  ntfSource: varchar("ntfSource", { length: 10 }),
  rolledResult: overallResultEnum("rolledResult").notNull(),
  rolledNtf: boolean("rolledNtf").default(false).notNull(),
  declaredMismatch: boolean("declaredMismatch").default(false).notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_insp_captures_position_extid").on(table.positionRowId, table.captureExtId),
  index("idx_insp_captures_time").on(table.inspectionTime),
]);

export type InspectionCapture = typeof inspectionCaptures.$inferSelect;
export type InsertInspectionCapture = typeof inspectionCaptures.$inferInsert;
