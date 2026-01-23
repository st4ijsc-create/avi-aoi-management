import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, bigint, index, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 100 }).unique(), // For local auth
  passwordHash: varchar("passwordHash", { length: 255 }), // For local auth (bcrypt hash)
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }), // Số điện thoại
  department: varchar("department", { length: 100 }), // Phòng ban
  position: varchar("position", { length: 100 }), // Chức vụ
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  isActive: boolean("isActive").default(true).notNull(), // Trạng thái tài khoản
  twoFactorSecret: varchar("two_factor_secret", { length: 255 }), // TOTP secret for 2FA
  twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(), // 2FA enabled flag
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, (table) => [
  index("idx_users_username").on(table.username),
  index("idx_users_email").on(table.email),
  index("idx_users_active").on(table.isActive),
]);

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
  mapPositionX: decimal("mapPositionX", { precision: 10, scale: 4 }), // Vị trí X trên bản đồ (0-1)
  mapPositionY: decimal("mapPositionY", { precision: 10, scale: 4 }), // Vị trí Y trên bản đồ (0-1)
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
  // Layout position for drag & drop
  layoutPositionX: decimal("layoutPositionX", { precision: 10, scale: 4 }), // Vị trí X trong Layout (0-1)
  layoutPositionY: decimal("layoutPositionY", { precision: 10, scale: 4 }), // Vị trí Y trong Layout (0-1)
  isActive: boolean("isActive").default(true).notNull(),
  lastHeartbeat: timestamp("lastHeartbeat"),
  operationStatus: mysqlEnum("operationStatus", ["running", "stopped", "error", "maintenance"]).default("stopped").notNull(),
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
  // Kích thước vùng cắt ảnh mẫu (tâm là positionX, positionY)
  cropWidth: int("cropWidth").default(100).notNull(), // Chiều rộng vùng cắt
  cropHeight: int("cropHeight").default(100).notNull(), // Chiều cao vùng cắt
  orderIndex: int("orderIndex").default(0).notNull(), // Thứ tự điểm đo
  workstationId: int("workstationId"), // Công trạm thực hiện sản xuất điểm đo này
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
  corporateCode: varchar("corporateCode", { length: 50 }), // Mã tập đoàn
  factoryCode: varchar("factoryCode", { length: 50 }), // Mã nhà máy
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
  index("idx_inspections_corporate").on(table.corporateCode),
  index("idx_inspections_factory").on(table.factoryCode),
  // Composite index for common queries
  index("idx_inspections_machine_time").on(table.machineId, table.inspectionTime),
  index("idx_inspections_corporate_factory").on(table.corporateCode, table.factoryCode),
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
  alertType: mysqlEnum("alertType", ["yield_rate", "ng_count", "machine_status", "machine_offline"]).notNull(),
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


/**
 * Machine Status Logs - Lịch sử trạng thái kết nối máy
 */
export const machineStatusLogs = mysqlTable("machine_status_logs", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  status: mysqlEnum("status", ["online", "offline"]).notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  duration: int("duration"),
  notificationSent: boolean("notificationSent").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_status_logs_machine").on(table.machineId),
  index("idx_status_logs_timestamp").on(table.timestamp),
  index("idx_status_logs_status").on(table.status),
]);

export type MachineStatusLog = typeof machineStatusLogs.$inferSelect;
export type InsertMachineStatusLog = typeof machineStatusLogs.$inferInsert;

/**
 * Machine Heartbeat History - Lịch sử heartbeat chi tiết
 */
export const machineHeartbeats = mysqlTable("machine_heartbeats", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  status: mysqlEnum("status", ["running", "stopped", "error", "maintenance"]).default("running").notNull(),
  cpuUsage: decimal("cpuUsage", { precision: 5, scale: 2 }),
  memoryUsage: decimal("memoryUsage", { precision: 5, scale: 2 }),
  diskUsage: decimal("diskUsage", { precision: 5, scale: 2 }),
  temperature: decimal("temperature", { precision: 5, scale: 2 }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_heartbeats_machine").on(table.machineId),
  index("idx_heartbeats_timestamp").on(table.timestamp),
]);

export type MachineHeartbeat = typeof machineHeartbeats.$inferSelect;
export type InsertMachineHeartbeat = typeof machineHeartbeats.$inferInsert;


/**
 * Manual Machine Connections - Cấu hình kết nối máy thủ công qua IP:Port
 * Cho phép admin cấu hình kết nối socket đến máy mà không cần máy tự đăng ký
 */
