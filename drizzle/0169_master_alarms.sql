-- ============================================================================
-- Migration 0169: ISA-18.2 / EEMUA-191 Master Alarm Database (W5-21, doc 25)
--
-- Adds the RATIONALIZATION core that ISA-18.2 requires but was missing. Where
-- alarm_taxonomy (0146) is only a vendor dictionary (nativeCode → standardCode +
-- severity, entered by hand), master_alarms adds priority (DERIVED from consequence ×
-- time-to-respond via the EEMUA-191 matrix), setpoint, deadband, consequence,
-- timeToRespond, rationalization text, plus ISA-18.2 shelving (shelvedUntil) and
-- design suppression (isSuppressed).
--
--   • master_alarms — one rationalized alarm point. alarmKey joins
--                     alarm_taxonomy.standardCode; assetType scopes it to a
--                     machineType/deviceType class (nullable = global). The runtime
--                     alarm bridge (adapterAlarmBridge) reads shelvedUntil/isSuppressed
--                     and SKIPS raising an Andon when the alarm is shelved/suppressed.
--
-- SAFETY / NO-OP: GOVERNANCE + SIGNAL metadata only. Shelving/suppression only ever
--   SUPPRESSES an Andon (a visual signal). It opens NO device-control path.
--
-- priority / consequence columns are varchar (NOT new pg enums) → migration stays
-- additive (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE). Additive + idempotent:
-- re-runnable (IF NOT EXISTS / DROP POLICY IF EXISTS throughout). RLS mirrors 0146.
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0146) ──────────
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ----------------------------------------------------------------------------
-- master_alarms — ISA-18.2 master alarm DB (rationalized alarm points)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "master_alarms" (
  "id"               serial PRIMARY KEY,
  "alarmKey"         varchar(64)  NOT NULL,
  "assetType"        varchar(48),
  "vendor"           varchar(48),
  "nativeCode"       varchar(64),
  "label"            varchar(128),
  "priority"         varchar(16)  NOT NULL DEFAULT 'low',
  "consequence"      varchar(16)  NOT NULL DEFAULT 'minor',
  "timeToRespond"    integer,
  "setpoint"         varchar(96),
  "deadband"         varchar(96),
  "rationalization"  text,
  "shelvedUntil"     timestamp,
  "isSuppressed"     boolean      NOT NULL DEFAULT false,
  "scope"            varchar(64),
  "corporateCode"    varchar(50),
  "factoryId"        integer,
  "createdBy"        integer,
  "createdAt"        timestamp    NOT NULL DEFAULT now(),
  "updatedAt"        timestamp    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_masteralarm_key_asset" ON "master_alarms" ("alarmKey", "assetType");
CREATE INDEX IF NOT EXISTS "idx_masteralarm_key"      ON "master_alarms" ("alarmKey");
CREATE INDEX IF NOT EXISTS "idx_masteralarm_priority" ON "master_alarms" ("priority");
CREATE INDEX IF NOT EXISTS "idx_masteralarm_vendor"   ON "master_alarms" ("vendor");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0146). corporateCode is the predicate column;
-- factory is passed NULL because this table scopes by factoryId (int). WITHOUT the
-- session GUC (flag OFF / table owner) app_tenant_allows() returns TRUE = allow-all.
-- ============================================================================
ALTER TABLE "master_alarms" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "master_alarms";
CREATE POLICY tenant_select ON "master_alarms" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "master_alarms";
CREATE POLICY tenant_modify ON "master_alarms" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
