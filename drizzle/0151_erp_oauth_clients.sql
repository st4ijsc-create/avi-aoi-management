-- ============================================================================
-- Migration 0151: Automation Orchestration K0+ (doc 16 §4 Khối 0 / doc 18 §6)
-- ERP gateway hardening — OAuth2 client-credentials registry.
--
--   • erp_oauth_clients — one row per registered ERP/MES machine-to-machine
--     client. A client authenticates at POST /api/v1/oauth/token with its
--     client_id + client_secret (client_credentials grant) and receives a
--     short-lived signed token carrying its granted scopes. The plaintext secret
--     is shown ONCE at creation; only a SHA-256 hash is stored (REUSES the
--     api_keys hashing approach — server/api/v1/auth.ts hashApiKey).
--
-- This is ADDITIVE to the existing API-key / bearer / MASTER_API_KEY auth: OAuth
-- is an ALTERNATIVE inbound credential, gated by ERP_OAUTH_ENABLED (default OFF).
--
-- NOT tenant-scoped (matches api_keys / webhook_configs / integration_outbox):
-- corporateCode is an optional grouping tag, not an isolation boundary. RLS is
-- inert on these integration tables by house convention; the DROP POLICY guard
-- below is included so the migration re-runs cleanly if a policy is ever added.
--
-- Additive + idempotent: re-runnable (IF NOT EXISTS throughout). Uses varchar
-- columns (NO new pg enums) so no ALTER TYPE on any existing enum.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "erp_oauth_clients" (
  "id"               serial PRIMARY KEY,
  "clientId"         varchar(100) NOT NULL,
  -- SHA-256 hex of the client secret. Plaintext shown ONCE at creation, never stored.
  "clientSecretHash" varchar(128) NOT NULL,
  "name"             varchar(255) NOT NULL,
  "description"      text,
  -- Granted scopes (e.g. ["erp:write"]). "*" = all scopes.
  "scopes"           jsonb        NOT NULL DEFAULT '[]'::jsonb,
  "enabled"          boolean      NOT NULL DEFAULT true,
  "corporateCode"    varchar(50),
  "createdBy"        integer,
  "lastUsedAt"       timestamp,
  "createdAt"        timestamp    NOT NULL DEFAULT now(),
  "updatedAt"        timestamp    NOT NULL DEFAULT now()
);

-- clientId is the public identifier the token endpoint looks up — unique.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_erp_oauth_clients_client_id"
  ON "erp_oauth_clients" ("clientId");
CREATE INDEX IF NOT EXISTS "idx_erp_oauth_clients_enabled"
  ON "erp_oauth_clients" ("enabled");

-- RLS is inert on integration tables by house convention. Guard is idempotent so
-- a future policy addition + re-run stays clean.
DROP POLICY IF EXISTS "erp_oauth_clients_rls" ON "erp_oauth_clients";
