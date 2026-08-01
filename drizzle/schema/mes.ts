// Schema domain: MES / WIP / Traceability / Predictive Maintenance (Giai đoạn 2 — G5/G6/G7)
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  wipStatusEnum,
  lotDispositionEnum,
  supplierLotStatusEnum,
  maintenanceScheduleTypeEnum,
  workOrderStatusEnum,
  workOrderTypeEnum,
  workOrderTriggerEnum,
} from "./enums";

// =============================================================
// G5 — WIP & Material Flow
// =============================================================

/**
 * WIP Tracking - Theo dõi bán thành phẩm (work-in-process) qua các trạm
 * Mỗi bản ghi đại diện cho 1 đơn vị/lot đang di chuyển trong dây chuyền.
 */
export const wipTracking = pgTable("wip_tracking", {
  id: serial("id").primaryKey(),
  serialNumber: varchar("serialNumber", { length: 128 }),
  lotNumber: varchar("lotNumber", { length: 128 }),
  productId: integer("productId"),
  productCode: varchar("productCode", { length: 64 }),
  workOrderNumber: varchar("workOrderNumber", { length: 64 }),
  lineId: integer("lineId"),
  currentStationId: integer("currentStationId"),
  currentMachineId: integer("currentMachineId"),
  status: wipStatusEnum("status").default("queued").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  enteredAt: timestamp("enteredAt").defaultNow().notNull(),
  exitedAt: timestamp("exitedAt"),
  parentSerialNumber: varchar("parentSerialNumber", { length: 128 }), // genealogy upstream
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_wip_serial").on(table.serialNumber),
  index("idx_wip_lot").on(table.lotNumber),
  index("idx_wip_line").on(table.lineId),
  index("idx_wip_station").on(table.currentStationId),
  index("idx_wip_status").on(table.status),
  index("idx_wip_entered").on(table.enteredAt),
]);

export type WipTracking = typeof wipTracking.$inferSelect;
export type InsertWipTracking = typeof wipTracking.$inferInsert;

/**
 * Station Dwell Time - Thời gian lưu tại trạm + thời lượng starved/blocked
 * Dùng cho phân tích cân bằng chuyền và phát hiện nút thắt cổ chai.
 */
export const stationDwellTime = pgTable("station_dwell_time", {
  id: serial("id").primaryKey(),
  lineId: integer("lineId"),
  stationId: integer("stationId").notNull(),
  machineId: integer("machineId"),
  serialNumber: varchar("serialNumber", { length: 128 }),
  lotNumber: varchar("lotNumber", { length: 128 }),
  dwellMs: integer("dwellMs").default(0).notNull(),       // tổng thời gian tại trạm
  processingMs: integer("processingMs").default(0).notNull(),
  starvedMs: integer("starvedMs").default(0).notNull(),   // chờ vật liệu từ thượng nguồn
  blockedMs: integer("blockedMs").default(0).notNull(),   // bị chặn bởi hạ nguồn
  enteredAt: timestamp("enteredAt").defaultNow().notNull(),
  exitedAt: timestamp("exitedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_dwell_station").on(table.stationId),
  index("idx_dwell_line").on(table.lineId),
  index("idx_dwell_machine").on(table.machineId),
  index("idx_dwell_entered").on(table.enteredAt),
]);

export type StationDwellTime = typeof stationDwellTime.$inferSelect;
export type InsertStationDwellTime = typeof stationDwellTime.$inferInsert;

/**
 * Line Balance Metrics - Chỉ số cân bằng chuyền theo chu kỳ
 * Tổng hợp cycle time, nút thắt, hiệu suất theo từng chu kỳ thời gian.
 */
export const lineBalanceMetrics = pgTable("line_balance_metrics", {
  id: serial("id").primaryKey(),
  lineId: integer("lineId").notNull(),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  taktTimeMs: integer("taktTimeMs"),                       // nhịp khách hàng yêu cầu
  avgCycleTimeMs: integer("avgCycleTimeMs"),
  maxCycleTimeMs: integer("maxCycleTimeMs"),
  bottleneckStationId: integer("bottleneckStationId"),
  bottleneckMachineId: integer("bottleneckMachineId"),
  utilizationPct: decimal("utilizationPct", { precision: 5, scale: 2 }),
  balanceRatePct: decimal("balanceRatePct", { precision: 5, scale: 2 }), // hệ số cân bằng chuyền
  throughputUnits: integer("throughputUnits").default(0).notNull(),
  wipCount: integer("wipCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_linebal_line").on(table.lineId),
  index("idx_linebal_period").on(table.periodStart),
]);

