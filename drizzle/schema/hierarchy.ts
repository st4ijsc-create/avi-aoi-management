// Schema domain: Hierarchy tables (Corporate > Factory > Workshop > Line > Station > Machine)
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { machineTypeEnum, statusEnum_1, operationStatusEnum, processTypeEnum } from "./enums";

/**
 * Corporate - Tập đoàn (cấp cao nhất)
 * Enables proper multi-tenant corporate rollup with FK integrity.
 * productInspections.corporateCode references this table's code.
 */
export const corporates = pgTable("corporates", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  country: varchar("country", { length: 100 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  logoUrl: text("logoUrl"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_corporates_code").on(table.code),
  index("idx_corporates_active").on(table.isActive),
]);

export type Corporate = typeof corporates.$inferSelect;
export type InsertCorporate = typeof corporates.$inferInsert;

/**
 * Factory - Nhà máy (thuộc tập đoàn)
 */
export const factories = pgTable("factories", {
  id: serial("id").primaryKey(),
  corporateCode: varchar("corporateCode", { length: 50 }), // FK to corporates.code (nullable for back-compat)
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  address: text("address"),
  region: varchar("region", { length: 100 }), // Khu vực địa lý
  country: varchar("country", { length: 100 }),
  timezone: varchar("timezone", { length: 64 }).default("Asia/Ho_Chi_Minh"), // IANA timezone for shift boundary calc
  mapPositionX: decimal("mapPositionX", { precision: 10, scale: 4 }), // Vị trí X trên bản đồ (0-1)
  mapPositionY: decimal("mapPositionY", { precision: 10, scale: 4 }), // Vị trí Y trên bản đồ (0-1)
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_factories_code").on(table.code),
  index("idx_factories_active").on(table.isActive),
  index("idx_factories_corporate").on(table.corporateCode),
]);

export type Factory = typeof factories.$inferSelect;
export type InsertFactory = typeof factories.$inferInsert;

/**
 * Workshop - Nhà xưởng (thuộc Factory, 1-6 per factory)
 */
export const workshops = pgTable("workshops", {
  id: serial("id").primaryKey(),
  factoryId: integer("factoryId").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  floorArea: decimal("floorArea", { precision: 10, scale: 2 }), // Diện tích m2
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_workshops_factory").on(table.factoryId),
  index("idx_workshops_code").on(table.code),
]);

export type Workshop = typeof workshops.$inferSelect;
export type InsertWorkshop = typeof workshops.$inferInsert;

/**
 * Production Line - Dây chuyền sản xuất
 */
export const productionLines = pgTable("production_lines", {
  id: serial("id").primaryKey(),
  workshopId: integer("workshopId").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  capacityPerHour: integer("capacityPerHour"), // Sản lượng mỗi giờ
  maxConcurrentOrders: integer("maxConcurrentOrders").default(1), // Số lệnh tối đa cùng lúc
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_lines_workshop").on(table.workshopId),
  index("idx_lines_code").on(table.code),
]);

export type ProductionLine = typeof productionLines.$inferSelect;
export type InsertProductionLine = typeof productionLines.$inferInsert;

/**
 * Station - Công trạm (thuộc Production Line)
 */
export const stations = pgTable("stations", {
  id: serial("id").primaryKey(),
  lineId: integer("lineId").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  orderIndex: integer("orderIndex").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_stations_line").on(table.lineId),
  index("idx_stations_code").on(table.code),
]);

export type Station = typeof stations.$inferSelect;
export type InsertStation = typeof stations.$inferInsert;

/**
 * Machine - Máy AVI/AOI/Tự động hóa
 */
export const machines = pgTable("machines", {
  id: serial("id").primaryKey(),
  stationId: integer("stationId").notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  machineType: machineTypeEnum("machineType").notNull(),
  model: varchar("model", { length: 100 }),
  manufacturer: varchar("manufacturer", { length: 100 }),
  apiKey: varchar("apiKey", { length: 128 }).unique(), // Có thể null khi máy chưa được duyệt
  description: text("description"),
  // Machine images for 2D/3D visualization
  image2DUrl: text("image2DUrl"), // Ảnh 2D của máy
  image2DKey: varchar("image2DKey", { length: 255 }),
  image3DUrl: text("image3DUrl"), // Ảnh 3D của máy
  image3DKey: varchar("image3DKey", { length: 255 }),
  // Layout position for drag & drop
  layoutPositionX: decimal("layoutPositionX", { precision: 10, scale: 4 }), // Vị trí X trong Layout (0-1)
  layoutPositionY: decimal("layoutPositionY", { precision: 10, scale: 4 }), // Vị trí Y trong Layout (0-1)
  // --- Bổ sung cho đồng bộ online/offline ---
  serialNumber: varchar("serialNumber", { length: 100 }), // Serial number từ máy AOI/AVI
  firmwareVersion: varchar("firmwareVersion", { length: 50 }), // Phiên bản firmware
  syncMode: statusEnum_1("syncMode").default("online").notNull(), // "online" | "offline"
  registrationStatus: varchar("registrationStatus", { length: 20 }).default("pending").notNull(), // "pending" | "approved" | "rejected" | "unmapped"
  lastSyncAt: timestamp("lastSyncAt"),
  pendingConfig: text("pendingConfig"), // Cấu hình chờ duyệt (offline)
  isActive: boolean("isActive").default(true).notNull(),
  lastHeartbeat: timestamp("lastHeartbeat"),
  operationStatus: operationStatusEnum("operationStatus").default("stopped").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_machines_station").on(table.stationId),
  index("idx_machines_code").on(table.code),
  index("idx_machines_apikey").on(table.apiKey),
  index("idx_machines_registration_status").on(table.registrationStatus),
  index("idx_machines_syncmode").on(table.syncMode),
  index("idx_machines_serial_number").on(table.serialNumber),
]);

export type Machine = typeof machines.$inferSelect;
export type InsertMachine = typeof machines.$inferInsert;

/**
 * Workstations - Công trạm sản xuất
 * Mỗi điểm kiểm tra của máy AVI/AOI được thực hiện bởi một công trạm trước đó
 */
export const workstations = pgTable("workstations", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  lineId: integer("lineId"), // Thuộc dây chuyền nào
  workshopId: integer("workshopId"), // Thuộc xưởng nào
  factoryId: integer("factoryId"), // Thuộc nhà máy nào
  processType: processTypeEnum("processType").default("OTHER"),
  orderIndex: integer("orderIndex").default(0).notNull(), // Thứ tự trong dây chuyền
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_workstations_code").on(table.code),
  index("idx_workstations_line").on(table.lineId),
  index("idx_workstations_workshop").on(table.workshopId),
  index("idx_workstations_factory").on(table.factoryId),
]);
export type Workstation = typeof workstations.$inferSelect;
export type InsertWorkstation = typeof workstations.$inferInsert;
