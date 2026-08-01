-- ============================================================================
-- Migration 0159: AOI-C — embedding-head dataset versioning (doc 24 Wave-3)
--
-- Adds ONE table, ai_embedding_datasets, holding IMMUTABLE, content-addressed
-- snapshots of the (embedding, label) pairs used to train a lightweight defect
-- classifier HEAD over frozen DINOv2 image embeddings
-- (server/services/ai/embeddingHeadTrainer.ts). Behind flag AOI_DL_HEAD_ENABLED
-- (default OFF). Additive + idempotent.
--
--   • Vectors are stored INLINE in `samples` (jsonb) → the version is fully
--     self-contained + reproducible (never re-reads ai_image_embeddings).
--   • `checksum` (sha256 over canonical sample content) is the reproducibility /
--     immutability proof — the service NEVER UPDATEs a row (append-only). A new
--     label set = a NEW version.
--   • The trained ARTIFACT + A/B + drift + rollback all reuse the EXISTING model
--     registry (ai_models / model_versions / ab_test_experiments /
--     model_performance_snapshots / model_rollback_events) — this table only
--     versions the DATA, no registry fork.
--
-- TENANT SCOPE: corporateCode (varchar) + factoryId (int) mirror 0150 aiLoop.
-- RLS uses the shared inert-by-default app_tenant_allows() helper on corporateCode
-- — a complete no-op unless TENANT_RLS_ENABLED sets the session GUC.
-- Re-runnable (CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS).
-- ============================================================================

-- ── Ensure the inert-by-default tenant helper exists (mirrors 0150) ──
CREATE OR REPLACE FUNCTION app_tenant_allows(p_factory text, p_corporate text)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_rls_active', true), 'off') <> 'on'   -- inert unless activated
      OR coalesce(current_setting('app.tenant_bypass',     true), 'off') =  'on'   -- admin/service bypass
      OR (p_factory   IS NOT NULL AND p_factory   = ANY (string_to_array(coalesce(current_setting('app.tenant_factory_codes',   true), ''), ',')))
      OR (p_corporate IS NOT NULL AND p_corporate = ANY (string_to_array(coalesce(current_setting('app.tenant_corporate_codes', true), ''), ',')))
$$;

CREATE TABLE IF NOT EXISTS "ai_embedding_datasets" (
  "id"                serial PRIMARY KEY,
  "name"              varchar(255) NOT NULL,
  "description"       text,
  "modelId"           integer,
  "productModelId"    integer,
  "machineId"         integer,
  "classLabels"       jsonb        NOT NULL,
  "labelDistribution" jsonb        NOT NULL,
  "sampleCount"       integer      NOT NULL DEFAULT 0,
  "inputDim"          integer      NOT NULL DEFAULT 0,
  "splitSeed"         integer      NOT NULL DEFAULT 1337,
  "splitConfig"       jsonb,
  "checksum"          varchar(64)  NOT NULL,
  "samples"           jsonb        NOT NULL,
  "dropped"           jsonb,
  "source"            varchar(64)  NOT NULL DEFAULT 'ai_image_embeddings+label_queue',
  "corporateCode"     varchar(50),
  "factoryId"         integer,
  "createdBy"         integer,
  "createdAt"         timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_emb_dataset_model"    ON "ai_embedding_datasets" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_emb_dataset_checksum" ON "ai_embedding_datasets" ("checksum");
CREATE INDEX IF NOT EXISTS "idx_emb_dataset_created"  ON "ai_embedding_datasets" ("createdAt");

-- ── RLS — inert-by-default (mirrors 0150). corporateCode is the predicate column. ──
ALTER TABLE "ai_embedding_datasets" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "ai_embedding_datasets";
CREATE POLICY tenant_select ON "ai_embedding_datasets" FOR SELECT
  USING (app_tenant_allows(NULL, "corporateCode"));
DROP POLICY IF EXISTS tenant_modify ON "ai_embedding_datasets";
CREATE POLICY tenant_modify ON "ai_embedding_datasets" FOR ALL
  USING (app_tenant_allows(NULL, "corporateCode"))
  WITH CHECK (app_tenant_allows(NULL, "corporateCode"));
