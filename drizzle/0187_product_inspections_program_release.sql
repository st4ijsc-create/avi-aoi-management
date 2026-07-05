-- ============================================================================
-- Migration 0187: product_inspections.programReleaseId
-- (doc 27 Đợt 7 — agent W7-A; the Đợt-3 deferred stamping noted by W3-C).
--
-- WHAT: which RELEASED inspection program (inspection_program_releases.id,
-- table from 0182) was the production truth for (productModelId, machineId)
-- at ingest time. Stamped fail-open by processInspectionSubmission via
-- inspectionProgramService.getActiveRelease. NULL = no released program was in
-- force (machine running an unreleased/draft program) or a pre-0187 row.
--
-- HYPERTABLE SAFETY: product_inspections may be a TimescaleDB hypertable
-- (0172). A plain NULLABLE ADD COLUMN with no DEFAULT is metadata-only and
-- fully supported on hypertables (no table rewrite). The dev/test DBs are
-- plain PG today — same statement works on both.
--
-- SOFT REFERENCE (deliberate, mirrors 0182/0183 reasoning): NO FK. While an
-- FK FROM a hypertable TO a plain table is technically allowed, every other
-- reference around inspection rows is soft (app-validated + weekly integrity
-- orphan scan) — keeping the convention avoids a one-off constraint that
-- would also break test fixtures that fabricate release ids.
--
-- Idempotent / re-runnable: IF NOT EXISTS everywhere. Applied by the targeted
-- runner scripts/apply-migration-0187.mjs (tracked in __applied_migrations).
-- ============================================================================

ALTER TABLE "product_inspections"
  ADD COLUMN IF NOT EXISTS "programReleaseId" integer;

-- Partial index: analytics filter "which boards ran release X" — the column is
-- sparse until releases are adopted, so exclude NULLs to keep it tiny.
CREATE INDEX IF NOT EXISTS "idx_inspections_program_release"
  ON "product_inspections" ("programReleaseId")
  WHERE "programReleaseId" IS NOT NULL;

COMMENT ON COLUMN "product_inspections"."programReleaseId" IS
  'Doc 27 W7-A (0187): inspection_program_releases.id RELEASED for (productModelId, machineId) at ingest; soft ref, stamped fail-open by processInspectionSubmission; NULL = no released program / legacy row.';
