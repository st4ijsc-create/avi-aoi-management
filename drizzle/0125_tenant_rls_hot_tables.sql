-- ============================================================================
-- Phase 1 WS4 — Tenant Row-Level Security EXTEND ② (HOT time-series tables)
-- Follow-up to drizzle/0122_tenant_rls_extend.sql, which shipped these three
-- tables as COMMENTED SKELETONS only (factory was several hops away and no
-- verified join existed). This migration ships the verified factory-resolver
-- join helpers and turns the skeletons into REAL, fail-open policies.
--
-- Covers the hot operational tables that have NO denormalized tenant column:
--   * oee_metrics      — has machineCode  → factory via machine→station→line→workshop→factory
--   * process_results  — has lineCode     → factory via line(code)→workshop→factory
--   * wip_tracking     — has lineId       → factory via line(id)→workshop→factory
--
-- ============================================================================
-- SAFETY MODEL — FAIL-OPEN, INERT-BY-DEFAULT (do not remove):
--   This migration only CREATES helper functions, ENABLES RLS and ADDS policies.
--   It changes ZERO columns and inserts ZERO data. Every policy predicate is the
--   shared, inert-by-default helper app_tenant_allows() (the SAME helper used by
--   0122 / drizzle/optional/0002_tenant_rls_all.sql), composed with a STABLE
--   factory-resolver:
--
--     USING ( app_tenant_allows( app_factory_of_machine_code("machineCode"), NULL ) )
--
--   app_tenant_allows() short-circuits to TRUE when:
--     - app.tenant_rls_active GUC is unset / <> 'on'  (flag OFF, legacy conns,
--       table OWNER, any query not wrapped in runWithTenantScope), OR
--     - app.tenant_bypass = 'on'                       (admin / service), OR
--     - the resolved factory code ∈ the session's app.tenant_factory_codes list.
--
--   CRITICAL fail-open guarantee for these JOIN-based policies: if the resolver
--   returns NULL (machineCode/lineCode/lineId not found, orphan row, broken
--   hierarchy link, NULL key), app_tenant_allows(NULL, NULL) checks the GUCs
--   FIRST. So while the flag is OFF the predicate is TRUE regardless of the join.
--   Even with the flag ON, a NULL resolved factory is NOT silently locked out at
--   the helper level — BUT note (honest caveat): once the flag is ON and a row's
--   factory cannot be resolved, p_factory IS NULL so the row will NOT match the
--   factory-codes branch and a scoped (non-bypass) user will NOT see it. This is
--   the intended scoping behaviour (a row we cannot attribute to the user's
--   factory is hidden from a scoped user), and admins/bypass + the flag-OFF
--   default still see everything. There is NO global lockout: turning the flag
--   off (or never setting it) restores full visibility instantly.
--
--   PRECONDITION for enforcement to ever take effect: the app must connect as a
--   NON-owner, NOBYPASSRLS role (RLS is skipped for the table owner/superuser).
--   See the role template at the bottom of drizzle/optional/0002_tenant_rls_all.sql.
--
-- IDEMPOTENT: re-running is harmless — helpers use CREATE OR REPLACE FUNCTION;
-- ENABLE RLS is a no-op if already on; policies are DROP ... IF EXISTS then
-- re-created. The whole policy block is GUARDED so it only runs once the shared
-- app_tenant_allows() helper exists (mirrors 0122's self-contained approach by
-- re-defining the helper first, so the guard is always satisfied here).
--
-- ADOPTION CAVEAT (same as 0122): enforcement for these tables only happens when
-- an operator wraps the data-layer query in runWithTenantScope (server/db/
-- tenantContext.ts) AND TENANT_RLS_ENABLED=true. Until then this is fully inert.
-- ============================================================================

