-- ============================================================================
-- Migration 0158: Golden-sample references (doc 24 Wave-2, phase AOI-B)
--
-- Backs the golden-sample REFERENCE ALIGNMENT upgrade: sub-pixel affine/homography
-- registration (server/services/imageRegistration.ts) needs a stored "known-good"
-- reference image per product/recipe to register a candidate against before the
-- defect-diff. This table is that store.
--
-- SELF-CONTAINED STORAGE: the reference is kept as a GRAYSCALE RAW plane, base64 in
-- `grayBase64` + width/height, so a consumer reconstructs a Buffer and registers
-- directly (no filesystem dependency). `imageUrl` is provenance only. One ACTIVE
-- row per (productCode, recipeCode, stationCode, roiKey); setting a new reference
-- bumps `version` and deactivates prior rows (soft history).
--
-- WHAT THIS DOES (additive + idempotent — CREATE TABLE/INDEX IF NOT EXISTS only,
-- no ALTER TYPE, no new pg enum; `status`/`format` are plain varchar):
--   1. CREATE TABLE golden_sample_references.
--   2. CREATE the lookup indexes (product / recipe / active / composite key).
--
-- HONESTY: this is SCHEMA ONLY. It changes NO query behaviour on its own. The
-- registration path is opt-in via ALIGN_BEFORE_DIFF; when off, this table is inert.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "golden_sample_references" (
  "id"            serial PRIMARY KEY,
  "productCode"   varchar(128),
  "recipeCode"    varchar(128),
  "stationCode"   varchar(128),
  "roiKey"        varchar(128),
  "version"       integer NOT NULL DEFAULT 1,
  "active"        boolean NOT NULL DEFAULT true,
  "grayBase64"    text NOT NULL,
  "width"         integer NOT NULL,
  "height"        integer NOT NULL,
  "format"        varchar(16) NOT NULL DEFAULT 'gray-raw',
  "imageUrl"      text,
  "notes"         text,
  "corporateCode" varchar(50),
  "factoryId"     integer,
  "createdBy"     integer,
  "createdAt"     timestamp NOT NULL DEFAULT now(),
  "updatedAt"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_golden_ref_product"
  ON "golden_sample_references" ("productCode");
CREATE INDEX IF NOT EXISTS "idx_golden_ref_recipe"
  ON "golden_sample_references" ("recipeCode");
CREATE INDEX IF NOT EXISTS "idx_golden_ref_active"
  ON "golden_sample_references" ("active");
CREATE INDEX IF NOT EXISTS "idx_golden_ref_key"
  ON "golden_sample_references" ("productCode", "recipeCode", "stationCode", "roiKey");
