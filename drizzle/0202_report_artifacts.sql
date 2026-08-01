-- ============================================================================
-- Migration 0202 (doc 32 Wave R2 · decision #4) — Report artifact store.
--
-- Persist every RENDERED report file (on-demand / scheduled / external /
-- mobile) on the storage layer (server/storage.ts storagePut) with a
-- re-download handle and a retention window (default now()+365 days per
-- decision #4). Replaces the volatile in-memory Map (TTL 30' — the external
-- reports stub in server/_core/index.ts) and the ad-hoc base64 / S3 report
-- storage scattered across the codebase.
--
-- The SINGLE persistence path every report goes through is
-- server/services/reportArtifactService.persistArtifact. A daily cleanup job
-- (REPORT_ARTIFACT_CLEANUP_ENABLED, default true) deletes the storage object
-- AND the row once expiresAt has passed.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "report_artifacts" (
  "id" serial PRIMARY KEY,
  "reportType" varchar(64) NOT NULL,
  -- pdf | xlsx | csv | html | pptx
  "format" varchar(12) NOT NULL,
  "title" varchar(500),
  -- filters / scope the report was generated with
  "params" jsonb,
  -- storagePut() key + url (url may be re-signed on download)
  "storageKey" text NOT NULL,
  "storageUrl" text NOT NULL,
  -- sha256 hex of the file bytes (dedupe key + integrity handle)
  "fileHash" varchar(64) NOT NULL,
  "fileSize" integer NOT NULL DEFAULT 0,
  "contentType" varchar(128) NOT NULL DEFAULT 'application/octet-stream',
  -- creating user id; NULL for system / scheduled (no FK — mirrors report_deliveries)
  "createdBy" integer,
  -- on_demand | scheduled | external | mobile
  "source" varchar(20) NOT NULL DEFAULT 'on_demand',
  -- retention deadline (decision #4: >= 1 year). Default now()+365d.
  "expiresAt" timestamp NOT NULL DEFAULT (now() + interval '365 days'),
  "createdAt" timestamp NOT NULL DEFAULT now()
);

-- History drawer: newest artifacts of one user.
CREATE INDEX IF NOT EXISTS "idx_report_artifacts_creator"
  ON "report_artifacts" ("createdBy", "createdAt");
-- Filter by report type.
CREATE INDEX IF NOT EXISTS "idx_report_artifacts_type"
  ON "report_artifacts" ("reportType");
-- Retention cleanup: expired rows only.
CREATE INDEX IF NOT EXISTS "idx_report_artifacts_expires"
  ON "report_artifacts" ("expiresAt");
-- Dedupe by content hash.
CREATE INDEX IF NOT EXISTS "idx_report_artifacts_hash"
  ON "report_artifacts" ("fileHash");