export type LineBalanceMetric = typeof lineBalanceMetrics.$inferSelect;
export type InsertLineBalanceMetric = typeof lineBalanceMetrics.$inferInsert;

// =============================================================
// G6 — Material Traceability (genealogy 2 chiều)
// =============================================================

/**
 * Material Receipts - Phiếu nhận vật liệu từ nhà cung cấp
 */
export const materialReceipts = pgTable("material_receipts", {
  id: serial("id").primaryKey(),
  receiptNumber: varchar("receiptNumber", { length: 64 }).notNull().unique(),
  supplierName: varchar("supplierName", { length: 256 }),
  supplierCode: varchar("supplierCode", { length: 64 }),
  // P2 master-data backbone: nullable FK alongside the free-text supplierCode
  // (transition period — text column kept; backfilled by code match in 0134).
  supplierId: integer("supplierId"),       // FK -> suppliers.id (nullable)
  materialCode: varchar("materialCode", { length: 64 }).notNull(),
  materialId: integer("materialId"),       // FK -> materials.id (nullable)
  materialName: varchar("materialName", { length: 256 }),
  quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 16 }).default("pcs").notNull(),
  receivedDate: timestamp("receivedDate").defaultNow().notNull(),
  poNumber: varchar("poNumber", { length: 64 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_matrecv_supplier").on(table.supplierCode),
  index("idx_matrecv_material").on(table.materialCode),
  index("idx_matrecv_supplierid").on(table.supplierId),
  index("idx_matrecv_materialid").on(table.materialId),
  index("idx_matrecv_date").on(table.receivedDate),
]);

export type MaterialReceipt = typeof materialReceipts.$inferSelect;
export type InsertMaterialReceipt = typeof materialReceipts.$inferInsert;

/**
 * Supplier Lots - Lot vật liệu theo nhà cung cấp (mắt xích genealogy thượng nguồn)
 */
export const supplierLots = pgTable("supplier_lots", {
  id: serial("id").primaryKey(),
  supplierLotNumber: varchar("supplierLotNumber", { length: 128 }).notNull(),
  receiptId: integer("receiptId"),       // FK -> material_receipts.id
  materialCode: varchar("materialCode", { length: 64 }).notNull(),
  materialId: integer("materialId"),     // P2: FK -> materials.id (nullable, backfilled by code)
  materialName: varchar("materialName", { length: 256 }),
  quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
  remainingQuantity: decimal("remainingQuantity", { precision: 14, scale: 3 }),
  unit: varchar("unit", { length: 16 }).default("pcs").notNull(),
  status: supplierLotStatusEnum("status").default("received").notNull(),
  expiryDate: timestamp("expiryDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_suplot_number").on(table.supplierLotNumber),
  index("idx_suplot_receipt").on(table.receiptId),
  index("idx_suplot_material").on(table.materialCode),
  index("idx_suplot_materialid").on(table.materialId),
  index("idx_suplot_status").on(table.status),
]);

export type SupplierLot = typeof supplierLots.$inferSelect;
export type InsertSupplierLot = typeof supplierLots.$inferInsert;

/**
 * Lot Disposition - Quyết định xử lý lot (rework/scrap/return/release...)
 * Liên kết tới supplier lot và/hoặc serial WIP để truy vết 2 chiều.
 */
