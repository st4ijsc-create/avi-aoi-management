-- ============================================================================
-- Migration 0156: Tenant scoping + inert RLS backfill on the isolation-hole
--                 tables (U6-a, doc 21 §6 U6 / G-9)
--
-- The audit (doc 21 G-9) found three table families that carry NO tenant columns
-- and NO RLS — unlike the uniform Khối-2/3/7 tables (fleet 0142 / safety 0145 /
-- masterdata 0122). This migration BACKFILLS the tenant scope + the shared inert
-- RLS pattern so these tables reach the SAME isolation posture as the rest of the
-- platform, WITHOUT changing any query behaviour:
--
--   • Device Programming / IR (programming.ts):
--       program_projects, program_artifacts, program_builds, program_sim_runs,
--       program_deployments, program_symbols
--   • IMAGE anomaly banks/profiles (ai.ts) — robot_behavior_anomalies is already
--       scoped in aiLoop.ts; this covers the IMAGE anomaly tables:
--       ai_anomaly_memory_bank, ai_anomaly_profiles
--   • Predictive / maintenance (mes.ts):
--       maintenance_schedules, maintenance_work_orders
--
-- WHAT THIS DOES (additive + idempotent):
--   1. ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50) to every table above,
--      and "factoryId" integer where a factory scope is meaningful (i.e. the row
--      is not already reachable to a factory only through a soft machineId hop —
--      we still add it everywhere here as an OPTIONAL denormalized scope column;
--      existing rows get NULL = "unscoped", which the inert policy treats as
--      allow-all until explicitly backfilled).
--   2. ENABLE ROW LEVEL SECURITY + a tenant_select / tenant_modify policy on
--      "corporateCode", using the SHARED inert-by-default app_tenant_allows()
--      helper (mirrors 0145/0153). factory is passed NULL because these tables
--      scope by corporateCode (+ optional factoryId int), not a factory CODE.
--
-- HONESTY: This is SCHEMA + INERT POLICY ONLY. It changes NO query behaviour.
--   • WITHOUT the session GUC (flag TENANT_RLS_ENABLED OFF / table owner / any
--     query not wrapped in withTenantScope) app_tenant_allows() returns TRUE =
--     allow-all. So enabling RLS here is a complete no-op by default.
--   • Existing rows keep NULL tenant (backward-compatible). Enforcement only ever
--     takes effect for a query wrapped in runWithTenantScope WHEN the flag is ON,
--     exactly like the established Khối-2/3/7 tables. No data-layer call site is
--     changed by this migration.
--
-- type/columns are varchar/int (NOT new pg enums) → migration stays additive
-- (ALTER TABLE ADD COLUMN / ENABLE RLS / DROP POLICY IF EXISTS / CREATE POLICY
-- only, no ALTER TYPE). Re-runnable (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- DO NOT RUN as part of this change — additive/idempotent, applied by the normal
-- migrate step. Tracked in docs/ECOSYSTEM/PHASE1_TENANT_RLS_ROLLOUT.md.
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0145/0153) ──────
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ── Helper block: add tenant columns + inert RLS to one table ─────────────────
-- Applied per-table below. corporateCode is the predicate column; factoryId is an
-- optional denormalized factory scope (int). Policies mirror 0145/0153 exactly.

-- ============================================================================
-- U6-a.1 — Device Programming / IR (programming.ts)
-- ============================================================================
ALTER TABLE "program_projects"    ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "program_projects"    ADD COLUMN IF NOT EXISTS "factoryId"     integer;
ALTER TABLE "program_artifacts"   ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "program_artifacts"   ADD COLUMN IF NOT EXISTS "factoryId"     integer;
ALTER TABLE "program_builds"      ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "program_builds"      ADD COLUMN IF NOT EXISTS "factoryId"     integer;
ALTER TABLE "program_sim_runs"    ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "program_sim_runs"    ADD COLUMN IF NOT EXISTS "factoryId"     integer;
ALTER TABLE "program_deployments" ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "program_deployments" ADD COLUMN IF NOT EXISTS "factoryId"     integer;
ALTER TABLE "program_symbols"     ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "program_symbols"     ADD COLUMN IF NOT EXISTS "factoryId"     integer;

-- ============================================================================
-- U6-a.2 — IMAGE anomaly banks/profiles (ai.ts)
-- ============================================================================
ALTER TABLE "ai_anomaly_memory_bank" ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "ai_anomaly_memory_bank" ADD COLUMN IF NOT EXISTS "factoryId"     integer;
ALTER TABLE "ai_anomaly_profiles"    ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "ai_anomaly_profiles"    ADD COLUMN IF NOT EXISTS "factoryId"     integer;

-- ============================================================================
-- U6-a.3 — Predictive / maintenance (mes.ts)
-- ============================================================================
ALTER TABLE "maintenance_schedules"   ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "maintenance_schedules"   ADD COLUMN IF NOT EXISTS "factoryId"     integer;
ALTER TABLE "maintenance_work_orders" ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "maintenance_work_orders" ADD COLUMN IF NOT EXISTS "factoryId"     integer;

-- ============================================================================
-- RLS — inert-by-default on every table above. Guarded in a DO block so it is a
-- no-op if app_tenant_allows is missing (self-contained: helper defined above).
-- Every policy composes app_tenant_allows(NULL, "corporateCode") → allow-all
-- unless the session GUC app.tenant_rls_active='on' is set (flag ON + scoped tx).
-- ============================================================================
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'program_projects', 'program_artifacts', 'program_builds', 'program_sim_runs',
    'program_deployments', 'program_symbols',
    'ai_anomaly_memory_bank', 'ai_anomaly_profiles',
    'maintenance_schedules', 'maintenance_work_orders'
  ];
BEGIN
  IF to_regprocedure('app_tenant_allows(text,text)') IS NULL THEN
    RAISE NOTICE '0156: app_tenant_allows missing — skipping RLS (tables get columns only).';
    RETURN;
  END IF;

  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE '0156: table % absent — skipping.', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_select ON %I FOR SELECT USING (app_tenant_allows(NULL, "corporateCode"))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS tenant_modify ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_modify ON %I FOR ALL USING (app_tenant_allows(NULL, "corporateCode")) WITH CHECK (app_tenant_allows(NULL, "corporateCode"))',
      t
    );
  END LOOP;
END $$;

-- ============================================================================
-- ROLLBACK (operator, optional — instant no-data-loss rollback is just setting
-- TENANT_RLS_ENABLED=false, which makes every policy allow-all). To also remove
-- the policies + disable RLS (columns are harmless and can stay):
--
--   DO $$
--   DECLARE t text; tbls text[] := ARRAY[
--     'program_projects','program_artifacts','program_builds','program_sim_runs',
--     'program_deployments','program_symbols','ai_anomaly_memory_bank',
--     'ai_anomaly_profiles','maintenance_schedules','maintenance_work_orders'];
--   BEGIN
--     FOREACH t IN ARRAY tbls LOOP
--       EXECUTE format('DROP POLICY IF EXISTS tenant_select ON %I', t);
--       EXECUTE format('DROP POLICY IF EXISTS tenant_modify ON %I', t);
--       EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
--     END LOOP;
--   END $$;
-- ============================================================================
