// Schema domain: Production tables
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, index, uniqueIndex, json } from "drizzle-orm/pg-core";
import { statusEnum, processTypeEnum_1, sessionStatusEnum } from "./enums";

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
  uniqueIndex("uq_stats_machine_date").on(table.machineId, table.date),
  index("idx_stats_factory_date").on(table.factoryId, table.date),
  index("idx_stats_workshop_date").on(table.workshopId, table.date),
  index("idx_stats_date").on(table.date),
]);

export type DailyStatistics = typeof dailyStatistics.$inferSelect;
export type InsertDailyStatistics = typeof dailyStatistics.$inferInsert;

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
  // ── W0-F G5.6 (doc 44, migration 0250; additive, nullable) ──
  // Định danh đơn hàng phía HỆ THỐNG NGOÀI (ERP/MES) để đối soát 2 chiều:
  // external_id = id/mã đơn bên nguồn, source_system = hệ nguồn (vd. "SAP",
  // "oracle-mes", "b2mml"). Unique partial (external_id, source_system) WHERE
  // external_id IS NOT NULL — mỗi đơn nguồn chỉ map 1 lệnh; đơn tạo tay giữ NULL.
  externalId: text("external_id"),
  sourceSystem: text("source_system"),
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
  uniqueIndex("uq_po_external_source")
    .on(table.externalId, table.sourceSystem)
    .where(sql`"external_id" IS NOT NULL`),
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

/**
 * Production Sessions - ISA-95 Level 3 shift session entity
 * Tracks operator sign-in, shift KPIs, handover, and supervisor sign-off
 */
export const productionSessions = pgTable("production_sessions", {
  id: serial("id").primaryKey(),
  sessionCode: varchar("sessionCode", { length: 64 }).notNull().unique(),
  shiftConfigId: integer("shiftConfigId").notNull(),
  factoryId: integer("factoryId").notNull(),
  workshopId: integer("workshopId").notNull(),
  lineId: integer("lineId"),
  productionOrderId: integer("productionOrderId"),
  operatorId: integer("operatorId").notNull(),
  supervisorId: integer("supervisorId"),
  status: sessionStatusEnum("status").default("open").notNull(),
  shiftDate: timestamp("shiftDate").notNull(),
  plannedStart: timestamp("plannedStart").notNull(),
  plannedEnd: timestamp("plannedEnd").notNull(),
  actualStart: timestamp("actualStart").notNull(),
  actualEnd: timestamp("actualEnd"),
  // Shift handover
  handoverToSessionId: integer("handoverToSessionId"),
  handoverNotes: text("handoverNotes"),
  // KPI snapshot captured at session close (total, ok, ng, oee, yield)
  kpiSnapshot: json("kpiSnapshot").$type<{
    totalCount: number;
    okCount: number;
    ngCount: number;
    yieldRate: number;
    oeePercent: number | null;
    avgCycleTimeMs: number | null;
  }>(),
  operatorNotes: text("operatorNotes"),
  // 21 CFR Part 11 §11.70 electronic supervisor sign-off
  // Cryptographic binding: signoffSignature = HMAC-SHA256(SIGNOFF_SECRET, signoffPayload)
  supervisorSignoff: boolean("supervisorSignoff").default(false).notNull(),
  supervisorSignoffAt: timestamp("supervisorSignoffAt"),
  signoffPayload: text("signoffPayload"),
  signoffPayloadHash: varchar("signoffPayloadHash", { length: 64 }),
  signoffSignature: varchar("signoffSignature", { length: 128 }),
  signoffAlgorithm: varchar("signoffAlgorithm", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ps_shift_config").on(table.shiftConfigId),
  index("idx_ps_factory").on(table.factoryId),
  index("idx_ps_workshop").on(table.workshopId),
  index("idx_ps_line").on(table.lineId),
  index("idx_ps_operator").on(table.operatorId),
  index("idx_ps_status").on(table.status),
  index("idx_ps_shift_date").on(table.shiftDate),
  index("idx_ps_order").on(table.productionOrderId),
]);

export type ProductionSession = typeof productionSessions.$inferSelect;
export type InsertProductionSession = typeof productionSessions.$inferInsert;