export const lotDisposition = pgTable("lot_disposition", {
  id: serial("id").primaryKey(),
  lotNumber: varchar("lotNumber", { length: 128 }).notNull(),
  supplierLotId: integer("supplierLotId"),   // FK -> supplier_lots.id (genealogy upstream)
  serialNumber: varchar("serialNumber", { length: 128 }), // genealogy downstream
  disposition: lotDispositionEnum("disposition").notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
  reason: text("reason"),
  defectCode: varchar("defectCode", { length: 64 }),
  decidedBy: integer("decidedBy"),           // FK -> users.id
  decidedAt: timestamp("decidedAt").defaultNow().notNull(),
  customerReturnRef: varchar("customerReturnRef", { length: 128 }), // truy vết return từ khách
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_lotdisp_lot").on(table.lotNumber),
  index("idx_lotdisp_suplot").on(table.supplierLotId),
  index("idx_lotdisp_serial").on(table.serialNumber),
  index("idx_lotdisp_type").on(table.disposition),
]);

export type LotDisposition = typeof lotDisposition.$inferSelect;
export type InsertLotDisposition = typeof lotDisposition.$inferInsert;

// =============================================================
// G7 — Predictive Maintenance closed-loop
// =============================================================

/**
 * Maintenance Schedules - Lịch bảo trì theo thời gian/usage/điều kiện/dự đoán
 */
export const maintenanceSchedules = pgTable("maintenance_schedules", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 64 }),
  scheduleType: maintenanceScheduleTypeEnum("scheduleType").default("TIME_BASED").notNull(),
  taskName: varchar("taskName", { length: 256 }).notNull(),
  description: text("description"),
  intervalDays: integer("intervalDays"),         // cho TIME_BASED
  intervalUsageHours: integer("intervalUsageHours"), // cho USAGE_BASED
  lastPerformedAt: timestamp("lastPerformedAt"),
  nextDueAt: timestamp("nextDueAt"),
  isActive: boolean("isActive").default(true).notNull(),
  // ── U6-a (0156, additive, nullable) — tenant scope + inert RLS (G-9). NULL =
  // unscoped (allow-all under the inert app_tenant_allows policy). ──
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_msched_machine").on(table.machineId),
  index("idx_msched_due").on(table.nextDueAt),
  index("idx_msched_active").on(table.isActive),
]);

export type MaintenanceSchedule = typeof maintenanceSchedules.$inferSelect;
export type InsertMaintenanceSchedule = typeof maintenanceSchedules.$inferInsert;

/**
 * Maintenance Work Orders - Lệnh công việc bảo trì (đóng vòng PdM)
 * openedAt/closedAt phục vụ tính MTTR, repairStartedAt phục vụ MTBF.
 */
export const maintenanceWorkOrders = pgTable("maintenance_work_orders", {
  id: serial("id").primaryKey(),
  workOrderNumber: varchar("workOrderNumber", { length: 64 }).notNull().unique(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 64 }),
  scheduleId: integer("scheduleId"),          // FK -> maintenance_schedules.id
  type: workOrderTypeEnum("type").default("CORRECTIVE").notNull(),
  status: workOrderStatusEnum("status").default("OPEN").notNull(),
  trigger: workOrderTriggerEnum("trigger").default("MANUAL").notNull(),
  predictedFailureRisk: integer("predictedFailureRisk"), // 0-100, nguồn machine_health_history
  healthScore: integer("healthScore"),
  priority: integer("priority").default(3).notNull(),    // 1=cao nhất
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  assignedTo: integer("assignedTo"),          // FK -> users.id
  openedAt: timestamp("openedAt").defaultNow().notNull(),
  scheduledFor: timestamp("scheduledFor"),
  repairStartedAt: timestamp("repairStartedAt"),
  closedAt: timestamp("closedAt"),
  downtimeMinutes: integer("downtimeMinutes"),
  resolutionNotes: text("resolutionNotes"),
  // ── U6-a (0156, additive, nullable) — tenant scope + inert RLS (G-9). ──
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_wo_machine").on(table.machineId),
  index("idx_wo_status").on(table.status),
  index("idx_wo_type").on(table.type),
  index("idx_wo_trigger").on(table.trigger),
  index("idx_wo_opened").on(table.openedAt),
]);

export type MaintenanceWorkOrder = typeof maintenanceWorkOrders.$inferSelect;
export type InsertMaintenanceWorkOrder = typeof maintenanceWorkOrders.$inferInsert;

/**
 * Spare Parts Inventory - Tồn kho phụ tùng thay thế
 */
