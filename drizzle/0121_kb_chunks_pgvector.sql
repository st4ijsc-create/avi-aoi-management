-- ============================================================================
-- Phase 4 WS4.1 — Knowledge Base chunks + pgvector (production RAG store).
-- IDEMPOTENT & guarded: if pgvector is unavailable, the table still works with
-- the TEXT `embedding` column (Node brute-force fallback). Mirrors 0091.
-- ============================================================================

CREATE TABLE IF NOT EXISTS kb_chunks (
  "id" serial PRIMARY KEY,
  "docId" varchar(255) NOT NULL,
  "chunkIndex" integer NOT NULL,
  "content" text NOT NULL,
  "embedding" text,
  "embeddingDim" integer,
  "metadata" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_kb_chunks_doc_chunk" UNIQUE ("docId","chunkIndex")
);
CREATE INDEX IF NOT EXISTS "idx_kb_chunks_doc" ON kb_chunks ("docId");

-- pgvector column (guarded).
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'KB: cannot CREATE EXTENSION vector (%). Node will fall back to brute-force.', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(1024);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'KB: cannot ADD COLUMN embedding_vec (%). pgvector not ready.', SQLERRM;
END $$;

-- HNSW cosine index (built only if the column exists).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kb_chunks' AND column_name = 'embedding_vec'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_vec_hnsw
      ON kb_chunks USING hnsw (embedding_vec vector_cosine_ops) WITH (m = 16, ef_construction = 64);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'KB: cannot build HNSW index (%). Skipping.', SQLERRM;
END $$;
