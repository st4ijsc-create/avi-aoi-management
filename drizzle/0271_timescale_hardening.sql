-- ============================================================================
-- Migration 0271: TimescaleDB storage-tier hardening (doc 48 R3 · L2/perf).
--
-- Closes two audit findings on the MAIN DB (Postgres 17 + TimescaleDB 2.28):
--
--   1. ot_telemetry is the HIGHEST-VOLUME table (canonical device telemetry) yet
--      it was still a PLAIN, unpartitioned table — 0172 converted the other five
--      time-series tables but ot_telemetry never took (its PK was left as the
--      bare (id) — see below). Convert it to a hypertable on `ts` with native
--      12-month retention + columnstore compression, matching the sibling
--      telemetry tables (oee_metrics / machine_heartbeats / process_results).
--
--   2. Compression was OFF on measurement_results + product_inspections. 0172
--      created them as hypertables but INTENTIONALLY left compression off,
--      citing "operators UPDATE old rows and compressed-chunk updates are slow".
--      On TimescaleDB 2.28 that concern is largely obsolete: UPDATE/DELETE on
--      compressed chunks is supported (the engine transparently decompresses the
--      touched segment). We therefore enable columnstore compression on both,
--      with a 30-day `compress_after` window (= one chunk_time_interval) so the
--      actively-edited recent chunks stay in the rowstore and only the aged tail
--      (30..365 days, inside the existing 365-day retention window) compresses.
--
-- ── ot_telemetry PK fix (why 0172's conversion never took) ───────────────────
-- A hypertable's partition column MUST appear in EVERY unique index. ot_telemetry
-- carries a secondary unique index uq_ot_telemetry_device_metric_ts
-- ("deviceId", metric, ts) [0247] which DOES include ts, but its PRIMARY KEY was
-- the bare (id) — missing ts — so create_hypertable('ot_telemetry','ts') aborts.
-- We widen the PK to (id, "ts") first (0172's exact pattern), then convert.
--
-- ── Compression segmentby/orderby (tied to the real hot query paths) ─────────
--   ot_telemetry        : segmentby ("deviceId", metric), orderby ts DESC.
--        Fully COVERS uq_ot_telemetry_device_metric_ts ("deviceId", metric, ts),
--        so compression validates cleanly, and matches the per-device/per-metric
--        latest+series reads (idx_ot_telemetry_metric_ts / _machine_ts).
--   measurement_results : segmentby ("pointDefId"),  orderby "createdAt" DESC.
--        Matches idx_results_pointdef_created (doc 38 R-1) — the hottest
--        per-point trend/SPC scan.
--   product_inspections : segmentby ("machineId"),   orderby "inspectionTime" DESC.
--        Matches idx_inspections_machine_time — per-machine time-range reporting.
-- (TimescaleDB emits a benign WARNING "column id should be used for segmenting or
--  ordering" because the composite PK's `id` isn't in the compression config —
--  the same notice the other five compressed hypertables produce; it does NOT
--  block compression and is expected here.)
--
-- ── Retention ────────────────────────────────────────────────────────────────
-- ot_telemetry gets native add_retention_policy(365 days) to match doc 27
-- decision #2 ("12-month retention for everything") and the sibling telemetry
-- tables. measurement_results + product_inspections ALREADY carry 365-day
-- retention (from 0173) — left untouched here (this migration only adds their
-- missing compression). Once ot_telemetry native retention is active, keep
-- app-level dataRetentionService off for it (RETENTION_OT_TELEMETRY_DAYS=0) so
-- the two mechanisms don't double-delete (0173 note).
--
-- IDEMPOTENT & SELF-HEALING: every step is guarded (is-hypertable / is-compressed
-- probes, if_not_exists on policies, DROP CONSTRAINT IF EXISTS). Re-running is a
-- clean no-op. When timescaledb is not installed (e.g. native-Windows dev PG),
-- the whole block no-ops with a loud WARNING + records 'missing' in
-- db_feature_status — never fails the migrate run (mirrors 0172/0173).
--
-- RLS is intentionally NOT added (TimescaleDB does not support RLS on hypertables).
--
-- OWNERSHIP: hypertable DDL requires table ownership/superuser. These tables are
-- owned by the bootstrap role (the same identity that applied 0172/0173); apply
-- this migration as that owner. The least-privilege app role (avi_app) cannot and
-- need not run it.
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0271 (0270 = seed_safety_plc_sim).
-- ============================================================================

-- Ops-visible status table (already created by 0172; safe to re-create on a
-- fresh environment).
CREATE TABLE IF NOT EXISTS "db_feature_status" (
  "feature"   varchar(100) PRIMARY KEY,
  "status"    varchar(20) NOT NULL,          -- 'ok' | 'missing' | 'partial'
  "detail"    text,
  "checkedAt" timestamp NOT NULL DEFAULT now()
);

DO $$
DECLARE
  has_ts        boolean;
  ot_is_hyper   boolean;
  ot_compressed boolean;
  mr_is_hyper   boolean;
  mr_compressed boolean;
  pi_is_hyper   boolean;
  pi_compressed boolean;
  done_ot       boolean := false;
  done_mr       boolean := false;
  done_pi       boolean := false;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') INTO has_ts;

  IF NOT has_ts THEN
    RAISE WARNING '[0271] timescaledb not installed — storage-tier hardening (doc 48 R3) NOT applied: ot_telemetry stays a plain table; measurement_results/product_inspections stay uncompressed. Install timescaledb (see scripts/migrate-to-timescaledb.md) and re-apply.';
    INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
    VALUES (
      'timescaledb_storage_hardening',
      'missing',
      'timescaledb extension not installed — ot_telemetry not a hypertable; measurement_results/product_inspections uncompressed (doc 48 R3 UNMET)',
      now()
    )
    ON CONFLICT ("feature") DO UPDATE
      SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
    RETURN;
  END IF;

  -- ══ 1) ot_telemetry → hypertable on `ts` (+ compression + 12-month retention) ══
  SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                 WHERE hypertable_schema = 'public' AND hypertable_name = 'ot_telemetry')
    INTO ot_is_hyper;

  IF NOT ot_is_hyper THEN
    -- Partition column must be in every unique index → widen PK (id) to (id, ts).
    -- DROP … IF EXISTS + re-ADD is idempotent (PG auto-names the PK ot_telemetry_pkey).
    ALTER TABLE ot_telemetry DROP CONSTRAINT IF EXISTS ot_telemetry_pkey;
    ALTER TABLE ot_telemetry ADD PRIMARY KEY (id, "ts");
    -- migrate_data => TRUE is a no-op today (ot_telemetry is empty) but keeps the
    -- conversion correct if rows land before this runs. 7-day chunks (telemetry
    -- cadence), mirroring drizzle/timescale/0003 + the other telemetry tables.
    PERFORM create_hypertable('ot_telemetry', 'ts',
      chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
    -- Re-read status within this transaction.
    SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                   WHERE hypertable_schema = 'public' AND hypertable_name = 'ot_telemetry')
      INTO ot_is_hyper;
    IF ot_is_hyper THEN
      RAISE NOTICE '[0271] ot_telemetry converted to hypertable on ts (7-day chunks).';
    END IF;
  END IF;

  IF ot_is_hyper THEN
    SELECT compression_enabled INTO ot_compressed
      FROM timescaledb_information.hypertables
      WHERE hypertable_schema = 'public' AND hypertable_name = 'ot_telemetry';
    IF NOT ot_compressed THEN
      ALTER TABLE ot_telemetry SET (
        timescaledb.compress,
        timescaledb.compress_orderby   = '"ts" DESC',
        timescaledb.compress_segmentby = '"deviceId","metric"');
    END IF;
    PERFORM add_compression_policy('ot_telemetry', INTERVAL '7 days',   if_not_exists => TRUE);
    PERFORM add_retention_policy  ('ot_telemetry', INTERVAL '365 days', if_not_exists => TRUE);
    done_ot := true;
  ELSE
    RAISE WARNING '[0271] ot_telemetry could NOT be converted to a hypertable — left as a plain table.';
  END IF;

  -- ══ 2a) measurement_results → enable columnstore compression ═════════════════
  SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                 WHERE hypertable_schema = 'public' AND hypertable_name = 'measurement_results')
    INTO mr_is_hyper;
  IF mr_is_hyper THEN
    SELECT compression_enabled INTO mr_compressed
      FROM timescaledb_information.hypertables
      WHERE hypertable_schema = 'public' AND hypertable_name = 'measurement_results';
    IF NOT mr_compressed THEN
      ALTER TABLE measurement_results SET (
        timescaledb.compress,
        timescaledb.compress_orderby   = '"createdAt" DESC',
        timescaledb.compress_segmentby = '"pointDefId"');
      RAISE NOTICE '[0271] compression enabled on measurement_results (segmentby pointDefId).';
    END IF;
    PERFORM add_compression_policy('measurement_results', INTERVAL '30 days', if_not_exists => TRUE);
    done_mr := true;
  ELSE
    RAISE WARNING '[0271] measurement_results is NOT a hypertable — apply 0172 first; compression skipped.';
  END IF;

  -- ══ 2b) product_inspections → enable columnstore compression ═════════════════
  SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                 WHERE hypertable_schema = 'public' AND hypertable_name = 'product_inspections')
    INTO pi_is_hyper;
  IF pi_is_hyper THEN
    SELECT compression_enabled INTO pi_compressed
      FROM timescaledb_information.hypertables
      WHERE hypertable_schema = 'public' AND hypertable_name = 'product_inspections';
    IF NOT pi_compressed THEN
      ALTER TABLE product_inspections SET (
        timescaledb.compress,
        timescaledb.compress_orderby   = '"inspectionTime" DESC',
        timescaledb.compress_segmentby = '"machineId"');
      RAISE NOTICE '[0271] compression enabled on product_inspections (segmentby machineId).';
    END IF;
    PERFORM add_compression_policy('product_inspections', INTERVAL '30 days', if_not_exists => TRUE);
    done_pi := true;
  ELSE
    RAISE WARNING '[0271] product_inspections is NOT a hypertable — apply 0172 first; compression skipped.';
  END IF;

  -- ══ Record outcome for ops/dashboards ════════════════════════════════════════
  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'timescaledb_storage_hardening',
    CASE WHEN done_ot AND done_mr AND done_pi THEN 'ok' ELSE 'partial' END,
    format('ot_telemetry hypertable+compress(7d)+retention(365d)=%s; measurement_results compress(30d)=%s; product_inspections compress(30d)=%s (doc 48 R3)',
           done_ot, done_mr, done_pi),
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();

  RAISE NOTICE '[0271] TimescaleDB storage-tier hardening complete (doc 48 R3).';
END $$;
