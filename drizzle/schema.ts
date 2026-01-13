import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, bigint, index } from "drizzle-orm/mysql-core";

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
 * Factory - Nhà máy (thuộc tập đoàn)
 */
export const factories = mysqlTable("factories", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  address: text("address"),
  region: varchar("region", { length: 100 }), // Khu vực địa lý
  country: varchar("country", { length: 100 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_factories_code").on(table.code),
  index("idx_factories_active").on(table.isActive),
]);

export type Factory = typeof factories.$inferSelect;
export type InsertFactory = typeof factories.$inferInsert;

/**
 * Workshop - Nhà xưởng (thuộc Factory, 1-6 per factory)
 */
export const workshops = mysqlTable("workshops", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  floorArea: decimal("floorArea", { precision: 10, scale: 2 }), // Diện tích m2
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_workshops_factory").on(table.factoryId),
  index("idx_workshops_code").on(table.code),
]);

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
}, (table) => [
  index("idx_lines_workshop").on(table.workshopId),
  index("idx_lines_code").on(table.code),
]);

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
}, (table) => [
  index("idx_stations_line").on(table.lineId),
  index("idx_stations_code").on(table.code),
]);

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
  // Machine images for 2D/3D visualization
  image2DUrl: text("image2DUrl"), // Ảnh 2D của máy
  image2DKey: varchar("image2DKey", { length: 255 }),
  image3DUrl: text("image3DUrl"), // Ảnh 3D của máy
  image3DKey: varchar("image3DKey", { length: 255 }),
  isActive: boolean("isActive").default(true).notNull(),
  lastHeartbeat: timestamp("lastHeartbeat"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_machines_station").on(table.stationId),
  index("idx_machines_code").on(table.code),
  index("idx_machines_apikey").on(table.apiKey),
]);

export type Machine = typeof machines.$inferSelect;
export type InsertMachine = typeof machines.$inferInsert;

/**
 * Product Model - Mẫu sản phẩm với ảnh tham chiếu
 */
export const productModels = mysqlTable("product_models", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Product hierarchy
  category: varchar("category", { length: 100 }), // Product family/category
  productLine: varchar("productLine", { length: 100 }), // Product line
  variant: varchar("variant", { length: 100 }), // Product variant
  // Lifecycle status
  lifecycleStatus: mysqlEnum("lifecycleStatus", ["development", "active", "eol", "archived"]).default("active").notNull(),
  // Reference image
  referenceImageUrl: text("referenceImageUrl"), // Ảnh mẫu sản phẩm
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  imageWidth: int("imageWidth"), // Kích thước ảnh gốc
  imageHeight: int("imageHeight"),
  // Quality targets
  targetYieldRate: decimal("targetYieldRate", { precision: 5, scale: 2 }), // Target FPY %
  minYieldRate: decimal("minYieldRate", { precision: 5, scale: 2 }), // Minimum acceptable FPY %
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_product_models_code").on(table.code),
  index("idx_product_models_category").on(table.category),
  index("idx_product_models_lifecycle").on(table.lifecycleStatus),
]);

export type ProductModel = typeof productModels.$inferSelect;
export type InsertProductModel = typeof productModels.$inferInsert;

/**
 * Measurement Point Definition - Định nghĩa điểm đo với tọa độ trên ảnh mẫu
 * Mỗi sản phẩm có thể có 30-50 điểm đo
 */
