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
