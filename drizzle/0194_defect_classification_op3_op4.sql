-- ============================================================================
-- Migration 0194: Doc 31 Đợt B (WB-2) — Defect classification honesty & curation
--   OP3: defect catalog ↔ NG data was 0% linked. Root cause = the two ingest
--        defect-code sources (vendor *_DEFECT_MAP + AI) can emit codes that are
--        NOT in defect_catalog (taxonomy drift: BRIDGING vs SOLDER_BRIDGE,
--        COLD_JOINT vs COLD_SOLDER, VOID vs SOLDER_VOID, COMPONENT_MISALIGNMENT
--        vs MISALIGNMENT, REVERSE_POLARITY vs REVERSED_POLARITY …), and the
--        resolver silently dropped the unresolved code to NULL with no trail.
--   Fixes (all additive, hypertable-safe):
--     1) measurement_results.defectCodeRaw — keep the raw vendor/AI code even
--        when it does not resolve to a catalog row (never drop; honest NULL id).
--     2) unmatched_defect_codes — a small rollup so engineers can see
--        "code X seen 400× but not in catalog" and curate it in.
--     3) defect_catalog.repairGuidance (+ Vi) — OP4 curation field surfaced in
--        RepairStation / InspectionDetail (both already read the catalog).
--
-- Additive + idempotent (IF NOT EXISTS / CREATE TABLE IF NOT EXISTS). No data
-- rewrite of the 15,590 historical NG rows — those are recovered by the new
-- telemetry + curation UI, not by a destructive backfill.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Raw defect-code fallback on measurement_results (hypertable-safe add).
--    Holds the code as reported by the machine/AI when it did NOT match a
--    defect_catalog row (defectCatalogId stays NULL — honest, recoverable).
-- ----------------------------------------------------------------------------
ALTER TABLE "measurement_results"
  ADD COLUMN IF NOT EXISTS "defectCodeRaw" varchar(50);

-- ----------------------------------------------------------------------------
-- 2) Repair-guidance curation field on defect_catalog (OP4).
-- ----------------------------------------------------------------------------
ALTER TABLE "defect_catalog"
  ADD COLUMN IF NOT EXISTS "repairGuidance"   text,
  ADD COLUMN IF NOT EXISTS "repairGuidanceVi" text;

-- ----------------------------------------------------------------------------
-- 3) Unmatched defect-code rollup (OP3 telemetry).
--    One row per unresolved code (aggregate). machineId/productModelId keep the
--    LAST-seen context (sample), seenCount is the running total. resolvedCatalogId
--    is stamped when an engineer curates the code into the catalog so the panel
--    can hide/annotate it.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "unmatched_defect_codes" (
  "id"                 serial PRIMARY KEY,
  "code"               varchar(50) NOT NULL,
  "machineId"          integer,
  "productModelId"     integer,
  "seenCount"          integer NOT NULL DEFAULT 0,
  "resolvedCatalogId"  integer,
  "firstSeenAt"        timestamp NOT NULL DEFAULT NOW(),
  "lastSeenAt"         timestamp NOT NULL DEFAULT NOW(),
  "createdAt"          timestamp NOT NULL DEFAULT NOW(),
  "updatedAt"          timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_unmatched_defect_code"
  ON "unmatched_defect_codes" ("code");
CREATE INDEX IF NOT EXISTS "idx_unmatched_defect_last_seen"
  ON "unmatched_defect_codes" ("lastSeenAt");
CREATE INDEX IF NOT EXISTS "idx_unmatched_defect_unresolved"
  ON "unmatched_defect_codes" ("resolvedCatalogId") WHERE "resolvedCatalogId" IS NULL;

-- ----------------------------------------------------------------------------
-- 4) Audit log entry for the migration.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='audit_logs') THEN
    INSERT INTO "audit_logs"
      ("userName","action","entityType","entityId","entityName","details","status","createdAt")
    VALUES
      ('system', 'migrate', 'defect_catalog', 0,
       'Doc 31 Đợt B (0194) — defect classification honesty (OP3) + repair guidance (OP4)',
       '{"migration":"0194","adds":["measurement_results.defectCodeRaw","unmatched_defect_codes","defect_catalog.repairGuidance"]}',
       'success', NOW());
  END IF;
END $$;