export const measurementPointDefs = mysqlTable("measurement_point_defs", {
  id: int("id").autoincrement().primaryKey(),
  productModelId: int("productModelId").notNull(), // Liên kết với Product Model
  machineId: int("machineId"), // Optional: máy cụ thể sử dụng điểm đo này
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  measurementType: mysqlEnum("measurementType", ["DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"]).notNull(),
  unit: varchar("unit", { length: 20 }),
  lowerLimit: decimal("lowerLimit", { precision: 15, scale: 6 }),
  upperLimit: decimal("upperLimit", { precision: 15, scale: 6 }),
  nominalValue: decimal("nominalValue", { precision: 15, scale: 6 }),
  // Tọa độ điểm đo trên ảnh mẫu (vẽ đường tròn)
  positionX: int("positionX").notNull(), // Tâm X của đường tròn
  positionY: int("positionY").notNull(), // Tâm Y của đường tròn
  radius: int("radius").default(20).notNull(), // Bán kính đường tròn
  // Ảnh mẫu riêng cho điểm đo này (crop từ ảnh sản phẩm)
  referenceImageUrl: text("referenceImageUrl"),
  referenceImageKey: varchar("referenceImageKey", { length: 255 }),
  orderIndex: int("orderIndex").default(0).notNull(), // Thứ tự điểm đo
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_point_defs_product").on(table.productModelId),
  index("idx_point_defs_machine").on(table.machineId),
  index("idx_point_defs_code").on(table.code),
]);

export type MeasurementPointDef = typeof measurementPointDefs.$inferSelect;
export type InsertMeasurementPointDef = typeof measurementPointDefs.$inferInsert;

/**
 * Product Inspection - Kết quả kiểm tra sản phẩm
 */
export const productInspections = mysqlTable("product_inspections", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  productModelId: int("productModelId"), // Liên kết với Product Model
  serialNumber: varchar("serialNumber", { length: 100 }).notNull(),
  productModel: varchar("productModel", { length: 100 }), // Backward compatibility
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
}, (table) => [
  index("idx_inspections_machine").on(table.machineId),
  index("idx_inspections_serial").on(table.serialNumber),
  index("idx_inspections_time").on(table.inspectionTime),
  index("idx_inspections_result").on(table.overallResult),
  index("idx_inspections_product_model").on(table.productModelId),
  // Composite index for common queries
  index("idx_inspections_machine_time").on(table.machineId, table.inspectionTime),
]);

export type ProductInspection = typeof productInspections.$inferSelect;
export type InsertProductInspection = typeof productInspections.$inferInsert;

/**
 * Measurement Result - Kết quả đo thực tế
 */
export const measurementResults = mysqlTable("measurement_results", {
  id: int("id").autoincrement().primaryKey(),
  inspectionId: int("inspectionId").notNull(),
  pointDefId: int("pointDefId").notNull(),
  measuredValue: decimal("measuredValue", { precision: 15, scale: 6 }),
  measuredValueText: varchar("measuredValueText", { length: 255 }), // Giá trị dạng text
  result: mysqlEnum("result", ["OK", "NG", "NTF"]).notNull(),
  imageUrl: text("imageUrl"), // Ảnh thực tế của điểm đo
  imageKey: varchar("imageKey", { length: 255 }),
  remark: text("remark"),
  aiAnalysisResult: text("aiAnalysisResult"), // Kết quả phân tích AI
  aiConfidence: decimal("aiConfidence", { precision: 5, scale: 4 }),
  aiComparisonScore: decimal("aiComparisonScore", { precision: 5, scale: 4 }), // Điểm so sánh với ảnh mẫu
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_results_inspection").on(table.inspectionId),
  index("idx_results_point").on(table.pointDefId),
  index("idx_results_result").on(table.result),
]);

export type MeasurementResult = typeof measurementResults.$inferSelect;
export type InsertMeasurementResult = typeof measurementResults.$inferInsert;

/**
 * Factory Layout - Layout nhà xưởng cho visualization
 * Hỗ trợ cả 2D và 3D cho quy mô tập đoàn
 */
