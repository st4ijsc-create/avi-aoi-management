-- ============================================================================
-- Migration 0278 (doc 54 Wave C) — dedup UNIQUE indexes on OEE + machine-health
-- rollups so scheduled recomputes are idempotent (no silent duplicate rows).
--
-- WHAT / WHY:
--   oeeSnapshotScheduler + the health-history writer recompute per machine/period
--   on a cron. With no unique key, a retry / overlapping run inserts a *second*
--   row for the same (machine, timestamp[, period]) instead of upserting — which
--   double-counts in dashboards and OEE trend queries. These UNIQUE indexes are
--   the on-conflict target that makes those writes safe (ON CONFLICT DO UPDATE).
--
-- VERIFIED against the live DB (avi_app@aoi_management, timescaledb 2.28.2):
--   • oee_metrics IS a Timescale hypertable (time dim = "timestamp") → a unique
--     index MUST include the partitioning column. Target key already does:
--       UNIQUE ("machineId","timestamp","periodType")     [periodType = enum col]
--     Real column casing is camelCase+quoted (periodType, NOT period_type).
--     Current duplicate groups: 0 (dedup below is a safe no-op here today).
--   • machine_health_history is a PLAIN table (NOT a hypertable — pkey is on id
--     alone; not present in timescaledb_information.hypertables). Its target key
--       UNIQUE ("machineId","timestamp")
--     includes "timestamp" anyway, so it is valid whether or not the table is
--     ever converted to a hypertable later. Current duplicate groups: 95 → the
--     dedup below WILL remove ~one-per-group rows before the index is built.
--
-- DEDUP STRATEGY (ctid self-join — hypertable-safe):
--   We DELETE via a self-join matching the *key columns first*, then a.ctid<b.ctid.
--   On a hypertable a plain `WHERE ctid IN (subquery over the parent)` is UNSAFE
--   because ctid is only unique WITHIN a chunk (two rows in different chunks can
--   share a ctid). The self-join is safe: rows in a duplicate group share the same
--   "timestamp", hence the same chunk, so the ctid comparison stays intra-chunk.
--   We keep the row with the greatest ctid (newest physical insert / latest
--   recompute) and delete the rest.
--
-- IDEMPOTENT: the DELETEs match nothing on a second run (uniqueness already holds),
--   and both indexes use CREATE UNIQUE INDEX IF NOT EXISTS. Safe to run once via a
--   filename-ordered runner and safe to re-run.
-- ============================================================================

-- ─── oee_metrics ────────────────────────────────────────────────────────────
-- Dedup on (machineId, timestamp, periodType); keep the newest ctid per group.
DELETE FROM oee_metrics a
USING oee_metrics b
WHERE a."machineId"  = b."machineId"
  AND a."timestamp"  = b."timestamp"
  AND a."periodType" = b."periodType"
  AND a.ctid < b.ctid;

-- Unique index INCLUDES "timestamp" (required: oee_metrics is a hypertable).
CREATE UNIQUE INDEX IF NOT EXISTS uq_oee_metrics_machine_ts_period
  ON oee_metrics ("machineId", "timestamp", "periodType");

-- ─── machine_health_history ─────────────────────────────────────────────────
-- Dedup on (machineId, timestamp); keep the newest ctid per group.
DELETE FROM machine_health_history a
USING machine_health_history b
WHERE a."machineId" = b."machineId"
  AND a."timestamp" = b."timestamp"
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_health_history_machine_ts
  ON machine_health_history ("machineId", "timestamp");
