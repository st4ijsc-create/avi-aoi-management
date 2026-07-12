// Schema domain: MES/MOM MASTER DATA (Audit doc 07 §③ — Supplier / Material /
// Customer / Skill+Certification / Tool-Fixture masters).
//
// ADDITIVE & MIGRATION-SAFE: these are brand-new tables only. Existing
// denormalized columns (mes.ts materialReceipts.supplierCode/Name +
// materialCode, supplierLots.materialCode, feederMaterials.componentCode,
// sparePartsInventory.supplierCode, productionOrders, users department/position)
// are intentionally LEFT UNTOUCHED — these masters relate to them BY CODE, so no
// existing table/column is altered in this pass.
//
// Tenant scoping: corporateCode/factoryCode are nullable varchars mirroring the
// platform's code-based multi-tenant convention (see userCorporateAssignments).
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import {
  supplierTypeEnum,
  supplierApprovalStatusEnum,
  toolTypeEnum,
  toolStatusEnum,
  certificationLevelEnum,
  uomDimensionEnum,
  calendarDayTypeEnum,
  warehouseTypeEnum,
  storageLocationKindEnum,
} from "./enums";

// =============================================================
// Supplier master
// =============================================================
/**
 * Suppliers — nhà cung cấp (vendor master). Relates to mes.ts by supplierCode.
 */
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  type: supplierTypeEnum("type").default("component").notNull(),
  contactName: varchar("contactName", { length: 256 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactPhone: varchar("contactPhone", { length: 40 }),
  address: text("address"),
  country: varchar("country", { length: 80 }),
  rating: decimal("rating", { precision: 4, scale: 2 }), // 0..5 quality/delivery score
  approvalStatus: supplierApprovalStatusEnum("approvalStatus").default("pending").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryCode: varchar("factoryCode", { length: 50 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_suppliers_code").on(table.code),
  index("idx_suppliers_type").on(table.type),
  index("idx_suppliers_approval").on(table.approvalStatus),
  index("idx_suppliers_active").on(table.isActive),
  index("idx_suppliers_corp").on(table.corporateCode),
]);

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

// =============================================================
// Material / Component master
// =============================================================
/**
 * Material Classes — phân loại vật liệu (cây phân cấp tùy chọn). parentCode tự
 * tham chiếu để tạo cây loại vật liệu.
 */
export const materialClasses = pgTable("material_classes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  parentCode: varchar("parentCode", { length: 64 }),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_matclass_code").on(table.code),
  index("idx_matclass_parent").on(table.parentCode),
]);

export type MaterialClass = typeof materialClasses.$inferSelect;
export type InsertMaterialClass = typeof materialClasses.$inferInsert;

/**
 * Materials — vật liệu/linh kiện (item/component master). Relates to mes.ts by
 * materialCode/componentCode. mpn = manufacturer part number; msl = moisture
 * sensitivity level (J-STD-020); rohs compliance flag.
 */
