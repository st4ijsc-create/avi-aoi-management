-- ============================================================================
-- P2 — WIP write-path support. The wip/traceability tables already exist (from
-- the G5/G6 schema); this migration only adds the indexes the wipIngestService
-- needs to upsert/aggregate efficiently. No column/data changes — purely
-- additive + idempotent (CREATE INDEX IF NOT EXISTS only).
-- ============================================================================

-- Partial UNIQUE on serialNumber so wipIngestService can ON CONFLICT upsert a
-- WIP unit by serial (NULL serials — lot-only flows — are not constrained).
CREATE UNIQUE INDEX IF NOT EXISTS uq_wip_serial
  ON wip_tracking ("serialNumber")
  WHERE "serialNumber" IS NOT NULL;

-- Speed up "latest dwell row open at this station for this serial" lookups
-- (recording exit / dwell on the next inspection of the same serial).
CREATE INDEX IF NOT EXISTS idx_dwell_serial ON station_dwell_time ("serialNumber");

-- line_balance_metrics is upserted per (lineId, periodStart bucket); index the
-- pair so the per-bucket lookup-then-update stays cheap.
CREATE INDEX IF NOT EXISTS idx_linebal_line_period ON line_balance_metrics ("lineId", "periodStart");
