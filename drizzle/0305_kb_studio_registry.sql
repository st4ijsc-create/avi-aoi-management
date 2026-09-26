-- ============================================================================
-- Migration 0305: kb_corpora + kb_ingest_jobs — Training Studio corpus/job
-- REGISTRY (doc69 Giai đoạn 5 / Wave E3, task E3-2), the MANAGEMENT layer over
-- E3-1's kb_studio_chunks (migration 0304, drizzle/schema/kbStudio.ts).
--
-- E3-1's kbIngestRouter ingests directly into kb_studio_chunks using a free-text
-- `corpus` string with NO registry and NO per-attempt job record. This migration
-- adds:
--   - kb_corpora: a named corpus registry (server/routers/kbStudioRouter.ts's
--     createCorpus/listCorpora/deleteCorpus) — one row per corpus namespace.
--   - kb_ingest_jobs: one row per ingest attempt (doc upload or URL fetch),
--     status pending|running|succeeded|failed, so the Training Studio "Jobs" tab
--     shows real ingest history instead of the operator inferring success from
--     chunk counts. Written by kbStudioRouter's job-tracked ingest mutations
--     (ingestDocumentJob/ingestUrlJob) — insert 'running' BEFORE calling E3-1's
--     ingestDocument/E3-3's ingestUrl, then update to 'succeeded'/'failed' after
--     (a throw from the ingest pipeline always lands on 'failed', never leaves a
--     row stuck at 'running' — see kbStudioRouter.ts's try/catch wrapper).
--
-- NEITHER table has a DB-level foreign key to the other or to
-- kb_studio_chunks.corpus — `corpus`/`name` stays a plain matched string (same
-- discipline as kb_studio_chunks.corpus itself), so a document ingested via
-- E3-1's raw kbIngestRouter (no registry row) is still stored/searchable; the
-- job-tracked ingest mutation auto-registers the corpus name into kb_corpora
-- (ON CONFLICT DO NOTHING, best-effort) rather than requiring pre-registration.
--
-- ADDITIVE + IDEMPOTENT (IF NOT EXISTS throughout) — safe to run more than once.
-- Server code fail-safes on pg error 42P01 ("relation does not exist") while
-- this migration is unapplied:
--   - READ paths (listCorpora/listJobs/corpusPreview) degrade to an empty/
--     tableAvailable:false result — never throw.
--   - The job-tracked ingest mutations degrade job-tracking to a no-op (no
--     kb_ingest_jobs row is written, jobId comes back null) but STILL perform
--     the actual ingest via E3-1's kbIngestService (unaffected by this table's
--     absence — kb_studio_chunks, migration 0304, is independent).
--   - WRITE paths that are explicitly ABOUT the registry (createCorpus,
--     deleteCorpus) surface a clear PRECONDITION_FAILED instead of a silent
--     no-op — same "don't report success for a write that didn't happen"
--     discipline as kbIngestService.ingestDocument's kb_studio_chunks check.
-- Gated additionally by KB_STUDIO_ENABLED (default OFF) at the ingest mutations
-- — this migration shipping unapplied changes no existing behaviour.
--
-- ADDITIVE. Run by owner `aoi` (DDL convention — do NOT run as a non-owner
-- role). This migration is NOT run as part of the implementation task — it
-- ships unapplied until an operator with the `aoi` role runs it.
-- ROLLBACK: DROP TABLE "kb_ingest_jobs"; DROP TABLE "kb_corpora";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "kb_corpora" (
  "id" serial PRIMARY KEY,
  "name" varchar(120) NOT NULL UNIQUE,
  "description" text,
  "createdBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "kb_ingest_jobs" (
  "id" serial PRIMARY KEY,
  "corpus" varchar(120) NOT NULL,
  "sourceType" varchar(20) NOT NULL,
  "sourceRef" varchar(500) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "chunksAdded" integer,
  "error" text,
  "createdBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "finishedAt" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_kb_ingest_jobs_corpus" ON "kb_ingest_jobs" ("corpus");
CREATE INDEX IF NOT EXISTS "idx_kb_ingest_jobs_status" ON "kb_ingest_jobs" ("status");
CREATE INDEX IF NOT EXISTS "idx_kb_ingest_jobs_created" ON "kb_ingest_jobs" ("createdAt");
