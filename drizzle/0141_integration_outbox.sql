-- ============================================================================
-- Migration 0141: Automation Orchestration R0 (doc 16 §4 Khối 0 / §15 R0-4)
-- ERP integration gateway — DURABLE OUTBOUND publishing store.
--
--   • integration_outbox — one row per outbound integration event awaiting
--     delivery. A producer enqueues a row (transactionally with its own work);
--     a background worker (erpOutbox, gated by ERP_OUTBOX_ENABLED) drains
--     pending rows to targetEndpoint with exponential backoff + a per-endpoint
--     circuit-breaker. Exhausted rows move to status='dead' (dead-letter).
--
--   eventType : production-event | quality-result | oee-metric | genealogy-record
--   status    : pending | sent | failed | dead
--
-- NOT tenant-scoped (matches webhook_configs / api_keys): corporateCode is an
-- optional grouping tag, not an isolation boundary.
--
-- Additive + idempotent: re-runnable (IF NOT EXISTS throughout). Uses varchar
-- status columns (NOT new pg enums) so no ALTER TYPE on any existing enum.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "integration_outbox" (
  "id"             serial PRIMARY KEY,
  "eventType"      varchar(40)  NOT NULL,
  "payload"        jsonb        NOT NULL,
  "targetEndpoint" text         NOT NULL,
  "status"         varchar(16)  NOT NULL DEFAULT 'pending',
  "attempts"       integer      NOT NULL DEFAULT 0,
  "nextAttemptAt"  timestamp    NOT NULL DEFAULT now(),
  "lastError"      text,
  "idempotencyKey" varchar(200),
  "corporateCode"  varchar(50),
  "createdAt"      timestamp    NOT NULL DEFAULT now(),
  "sentAt"         timestamp
);

-- Worker drain query: pending/failed rows ordered by when they may next be tried.
CREATE INDEX IF NOT EXISTS "idx_outbox_status_next"
  ON "integration_outbox" ("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "idx_outbox_endpoint"
  ON "integration_outbox" ("targetEndpoint");
CREATE INDEX IF NOT EXISTS "idx_outbox_event_type"
  ON "integration_outbox" ("eventType");

-- Idempotent enqueue: a non-null idempotencyKey is unique (many NULLs allowed).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_outbox_idem"
  ON "integration_outbox" ("idempotencyKey");

-- ----------------------------------------------------------------------------
-- integration_inbound_idempotency (R0-3) — records each accepted INBOUND ERP
-- intake by (resource, idempotencyKey) so a retried POST replays the prior
-- result instead of double-inserting into production_orders / bom_definitions.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "integration_inbound_idempotency" (
  "id"             serial PRIMARY KEY,
  "resource"       varchar(40)  NOT NULL,
  "idempotencyKey" varchar(200) NOT NULL,
  "schemaVersion"  varchar(40),
  "result"         jsonb        NOT NULL,
  "corporateCode"  varchar(50),
  "createdAt"      timestamp    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_inbound_idem_resource_key"
  ON "integration_inbound_idempotency" ("resource", "idempotencyKey");