-- ── Ensure the inert-by-default helper exists ───────────────────────────────
-- Mirrors drizzle/optional/0002_tenant_rls_all.sql and 0122 so this migration is
-- self-contained and order-independent. CREATE OR REPLACE keeps it idempotent.
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ============================================================================
-- FACTORY-RESOLVER HELPERS (SECURITY DEFINER, STABLE)
--
-- Each resolves the owning factories.code for a hot-table row by walking the
-- hierarchy. Verified against drizzle/schema/hierarchy.ts (2026-06-28):
--   machines(stationId)         -> stations(id)
--   stations(lineId)            -> production_lines(id)
--   production_lines(workshopId)-> workshops(id)
--   workshops(factoryId)        -> factories(id), factories.code
-- and the *.code lookups:
--   machines.code         is UNIQUE  (machines_code_unique / idx_machines_code) → 1 row
--   production_lines.code is NOT unique (only idx_lines_code) — see caveat below
--
-- SECURITY DEFINER: the resolver must read the hierarchy tables even when the
-- caller is a scoped, RLS-restricted role and even if RLS is later enabled on
-- those hierarchy tables — otherwise the join itself would be filtered and the
-- predicate could not resolve a factory. Running as the function OWNER lets the
-- resolver see the full hierarchy; it returns ONLY a factory CODE (no row data),
-- so it leaks nothing a tenant policy would not already gate on.
--
-- STABLE: pure function of the argument + table contents within one statement →
-- PostgreSQL may cache the result per distinct argument per statement, so the
-- resolver is evaluated once per distinct machineCode/lineCode/lineId in a scan,
-- not once per row.
--
-- All table names are schema-qualified (public.) for SECURITY DEFINER hygiene
-- (avoids search_path ambiguity). SET search_path is pinned to a safe value.
-- ============================================================================

