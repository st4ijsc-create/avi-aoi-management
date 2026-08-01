-- ============================================================================
-- Migration 0188: measurement_corrections + product_inspections."ntfScore"
-- (doc 27 §9 gaps V2/V3, Đợt 7 items 7.2/7.3 — agent W7-B).
--
-- PROBLEM (V2, P0): operator corrections (correctResult / confirmNTF) only
-- overwrite measurement_results.result and stuff the reason into `remark` —
-- the human verdict is never harvested as a structured label. No corrections
-- ledger, no agreement metric, no training data, and therefore (V3) no data
-- to ever train an NTF/false-call predictor.
--
-- FIX (additive, idempotent):
--   1. `measurement_corrections` — append-only ledger of every human verdict
--      change: original vs corrected result, who, why, which machine/point,
--      and a snapshot of the measurement's image ref for training. Feeds
--      ai_label_queue (humanLabel rows) + agreement/false-call analytics +
--      training export (aiFeedback.exportTrainingBatch second source).
--   2. product_inspections."ntfScore" real NULL — heuristic v1 false-call
--      likelihood (0..1) written by ntfPredictorService at ingest (W7-A seam
--      scoreInspectionNtf) / backfill script. Plain ADD COLUMN — safe on the
--      0172 TimescaleDB hypertable.
--
-- FK NOTES (same reasoning as 0183): inspectionId / measurementResultId are
-- SOFT refs — product_inspections / measurement_results may be hypertables
-- (0172) and Postgres cannot hold an FK referencing a hypertable. App
-- validates on insert; the weekly integrity orphan scan is the safety net.
-- `originalResult`/`correctedResult`/`source` are plain varchar (NOT pg
-- enums) so this stays CREATE TABLE/INDEX + ADD COLUMN only — re-runnable.
--
-- Applied by targeted runner scripts/apply-migration-0188.mjs (dev + test),
-- tracked in __applied_migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "measurement_corrections" (
  "id"                  serial PRIMARY KEY,
  -- Soft ref -> measurement_results.id. NULL = inspection-level correction
  -- (confirmNTF on an inspection that has no per-point NG rows).
  "measurementResultId" integer,
  -- Soft ref -> product_inspections.id (hypertable — see header). NOT NULL:
  -- every correction belongs to exactly one inspection.
  "inspectionId"        integer NOT NULL,
  -- Denormalised from the inspection at harvest time — powers per-machine
  -- agreement/false-call analytics without joining the hypertable.
  "machineId"           integer NOT NULL,
  -- Soft ref -> measurement_point_defs.id (repeat-offender signal). NULL for
  -- inspection-level rows.
  "pointDefId"          integer,
  -- 'OK' | 'NG' | 'NTF' — what the machine (or previous verdict) said.
  "originalResult"      varchar(10) NOT NULL,
  -- 'OK' | 'NG' | 'NTF' — what the human decided.
  "correctedResult"     varchar(10) NOT NULL,
  -- Harvest site: 'correct_result' (measurementResult.correctResult) |
  -- 'confirm_ntf' (inspection.confirmNTF). Explicit provenance (V25 lesson).
  "source"              varchar(20) NOT NULL DEFAULT 'correct_result',
  "reason"              text,
  -- users.id of the correcting operator (ctx.user.id).
  "operatorUserId"      integer NOT NULL,
  -- Snapshot of the measurement's image ref at correction time (training
  -- data must survive later edits to the measurement row).
  "imageKey"            varchar(255),
  "imageUrl"            text,
  "createdAt"           timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_mcorr_machine_created" ON "measurement_corrections" ("machineId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_mcorr_inspection"      ON "measurement_corrections" ("inspectionId");
-- Repeat-offender lookups for the NTF predictor: (machine, point) history.
CREATE INDEX IF NOT EXISTS "idx_mcorr_machine_point"   ON "measurement_corrections" ("machineId", "pointDefId");

-- V3: heuristic false-call likelihood (0..1), NULL = not scored. Plain
-- nullable ADD COLUMN — hypertable-safe, no table rewrite.
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "ntfScore" real;

-- Supports the History verify-queue sort (ntfScore DESC NULLS LAST). Partial:
-- only scored rows — cheap on the hypertable, propagates to chunks.
CREATE INDEX IF NOT EXISTS "idx_inspections_ntf_score"
  ON "product_inspections" ("ntfScore" DESC)
  WHERE "ntfScore" IS NOT NULL;
