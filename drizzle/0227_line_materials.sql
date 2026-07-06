-- ============================================================================
-- Migration 0227: SMT Line Materials (doc 35 W4-C)
--
-- Closes the biggest L1 process white-space in line materials by adding three
-- lean, additive ledgers:
--   1. feeder_setup_verifications — scan a (slot + reel) before a run and record
--      whether the physical part MATCHES the expected component for that slot
--      (wrong-part guard — a critical SMT defect source). Enforcement (block run
--      on mismatch) is gated by FEEDER_VERIFY_ENFORCED (DEFAULT OFF); RECORDING
--      the check works regardless of the flag.
--   2. msd_exposure_logs — J-STD-020 moisture-sensitive-device floor-life clock:
--      when a reel leaves dry storage the clock starts; remaining floor-life is
--      derived from the MSL level. ADVISORY only (no hard enforcement); any
--      scheduler is gated by MSD_TRACKING_ENABLED (DEFAULT OFF).
--   3. stencil_usage_logs — accrues stencil print cycles + records clean / tension
--      checks. Worn status = tools.lifeUsed (baseline) + SUM(printCount) vs
--      tools.lifeLimit (computed read-only; tools master is NOT written here).
--      Side-effects gated by STENCIL_TRACKING_ENABLED (DEFAULT OFF).
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS only. No ALTER TYPE,
-- no new pg enum — verdict / status / mslLevel are plain varchar (mirrors the
-- commissioning_records precedent, migration 0157). Changes NO existing query
-- behaviour on its own; inert until a router/service reads these tables.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

-- 1) Feeder-setup verification ------------------------------------------------
CREATE TABLE IF NOT EXISTS "feeder_setup_verifications" (
  "id"                    serial PRIMARY KEY,
  "machineId"             integer NOT NULL,
  "lineId"                integer,
  "productModelId"        integer,
  "programId"             integer,
  "slotCode"              varchar(40),
  "expectedComponentCode" varchar(100),
  "scannedComponentCode"  varchar(100),
  "scannedReel"           varchar(128),
  "feederMaterialId"      integer,
  "verdict"               varchar(16) NOT NULL,
  "verifiedBy"            integer,
  "verifiedAt"            timestamp NOT NULL DEFAULT now(),
  "notes"                 text,
  "createdAt"             timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_feederverify_machine"      ON "feeder_setup_verifications" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_feederverify_machine_slot" ON "feeder_setup_verifications" ("machineId", "slotCode");
CREATE INDEX IF NOT EXISTS "idx_feederverify_product"      ON "feeder_setup_verifications" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_feederverify_verdict"      ON "feeder_setup_verifications" ("verdict");
CREATE INDEX IF NOT EXISTS "idx_feederverify_verifiedat"   ON "feeder_setup_verifications" ("verifiedAt");

-- 2) MSD floor-life clock (J-STD-020) ----------------------------------------
CREATE TABLE IF NOT EXISTS "msd_exposure_logs" (
  "id"                    serial PRIMARY KEY,
  "componentCode"         varchar(100) NOT NULL,
  "reelId"                varchar(128),
  "materialId"            integer,
  "mslLevel"              varchar(8) NOT NULL,
  "removedFromDryAt"      timestamp NOT NULL,
  "floorLifeHoursAllowed" numeric(10, 2),
  "exposedHoursAccrued"   numeric(10, 2) NOT NULL DEFAULT '0',
  "status"                varchar(16) NOT NULL DEFAULT 'ok',
  "bakeStartedAt"         timestamp,
  "closedAt"              timestamp,
  "machineId"             integer,
  "loggedBy"              integer,
  "notes"                 text,
  "createdAt"             timestamp NOT NULL DEFAULT now(),
  "updatedAt"             timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_msd_component" ON "msd_exposure_logs" ("componentCode");
CREATE INDEX IF NOT EXISTS "idx_msd_reel"      ON "msd_exposure_logs" ("reelId");
CREATE INDEX IF NOT EXISTS "idx_msd_status"    ON "msd_exposure_logs" ("status");
CREATE INDEX IF NOT EXISTS "idx_msd_removedat" ON "msd_exposure_logs" ("removedFromDryAt");
CREATE INDEX IF NOT EXISTS "idx_msd_material"  ON "msd_exposure_logs" ("materialId");

-- 3) Stencil cycle counter ----------------------------------------------------
CREATE TABLE IF NOT EXISTS "stencil_usage_logs" (
  "id"             serial PRIMARY KEY,
  "stencilToolId"  integer NOT NULL,
  "printCount"     integer NOT NULL DEFAULT 0,
  "cleanedAt"      timestamp,
  "tensionCheckAt" timestamp,
  "tensionValue"   numeric(8, 2),
  "machineId"      integer,
  "recordedBy"     integer,
  "notes"          text,
  "createdAt"      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_stencilusage_tool"      ON "stencil_usage_logs" ("stencilToolId");
CREATE INDEX IF NOT EXISTS "idx_stencilusage_createdat" ON "stencil_usage_logs" ("createdAt");
