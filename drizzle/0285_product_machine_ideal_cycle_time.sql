-- ============================================================================
-- Migration 0285 (doc 54 P2.2 — OEE-trust) — CONFIGURED ideal cycle time.
--
-- WHAT / WHY:
--   OEE Performance = (idealCycleTime × totalCount) / runTime. Until now the ONLY
--   sources for "idealCycleTime" were (a) reading back a prior oee_metrics row
--   (chicken-and-egg: OEE needs an ideal that only a prior OEE snapshot supplied)
--   or (b) the oee_targets implied ideal (avgCycle × targetPerformance — armed off
--   by default). Neither is a truly CONFIGURED standard. This adds a first-class
--   configured ideal per (product, machine) pair — the natural home, since a given
--   product runs at a given rate on a given machine.
--
--   NULLABLE, no default: NULL = not configured. The app (resolveIdealCycleTimeSec)
--   treats the configured value as the HIGHEST-priority source and falls back to the
--   legacy sources (target-implied → last oee_metrics → observed avg) — and returns
--   HONEST-NULL Performance when nothing resolves. It NEVER fabricates an ideal.
--
-- SAFETY / GUARDED:
--   A plain ADD COLUMN IF NOT EXISTS. Wrapped in a DO block that records the outcome
--   in db_feature_status (pattern 0274/0282/0284) so ops can see whether the column
--   is present. The app probes information_schema for this column before reading it
--   (productMachineMappingHasIdealColumn), so a DB WITHOUT this migration behaves
--   EXACTLY as before (all legacy ideal sources unchanged, no fabricated values).
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0285 (0284 = station_trace_scope).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "db_feature_status" (
  "feature"   varchar(100) PRIMARY KEY,
  "status"    varchar(20) NOT NULL,          -- 'ok' | 'missing' | 'partial'
  "detail"    text,
  "checkedAt" timestamp NOT NULL DEFAULT now()
);

DO $$
DECLARE
  col_ok boolean := false;
  err_detail text := '';
BEGIN
  BEGIN
    ALTER TABLE product_machine_mappings
      ADD COLUMN IF NOT EXISTS "idealCycleTimeSec" integer;
    col_ok := true;
    RAISE NOTICE '[0285] product_machine_mappings."idealCycleTimeSec" in place (configured ideal cycle time, seconds/unit, NULL = not configured).';
  EXCEPTION WHEN OTHERS THEN
    col_ok := false;
    err_detail := 'add column failed: ' || SQLERRM;
    RAISE WARNING '[0285] ADD COLUMN product_machine_mappings."idealCycleTimeSec" FAILED (%) — app probes for the column and falls back to legacy ideal sources (target-implied / last oee_metrics / observed avg), so OEE stays honest-NULL rather than fabricated. Fix and re-apply drizzle/0285.', SQLERRM;
  END;

  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'product_machine_ideal_cycle_time',
    CASE WHEN col_ok THEN 'ok' ELSE 'partial' END,
    CASE
      WHEN col_ok THEN 'product_machine_mappings."idealCycleTimeSec" (integer seconds/unit, nullable) present. Highest-priority CONFIGURED source for OEE Performance; NULL falls back to target-implied / last oee_metrics / observed avg (honest-NULL when none resolve).'
      ELSE COALESCE(NULLIF(err_detail, ''), 'unknown') || ' — app falls back to legacy ideal sources; no regression.'
    END,
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
