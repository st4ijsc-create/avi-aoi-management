-- ============================================================================
-- Migration 0225: maintenance automation — spare-parts consumption ledger
-- (doc 35 Wave W4-A — maintenance automation).
--
-- PROBLEM: spare_parts_inventory (0-series MES schema) is ORPHANED — there is
-- no link recording that a maintenance work order CONSUMED parts, and nothing
-- decrements quantityOnHand. Reorder levels exist but never fire.
--
-- FIX: work_order_parts — an append-per-consumption ledger. maintenanceRouter
-- .recordPartsUsed inserts one row per consumption AND decrements
-- spare_parts_inventory.quantityOnHand atomically (single db.transaction).
--
-- FK NOTES (deliberate soft references, mirroring 0183's reasoning):
--   * workOrderId — soft ref -> maintenance_work_orders.id, LINK-ONLY (no hard
--     FK) so this migration stays additive (CREATE TABLE/INDEX only). The app
--     validates the work order exists on record.
--   * sparePartId — soft ref -> spare_parts_inventory.id (nullable); partCode is
--     the denormalised handle kept alongside.
--   * unitCost is a SNAPSHOT of the inventory unitCost at consumption time.
--
-- No new pg enums, no ALTER TYPE — additive + idempotent (IF NOT EXISTS).
-- Re-runnable.
--
-- NOTE: the PM auto-scheduler (pmScheduleService) added in this wave needs NO
-- DDL — it reuses maintenance_schedules.nextDueAt/intervalDays and the existing
-- maintenance_work_orders.scheduleId/trigger='SCHEDULE' columns.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "work_order_parts" (
  "id"            serial PRIMARY KEY,
  -- Soft ref -> maintenance_work_orders.id (see header). NOT NULL: a consumption
  -- always belongs to one work order.
  "workOrderId"   integer NOT NULL,
  -- Soft ref -> spare_parts_inventory.id (nullable — may be resolved by partCode).
  "sparePartId"   integer,
  "partCode"      varchar(64) NOT NULL,
  "quantityUsed"  integer NOT NULL DEFAULT 1,
  -- Snapshot of spare_parts_inventory.unitCost at consumption time.
  "unitCost"      numeric(14, 2),
  "consumedAt"    timestamp NOT NULL DEFAULT now(),
  "consumedBy"    integer,
  "notes"         text,
  "createdAt"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_wop_workorder" ON "work_order_parts" ("workOrderId");
CREATE INDEX IF NOT EXISTS "idx_wop_sparepart" ON "work_order_parts" ("sparePartId");
CREATE INDEX IF NOT EXISTS "idx_wop_partcode"  ON "work_order_parts" ("partCode");