export const materials = pgTable("materials", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  materialClass: varchar("materialClass", { length: 64 }), // FK by code -> material_classes.code
  mpn: varchar("mpn", { length: 128 }),                    // manufacturer part number
  manufacturer: varchar("manufacturer", { length: 256 }),
  packageType: varchar("packageType", { length: 64 }),     // e.g. 0402, QFN-48, SOT-23
  // Doc 29 §1.2 / W8-A (0191): normalized package master link. Soft ref ->
  // component_packages.id (componentLibrary.ts), NULLABLE — packageType stays
  // the free-text legacy field; 0191 backfills packageId best-effort where
  // packageType ≈ component_packages.code (mirrors the 0134 materialId backfill).
  packageId: integer("packageId"),
  msl: varchar("msl", { length: 8 }),                      // moisture sensitivity level: 1..6
  rohs: boolean("rohs").default(true).notNull(),
  unit: varchar("unit", { length: 16 }).default("pcs").notNull(),
  datasheetUrl: text("datasheetUrl"),
  defaultSupplierCode: varchar("defaultSupplierCode", { length: 64 }), // relate by code
  isActive: boolean("isActive").default(true).notNull(),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryCode: varchar("factoryCode", { length: 50 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_materials_code").on(table.code),
  index("idx_materials_class").on(table.materialClass),
  index("idx_materials_mpn").on(table.mpn),
  index("idx_materials_package").on(table.packageId),
  index("idx_materials_supplier").on(table.defaultSupplierCode),
  index("idx_materials_active").on(table.isActive),
]);

export type Material = typeof materials.$inferSelect;
export type InsertMaterial = typeof materials.$inferInsert;

// =============================================================
// Customer master
// =============================================================
/**
 * Customers — khách hàng (customer master). Relates to productionOrders by code
 * (no FK added to keep this pass additive).
 */
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  contactName: varchar("contactName", { length: 256 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactPhone: varchar("contactPhone", { length: 40 }),
  address: text("address"),
  country: varchar("country", { length: 80 }),
  isActive: boolean("isActive").default(true).notNull(),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryCode: varchar("factoryCode", { length: 50 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_customers_code").on(table.code),
  index("idx_customers_active").on(table.isActive),
  index("idx_customers_corp").on(table.corporateCode),
]);

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

// =============================================================
// Skill + Certification master
// =============================================================
/**
 * Skills — kỹ năng (skill master). Enables gating operators / work-orders by
 * qualification later (see userCertifications).
 */
export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  category: varchar("category", { length: 64 }), // e.g. SMT, AOI, soldering, safety
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_skills_code").on(table.code),
  index("idx_skills_category").on(table.category),
]);

export type Skill = typeof skills.$inferSelect;
export type InsertSkill = typeof skills.$inferInsert;

/**
 * User Certifications — chứng nhận của user cho 1 skill (level + hiệu lực).
 * userId -> users.id, skillId -> skills.id (relate by id; no DB FK to stay
 * additive/safe). expiresAt enables future qualification gating.
 */
export const userCertifications = pgTable("user_certifications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),   // FK -> users.id
  skillId: integer("skillId").notNull(), // FK -> skills.id
  level: certificationLevelEnum("level").default("trainee").notNull(),
  grantedAt: timestamp("grantedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
  certifiedBy: integer("certifiedBy"),   // FK -> users.id (who granted)
  notes: text("notes"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_usercert_user").on(table.userId),
  index("idx_usercert_skill").on(table.skillId),
  index("idx_usercert_level").on(table.level),
  index("idx_usercert_expires").on(table.expiresAt),
  // a user holds at most one active certification record per skill
  uniqueIndex("uq_usercert_user_skill").on(table.userId, table.skillId),
]);

export type UserCertification = typeof userCertifications.$inferSelect;
export type InsertUserCertification = typeof userCertifications.$inferInsert;

// =============================================================
// Tool / Fixture / Consumable master
// =============================================================
/**
 * Tools — dụng cụ/đồ gá/vật tư tiêu hao (tool/fixture/consumable master).
 * lifeLimit/lifeUsed track consumable usage (e.g. nozzle/stencil/squeegee).
 * machineType is an optional varchar (NOT the machinetypeenum) to stay additive.
 */
export const tools = pgTable("tools", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  type: toolTypeEnum("type").default("other").notNull(),
  machineType: varchar("machineType", { length: 40 }), // e.g. AOI/SPI/ASSEMBLY (varchar — additive)
  lifeLimit: integer("lifeLimit"),                     // total allowed uses/cycles (null = unlimited)
  lifeUsed: integer("lifeUsed").default(0).notNull(),  // consumed uses/cycles
  status: toolStatusEnum("status").default("available").notNull(),
  location: varchar("location", { length: 128 }),
  isActive: boolean("isActive").default(true).notNull(),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryCode: varchar("factoryCode", { length: 50 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_tools_code").on(table.code),
  index("idx_tools_type").on(table.type),
  index("idx_tools_status").on(table.status),
  index("idx_tools_active").on(table.isActive),
]);

export type Tool = typeof tools.$inferSelect;
export type InsertTool = typeof tools.$inferInsert;

// =============================================================
// Units of Measure + conversions (Doc 07 §③ "nice-to-have")
// =============================================================
/**
 * Units of Measure — đơn vị đo. dimension groups units that can convert among
 * each other (length/mass/…); isBase marks the canonical base unit of a
 * dimension (e.g. metre for length). Relates to materials.unit / inventory by code.
 */
export const unitsOfMeasure = pgTable("units_of_measure", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  dimension: uomDimensionEnum("dimension").default("count").notNull(),
  isBase: boolean("isBase").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_uom_code").on(table.code),
  index("idx_uom_dimension").on(table.dimension),
  index("idx_uom_active").on(table.isActive),
]);

export type UnitOfMeasure = typeof unitsOfMeasure.$inferSelect;
export type InsertUnitOfMeasure = typeof unitsOfMeasure.$inferInsert;

/**
 * Unit Conversions — quy đổi đơn vị. value_to = value_from * factor + offset.
 * offset covers affine scales (e.g. °C → °F = x*1.8 + 32). Relates to
 * units_of_measure by code (no DB FK to stay additive). Unique per (from,to).
 */
export const unitConversions = pgTable("unit_conversions", {
  id: serial("id").primaryKey(),
  fromUomCode: varchar("fromUomCode", { length: 32 }).notNull(), // FK by code -> units_of_measure.code
  toUomCode: varchar("toUomCode", { length: 32 }).notNull(),     // FK by code -> units_of_measure.code
  factor: decimal("factor", { precision: 24, scale: 12 }).notNull(),
  offset: decimal("offset", { precision: 24, scale: 12 }).default("0").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_uomconv_from").on(table.fromUomCode),
  index("idx_uomconv_to").on(table.toUomCode),
  uniqueIndex("uq_uomconv_from_to").on(table.fromUomCode, table.toUomCode),
]);

export type UnitConversion = typeof unitConversions.$inferSelect;
export type InsertUnitConversion = typeof unitConversions.$inferInsert;

// =============================================================
// Plant / Shift Calendar (working-day / holiday)
// =============================================================
/**
 * Plant Calendars — lịch nhà máy. A named working-day/holiday calendar scoped to
 * a factory (factoryCode by code). Feeds takt-time / OEE-availability / APS.
 */
export const plantCalendars = pgTable("plant_calendars", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  factoryCode: varchar("factoryCode", { length: 50 }),
  timezone: varchar("timezone", { length: 64 }).default("Asia/Ho_Chi_Minh").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_plantcal_code").on(table.code),
  index("idx_plantcal_factory").on(table.factoryCode),
  index("idx_plantcal_active").on(table.isActive),
]);

export type PlantCalendar = typeof plantCalendars.$inferSelect;
export type InsertPlantCalendar = typeof plantCalendars.$inferInsert;

/**
 * Calendar Days — ngày trong lịch. dayType marks a date as working / holiday /
 * planned_downtime. calendarId -> plant_calendars.id (relate by id; no DB FK to
 * stay additive). Unique per (calendar, date).
 */
export const calendarDays = pgTable("calendar_days", {
  id: serial("id").primaryKey(),
  calendarId: integer("calendarId").notNull(), // FK -> plant_calendars.id
  date: varchar("date", { length: 10 }).notNull(), // ISO date YYYY-MM-DD
  dayType: calendarDayTypeEnum("dayType").default("working").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_caldays_calendar").on(table.calendarId),
  index("idx_caldays_date").on(table.date),
  index("idx_caldays_type").on(table.dayType),
  uniqueIndex("uq_caldays_calendar_date").on(table.calendarId, table.date),
]);

export type CalendarDay = typeof calendarDays.$inferSelect;
export type InsertCalendarDay = typeof calendarDays.$inferInsert;

/**
 * Calendar Day Shifts (doc 42 T9) — ca làm việc áp dụng cho MỘT ngày lịch cụ thể.
 * Bảng nối many-to-many calendar_days ↔ shift_configs (production.ts): 1 ngày chạy
 * nhiều ca, 1 ca dùng lại cho nhiều ngày. calendarDayId -> calendar_days.id,
 * shiftConfigId -> shift_configs.id (relate by id). Unique per (day, shift) chống
 * gán trùng. Feeds takt-time / OEE-availability theo ca của từng ngày.
 */
export const calendarDayShifts = pgTable("calendar_day_shifts", {
  id: serial("id").primaryKey(),
  calendarDayId: integer("calendarDayId").notNull(), // FK -> calendar_days.id
  shiftConfigId: integer("shiftConfigId").notNull(),  // FK -> shift_configs.id
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_caldayshifts_day").on(table.calendarDayId),
  index("idx_caldayshifts_shift").on(table.shiftConfigId),
  uniqueIndex("uq_caldayshifts_day_shift").on(table.calendarDayId, table.shiftConfigId),
]);

export type CalendarDayShift = typeof calendarDayShifts.$inferSelect;
export type InsertCalendarDayShift = typeof calendarDayShifts.$inferInsert;

// =============================================================
// Warehouse / Inventory master
// =============================================================
/**
 * Warehouses — kho. type classifies the stock kind (raw/wip/fg/spare/other),
 * scoped to a factory by code. General inventory master beyond the existing
 * sparePartsInventory / feederMaterials denormalized tables.
 */
export const warehouses = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  factoryCode: varchar("factoryCode", { length: 50 }),
  type: warehouseTypeEnum("type").default("other").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_warehouses_code").on(table.code),
  index("idx_warehouses_factory").on(table.factoryCode),
  index("idx_warehouses_type").on(table.type),
  index("idx_warehouses_active").on(table.isActive),
]);

