// Schema domain: Generic Process Results (Sprint F2 — "machine model for any machine type")
//
// `processResults` sits in PARALLEL to inspection (productInspections + measurementResults).
// It captures the OUTCOME of a generic process/station step (torque, dispense volume,
// cycle, functional test, …) emitted by ANY machine type — NOT a control command and NOT
// a replacement for the AOI/AVI inspection tables. Backward-compatible, no regression.
import { pgTable, serial, integer, varchar, jsonb, timestamp, index, primaryKey, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { machineTypeEnum, processResultEnum } from "./enums";

/**
 * Process Results — kết quả công đoạn tổng quát từ mọi loại máy.
 * Telemetry kết quả (pass/fail/warn/skip) kèm số liệu đo (metrics). KHÔNG phải lệnh điều khiển.
 */
export const processResults = pgTable("process_results", {
  // Composite PK (id, measuredAt) for the TimescaleDB hypertable (0118).
  id: serial("id"),
  serialNumber: varchar("serialNumber", { length: 128 }).notNull(),
  machineId: integer("machineId").notNull(),
  machineType: machineTypeEnum("machineType"), // denormalized snapshot (nullable)
  stepType: varchar("stepType", { length: 64 }).notNull(),
  stationId: integer("stationId"),
  lineCode: varchar("lineCode", { length: 50 }),
  productionOrderCode: varchar("productionOrderCode", { length: 80 }),
  lotCode: varchar("lotCode", { length: 80 }),
  result: processResultEnum("result").notNull(),
  metrics: jsonb("metrics").$type<Record<string, number | string | boolean>>(),
  recipeRef: varchar("recipeRef", { length: 128 }),
  measuredAt: timestamp("measuredAt").notNull(),
  recordedBy: integer("recordedBy"),
  // ── Doc 56 Đ1 (migration 0288) — PROCESS FEED durability/provenance. All nullable,
  // OFF-safe: a NULL = row predates 0288 / machine didn't send it (that IS the truth).
  // Mirrors doc 51 P1 (product_inspections, 0275) but snake_case per the "ST4I Standard
  // Process Feed v1" spec. Written only when PROCESS_RESULT_INGEST_ENABLED is on.
  //   server_received_at — when the SERVER received the submission (the one clock a
  //     machine cannot lie about); nền cho phát hiện lệch giờ.
  serverReceivedAt: timestamp("server_received_at", { withTimezone: true }),
  //   time_source — 'device' (machine sent ts with offset) | 'server' (machine sent no
  //     ts → server stamped now()).
  timeSource: varchar("time_source", { length: 16 }),
  //   idempotency_key — client-generated, stable across retries. AUDIT-ONLY here; the
  //     ENFORCEMENT lives in processIdempotencyKeys below (hypertable can't hold the
  //     unique index — same reason as inspectionIdempotencyKeys).
  idempotencyKey: varchar("idempotency_key", { length: 200 }),
  //   waveforms — curve arrays (torque-angle, weld current…), capped ~64KB at the app
  //     layer; kept separate from `metrics` so it never bloats scalar-metric queries.
  waveforms: jsonb("waveforms").$type<Array<{ name: string; unit?: string; rateHz?: number; samples: Array<[number, number]> }>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.id, table.measuredAt] }),
  index("idx_process_results_serial").on(table.serialNumber),
  index("idx_process_results_machine").on(table.machineId),
  index("idx_process_results_step").on(table.stepType),
  index("idx_process_results_order").on(table.productionOrderCode),
  index("idx_process_results_measured").on(table.measuredAt),
]);

export type ProcessResult = typeof processResults.$inferSelect;
export type InsertProcessResult = typeof processResults.$inferInsert;

