-- ============================================================================
-- Migration 0170: Golden / master recipe flag on machine_recipes
-- (audit doc 25 · task W5-22 (a)).
--
-- PROBLEM: there was no way to mark a recipe version as the GOLDEN (master/
-- reference) baseline for a code — the trusted set of parameters that deploys and
-- diffs should be compared against. This adds a single boolean flag.
--
-- WHAT THIS DOES (additive + idempotent — ADD COLUMN IF NOT EXISTS only, defaulted
-- so existing rows are unaffected; no ALTER TYPE, no new pg enum):
--   isGolden  boolean NOT NULL DEFAULT false — marks the golden/master version.
--
-- A partial index speeds up "the golden version(s) of this code" lookups. There is
-- deliberately NO uniqueness constraint: golden is a curator flag (a code may have
-- zero or, transiently, more than one golden), enforced/curated in the app layer.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

ALTER TABLE "machine_recipes" ADD COLUMN IF NOT EXISTS "isGolden" boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_machine_recipes_golden" ON "machine_recipes" ("code") WHERE "isGolden" = true;