export const manualMachineConnections = mysqlTable("manual_machine_connections", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }).notNull(), // IPv4 hoặc IPv6
  port: int("port").notNull().default(8080),
  protocol: mysqlEnum("protocol", ["websocket", "tcp", "http"]).default("websocket").notNull(),
  isEnabled: boolean("isEnabled").default(true).notNull(),
  lastConnectionAttempt: timestamp("lastConnectionAttempt"),
  lastSuccessfulConnection: timestamp("lastSuccessfulConnection"),
  connectionStatus: mysqlEnum("connectionStatus", ["connected", "disconnected", "error", "pending"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  retryCount: int("retryCount").default(0).notNull(),
  maxRetries: int("maxRetries").default(5).notNull(),
  retryIntervalSeconds: int("retryIntervalSeconds").default(30).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_manual_conn_machine").on(table.machineId),
  index("idx_manual_conn_ip").on(table.ipAddress),
  index("idx_manual_conn_status").on(table.connectionStatus),
]);

export type ManualMachineConnection = typeof manualMachineConnections.$inferSelect;
export type InsertManualMachineConnection = typeof manualMachineConnections.$inferInsert;


/**
 * Yield Alert Thresholds - Ngưỡng cảnh báo Yield
 */
export const yieldAlertThresholds = mysqlTable("yield_alert_thresholds", {
  id: int("id").autoincrement().primaryKey(),
  metricType: mysqlEnum("metricType", ["FPY", "FY", "NTF", "UPH"]).notNull(),
  warningThreshold: decimal("warningThreshold", { precision: 10, scale: 4 }).notNull(), // Ngưỡng cảnh báo
  criticalThreshold: decimal("criticalThreshold", { precision: 10, scale: 4 }).notNull(), // Ngưỡng nghiêm trọng
  targetValue: decimal("targetValue", { precision: 10, scale: 4 }), // Giá trị mục tiêu
  comparisonOperator: mysqlEnum("comparisonOperator", ["gt", "lt", "gte", "lte"]).default("gte").notNull(), // Toán tử so sánh
  isEnabled: boolean("isEnabled").default(true).notNull(),
  notifyOnWarning: boolean("notifyOnWarning").default(true).notNull(),
  notifyOnCritical: boolean("notifyOnCritical").default(true).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_yield_thresholds_type").on(table.metricType),
  index("idx_yield_thresholds_enabled").on(table.isEnabled),
]);

export type YieldAlertThreshold = typeof yieldAlertThresholds.$inferSelect;
export type InsertYieldAlertThreshold = typeof yieldAlertThresholds.$inferInsert;


/**
 * Yield Threshold History - Lịch sử thay đổi ngưỡng cảnh báo
 */
export const yieldThresholdHistory = mysqlTable("yield_threshold_history", {
  id: int("id").autoincrement().primaryKey(),
  thresholdId: int("thresholdId").notNull(), // Reference to yieldAlertThresholds
  metricType: mysqlEnum("metricType", ["FPY", "FY", "NTF", "UPH"]).notNull(),
  previousWarning: decimal("previousWarning", { precision: 10, scale: 4 }),
  newWarning: decimal("newWarning", { precision: 10, scale: 4 }).notNull(),
  previousCritical: decimal("previousCritical", { precision: 10, scale: 4 }),
  newCritical: decimal("newCritical", { precision: 10, scale: 4 }).notNull(),
  previousTarget: decimal("previousTarget", { precision: 10, scale: 4 }),
  newTarget: decimal("newTarget", { precision: 10, scale: 4 }),
  changeReason: text("changeReason"),
  changedBy: int("changedBy"), // User ID who made the change
  changedByName: varchar("changedByName", { length: 255 }),
  // Performance metrics at time of change
  actualValueAtChange: decimal("actualValueAtChange", { precision: 10, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_threshold_history_threshold").on(table.thresholdId),
  index("idx_threshold_history_type").on(table.metricType),
  index("idx_threshold_history_date").on(table.createdAt),
]);

export type YieldThresholdHistory = typeof yieldThresholdHistory.$inferSelect;
export type InsertYieldThresholdHistory = typeof yieldThresholdHistory.$inferInsert;


/**
 * Audit Logs - Lịch sử hoạt động hệ thống
 */
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"), // Null for system actions or failed logins
  userName: varchar("userName", { length: 255 }), // Store name at time of action
  action: varchar("action", { length: 100 }).notNull(), // login, logout, create, update, delete, etc.
  entityType: varchar("entityType", { length: 100 }), // user, machine, product, inspection, etc.
  entityId: int("entityId"), // ID of affected entity
  entityName: varchar("entityName", { length: 255 }), // Name of affected entity for display
  details: text("details"), // JSON string with additional details
  ipAddress: varchar("ipAddress", { length: 45 }), // IPv4 or IPv6
  userAgent: varchar("userAgent", { length: 500 }),
  status: mysqlEnum("status", ["success", "failure"]).default("success").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_logs_user").on(table.userId),
  index("idx_audit_logs_action").on(table.action),
  index("idx_audit_logs_entity").on(table.entityType, table.entityId),
  index("idx_audit_logs_created").on(table.createdAt),
]);
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;