export const sparePartsInventory = pgTable("spare_parts_inventory", {
  id: serial("id").primaryKey(),
  partCode: varchar("partCode", { length: 64 }).notNull().unique(),
  partName: varchar("partName", { length: 256 }).notNull(),
  category: varchar("category", { length: 64 }),
  quantityOnHand: integer("quantityOnHand").default(0).notNull(),
  reorderLevel: integer("reorderLevel").default(0).notNull(),
  reorderQuantity: integer("reorderQuantity").default(0).notNull(),
  unit: varchar("unit", { length: 16 }).default("pcs").notNull(),
  location: varchar("location", { length: 128 }),
  unitCost: decimal("unitCost", { precision: 14, scale: 2 }),
  supplierCode: varchar("supplierCode", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_spare_code").on(table.partCode),
  index("idx_spare_category").on(table.category),
]);

export type SparePartInventory = typeof sparePartsInventory.$inferSelect;
export type InsertSparePartInventory = typeof sparePartsInventory.$inferInsert;

/**
 * PM Effectiveness Metrics - Chỉ số hiệu quả bảo trì (MTTR/MTBF/PM compliance)
 */
export const pmEffectivenessMetrics = pgTable("pm_effectiveness_metrics", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 64 }),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  mttrMinutes: decimal("mttrMinutes", { precision: 12, scale: 2 }), // Mean Time To Repair
  mtbfHours: decimal("mtbfHours", { precision: 12, scale: 2 }),     // Mean Time Between Failures
  failureCount: integer("failureCount").default(0).notNull(),
  workOrderCount: integer("workOrderCount").default(0).notNull(),
  pmCompliancePct: decimal("pmCompliancePct", { precision: 5, scale: 2 }),
  plannedDowntimeMinutes: integer("plannedDowntimeMinutes").default(0).notNull(),
  unplannedDowntimeMinutes: integer("unplannedDowntimeMinutes").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_pmeff_machine").on(table.machineId),
  index("idx_pmeff_period").on(table.periodStart),
]);

export type PmEffectivenessMetric = typeof pmEffectivenessMetrics.$inferSelect;
export type InsertPmEffectivenessMetric = typeof pmEffectivenessMetrics.$inferInsert;

// =============================================================
// G2.4 — BOM + Feeder material + Component genealogy (component → serial)
//
// SAFETY: pure DB master-data + material telemetry. NO machine-write path here
// (no commandDispatcher / driver.writeTags). componentInstallations records the
// OUTCOME of an install (telemetry), parallel to processResults; the genealogy
// append re-uses the existing "merge" event (payload.kind="componentInstallation")
// and does NOT widen GenealogyEventType / eventTypeSchema.
//
// status columns are varchar (NOT new pg enums) on purpose → migration stays
// additive (CREATE TABLE/INDEX only, no ALTER TYPE on existing enums).
// =============================================================

/**
 * BOM Definitions — Bill-of-materials cho 1 product model (versioned).
 */
export const bomDefinitions = pgTable("bom_definitions", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  code: varchar("code", { length: 100 }).notNull(),
  version: integer("version").default(1).notNull(),
  name: varchar("name", { length: 255 }),
  status: varchar("status", { length: 20 }).default("draft").notNull(), // draft|active|archived
  notes: text("notes"),
  createdBy: integer("createdBy"),
  isActive: boolean("isActive").default(true).notNull(),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_bomdef_model_code_version").on(table.productModelId, table.code, table.version),
  index("idx_bomdef_model").on(table.productModelId),
  index("idx_bomdef_status").on(table.status),
  index("idx_bomdef_deleted").on(table.deletedAt),
]);

export type BomDefinition = typeof bomDefinitions.$inferSelect;
export type InsertBomDefinition = typeof bomDefinitions.$inferInsert;

/**
 * BOM Line Items — từng dòng linh kiện trong 1 BOM.
 */
