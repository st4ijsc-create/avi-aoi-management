-- ============================================================================
-- Migration 0150: AI/analytics loop completion (Khối 4, doc 16 §9 / doc 18 §6 I2)
--
-- Closes the AI/analytics loop with TWO append-only ADVISORY ledgers. Behind flags
-- AI_ROBOT_ANOMALY_ENABLED (I2-a) + AI_MODEL_AUTOROLLBACK_ENABLED (I2-b) — both
-- default OFF. Additive + idempotent. Neither opens a device-control path:
--
--   robot_behavior_anomalies — ONE row per detected robot-behaviour anomaly. The
--     detector (robotBehaviorAnomaly) reuses the aiTimeSeries engine (EWMA/CUSUM)
--     over robot_telemetry (joint_states/pose) + robot_jobs (cycle time). Every row
--     is ADVISORY: it raises a smart alert, NEVER a robot command. When a required
--     signal is absent (e.g. grip force with no force telemetry) NO row is written
--     (honest null-skip) rather than a fabricated anomaly.
--
--   model_rollback_events — append-only audit of AUTOMATIC + MANUAL model rollbacks.
--     When the ACTIVE version's live quality/confidence drops below its eval baseline
--     (or drift fires) the auto-rollback flips model_versions.status back to the prior
--     stable version and records ONE row here. Reuses model_versions (no fork). The
--     status flip is the SAME operation activateModelVersion already performs.
--
-- ⚠ SAFETY: both tables are ADVISORY/AUDIT only. No device-control path is opened.
--
-- TENANT SCOPE: corporateCode (varchar) + factoryId (int) mirror 0148 fieldHealth.
-- RLS uses the shared inert-by-default app_tenant_allows() helper on corporateCode —
-- a complete no-op unless TENANT_RLS_ENABLED=true sets the session GUC.
--
-- status/kind/trigger columns are varchar (NOT new pg enums) → additive (no ALTER TYPE).
-- Re-runnable (CREATE TABLE/INDEX/POLICY IF NOT EXISTS, DROP POLICY IF EXISTS).
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0142/0145/0148) ─
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

-- ----------------------------------------------------------------------------
-- I2-a — robot_behavior_anomalies (append-only advisory ledger)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "robot_behavior_anomalies" (
  "id"              serial PRIMARY KEY,
  "robotId"         integer      NOT NULL,
  -- trajectory_deviation | grip_force | cycle_time_trend
  "kind"            varchar(32)  NOT NULL,
  "score"           numeric(10,4) NOT NULL,
  "confidence"      numeric(5,4),
  -- low | medium | high | critical
  "severity"        varchar(16)  NOT NULL DEFAULT 'medium',
  "evidence"        jsonb,
  "alertId"         integer,
  -- raised | acknowledged (advisory lifecycle; NO resolve-to-command path)
  "status"          varchar(16)  NOT NULL DEFAULT 'raised',
  "acknowledgedBy"  integer,
  "acknowledgedAt"  timestamp,
  "scope"           varchar(64),
  "corporateCode"   varchar(50),
  "factoryId"       integer,
  "detectedAt"      timestamp    NOT NULL DEFAULT now(),
  "createdAt"       timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_robotanom_robot"    ON "robot_behavior_anomalies" ("robotId");
CREATE INDEX IF NOT EXISTS "idx_robotanom_kind"     ON "robot_behavior_anomalies" ("kind");
CREATE INDEX IF NOT EXISTS "idx_robotanom_status"   ON "robot_behavior_anomalies" ("status");
CREATE INDEX IF NOT EXISTS "idx_robotanom_detected" ON "robot_behavior_anomalies" ("detectedAt");

-- ----------------------------------------------------------------------------
-- I2-b — model_rollback_events (append-only audit of auto + manual rollbacks)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "model_rollback_events" (
  "id"             serial PRIMARY KEY,
  "modelId"        integer     NOT NULL,
  "fromVersionId"  integer,
  "toVersionId"    integer,
  "fromVersion"    varchar(50),
  "toVersion"      varchar(50),
  -- auto_drift | auto_accuracy | manual
  "trigger"        varchar(24) NOT NULL,
  "reason"         text        NOT NULL,
  "metrics"        jsonb,
  "alertId"        integer,
  "triggeredBy"    integer,
  "corporateCode"  varchar(50),
  "factoryId"      integer,
  "createdAt"      timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_modelrollback_model"   ON "model_rollback_events" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_modelrollback_trigger" ON "model_rollback_events" ("trigger");
CREATE INDEX IF NOT EXISTS "idx_modelrollback_created" ON "model_rollback_events" ("createdAt");

-- ============================================================================
-- RLS — inert-by-default (mirrors 0148). corporateCode is the predicate column;
-- factory is passed NULL (these tables scope by factoryId int, not a CODE string).
-- WITHOUT the session GUC (flag OFF / table owner) app_tenant_allows() = TRUE = allow-all.
-- ============================================================================
ALTER TABLE "robot_behavior_anomalies" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "robot_behavior_anomalies";
CREATE POLICY tenant_select ON "robot_behavior_anomalies" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "robot_behavior_anomalies";
CREATE POLICY tenant_modify ON "robot_behavior_anomalies" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));

ALTER TABLE "model_rollback_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "model_rollback_events";
CREATE POLICY tenant_select ON "model_rollback_events" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "model_rollback_events";
CREATE POLICY tenant_modify ON "model_rollback_events" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
