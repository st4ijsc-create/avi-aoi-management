-- ============================================================================
-- Migration 0153: Dynamic Safety Zones (S2a, doc 20 §2/§5 / doc 16 §8)
--
-- The SOFTWARE-ADVISORY slice of S2, behind the flag SAFETY_ZONE_SW_ENABLED:
--
--   • safety_zones — a dynamic protective zone around a robot/device/station/line
--                    carrying THREE graduated reaction distance thresholds
--                    (speedReduce ≥ stop ≥ ratedStop, all mm) + a target speed % for
--                    the speed-reduce band + advisory geometry (AABB and/or polygon).
--
-- Zone-intrusion advisory events REUSE safety_events (0145) with
-- eventType 'zone_intrusion' | 'speed_violation' — NO new events table is added.
--
-- ⚠ CRITICAL HONESTY / SAFETY: NOTHING here is safety-rated. safety_zones + the
--   intrusion evaluator are ADVISORY. The software DETECTS the 3 reaction levels
--   (incl. rated_stop) and LOGS/PROPOSES — it does NOT perform a safety-rated stop
--   and gives NO sub-second guarantee. A 'rated_stop' finding is LOGGED with an
--   explicit note that a certified Safety PLC (SIL 2/3 + UWB/LiDAR + <100ms
--   dual-channel) must perform the ACTUAL rated stop — that is S2 HARDWARE, deferred.
--   speed_reduce/stop are only ever PROPOSED through the EXISTING gated dispatchers
--   (robotCommandDispatcher / commandDispatcher, dry-run by default). This migration
--   opens NO new device-control path. Human positions are SIMULATED until real
--   UWB/LiDAR/vision (S2b).
--
-- TENANT SCOPE: corporateCode (varchar) + factoryId (int) + a free `scope` tag mirror
-- safety_events (0145). RLS uses the shared, inert-by-default app_tenant_allows()
-- helper on corporateCode — a complete no-op unless TENANT_RLS_ENABLED=true sets the
-- session GUC. The helper is (re)defined idempotently here so this migration is
-- self-contained.
--
-- type columns are varchar (NOT new pg enums) → migration stays additive
-- (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE). Additive + idempotent: re-runnable
-- (IF NOT EXISTS / DROP POLICY IF EXISTS throughout).
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0145) ──────────
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ----------------------------------------------------------------------------
-- safety_zones (S2a) — ADVISORY dynamic safety zone (NOT safety-rated)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "safety_zones" (
  "id"                      serial PRIMARY KEY,
  "code"                    varchar(64)  NOT NULL,
  "name"                    varchar(255) NOT NULL,
  "robotId"                 integer,
  "deviceId"                integer,
  "stationId"               integer,
  "lineId"                  integer,
  "geometry"                jsonb,
  "speedReduceDistanceMm"   integer      NOT NULL DEFAULT 2000,
  "stopDistanceMm"          integer      NOT NULL DEFAULT 1000,
  "ratedStopDistanceMm"     integer      NOT NULL DEFAULT 500,
  "reactionSpeedPct"        integer      NOT NULL DEFAULT 30,
  "enabled"                 boolean      NOT NULL DEFAULT true,
  "notes"                   text,
  "scope"                   varchar(64),
  "corporateCode"           varchar(50),
  "factoryId"               integer,
  "createdAt"               timestamp    NOT NULL DEFAULT now(),
  "updatedAt"               timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_safetyzone_code"    ON "safety_zones" ("code");
CREATE INDEX IF NOT EXISTS "idx_safetyzone_robot"   ON "safety_zones" ("robotId");
CREATE INDEX IF NOT EXISTS "idx_safetyzone_station" ON "safety_zones" ("stationId");
CREATE INDEX IF NOT EXISTS "idx_safetyzone_line"    ON "safety_zones" ("lineId");
CREATE INDEX IF NOT EXISTS "idx_safetyzone_enabled" ON "safety_zones" ("enabled");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0145). corporateCode is the predicate column;
-- factory is passed NULL because this table scopes by factoryId (int), not a
-- factory CODE string. WITHOUT the session GUC (flag OFF / table owner / any query
-- not wrapped in withTenantScope) app_tenant_allows() returns TRUE = allow-all.
-- ============================================================================
ALTER TABLE "safety_zones" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "safety_zones";
CREATE POLICY tenant_select ON "safety_zones" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "safety_zones";
CREATE POLICY tenant_modify ON "safety_zones" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
