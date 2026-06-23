-- ============================================================================
-- Phase 1 WS1.2 — Tenant Row-Level Security (RLS) — OPERATOR-APPLIED TEMPLATE
-- ============================================================================
-- NOT auto-applied. The standalone migration runner reads only top-level
-- drizzle/*.sql; files under drizzle/optional/ are applied manually, exactly
-- like drizzle/timescale/*.sql:
--
--   psql "$DATABASE_URL" -f drizzle/optional/0001_tenant_rls.sql
--
-- WHY THIS IS STAGED (read before applying):
--   * RLS is enforced for ALL non-owner roles. If the app connects as the
--     table OWNER or a SUPERUSER, RLS is bypassed (so it silently does nothing).
--     The app MUST connect as a plain role that is NOT the owner of these tables.
--   * Once enabled, every query must run with the tenant context set, otherwise
--     non-admin connections see zero rows. Wire the context per request using
--     server/db/tenantContext.ts BEFORE enabling in production.
--   * Test against a staging DB with a non-owner role first.
--
-- CONTEXT GUCs (set per connection/transaction by the app):
--   SET LOCAL app.tenant_bypass = 'on';                 -- admin/service: see all
--   SET LOCAL app.tenant_factory_codes = 'F01,F02';     -- comma-separated
--   SET LOCAL app.tenant_corporate_codes = 'C01';       -- comma-separated
--
-- This template covers product_inspections (the primary hot tenant table).
-- Extend the same pattern to process_results (lineCode), oee_metrics
-- (machineCode → resolve), and other denormalized tables as validated.
-- ============================================================================

-- Helper: is the current connection in tenant-bypass mode (admin/service)?
CREATE OR REPLACE FUNCTION app_tenant_bypass() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_bypass', true), 'off') = 'on'
$$;

-- Helper: does a factory/corporate code fall within the current context?
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app_tenant_bypass()
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ── product_inspections ─────────────────────────────────────────────────────
ALTER TABLE product_inspections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON product_inspections;
CREATE POLICY tenant_select ON product_inspections FOR SELECT
  USING (app_tenant_allows("factoryCode", "corporateCode"));

DROP POLICY IF EXISTS tenant_modify ON product_inspections;
CREATE POLICY tenant_modify ON product_inspections FOR ALL
  USING (app_tenant_allows("factoryCode", "corporateCode"))
  WITH CHECK (app_tenant_allows("factoryCode", "corporateCode"));

-- To roll back:
--   ALTER TABLE product_inspections DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS tenant_select ON product_inspections;
--   DROP POLICY IF EXISTS tenant_modify ON product_inspections;