export const factoryLayouts = mysqlTable("factory_layouts", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId"), // Layout cấp nhà máy
  workshopId: int("workshopId"), // Layout cấp nhà xưởng
  layoutLevel: mysqlEnum("layoutLevel", ["CORPORATION", "FACTORY", "WORKSHOP"]).default("WORKSHOP").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  layoutType: mysqlEnum("layoutType", ["2D", "3D"]).default("2D").notNull(),
  layoutData: text("layoutData"), // JSON data for layout configuration
  width: int("width").default(1000).notNull(),
  height: int("height").default(800).notNull(),
  depth: int("depth").default(500), // Cho 3D
  backgroundImageUrl: text("backgroundImageUrl"),
  model3dUrl: text("model3dUrl"), // URL model 3D
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
export const machinePositions = mysqlTable("machine_positions", {
  id: int("id").autoincrement().primaryKey(),
  layoutId: int("layoutId").notNull(),
  machineId: int("machineId").notNull(),
  positionX: int("positionX").notNull(),
  positionY: int("positionY").notNull(),
  positionZ: int("positionZ").default(0), // Cho 3D
  width: int("width").default(100).notNull(),
  height: int("height").default(80).notNull(),
  depth: int("depth").default(60), // Cho 3D
  rotation: int("rotation").default(0),
  rotationY: int("rotationY").default(0), // Cho 3D
  rotationZ: int("rotationZ").default(0), // Cho 3D
  scale: decimal("scale", { precision: 5, scale: 2 }).default("1.00"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_positions_layout").on(table.layoutId),
  index("idx_positions_machine").on(table.machineId),
]);

export type MachinePosition = typeof machinePositions.$inferSelect;
export type InsertMachinePosition = typeof machinePositions.$inferInsert;

/**
 * Daily Statistics - Thống kê theo ngày cho performance
 * Tối ưu cho truy vấn nhanh với quy mô lớn
 */
export const dailyStatistics = mysqlTable("daily_statistics", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  factoryId: int("factoryId").notNull(), // Denormalized for fast queries
  workshopId: int("workshopId").notNull(), // Denormalized for fast queries
  date: timestamp("date").notNull(),
  totalCount: int("totalCount").default(0).notNull(),
  okCount: int("okCount").default(0).notNull(),
  ngCount: int("ngCount").default(0).notNull(),
  ntfCount: int("ntfCount").default(0).notNull(),
  yieldRate: decimal("yieldRate", { precision: 5, scale: 2 }),
  avgCycleTime: decimal("avgCycleTime", { precision: 10, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_stats_machine_date").on(table.machineId, table.date),
  index("idx_stats_factory_date").on(table.factoryId, table.date),
  index("idx_stats_workshop_date").on(table.workshopId, table.date),
  index("idx_stats_date").on(table.date),
]);

export type DailyStatistics = typeof dailyStatistics.$inferSelect;
export type InsertDailyStatistics = typeof dailyStatistics.$inferInsert;

/**
 * Workshop Position - Vị trí nhà xưởng trên layout nhà máy
 */
export const workshopPositions = mysqlTable("workshop_positions", {
  id: int("id").autoincrement().primaryKey(),
  layoutId: int("layoutId").notNull(), // Layout cấp nhà máy
  workshopId: int("workshopId").notNull(),
  positionX: int("positionX").notNull(),
  positionY: int("positionY").notNull(),
  positionZ: int("positionZ").default(0),
  width: int("width").default(200).notNull(),
  height: int("height").default(150).notNull(),
  depth: int("depth").default(100),
  rotation: int("rotation").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_ws_positions_layout").on(table.layoutId),
  index("idx_ws_positions_workshop").on(table.workshopId),
]);

export type WorkshopPosition = typeof workshopPositions.$inferSelect;
export type InsertWorkshopPosition = typeof workshopPositions.$inferInsert;

/**
 * Factory Position - Vị trí nhà máy trên layout tập đoàn
 */
export const factoryPositions = mysqlTable("factory_positions", {
  id: int("id").autoincrement().primaryKey(),
  layoutId: int("layoutId").notNull(), // Layout cấp tập đoàn
  factoryId: int("factoryId").notNull(),
  positionX: int("positionX").notNull(),
  positionY: int("positionY").notNull(),
  positionZ: int("positionZ").default(0),
  width: int("width").default(300).notNull(),
  height: int("height").default(200).notNull(),
  depth: int("depth").default(150),
  rotation: int("rotation").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_fac_positions_layout").on(table.layoutId),
  index("idx_fac_positions_factory").on(table.factoryId),
]);

export type FactoryPosition = typeof factoryPositions.$inferSelect;
export type InsertFactoryPosition = typeof factoryPositions.$inferInsert;

/**
 * Alert Settings - Cấu hình cảnh báo
 */
export const alertSettings = mysqlTable("alert_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // Người tạo cảnh báo
  name: varchar("name", { length: 255 }).notNull(),
  alertType: mysqlEnum("alertType", ["yield_rate", "ng_count", "machine_status"]).notNull(),
  threshold: decimal("threshold", { precision: 10, scale: 2 }).notNull(), // Ngưỡng cảnh báo
  comparisonOperator: mysqlEnum("comparisonOperator", ["lt", "lte", "gt", "gte", "eq"]).default("lt").notNull(),
  machineId: int("machineId"), // Null = tất cả máy
  factoryId: int("factoryId"), // Null = tất cả nhà máy
  isActive: boolean("isActive").default(true).notNull(),
  notifyEmail: boolean("notifyEmail").default(true).notNull(),
  notifySms: boolean("notifySms").default(false).notNull(),
  notifyInApp: boolean("notifyInApp").default(true).notNull(),
  cooldownMinutes: int("cooldownMinutes").default(60).notNull(), // Thời gian chờ giữa các cảnh báo
  lastTriggeredAt: timestamp("lastTriggeredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_alert_user").on(table.userId),
  index("idx_alert_active").on(table.isActive),
  index("idx_alert_type").on(table.alertType),
]);

export type AlertSetting = typeof alertSettings.$inferSelect;
export type InsertAlertSetting = typeof alertSettings.$inferInsert;

/**
 * Alert History - Lịch sử cảnh báo đã gửi
 */
export const alertHistory = mysqlTable("alert_history", {
  id: int("id").autoincrement().primaryKey(),
  alertSettingId: int("alertSettingId").notNull(),
  triggeredValue: decimal("triggeredValue", { precision: 10, scale: 2 }).notNull(),
  message: text("message").notNull(),
  sentEmail: boolean("sentEmail").default(false).notNull(),
  sentSms: boolean("sentSms").default(false).notNull(),
  sentInApp: boolean("sentInApp").default(false).notNull(),
  acknowledgedAt: timestamp("acknowledgedAt"),
  acknowledgedBy: int("acknowledgedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_alert_history_setting").on(table.alertSettingId),
  index("idx_alert_history_created").on(table.createdAt),
]);

export type AlertHistory = typeof alertHistory.$inferSelect;
export type InsertAlertHistory = typeof alertHistory.$inferInsert;


/**
 * Product-Machine Mapping - Gán sản phẩm cho máy
 * Một máy có thể kiểm tra nhiều sản phẩm, một sản phẩm có thể được kiểm tra trên nhiều máy
 */
export const productMachineMappings = mysqlTable("product_machine_mappings", {
  id: int("id").autoincrement().primaryKey(),
  productModelId: int("productModelId").notNull(),
  machineId: int("machineId").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  priority: int("priority").default(0).notNull(), // Ưu tiên sản phẩm trên máy
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_pm_mapping_product").on(table.productModelId),
  index("idx_pm_mapping_machine").on(table.machineId),
]);

export type ProductMachineMapping = typeof productMachineMappings.$inferSelect;
export type InsertProductMachineMapping = typeof productMachineMappings.$inferInsert;

/**
 * Shift Configuration - Cấu hình ca làm việc
 */
export const shiftConfigs = mysqlTable("shift_configs", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId"), // Null = áp dụng toàn hệ thống
  name: varchar("name", { length: 100 }).notNull(),
  code: varchar("code", { length: 20 }).notNull(),
  startHour: int("startHour").notNull(), // 0-23
  startMinute: int("startMinute").default(0).notNull(),
  endHour: int("endHour").notNull(), // 0-23
  endMinute: int("endMinute").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  orderIndex: int("orderIndex").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_shift_factory").on(table.factoryId),
  index("idx_shift_code").on(table.code),
]);

export type ShiftConfig = typeof shiftConfigs.$inferSelect;
export type InsertShiftConfig = typeof shiftConfigs.$inferInsert;


/**
 * Production Order - Lệnh sản xuất
 */
export const productionOrders = mysqlTable("production_orders", {
  id: int("id").autoincrement().primaryKey(),
  orderCode: varchar("orderCode", { length: 100 }).notNull().unique(), // Mã lệnh sản xuất
  companyCode: varchar("companyCode", { length: 50 }).notNull(), // Mã công ty
  factoryId: int("factoryId").notNull(), // Nhà máy
  workshopId: int("workshopId").notNull(), // Nhà xưởng
  lineId: int("lineId").notNull(), // Dây chuyền sản xuất
  productModelId: int("productModelId").notNull(), // Sản phẩm
  targetQuantity: int("targetQuantity").notNull(), // Số lượng mục tiêu
  completedQuantity: int("completedQuantity").default(0).notNull(), // Số lượng đã hoàn thành
  okQuantity: int("okQuantity").default(0).notNull(), // Số lượng OK
  ngQuantity: int("ngQuantity").default(0).notNull(), // Số lượng NG
  ntfQuantity: int("ntfQuantity").default(0).notNull(), // Số lượng NTF
  status: mysqlEnum("status", ["pending", "in_progress", "completed", "cancelled", "paused"]).default("pending").notNull(),
  priority: int("priority").default(0).notNull(), // Độ ưu tiên
  plannedStartDate: timestamp("plannedStartDate"),
  plannedEndDate: timestamp("plannedEndDate"),
  actualStartDate: timestamp("actualStartDate"),
  actualEndDate: timestamp("actualEndDate"),
  notes: text("notes"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_po_order_code").on(table.orderCode),
  index("idx_po_company").on(table.companyCode),
  index("idx_po_factory").on(table.factoryId),
  index("idx_po_workshop").on(table.workshopId),
  index("idx_po_line").on(table.lineId),
  index("idx_po_product").on(table.productModelId),
  index("idx_po_status").on(table.status),
]);

export type ProductionOrder = typeof productionOrders.$inferSelect;
export type InsertProductionOrder = typeof productionOrders.$inferInsert;

/**
 * Line Stage - Công đoạn trên dây chuyền (A, B, C...)
 */
export const lineStages = mysqlTable("line_stages", {
  id: int("id").autoincrement().primaryKey(),
  lineId: int("lineId").notNull(), // Dây chuyền
  code: varchar("code", { length: 20 }).notNull(), // A, B, C...
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  orderIndex: int("orderIndex").default(0).notNull(), // Thứ tự công đoạn
  stationId: int("stationId"), // Liên kết với station (optional)
  cycleTimeTarget: decimal("cycleTimeTarget", { precision: 10, scale: 2 }), // Thời gian chu kỳ mục tiêu (giây)
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_stage_line").on(table.lineId),
  index("idx_stage_code").on(table.code),
  index("idx_stage_station").on(table.stationId),
]);

export type LineStage = typeof lineStages.$inferSelect;
export type InsertLineStage = typeof lineStages.$inferInsert;

/**
 * Line Product Assignment - Gán sản phẩm cho dây chuyền (thay thế machine mapping)
 */
export const lineProductAssignments = mysqlTable("line_product_assignments", {
  id: int("id").autoincrement().primaryKey(),
  lineId: int("lineId").notNull(), // Dây chuyền
  productModelId: int("productModelId").notNull(), // Sản phẩm
  productionOrderId: int("productionOrderId"), // Lệnh sản xuất (optional)
  isActive: boolean("isActive").default(true).notNull(),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_lpa_line").on(table.lineId),
  index("idx_lpa_product").on(table.productModelId),
  index("idx_lpa_order").on(table.productionOrderId),
]);

export type LineProductAssignment = typeof lineProductAssignments.$inferSelect;
export type InsertLineProductAssignment = typeof lineProductAssignments.$inferInsert;
