// Schema domain: Layout tables
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, index } from "drizzle-orm/pg-core";
import { layoutLevelEnum, layoutTypeEnum } from "./enums";

/**
 * Factory Layout - Layout nhà xưởng cho visualization
 * Hỗ trợ cả 2D và 3D cho quy mô tập đoàn
 */
export const factoryLayouts = pgTable("factory_layouts", {
  id: serial("id").primaryKey(),
  factoryId: integer("factoryId"), // Layout cấp nhà máy
  workshopId: integer("workshopId"), // Layout cấp nhà xưởng
  layoutLevel: layoutLevelEnum("layoutLevel").default("WORKSHOP").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  layoutType: layoutTypeEnum("layoutType").default("2D").notNull(),
  layoutData: text("layoutData"), // JSON data for layout configuration
  width: integer("width").default(1000).notNull(),
  height: integer("height").default(800).notNull(),
  depth: integer("depth").default(500), // Cho 3D
  backgroundImageUrl: text("backgroundImageUrl"),
  model3dUrl: text("model3dUrl"), // URL model 3D
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_layouts_factory").on(table.factoryId),
  index("idx_layouts_workshop").on(table.workshopId),
  index("idx_layouts_level").on(table.layoutLevel),
]);

export type FactoryLayout = typeof factoryLayouts.$inferSelect;
export type InsertFactoryLayout = typeof factoryLayouts.$inferInsert;

/**
 * Machine Position - Vị trí máy trên layout (2D và 3D)
 */
export const machinePositions = pgTable("machine_positions", {
  id: serial("id").primaryKey(),
  layoutId: integer("layoutId").notNull(),
  machineId: integer("machineId").notNull(),
  positionX: integer("positionX").notNull(),
  positionY: integer("positionY").notNull(),
  positionZ: integer("positionZ").default(0), // Cho 3D
  width: integer("width").default(100).notNull(),
  height: integer("height").default(80).notNull(),
  depth: integer("depth").default(60), // Cho 3D
  rotation: integer("rotation").default(0),
  rotationY: integer("rotationY").default(0), // Cho 3D
  rotationZ: integer("rotationZ").default(0), // Cho 3D
  scale: decimal("scale", { precision: 5, scale: 2 }).default("1.00"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_positions_layout").on(table.layoutId),
  index("idx_positions_machine").on(table.machineId),
]);

export type MachinePosition = typeof machinePositions.$inferSelect;
export type InsertMachinePosition = typeof machinePositions.$inferInsert;

/**
 * Workshop Position - Vị trí nhà xưởng trên layout nhà máy
 */
export const workshopPositions = pgTable("workshop_positions", {
  id: serial("id").primaryKey(),
  layoutId: integer("layoutId").notNull(), // Layout cấp nhà máy
  workshopId: integer("workshopId").notNull(),
  positionX: integer("positionX").notNull(),
  positionY: integer("positionY").notNull(),
  positionZ: integer("positionZ").default(0),
  width: integer("width").default(200).notNull(),
  height: integer("height").default(150).notNull(),
  depth: integer("depth").default(100),
  rotation: integer("rotation").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ws_positions_layout").on(table.layoutId),
  index("idx_ws_positions_workshop").on(table.workshopId),
]);

export type WorkshopPosition = typeof workshopPositions.$inferSelect;
export type InsertWorkshopPosition = typeof workshopPositions.$inferInsert;

/**
 * Factory Position - Vị trí nhà máy trên layout tập đoàn
 */
export const factoryPositions = pgTable("factory_positions", {
  id: serial("id").primaryKey(),
  layoutId: integer("layoutId").notNull(), // Layout cấp tập đoàn
  factoryId: integer("factoryId").notNull(),
  positionX: integer("positionX").notNull(),
  positionY: integer("positionY").notNull(),
  positionZ: integer("positionZ").default(0),
  width: integer("width").default(300).notNull(),
  height: integer("height").default(200).notNull(),
  depth: integer("depth").default(150),
  rotation: integer("rotation").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_fac_positions_layout").on(table.layoutId),
  index("idx_fac_positions_factory").on(table.factoryId),
]);

export type FactoryPosition = typeof factoryPositions.$inferSelect;
export type InsertFactoryPosition = typeof factoryPositions.$inferInsert;
