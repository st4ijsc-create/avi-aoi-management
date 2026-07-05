-- ============================================================================
-- Migration 0177: AOI/AVI commissioning records (doc 27 §3 gap C4 + §2 gap M8,
-- Wave-2 agent W2-D — AOI Onboarding Wizard).
--
-- PROBLEM: onboarding a real AOI/AVI machine had no guided path and no
-- commissioning sign-off ledger: nothing records WHO validated a machine's
-- vendor adapter + data feed and WHEN it was accepted into production.
--
-- WHAT THIS DOES (additive + idempotent — CREATE TABLE/INDEX IF NOT EXISTS only;
-- no ALTER TYPE, no new pg enum, no change to any existing table):
--   1. CREATE TABLE aoi_commissioning_records — one row per onboarding run:
--        status 'draft'          = resumable wizard state (configSnapshot jsonb)
--        status 'commissioned'   = signed off (signedBy/signedAt) → ingest counts
--                                  as "production" for this machine
--        status 'decommissioned' = sign-off revoked
--
-- GATE SEMANTICS (SOFT — documented here on purpose): this table does NOT block
-- ingest. Machines without a 'commissioned' record still submit inspections
-- normally; the ingest path merely CONSULTS
-- server/services/aoiCommissioningService.ts (getAoiIngestMode) to TAG such
-- submissions as commissioning-mode. Existing machines keep working unchanged.
--
-- SECURITY: configSnapshot must never contain a plaintext API key — the router
-- strips credentials down to a display prefix before persisting.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked
-- in __applied_migrations. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "aoi_commissioning_records" (
  "id"             serial PRIMARY KEY,
  "machineId"      integer NOT NULL,
  "status"         varchar(20) NOT NULL DEFAULT 'draft',
  "configSnapshot" jsonb,
  "signedBy"       integer,
  "signedAt"       timestamp,
  "note"           text,
  "createdBy"      integer,
  "createdAt"      timestamp NOT NULL DEFAULT now(),
  "updatedAt"      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_aoi_commissioning_machine"
  ON "aoi_commissioning_records" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_aoi_commissioning_status"
  ON "aoi_commissioning_records" ("status");
CREATE INDEX IF NOT EXISTS "idx_aoi_commissioning_signed_at"
  ON "aoi_commissioning_records" ("signedAt");
