-- ============================================================================
-- Migration 0183: defect_dispositions — close the repair/rework loop
-- (doc 27 §5 gap F2, Đợt 5 item 5.3 — agent W5-B).
--
-- PROBLEM: InspectionDetail lets QC re-judge OK/NG/NTF and classify per
-- IPC-A-610, but a confirmed NG then VANISHES from the system — no disposition
-- decision (rework/repair/scrap/…), no repair lifecycle, no link to the
-- re-inspection that verifies the fix. The repair loop was open-ended.
--
-- FIX: an append-per-decision disposition ledger:
--   NG/NTF verdict → createDisposition (rework|repair|scrap|use_as_is|
--   return_to_vendor) → status lifecycle open → in_repair → repaired →
--   re_inspect_pending → closed (service enforces legal transitions; every
--   step audit-logged). Re-inspect verification is DERIVED, not stored: a
--   later product_inspections row with the same serialNumber.
--
-- FK NOTES (deliberate soft references, mirroring 0182's reasoning):
--   * inspectionId / measurementResultId — NO FK: product_inspections and
--     measurement_results may be TimescaleDB hypertables (0172), and Postgres
--     cannot hold an FK **referencing** a hypertable. App validates on create;
--     the weekly integrity orphan scan is the safety net.
--   * workOrderId — soft ref to maintenance_work_orders.id, LINK-ONLY by
--     design: maintenance WOs are machine-centric and their COMPLETED rows
--     feed MTTR/MTBF (pdmWorkOrderService.computeMttrMtbf counts ALL closed
--     WOs per machine) — auto-creating board-repair WOs there would corrupt
--     machine reliability metrics. A dedicated repair-station interface is
--     Đợt 7.6 territory.
--
-- `disposition` / `status` are plain varchar (NOT new pg enums) so this stays
-- CREATE TABLE/INDEX only — additive + idempotent, no ALTER TYPE.
-- Applied by a targeted runner (run-0183-migration.mjs — other agents' 0179+
-- may still be pending), tracked in __applied_migrations. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "defect_dispositions" (
  "id"                  serial PRIMARY KEY,
  -- Soft ref -> product_inspections.id (hypertable — see header). NOT NULL:
  -- a disposition always belongs to one inspection.
  "inspectionId"        integer NOT NULL,
  -- Optional soft ref -> measurement_results.id when the decision targets one
  -- specific defect point rather than the whole board.
  "measurementResultId" integer,
  -- Denormalised from the inspection at create time — powers the queue view
  -- and the serial-based re-inspect linkage without touching the hypertable.
  "serialNumber"        varchar(100),
  -- 'rework' | 'repair' | 'scrap' | 'use_as_is' | 'return_to_vendor'
  "disposition"         varchar(20) NOT NULL,
  -- Soft ref -> maintenance_work_orders.id (LINK-ONLY — see header).
  "workOrderId"         integer,
  -- 'open' | 'in_repair' | 'repaired' | 're_inspect_pending' | 'closed'
  "status"              varchar(20) NOT NULL DEFAULT 'open',
  -- users.id of the QC who decided / the repair technician assigned.
  "createdBy"           integer,
  "assignee"            integer,
  "note"                text,
  "createdAt"           timestamp DEFAULT now() NOT NULL,
  "updatedAt"           timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_defect_disp_inspection" ON "defect_dispositions" ("inspectionId");
CREATE INDEX IF NOT EXISTS "idx_defect_disp_status"     ON "defect_dispositions" ("status");
CREATE INDEX IF NOT EXISTS "idx_defect_disp_serial"     ON "defect_dispositions" ("serialNumber");