-- oee_metrics.machineCode → factories.code (machine.code is UNIQUE → at most 1)
CREATE OR REPLACE FUNCTION app_factory_of_machine_code(p_code text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT f.code
  FROM public.machines          m
  JOIN public.stations          s  ON s.id  = m."stationId"
  JOIN public.production_lines  pl ON pl.id = s."lineId"
  JOIN public.workshops         w  ON w.id  = pl."workshopId"
  JOIN public.factories         f  ON f.id  = w."factoryId"
  WHERE m.code = p_code
  LIMIT 1
$$;

-- wip_tracking.lineId (int) → factories.code (production_lines.id is the PK → at most 1)
CREATE OR REPLACE FUNCTION app_factory_of_line_id(p_id integer)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT f.code
  FROM public.production_lines  pl
  JOIN public.workshops         w  ON w.id  = pl."workshopId"
  JOIN public.factories         f  ON f.id  = w."factoryId"
  WHERE pl.id = p_id
  LIMIT 1
$$;

-- process_results.lineCode (text) → factories.code.
-- CAVEAT: production_lines.code is NOT globally unique (only idx_lines_code,
-- no UNIQUE constraint — a code may repeat across workshops/factories). LIMIT 1
-- returns one deterministic-enough factory; for correct multi-factory scoping a
-- line CODE that collides across factories cannot be disambiguated from lineCode
-- alone. In practice line codes are unique per deployment. If they are not in
-- yours, prefer scoping process_results by a unique key (e.g. denormalize a
-- factoryCode, future work). Documented honestly rather than silently wrong.
CREATE OR REPLACE FUNCTION app_factory_of_line_code(p_code text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT f.code
  FROM public.production_lines  pl
  JOIN public.workshops         w  ON w.id  = pl."workshopId"
  JOIN public.factories         f  ON f.id  = w."factoryId"
  WHERE pl.code = p_code
  LIMIT 1
$$;

-- ============================================================================
-- POLICIES — GUARDED (only if app_tenant_allows() exists; it always does here
-- because we re-defined it above, but the guard documents the dependency and
-- keeps the block safe if someone strips the helper redefinition).
-- ============================================================================
DO $rls$
BEGIN
  IF to_regprocedure('app_tenant_allows(text, text)') IS NULL THEN
    RAISE NOTICE '0125: app_tenant_allows(text,text) missing — skipping hot-table RLS policies (fail-open: tables stay unrestricted).';
    RETURN;
  END IF;

  -- ── oee_metrics — factory via machineCode (machine→station→line→workshop→factory)
  EXECUTE 'ALTER TABLE oee_metrics ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_select ON oee_metrics';
  EXECUTE 'CREATE POLICY tenant_select ON oee_metrics FOR SELECT
             USING ( app_tenant_allows( app_factory_of_machine_code("machineCode"), NULL ) )';
  EXECUTE 'DROP POLICY IF EXISTS tenant_modify ON oee_metrics';
  EXECUTE 'CREATE POLICY tenant_modify ON oee_metrics FOR ALL
             USING      ( app_tenant_allows( app_factory_of_machine_code("machineCode"), NULL ) )
             WITH CHECK ( app_tenant_allows( app_factory_of_machine_code("machineCode"), NULL ) )';

  -- ── process_results — factory via lineCode (line.code→workshop→factory)
  EXECUTE 'ALTER TABLE process_results ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_select ON process_results';
  EXECUTE 'CREATE POLICY tenant_select ON process_results FOR SELECT
             USING ( app_tenant_allows( app_factory_of_line_code("lineCode"), NULL ) )';
  EXECUTE 'DROP POLICY IF EXISTS tenant_modify ON process_results';
  EXECUTE 'CREATE POLICY tenant_modify ON process_results FOR ALL
             USING      ( app_tenant_allows( app_factory_of_line_code("lineCode"), NULL ) )
             WITH CHECK ( app_tenant_allows( app_factory_of_line_code("lineCode"), NULL ) )';

  -- ── wip_tracking — factory via lineId (line.id→workshop→factory)
  EXECUTE 'ALTER TABLE wip_tracking ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_select ON wip_tracking';
  EXECUTE 'CREATE POLICY tenant_select ON wip_tracking FOR SELECT
             USING ( app_tenant_allows( app_factory_of_line_id("lineId"), NULL ) )';
  EXECUTE 'DROP POLICY IF EXISTS tenant_modify ON wip_tracking';
  EXECUTE 'CREATE POLICY tenant_modify ON wip_tracking FOR ALL
             USING      ( app_tenant_allows( app_factory_of_line_id("lineId"), NULL ) )
             WITH CHECK ( app_tenant_allows( app_factory_of_line_id("lineId"), NULL ) )';
END
$rls$;

-- ============================================================================
-- PERFORMANCE NOTE
--   The resolvers are STABLE, so the planner evaluates them at most once per
--   distinct argument per statement (not per row). The join keys they use are
--   ALL already indexed (verified against drizzle/schema/hierarchy.ts):
--     machines.code            → idx_machines_code (+ UNIQUE)         ✓
--     machines.stationId       → idx_machines_station                ✓
--     stations.id / lineId     → PK / idx_stations_line              ✓
--     production_lines.id      → PK                                  ✓
--     production_lines.code    → idx_lines_code                      ✓
--     production_lines.workshopId → idx_lines_workshop               ✓
--     workshops.id / factoryId → PK / idx_workshops_factory          ✓
--     factories.id             → PK                                  ✓
--   No missing supporting index — the resolver join is fully index-backed.
--   (If a deployment drops idx_lines_code, add it back before enabling the flag
--    so process_results scoping stays cheap.)
-- ============================================================================

-- ============================================================================
-- ROLLBACK (per table — instant, no data loss):
--   ALTER TABLE oee_metrics      DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS tenant_select ON oee_metrics;
--   DROP POLICY IF EXISTS tenant_modify ON oee_metrics;
--   ALTER TABLE process_results  DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS tenant_select ON process_results;
--   DROP POLICY IF EXISTS tenant_modify ON process_results;
--   ALTER TABLE wip_tracking     DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS tenant_select ON wip_tracking;
--   DROP POLICY IF EXISTS tenant_modify ON wip_tracking;
--   -- (optional) drop the resolvers:
--   DROP FUNCTION IF EXISTS app_factory_of_machine_code(text);
--   DROP FUNCTION IF EXISTS app_factory_of_line_code(text);
--   DROP FUNCTION IF EXISTS app_factory_of_line_id(integer);
-- Or simply leave TENANT_RLS_ENABLED=false so the GUC is never set and every
-- policy short-circuits to allow-all.
-- ============================================================================
