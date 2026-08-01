-- ============================================================================
-- Migration 0157: Hardware commissioning / FAT gate (doc 24 Wave-1, phase C2)
--
-- Adds the `commissioning_records` sign-off ledger that backs a NEW per-adapter
-- SAFETY GATE: a real (non-simulated) control write is BLOCKED unless the target
-- adapter has an ACTIVE, non-expired, SIGNED commissioning record — mirroring the
-- proven sim-gate → deploy precondition (program_sim_runs → program_deployments).
--
-- PRECEDENCE (enforced in server/services/ot/commandDispatcher.ts):
--   • The gate is flag-controlled by OT_COMMISSIONING_REQUIRED (DEFAULT ON —
--     safe by default; may be set false ONLY for legacy/dev).
--   • When the flag is ON and the adapter is NOT commissioned, the dispatcher
--     FORCES the 'simulated' path (records a command_log row, errorText
--     'not_commissioned: …', NO driver.writeTags) REGARDLESS of OT_CONTROL_ENABLED.
--   • This is an ADDITIONAL gate layered on top of the existing mode gate; it
--     STRENGTHENS safety and can never weaken any existing check.
--
-- WHAT THIS DOES (additive + idempotent — CREATE TABLE/INDEX IF NOT EXISTS only,
-- no ALTER TYPE, no new pg enum; `status` is a plain varchar):
--   1. CREATE TABLE commissioning_records (the sign-off ledger).
--   2. CREATE the supporting indexes for the "is adapter commissioned?" probe.
--
-- HONESTY: this is SCHEMA ONLY. It changes NO query behaviour on its own. With
-- OT_COMMISSIONING_REQUIRED off it is inert; with the default ON, an uncommissioned
-- adapter simply degrades a would-be real write to 'simulated' (never a NEW real
-- write) — strictly safer than before this migration existed.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "commissioning_records" (
  "id"           serial PRIMARY KEY,
  "adapterId"    integer NOT NULL,
  "status"       varchar(16) NOT NULL DEFAULT 'active',
  "fatReference" varchar(255),
  "signedBy"     integer NOT NULL,
  "signedAt"     timestamp NOT NULL DEFAULT now(),
  "expiresAt"    timestamp,
  "revokedBy"    integer,
  "revokedAt"    timestamp,
  "revokeReason" text,
  "notes"        text,
  "createdAt"    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_commissioning_records_adapter"
  ON "commissioning_records" ("adapterId");
CREATE INDEX IF NOT EXISTS "idx_commissioning_records_status"
  ON "commissioning_records" ("status");
CREATE INDEX IF NOT EXISTS "idx_commissioning_records_adapter_status"
  ON "commissioning_records" ("adapterId", "status");
