-- ============================================================================
-- Migration 0304: kb_studio_chunks — multi-corpus pgvector chunk store for the
-- Knowledge & Training Studio doc-ingest pipeline (doc69 Giai đoạn 5 / Wave E3, task
-- E3-1: server/services/kbDocParser.ts + kbIngestService.ts + kbVectorStore.ts).
--
-- NOT the same table as `kb_chunks` (migration 0121_kb_chunks_pgvector.sql,
-- drizzle/schema/kb.ts) — that table is the SINGLE-corpus pgvector mirror of the existing
-- file-based ops-KB (knowledge/chunks.jsonl, via server/services/kb/kbVectorStore.ts +
-- server/routers/kbVectorRouter.ts), unnamespaced. This is a SEPARATE, NEW table so
-- operator-uploaded documents (pdf/docx/md/txt, tagged with an arbitrary `corpus`
-- namespace) never mix into the existing ops-KB retrieval — `kb/kbVectorStore.ts`'s
-- `searchKb()` runs an UNFILTERED `SELECT ... FROM kb_chunks`, so sharing that table would
-- silently leak Studio content into ops-KB answers.
--
-- Mirrors ai_image_embeddings (0091_image_embeddings_pgvector.sql): base table with a TEXT
-- `embedding` column (JSON array, always present, Node brute-force fallback) created FIRST,
-- then the pgvector `embedding_vec` column added in its OWN guarded DO block, then the HNSW
-- (cosine) index — so a DB without the `vector` extension still gets a fully working table
-- (TEXT-only) instead of a failed CREATE TABLE. drizzle-kit cannot emit
-- `USING hnsw (... vector_cosine_ops)`, hence the manual index here.
--
-- IDEMPOTENT (IF NOT EXISTS / DO+EXCEPTION throughout) — safe to run more than once.
-- Server code fail-safes on pg error 42P01 ("relation does not exist") while this migration
-- is unapplied — every kbVectorStore.ts read/write degrades to empty/no-op rather than
-- throwing (same discipline as aiModelCardGate.ts's 42P01 catch). Gated additionally by
-- KB_STUDIO_ENABLED (default OFF) at the ingest service/endpoint — this migration shipping
-- unapplied changes no existing behaviour.
--
-- ADDITIVE. Run by owner `aoi` (DDL convention — do NOT run as a non-owner role). This
-- migration is NOT run as part of the implementation task — it ships unapplied until an
-- operator with the `aoi` role runs it.
-- ROLLBACK: DROP TABLE "kb_studio_chunks";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "kb_studio_chunks" (
  "id" serial PRIMARY KEY,
  "corpus" varchar(120) NOT NULL,
  "sourceType" varchar(20) NOT NULL,
  "sourceRef" varchar(500) NOT NULL,
  "chunkIndex" integer NOT NULL,
  "text" text NOT NULL,
  "embedding" text,
  "embeddingDim" integer,
  "tokenCount" integer,
  "createdBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "uq_kb_studio_chunks_corpus_source_chunk" UNIQUE ("corpus", "sourceRef", "chunkIndex")
);
CREATE INDEX IF NOT EXISTS "idx_kb_studio_chunks_corpus" ON "kb_studio_chunks" ("corpus");
CREATE INDEX IF NOT EXISTS "idx_kb_studio_chunks_source" ON "kb_studio_chunks" ("corpus", "sourceRef");

-- 1) Enable pgvector (safe to call repeatedly). Wrapped so a permission/package gap never
--    fails the migration — Node falls back to TEXT-embedding brute-force search.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'kb_studio_chunks: cannot CREATE EXTENSION vector (%). Node will fall back to brute-force.', SQLERRM;
END $$;

-- 2) pgvector column, added separately from the CREATE TABLE above so a missing "vector"
--    type never blocks the base TEXT-embedding table from existing.
DO $$ BEGIN
  ALTER TABLE "kb_studio_chunks" ADD COLUMN IF NOT EXISTS "embedding_vec" vector(1024);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'kb_studio_chunks: cannot ADD COLUMN embedding_vec (%). pgvector not ready.', SQLERRM;
END $$;

-- 3) HNSW cosine index — built only if the column exists (guards a partial/older run).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kb_studio_chunks' AND column_name = 'embedding_vec'
  ) THEN
    CREATE INDEX IF NOT EXISTS "idx_kb_studio_chunks_vec_hnsw"
      ON "kb_studio_chunks" USING hnsw (embedding_vec vector_cosine_ops) WITH (m = 16, ef_construction = 64);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'kb_studio_chunks: cannot build HNSW index (%). Skipping — can be built later after backfill.', SQLERRM;
END $$;
