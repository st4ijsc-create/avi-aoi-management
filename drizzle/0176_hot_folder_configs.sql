-- ============================================================================
-- Migration 0176: Hot-folder ingestion — configs + processed-file ledger
-- (doc 27 §3 gap C1 — P0 · Đợt 2 / agent W2-A).
--
-- PROBLEM: real AOI/AVI machines (I.C.T, Saki, Mirtec, custom) export per-board
-- result files (CSV/XML/JSON) into a local/SMB folder — the DOMINANT export mode
-- of commercial AOI — but the platform had no file-drop ingestion at all
-- (grep chokidar/fs.watch = 0 on the ingest path).
--
-- WHAT THIS DOES (additive + idempotent — CREATE TABLE/INDEX IF NOT EXISTS only;
-- no ALTER TYPE, no new pg enum; existing rows unaffected):
--   1. CREATE TABLE hot_folder_configs — one watched folder per machine+adapter:
--      glob filePattern, archive/error folders, stabilityWindowMs (partial-write
--      safety), pollFallbackMs (SMB shares without FS events), deleteAfterDays
--      (archive retention), enabled.
--   2. CREATE TABLE hot_folder_files — append-only processed-file ledger with a
--      UNIQUE idempotencyKey (machineId + sha256(content) + fileName) so a
--      re-dropped duplicate can NEVER double-insert an inspection, even across
--      restarts.
--
-- HONESTY: SCHEMA only. The watcher service (server/services/vision/
-- hotFolderService.ts) is flag-gated by HOT_FOLDER_INGEST_ENABLED and persists
-- results through the EXISTING machineApi.submitInspection path — no duplicated
-- insert logic, no device-control path.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "hot_folder_configs" (
  "id"                serial PRIMARY KEY,
  "machineId"         integer NOT NULL,
  "adapterKey"        varchar(64) NOT NULL,
  "watchPath"         text NOT NULL,
  "filePattern"       varchar(255) NOT NULL DEFAULT '*.{csv,xml,json}',
  "archivePath"       text,
  "errorPath"         text,
  "enabled"           boolean NOT NULL DEFAULT true,
  "pollFallbackMs"    integer NOT NULL DEFAULT 0,
  "stabilityWindowMs" integer NOT NULL DEFAULT 2000,
  "deleteAfterDays"   integer NOT NULL DEFAULT 30,
  "createdAt"         timestamp NOT NULL DEFAULT now(),
  "updatedAt"         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_hot_folder_configs_machine" ON "hot_folder_configs" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_hot_folder_configs_enabled" ON "hot_folder_configs" ("enabled");

CREATE TABLE IF NOT EXISTS "hot_folder_files" (
  "id"             serial PRIMARY KEY,
  "configId"       integer NOT NULL,
  "machineId"      integer NOT NULL,
  "fileName"       varchar(512) NOT NULL,
  "contentHash"    varchar(64) NOT NULL,
  "idempotencyKey" varchar(700) NOT NULL,
  "status"         varchar(24) NOT NULL,
  "inspectionId"   integer,
  "errorReason"    text,
  "processedAt"    timestamp NOT NULL DEFAULT now(),
  "createdAt"      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_hot_folder_files_idem" ON "hot_folder_files" ("idempotencyKey");
CREATE INDEX IF NOT EXISTS "idx_hot_folder_files_config" ON "hot_folder_files" ("configId");
CREATE INDEX IF NOT EXISTS "idx_hot_folder_files_processed_at" ON "hot_folder_files" ("processedAt");
