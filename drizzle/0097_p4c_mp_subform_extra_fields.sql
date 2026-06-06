-- 0097: P4.C G20 — Specialized measurement-point subforms.
-- Adds `extraFields` jsonb column to `measurement_point_defs` for per-typeCode
-- structured data (edge/burr, cosmetic scratch, color/gloss, engraving, gasket).
-- Validator lives in server/utils/mpVariantSubform.ts.

ALTER TABLE "measurement_point_defs"
  ADD COLUMN IF NOT EXISTS "extraFields" jsonb;

-- Index on measurementTypeCode (if not already present) to speed up the lookup
-- the subform router will perform when re-validating bulk rows.
CREATE INDEX IF NOT EXISTS "idx_point_defs_type_code"
  ON "measurement_point_defs" ("measurementTypeCode");
