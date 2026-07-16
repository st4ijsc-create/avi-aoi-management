-- ============================================================================
-- Migration 0280 (doc 54 Wave C) — add the missing 365-day retention policy on
-- the robot_telemetry hypertable (unbounded-growth fix).
--
-- WHAT / WHY:
--   robot_telemetry is a Timescale hypertable that a poller writes on every robot
--   state snapshot (VDA5050 / vendor drivers). VERIFIED against the live DB
--   (timescaledb 2.28.2): it already has a Columnstore/compression policy
--   (compress_after 14 days) but NO retention policy — so compressed chunks are
--   never dropped and the table grows without bound (already ~129k rows here).
--   Every other hypertable on this cluster uses a 365-day retention window
--   (machine_heartbeats, measurement_results, oee_metrics, ot_telemetry,
--   process_results, product_inspections all have drop_after = '365 days'), so we
--   match the house standard.
--
-- COORDINATION: dataRetentionService (app-level sweeper) queries
--   timescaledb_information.jobs at runtime and SKIPS any table that has a native
--   retention policy, so this hand-off does not double-delete (per 0118/0173).
--
-- GUARDED + IDEMPOTENT: only runs when timescaledb is installed AND robot_telemetry
--   is actually a hypertable; add_retention_policy(..., if_not_exists => TRUE) makes
--   re-runs a no-op. Safe to run once via a filename-ordered runner.
-- ============================================================================

DO $$
DECLARE
  has_ts   boolean;
  is_hyper boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') INTO has_ts;
  IF NOT has_ts THEN
    RAISE WARNING '[0280] timescaledb not installed — robot_telemetry native retention NOT applied; app-level dataRetentionService remains the retention path.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_schema = 'public' AND hypertable_name = 'robot_telemetry'
  ) INTO is_hyper;

  IF NOT is_hyper THEN
    RAISE WARNING '[0280] robot_telemetry is NOT a hypertable — retention policy skipped (apply the robot_telemetry hypertable migration first).';
    RETURN;
  END IF;

  PERFORM add_retention_policy('robot_telemetry', INTERVAL '365 days', if_not_exists => TRUE);
  RAISE NOTICE '[0280] robot_telemetry: 365-day native retention policy ensured (matches cluster standard).';

  -- Optional status breadcrumb, consistent with 0173/0271 (guarded so a missing
  -- db_feature_status table can never abort this migration).
  IF to_regclass('public.db_feature_status') IS NOT NULL THEN
    INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
    VALUES (
      'robot_telemetry_retention_12mo',
      'ok',
      'native 365-day retention on robot_telemetry (doc 54 Wave C — unbounded-growth fix)',
      now()
    )
    ON CONFLICT ("feature") DO UPDATE
      SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
  END IF;
END $$;