/**
 * Doc 56 Đ1 (migration 0288) — EXPLICIT PROCESS-INGEST IDEMPOTENCY LEDGER.
 *
 * Mirror of inspectionIdempotencyKeys (inspection.ts). process_results is a
 * TimescaleDB hypertable (PK (id, measuredAt)); Timescale requires every unique index
 * to carry the partition column measuredAt — the very column that changes on every
 * retry of a machine that omits its own timestamp. So the idempotency constraint
 * CANNOT be a unique index on process_results; it moves to this PLAIN table where
 * PK (machineId, idempotencyKey) is legal and global.
 *
 * ⚠ NEVER convert this table to a hypertable — that would silently re-open the hole.
 */
export const processIdempotencyKeys = pgTable("process_idempotency_keys", {
  machineId: integer("machineId").notNull(),
  /** Client-generated, stable across retries of the SAME process result. */
  idempotencyKey: varchar("idempotencyKey", { length: 200 }).notNull(),
  /** The process_results row this key produced (soft ref — hypertable, no FK).
   *  NULL exists only inside the claiming transaction. */
  resultId: integer("resultId"),
  /** Copy of the result's measuredAt so the ledger prunes on the same horizon as
   *  process_results without joining back into the hypertable. */
  measuredAt: timestamp("measuredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.machineId, table.idempotencyKey] }),
  // Age-based pruning (retention). Without it, cleaning the ledger seq-scans.
  index("idx_process_idem_created").on(table.createdAt),
]);

export type ProcessIdempotencyKey = typeof processIdempotencyKeys.$inferSelect;
export type InsertProcessIdempotencyKey = typeof processIdempotencyKeys.$inferInsert;

/**
 * Doc 56 Đ1 (migration 0289) — PROCESS STEP-TYPE VOCABULARY (data-driven, NOT a pg
 * enum: the repo convention is to grow catalogs by ROW, not ALTER TYPE). zod ingest
 * validates that a submitted stepType exists here (mode log→enforce, TAX-12/API-4).
 * machineType NULL = applies to any machine family.
 */
export const processStepTypes = pgTable("process_step_types", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  nameVi: varchar("nameVi", { length: 256 }),
  nameEn: varchar("nameEn", { length: 256 }),
  machineType: varchar("machineType", { length: 40 }), // optional scope (varchar — additive)
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_pst_machine_type").on(table.machineType),
  index("idx_pst_active").on(table.active),
]);

export type ProcessStepType = typeof processStepTypes.$inferSelect;
export type InsertProcessStepType = typeof processStepTypes.$inferInsert;

/**
 * Doc 56 Đ1 (migration 0289) / Trục 4 — PROCESS SPEC LIMITS per (stepType, metricKey),
 * optionally scoped by machineType and/or productModelId. Resolve order (consumer at
 * Đ4/Đ5): product-specific (productModelId match) > machineType default > global.
 * Consumers: spec-gate at submitProcessResult (PROCESS_SPEC_GATE_ENABLED), SPC/CPK
 * source-2, Threshold Advisor. lsl/usl/nominal are double precision (float metrics).
 */
export const processSpecLimits = pgTable("process_spec_limits", {
  id: serial("id").primaryKey(),
  machineType: varchar("machineType", { length: 40 }),
  productModelId: integer("productModelId"),
  stepType: varchar("stepType", { length: 64 }).notNull(),
  metricKey: varchar("metricKey", { length: 64 }).notNull(),
  unit: varchar("unit", { length: 32 }),
  lsl: doublePrecision("lsl"),
  usl: doublePrecision("usl"),
  nominal: doublePrecision("nominal"),
  active: boolean("active").default(true).notNull(),
  createdBy: integer("createdBy"),
  approvedBy: integer("approvedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_psl_step_metric").on(table.stepType, table.metricKey),
  index("idx_psl_machine_type").on(table.machineType),
  index("idx_psl_product_model").on(table.productModelId),
  index("idx_psl_active").on(table.active),
]);

export type ProcessSpecLimit = typeof processSpecLimits.$inferSelect;
export type InsertProcessSpecLimit = typeof processSpecLimits.$inferInsert;
