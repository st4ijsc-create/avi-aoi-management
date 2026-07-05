-- ============================================================================
-- Migration 0199: product onboarding drafts (doc 31 Đợt D · gap UX1 · WD-1).
--
-- PROBLEM (UX1): the product-config journey is 9-10 disjoint destinations across
-- 3 nav groups with no product-side wizard (the /aoi-onboarding wizard is
-- machine-only). The new guided flow /product-onboarding needs a RESUMABLE draft
-- so an engineer can leave mid-setup and return.
--
-- WHAT THIS DOES (additive + idempotent — CREATE TABLE/INDEX IF NOT EXISTS only;
-- no ALTER TYPE, no new pg enum, no change to any existing table):
--   CREATE TABLE product_onboarding_drafts — one row per product's guided setup:
--     status 'draft'      = resumable wizard state (currentStep + stepState jsonb)
--     status 'completed'  = the engineer clicked "Finish" on the review step
--
-- Mirrors aoi_commissioning_records (0177) draft semantics but keyed by
-- productModelId. There are NO secrets in this snapshot (it holds per-step
-- todo/done/skipped status + optional notes only), so no credential-stripping is
-- needed. productModelId is a SOFT ref to product_models.id (same convention as
-- measurement_point_defs.productModelId / golden_sample_references.productModelId)
-- so deleting a product never orphans/blocks anything here.
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "product_onboarding_drafts" (
  "id"             serial PRIMARY KEY,
  "productModelId" integer NOT NULL,
  "currentStep"    integer NOT NULL DEFAULT 0,
  "stepState"      jsonb,
  "status"         varchar(20) NOT NULL DEFAULT 'draft',
  "createdBy"      integer,
  "createdAt"      timestamp NOT NULL DEFAULT now(),
  "updatedAt"      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_product_onboarding_product"
  ON "product_onboarding_drafts" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_product_onboarding_status"
  ON "product_onboarding_drafts" ("status");
