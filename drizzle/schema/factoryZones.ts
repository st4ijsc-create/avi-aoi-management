// Schema domain: Factory Zones (audit doc 25 · Trụ E / task W6-25)
//
// ════════════════════════════════════════════════════════════════════════════
// Vùng (zone) vẽ được trên mặt bằng nhà máy: mỗi dòng là MỘT polygon có tên + màu.
// `points` là mảng đỉnh {x,y} chuẩn hoá 0–1 (giống toạ độ layout của máy) để độc lập
// với kích thước ảnh nền/viewBox. CRUD gated bằng machine_control/canEdit ở tầng
// router (như layout máy). Bảng additive — không ALTER TYPE, không enum pg mới.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/** Đỉnh polygon chuẩn hoá 0–1 theo bề rộng/sâu sàn. */
export type ZonePoint = { x: number; y: number };

export const factoryZones = pgTable("factory_zones", {
  id: serial("id").primaryKey(),
  factoryId: integer("factoryId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  color: varchar("color", { length: 24 }).default("#0ea5e9").notNull(),
  points: jsonb("points").$type<ZonePoint[]>().default([]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_factory_zones_factory").on(table.factoryId),
]);

export type FactoryZone = typeof factoryZones.$inferSelect;
export type InsertFactoryZone = typeof factoryZones.$inferInsert;
