// Schema domain: COMPONENT LIBRARY (doc 27 §2 M12a — designed in doc 29 §1,
// implemented in Đợt 8 / W8-A, migration 0191).
//
// ADDITIVE & MIGRATION-SAFE (doc 29 §0 rules):
//   • brand-new tables only in this file; the companion columns added to
//     EXISTING tables live in their own schema files (materials.packageId in
//     masterdata.ts, measurement_point_defs.componentCode/refDesignator in
//     product.ts, machines.capabilitiesValidation in hierarchy.ts) — all
//     nullable plain ADD COLUMN.
//   • family/mountType/density are varchar (NOT new pg enums) so future values
//     never need ALTER TYPE — mirrors equipmentStandards.ts / fleet.ts.
//   • soft references by id (packageId) + orphan-visibility later; NO DB FK in
//     this pass (doc 29 §0.2 "soft-ref trước, FK sau").
//
// RELATION TO EXISTING MASTERS (doc 29 §1.2 — no second component table):
//   materials.code stays the business key of a component. This library only
//   normalizes the PACKAGE dimension: materials.packageId → component_packages.
//   The Pareto chain is measurement_results → measurement_point_defs.componentCode
//   → materials.code → materials.packageId → component_packages.
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/** Package families (advisory list — column is varchar, app-validated). */
export const COMPONENT_PACKAGE_FAMILIES = [
  "CHIP", "QFP", "QFN", "BGA", "SOT", "SOD", "SOIC", "TSSOP", "DPAK", "THT", "CONN", "ELECTROLYTIC", "TANTALUM", "CRYSTAL", "LED", "CSP", "OTHER",
] as const;
export type ComponentPackageFamily = (typeof COMPONENT_PACKAGE_FAMILIES)[number];

/** Mount types (advisory list — column is varchar). */
export const COMPONENT_MOUNT_TYPES = ["SMT", "THT", "PRESSFIT"] as const;

/**
 * Component Packages — package master (chuẩn hoá theo IPC-7351 land-pattern
 * naming khi có thể). ONE row per package form factor (e.g. "0402",
 * "QFN-48-7x7", "SOT-23-3"). Carries body/pin/polarity data an AOI needs to
 * reason about a component's shape and its typical defect profile.
 *
 * `origin` mirrors deviceTypes.origin: 'seed' marks the reference-data rows
 * shipped by migration 0191 (common SMT packages); 'manual' for user rows.
 */
export const componentPackages = pgTable("component_packages", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull(),            // e.g. "0402", "QFN-48-7x7", "SOT-23-3"
  ipcName: varchar("ipcName", { length: 128 }),               // IPC-7351 (e.g. "RESC1005X40N")
  family: varchar("family", { length: 40 }).notNull(),        // CHIP|QFP|QFN|BGA|SOT|SOIC|DPAK|THT|CONN|OTHER…
  mountType: varchar("mountType", { length: 10 }).default("SMT").notNull(), // SMT|THT|PRESSFIT
  bodyLengthMm: decimal("bodyLengthMm", { precision: 10, scale: 4 }),
  bodyWidthMm: decimal("bodyWidthMm", { precision: 10, scale: 4 }),
  bodyHeightMm: decimal("bodyHeightMm", { precision: 10, scale: 4 }),
  pinCount: integer("pinCount"),
  pitchMm: decimal("pitchMm", { precision: 10, scale: 4 }),
  hasPolarity: boolean("hasPolarity").default(false).notNull(), // diode/tantalum/IC pin-1
  polarityMark: varchar("polarityMark", { length: 40 }),      // dot|notch|band|chamfer|silk_plus|custom
  leadType: varchar("leadType", { length: 30 }),              // gullwing|j-lead|no-lead|ball|axial|radial
  inspectionNotes: text("inspectionNotes"),                   // camera-angle / lighting hints per package
  defaultDefects: jsonb("defaultDefects").$type<string[]>(),  // [defectCatalog.code] common for this package
  // 'seed' = reference data shipped by migration 0191; 'manual' = user-created.
  origin: varchar("origin", { length: 16 }).default("manual").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_comp_pkg_code").on(table.code),
  index("idx_comp_pkg_family").on(table.family),
  index("idx_comp_pkg_active").on(table.isActive),
]);

export type ComponentPackage = typeof componentPackages.$inferSelect;
export type InsertComponentPackage = typeof componentPackages.$inferInsert;

/**
 * Component Footprints — land-pattern variants per package (one package may
 * carry several IPC-7351 density variants). geometry: pads
 * [{x,y,w,h,shape,angle}] in mm, origin = package center.
 */
export const componentFootprints = pgTable("component_footprints", {
  id: serial("id").primaryKey(),
  packageId: integer("packageId").notNull(),                  // soft ref -> component_packages.id
  code: varchar("code", { length: 64 }).notNull(),            // e.g. "RESC1005X40N-M"
  density: varchar("density", { length: 10 }),                // most|nominal|least (IPC-7351 M/N/L)
  padCount: integer("padCount"),
  geometry: jsonb("geometry").$type<{ pads?: Array<{ x: number; y: number; w: number; h: number; shape?: string; angle?: number }> }>(),
  courtyardMm: jsonb("courtyardMm").$type<{ w: number; h: number }>(),
  // createdAt/updatedAt are a small documented ADDITION over doc 29's column
  // list (kept for audit-consistency with every other master table).
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_comp_fp_pkg_code").on(table.packageId, table.code),
  index("idx_comp_fp_package").on(table.packageId),
]);

export type ComponentFootprint = typeof componentFootprints.$inferSelect;
export type InsertComponentFootprint = typeof componentFootprints.$inferInsert;
