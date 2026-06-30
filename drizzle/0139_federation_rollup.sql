-- ============================================================================
-- Migration 0139: Federation Initiative (doc 13) — F1 roll-up store.
--
-- Adds the CORE aggregator's read-model tables. The aggregator PULLS each
-- enrolled site's KPIs read-only via /api/external/* and lands them here; the
-- core NEVER writes back to a site (data direction is site → core only).
--
--   • site_kpi_rollup — aggregate KPIs per (site, category, window, bucket).
--     window='snapshot' rows are upserted in place ("latest per site per
--     metric"); hour|shift|day rows form a small history. Aggregate-only, so
--     it stays tiny even with many sites.
--   • site_sync_log   — one audit row per poll attempt (honest-staleness +
--     per-site failure-isolation forensics).
--
-- HONEST STALENESS: every roll-up row keeps both asOf (the window the data
-- describes) and fetchedAt (when it was pulled). The UI derives age from these;
-- nothing here fabricates or back-dates values.
--
-- Additive + idempotent: re-runnable (IF NOT EXISTS throughout). FKs cascade on
-- site delete so removing a site cleans up its roll-up + logs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "site_kpi_rollup" (
  "id"               serial PRIMARY KEY,
  "siteId"           integer      NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "corporateCode"    varchar(50),
  "category"         varchar(50)  NOT NULL DEFAULT 'overall',
  "window"           varchar(20)  NOT NULL DEFAULT 'snapshot',
  "bucketStart"      timestamptz,
  "asOf"             timestamptz  NOT NULL,
  "totalInspections" integer,
  "okCount"          integer,
  "ngCount"          integer,
  "ntfCount"         integer,
  "yieldRate"        double precision,
  "ngRate"           double precision,
  "throughput"       integer,
  "oee"              double precision,
  "avgCycleTime"     double precision,
  "defectPareto"     jsonb,
  "source"           varchar(20)  NOT NULL DEFAULT 'poll',
  "fetchedAt"        timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz  NOT NULL DEFAULT now()
);

-- Upsert target for "latest snapshot per site per metric". NULLS NOT DISTINCT so
-- the single window='snapshot' row (bucketStart IS NULL) is treated as unique.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_site_kpi_rollup_bucket"
  ON "site_kpi_rollup" ("siteId", "category", "window", "bucketStart") NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS "idx_site_kpi_rollup_site_asof"
  ON "site_kpi_rollup" ("siteId", "asOf" DESC);
CREATE INDEX IF NOT EXISTS "idx_site_kpi_rollup_corporate"
  ON "site_kpi_rollup" ("corporateCode");

CREATE TABLE IF NOT EXISTS "site_sync_log" (
  "id"             serial PRIMARY KEY,
  "siteId"         integer     NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "startedAt"      timestamptz NOT NULL DEFAULT now(),
  "finishedAt"     timestamptz,
  "ok"             boolean     NOT NULL DEFAULT false,
  "status"         varchar(20) NOT NULL DEFAULT 'failed',
  "httpStatus"     integer,
  "error"          text,
  "durationMs"     integer,
  "metricsFetched" integer     NOT NULL DEFAULT 0,
  "endpointsHit"   jsonb
);

CREATE INDEX IF NOT EXISTS "idx_site_sync_log_site_started"
  ON "site_sync_log" ("siteId", "startedAt" DESC);