/**
 * Backup Codes - Mã dự phòng cho 2FA recovery
 */
export const backupCodes = mysqlTable("backup_codes", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  code: varchar("code", { length: 20 }).notNull(), // Hashed backup code
  isUsed: boolean("isUsed").default(false).notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_backup_codes_user").on(table.userId),
  index("idx_backup_codes_code").on(table.code),
]);
export type BackupCode = typeof backupCodes.$inferSelect;
export type InsertBackupCode = typeof backupCodes.$inferInsert;

/**
 * User Sessions - Quản lý phiên đăng nhập
 */
export const userSessions = mysqlTable("user_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sessionToken: varchar("sessionToken", { length: 255 }).notNull().unique(),
  deviceName: varchar("deviceName", { length: 255 }), // Browser/Device name
  deviceType: varchar("deviceType", { length: 50 }), // desktop, mobile, tablet
  browser: varchar("browser", { length: 100 }), // Chrome, Firefox, Safari
  os: varchar("os", { length: 100 }), // Windows, macOS, Linux, iOS, Android
  ipAddress: varchar("ipAddress", { length: 45 }),
  location: varchar("location", { length: 255 }), // City, Country
  isActive: boolean("isActive").default(true).notNull(),
  lastActivityAt: timestamp("lastActivityAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_user_sessions_user").on(table.userId),
  index("idx_user_sessions_token").on(table.sessionToken),
  index("idx_user_sessions_active").on(table.isActive),
  index("idx_user_sessions_expires").on(table.expiresAt),
]);
export type UserSession = typeof userSessions.$inferSelect;
export type InsertUserSession = typeof userSessions.$inferInsert;

/**
 * System Settings - Cài đặt hệ thống
 */
export const systemSettings = mysqlTable("system_settings", {
  id: int("id").autoincrement().primaryKey(),
  settingKey: varchar("settingKey", { length: 100 }).notNull().unique(),
  settingValue: text("settingValue"),
  description: text("description"),
  category: varchar("category", { length: 50 }), // security, general, notification
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_system_settings_key").on(table.settingKey),
  index("idx_system_settings_category").on(table.category),
]);
export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;


/**
 * Workstations - Công trạm sản xuất
 * Mỗi điểm kiểm tra của máy AVI/AOI được thực hiện bởi một công trạm trước đó
 */
export const workstations = mysqlTable("workstations", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  lineId: int("lineId"), // Thuộc dây chuyền nào
  workshopId: int("workshopId"), // Thuộc xưởng nào
  factoryId: int("factoryId"), // Thuộc nhà máy nào
  processType: mysqlEnum("processType", ["SMT", "DIP", "ASSEMBLY", "TESTING", "PACKAGING", "OTHER"]).default("OTHER"),
  orderIndex: int("orderIndex").default(0).notNull(), // Thứ tự trong dây chuyền
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_workstations_code").on(table.code),
  index("idx_workstations_line").on(table.lineId),
  index("idx_workstations_workshop").on(table.workshopId),
  index("idx_workstations_factory").on(table.factoryId),
]);
export type Workstation = typeof workstations.$inferSelect;
export type InsertWorkstation = typeof workstations.$inferInsert;


/**
 * Measurement Point Template - Mẫu điểm đo có thể tái sử dụng
 */
export const measurementPointTemplates = mysqlTable("measurement_point_templates", {
  id: int("id").autoincrement().primaryKey(),
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
  pointCount: int("pointCount").notNull(), // Số lượng điểm đo
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_templates_code").on(table.code),
  index("idx_templates_category").on(table.category),
  index("idx_templates_active").on(table.isActive),
]);

