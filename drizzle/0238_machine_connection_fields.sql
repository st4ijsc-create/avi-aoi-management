-- ============================================================================
-- Migration 0238: Machine connection fields — doc 40 W1 (Tuấn-P0)
--
-- ADDITIVE and IDEMPOTENT. Adds three NULLABLE columns to `machines` so the
-- IP/port/protocol entered in the onboarding wizard (Step 2 — testConnection
-- probe) is PERSISTED on the machine record instead of being discarded after
-- the reachability test. All columns are nullable → no default, no backfill,
-- and existing callers of machine.create (which do not send these fields) keep
-- working unchanged.
--
-- COLUMN NAMES: this schema stores columns in QUOTED camelCase (see
-- drizzle/schema/hierarchy.ts — "serialNumber", "firmwareVersion",
-- "registrationStatus"). Do NOT snake_case them.
--
-- Safe to apply on a live system and safe to re-run (every statement is
-- IF NOT EXISTS via ADD COLUMN).
-- ============================================================================

ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "ipAddress" varchar(45);
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "port" integer;
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "connectionProtocol" varchar(20);
