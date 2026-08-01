-- ============================================================================
-- Migration 0165: Second-approver (segregation of duties) for machine_recipes
-- (audit doc 25 · T6 / task W2-9).
--
-- PROBLEM: a recipe could be created AND deployed by the same person (HITL "tự ký").
-- No approval provenance existed on the table. This adds the approval fields so the
-- service layer can enforce a two-person control: the creator (createdBy) may NOT be
-- the approver (approvedBy), and a recipe can only be deployed once approved.
--
-- WHAT THIS DOES (additive + idempotent — ADD COLUMN IF NOT EXISTS only, all nullable
-- so existing rows are unaffected; no ALTER TYPE, no new pg enum):
--   approvedBy    integer   — user id of the second approver (NULL = not yet approved)
--   approvedAt    timestamp — when it was approved
--   approvalNote  text      — free-text note captured at approval time
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

ALTER TABLE "machine_recipes" ADD COLUMN IF NOT EXISTS "approvedBy" integer;
ALTER TABLE "machine_recipes" ADD COLUMN IF NOT EXISTS "approvedAt" timestamp;
ALTER TABLE "machine_recipes" ADD COLUMN IF NOT EXISTS "approvalNote" text;
