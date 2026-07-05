-- W7-C (doc 27 §9 V11 + V7) — golden-sample APPROVAL WORKFLOW + align-before-diff flag.
--
-- Adds to golden_sample_references:
--   * status        — 'draft' | 'approved' | 'retired' (plain varchar, no pg enum —
--                     same additive style as the table's `format` column)
--   * approvedBy / approvedAt / approvalNote — second-person sign-off (SoD is
--     app-enforced in server/db/goldenSample.ts, mirroring machineRecipe W2-9)
--   * alignBeforeDiff — per-golden enable for sub-pixel registration before diff
--     (V7; ALIGN_BEFORE_DIFF env stays as the global kill-switch)
--   * sourceInspectionId / sourceMeasurementId — provenance when captured from a
--     known-good inspection (V8 captureFromInspection)
--
-- BACKFILL: every row that exists BEFORE this migration was created without an
-- approval concept and is (potentially) already used in production resolution →
-- grandfather as status='approved' with approvalNote='grandfathered' so the
-- W5-B read path (getActiveForKey) keeps returning them unchanged.
--
-- Idempotent: the whole block is guarded on the absence of the `status` column,
-- so a re-run can never re-grandfather later drafts.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'golden_sample_references' AND column_name = 'status'
  ) THEN
    ALTER TABLE "golden_sample_references" ADD COLUMN "status" varchar(16) NOT NULL DEFAULT 'draft';
    ALTER TABLE "golden_sample_references" ADD COLUMN "approvedBy" integer;
    ALTER TABLE "golden_sample_references" ADD COLUMN "approvedAt" timestamp;
    ALTER TABLE "golden_sample_references" ADD COLUMN "approvalNote" text;
    ALTER TABLE "golden_sample_references" ADD COLUMN "alignBeforeDiff" boolean NOT NULL DEFAULT true;
    ALTER TABLE "golden_sample_references" ADD COLUMN "sourceInspectionId" integer;
    ALTER TABLE "golden_sample_references" ADD COLUMN "sourceMeasurementId" integer;

    -- Grandfather all pre-existing rows (they predate the workflow; in production use).
    UPDATE "golden_sample_references"
    SET "status" = 'approved', "approvalNote" = 'grandfathered';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_golden_ref_status" ON "golden_sample_references" ("status");
