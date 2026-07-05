-- ============================================================================
-- Migration 0173: 12-month native retention on all hypertables
-- (doc 27 §4 R1/R3 · §11 decision #2 — "12-month retention for everything").
--
-- Adds Timescale `add_retention_policy(<table>, INTERVAL '365 days')` to every
-- hypertable created by 0172 (inspection core + telemetry). Native chunk
-- dropping is far cheaper than row DELETEs and is the canonical mechanism once
-- a table is a hypertable.
--
-- COORDINATION with the app-level sweeper (server/services/dataRetentionService.ts):
--   that service now SKIPS any table that has an ACTIVE Timescale retention
--   policy (it queries timescaledb_information.jobs at runtime), so applying
--   this migration automatically hands those tables over to native retention —
--   no double-delete, per the 0118 "choose ONE mechanism per table" note.
--
-- GUARDED (deliberately conditional, unlike 0172's loud warning): this
-- migration depends on 0172's outcome. When timescaledb is not installed or a
-- table was not converted, it raises a WARNING and records 'missing'/'partial'
-- in db_feature_status; the app-level sweeper remains the active retention
-- path for those tables (12-month windows, DATA_RETENTION_ENABLED=true).
--
-- IDEMPOTENT: add_retention_policy(..., if_not_exists => TRUE); re-runnable.
-- ============================================================================

DO $$
DECLARE
  has_ts boolean;
  tbl text;
  converted int := 0;
  missing int := 0;
  tables text[] := ARRAY[
    'product_inspections',
    'measurement_results',
    'ot_telemetry',
    'oee_metrics',
    'machine_heartbeats',
    'process_results'
  ];
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') INTO has_ts;

  IF NOT has_ts THEN
    RAISE WARNING '[0173] timescaledb not installed — native 12-month retention (doc 27 decision #2) NOT applied. App-level dataRetentionService (DATA_RETENTION_ENABLED=true) remains the active retention path. Apply 0172 on a TimescaleDB-enabled server first.';
    -- db_feature_status is created by 0172 (runs before this file).
    INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
    VALUES (
      'timescaledb_retention_12mo',
      'missing',
      'timescaledb extension not installed — native retention unavailable; app-level dataRetentionService is the active retention path (12-month windows)',
      now()
    )
    ON CONFLICT ("feature") DO UPDATE
      SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
    RETURN;
  END IF;

  FOREACH tbl IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables
               WHERE hypertable_schema = 'public' AND hypertable_name = tbl) THEN
      PERFORM add_retention_policy(format('public.%I', tbl)::regclass,
                                   INTERVAL '365 days', if_not_exists => TRUE);
      converted := converted + 1;
      RAISE NOTICE '[0173] 12-month retention policy on %', tbl;
    ELSE
      missing := missing + 1;
      RAISE WARNING '[0173] % is NOT a hypertable — retention policy skipped (apply 0172 first); app-level sweeper covers it meanwhile', tbl;
    END IF;
  END LOOP;

  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'timescaledb_retention_12mo',
    CASE WHEN missing = 0 THEN 'ok' ELSE 'partial' END,
    format('native 365-day retention on %s/%s hypertables (doc 27 decision #2)', converted, array_length(tables, 1)),
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
