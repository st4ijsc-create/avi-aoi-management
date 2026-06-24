// Schema domain: Generic Process Results (Sprint F2 — "machine model for any machine type")
//
// `processResults` sits in PARALLEL to inspection (productInspections + measurementResults).
// It captures the OUTCOME of a generic process/station step (torque, dispense volume,
// cycle, functional test, …) emitted by ANY machine type — NOT a control command and NOT
// a replacement for the AOI/AVI inspection tables. Backward-compatible, no regression.
import { pgTable, serial, integer, varchar, jsonb, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
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
