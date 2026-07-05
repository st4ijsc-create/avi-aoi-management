// Schema domain: Defect Dispositions (doc 27 §5 gap F2, Đợt 5 item 5.3 — W5-B)
//
// ════════════════════════════════════════════════════════════════════════════
// Closes the repair/rework loop that used to end at the QC verdict: an NG/NTF
// inspection (or one specific defect point on it) gets a DISPOSITION decision
// (rework / repair / scrap / use_as_is / return_to_vendor) with a small repair
// lifecycle the technician walks through:
//
//   open → in_repair → repaired → re_inspect_pending → closed
//        ↘ closed (scrap / use_as_is / return_to_vendor may close directly)
//   re_inspect_pending → in_repair (re-inspection failed → back to repair)
//
// Legal transitions are enforced in server/services/defectDispositionService.ts
// (illegal → CONFLICT) and every step is audit-logged. Re-inspect verification
// is DERIVED, never stored: a later product_inspections row with the same
// serialNumber (see reInspectStatus in the service).
//
// SOFT REFERENCES (deliberate — mirrors goldenSample.ts / 0182 reasoning):
//   * inspectionId / measurementResultId have NO FK — product_inspections and
//     measurement_results may be Timescale hypertables (0172) which cannot be
//     the target of an FK. Validated in the service; weekly orphan scan covers.
//   * workOrderId is a LINK-ONLY soft ref to maintenance_work_orders.id.
//     Auto-creating board-repair WOs was evaluated and REJECTED: maintenance
//     WOs are machine-centric and every COMPLETED row feeds that machine's
//     MTTR/MTBF (pdmWorkOrderService.computeMttrMtbf) — board repairs would
//     corrupt machine reliability metrics. Linking an existing machine WO
//     (e.g. NG root-caused to the machine itself) stays possible.
//
// `disposition`/`status` are plain varchar (no new pg enums) so migration 0183
// stays CREATE TABLE/INDEX only.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

/** Disposition decision kinds (plain varchar in DB — see header). */
export const DEFECT_DISPOSITION_TYPES = [
  "rework",
  "repair",
  "scrap",
  "use_as_is",
  "return_to_vendor",
] as const;
export type DefectDispositionType = (typeof DEFECT_DISPOSITION_TYPES)[number];

/** Repair lifecycle states (plain varchar in DB — see header). */
export const DEFECT_DISPOSITION_STATUSES = [
  "open",
  "in_repair",
  "repaired",
  "re_inspect_pending",
  "closed",
] as const;
export type DefectDispositionStatus = (typeof DEFECT_DISPOSITION_STATUSES)[number];

export const defectDispositions = pgTable("defect_dispositions", {
  id: serial("id").primaryKey(),
  // Soft ref -> product_inspections.id (hypertable — no FK possible).
  inspectionId: integer("inspectionId").notNull(),
  // Optional soft ref -> measurement_results.id (one defect point vs whole board).
  measurementResultId: integer("measurementResultId"),
  // Denormalised at create time — queue display + serial re-inspect linkage.
  serialNumber: varchar("serialNumber", { length: 100 }),
  disposition: varchar("disposition", { length: 20 }).notNull().$type<DefectDispositionType>(),
  // LINK-ONLY soft ref -> maintenance_work_orders.id (see header).
  workOrderId: integer("workOrderId"),
  status: varchar("status", { length: 20 }).default("open").notNull().$type<DefectDispositionStatus>(),
  createdBy: integer("createdBy"),
  assignee: integer("assignee"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_defect_disp_inspection").on(table.inspectionId),
  index("idx_defect_disp_status").on(table.status),
  index("idx_defect_disp_serial").on(table.serialNumber),
]);

export type DefectDisposition = typeof defectDispositions.$inferSelect;
export type InsertDefectDisposition = typeof defectDispositions.$inferInsert;