export const bomLineItems = pgTable("bom_line_items", {
  id: serial("id").primaryKey(),
  bomId: integer("bomId").notNull(),
  componentCode: varchar("componentCode", { length: 100 }).notNull(),
  // P2 master-data backbone: nullable FK to materials master alongside the
  // free-text componentCode (transition; backfilled by code match in 0134).
  materialId: integer("materialId"),     // FK -> materials.id (nullable)
  componentName: varchar("componentName", { length: 255 }),
  qtyPer: decimal("qtyPer", { precision: 14, scale: 4 }).notNull(),
  unit: varchar("unit", { length: 16 }).default("pcs").notNull(),
  refDesignator: varchar("refDesignator", { length: 255 }),
  alternateGroup: varchar("alternateGroup", { length: 64 }),
  isOptional: boolean("isOptional").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_bomline_bom").on(table.bomId),
  index("idx_bomline_component").on(table.componentCode),
  index("idx_bomline_materialid").on(table.materialId),
]);

export type BomLineItem = typeof bomLineItems.$inferSelect;
export type InsertBomLineItem = typeof bomLineItems.$inferInsert;

/**
 * Feeder Materials — vật liệu đã nạp lên feeder/slot của 1 máy.
 * qtyOnFeeder bị trừ dần khi linh kiện được lắp (consumeFeederMaterial, clamp ≥0).
 */
export const feederMaterials = pgTable("feeder_materials", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  slotCode: varchar("slotCode", { length: 40 }),
  componentCode: varchar("componentCode", { length: 100 }).notNull(),
  materialId: integer("materialId"),     // P2: FK -> materials.id (nullable, backfilled by code)
  supplierLotId: integer("supplierLotId"),
  qtyOnFeeder: decimal("qtyOnFeeder", { precision: 14, scale: 3 }).default("0").notNull(),
  consumptionRatePerHour: decimal("consumptionRatePerHour", { precision: 14, scale: 3 }),
  reorderLevel: decimal("reorderLevel", { precision: 14, scale: 3 }).default("0").notNull(),
  status: varchar("status", { length: 20 }).default("active").notNull(), // active|depleted|removed
  loadedAt: timestamp("loadedAt"),
  loadedBy: integer("loadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_feeder_machine").on(table.machineId),
  index("idx_feeder_component").on(table.componentCode),
  index("idx_feeder_materialid").on(table.materialId),
  index("idx_feeder_suplot").on(table.supplierLotId),
  // unique slot per machine when slotCode is provided (partial index — NULL slots not constrained)
  uniqueIndex("uq_feeder_machine_slot").on(table.machineId, table.slotCode).where(sql`"slotCode" IS NOT NULL`),
]);

export type FeederMaterial = typeof feederMaterials.$inferSelect;
export type InsertFeederMaterial = typeof feederMaterials.$inferInsert;

/**
 * Component Installations — telemetry KẾT QUẢ lắp 1 component vào 1 serial board.
 * Mắt xích genealogy component → serial (forward) / lot → serials (reverse).
 * genealogyHash = currHash của event "merge" đã append (null nếu chain lỗi — isolation).
 */
export const componentInstallations = pgTable("component_installations", {
  id: serial("id").primaryKey(),
  serialNumber: varchar("serialNumber", { length: 128 }).notNull(), // board được lắp
  componentCode: varchar("componentCode", { length: 100 }).notNull(),
  componentSerial: varchar("componentSerial", { length: 128 }),       // serial linh kiện (nếu có)
  supplierLotId: integer("supplierLotId"),
  feederMaterialId: integer("feederMaterialId"),
  machineId: integer("machineId"),
  bomLineItemId: integer("bomLineItemId"),
  qty: decimal("qty", { precision: 14, scale: 4 }).default("1").notNull(),
  refDesignator: varchar("refDesignator", { length: 120 }),
  genealogyHash: varchar("genealogyHash", { length: 64 }),
  installedAt: timestamp("installedAt").defaultNow().notNull(),
  installedBy: integer("installedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_compinst_serial").on(table.serialNumber),
  index("idx_compinst_component").on(table.componentCode),
  index("idx_compinst_suplot").on(table.supplierLotId),
  index("idx_compinst_machine").on(table.machineId),
  index("idx_compinst_genhash").on(table.genealogyHash),
]);

export type ComponentInstallation = typeof componentInstallations.$inferSelect;
export type InsertComponentInstallation = typeof componentInstallations.$inferInsert;
