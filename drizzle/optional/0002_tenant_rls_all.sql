-- ============================================================================
-- Phase 1 WS4 — Tenant Row-Level Security (full), SAFE-BY-DEFAULT.
-- Supersedes drizzle/optional/0001_tenant_rls.sql (redefines the helper to be
-- inert unless explicitly activated). OPERATOR-APPLIED (drizzle/optional/ is not
-- auto-applied by the migration runner):
--
--   psql "$DATABASE_URL" -f drizzle/optional/0002_tenant_rls_all.sql
--
-- KEY SAFETY PROPERTY — INERT BY DEFAULT:
--   Policies pass (allow-all) unless the connection sets app.tenant_rls_active='on'.
--   server/db/tenantContext.withTenantScope() sets it (is_local=true) for the
--   duration of one transaction. So you can ENABLE RLS on every table now without
--   breaking any unscoped query; enforcement only kicks in inside withTenantScope.
--
--   Admin/service: withTenantScope(db, { bypass:true }) → app.tenant_bypass='on'.
--
-- REMEMBER: RLS is bypassed for the table OWNER and SUPERUSERs. The app MUST
-- connect as a NON-owner role (template at the bottom).
-- ============================================================================

-- Inert-by-default policy helper.
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass', true), 'off') = 'on'        -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ── product_inspections (corporateCode + factoryCode) ───────────────────────
ALTER TABLE product_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON product_inspections;
CREATE POLICY tenant_select ON product_inspections FOR SELECT
  USING (app_tenant_allows("factoryCode", "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON product_inspections;
CREATE POLICY tenant_modify ON product_inspections FOR ALL
  USING (app_tenant_allows("factoryCode", "corporateCode"))
  WITH CHECK (app_tenant_allows("factoryCode", "corporateCode"));

-- ── inspection_packages (factoryCode only) ──────────────────────────────────
ALTER TABLE inspection_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON inspection_packages;
CREATE POLICY tenant_select ON inspection_packages FOR SELECT
  USING (app_tenant_allows("factoryCode", NULL));
DROP POLICY IF EXISTS tenant_modify ON inspection_packages;
CREATE POLICY tenant_modify ON inspection_packages FOR ALL
  USING (app_tenant_allows("factoryCode", NULL))
  WITH CHECK (app_tenant_allows("factoryCode", NULL));

-- ── Child tables without denormalized tenant codes (measurement_results,
--    process_results, package_images, …) reach the tenant only via a join to
--    their parent. Enforcing RLS there requires either (a) denormalizing a
--    factory/corporate code onto them, or (b) a policy using a subquery EXISTS
--    against the parent. Both are a follow-up — do NOT enable RLS on them until
--    one is in place, otherwise a scoped query returns zero child rows. ───────

-- ── Limited application DB role (TEMPLATE — fill the password, run once) ─────
-- The app must connect as this NON-owner role for RLS to take effect.
--   CREATE ROLE avi_app LOGIN PASSWORD 'CHANGE_ME' NOSUPERUSER NOBYPASSRLS;
--   GRANT CONNECT ON DATABASE avi_aoi_mes TO avi_app;
--   GRANT USAGE ON SCHEMA public TO avi_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO avi_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO avi_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO avi_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO avi_app;
-- Then point DATABASE_URL at avi_app (NOT the owner/superuser).

-- Rollback:
--   ALTER TABLE product_inspections DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE inspection_packages  DISABLE ROW LEVEL SECURITY;
