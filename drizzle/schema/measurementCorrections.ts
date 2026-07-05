// Schema domain: measurement_corrections — operator-correction harvest ledger
// (doc 27 §9 gap V2, migration 0188 — agent W7-B).
//
// Append-only: every human verdict change from measurementResult.correctResult
// or inspection.confirmNTF lands here as a structured label (original vs
// corrected result + who/why/where + image-ref snapshot). Consumed by:
//   * measurementCorrectionsService — agreement / false-call analytics,
//   * ai_label_queue feed (humanLabel rows for training),
//   * aiFeedback.exportTrainingBatch (second training-data source),
//   * ntfPredictorService — (machine, pointDef) repeat-offender signal.
//
// inspectionId / measurementResultId are SOFT refs (product_inspections /
// measurement_results may be TimescaleDB hypertables per 0172 — no FK to a
// hypertable). See drizzle/0188_measurement_corrections_ntf_score.sql.
import { pgTable, serial, integer, text, timestamp, varchar, index } from "drizzle-orm/pg-core";

export const measurementCorrections = pgTable("measurement_corrections", {
  id: serial("id").primaryKey(),
  // Soft ref -> measurement_results.id. NULL = inspection-level correction
  // (confirmNTF on an inspection without per-point NG rows).
  measurementResultId: integer("measurementResultId"),
  // Soft ref -> product_inspections.id (hypertable — see header).
  inspectionId: integer("inspectionId").notNull(),
  // Denormalised at harvest time — per-machine analytics without hypertable joins.
  machineId: integer("machineId").notNull(),
  // Soft ref -> measurement_point_defs.id (repeat-offender signal).
  pointDefId: integer("pointDefId"),
  // 'OK' | 'NG' | 'NTF' — machine / previous verdict.
  originalResult: varchar("originalResult", { length: 10 }).notNull(),
  // 'OK' | 'NG' | 'NTF' — human verdict.
  correctedResult: varchar("correctedResult", { length: 10 }).notNull(),
  // Harvest site: 'correct_result' | 'confirm_ntf' (explicit provenance).
  source: varchar("source", { length: 20 }).default("correct_result").notNull(),
  reason: text("reason"),
  // users.id of the correcting operator.
  operatorUserId: integer("operatorUserId").notNull(),
  // Image-ref snapshot at correction time (training data must survive later
  // edits to the measurement row).
  imageKey: varchar("imageKey", { length: 255 }),
  imageUrl: text("imageUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_mcorr_machine_created").on(table.machineId, table.createdAt),
  index("idx_mcorr_inspection").on(table.inspectionId),
  index("idx_mcorr_machine_point").on(table.machineId, table.pointDefId),
]);

export type MeasurementCorrection = typeof measurementCorrections.$inferSelect;
export type InsertMeasurementCorrection = typeof measurementCorrections.$inferInsert;