export type Warehouse = typeof warehouses.$inferSelect;
export type InsertWarehouse = typeof warehouses.$inferInsert;

/**
 * Storage Locations — vị trí lưu trữ (bin/shelf/zone) trong 1 kho.
 * warehouseId -> warehouses.id (relate by id; no DB FK to stay additive).
 * Unique per (warehouse, code).
 */
export const storageLocations = pgTable("storage_locations", {
  id: serial("id").primaryKey(),
  warehouseId: integer("warehouseId").notNull(), // FK -> warehouses.id
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 256 }),
  kind: storageLocationKindEnum("kind").default("bin").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_stgloc_warehouse").on(table.warehouseId),
  index("idx_stgloc_code").on(table.code),
  index("idx_stgloc_kind").on(table.kind),
  uniqueIndex("uq_stgloc_warehouse_code").on(table.warehouseId, table.code),
]);

export type StorageLocation = typeof storageLocations.$inferSelect;
export type InsertStorageLocation = typeof storageLocations.$inferInsert;

/**
 * Inventory Balances — tồn kho. quantityOnHand of a material at a warehouse
 * (optionally a location + lot), in uomCode. Relates to materials/warehouses/
 * storage_locations BY CODE (additive). Unique per (material,warehouse,location,lot).
 */
export const inventoryBalances = pgTable("inventory_balances", {
  id: serial("id").primaryKey(),
  materialCode: varchar("materialCode", { length: 64 }).notNull(),   // FK by code -> materials.code
  warehouseCode: varchar("warehouseCode", { length: 64 }).notNull(), // FK by code -> warehouses.code
  locationCode: varchar("locationCode", { length: 64 }),             // FK by code -> storage_locations.code
  lotCode: varchar("lotCode", { length: 64 }),
  quantityOnHand: decimal("quantityOnHand", { precision: 24, scale: 6 }).default("0").notNull(),
  uomCode: varchar("uomCode", { length: 32 }).default("pcs").notNull(), // FK by code -> units_of_measure.code
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_invbal_material").on(table.materialCode),
  index("idx_invbal_warehouse").on(table.warehouseCode),
  index("idx_invbal_location").on(table.locationCode),
  index("idx_invbal_lot").on(table.lotCode),
  uniqueIndex("uq_invbal_mat_wh_loc_lot").on(table.materialCode, table.warehouseCode, table.locationCode, table.lotCode),
]);

export type InventoryBalance = typeof inventoryBalances.$inferSelect;
export type InsertInventoryBalance = typeof inventoryBalances.$inferInsert;
