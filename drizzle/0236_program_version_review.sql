-- doc 38 Đợt T-2 — FOUR-EYES AT THE VERSION (program_artifacts).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Today four-eyes exists ONLY at deploy (programmingService SoD). An artifact
-- VERSION is authored freely and can be built/deployed by the same person. This
-- migration adds a REVIEW gate at the version level so a version must be reviewed
-- by a SECOND person (reviewer ≠ author) before it can be built/deployed.
--
--   • reviewStatus  — pending_review (default) → approved | rejected.
--   • reviewedBy    — the reviewer (must differ from createdBy — enforced in code
--                     via assertApprovalSoD; not a DB CHECK because createdBy is
--                     nullable and the app owns the SoD message).
--   • reviewedAt    — when the review decision was recorded.
--
-- Additive + idempotent. ENFORCEMENT is flag-gated in code
-- (DPC_VERSION_REVIEW_ENABLED, default OFF): applying this migration alone changes
-- NO behaviour. Existing rows default to 'pending_review'; with the flag OFF that
-- has no effect, and with the flag ON an operator approves versions before build.
-- Numbered 0236 (0235 = hourly_yield_continuous_aggregate).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Review-status enum ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'programartifactreviewstatusenum') THEN
    CREATE TYPE programartifactreviewstatusenum AS ENUM ('pending_review', 'approved', 'rejected');
  END IF;
END $$;

-- ─── Columns on program_artifacts (all additive, nullable except the status) ──
ALTER TABLE program_artifacts
  ADD COLUMN IF NOT EXISTS "reviewStatus" programartifactreviewstatusenum NOT NULL DEFAULT 'pending_review';
ALTER TABLE program_artifacts
  ADD COLUMN IF NOT EXISTS "reviewedBy" INTEGER;
ALTER TABLE program_artifacts
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP;

-- Index the review status so the "pending review" queue is a cheap lookup.
CREATE INDEX IF NOT EXISTS idx_prog_artifacts_review ON program_artifacts ("reviewStatus");
