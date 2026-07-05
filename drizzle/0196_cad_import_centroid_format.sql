-- ============================================================================
-- Migration 0196: Doc 31 Đợt C (MP5 / PM4, decision #5) —
-- allow the generic centroid / pick-place import format.
--
-- The original cad_import_jobs.format CHECK (migration 0093) only permitted
-- ('step','dxf'). The generic centroid importer writes format='centroid', and
-- the existing DXF/STEP router already emits 'gerber' from parseCad — both were
-- silently blocked by the old constraint. This migration relaxes the CHECK to
-- include 'gerber' and 'centroid' (additive, non-destructive, idempotent).
-- ============================================================================

ALTER TABLE "cad_import_jobs"
  DROP CONSTRAINT IF EXISTS "chk_cad_import_jobs_format";

ALTER TABLE "cad_import_jobs"
  ADD CONSTRAINT "chk_cad_import_jobs_format"
  CHECK ("format" IN ('step','dxf','gerber','centroid'));
