-- ============================================================================
-- Migration 0148: Field & Device Abstraction Layer (Khối 1, doc 16 §5 / §15 X1)
--
-- COMPLETES the device/field abstraction (already ~75%). Behind flag
-- FIELD_V2_ENABLED (default OFF). Two parts, BOTH additive + idempotent:
--
--   X1-a  UDM/UEM extension — ADD nullable columns to robot_telemetry so the
--         Unified Device Model can surface mobile/cobot fields:
--           battery_level     numeric    (AGV charge %, wired from VDA5050 battery)
--           joint_states      jsonb      (per-joint pos/vel — best-effort, honest null)
--           safety_zone_id    integer    (the zone the device occupies — best-effort)
--           firmware_version  varchar    (device firmware — best-effort, honest null)
--           last_heartbeat    timestamp  (liveness; drives the X1-b stale sweep)
--         ADD COLUMN IF NOT EXISTS → no break to existing reads/inserts.
--
--   X1-b/c/d  field_device_health — ONE row per device tracking the latest observed
--         heartbeat + the derived liveness state ('live'|'stale'|'lost_connection').
--         The heartbeat sweep (fieldHealthService) marks a device 'lost_connection'
--         once now()-last_heartbeat exceeds its TTL. Discovery (X1-d) also records a
--         candidate here on registration. varchar state (NOT a pg enum) → additive.
--
-- ⚠ HONESTY: joint_states / firmware_version are SEAMS — populated only when a real
--   driver provides them; otherwise an honest NULL (never fabricated). battery_level
--   is wired from the existing VDA5050 battery extraction for AGVs.
--
-- ⚠ SAFETY: this migration adds MONITORING/STATE columns only. It opens NO
--   device-control path — commands still route through the EXISTING gated dispatchers
--   (robotCommandDispatcher / commandDispatcher, dry-run by default). The command-level
--   authorization (X1-e) is enforced in code, not here.
--
-- TENANT SCOPE: field_device_health carries corporateCode (varchar) + factoryId (int)
-- + a free `scope` tag (mirrors 0145). RLS uses the shared inert-by-default
-- app_tenant_allows() helper on corporateCode — a complete no-op unless
-- TENANT_RLS_ENABLED=true sets the session GUC. The helper is (re)defined idempotently.
--
-- status / state columns are varchar (NOT new pg enums) → additive (no ALTER TYPE).
-- Re-runnable (ADD COLUMN / CREATE TABLE/INDEX/POLICY IF NOT EXISTS, DROP POLICY IF EXISTS).
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0142/0145) ─────
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ----------------------------------------------------------------------------
-- X1-a — robot_telemetry UDM extension columns (additive, nullable)
-- ----------------------------------------------------------------------------
ALTER TABLE "robot_telemetry" ADD COLUMN IF NOT EXISTS "battery_level"    numeric(6,2);
ALTER TABLE "robot_telemetry" ADD COLUMN IF NOT EXISTS "joint_states"     jsonb;
ALTER TABLE "robot_telemetry" ADD COLUMN IF NOT EXISTS "safety_zone_id"   integer;
ALTER TABLE "robot_telemetry" ADD COLUMN IF NOT EXISTS "firmware_version" varchar(64);
ALTER TABLE "robot_telemetry" ADD COLUMN IF NOT EXISTS "last_heartbeat"   timestamp;

-- ----------------------------------------------------------------------------
-- X1-b/c/d — field_device_health (one row per device; heartbeat TTL liveness)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "field_device_health" (
  "id"             serial PRIMARY KEY,
  -- Logical device key: "robot:<id>" | "machine:<id>" | "device:<externalId>".
  "deviceKey"      varchar(128) NOT NULL UNIQUE,
  "deviceKind"     varchar(24)  NOT NULL DEFAULT 'robot',
  "robotId"        integer,
  "machineId"      integer,
  -- Derived liveness state: live | stale | lost_connection | unknown
  "state"          varchar(24)  NOT NULL DEFAULT 'unknown',
  "lastHeartbeat"  timestamp,
  -- Per-device TTL override in ms (NULL → use the global FIELD_HEARTBEAT_TTL_MS).
  "heartbeatTtlMs" integer,
  -- Discovery provenance (X1-d): how this device entered the registry.
  "discoveredVia"  varchar(24),
  "endpoint"       varchar(255),
  "lastEventAt"    timestamp,
  "scope"          varchar(64),
  "corporateCode"  varchar(50),
  "factoryId"      integer,
  "createdAt"      timestamp    NOT NULL DEFAULT now(),
  "updatedAt"      timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fielddevhealth_state"    ON "field_device_health" ("state");
CREATE INDEX IF NOT EXISTS "idx_fielddevhealth_robot"    ON "field_device_health" ("robotId");
CREATE INDEX IF NOT EXISTS "idx_fielddevhealth_machine"  ON "field_device_health" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_fielddevhealth_heartbeat" ON "field_device_health" ("lastHeartbeat");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0145). corporateCode is the predicate column;
-- factory is passed NULL (this table scopes by factoryId int, not a CODE string).
-- WITHOUT the session GUC (flag OFF / table owner) app_tenant_allows() = TRUE = allow-all.
-- ============================================================================
ALTER TABLE "field_device_health" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "field_device_health";
CREATE POLICY tenant_select ON "field_device_health" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "field_device_health";
CREATE POLICY tenant_modify ON "field_device_health" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
