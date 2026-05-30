-- ============================================================================
-- WS-3 Vector Search ảnh NG tương tự
-- Migration: image embeddings → pgvector vector(1024) + HNSW (cosine) index
--
-- IDEMPOTENT: an toàn khi chạy lại nhiều lần (IF NOT EXISTS / DO ... EXCEPTION).
-- BACKWARD-COMPATIBLE: chỉ THÊM cột nullable + index; cột "embedding" TEXT cũ
-- vẫn giữ nguyên làm nguồn raw/back-compat.
--
-- Nếu pgvector KHÔNG được cài trên Postgres (không có quyền owner để CREATE
-- EXTENSION, hoặc package không có), toàn bộ migration sẽ KHÔNG làm hỏng DB:
-- mỗi bước gói trong DO/EXCEPTION và chỉ cảnh báo (RAISE NOTICE) rồi bỏ qua.
-- Service phía Node tự fallback sang cast runtime → brute-force → metadata.
--
-- Lưu ý không gian vector: chỉ migrate/index các dòng có embeddingDim = 1024
-- (mxbai-embed-large, đã L2-normalize) — tránh trộn vector khác chiều.
-- ============================================================================

-- 1) Enable pgvector (an toàn gọi nhiều lần). Bọc trong DO để không 500 khi
--    thiếu quyền hoặc package vector không tồn tại trên server.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'WS-3: khong the CREATE EXTENSION vector (% ). Bo qua; Node se fallback brute-force/metadata.', SQLERRM;
END $$;

-- 2) Thêm cột vector(1024) nếu pgvector có sẵn. Nếu không có type "vector",
--    ALTER sẽ ném lỗi → nuốt trong EXCEPTION, cột vẫn không tồn tại và Node
--    fallback dùng cột TEXT "embedding".
DO $$
BEGIN
  ALTER TABLE ai_image_embeddings ADD COLUMN IF NOT EXISTS embedding_vec vector(1024);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'WS-3: khong the ADD COLUMN embedding_vec (% ). pgvector chua san sang.', SQLERRM;
END $$;

-- 3) Backfill từ cột TEXT "embedding" sang embedding_vec cho các dòng 1024-dim.
--    Chỉ chạy nếu cột embedding_vec đã tồn tại. Bọc EXCEPTION để 1 dòng hỏng
--    không làm fail toàn bộ migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_image_embeddings' AND column_name = 'embedding_vec'
  ) THEN
    UPDATE ai_image_embeddings
    SET embedding_vec = embedding::vector(1024)
    WHERE embedding_vec IS NULL
      AND "embeddingDim" = 1024
      AND embedding IS NOT NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'WS-3: backfill embedding_vec gap loi (% ). Bo qua; co the backfill lai bang script.', SQLERRM;
END $$;

-- 4) HNSW index (vector_cosine_ops, embedding đã L2-normalize) — build SAU backfill.
--    Chỉ tạo nếu cột tồn tại. Bọc EXCEPTION (vd thiếu RAM build, thiếu access method hnsw).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_image_embeddings' AND column_name = 'embedding_vec'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_image_emb_vec_hnsw
      ON ai_image_embeddings
      USING hnsw (embedding_vec vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'WS-3: khong the tao HNSW index (% ). Co the build lai sau khi backfill.', SQLERRM;
END $$;
