// Schema domain: Reporting Mart (dimensional star schema) — doc 35 B8 / doc 32 R1
//
// ════════════════════════════════════════════════════════════════════════════
// The reporting audit (doc 32 R1, doc 35 B8) flagged that the system has NO
// dimensional / mart layer: 0 dim_/fact_ tables, every dashboard aggregates
// on-the-fly over the raw product_inspections hypertable, and "shift" is a
// derived string rather than a first-class dimension. TimescaleDB is NOT
// installed on the main DB, so continuous aggregates are unavailable — this
// mart is built from PLAIN tables refreshed by an app job
// (server/services/reportingMartService.ts), FLAG-GATED off by default.
//
// Star schema:
//   dim_shift            — one row per (shiftCode, factoryId) synced from
//                          shift_configs (factoryId 0 = global/all-factory shift).
//   dim_product          — one row per product model synced from product_models.
//   fact_inspection_hourly — hourly grain fact keyed by
//                          (bucketHour, machineId, productModelId, shiftCode).
//                          UNIQUE on that tuple so a refresh is an idempotent
//                          UPSERT. bucketHour is FACTORY-LOCAL naive wall time
//                          (date_trunc('hour', ts AT TIME ZONE …) — see utils/kpi)
//                          so mart queries filter in the same local space the
//                          rest of the app buckets in.
//
// SENTINELS (so ON CONFLICT works — Postgres treats NULLs in a unique index as
// distinct, which would break idempotent upsert): productModelId defaults to 0
// ("no product model") and dim_shift.factoryId defaults to 0 ("global shift").
// The refresh COALESCEs the nullable source columns to these sentinels.
//
// yieldPct = canonical FINAL yield ((OK+NTF)/total, decision #4). fpyPct = true
// First Pass Yield of boards whose FIRST in-window inspection fell in the bucket
// (nullable — null when no usable serials in the bucket). See utils/kpi.ts.
//
// ADDITIVE + IDEMPOTENT (migration 0230 is CREATE TABLE/INDEX IF NOT EXISTS
// only, no ALTER TYPE). Inert until reportingMartService writes / reportingMart
// router reads. Refresh job is FLAG-OFF (REPORTING_MART_ENABLED) by default.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, decimal, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// ── Dimension: shift ─────────────────────────────────────────────────────────
export const dimShift = pgTable("dim_shift", {
  id: serial("id").primaryKey(),
  shiftCode: varchar("shiftCode", { length: 32 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  startHour: integer("startHour").default(0).notNull(),
  startMinute: integer("startMinute").default(0).notNull(),
  endHour: integer("endHour").default(0).notNull(),
  endMinute: integer("endMinute").default(0).notNull(),
  // 0 = global/all-factory shift (COALESCE of the nullable shift_configs.factoryId).
  factoryId: integer("factoryId").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_dim_shift_code_factory").on(table.shiftCode, table.factoryId),
]);

export type DimShift = typeof dimShift.$inferSelect;
export type InsertDimShift = typeof dimShift.$inferInsert;

// ── Dimension: product ───────────────────────────────────────────────────────
export const dimProduct = pgTable("dim_product", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId").notNull(),
  code: varchar("code", { length: 100 }).notNull(),
  name: varchar("name", { length: 255 }),
  category: varchar("category", { length: 100 }),
  revision: varchar("revision", { length: 32 }),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_dim_product_model").on(table.productModelId),
]);

export type DimProduct = typeof dimProduct.$inferSelect;
export type InsertDimProduct = typeof dimProduct.$inferInsert;

// ── Fact: inspection hourly grain ────────────────────────────────────────────
export const factInspectionHourly = pgTable("fact_inspection_hourly", {
  id: serial("id").primaryKey(),
  // FACTORY-LOCAL naive hour bucket (date_trunc('hour', factory-local ts)).
  bucketHour: timestamp("bucketHour").notNull(),
  // Descriptive (NOT part of the grain key) — resolved from factoryCode; nullable.
  factoryId: integer("factoryId"),
  machineId: integer("machineId").notNull(),
  // 0 = no product model (COALESCE of the nullable product_inspections.productModelId).
  productModelId: integer("productModelId").default(0).notNull(),
  shiftCode: varchar("shiftCode", { length: 32 }).notNull(),
  totalCount: integer("totalCount").default(0).notNull(),
  okCount: integer("okCount").default(0).notNull(),
  ngCount: integer("ngCount").default(0).notNull(),
  ntfCount: integer("ntfCount").default(0).notNull(),
  // Canonical FINAL yield % ((OK+NTF)/total, decision #4).
  yieldPct: decimal("yieldPct", { precision: 5, scale: 2 }),
  // True First Pass Yield % — nullable (null when no usable serials in bucket).
  fpyPct: decimal("fpyPct", { precision: 5, scale: 2 }),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
}, (table) => [
  // The grain — refresh UPSERTs against this so it is idempotent.
  uniqueIndex("uq_fact_insp_hourly_grain").on(
    table.bucketHour, table.machineId, table.productModelId, table.shiftCode,
  ),
  index("idx_fact_insp_hourly_bucket").on(table.bucketHour),
  index("idx_fact_insp_hourly_factory").on(table.factoryId),
  index("idx_fact_insp_hourly_machine").on(table.machineId),
  index("idx_fact_insp_hourly_product").on(table.productModelId),
  index("idx_fact_insp_hourly_shift").on(table.shiftCode),
]);

export type FactInspectionHourly = typeof factInspectionHourly.$inferSelect;
export type InsertFactInspectionHourly = typeof factInspectionHourly.$inferInsert;
