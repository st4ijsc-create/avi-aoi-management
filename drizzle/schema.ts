import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, bigint } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Factory - Nhà máy
 */
export const factories = mysqlTable("factories", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  address: text("address"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Factory = typeof factories.$inferSelect;
export type InsertFactory = typeof factories.$inferInsert;

/**
 * Workshop - Nhà xưởng (thuộc Factory)
 */
export const workshops = mysqlTable("workshops", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Workshop = typeof workshops.$inferSelect;
export type InsertWorkshop = typeof workshops.$inferInsert;

/**
 * Production Line - Dây chuyền sản xuất
 */
export const productionLines = mysqlTable("production_lines", {
  id: int("id").autoincrement().primaryKey(),
  workshopId: int("workshopId").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductionLine = typeof productionLines.$inferSelect;
export type InsertProductionLine = typeof productionLines.$inferInsert;

/**
 * Station - Công trạm (thuộc Production Line)
 */
export const stations = mysqlTable("stations", {
  id: int("id").autoincrement().primaryKey(),
  lineId: int("lineId").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  orderIndex: int("orderIndex").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Station = typeof stations.$inferSelect;
export type InsertStation = typeof stations.$inferInsert;

/**
 * Machine - Máy AVI/AOI/Tự động hóa
 */
export const machines = mysqlTable("machines", {
  id: int("id").autoincrement().primaryKey(),
  stationId: int("stationId").notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  machineType: mysqlEnum("machineType", ["AVI", "AOI", "AUTOMATION"]).notNull(),
  model: varchar("model", { length: 100 }),
  manufacturer: varchar("manufacturer", { length: 100 }),
  apiKey: varchar("apiKey", { length: 128 }).notNull().unique(),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  lastHeartbeat: timestamp("lastHeartbeat"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Machine = typeof machines.$inferSelect;
export type InsertMachine = typeof machines.$inferInsert;

/**
 * Product Inspection - Kết quả kiểm tra sản phẩm
 */
export const productInspections = mysqlTable("product_inspections", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  serialNumber: varchar("serialNumber", { length: 100 }).notNull(),
  productModel: varchar("productModel", { length: 100 }),
  batchNumber: varchar("batchNumber", { length: 100 }),
  overallResult: mysqlEnum("overallResult", ["OK", "NG", "NTF"]).notNull(),
  originalResult: mysqlEnum("originalResult", ["OK", "NG"]).notNull(),
  ntfConfirmedBy: int("ntfConfirmedBy"),
  ntfConfirmedAt: timestamp("ntfConfirmedAt"),
  ntfReason: text("ntfReason"),
  inspectionTime: timestamp("inspectionTime").notNull(),
  cycleTime: decimal("cycleTime", { precision: 10, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductInspection = typeof productInspections.$inferSelect;
export type InsertProductInspection = typeof productInspections.$inferInsert;

/**
 * Measurement Point Definition - Định nghĩa điểm đo
 */
export const measurementPointDefs = mysqlTable("measurement_point_defs", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  measurementType: mysqlEnum("measurementType", ["DIMENSION", "VISUAL", "ELECTRICAL", "OTHER"]).notNull(),
  unit: varchar("unit", { length: 20 }),
  lowerLimit: decimal("lowerLimit", { precision: 15, scale: 6 }),
  upperLimit: decimal("upperLimit", { precision: 15, scale: 6 }),
  nominalValue: decimal("nominalValue", { precision: 15, scale: 6 }),
  referenceImageUrl: text("referenceImageUrl"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MeasurementPointDef = typeof measurementPointDefs.$inferSelect;
export type InsertMeasurementPointDef = typeof measurementPointDefs.$inferInsert;

/**
 * Measurement Result - Kết quả đo thực tế
 */
export const measurementResults = mysqlTable("measurement_results", {
  id: int("id").autoincrement().primaryKey(),
  inspectionId: int("inspectionId").notNull(),
  pointDefId: int("pointDefId").notNull(),
  measuredValue: decimal("measuredValue", { precision: 15, scale: 6 }),
  result: mysqlEnum("result", ["OK", "NG"]).notNull(),
  imageUrl: text("imageUrl"),
  imageKey: varchar("imageKey", { length: 255 }),
  remark: text("remark"),
  aiAnalysisResult: text("aiAnalysisResult"),
  aiConfidence: decimal("aiConfidence", { precision: 5, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MeasurementResult = typeof measurementResults.$inferSelect;
export type InsertMeasurementResult = typeof measurementResults.$inferInsert;

/**
 * Factory Layout - Layout nhà xưởng cho visualization
 */
export const factoryLayouts = mysqlTable("factory_layouts", {
  id: int("id").autoincrement().primaryKey(),
  workshopId: int("workshopId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  layoutType: mysqlEnum("layoutType", ["2D", "3D"]).default("2D").notNull(),
  layoutData: text("layoutData"), // JSON data for layout configuration
  width: int("width").default(1000).notNull(),
  height: int("height").default(800).notNull(),
  backgroundImageUrl: text("backgroundImageUrl"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FactoryLayout = typeof factoryLayouts.$inferSelect;
export type InsertFactoryLayout = typeof factoryLayouts.$inferInsert;

/**
 * Machine Position - Vị trí máy trên layout
 */
export const machinePositions = mysqlTable("machine_positions", {
  id: int("id").autoincrement().primaryKey(),
  layoutId: int("layoutId").notNull(),
  machineId: int("machineId").notNull(),
  positionX: int("positionX").notNull(),
  positionY: int("positionY").notNull(),
  positionZ: int("positionZ").default(0),
  width: int("width").default(100).notNull(),
  height: int("height").default(80).notNull(),
  rotation: int("rotation").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MachinePosition = typeof machinePositions.$inferSelect;
export type InsertMachinePosition = typeof machinePositions.$inferInsert;

/**
 * Daily Statistics - Thống kê theo ngày cho performance
 */
export const dailyStatistics = mysqlTable("daily_statistics", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  date: timestamp("date").notNull(),
  totalCount: int("totalCount").default(0).notNull(),
  okCount: int("okCount").default(0).notNull(),
  ngCount: int("ngCount").default(0).notNull(),
  ntfCount: int("ntfCount").default(0).notNull(),
  yieldRate: decimal("yieldRate", { precision: 5, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyStatistics = typeof dailyStatistics.$inferSelect;
export type InsertDailyStatistics = typeof dailyStatistics.$inferInsert;
