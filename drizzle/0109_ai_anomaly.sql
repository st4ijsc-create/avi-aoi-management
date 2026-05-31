-- ============================================================================
-- B3 — Unsupervised anomaly detection (PatchCore-style memory bank)
--
-- Tạo 2 bảng:
--   • ai_anomaly_memory_bank  — embedding ảnh OK (coreset) theo scope.
--   • ai_anomaly_profiles     — threshold(p99) + stats + cờ degrade theo scope.
--
-- IDEMPOTENT: an toàn chạy lại (IF NOT EXISTS / DO ... EXCEPTION).
-- BACKWARD-COMPATIBLE: chỉ THÊM bảng mới; không đụng schema cũ.
--
-- pgvector OPTIONAL: cột embedding_vec vector(1024) + HNSW bọc trong DO/EXCEPTION.
-- Nếu pgvector KHÔNG có (thiếu quyền/extension), migration KHÔNG fail — Node tự
-- degrade brute-force JS trên cột embedding TEXT.
-- ============================================================================

-- 1) Bảng memory bank (cột embedding TEXT là nguồn raw/back-compat — luôn có).
CREATE TABLE IF NOT EXISTS "ai_anomaly_memory_bank" (
  "id" serial PRIMARY KEY NOT NULL,
  "productModelId" integer,
  "machineId" integer,
  "modelCode" varchar(120) NOT NULL,
  "embedding" text NOT NULL,
  "embeddingDim" integer NOT NULL,
  "source" varchar(32) NOT NULL,
  "imageUrl" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_anomaly_bank_scope" ON "ai_anomaly_memory_bank" ("productModelId", "machineId", "modelCode");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_anomaly_bank_product" ON "ai_anomaly_memory_bank" ("productModelId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_anomaly_bank_machine" ON "ai_anomaly_memory_bank" ("machineId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_anomaly_bank_created" ON "ai_anomaly_memory_bank" ("createdAt");
--> statement-breakpoint

-- 2) Bảng profile (threshold/stats/cờ degrade), unique theo scope.
CREATE TABLE IF NOT EXISTS "ai_anomaly_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "productModelId" integer,
  "machineId" integer,
  "modelCode" varchar(120) NOT NULL,
  "threshold" numeric(12, 8) NOT NULL,
  "k" integer DEFAULT 5 NOT NULL,
  "distStats" json,
  "bankSize" integer DEFAULT 0 NOT NULL,
  "source" varchar(32) NOT NULL,
  "degraded" boolean DEFAULT false NOT NULL,
  "builtAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Unique scope. COALESCE để (NULL,NULL,code) cũng unique đúng (NULL != NULL trong unique index thường).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_anomaly_profile_scope"
  ON "ai_anomaly_profiles" (COALESCE("productModelId", -1), COALESCE("machineId", -1), "modelCode");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_anomaly_profile_product" ON "ai_anomaly_profiles" ("productModelId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_anomaly_profile_machine" ON "ai_anomaly_profiles" ("machineId");
--> statement-breakpoint

-- 3) pgvector optional: thêm cột embedding_vec vector(1024). Bọc EXCEPTION.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'B3: khong the CREATE EXTENSION vector (% ). Bo qua; Node degrade brute-force JS.', SQLERRM;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE ai_anomaly_memory_bank ADD COLUMN IF NOT EXISTS embedding_vec vector(1024);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'B3: khong the ADD COLUMN embedding_vec (% ). pgvector chua san sang.', SQLERRM;
END $$;
--> statement-breakpoint

-- 4) HNSW index (vector_cosine_ops — embedding đã L2-normalize). Bọc EXCEPTION.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_anomaly_memory_bank' AND column_name = 'embedding_vec'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_anomaly_bank_vec_hnsw
      ON ai_anomaly_memory_bank
      USING hnsw (embedding_vec vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'B3: khong the tao HNSW index (% ). Bo qua; degrade brute-force JS.', SQLERRM;
END $$;
