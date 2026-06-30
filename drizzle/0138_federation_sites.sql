-- ============================================================================
-- Migration 0138: Federation Initiative (doc 13) — F0 sites registry.
--
-- Creates the `sites` table: the CORE control-tower's registry of remote (and
-- local self-enrolled) platform deployments it will later poll read-only for
-- KPI roll-up (F1). F0 = registry + enrollment + probe only.
--
-- SECURITY: per-site read tokens are NEVER stored here. `authTokenRef` holds a
-- reference (e.g. "SITE_TOKEN_HCM01"); the secret is resolved from env at call
-- time (mirrors MASTER_API_KEY). A DB dump leaks no site secrets.
--
-- Additive + idempotent: re-runnable (IF NOT EXISTS throughout).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "sites" (
  "id"                  serial PRIMARY KEY,
  "code"                varchar(50)  NOT NULL,
  "name"                varchar(255) NOT NULL,
  "corporateCode"       varchar(50),
  "baseUrl"             text         NOT NULL,
  "region"              varchar(100),
  "authType"            varchar(20)  NOT NULL DEFAULT 'master_key',
  "authTokenRef"        varchar(128),
  "unsBrokerUrl"        text,
  "pollIntervalSec"     integer      NOT NULL DEFAULT 60,
  "status"              varchar(20)  NOT NULL DEFAULT 'unknown',
  "isLocal"             boolean      NOT NULL DEFAULT false,
  "lastSyncAt"          timestamp,
  "lastError"           text,
  "consecutiveFailures" integer      NOT NULL DEFAULT 0,
  "createdAt"           timestamp    NOT NULL DEFAULT now(),
  "updatedAt"           timestamp    NOT NULL DEFAULT now()
);

-- Unique site code (also keys SITE_TOKEN_<CODE>).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sites_code" ON "sites" ("code");

-- Lookup / rollup / dashboard indexes.
CREATE INDEX IF NOT EXISTS "idx_sites_code"      ON "sites" ("code");
CREATE INDEX IF NOT EXISTS "idx_sites_corporate" ON "sites" ("corporateCode");
CREATE INDEX IF NOT EXISTS "idx_sites_status"    ON "sites" ("status");
