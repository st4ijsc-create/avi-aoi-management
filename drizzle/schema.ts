import { pgTable, pgEnum, serial, integer, text, timestamp, varchar, decimal, boolean, bigint, index, json, uniqueIndex } from "drizzle-orm/pg-core";



// PostgreSQL Enum Definitions
export const roleEnum = pgEnum("roleenum", ["user", "admin"]);
export const machineTypeEnum = pgEnum("machinetypeenum", ["AVI", "AOI", "AUTOMATION"]);
export const operationStatusEnum = pgEnum("operationstatusenum", ["running", "stopped", "error", "maintenance"]);
export const lifecycleStatusEnum = pgEnum("lifecyclestatusenum", ["development", "active", "eol", "archived"]);
export const measurementTypeEnum = pgEnum("measurementtypeenum", ["DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"]);
export const overallResultEnum = pgEnum("overallresultenum", ["OK", "NG", "NTF"]);
export const originalResultEnum = pgEnum("originalresultenum", ["OK", "NG"]);
export const layoutLevelEnum = pgEnum("layoutlevelenum", ["CORPORATION", "FACTORY", "WORKSHOP"]);
export const layoutTypeEnum = pgEnum("layouttypeenum", ["2D", "3D"]);
export const alertTypeEnum = pgEnum("alerttypeenum", ["yield_rate", "ng_count", "machine_status", "machine_offline"]);
export const comparisonOperatorEnum = pgEnum("comparisonoperatorenum", ["lt", "lte", "gt", "gte", "eq"]);
export const statusEnum = pgEnum("statusenum", ["pending", "in_progress", "completed", "cancelled", "paused"]);
export const statusEnum_1 = pgEnum("statusenum_1", ["online", "offline"]);
export const protocolEnum = pgEnum("protocolenum", ["websocket", "tcp", "http"]);
export const connectionStatusEnum = pgEnum("connectionstatusenum", ["connected", "disconnected", "error", "pending"]);
export const metricTypeEnum = pgEnum("metrictypeenum", ["FPY", "FY", "NTF", "UPH"]);
export const comparisonOperatorEnum_1 = pgEnum("comparisonoperatorenum_1", ["gt", "lt", "gte", "lte"]);
export const statusEnum_2 = pgEnum("statusenum_2", ["success", "failure"]);
export const processTypeEnum = pgEnum("processtypeenum", ["SMT", "DIP", "ASSEMBLY", "TESTING", "PACKAGING", "OTHER"]);
export const reportTypeEnum = pgEnum("reporttypeenum", ["NG_VISUAL", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY", "CUSTOM", "OEE_REPORT", "MACHINE_HEALTH"]);
export const scheduleEnum = pgEnum("scheduleenum", ["DAILY", "WEEKLY", "MONTHLY"]);
export const reportFormatEnum = pgEnum("reportformatenum", ["HTML", "PDF", "EXCEL"]);
export const statusEnum_3 = pgEnum("statusenum_3", ["SUCCESS", "FAILED", "PENDING"]);
export const approvalStatusEnum = pgEnum("approvalstatusenum", ["PENDING", "APPROVED", "REJECTED"]);
export const mappingTypeEnum = pgEnum("mappingtypeenum", ["AUTO", "MANUAL"]);
export const connectionStatusEnum_1 = pgEnum("connectionstatusenum_1", ["ONLINE", "OFFLINE", "DISCONNECTED"]);
export const summaryTypeEnum = pgEnum("summarytypeenum", ["DAILY", "WEEKLY"]);
export const messageTypeEnum = pgEnum("messagetypeenum", ["NG_ALERT", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "CUSTOM"]);
export const deliveryStatusEnum = pgEnum("deliverystatusenum", ["PENDING", "DELIVERED", "FAILED"]);
export const ruleTypeEnum = pgEnum("ruletypeenum", ["LATENCY_THRESHOLD", "BROKER_DISCONNECT", "MESSAGE_FAILURE_RATE", "THROUGHPUT_LOW", "THROUGHPUT_HIGH", "CLIENT_OFFLINE"]);
export const comparisonOperatorEnum_2 = pgEnum("comparisonoperatorenum_2", ["GT", "GTE", "LT", "LTE", "EQ"]);
export const dataTypeEnum = pgEnum("datatypeenum", ["STRING", "NUMBER", "BOOLEAN", "JSON"]);
export const typeEnum = pgEnum("typeenum", ["ALERT", "REPORT", "SYSTEM", "INFO", "WARNING", "SUCCESS"]);
export const priorityEnum = pgEnum("priorityenum", ["LOW", "NORMAL", "HIGH", "URGENT"]);
export const themeEnum = pgEnum("themeenum", ["light", "dark", "system"]);
export const templateTypeEnum = pgEnum("templatetypeenum", ["system", "shared"]);
export const processTypeEnum_1 = pgEnum("processtypeenum_1", ["SMT", "DIP", "ASSEMBLY", "TESTING", "PACKAGING", "INSPECTION", "OTHER"]);
export const shadowEnum = pgEnum("shadowenum", ["none", "sm", "md", "lg", "xl"]);
export const presetTypeEnum = pgEnum("presettypeenum", ["system", "shared", "user"]);
export const actionEnum = pgEnum("actionenum", ["export", "import", "scheduled_export"]);
export const statusEnum_4 = pgEnum("statusenum_4", ["success", "failed", "partial"]);
export const scheduleEnum_1 = pgEnum("scheduleenum_1", ["daily", "weekly", "monthly"]);
export const storageTypeEnum = pgEnum("storagetypeenum", ["local", "s3"]);
export const lastRunStatusEnum = pgEnum("lastrunstatusenum", ["success", "failed"]);
export const periodTypeEnum = pgEnum("periodtypeenum", ["HOUR", "SHIFT", "DAY", "WEEK", "MONTH"]);
export const categoryEnum = pgEnum("categoryenum", ["planned", "unplanned", "breakdown", "changeover", "maintenance", "other"]);
export const detectionMethodEnum = pgEnum("detectionmethodenum", ["MANUAL", "AUTO", "MQTT"]);
export const maintenanceUrgencyEnum = pgEnum("maintenanceurgencyenum", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const templateTypeEnum_1 = pgEnum("templatetypeenum_1", ["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]);
export const changeTypeEnum = pgEnum("changetypeenum", ["CREATE", "UPDATE", "DELETE", "ROLLBACK"]);
export const alertTypeEnum_1 = pgEnum("alerttypeenum_1", ["DEFECT_SPIKE", "YIELD_DROP", "MACHINE_FAILURE", "QUALITY_DEGRADATION", "PATTERN_ANOMALY"]);
export const statusEnum_5 = pgEnum("statusenum_5", ["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "DISMISSED", "EXPIRED"]);
export const analysisTypeEnum = pgEnum("analysistypeenum", ["DEFECT_ANALYSIS", "YIELD_ANALYSIS", "QUALITY_ANALYSIS", "MACHINE_ANALYSIS"]);
export const statusEnum_6 = pgEnum("statusenum_6", ["COMPLETED", "IN_PROGRESS", "FAILED"]);
export const exportFormatEnum = pgEnum("exportformatenum", ["CSV", "JSON", "EXCEL", "PDF"]);
export const resultFilterEnum = pgEnum("resultfilterenum", ["ALL", "OK", "NG", "NTF"]);
export const timeRangeTypeEnum = pgEnum("timerangetypeenum", ["LAST_24H", "LAST_7D", "LAST_30D", "LAST_MONTH", "CUSTOM"]);
export const statusEnum_7 = pgEnum("statusenum_7", ["SUCCESS", "FAILED", "PENDING", "RUNNING"]);
export const statusEnum_8 = pgEnum("statusenum_8", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);
export const periodTypeEnum_1 = pgEnum("periodtypeenum_1", ["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]);
export const suggestionTypeEnum = pgEnum("suggestiontypeenum", ["DEFECT_CLASSIFICATION", "ROOT_CAUSE", "CORRECTIVE_ACTION", "QUALITY_PREDICTION", "PROCESS_OPTIMIZATION"]);
export const statusEnum_9 = pgEnum("statusenum_9", ["PENDING", "ACCEPTED", "REJECTED", "REVIEWED"]);
export const feedbackTypeEnum = pgEnum("feedbacktypeenum", ["CORRECT", "INCORRECT", "PARTIAL", "UNSURE"]);
export const errorCategoryEnum = pgEnum("errorcategoryenum", ["FALSE_POSITIVE", "FALSE_NEGATIVE", "MISCLASSIFICATION", "WRONG_LOCATION", "WRONG_SEVERITY", "OTHER"]);
export const accuracyTrendEnum = pgEnum("accuracytrendenum", ["IMPROVING", "DECLINING", "STABLE"]);
export const exportFormatEnum_1 = pgEnum("exportformatenum_1", ["JSON", "CSV", "JSONL", "PARQUET"]);
export const statusEnum_10 = pgEnum("statusenum_10", ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "UPLOADED"]);
export const protocolEnum_1 = pgEnum("protocolenum_1", ["mqtt", "mqtts", "ws", "wss"]);
export const defaultQosEnum = pgEnum("defaultqosenum", ["0", "1", "2"]);
export const targetTypeEnum = pgEnum("targettypeenum", ["machine", "station", "factory"]);
export const eventTypeEnum = pgEnum("eventtypeenum", ["connect", "disconnect", "error", "reconnect"]);
export const deviceTypeEnum = pgEnum("devicetypeenum", ["avi", "aoi", "spi", "other"]);
export const messageFormatEnum = pgEnum("messageformatenum", ["json", "xml", "csv", "binary"]);
export const eventTypeEnum_1 = pgEnum("eventtypeenum_1", ["attempt", "success", "failure", "max_attempts_reached"]);
export const statusEnum_11 = pgEnum("statusenum_11", ["connected", "disconnected", "connecting", "error", "unknown"]);
export const alertTypeEnum_2 = pgEnum("alerttypeenum_2", ["connection_lost", "reconnect_failed", "high_reconnect_rate", "long_disconnection"]);
export const severityEnum = pgEnum("severityenum", ["info", "warning", "critical"]);

/**
 * Core user table backing auth flow.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 100 }).unique(), // For local auth
  passwordHash: varchar("passwordHash", { length: 255 }), // For local auth (bcrypt hash)
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }), // Số điện thoại
  department: varchar("department", { length: 100 }), // Phòng ban
  position: varchar("position", { length: 100 }), // Chức vụ
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  isActive: boolean("isActive").default(true).notNull(), // Trạng thái tài khoản
  twoFactorSecret: varchar("two_factor_secret", { length: 255 }), // TOTP secret for 2FA
  twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(), // 2FA enabled flag
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
export const factories = pgTable("factories", {
  id: serial("id").primaryKey(),
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
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_factories_code").on(table.code),
  index("idx_factories_active").on(table.isActive),
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
  operationStatus: operationStatusEnum("operationStatus").default("stopped").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
 * Product Inspection - Kết quả kiểm tra sản phẩm
 */
export const productInspections = pgTable("product_inspections", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  productModelId: integer("productModelId"), // Liên kết với Product Model
  corporateCode: varchar("corporateCode", { length: 50 }), // Mã tập đoàn
  factoryCode: varchar("factoryCode", { length: 50 }), // Mã nhà máy
  serialNumber: varchar("serialNumber", { length: 100 }).notNull(),
  productModel: varchar("productModel", { length: 100 }), // Backward compatibility
  batchNumber: varchar("batchNumber", { length: 100 }),
  overallResult: overallResultEnum("overallResult").notNull(),
  originalResult: originalResultEnum("originalResult").notNull(),
  ntfConfirmedBy: integer("ntfConfirmedBy"),
  ntfConfirmedAt: timestamp("ntfConfirmedAt"),
  ntfReason: text("ntfReason"),
  inspectionTime: timestamp("inspectionTime").notNull(),
  cycleTime: decimal("cycleTime", { precision: 10, scale: 2 }),
  // Batch operations fields
  notes: text("notes"),
  tags: text("tags"), // JSON array of tags
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  isArchived: boolean("isArchived").default(false),
  archivedAt: timestamp("archivedAt"),
  archivedBy: integer("archivedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
export const measurementResults = pgTable("measurement_results", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspectionId").notNull(),
  pointDefId: integer("pointDefId").notNull(),
  measuredValue: decimal("measuredValue", { precision: 15, scale: 6 }),
  measuredValueText: varchar("measuredValueText", { length: 255 }), // Giá trị dạng text
  result: overallResultEnum("result").notNull(),
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
  // Composite indexes for optimized queries
  index("idx_results_inspection_result").on(table.inspectionId, table.result),
  index("idx_results_point_result").on(table.pointDefId, table.result),
]);

export type MeasurementResult = typeof measurementResults.$inferSelect;
export type InsertMeasurementResult = typeof measurementResults.$inferInsert;

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
 * Daily Statistics - Thống kê theo ngày cho performance
 * Tối ưu cho truy vấn nhanh với quy mô lớn
 */
export const dailyStatistics = pgTable("daily_statistics", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  factoryId: integer("factoryId").notNull(), // Denormalized for fast queries
  workshopId: integer("workshopId").notNull(), // Denormalized for fast queries
  date: timestamp("date").notNull(),
  totalCount: integer("totalCount").default(0).notNull(),
  okCount: integer("okCount").default(0).notNull(),
  ngCount: integer("ngCount").default(0).notNull(),
  ntfCount: integer("ntfCount").default(0).notNull(),
  yieldRate: decimal("yieldRate", { precision: 5, scale: 2 }),
  avgCycleTime: decimal("avgCycleTime", { precision: 10, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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

/**
 * Alert Settings - Cấu hình cảnh báo
 */
export const alertSettings = pgTable("alert_settings", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // Người tạo cảnh báo
  name: varchar("name", { length: 255 }).notNull(),
  alertType: alertTypeEnum("alertType").notNull(),
  threshold: decimal("threshold", { precision: 10, scale: 2 }).notNull(), // Ngưỡng cảnh báo
  comparisonOperator: comparisonOperatorEnum("comparisonOperator").default("lt").notNull(),
  machineId: integer("machineId"), // Null = tất cả máy
  factoryId: integer("factoryId"), // Null = tất cả nhà máy
  isActive: boolean("isActive").default(true).notNull(),
  notifyEmail: boolean("notifyEmail").default(true).notNull(),
  notifySms: boolean("notifySms").default(false).notNull(),
  notifyInApp: boolean("notifyInApp").default(true).notNull(),
  cooldownMinutes: integer("cooldownMinutes").default(60).notNull(), // Thời gian chờ giữa các cảnh báo
  lastTriggeredAt: timestamp("lastTriggeredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
export const alertHistory = pgTable("alert_history", {
  id: serial("id").primaryKey(),
  alertSettingId: integer("alertSettingId").notNull(),
  triggeredValue: decimal("triggeredValue", { precision: 10, scale: 2 }).notNull(),
  message: text("message").notNull(),
  sentEmail: boolean("sentEmail").default(false).notNull(),
  sentSms: boolean("sentSms").default(false).notNull(),
  sentInApp: boolean("sentInApp").default(false).notNull(),
  acknowledgedAt: timestamp("acknowledgedAt"),
  acknowledgedBy: integer("acknowledgedBy"),
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
 * Shift Configuration - Cấu hình ca làm việc
 */
export const shiftConfigs = pgTable("shift_configs", {
  id: serial("id").primaryKey(),
  factoryId: integer("factoryId"), // Null = áp dụng toàn hệ thống
  name: varchar("name", { length: 100 }).notNull(),
  code: varchar("code", { length: 20 }).notNull(),
  startHour: integer("startHour").notNull(), // 0-23
  startMinute: integer("startMinute").default(0).notNull(),
  endHour: integer("endHour").notNull(), // 0-23
  endMinute: integer("endMinute").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  orderIndex: integer("orderIndex").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_shift_factory").on(table.factoryId),
  index("idx_shift_code").on(table.code),
]);

export type ShiftConfig = typeof shiftConfigs.$inferSelect;
export type InsertShiftConfig = typeof shiftConfigs.$inferInsert;


/**
 * Production Order - Lệnh sản xuất
 */
export const productionOrders = pgTable("production_orders", {
  id: serial("id").primaryKey(),
  orderCode: varchar("orderCode", { length: 100 }).notNull().unique(), // Mã lệnh sản xuất
  companyCode: varchar("companyCode", { length: 50 }).notNull(), // Mã công ty
  factoryId: integer("factoryId").notNull(), // Nhà máy
  workshopId: integer("workshopId").notNull(), // Nhà xưởng
  lineId: integer("lineId").notNull(), // Dây chuyền sản xuất
  productModelId: integer("productModelId").notNull(), // Sản phẩm
  targetQuantity: integer("targetQuantity").notNull(), // Số lượng mục tiêu
  completedQuantity: integer("completedQuantity").default(0).notNull(), // Số lượng đã hoàn thành
  okQuantity: integer("okQuantity").default(0).notNull(), // Số lượng OK
  ngQuantity: integer("ngQuantity").default(0).notNull(), // Số lượng NG
  ntfQuantity: integer("ntfQuantity").default(0).notNull(), // Số lượng NTF
  status: statusEnum("status").default("pending").notNull(),
  priority: integer("priority").default(0).notNull(), // Độ ưu tiên
  plannedStartDate: timestamp("plannedStartDate"),
  plannedEndDate: timestamp("plannedEndDate"),
  actualStartDate: timestamp("actualStartDate"),
  actualEndDate: timestamp("actualEndDate"),
  notes: text("notes"),
  dependencies: json("dependencies").$type<number[]>(), // Array of order IDs that this order depends on
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
export const lineStages = pgTable("line_stages", {
  id: serial("id").primaryKey(),
  lineId: integer("lineId").notNull(), // Dây chuyền
  code: varchar("code", { length: 20 }).notNull(), // A, B, C...
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  orderIndex: integer("orderIndex").default(0).notNull(), // Thứ tự công đoạn
  stationId: integer("stationId"), // Liên kết với station (optional)
  cycleTimeTarget: decimal("cycleTimeTarget", { precision: 10, scale: 2 }), // Thời gian chu kỳ mục tiêu (giây)
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
export const lineProductAssignments = pgTable("line_product_assignments", {
  id: serial("id").primaryKey(),
  lineId: integer("lineId").notNull(), // Dây chuyền
  productModelId: integer("productModelId").notNull(), // Sản phẩm
  productionOrderId: integer("productionOrderId"), // Lệnh sản xuất (optional)
  isActive: boolean("isActive").default(true).notNull(),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
export const machineStatusLogs = pgTable("machine_status_logs", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  status: statusEnum_1("status").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  duration: integer("duration"),
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
export const machineHeartbeats = pgTable("machine_heartbeats", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  status: operationStatusEnum("status").default("running").notNull(),
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
export const manualMachineConnections = pgTable("manual_machine_connections", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }).notNull(), // IPv4 hoặc IPv6
  port: integer("port").notNull().default(8080),
  protocol: protocolEnum("protocol").default("websocket").notNull(),
  isEnabled: boolean("isEnabled").default(true).notNull(),
  lastConnectionAttempt: timestamp("lastConnectionAttempt"),
  lastSuccessfulConnection: timestamp("lastSuccessfulConnection"),
  connectionStatus: connectionStatusEnum("connectionStatus").default("pending").notNull(),
  errorMessage: text("errorMessage"),
  retryCount: integer("retryCount").default(0).notNull(),
  maxRetries: integer("maxRetries").default(5).notNull(),
  retryIntervalSeconds: integer("retryIntervalSeconds").default(30).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
export const yieldAlertThresholds = pgTable("yield_alert_thresholds", {
  id: serial("id").primaryKey(),
  metricType: metricTypeEnum("metricType").notNull(),
  warningThreshold: decimal("warningThreshold", { precision: 10, scale: 4 }).notNull(), // Ngưỡng cảnh báo
  criticalThreshold: decimal("criticalThreshold", { precision: 10, scale: 4 }).notNull(), // Ngưỡng nghiêm trọng
  targetValue: decimal("targetValue", { precision: 10, scale: 4 }), // Giá trị mục tiêu
  comparisonOperator: comparisonOperatorEnum_1("comparisonOperator").default("gte").notNull(), // Toán tử so sánh
  isEnabled: boolean("isEnabled").default(true).notNull(),
  notifyOnWarning: boolean("notifyOnWarning").default(true).notNull(),
  notifyOnCritical: boolean("notifyOnCritical").default(true).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_yield_thresholds_type").on(table.metricType),
  index("idx_yield_thresholds_enabled").on(table.isEnabled),
]);

export type YieldAlertThreshold = typeof yieldAlertThresholds.$inferSelect;
export type InsertYieldAlertThreshold = typeof yieldAlertThresholds.$inferInsert;


/**
 * Yield Threshold History - Lịch sử thay đổi ngưỡng cảnh báo
 */
export const yieldThresholdHistory = pgTable("yield_threshold_history", {
  id: serial("id").primaryKey(),
  thresholdId: integer("thresholdId").notNull(), // Reference to yieldAlertThresholds
  metricType: metricTypeEnum("metricType").notNull(),
  previousWarning: decimal("previousWarning", { precision: 10, scale: 4 }),
  newWarning: decimal("newWarning", { precision: 10, scale: 4 }).notNull(),
  previousCritical: decimal("previousCritical", { precision: 10, scale: 4 }),
  newCritical: decimal("newCritical", { precision: 10, scale: 4 }).notNull(),
  previousTarget: decimal("previousTarget", { precision: 10, scale: 4 }),
  newTarget: decimal("newTarget", { precision: 10, scale: 4 }),
  changeReason: text("changeReason"),
  changedBy: integer("changedBy"), // User ID who made the change
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
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("userId"), // Null for system actions or failed logins
  userName: varchar("userName", { length: 255 }), // Store name at time of action
  action: varchar("action", { length: 100 }).notNull(), // login, logout, create, update, delete, etc.
  entityType: varchar("entityType", { length: 100 }), // user, machine, product, inspection, etc.
  entityId: integer("entityId"), // ID of affected entity
  entityName: varchar("entityName", { length: 255 }), // Name of affected entity for display
  details: text("details"), // JSON string with additional details
  ipAddress: varchar("ipAddress", { length: 45 }), // IPv4 or IPv6
  userAgent: varchar("userAgent", { length: 500 }),
  status: statusEnum_2("status").default("success").notNull(),
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
export const backupCodes = pgTable("backup_codes", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
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
export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
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
export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  settingKey: varchar("settingKey", { length: 100 }).notNull().unique(),
  settingValue: text("settingValue"),
  description: text("description"),
  category: varchar("category", { length: 50 }), // security, general, notification
  updatedBy: integer("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
 * Scheduled Reports - Báo cáo tự động theo lịch
 */
export const scheduledReports = pgTable("scheduled_reports", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  reportType: reportTypeEnum("reportType").default("NG_VISUAL").notNull(),
  schedule: scheduleEnum("schedule").default("DAILY").notNull(),
  scheduleTime: varchar("scheduleTime", { length: 10 }).default("08:00").notNull(), // HH:mm format
  scheduleDayOfWeek: integer("scheduleDayOfWeek"), // 0-6 for weekly (0=Sunday)
  scheduleDayOfMonth: integer("scheduleDayOfMonth"), // 1-31 for monthly
  recipients: json("recipients").$type<string[]>().notNull(), // Array of email addresses
  factoryId: integer("factoryId"), // Optional filter by factory
  workshopId: integer("workshopId"), // Optional filter by workshop
  lineId: integer("lineId"), // Optional filter by line
  includeWorkstationHeatmap: boolean("includeWorkstationHeatmap").default(true).notNull(),
  includeTopNGPoints: boolean("includeTopNGPoints").default(true).notNull(),
  includeTrendChart: boolean("includeTrendChart").default(true).notNull(),
  includeComparison: boolean("includeComparison").default(true).notNull(),
  // Report Customization
  reportFormat: reportFormatEnum("reportFormat").default("HTML").notNull(),
  logoUrl: varchar("logoUrl", { length: 500 }), // Custom logo URL
  primaryColor: varchar("primaryColor", { length: 20 }).default("#3b82f6"), // Primary color for email
  footerText: text("footerText"), // Custom footer text
  isActive: boolean("isActive").default(true).notNull(),
  lastSentAt: timestamp("lastSentAt"),
  nextScheduledAt: timestamp("nextScheduledAt"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
export const scheduledReportLogs = pgTable("scheduled_report_logs", {
  id: serial("id").primaryKey(),
  reportId: integer("reportId").notNull(),
  status: statusEnum_3("status").default("PENDING").notNull(),
  recipientCount: integer("recipientCount").default(0).notNull(),
  successCount: integer("successCount").default(0).notNull(),
  failedCount: integer("failedCount").default(0).notNull(),
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
export const smtpConfig = pgTable("smtp_config", {
  id: integer("id").primaryKey(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(587),
  secure: boolean("secure").notNull().default(false), // true for 465, false for other ports
  username: varchar("username", { length: 255 }).notNull(),
  password: text("password").notNull(), // Encrypted
  fromEmail: varchar("from_email", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }).notNull().default("AVI/AOI Management System"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SmtpConfig = typeof smtpConfig.$inferSelect;
export type InsertSmtpConfig = typeof smtpConfig.$inferInsert;


// ============= MQTT Client Management =============

/**
 * MQTT Clients - Quản lý các thiết bị client (Android/Tablet) kết nối qua MQTT
 */
export const mqttClients = pgTable("mqtt_clients", {
  id: serial("id").primaryKey(),
  clientId: varchar("clientId", { length: 128 }).notNull().unique(), // MQTT client ID
  deviceId: varchar("deviceId", { length: 128 }).notNull().unique(), // Unique device identifier (Android ID)
  deviceName: varchar("deviceName", { length: 255 }), // Tên thiết bị do user đặt
  deviceModel: varchar("deviceModel", { length: 100 }), // Model thiết bị (Samsung, Xiaomi, etc.)
  osVersion: varchar("osVersion", { length: 50 }), // Android version
  appVersion: varchar("appVersion", { length: 50 }), // App version
  // Mapping to station
  stationId: integer("stationId"), // Công trạm được gán
  processId: integer("processId"), // Công đoạn được gán (optional, for filtering)
  // Approval status
  approvalStatus: approvalStatusEnum("approvalStatus").default("PENDING").notNull(),
  approvedBy: integer("approvedBy"), // User ID who approved
  approvedAt: timestamp("approvedAt"),
  rejectionReason: text("rejectionReason"),
  // Mapping type
  mappingType: mappingTypeEnum("mappingType").default("MANUAL").notNull(),
  autoReconnect: boolean("autoReconnect").default(true).notNull(), // Tự động kết nối lại khi disconnect
  // Connection status
  connectionStatus: connectionStatusEnum_1("connectionStatus").default("OFFLINE").notNull(),
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
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
export const mqttSubscriptions = pgTable("mqtt_subscriptions", {
  id: serial("id").primaryKey(),
  clientId: integer("clientId").notNull(), // FK to mqtt_clients
  topic: varchar("topic", { length: 255 }).notNull(), // MQTT topic pattern
  qos: integer("qos").default(1).notNull(), // Quality of Service (0, 1, 2)
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
export const mqttErrorSummary = pgTable("mqtt_error_summary", {
  id: serial("id").primaryKey(),
  summaryType: summaryTypeEnum("summaryType").notNull(),
  summaryDate: timestamp("summaryDate").notNull(), // Ngày/tuần tổng hợp
  stationId: integer("stationId").notNull(),
  processId: integer("processId"), // Công đoạn (optional)
  measurementPointId: integer("measurementPointId"), // Điểm đo cụ thể (optional)
  // Statistics
  totalInspections: integer("totalInspections").default(0).notNull(),
  totalNG: integer("totalNG").default(0).notNull(),
  totalNTF: integer("totalNTF").default(0).notNull(),
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
export const mqttMessageLogs = pgTable("mqtt_message_logs", {
  id: serial("id").primaryKey(),
  messageType: messageTypeEnum("messageType").notNull(),
  topic: varchar("topic", { length: 255 }).notNull(),
  payload: json("payload").notNull(), // Message content
  targetClientId: integer("targetClientId"), // Specific client (null = broadcast)
  stationId: integer("stationId"), // Related station
  inspectionId: integer("inspectionId"), // Related inspection (for NG alerts)
  deliveryStatus: deliveryStatusEnum("deliveryStatus").default("PENDING").notNull(),
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
export const mqttAlertRules = pgTable("mqtt_alert_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(), // Tên rule
  description: text("description"), // Mô tả
  ruleType: ruleTypeEnum("ruleType").notNull(),
  // Threshold configuration
  thresholdValue: decimal("thresholdValue", { precision: 10, scale: 2 }).notNull(), // Giá trị ngưỡng
  thresholdUnit: varchar("thresholdUnit", { length: 50 }).default("ms").notNull(), // Đơn vị (ms, %, msg/min, minutes)
  comparisonOperator: comparisonOperatorEnum_2("comparisonOperator").default("GT").notNull(),
  // Time window for evaluation
  timeWindowMinutes: integer("timeWindowMinutes").default(5).notNull(), // Khoảng thời gian đánh giá (phút)
  // Notification settings
  notifyOwner: boolean("notifyOwner").default(true).notNull(), // Gửi notification cho owner
  notifyEmail: boolean("notifyEmail").default(false).notNull(), // Gửi email
  notifyMqtt: boolean("notifyMqtt").default(false).notNull(), // Gửi qua MQTT
  // Cooldown to prevent spam
  cooldownMinutes: integer("cooldownMinutes").default(15).notNull(), // Thời gian chờ giữa các alert
  lastTriggeredAt: timestamp("lastTriggeredAt"), // Lần trigger gần nhất
  // Category filter (optional - only trigger for specific product category)
  categoryId: integer("categoryId"), // FK to product_categories (null = all categories)
  // Status
  isEnabled: boolean("isEnabled").default(true).notNull(),
  createdBy: integer("createdBy"), // FK to users
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_alert_rules_type").on(table.ruleType),
  index("idx_mqtt_alert_rules_enabled").on(table.isEnabled),
]);

export type MqttAlertRule = typeof mqttAlertRules.$inferSelect;
export type InsertMqttAlertRule = typeof mqttAlertRules.$inferInsert;

/**
 * MQTT Alert History - Lịch sử các alert đã trigger
 */
export const mqttAlertHistory = pgTable("mqtt_alert_history", {
  id: serial("id").primaryKey(),
  ruleId: integer("ruleId").notNull(), // FK to mqtt_alert_rules
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
  resolvedBy: integer("resolvedBy"), // FK to users
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
export const systemConfig = pgTable("system_config", {
  id: serial("id").primaryKey(),
  configKey: varchar("configKey", { length: 100 }).notNull().unique(), // Unique key
  configValue: text("configValue").notNull(), // JSON or string value
  description: text("description"), // Mô tả cấu hình
  dataType: dataTypeEnum("dataType").default("STRING").notNull(),
  isEditable: boolean("isEditable").default(true).notNull(), // Có thể chỉnh sửa qua UI không
  requiresRestart: boolean("requiresRestart").default(false).notNull(), // Cần restart server sau khi thay đổi
  updatedBy: integer("updatedBy"), // FK to users
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_system_config_key").on(table.configKey),
]);

export type SystemConfig = typeof systemConfig.$inferSelect;
export type InsertSystemConfig = typeof systemConfig.$inferInsert;


/**
 * User Corporate Assignments - Phân quyền user theo công ty
 */
export const userCorporateAssignments = pgTable("user_corporate_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users
  corporateCode: varchar("corporateCode", { length: 50 }).notNull(),
  assignedBy: integer("assignedBy"), // FK to users (admin who assigned)
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
export const userFactoryAssignments = pgTable("user_factory_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users
  factoryCode: varchar("factoryCode", { length: 50 }).notNull(),
  assignedBy: integer("assignedBy"), // FK to users (admin who assigned)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_user_factory_user").on(table.userId),
  index("idx_user_factory_code").on(table.factoryCode),
  // Unique constraint: một user không thể được assign vào cùng một factory 2 lần
  index("idx_user_factory_unique").on(table.userId, table.factoryCode),
]);

export type UserFactoryAssignment = typeof userFactoryAssignments.$inferSelect;
export type InsertUserFactoryAssignment = typeof userFactoryAssignments.$inferInsert;


// ============= Email Template Configuration =============

/**
 * Email Template Config - Cấu hình giao diện email báo cáo
 */
export const emailTemplateConfig = pgTable("email_template_config", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().default("default"),
  // Branding
  logoUrl: text("logoUrl"), // URL logo công ty
  companyName: varchar("companyName", { length: 255 }), // Tên công ty hiển thị
  // Colors
  primaryColor: varchar("primaryColor", { length: 20 }).default("#2563eb"), // Màu chính (hex)
  secondaryColor: varchar("secondaryColor", { length: 20 }).default("#64748b"), // Màu phụ
  accentColor: varchar("accentColor", { length: 20 }).default("#10b981"), // Màu nhấn (success)
  warningColor: varchar("warningColor", { length: 20 }).default("#f59e0b"), // Màu cảnh báo
  dangerColor: varchar("dangerColor", { length: 20 }).default("#ef4444"), // Màu nguy hiểm
  backgroundColor: varchar("backgroundColor", { length: 20 }).default("#f8fafc"), // Màu nền
  // Typography
  fontFamily: varchar("fontFamily", { length: 100 }).default("Arial, sans-serif"),
  // Footer
  footerText: text("footerText"), // Nội dung footer tùy chỉnh
  footerLinks: text("footerLinks"), // JSON array of {label, url}
  // Contact info
  contactEmail: varchar("contactEmail", { length: 255 }),
  contactPhone: varchar("contactPhone", { length: 50 }),
  contactAddress: text("contactAddress"),
  // Social links
  socialLinks: text("socialLinks"), // JSON object {facebook, linkedin, website}
  // Active status
  isDefault: boolean("isDefault").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  createdBy: integer("createdBy"), // FK to users
}, (table) => [
  index("idx_email_template_name").on(table.name),
  index("idx_email_template_default").on(table.isDefault),
]);

export type EmailTemplateConfig = typeof emailTemplateConfig.$inferSelect;
export type InsertEmailTemplateConfig = typeof emailTemplateConfig.$inferInsert;


// ============= Notifications System =============

/**
 * Notifications - Thông báo hệ thống cho user
 */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users (recipient)
  type: typeEnum("type").default("INFO").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  // Link to related entity
  entityType: varchar("entityType", { length: 50 }), // 'inspection', 'report', 'alert', etc.
  entityId: integer("entityId"), // ID of related entity
  actionUrl: varchar("actionUrl", { length: 500 }), // URL to navigate when clicked
  // Status
  isRead: boolean("isRead").default(false).notNull(),
  readAt: timestamp("readAt"),
  // Priority
  priority: priorityEnum("priority").default("NORMAL").notNull(),
  // Expiration
  expiresAt: timestamp("expiresAt"), // Optional expiration time
  // Metadata
  metadata: json("metadata").$type<Record<string, any>>(), // Additional data
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_notifications_user").on(table.userId),
  index("idx_notifications_type").on(table.type),
  index("idx_notifications_read").on(table.isRead),
  index("idx_notifications_priority").on(table.priority),
  index("idx_notifications_created").on(table.createdAt),
  index("idx_notifications_user_unread").on(table.userId, table.isRead),
]);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * User Notification Preferences - Cài đặt thông báo của user
 */
export const userNotificationPreferences = pgTable("user_notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(), // FK to users
  // Email notifications
  emailEnabled: boolean("emailEnabled").default(true).notNull(),
  emailAlerts: boolean("emailAlerts").default(true).notNull(),
  emailReports: boolean("emailReports").default(true).notNull(),
  emailSystem: boolean("emailSystem").default(true).notNull(),
  // Push notifications
  pushEnabled: boolean("pushEnabled").default(true).notNull(),
  pushAlerts: boolean("pushAlerts").default(true).notNull(),
  pushReports: boolean("pushReports").default(true).notNull(),
  pushSystem: boolean("pushSystem").default(true).notNull(),
  // In-app notifications
  inAppEnabled: boolean("inAppEnabled").default(true).notNull(),
  inAppAlerts: boolean("inAppAlerts").default(true).notNull(),
  inAppReports: boolean("inAppReports").default(true).notNull(),
  inAppSystem: boolean("inAppSystem").default(true).notNull(),
  // Sound
  soundEnabled: boolean("soundEnabled").default(true).notNull(),
  // Quiet hours
  quietHoursEnabled: boolean("quietHoursEnabled").default(false).notNull(),
  quietHoursStart: varchar("quietHoursStart", { length: 10 }).default("22:00"), // HH:mm
  quietHoursEnd: varchar("quietHoursEnd", { length: 10 }).default("07:00"), // HH:mm
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_notif_prefs_user").on(table.userId),
]);

export type UserNotificationPreference = typeof userNotificationPreferences.$inferSelect;
export type InsertUserNotificationPreference = typeof userNotificationPreferences.$inferInsert;

// ============= Dashboard Widgets =============

/**
 * Dashboard Widget Layouts - Cấu hình layout widgets của user
 */
export const dashboardWidgetLayouts = pgTable("dashboard_widget_layouts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users
  layoutName: varchar("layoutName", { length: 100 }).default("default").notNull(),
  // Widget configuration as JSON array
  widgets: json("widgets").$type<Array<{
    id: string; // Unique widget ID
    type: string; // Widget type (e.g., 'yield_chart', 'throughput', 'alerts', etc.)
    title: string; // Display title
    // Position and size (grid-based)
    x: number; // Column position (0-based)
    y: number; // Row position (0-based)
    w: number; // Width in grid units
    h: number; // Height in grid units
    // Widget-specific settings
    settings?: Record<string, any>;
    // Visibility
    visible: boolean;
  }>>().notNull(),
  // Active layout
  isActive: boolean("isActive").default(true).notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_widget_layouts_user").on(table.userId),
  index("idx_widget_layouts_active").on(table.isActive),
  index("idx_widget_layouts_user_active").on(table.userId, table.isActive),
]);

export type DashboardWidgetLayout = typeof dashboardWidgetLayouts.$inferSelect;
export type InsertDashboardWidgetLayout = typeof dashboardWidgetLayouts.$inferInsert;

/**
 * User Settings - Cài đặt chung của user (bao gồm language)
 */
export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(), // FK to users
  // Language preference
  language: varchar("language", { length: 10 }).default("vi").notNull(), // vi, en, zh, ja
  // Theme preference
  theme: themeEnum("theme").default("system").notNull(),
  // Timezone
  timezone: varchar("timezone", { length: 50 }).default("Asia/Ho_Chi_Minh"),
  // Date/time format preferences
  dateFormat: varchar("dateFormat", { length: 20 }).default("DD/MM/YYYY"),
  timeFormat: varchar("timeFormat", { length: 10 }).default("24h"), // 12h or 24h
  // Number format
  numberFormat: varchar("numberFormat", { length: 20 }).default("1.234,56"), // Decimal separator
  // Dashboard preferences
  defaultDashboardTab: varchar("defaultDashboardTab", { length: 50 }).default("overview"),
  // Sidebar preferences
  sidebarCollapsed: boolean("sidebarCollapsed").default(false).notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_user_settings_user").on(table.userId),
  index("idx_user_settings_language").on(table.language),
]);

export type UserSetting = typeof userSettings.$inferSelect;
export type InsertUserSetting = typeof userSettings.$inferInsert;


// ============= Dashboard Templates (Shared) =============

/**
 * Dashboard Templates - Templates layout dashboard có thể chia sẻ
 */
export const dashboardTemplates = pgTable("dashboard_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  // Template type: system (preset), shared (admin created for team)
  templateType: templateTypeEnum("templateType").default("shared").notNull(),
  // Layout configuration
  widgets: json("widgets").$type<string[]>().notNull(), // Array of widget IDs
  layout: json("layout").$type<Array<{
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
  }>>().notNull(),
  // Preview image (optional)
  previewImageUrl: text("previewImageUrl"),
  // Access control
  isPublic: boolean("isPublic").default(true).notNull(), // Visible to all users
  createdBy: integer("createdBy").notNull(), // FK to users (admin who created)
  // Usage stats
  usageCount: integer("usageCount").default(0).notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_dashboard_templates_type").on(table.templateType),
  index("idx_dashboard_templates_public").on(table.isPublic),
  index("idx_dashboard_templates_creator").on(table.createdBy),
  index("idx_dashboard_templates_usage").on(table.usageCount),
]);

export type DashboardTemplate = typeof dashboardTemplates.$inferSelect;
export type InsertDashboardTemplate = typeof dashboardTemplates.$inferInsert;


// ============= Production Processes =============

/**
 * Processes - Công đoạn sản xuất (khác với lineStages - đây là công đoạn chung)
 */
export const processes = pgTable("processes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  processType: processTypeEnum_1("processType").default("OTHER").notNull(),
  // Thời gian chu kỳ mục tiêu (giây)
  cycleTimeTarget: decimal("cycleTimeTarget", { precision: 10, scale: 2 }),
  // Thứ tự trong quy trình sản xuất chung
  orderIndex: integer("orderIndex").default(0).notNull(),
  // Màu sắc hiển thị trên Gantt chart
  color: varchar("color", { length: 20 }).default("#3b82f6"),
  // Icon (lucide icon name)
  icon: varchar("icon", { length: 50 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_processes_code").on(table.code),
  index("idx_processes_type").on(table.processType),
  index("idx_processes_order").on(table.orderIndex),
  index("idx_processes_active").on(table.isActive),
]);

export type Process = typeof processes.$inferSelect;
export type InsertProcess = typeof processes.$inferInsert;

/**
 * Line Process Assignments - Gán công đoạn cho dây chuyền
 */
export const lineProcessAssignments = pgTable("line_process_assignments", {
  id: serial("id").primaryKey(),
  lineId: integer("lineId").notNull(), // FK to production_lines
  processId: integer("processId").notNull(), // FK to processes
  // Thứ tự công đoạn trong dây chuyền này
  orderIndex: integer("orderIndex").default(0).notNull(),
  // Thời gian chu kỳ riêng cho dây chuyền này (override process default)
  cycleTimeTarget: decimal("cycleTimeTarget", { precision: 10, scale: 2 }),
  // Station thực hiện công đoạn này trên dây chuyền
  stationId: integer("stationId"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_lpa_process_line").on(table.lineId),
  index("idx_lpa_process").on(table.processId),
  index("idx_lpa_station").on(table.stationId),
  index("idx_lpa_process_order").on(table.orderIndex),
]);

export type LineProcessAssignment = typeof lineProcessAssignments.$inferSelect;
export type InsertLineProcessAssignment = typeof lineProcessAssignments.$inferInsert;


// ============= Dashboard Widget Style Presets =============

/**
 * Widget Style Presets - Preset styles cho dashboard widgets
 */
export const widgetStylePresets = pgTable("widget_style_presets", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  // Style configuration
  backgroundColor: varchar("backgroundColor", { length: 20 }).default("#ffffff").notNull(),
  textColor: varchar("textColor", { length: 20 }).default("#1f2937").notNull(),
  borderColor: varchar("borderColor", { length: 20 }).default("#e5e7eb").notNull(),
  accentColor: varchar("accentColor", { length: 20 }).default("#3b82f6").notNull(),
  borderRadius: varchar("borderRadius", { length: 20 }).default("0.5rem").notNull(),
  shadow: shadowEnum("shadow").default("sm").notNull(),
  opacity: decimal("opacity", { precision: 3, scale: 2 }).default("1.00").notNull(),
  // Preset type: system (built-in), shared (admin created), user (personal)
  presetType: presetTypeEnum("presetType").default("user").notNull(),
  // Access control
  isPublic: boolean("isPublic").default(false).notNull(), // Visible to all users
  createdBy: integer("createdBy").notNull(), // FK to users
  // Usage stats
  usageCount: integer("usageCount").default(0).notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_widget_presets_type").on(table.presetType),
  index("idx_widget_presets_public").on(table.isPublic),
  index("idx_widget_presets_creator").on(table.createdBy),
  index("idx_widget_presets_name").on(table.name),
]);

export type WidgetStylePreset = typeof widgetStylePresets.$inferSelect;
export type InsertWidgetStylePreset = typeof widgetStylePresets.$inferInsert;


// ============= Product Categories =============

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


/**
 * Backup Logs - Lịch sử backup/restore
 */
export const backupLogs = pgTable("backup_logs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // FK to users
  action: actionEnum("action").notNull(),
  categories: json("categories").$type<string[]>().notNull(), // Categories được backup/restore
  status: statusEnum_4("status").notNull(),
  fileSize: integer("fileSize"), // Kích thước file backup (bytes)
  fileName: varchar("fileName", { length: 255 }), // Tên file backup
  fileUrl: text("fileUrl"), // URL file backup (nếu lưu S3)
  recordCount: integer("recordCount"), // Số records được backup/restore
  errorMessage: text("errorMessage"), // Thông báo lỗi nếu có
  metadata: json("metadata").$type<Record<string, any>>(), // Metadata bổ sung
  ipAddress: varchar("ipAddress", { length: 45 }), // IP address của người thực hiện
  userAgent: text("userAgent"), // User agent
  duration: integer("duration"), // Thời gian thực hiện (ms)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_backup_logs_user").on(table.userId),
  index("idx_backup_logs_action").on(table.action),
  index("idx_backup_logs_status").on(table.status),
  index("idx_backup_logs_created").on(table.createdAt),
]);

export type BackupLog = typeof backupLogs.$inferSelect;
export type InsertBackupLog = typeof backupLogs.$inferInsert;

/**
 * Scheduled Backups - Cấu hình backup tự động
 */
export const scheduledBackups = pgTable("scheduled_backups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  categories: json("categories").$type<string[]>().notNull(), // Categories để backup
  schedule: scheduleEnum_1("schedule").notNull(),
  scheduleTime: varchar("scheduleTime", { length: 5 }).notNull(), // HH:MM format
  scheduleDayOfWeek: integer("scheduleDayOfWeek"), // 0-6 for weekly (0 = Sunday)
  scheduleDayOfMonth: integer("scheduleDayOfMonth"), // 1-31 for monthly
  retentionCount: integer("retentionCount").default(7).notNull(), // Số bản backup giữ lại
  storageType: storageTypeEnum("storageType").default("s3").notNull(),
  isEnabled: boolean("isEnabled").default(true).notNull(),
  lastRunAt: timestamp("lastRunAt"),
  lastRunStatus: lastRunStatusEnum("lastRunStatus"),
  nextRunAt: timestamp("nextRunAt"),
  createdBy: integer("createdBy").notNull(), // FK to users
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_scheduled_backups_enabled").on(table.isEnabled),
  index("idx_scheduled_backups_next_run").on(table.nextRunAt),
]);

export type ScheduledBackup = typeof scheduledBackups.$inferSelect;
export type InsertScheduledBackup = typeof scheduledBackups.$inferInsert;

/**
 * Template Marketplace - Templates được chia sẻ
 */
export const templateMarketplace = pgTable("template_marketplace", {
  id: serial("id").primaryKey(),
  templateId: integer("templateId").notNull(), // FK to dashboardTemplates
  publisherId: integer("publisherId").notNull(), // FK to users
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }), // production, quality, monitoring, etc.
  tags: json("tags").$type<string[]>(), // Tags cho tìm kiếm
  thumbnailUrl: text("thumbnailUrl"), // Ảnh preview
  previewData: json("previewData").$type<Record<string, any>>(), // Data để preview
  downloadCount: integer("downloadCount").default(0).notNull(),
  rating: decimal("rating", { precision: 2, scale: 1 }).default("0"), // 0-5
  ratingCount: integer("ratingCount").default(0).notNull(),
  isPublished: boolean("isPublished").default(true).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  version: varchar("version", { length: 20 }).default("1.0.0").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_marketplace_publisher").on(table.publisherId),
  index("idx_marketplace_category").on(table.category),
  index("idx_marketplace_published").on(table.isPublished),
  index("idx_marketplace_featured").on(table.isFeatured),
  index("idx_marketplace_rating").on(table.rating),
  index("idx_marketplace_downloads").on(table.downloadCount),
]);

export type TemplateMarketplace = typeof templateMarketplace.$inferSelect;
export type InsertTemplateMarketplace = typeof templateMarketplace.$inferInsert;

/**
 * Template Reviews - Đánh giá templates
 */
export const templateReviews = pgTable("template_reviews", {
  id: serial("id").primaryKey(),
  marketplaceId: integer("marketplaceId").notNull(), // FK to templateMarketplace
  userId: integer("userId").notNull(), // FK to users
  rating: integer("rating").notNull(), // 1-5
  comment: text("comment"),
  isVerified: boolean("isVerified").default(false).notNull(), // Đã download và sử dụng
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_reviews_marketplace").on(table.marketplaceId),
  index("idx_reviews_user").on(table.userId),
  index("idx_reviews_rating").on(table.rating),
]);

export type TemplateReview = typeof templateReviews.$inferSelect;
export type InsertTemplateReview = typeof templateReviews.$inferInsert;


/**
 * Production Order Templates - Template lệnh sản xuất
 */
export const productionOrderTemplates = pgTable("production_order_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  factoryId: integer("factoryId"), // Nhà máy (null = all factories)
  workshopId: integer("workshopId"), // Nhà xưởng (null = all workshops)
  productModelId: integer("productModelId"), // Sản phẩm (null = any product)
  defaultTargetQuantity: integer("defaultTargetQuantity").default(1000).notNull(),
  defaultPriority: integer("defaultPriority").default(0).notNull(),
  defaultNotes: text("defaultNotes"),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_order_template_factory").on(table.factoryId),
  index("idx_order_template_workshop").on(table.workshopId),
  index("idx_order_template_product").on(table.productModelId),
  index("idx_order_template_active").on(table.isActive),
]);

export type ProductionOrderTemplate = typeof productionOrderTemplates.$inferSelect;
export type InsertProductionOrderTemplate = typeof productionOrderTemplates.$inferInsert;


// ============= OEE & Machine Performance =============

/**
 * OEE Metrics - Overall Equipment Effectiveness metrics
 */
export const oeeMetrics = pgTable("oee_metrics", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 50 }).notNull(),
  // Time period
  timestamp: timestamp("timestamp").notNull(),
  periodType: periodTypeEnum("periodType").default("HOUR").notNull(),
  // OEE Components (stored as percentage * 100, e.g., 85.5% = 8550)
  availability: integer("availability").notNull(), // Uptime / Planned time
  performance: integer("performance").notNull(), // Actual output / Theoretical output
  quality: integer("quality").notNull(), // Good output / Total output
  oee: integer("oee").notNull(), // A × P × Q / 10000
  // Raw data for calculation
  plannedTime: integer("plannedTime").notNull(), // Minutes
  runTime: integer("runTime").notNull(), // Minutes
  idealCycleTime: integer("idealCycleTime").notNull(), // Seconds per unit
  totalCount: integer("totalCount").notNull(), // Total units produced
  goodCount: integer("goodCount").notNull(), // Good units
  rejectCount: integer("rejectCount").notNull(), // Rejected units
  // Metadata
  calculatedBy: varchar("calculatedBy", { length: 50 }).default("AUTO").notNull(), // AUTO or user ID
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_oee_machine").on(table.machineId),
  index("idx_oee_machine_code").on(table.machineCode),
  index("idx_oee_timestamp").on(table.timestamp),
  index("idx_oee_period").on(table.periodType),
  index("idx_oee_machine_time").on(table.machineId, table.timestamp),
]);

export type OEEMetric = typeof oeeMetrics.$inferSelect;
export type InsertOEEMetric = typeof oeeMetrics.$inferInsert;

/**
 * Downtime Events - Machine downtime tracking
 */
export const downtimeEvents = pgTable("downtime_events", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 50 }).notNull(),
  // Downtime classification
  category: categoryEnum("category").notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  detailedReason: text("detailedReason"),
  // Time tracking
  startTime: timestamp("startTime").notNull(),
  endTime: timestamp("endTime"),
  duration: integer("duration"), // Minutes (calculated when endTime is set)
  // Detection method
  detectionMethod: detectionMethodEnum("detectionMethod").default("MANUAL").notNull(),
  // Responsible party
  reportedBy: integer("reportedBy"), // User ID who reported
  acknowledgedBy: integer("acknowledgedBy"), // User ID who acknowledged
  acknowledgedAt: timestamp("acknowledgedAt"),
  // Resolution
  resolution: text("resolution"),
  resolvedBy: integer("resolvedBy"), // User ID who resolved
  resolvedAt: timestamp("resolvedAt"),
  // Impact
  affectedUnits: integer("affectedUnits").default(0), // Units lost during downtime
  estimatedCost: decimal("estimatedCost", { precision: 10, scale: 2 }), // Cost impact
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_downtime_machine").on(table.machineId),
  index("idx_downtime_machine_code").on(table.machineCode),
  index("idx_downtime_category").on(table.category),
  index("idx_downtime_start").on(table.startTime),
  index("idx_downtime_end").on(table.endTime),
  index("idx_downtime_machine_time").on(table.machineId, table.startTime),
]);

export type DowntimeEvent = typeof downtimeEvents.$inferSelect;
export type InsertDowntimeEvent = typeof downtimeEvents.$inferInsert;

/**
 * OEE Targets - Target OEE values for machines/lines
 */
export const oeeTargets = pgTable("oee_targets", {
  id: serial("id").primaryKey(),
  // Target scope
  machineId: integer("machineId"), // Specific machine (null = line level)
  lineId: integer("lineId"), // Production line (null = machine level)
  // Target values (stored as percentage * 100)
  targetOEE: integer("targetOEE").notNull().default(8000), // 80%
  targetAvailability: integer("targetAvailability").notNull().default(9000), // 90%
  targetPerformance: integer("targetPerformance").notNull().default(9500), // 95%
  targetQuality: integer("targetQuality").notNull().default(9900), // 99%
  // Alert thresholds
  alertThreshold: integer("alertThreshold").notNull().default(7000), // Alert when OEE < 70%
  criticalThreshold: integer("criticalThreshold").notNull().default(6000), // Critical when OEE < 60%
  // Validity period
  effectiveFrom: timestamp("effectiveFrom").notNull().defaultNow(),
  effectiveTo: timestamp("effectiveTo"),
  isActive: boolean("isActive").default(true).notNull(),
  // Metadata
  setBy: integer("setBy").notNull(), // User ID who set the target
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_oee_target_machine").on(table.machineId),
  index("idx_oee_target_line").on(table.lineId),
  index("idx_oee_target_active").on(table.isActive),
  index("idx_oee_target_effective").on(table.effectiveFrom, table.effectiveTo),
]);

export type OEETarget = typeof oeeTargets.$inferSelect;
export type InsertOEETarget = typeof oeeTargets.$inferInsert;

/**
 * Machine Health History - Historical health scores
 */
export const machineHealthHistory = pgTable("machine_health_history", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 50 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  // Health score (0-100)
  healthScore: integer("healthScore").notNull(),
  // Contributing factors (stored as percentage * 100)
  oeeScore: integer("oeeScore").notNull(),
  uptimeScore: integer("uptimeScore").notNull(),
  errorRateScore: integer("errorRateScore").notNull(),
  cycleTimeScore: integer("cycleTimeScore").notNull(),
  // Raw metrics
  currentOEE: integer("currentOEE"),
  uptimePercentage: integer("uptimePercentage"),
  errorCount: integer("errorCount"),
  cycleTimeVariance: decimal("cycleTimeVariance", { precision: 10, scale: 2 }),
  // Predictions
  predictedFailureRisk: integer("predictedFailureRisk"), // 0-100
  recommendedMaintenanceDate: timestamp("recommendedMaintenanceDate"),
  maintenanceUrgency: maintenanceUrgencyEnum("maintenanceUrgency"),
  // Metadata
  calculationMethod: varchar("calculationMethod", { length: 50 }).default("WEIGHTED").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_health_machine").on(table.machineId),
  index("idx_health_machine_code").on(table.machineCode),
  index("idx_health_timestamp").on(table.timestamp),
  index("idx_health_score").on(table.healthScore),
  index("idx_health_machine_time").on(table.machineId, table.timestamp),
]);

export type MachineHealthHistory = typeof machineHealthHistory.$inferSelect;
export type InsertMachineHealthHistory = typeof machineHealthHistory.$inferInsert;

/**
 * MQTT Message History - For replay and debugging
 */
export const mqttMessageHistory = pgTable("mqtt_message_history", {
  id: serial("id").primaryKey(),
  topic: varchar("topic", { length: 255 }).notNull(),
  machineCode: varchar("machineCode", { length: 50 }),
  payload: json("payload").$type<Record<string, any>>().notNull(),
  qos: integer("qos").default(0).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  // Metadata
  messageSize: integer("messageSize"), // Bytes
  processingTime: integer("processingTime"), // Milliseconds
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_history_topic").on(table.topic),
  index("idx_mqtt_history_machine").on(table.machineCode),
  index("idx_mqtt_history_timestamp").on(table.timestamp),
  index("idx_mqtt_history_topic_time").on(table.topic, table.timestamp),
]);

export type MqttMessageHistory = typeof mqttMessageHistory.$inferSelect;
export type InsertMqttMessageHistory = typeof mqttMessageHistory.$inferInsert;


/**
 * Report Templates - Mẫu báo cáo có sẵn (Daily, Weekly, Monthly)
 */
export const reportTemplates = pgTable("report_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(), // DAILY_QUALITY, WEEKLY_SUMMARY, MONTHLY_PERFORMANCE
  description: text("description"),
  templateType: templateTypeEnum_1("templateType").notNull(),
  // Content configuration
  sections: json("sections").$type<{
    includeYieldStats: boolean;
    includeNGAnalysis: boolean;
    includeMachineComparison: boolean;
    includeOEEMetrics: boolean;
    includeDowntimeAnalysis: boolean;
    includeTrendCharts: boolean;
    includeTopNGPoints: boolean;
    customSections?: string[];
  }>().notNull(),
  // Email configuration
  emailSubjectTemplate: varchar("emailSubjectTemplate", { length: 255 }),
  emailBodyTemplate: text("emailBodyTemplate"),
  // Schedule defaults
  defaultSchedule: varchar("defaultSchedule", { length: 50 }), // e.g., "0 8 * * *" for daily at 8am
  // Metadata
  isSystem: boolean("isSystem").default(false).notNull(), // System templates cannot be deleted
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: integer("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_report_templates_code").on(table.code),
  index("idx_report_templates_type").on(table.templateType),
  index("idx_report_templates_active").on(table.isActive),
]);

export type ReportTemplate = typeof reportTemplates.$inferSelect;
export type InsertReportTemplate = typeof reportTemplates.$inferInsert;


// ============= Annotation Version History =============

/**
 * Annotation History - Lịch sử thay đổi annotations
 */
export const annotationHistory = pgTable("annotation_history", {
  id: serial("id").primaryKey(),
  annotationId: integer("annotationId").notNull(), // FK to image_annotations
  imageUrl: text("imageUrl").notNull(),
  versionNumber: integer("versionNumber").notNull(), // Auto-increment per annotation
  annotations: json("annotations").$type<Array<{
    id: string;
    type: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    radius?: number;
    points?: Array<{x: number; y: number}>;
    text?: string;
    color: string;
    strokeWidth?: number;
  }>>().notNull(),
  changeType: changeTypeEnum("changeType").notNull(),
  changeSummary: text("changeSummary"), // Human-readable summary of changes
  changedBy: integer("changedBy").notNull(), // FK to users
  changedByName: varchar("changedByName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_annotation_history_annotation").on(table.annotationId),
  index("idx_annotation_history_image").on(table.imageUrl),
  index("idx_annotation_history_version").on(table.annotationId, table.versionNumber),
  index("idx_annotation_history_created").on(table.createdAt),
  index("idx_annotation_history_user").on(table.changedBy),
]);

export type AnnotationHistory = typeof annotationHistory.$inferSelect;
export type InsertAnnotationHistory = typeof annotationHistory.$inferInsert;


// ============= Predictive Maintenance Alerts =============

/**
 * Predictive Alerts - Cảnh báo dự đoán từ AI
 */
export const predictiveAlerts = pgTable("predictive_alerts", {
  id: serial("id").primaryKey(),
  alertType: alertTypeEnum_1("alertType").notNull(),
  severity: maintenanceUrgencyEnum("severity").default("MEDIUM").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  // Prediction details
  predictedValue: decimal("predictedValue", { precision: 10, scale: 4 }), // Giá trị dự đoán
  currentValue: decimal("currentValue", { precision: 10, scale: 4 }), // Giá trị hiện tại
  threshold: decimal("threshold", { precision: 10, scale: 4 }), // Ngưỡng cảnh báo
  confidenceScore: decimal("confidenceScore", { precision: 5, scale: 2 }), // Độ tin cậy (0-100)
  predictedTimeframe: varchar("predictedTimeframe", { length: 50 }), // e.g., "next 24 hours", "within 7 days"
  // Related entities
  machineId: integer("machineId"),
  machineCode: varchar("machineCode", { length: 50 }),
  productModelId: integer("productModelId"),
  productModelCode: varchar("productModelCode", { length: 50 }),
  factoryId: integer("factoryId"),
  // AI analysis
  aiAnalysis: json("aiAnalysis").$type<{
    factors: Array<{name: string; contribution: number; description: string}>;
    recommendations: string[];
    dataPoints: number;
    modelUsed: string;
  }>(),
  // Status
  status: statusEnum_5("status").default("ACTIVE").notNull(),
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  resolvedBy: integer("resolvedBy"),
  resolvedAt: timestamp("resolvedAt"),
  resolutionNotes: text("resolutionNotes"),
  // Notification
  notificationSent: boolean("notificationSent").default(false).notNull(),
  notificationSentAt: timestamp("notificationSentAt"),
  // Timestamps
  expiresAt: timestamp("expiresAt"), // Alert expiration
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_predictive_alerts_type").on(table.alertType),
  index("idx_predictive_alerts_severity").on(table.severity),
  index("idx_predictive_alerts_status").on(table.status),
  index("idx_predictive_alerts_machine").on(table.machineId),
  index("idx_predictive_alerts_product").on(table.productModelId),
  index("idx_predictive_alerts_factory").on(table.factoryId),
  index("idx_predictive_alerts_created").on(table.createdAt),
  index("idx_predictive_alerts_expires").on(table.expiresAt),
]);

export type PredictiveAlert = typeof predictiveAlerts.$inferSelect;
export type InsertPredictiveAlert = typeof predictiveAlerts.$inferInsert;


// ============= Root Cause Analysis =============

/**
 * Root Cause Analysis Results - Kết quả phân tích nguyên nhân gốc rễ
 */
export const rootCauseAnalysis = pgTable("root_cause_analysis", {
  id: serial("id").primaryKey(),
  analysisType: analysisTypeEnum("analysisType").notNull(),
  // Scope
  machineId: integer("machineId"),
  machineCode: varchar("machineCode", { length: 50 }),
  productModelId: integer("productModelId"),
  productModelCode: varchar("productModelCode", { length: 50 }),
  factoryId: integer("factoryId"),
  // Time range analyzed
  startDate: timestamp("startDate").notNull(),
  endDate: timestamp("endDate").notNull(),
  // Analysis results
  dataPointsAnalyzed: integer("dataPointsAnalyzed").notNull(),
  correlationMatrix: json("correlationMatrix").$type<Array<{
    factor1: string;
    factor2: string;
    correlation: number; // -1 to 1
    significance: number; // p-value
  }>>(),
  topFactors: json("topFactors").$type<Array<{
    factor: string;
    contribution: number; // Percentage contribution
    description: string;
    trend: "increasing" | "decreasing" | "stable";
  }>>().notNull(),
  // AI insights
  aiInsights: json("aiInsights").$type<{
    summary: string;
    rootCauses: Array<{cause: string; probability: number; evidence: string}>;
    recommendations: Array<{action: string; priority: "high" | "medium" | "low"; expectedImpact: string}>;
    preventiveMeasures: string[];
  }>(),
  // Pareto analysis
  paretoData: json("paretoData").$type<Array<{
    category: string;
    count: number;
    percentage: number;
    cumulativePercentage: number;
  }>>(),
  // Status
  status: statusEnum_6("status").default("COMPLETED").notNull(),
  errorMessage: text("errorMessage"),
  // Metadata
  requestedBy: integer("requestedBy").notNull(),
  requestedByName: varchar("requestedByName", { length: 255 }),
  processingTime: integer("processingTime"), // Milliseconds
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_rca_type").on(table.analysisType),
  index("idx_rca_machine").on(table.machineId),
  index("idx_rca_product").on(table.productModelId),
  index("idx_rca_factory").on(table.factoryId),
  index("idx_rca_status").on(table.status),
  index("idx_rca_created").on(table.createdAt),
  index("idx_rca_date_range").on(table.startDate, table.endDate),
]);

export type RootCauseAnalysis = typeof rootCauseAnalysis.$inferSelect;
export type InsertRootCauseAnalysis = typeof rootCauseAnalysis.$inferInsert;


// ============= History Export Scheduling =============

/**
 * History Export Schedules - Lịch tự động xuất báo cáo lịch sử
 */
export const historyExportSchedules = pgTable("history_export_schedules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Schedule configuration
  scheduleType: scheduleEnum("scheduleType").default("DAILY").notNull(),
  scheduleTime: varchar("scheduleTime", { length: 10 }).default("08:00").notNull(), // HH:mm format
  scheduleDayOfWeek: integer("scheduleDayOfWeek"), // 0-6 for weekly (0=Sunday)
  scheduleDayOfMonth: integer("scheduleDayOfMonth"), // 1-31 for monthly
  // Export configuration
  exportFormat: exportFormatEnum("exportFormat").default("CSV").notNull(),
  // Filters
  factoryId: integer("factoryId"),
  workshopId: integer("workshopId"),
  lineId: integer("lineId"),
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  resultFilter: resultFilterEnum("resultFilter").default("ALL").notNull(),
  // Time range for export
  timeRangeType: timeRangeTypeEnum("timeRangeType").default("LAST_24H").notNull(),
  customDays: integer("customDays"), // For custom time range
  // Email recipients
  recipients: json("recipients").$type<string[]>().notNull(),
  // Include options
  includeImages: boolean("includeImages").default(false).notNull(),
  includeAnnotations: boolean("includeAnnotations").default(true).notNull(),
  includeMeasurements: boolean("includeMeasurements").default(true).notNull(),
  includeSummaryStats: boolean("includeSummaryStats").default(true).notNull(),
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  lastRunAt: timestamp("lastRunAt"),
  lastRunStatus: statusEnum_3("lastRunStatus").default("PENDING"),
  lastRunError: text("lastRunError"),
  nextRunAt: timestamp("nextRunAt"),
  // Metadata
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_export_schedule_type").on(table.scheduleType),
  index("idx_export_schedule_active").on(table.isActive),
  index("idx_export_schedule_next").on(table.nextRunAt),
  index("idx_export_schedule_creator").on(table.createdBy),
]);

export type HistoryExportSchedule = typeof historyExportSchedules.$inferSelect;
export type InsertHistoryExportSchedule = typeof historyExportSchedules.$inferInsert;

/**
 * History Export Logs - Lịch sử chạy export
 */
export const historyExportLogs = pgTable("history_export_logs", {
  id: serial("id").primaryKey(),
  scheduleId: integer("scheduleId").notNull(), // FK to historyExportSchedules
  status: statusEnum_7("status").default("PENDING").notNull(),
  // Export details
  recordCount: integer("recordCount").default(0).notNull(),
  fileSize: integer("fileSize").default(0).notNull(), // Bytes
  fileUrl: text("fileUrl"), // URL to exported file
  // Email delivery
  recipientCount: integer("recipientCount").default(0).notNull(),
  deliveredCount: integer("deliveredCount").default(0).notNull(),
  failedCount: integer("failedCount").default(0).notNull(),
  // Error handling
  errorMessage: text("errorMessage"),
  // Timing
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  processingTimeMs: integer("processingTimeMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_export_log_schedule").on(table.scheduleId),
  index("idx_export_log_status").on(table.status),
  index("idx_export_log_started").on(table.startedAt),
]);

export type HistoryExportLog = typeof historyExportLogs.$inferSelect;
export type InsertHistoryExportLog = typeof historyExportLogs.$inferInsert;


// ============ PHASE 163: ANNOTATION COMPARISON, DEFECT HEATMAP, AI FEEDBACK ============

/**
 * Annotation Comparison Sessions - Phiên so sánh annotations
 */
export const annotationComparisonSessions = pgTable("annotation_comparison_sessions", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Scope
  productModelId: integer("productModelId"),
  serialNumber: varchar("serialNumber", { length: 100 }),
  machineId: integer("machineId"),
  // Inspections to compare
  inspectionIds: json("inspectionIds").$type<number[]>().notNull(),
  // Comparison result
  comparisonResult: json("comparisonResult").$type<{
    totalAnnotations: number;
    matchingAnnotations: number;
    newAnnotations: number;
    removedAnnotations: number;
    modifiedAnnotations: number;
    matchPercentage: number;
    patterns: Array<{
      type: string;
      description: string;
      affectedPoints: number[];
    }>;
    timeline: Array<{
      inspectionId: number;
      timestamp: string;
      annotationCount: number;
      changes: string[];
    }>;
  }>(),
  // Pattern detection
  detectedPatterns: json("detectedPatterns").$type<Array<{
    id: string;
    name: string;
    type: "recurring" | "progressive" | "intermittent" | "new";
    severity: "critical" | "warning" | "info";
    description: string;
    affectedArea: { x: number; y: number; width: number; height: number };
    frequency: number;
    firstSeen: string;
    lastSeen: string;
    recommendations: string[];
  }>>(),
  // Status
  status: statusEnum_8("status").default("PENDING").notNull(),
  errorMessage: text("errorMessage"),
  // Metadata
  createdBy: integer("createdBy").notNull(),
  createdByName: varchar("createdByName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_comparison_product").on(table.productModelId),
  index("idx_comparison_serial").on(table.serialNumber),
  index("idx_comparison_machine").on(table.machineId),
  index("idx_comparison_status").on(table.status),
  index("idx_comparison_created").on(table.createdAt),
]);

export type AnnotationComparisonSession = typeof annotationComparisonSessions.$inferSelect;
export type InsertAnnotationComparisonSession = typeof annotationComparisonSessions.$inferInsert;

/**
 * Defect Heatmap Data - Dữ liệu heatmap defects
 */
export const defectHeatmapData = pgTable("defect_heatmap_data", {
  id: serial("id").primaryKey(),
  // Scope
  factoryId: integer("factoryId"),
  workshopId: integer("workshopId"),
  lineId: integer("lineId"),
  stationId: integer("stationId"),
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  // Time period
  periodType: periodTypeEnum_1("periodType").notNull(),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  // Heatmap grid
  gridWidth: integer("gridWidth").notNull(),
  gridHeight: integer("gridHeight").notNull(),
  heatmapGrid: json("heatmapGrid").$type<number[][]>().notNull(),
  // Statistics
  totalDefects: integer("totalDefects").default(0).notNull(),
  maxDefectsInCell: integer("maxDefectsInCell").default(0).notNull(),
  // Hotspots
  hotspots: json("hotspots").$type<Array<{
    x: number;
    y: number;
    defectCount: number;
    defectTypes: Array<{ type: string; count: number }>;
    percentage: number;
  }>>(),
  // Top locations
  topLocations: json("topLocations").$type<Array<{
    gridX: number;
    gridY: number;
    realX: number;
    realY: number;
    defectCount: number;
    defectTypes: string[];
    trend: "increasing" | "decreasing" | "stable";
  }>>(),
  // Metadata
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  processingTimeMs: integer("processingTimeMs"),
}, (table) => [
  index("idx_heatmap_factory").on(table.factoryId),
  index("idx_heatmap_machine").on(table.machineId),
  index("idx_heatmap_product").on(table.productModelId),
  index("idx_heatmap_period").on(table.periodType),
  index("idx_heatmap_generated").on(table.generatedAt),
]);

export type DefectHeatmapData = typeof defectHeatmapData.$inferSelect;
export type InsertDefectHeatmapData = typeof defectHeatmapData.$inferInsert;

/**
 * AI Suggestions - Gợi ý từ AI
 */
export const aiSuggestions = pgTable("ai_suggestions", {
  id: serial("id").primaryKey(),
  // Context
  inspectionId: integer("inspectionId").notNull(),
  measurementResultId: integer("measurementResultId"),
  // Suggestion
  suggestionType: suggestionTypeEnum("suggestionType").notNull(),
  suggestion: text("suggestion").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull(),
  reasoning: text("reasoning"),
  // Alternatives
  alternatives: json("alternatives").$type<Array<{
    suggestion: string;
    confidence: number;
  }>>(),
  // Model info
  modelVersion: varchar("modelVersion", { length: 50 }).notNull(),
  modelName: varchar("modelName", { length: 100 }).notNull(),
  // Status
  status: statusEnum_9("status").default("PENDING").notNull(),
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_suggestion_inspection").on(table.inspectionId),
  index("idx_ai_suggestion_type").on(table.suggestionType),
  index("idx_ai_suggestion_status").on(table.status),
  index("idx_ai_suggestion_model").on(table.modelName, table.modelVersion),
]);

export type AiSuggestion = typeof aiSuggestions.$inferSelect;
export type InsertAiSuggestion = typeof aiSuggestions.$inferInsert;

/**
 * AI Feedback - Phản hồi của user cho AI suggestions
 */
export const aiFeedback = pgTable("ai_feedback", {
  id: serial("id").primaryKey(),
  suggestionId: integer("suggestionId").notNull(),
  // Feedback
  feedbackType: feedbackTypeEnum("feedbackType").notNull(),
  accuracy: integer("accuracy"), // 0-100
  correctedValue: text("correctedValue"),
  correctionNotes: text("correctionNotes"),
  // Error categorization
  errorCategory: errorCategoryEnum("errorCategory"),
  // Training data
  includedInTraining: boolean("includedInTraining").default(false).notNull(),
  trainingBatchId: varchar("trainingBatchId", { length: 100 }),
  // Metadata
  feedbackBy: integer("feedbackBy").notNull(),
  feedbackByName: varchar("feedbackByName", { length: 255 }),
  feedbackAt: timestamp("feedbackAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_feedback_suggestion").on(table.suggestionId),
  index("idx_ai_feedback_type").on(table.feedbackType),
  index("idx_ai_feedback_training").on(table.includedInTraining),
  index("idx_ai_feedback_batch").on(table.trainingBatchId),
]);

export type AiFeedback = typeof aiFeedback.$inferSelect;
export type InsertAiFeedback = typeof aiFeedback.$inferInsert;

/**
 * AI Model Metrics - Metrics cho AI models
 */
export const aiModelMetrics = pgTable("ai_model_metrics", {
  id: serial("id").primaryKey(),
  modelName: varchar("modelName", { length: 100 }).notNull(),
  modelVersion: varchar("modelVersion", { length: 50 }).notNull(),
  // Time period
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  // Metrics
  totalSuggestions: integer("totalSuggestions").default(0).notNull(),
  reviewedSuggestions: integer("reviewedSuggestions").default(0).notNull(),
  correctCount: integer("correctCount").default(0).notNull(),
  incorrectCount: integer("incorrectCount").default(0).notNull(),
  partialCount: integer("partialCount").default(0).notNull(),
  accuracy: decimal("accuracy", { precision: 5, scale: 4 }),
  // Breakdown by type
  metricsByType: json("metricsByType").$type<Array<{
    suggestionType: string;
    total: number;
    correct: number;
    incorrect: number;
    accuracy: number;
  }>>(),
  // Error breakdown
  errorBreakdown: json("errorBreakdown").$type<Array<{
    category: string;
    count: number;
    percentage: number;
  }>>(),
  // Trend
  accuracyTrend: accuracyTrendEnum("accuracyTrend").default("STABLE"),
  // Metadata
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_metrics_model").on(table.modelName, table.modelVersion),
  index("idx_ai_metrics_period").on(table.periodStart, table.periodEnd),
]);

export type AiModelMetrics = typeof aiModelMetrics.$inferSelect;
export type InsertAiModelMetrics = typeof aiModelMetrics.$inferInsert;

/**
 * AI Training Batches - Batches cho training AI
 */
export const aiTrainingBatches = pgTable("ai_training_batches", {
  id: serial("id").primaryKey(),
  batchId: varchar("batchId", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Content
  feedbackCount: integer("feedbackCount").default(0).notNull(),
  correctSamples: integer("correctSamples").default(0).notNull(),
  incorrectSamples: integer("incorrectSamples").default(0).notNull(),
  // Export
  exportFormat: exportFormatEnum_1("exportFormat").default("JSONL").notNull(),
  exportUrl: text("exportUrl"),
  // Status
  status: statusEnum_10("status").default("PENDING").notNull(),
  // Target model
  targetModelName: varchar("targetModelName", { length: 100 }),
  targetModelVersion: varchar("targetModelVersion", { length: 50 }),
  // Metadata
  createdBy: integer("createdBy").notNull(),
  createdByName: varchar("createdByName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => [
  index("idx_training_batch_id").on(table.batchId),
  index("idx_training_batch_status").on(table.status),
  index("idx_training_batch_created").on(table.createdAt),
]);

export type AiTrainingBatch = typeof aiTrainingBatches.$inferSelect;
export type InsertAiTrainingBatch = typeof aiTrainingBatches.$inferInsert;


/**
 * Training Batch Comments - Nhận xét cho từng lô đào tạo AI
 */
export const trainingBatchComments = pgTable("training_batch_comments", {
  id: serial("id").primaryKey(),
  batchId: varchar("batchId", { length: 100 }).notNull(),
  userId: integer("userId").notNull(),
  userName: varchar("userName", { length: 255 }),
  content: text("content").notNull(),
  parentId: integer("parentId"), // For nested comments/replies
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_batch_comment_batch").on(table.batchId),
  index("idx_batch_comment_user").on(table.userId),
  index("idx_batch_comment_parent").on(table.parentId),
]);

export type TrainingBatchComment = typeof trainingBatchComments.$inferSelect;
export type InsertTrainingBatchComment = typeof trainingBatchComments.$inferInsert;

/**
 * Training Batch Tags - Thẻ cho phân loại lô đào tạo
 */
export const trainingBatchTags = pgTable("training_batch_tags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  color: varchar("color", { length: 20 }).default("#3b82f6").notNull(), // Hex color
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_batch_tag_name").on(table.name),
]);

export type TrainingBatchTag = typeof trainingBatchTags.$inferSelect;
export type InsertTrainingBatchTag = typeof trainingBatchTags.$inferInsert;

/**
 * Training Batch Tag Assignments - Gán thẻ cho lô đào tạo
 */
export const trainingBatchTagAssignments = pgTable("training_batch_tag_assignments", {
  id: serial("id").primaryKey(),
  batchId: varchar("batchId", { length: 100 }).notNull(),
  tagId: integer("tagId").notNull(),
  assignedBy: integer("assignedBy").notNull(),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_batch_tag_assign_batch").on(table.batchId),
  index("idx_batch_tag_assign_tag").on(table.tagId),
]);

export type TrainingBatchTagAssignment = typeof trainingBatchTagAssignments.$inferSelect;
export type InsertTrainingBatchTagAssignment = typeof trainingBatchTagAssignments.$inferInsert;


// ============= MQTT Client Management =============

/**
 * MQTT Client Profiles - Cấu hình MQTT tập trung
 */
export const mqttClientProfiles = pgTable("mqtt_client_profiles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  
  // Broker Configuration
  brokerUrl: varchar("brokerUrl", { length: 500 }).notNull(),
  port: integer("port").default(1883).notNull(),
  protocol: protocolEnum_1("protocol").default("mqtt").notNull(),
  
  // Authentication
  username: varchar("username", { length: 255 }),
  password: varchar("password", { length: 255 }),
  clientIdPrefix: varchar("clientIdPrefix", { length: 100 }),
  
  // TLS/SSL Settings
  useTls: boolean("useTls").default(false).notNull(),
  tlsCertPath: text("tlsCertPath"),
  tlsKeyPath: text("tlsKeyPath"),
  tlsCaPath: text("tlsCaPath"),
  rejectUnauthorized: boolean("rejectUnauthorized").default(true).notNull(),
  
  // Connection Settings
  keepAlive: integer("keepAlive").default(60).notNull(), // seconds
  connectTimeout: integer("connectTimeout").default(30000).notNull(), // ms
  reconnectPeriod: integer("reconnectPeriod").default(5000).notNull(), // ms
  cleanSession: boolean("cleanSession").default(true).notNull(),
  
  // Auto-Reconnect Settings
  maxReconnectAttempts: integer("maxReconnectAttempts").default(10).notNull(), // 0 = unlimited
  reconnectBackoffMultiplier: decimal("reconnectBackoffMultiplier", { precision: 3, scale: 1 }).default("1.5").notNull(), // Exponential backoff
  maxReconnectDelay: integer("maxReconnectDelay").default(60000).notNull(), // Max delay between reconnects (ms)
  autoReconnect: boolean("autoReconnect").default(true).notNull(), // Enable/disable auto-reconnect
  
  // QoS Settings
  defaultQos: defaultQosEnum("defaultQos").default("1").notNull(),
  
  // Topic Configuration (JSON array)
  subscribeTopics: json("subscribeTopics").$type<string[]>().default([]),
  publishTopics: json("publishTopics").$type<string[]>().default([]),
  
  // Message Settings
  messageRetain: boolean("messageRetain").default(false).notNull(),
  
  // Status
  isDefault: boolean("isDefault").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  
  // Metadata
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_profiles_name").on(table.name),
  index("idx_mqtt_profiles_active").on(table.isActive),
  index("idx_mqtt_profiles_default").on(table.isDefault),
]);

export type MqttClientProfile = typeof mqttClientProfiles.$inferSelect;
export type InsertMqttClientProfile = typeof mqttClientProfiles.$inferInsert;

/**
 * MQTT Profile Assignments - Gán profile cho máy/station
 */
export const mqttProfileAssignments = pgTable("mqtt_profile_assignments", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId").notNull(),
  
  // Target type: machine, station, or factory
  targetType: targetTypeEnum("targetType").notNull(),
  targetId: integer("targetId").notNull(),
  
  // Override settings (JSON - partial override of profile settings)
  overrideSettings: json("overrideSettings").$type<{
    subscribeTopics?: string[];
    publishTopics?: string[];
    qos?: string;
    clientIdSuffix?: string;
  }>(),
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  
  // Metadata
  assignedBy: integer("assignedBy"),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_assignments_profile").on(table.profileId),
  index("idx_mqtt_assignments_target").on(table.targetType, table.targetId),
]);

export type MqttProfileAssignment = typeof mqttProfileAssignments.$inferSelect;
export type InsertMqttProfileAssignment = typeof mqttProfileAssignments.$inferInsert;

/**
 * MQTT Connection Logs - Lịch sử kết nối
 */
export const mqttConnectionLogs = pgTable("mqtt_connection_logs", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId"),
  assignmentId: integer("assignmentId"),
  
  // Connection Info
  clientId: varchar("clientId", { length: 255 }).notNull(),
  brokerUrl: varchar("brokerUrl", { length: 500 }).notNull(),
  
  // Event
  eventType: eventTypeEnum("eventType").notNull(),
  eventMessage: text("eventMessage"),
  errorCode: varchar("errorCode", { length: 50 }),
  
  // Metadata
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_conn_logs_profile").on(table.profileId),
  index("idx_mqtt_conn_logs_client").on(table.clientId),
  index("idx_mqtt_conn_logs_event").on(table.eventType),
  index("idx_mqtt_conn_logs_timestamp").on(table.timestamp),
]);

export type MqttConnectionLog = typeof mqttConnectionLogs.$inferSelect;
export type InsertMqttConnectionLog = typeof mqttConnectionLogs.$inferInsert;

/**
 * MQTT Topic Templates - Mẫu topic cho các loại thiết bị
 */
export const mqttTopicTemplates = pgTable("mqtt_topic_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  
  // Device Type
  deviceType: deviceTypeEnum("deviceType").notNull(),
  
  // Topic Patterns (với placeholders: {factory}, {line}, {machine}, {serial})
  inspectionResultTopic: varchar("inspectionResultTopic", { length: 500 }),
  ngAlertTopic: varchar("ngAlertTopic", { length: 500 }),
  statusTopic: varchar("statusTopic", { length: 500 }),
  commandTopic: varchar("commandTopic", { length: 500 }),
  heartbeatTopic: varchar("heartbeatTopic", { length: 500 }),
  
  // Message Format
  messageFormat: messageFormatEnum("messageFormat").default("json").notNull(),
  
  // Sample Messages (JSON)
  sampleMessages: json("sampleMessages").$type<{
    inspectionResult?: object;
    ngAlert?: object;
    status?: object;
  }>(),
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_templates_device").on(table.deviceType),
  index("idx_mqtt_templates_active").on(table.isActive),
]);

export type MqttTopicTemplate = typeof mqttTopicTemplates.$inferSelect;
export type InsertMqttTopicTemplate = typeof mqttTopicTemplates.$inferInsert;


/**
 * MQTT Reconnect Logs - Lịch sử reconnect để phân tích độ ổn định
 */
export const mqttReconnectLogs = pgTable("mqtt_reconnect_logs", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId").notNull(),
  assignmentId: integer("assignmentId"),
  
  // Target Info
  targetType: targetTypeEnum("targetType"),
  targetId: integer("targetId"),
  
  // Reconnect Event
  eventType: eventTypeEnum_1("eventType").notNull(),
  attemptNumber: integer("attemptNumber").default(1).notNull(),
  
  // Timing
  reconnectDelay: integer("reconnectDelay"), // Delay before this attempt (ms)
  connectionDuration: integer("connectionDuration"), // How long was connected before disconnect (ms)
  
  // Error Info
  errorCode: varchar("errorCode", { length: 100 }),
  errorMessage: text("errorMessage"),
  
  // Connection Details
  clientId: varchar("clientId", { length: 255 }),
  brokerUrl: varchar("brokerUrl", { length: 500 }),
  
  // Metadata
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_reconnect_profile").on(table.profileId),
  index("idx_reconnect_assignment").on(table.assignmentId),
  index("idx_reconnect_event").on(table.eventType),
  index("idx_reconnect_timestamp").on(table.timestamp),
  index("idx_reconnect_target").on(table.targetType, table.targetId),
]);

export type MqttReconnectLog = typeof mqttReconnectLogs.$inferSelect;
export type InsertMqttReconnectLog = typeof mqttReconnectLogs.$inferInsert;

/**
 * MQTT Connection Status - Trạng thái kết nối real-time
 */
export const mqttConnectionStatus = pgTable("mqtt_connection_status", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId").notNull(),
  assignmentId: integer("assignmentId"),
  
  // Target Info
  targetType: targetTypeEnum("targetType"),
  targetId: integer("targetId"),
  
  // Status
  status: statusEnum_11("status").default("unknown").notNull(),
  
  // Connection Info
  clientId: varchar("clientId", { length: 255 }),
  brokerUrl: varchar("brokerUrl", { length: 500 }),
  
  // Timing
  connectedAt: timestamp("connectedAt"),
  disconnectedAt: timestamp("disconnectedAt"),
  lastHeartbeat: timestamp("lastHeartbeat"),
  uptime: integer("uptime").default(0), // Total uptime in seconds
  
  // Stats
  reconnectCount: integer("reconnectCount").default(0).notNull(),
  totalConnectionTime: integer("totalConnectionTime").default(0), // Total time connected (seconds)
  lastErrorMessage: text("lastErrorMessage"),
  lastErrorCode: varchar("lastErrorCode", { length: 100 }),
  
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_conn_status_profile").on(table.profileId),
  index("idx_conn_status_assignment").on(table.assignmentId),
  index("idx_conn_status_status").on(table.status),
  index("idx_conn_status_target").on(table.targetType, table.targetId),
]);

export type MqttConnectionStatus = typeof mqttConnectionStatus.$inferSelect;
export type InsertMqttConnectionStatus = typeof mqttConnectionStatus.$inferInsert;


/**
 * MQTT Connection Alerts - Cảnh báo mất kết nối
 */
export const mqttConnectionAlerts = pgTable("mqtt_connection_alerts", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId").notNull(),
  assignmentId: integer("assignmentId"),
  
  // Target Info
  targetType: targetTypeEnum("targetType"),
  targetId: integer("targetId"),
  
  // Alert Info
  alertType: alertTypeEnum_2("alertType").notNull(),
  severity: severityEnum("severity").default("warning").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  
  // Timing
  triggeredAt: timestamp("triggeredAt").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledgedAt"),
  acknowledgedBy: integer("acknowledgedBy"),
  resolvedAt: timestamp("resolvedAt"),
  
  // Threshold Config
  thresholdMinutes: integer("thresholdMinutes").default(5), // Ngưỡng thời gian mất kết nối (phút)
  
  // Status
  isAcknowledged: boolean("isAcknowledged").default(false).notNull(),
  isResolved: boolean("isResolved").default(false).notNull(),
  
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mqtt_alert_profile").on(table.profileId),
  index("idx_mqtt_alert_assignment").on(table.assignmentId),
  index("idx_mqtt_alert_type").on(table.alertType),
  index("idx_mqtt_alert_severity").on(table.severity),
  index("idx_mqtt_alert_acknowledged").on(table.isAcknowledged),
  index("idx_mqtt_alert_triggered").on(table.triggeredAt),
]);
export type MqttConnectionAlert = typeof mqttConnectionAlerts.$inferSelect;
export type InsertMqttConnectionAlert = typeof mqttConnectionAlerts.$inferInsert;

/**
 * MQTT Alert Configuration - Cấu hình cảnh báo
 */
export const mqttAlertConfig = pgTable("mqtt_alert_config", {
  id: serial("id").primaryKey(),
  profileId: integer("profileId"), // null = global config
  
  // Thresholds
  connectionLostThreshold: integer("connectionLostThreshold").default(5).notNull(), // Phút
  reconnectFailedThreshold: integer("reconnectFailedThreshold").default(10).notNull(), // Số lần thất bại liên tiếp
  highReconnectRateThreshold: integer("highReconnectRateThreshold").default(20).notNull(), // Số lần reconnect trong 1 giờ
  longDisconnectionThreshold: integer("longDisconnectionThreshold").default(30).notNull(), // Phút
  
  // Notification Settings
  enableEmailNotification: boolean("enableEmailNotification").default(false).notNull(),
  enablePushNotification: boolean("enablePushNotification").default(true).notNull(),
  notificationEmails: text("notificationEmails"), // Comma-separated emails
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_alert_config_profile").on(table.profileId),
  index("idx_alert_config_active").on(table.isActive),
]);
export type MqttAlertConfig = typeof mqttAlertConfig.$inferSelect;
export type InsertMqttAlertConfig = typeof mqttAlertConfig.$inferInsert;
