-- ============================================================================
-- Migration 0155: Federation Panorama (U5, doc 21 §6 U5 / §3 G-7).
--
-- DEEPENS the F1 roll-up store so federation stops being a single-KPI ("overall"
-- inspection) site-level scoreboard. This migration is PURELY ADDITIVE — it adds
-- three nullable JSONB columns to the EXISTING site_kpi_rollup table and reuses
-- the ALREADY-RESERVED `category` column for the per-category roll-up (no schema
-- change was needed for that; new rows are simply written with category IN
-- (inspection|oee|fleet|safety|pdm|<station/machine code>) instead of only
-- 'overall'). NO new table is created.
--
--   • detailRows  — the per-machine/station detail array the site's summary feed
--     returns, PREVIOUSLY FETCHED-THEN-DISCARDED in siteClient. Retaining it makes
--     the drill site → factory → device possible (assembled from these rows).
--   • alertRollup — a compact per-site alert summary (open/critical counts + a
--     small top-N list) aggregated from the site's events/andon/safety feeds, so
--     the Federation dashboard + Command Center can show cross-site alerts.
--   • metrics     — a generalized per-category metric bag (honest null-shaped) so
--     fleet (tasks pending/running, robots online), safety (open events / near-
--     misses) and PdM (open predictive WOs) aggregate across sites even when a
--     remote site returns null for a category.
--
-- HONEST STALENESS is unchanged: asOf + fetchedAt still drive the OK/STALE/DOWN
-- badge; nothing here fabricates or back-dates a value. A category a remote site
-- cannot provide is written NULL (honest), never 0.
--
-- Additive + idempotent: re-runnable (ADD COLUMN IF NOT EXISTS throughout). RLS is
-- inert-by-default and unchanged from 0139 (site_kpi_rollup was never RLS-enabled;
-- this migration adds no policy). NO new device-control path. No ALTER TYPE.
-- ============================================================================

ALTER TABLE "site_kpi_rollup"
  ADD COLUMN IF NOT EXISTS "detailRows"  jsonb,
  ADD COLUMN IF NOT EXISTS "alertRollup" jsonb,
  ADD COLUMN IF NOT EXISTS "metrics"     jsonb;

-- Defensive: keep the RLS posture inert (site_kpi_rollup is core-owned, no tenant
-- predicate). DROP POLICY IF EXISTS is a no-op here but documents intent and keeps
-- the migration self-contained / re-runnable if a policy is ever added later.
DROP POLICY IF EXISTS tenant_select ON "site_kpi_rollup";
DROP POLICY IF EXISTS tenant_modify ON "site_kpi_rollup";
