-- Doc 31 Đợt C (PM1 / PM2, decision #6, WC-2) — product revision + clone provenance.
--
-- PM2 (decision #6): product revision is a free-text field, NOT a genealogy table.
-- A new revision of a board is made by CLONING the product (PM1) into a new code and
-- bumping `revision`. No `product_revisions` table, no diff engine.
--
-- Adds two nullable columns to product_models (additive, backward-compatible):
--   * revision      varchar(32)  — engineering revision label ("A", "B", "Rev2"). NULL default.
--   * clonedFromId  integer      — SOFT provenance ref to the source product_models.id when the
--                                  row was created via productModel.clone. NO hard REFERENCES
--                                  (same soft-ref convention as measurementPointDefs.productModelId
--                                  / golden_sample_references.productModelId) so deleting the source
--                                  never orphans/blocks the clone. NULL = authored from scratch.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. No backfill (both columns default NULL).

ALTER TABLE "product_models" ADD COLUMN IF NOT EXISTS "revision" varchar(32);
ALTER TABLE "product_models" ADD COLUMN IF NOT EXISTS "clonedFromId" integer;

-- Optional: index the provenance ref for "show clones of product X" lookups.
CREATE INDEX IF NOT EXISTS "idx_product_models_cloned_from"
  ON "product_models" ("clonedFromId")
  WHERE "clonedFromId" IS NOT NULL;
