-- ============================================================================
-- Migration 0154: S2b — Vision human-detection calibration + Safety-PLC status
--                 (doc 20 §2/§5 S2b, doc 16 §8)
--
-- The SOFTWARE-ADVISORY producers that FEED the S2a evaluator (0153), behind the flags
-- SAFETY_VISION_ENABLED and SAFETY_PLC_ADAPTER_ENABLED:
--
--   • camera_calibrations — per-camera pixel→floor planar HOMOGRAPHY (3×3, row-major)
--                           and the ≥4 image↔floor correspondence pairs it was solved
--                           from, plus which safety zone / robot / station the camera
--                           watches. A person DETECTION (pixel bbox) is projected
--                           through H to a FLOOR position, then fed to the S2a evaluator.
--
--   • safety_plc_configs  — a READ-ONLY safety-PLC status endpoint (Pilz PNOZmulti/PSS,
--                           Sick Flexi Soft). backend 'sim' (default) drives a scripted
--                           status stream; 'modbus'/'opcua' read live NON-safety-rated
--                           status (e-stop / zone-occupied / reset-required / muting) via
--                           the EXISTING OT driver read path. Status → advisory
--                           safety_events (0145).
--
-- Advisory events REUSE safety_events (0145). NO new events table is added.
--
-- ⚠ CRITICAL HONESTY / SAFETY: NOTHING here is safety-rated. The vision producer NEVER
--   fabricates a detection — with no inference backend it produces NOTHING (a real
--   camera + calibration + an exported ONNX model is required; yolo26n.pt is PyTorch
--   and needs a one-time Python→ONNX export). The PLC adapter is READ-ONLY: it OBSERVES
--   the certified PLC's status and LOGS advisory events — it NEVER actuates a rated stop
--   (the certified Safety PLC performs the rated stop itself, in hardware). Both open NO
--   new device-control path. Human positions are advisory until a real camera+calibration
--   (or real PLC endpoint) is set.
--
-- TENANT SCOPE: corporateCode (varchar) + factoryId (int) + a free `scope` tag mirror
-- safety_zones (0153) / safety_events (0145). RLS uses the shared, inert-by-default
-- app_tenant_allows() helper on corporateCode — a no-op unless TENANT_RLS_ENABLED sets
-- the session GUC. The helper is (re)defined idempotently here so this migration is
-- self-contained.
--
-- type columns are varchar (NOT new pg enums) → the migration stays additive
-- (CREATE TABLE/INDEX/POLICY only, no ALTER TYPE). Additive + idempotent: re-runnable
-- (IF NOT EXISTS / DROP POLICY IF EXISTS throughout).
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0145/0153) ─────
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ----------------------------------------------------------------------------
-- camera_calibrations (S2b-1) — per-camera pixel→floor homography (ADVISORY)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "camera_calibrations" (
  "id"              serial PRIMARY KEY,
  "cameraId"        varchar(128) NOT NULL,
  "name"            varchar(255),
  "homography"      jsonb,
  "pairs"           jsonb,
  "residualMm"      real,
  "safetyZoneId"    integer,
  "robotId"         integer,
  "stationId"       integer,
  "lineId"          integer,
  "imageWidth"      integer,
  "imageHeight"     integer,
  "enabled"         boolean      NOT NULL DEFAULT true,
  "notes"           text,
  "scope"           varchar(64),
  "corporateCode"   varchar(50),
  "factoryId"       integer,
  "createdAt"       timestamp    NOT NULL DEFAULT now(),
  "updatedAt"       timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_camcalib_camera"  ON "camera_calibrations" ("cameraId");
CREATE INDEX IF NOT EXISTS "idx_camcalib_zone"    ON "camera_calibrations" ("safetyZoneId");
CREATE INDEX IF NOT EXISTS "idx_camcalib_robot"   ON "camera_calibrations" ("robotId");
CREATE INDEX IF NOT EXISTS "idx_camcalib_enabled" ON "camera_calibrations" ("enabled");

-- ----------------------------------------------------------------------------
-- safety_plc_configs (S2b-2) — READ-ONLY safety-PLC status endpoint (ADVISORY)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "safety_plc_configs" (
  "id"              serial PRIMARY KEY,
  "code"            varchar(64)  NOT NULL,
  "name"            varchar(255) NOT NULL,
  "vendor"          varchar(32)  NOT NULL DEFAULT 'generic',
  "backend"         varchar(16)  NOT NULL DEFAULT 'sim',
  "endpoint"        varchar(512),
  "statusMap"       jsonb,
  "robotId"         integer,
  "stationId"       integer,
  "lineId"          integer,
  "enabled"         boolean      NOT NULL DEFAULT true,
  "notes"           text,
  "scope"           varchar(64),
  "corporateCode"   varchar(50),
  "factoryId"       integer,
  "createdAt"       timestamp    NOT NULL DEFAULT now(),
  "updatedAt"       timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_safetyplc_code"    ON "safety_plc_configs" ("code");
CREATE INDEX IF NOT EXISTS "idx_safetyplc_backend" ON "safety_plc_configs" ("backend");
CREATE INDEX IF NOT EXISTS "idx_safetyplc_robot"   ON "safety_plc_configs" ("robotId");
CREATE INDEX IF NOT EXISTS "idx_safetyplc_enabled" ON "safety_plc_configs" ("enabled");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0145/0153). corporateCode is the predicate column;
-- factory is passed NULL because these tables scope by factoryId (int), not a factory
-- CODE string. WITHOUT the session GUC (flag OFF / table owner / any query not wrapped
-- in withTenantScope) app_tenant_allows() returns TRUE = allow-all.
-- ============================================================================
ALTER TABLE "camera_calibrations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "camera_calibrations";
CREATE POLICY tenant_select ON "camera_calibrations" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "camera_calibrations";
CREATE POLICY tenant_modify ON "camera_calibrations" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "safety_plc_configs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "safety_plc_configs";
CREATE POLICY tenant_select ON "safety_plc_configs" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "safety_plc_configs";
CREATE POLICY tenant_modify ON "safety_plc_configs" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
