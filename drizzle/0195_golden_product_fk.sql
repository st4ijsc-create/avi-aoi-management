-- Doc 31 Đợt B (PM5 / UX8 / OP7, WB-3) — golden_sample_references ↔ product_models link.
--
-- PROBLEM: golden_sample_references was keyed by `productCode` (a free varchar),
-- NOT a link to product_models. Renaming a product's code silently orphaned its
-- goldens, and the product page had no way to see "this product's goldens".
--
-- FIX (additive, logical FK — mirrors the by-code convention already used for
-- measurementPointDefs.productModelId / componentCode; NO hard REFERENCES so a
-- golden whose productCode doesn't match any product simply stays NULL and keeps
-- working through the legacy productCode path):
--   * ADD COLUMN productModelId integer NULL
--   * BACKFILL by matching the existing productCode → product_models.code
--   * INDEX productModelId (partial, NOT NULL) for the per-product panel query
--
-- productCode is KEPT (compat): the production diff resolver still keys by
-- productCode (inspection.productModel is a code string) — behavior unchanged.
-- The FK is used for surfacing (product page panel) + rename-safe linkage +
-- release-snapshot provenance (OP7).
--
-- Idempotent: guarded on the absence of the productModelId column so a re-run
-- can never re-backfill rows whose FK was later cleared on purpose.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'golden_sample_references' AND column_name = 'productModelId'
  ) THEN
    ALTER TABLE "golden_sample_references" ADD COLUMN "productModelId" integer;

    -- Backfill the FK from the legacy productCode (any lifecycle — dev/active/eol).
    UPDATE "golden_sample_references" g
    SET "productModelId" = pm."id"
    FROM "product_models" pm
    WHERE g."productModelId" IS NULL
      AND g."productCode" IS NOT NULL
      AND g."productCode" = pm."code";
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_golden_ref_product_model"
  ON "golden_sample_references" ("productModelId")
  WHERE "productModelId" IS NOT NULL;
