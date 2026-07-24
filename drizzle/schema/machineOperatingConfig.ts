// Schema domain: Machine Operating Configuration (Task 6 — docs/MACHINE_CONFIG_DESIGN.md §6,
// docs/plans/2026-07-21-machine-config.md — repo D:/SOURCES/avi-aoi-sim, ported here).
//
// ════════════════════════════════════════════════════════════════════════════
// What a machine ACTUALLY runs — the REPORT-UP half of the machine operating-config
// feature. Server-side "baseline" (§2's `baseline`) already exists as
// `machine_recipes.payload`; THIS table is the opposite direction: a machine pushes
// its resolved effective configuration (baseline ⊕ machine-adjustments ⊕
// machine×product-adjustments, per the simulator's 3-layer model) so an engineer
// can see what a machine is ACTUALLY running vs. what was recommended.
//
// CRITICAL (design doc §2 verbatim): "Đẩy lên server = báo cáo cấu hình THỰC TẾ
// của máy này, KHÔNG phải ghi đè baseline chung." A report-settings write touches
// ONLY this table — it must NEVER mutate `machine_recipes` or any other baseline.
// Promoting one machine's tuning into the shared recommendation is a distinct,
// out-of-scope, sign-off-gated action (§6 point 4, not built here).
//
// SCOPE (one row per (machineId, configKind, productModelId-or-null)):
//   • productModelId IS NULL → machine-scoped layer: this machine's own tuning,
//     applies no matter which product it is running (sensor drift, belt speed…).
//   • productModelId IS NOT NULL → machine×product-scoped layer: tuning specific
//     to running THIS product on THIS machine (e.g. exposure for a darker part).
//   `scope` duplicates that as an explicit enum ('machine'|'machine_product') so a
//   query/UI never has to infer it from nullability — kept consistent with
//   productModelId by the service layer (never written directly by a caller) and
//   by a DB CHECK constraint (see the migration).
//
// UNIQUENESS: plain Postgres UNIQUE treats NULL as DISTINCT, so a single
// composite unique constraint over (machineId, configKind, productModelId) would
// NOT stop two machine-scoped (productModelId NULL) rows from coexisting. Two
// PARTIAL unique indexes close that gap — one keyed WHERE productModelId IS NULL
// (at most one machine-scoped row per machine × configKind), one WHERE
// productModelId IS NOT NULL (at most one row per machine × configKind × product)
// — so the machine-scoped row and any number of per-product rows coexist without
// collision, exactly per §6 point 1's instruction.
//
// `machineId`/`productModelId` are soft refs (no FK), mirroring the sibling
// `machine_config_state` shadow table and `ot_telemetry`/`process_results`: a
// high-frequency machine-write path must never be blocked by a referential check,
// and a later product/machine deletion must not orphan-block historic reports.
//
// GATED by MACHINE_OPERATING_CONFIG_REPORT_ENABLED (default OFF) at the router —
// this table is written by NOTHING until that flag is flipped on. Migration:
// drizzle/0298_machine_operating_config.sql.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const machineOperatingConfig = pgTable("machine_operating_config", {
  id: serial("id").primaryKey(),
  /** Reporting machine (soft ref — no FK, mirrors machine_config_state). */
  machineId: integer("machineId").notNull(),
  /** Config family: 'screw_program' | 'dispense_program' | 'weld_profile' | 'iot_settings' | 'aoi_inspection' (open vocab, matches recipeSchemas.ts + simulator's MachineParameterSchema). */
  configKind: varchar("configKind", { length: 32 }).notNull(),
  /** NULL = machine-scoped (applies to every product this machine runs); set = machine×product-scoped. Soft ref — no FK. */
  productModelId: integer("productModelId"),
  /** 'machine' | 'machine_product' — explicit mirror of productModelId's nullness (see header). */
  scope: varchar("scope", { length: 16 }).notNull(),
  /** The baseline version this report was resolved against (string — mirrors machine_config_state's varchar version columns; recipe int, future kinds may differ). */
  baselineVersion: varchar("baselineVersion", { length: 64 }),
  /** Sparse map of overridden parameters at THIS scope: { key: { value, by, at, note } }. Opaque to the DB — shape owned by the simulator's ParameterAdjustment / this feature's zod schema. */
  adjustments: jsonb("adjustments").$type<Record<string, unknown>>().notNull().default({}),
  /** The fully resolved parameter set the machine reports actually running at this scope. Opaque jsonb — shape owned by the simulator's EffectiveParameter[] / this feature's zod schema. */
  effective: jsonb("effective").$type<Record<string, unknown>>().notNull().default({}),
  /** Content-addressed checksum of the reported adjustments (drift key, same convention as machine_config_state.reportedChecksum / machine_recipes.checksum). */
  checksum: varchar("checksum", { length: 128 }),
  /** Free-text "who/what reported this" (operator name, or the machine's own identity) — NOT a users.id FK; this is a machine-authored field, not an authenticated human action. */
  reportedBy: varchar("reportedBy", { length: 128 }),
  reportedAt: timestamp("reportedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  // At most ONE machine-scoped row per (machine, configKind).
  uniqueIndex("uq_moc_machine_scope")
    .on(table.machineId, table.configKind)
    .where(sql`${table.productModelId} IS NULL`),
  // At most ONE row per (machine, configKind, product) for the product-scoped layer.
  uniqueIndex("uq_moc_product_scope")
    .on(table.machineId, table.configKind, table.productModelId)
    .where(sql`${table.productModelId} IS NOT NULL`),
  index("idx_moc_machine").on(table.machineId),
  index("idx_moc_product").on(table.productModelId),
]);

export type MachineOperatingConfig = typeof machineOperatingConfig.$inferSelect;
export type InsertMachineOperatingConfig = typeof machineOperatingConfig.$inferInsert;