export type MeasurementPointTemplate = typeof measurementPointTemplates.$inferSelect;
export type InsertMeasurementPointTemplate = typeof measurementPointTemplates.$inferInsert;


/**
 * Scheduled Reports - Báo cáo tự động theo lịch
 */
export const scheduledReports = mysqlTable("scheduled_reports", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  reportType: mysqlEnum("reportType", ["NG_VISUAL", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY", "CUSTOM"]).default("NG_VISUAL").notNull(),
  schedule: mysqlEnum("schedule", ["DAILY", "WEEKLY", "MONTHLY"]).default("DAILY").notNull(),
  scheduleTime: varchar("scheduleTime", { length: 10 }).default("08:00").notNull(), // HH:mm format
  scheduleDayOfWeek: int("scheduleDayOfWeek"), // 0-6 for weekly (0=Sunday)
  scheduleDayOfMonth: int("scheduleDayOfMonth"), // 1-31 for monthly
  recipients: json("recipients").$type<string[]>().notNull(), // Array of email addresses
  factoryId: int("factoryId"), // Optional filter by factory
  workshopId: int("workshopId"), // Optional filter by workshop
  lineId: int("lineId"), // Optional filter by line
  includeWorkstationHeatmap: boolean("includeWorkstationHeatmap").default(true).notNull(),
  includeTopNGPoints: boolean("includeTopNGPoints").default(true).notNull(),
  includeTrendChart: boolean("includeTrendChart").default(true).notNull(),
  includeComparison: boolean("includeComparison").default(true).notNull(),
  // Report Customization
  reportFormat: mysqlEnum("reportFormat", ["HTML", "PDF", "EXCEL"]).default("HTML").notNull(),
  logoUrl: varchar("logoUrl", { length: 500 }), // Custom logo URL
  primaryColor: varchar("primaryColor", { length: 20 }).default("#3b82f6"), // Primary color for email
  footerText: text("footerText"), // Custom footer text
  isActive: boolean("isActive").default(true).notNull(),
  lastSentAt: timestamp("lastSentAt"),
  nextScheduledAt: timestamp("nextScheduledAt"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_scheduled_reports_type").on(table.reportType),
  index("idx_scheduled_reports_schedule").on(table.schedule),
  index("idx_scheduled_reports_active").on(table.isActive),
  index("idx_scheduled_reports_next").on(table.nextScheduledAt),
  index("idx_scheduled_reports_factory").on(table.factoryId),
]);

export type ScheduledReport = typeof scheduledReports.$inferSelect;
export type InsertScheduledReport = typeof scheduledReports.$inferInsert;

/**
 * Scheduled Report Logs - Lịch sử gửi báo cáo
 */
export const scheduledReportLogs = mysqlTable("scheduled_report_logs", {
  id: int("id").autoincrement().primaryKey(),
  reportId: int("reportId").notNull(),
  status: mysqlEnum("status", ["SUCCESS", "FAILED", "PENDING"]).default("PENDING").notNull(),
  recipientCount: int("recipientCount").default(0).notNull(),
  successCount: int("successCount").default(0).notNull(),
  failedCount: int("failedCount").default(0).notNull(),
  errorMessage: text("errorMessage"),
  reportData: json("reportData"), // Snapshot of report data at time of sending
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_report_logs_report").on(table.reportId),
  index("idx_report_logs_status").on(table.status),
  index("idx_report_logs_sent").on(table.sentAt),
]);

export type ScheduledReportLog = typeof scheduledReportLogs.$inferSelect;
export type InsertScheduledReportLog = typeof scheduledReportLogs.$inferInsert;

// SMTP Configuration Table
export const smtpConfig = mysqlTable("smtp_config", {
  id: int("id").primaryKey().autoincrement(),
  host: varchar("host", { length: 255 }).notNull(),
  port: int("port").notNull().default(587),
  secure: boolean("secure").notNull().default(false), // true for 465, false for other ports
  username: varchar("username", { length: 255 }).notNull(),
  password: text("password").notNull(), // Encrypted
  fromEmail: varchar("from_email", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }).notNull().default("AVI/AOI Management System"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export type SmtpConfig = typeof smtpConfig.$inferSelect;
export type InsertSmtpConfig = typeof smtpConfig.$inferInsert;


// ============= MQTT Client Management =============

/**
 * MQTT Clients - Quản lý các thiết bị client (Android/Tablet) kết nối qua MQTT
 */
export const mqttClients = mysqlTable("mqtt_clients", {
  id: int("id").autoincrement().primaryKey(),
  clientId: varchar("clientId", { length: 128 }).notNull().unique(), // MQTT client ID
  deviceId: varchar("deviceId", { length: 128 }).notNull().unique(), // Unique device identifier (Android ID)
  deviceName: varchar("deviceName", { length: 255 }), // Tên thiết bị do user đặt
  deviceModel: varchar("deviceModel", { length: 100 }), // Model thiết bị (Samsung, Xiaomi, etc.)
  osVersion: varchar("osVersion", { length: 50 }), // Android version
  appVersion: varchar("appVersion", { length: 50 }), // App version
  // Mapping to station
  stationId: int("stationId"), // Công trạm được gán
  processId: int("processId"), // Công đoạn được gán (optional, for filtering)
  // Approval status
  approvalStatus: mysqlEnum("approvalStatus", ["PENDING", "APPROVED", "REJECTED"]).default("PENDING").notNull(),
  approvedBy: int("approvedBy"), // User ID who approved
  approvedAt: timestamp("approvedAt"),
  rejectionReason: text("rejectionReason"),
  // Mapping type
  mappingType: mysqlEnum("mappingType", ["AUTO", "MANUAL"]).default("MANUAL").notNull(),
  autoReconnect: boolean("autoReconnect").default(true).notNull(), // Tự động kết nối lại khi disconnect
  // Connection status
  connectionStatus: mysqlEnum("connectionStatus", ["ONLINE", "OFFLINE", "DISCONNECTED"]).default("OFFLINE").notNull(),
  lastConnectedAt: timestamp("lastConnectedAt"),
  lastDisconnectedAt: timestamp("lastDisconnectedAt"),
  lastHeartbeat: timestamp("lastHeartbeat"),
  // Settings
  receiveNGAlerts: boolean("receiveNGAlerts").default(true).notNull(), // Nhận cảnh báo NG
  receiveDailySummary: boolean("receiveDailySummary").default(true).notNull(), // Nhận tổng hợp ngày
  receiveWeeklySummary: boolean("receiveWeeklySummary").default(true).notNull(), // Nhận tổng hợp tuần
  fcmToken: varchar("fcmToken", { length: 500 }), // Firebase Cloud Messaging token for push notifications
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_mqtt_clients_clientId").on(table.clientId),
  index("idx_mqtt_clients_deviceId").on(table.deviceId),
  index("idx_mqtt_clients_station").on(table.stationId),
  index("idx_mqtt_clients_approval").on(table.approvalStatus),
  index("idx_mqtt_clients_connection").on(table.connectionStatus),
  index("idx_mqtt_clients_active").on(table.isActive),
]);

export type MqttClient = typeof mqttClients.$inferSelect;
export type InsertMqttClient = typeof mqttClients.$inferInsert;

/**
 * MQTT Subscriptions - Các topic mà client đăng ký nhận
 */
export const mqttSubscriptions = mysqlTable("mqtt_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull(), // FK to mqtt_clients
  topic: varchar("topic", { length: 255 }).notNull(), // MQTT topic pattern
  qos: int("qos").default(1).notNull(), // Quality of Service (0, 1, 2)
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_subs_client").on(table.clientId),
  index("idx_mqtt_subs_topic").on(table.topic),
]);

export type MqttSubscription = typeof mqttSubscriptions.$inferSelect;
export type InsertMqttSubscription = typeof mqttSubscriptions.$inferInsert;

/**
 * MQTT Error Summary - Tổng hợp lỗi theo ngày/tuần cho từng điểm đo và trạm
 */
export const mqttErrorSummary = mysqlTable("mqtt_error_summary", {
  id: int("id").autoincrement().primaryKey(),
  summaryType: mysqlEnum("summaryType", ["DAILY", "WEEKLY"]).notNull(),
  summaryDate: timestamp("summaryDate").notNull(), // Ngày/tuần tổng hợp
  stationId: int("stationId").notNull(),
  processId: int("processId"), // Công đoạn (optional)
  measurementPointId: int("measurementPointId"), // Điểm đo cụ thể (optional)
  // Statistics
  totalInspections: int("totalInspections").default(0).notNull(),
  totalNG: int("totalNG").default(0).notNull(),
  totalNTF: int("totalNTF").default(0).notNull(),
  ngRate: decimal("ngRate", { precision: 5, scale: 2 }).default("0").notNull(),
  // Top NG points JSON
  topNGPoints: json("topNGPoints").$type<Array<{
    pointId: number;
    pointName: string;
    ngCount: number;
    percentage: number;
  }>>(),
  // Sent status
  sentToClients: boolean("sentToClients").default(false).notNull(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_error_summary_type").on(table.summaryType),
  index("idx_error_summary_date").on(table.summaryDate),
  index("idx_error_summary_station").on(table.stationId),
  index("idx_error_summary_sent").on(table.sentToClients),
]);

export type MqttErrorSummary = typeof mqttErrorSummary.$inferSelect;
export type InsertMqttErrorSummary = typeof mqttErrorSummary.$inferInsert;

/**
 * MQTT Message Log - Log các message đã gửi qua MQTT
 */
export const mqttMessageLogs = mysqlTable("mqtt_message_logs", {
  id: int("id").autoincrement().primaryKey(),
  messageType: mysqlEnum("messageType", ["NG_ALERT", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "CUSTOM"]).notNull(),
  topic: varchar("topic", { length: 255 }).notNull(),
  payload: json("payload").notNull(), // Message content
  targetClientId: int("targetClientId"), // Specific client (null = broadcast)
  stationId: int("stationId"), // Related station
  inspectionId: int("inspectionId"), // Related inspection (for NG alerts)
  deliveryStatus: mysqlEnum("deliveryStatus", ["PENDING", "DELIVERED", "FAILED"]).default("PENDING").notNull(),
  deliveredAt: timestamp("deliveredAt"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_logs_type").on(table.messageType),
  index("idx_mqtt_logs_topic").on(table.topic),
  index("idx_mqtt_logs_client").on(table.targetClientId),
  index("idx_mqtt_logs_station").on(table.stationId),
  index("idx_mqtt_logs_status").on(table.deliveryStatus),
  index("idx_mqtt_logs_created").on(table.createdAt),
]);

export type MqttMessageLog = typeof mqttMessageLogs.$inferSelect;
export type InsertMqttMessageLog = typeof mqttMessageLogs.$inferInsert;


/**
 * MQTT Alert Rules - Cấu hình cảnh báo cho MQTT
 */
export const mqttAlertRules = mysqlTable("mqtt_alert_rules", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(), // Tên rule
  description: text("description"), // Mô tả
  ruleType: mysqlEnum("ruleType", [
    "LATENCY_THRESHOLD",      // Latency vượt ngưỡng
    "BROKER_DISCONNECT",      // Broker bị disconnect
    "MESSAGE_FAILURE_RATE",   // Tỷ lệ message thất bại
    "THROUGHPUT_LOW",         // Throughput thấp
    "THROUGHPUT_HIGH",        // Throughput cao (có thể là spam)
    "CLIENT_OFFLINE"          // Client offline quá lâu
  ]).notNull(),
  // Threshold configuration
  thresholdValue: decimal("thresholdValue", { precision: 10, scale: 2 }).notNull(), // Giá trị ngưỡng
  thresholdUnit: varchar("thresholdUnit", { length: 50 }).default("ms").notNull(), // Đơn vị (ms, %, msg/min, minutes)
  comparisonOperator: mysqlEnum("comparisonOperator", ["GT", "GTE", "LT", "LTE", "EQ"]).default("GT").notNull(),
  // Time window for evaluation
  timeWindowMinutes: int("timeWindowMinutes").default(5).notNull(), // Khoảng thời gian đánh giá (phút)
  // Notification settings
  notifyOwner: boolean("notifyOwner").default(true).notNull(), // Gửi notification cho owner
  notifyEmail: boolean("notifyEmail").default(false).notNull(), // Gửi email
  notifyMqtt: boolean("notifyMqtt").default(false).notNull(), // Gửi qua MQTT
  // Cooldown to prevent spam
  cooldownMinutes: int("cooldownMinutes").default(15).notNull(), // Thời gian chờ giữa các alert
  lastTriggeredAt: timestamp("lastTriggeredAt"), // Lần trigger gần nhất
  // Status
  isEnabled: boolean("isEnabled").default(true).notNull(),
  createdBy: int("createdBy"), // FK to users
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_mqtt_alert_rules_type").on(table.ruleType),
  index("idx_mqtt_alert_rules_enabled").on(table.isEnabled),
]);

export type MqttAlertRule = typeof mqttAlertRules.$inferSelect;
export type InsertMqttAlertRule = typeof mqttAlertRules.$inferInsert;

/**
 * MQTT Alert History - Lịch sử các alert đã trigger
 */
export const mqttAlertHistory = mysqlTable("mqtt_alert_history", {
  id: int("id").autoincrement().primaryKey(),
  ruleId: int("ruleId").notNull(), // FK to mqtt_alert_rules
  ruleName: varchar("ruleName", { length: 255 }).notNull(), // Snapshot của tên rule
  ruleType: varchar("ruleType", { length: 50 }).notNull(), // Snapshot của loại rule
  // Alert details
  triggeredValue: decimal("triggeredValue", { precision: 10, scale: 2 }).notNull(), // Giá trị khi trigger
  thresholdValue: decimal("thresholdValue", { precision: 10, scale: 2 }).notNull(), // Ngưỡng đã set
  message: text("message").notNull(), // Nội dung alert
  // Notification status
  notificationSent: boolean("notificationSent").default(false).notNull(),
  notificationError: text("notificationError"),
  // Resolution
  isResolved: boolean("isResolved").default(false).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: int("resolvedBy"), // FK to users
  resolutionNote: text("resolutionNote"),
  // Timestamps
  triggeredAt: timestamp("triggeredAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_alert_history_rule").on(table.ruleId),
  index("idx_mqtt_alert_history_type").on(table.ruleType),
  index("idx_mqtt_alert_history_resolved").on(table.isResolved),
  index("idx_mqtt_alert_history_triggered").on(table.triggeredAt),
]);

export type MqttAlertHistory = typeof mqttAlertHistory.$inferSelect;
export type InsertMqttAlertHistory = typeof mqttAlertHistory.$inferInsert;


/**
 * System Configuration - Cấu hình hệ thống (Admin only)
 */
export const systemConfig = mysqlTable("system_config", {
  id: int("id").autoincrement().primaryKey(),
  configKey: varchar("configKey", { length: 100 }).notNull().unique(), // Unique key
  configValue: text("configValue").notNull(), // JSON or string value
  description: text("description"), // Mô tả cấu hình
  dataType: mysqlEnum("dataType", ["STRING", "NUMBER", "BOOLEAN", "JSON"]).default("STRING").notNull(),
  isEditable: boolean("isEditable").default(true).notNull(), // Có thể chỉnh sửa qua UI không
  requiresRestart: boolean("requiresRestart").default(false).notNull(), // Cần restart server sau khi thay đổi
  updatedBy: int("updatedBy"), // FK to users
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_system_config_key").on(table.configKey),
]);

export type SystemConfig = typeof systemConfig.$inferSelect;
export type InsertSystemConfig = typeof systemConfig.$inferInsert;


/**
 * User Corporate Assignments - Phân quyền user theo công ty
 */
export const userCorporateAssignments = mysqlTable("user_corporate_assignments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK to users
  corporateCode: varchar("corporateCode", { length: 50 }).notNull(),
  assignedBy: int("assignedBy"), // FK to users (admin who assigned)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_user_corporate_user").on(table.userId),
  index("idx_user_corporate_code").on(table.corporateCode),
  // Unique constraint: một user không thể được assign vào cùng một corporate 2 lần
  index("idx_user_corporate_unique").on(table.userId, table.corporateCode),
]);

export type UserCorporateAssignment = typeof userCorporateAssignments.$inferSelect;
export type InsertUserCorporateAssignment = typeof userCorporateAssignments.$inferInsert;

/**
 * User Factory Assignments - Phân quyền user theo nhà máy
 */
export const userFactoryAssignments = mysqlTable("user_factory_assignments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK to users
  factoryCode: varchar("factoryCode", { length: 50 }).notNull(),
  assignedBy: int("assignedBy"), // FK to users (admin who assigned)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_user_factory_user").on(table.userId),
  index("idx_user_factory_code").on(table.factoryCode),
  // Unique constraint: một user không thể được assign vào cùng một factory 2 lần
  index("idx_user_factory_unique").on(table.userId, table.factoryCode),
]);

export type UserFactoryAssignment = typeof userFactoryAssignments.$inferSelect;
export type InsertUserFactoryAssignment = typeof userFactoryAssignments.$inferInsert;
