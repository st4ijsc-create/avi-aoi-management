-- 0096_p4c_inspection_variant_payload.sql
-- P4.C G16 — Specialized inspection-type subforms.
-- Add a polymorphic JSONB payload + a string discriminator to product_inspections
-- so callers can attach FAI / IQC / OQC / AOI-specific subform data without
-- proliferating per-type tables. Validation lives in server/utils/inspectionVariant.ts.

ALTER TABLE "product_inspections"
  ADD COLUMN IF NOT EXISTS "inspectionType" varchar(40),
  ADD COLUMN IF NOT EXISTS "variantPayload" jsonb;

CREATE INDEX IF NOT EXISTS "idx_inspections_type"
  ON "product_inspections" ("inspectionType");
