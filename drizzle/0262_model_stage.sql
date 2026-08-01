-- doc 44 W5-A4 (gap G4.24) — Model-Registry STAGE lifecycle on model_versions.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh (audit T4): model_versions chỉ có status ACTIVE/INACTIVE/READY —
-- KHÔNG có giai đoạn staging/shadow/canary/production/retired mà SYNAPSE LDS-L4
-- §11.1 (vòng đời MLOps) + §3.2 (Model Registry: staging/production/retired) yêu
-- cầu. Không có stage ⇒ không có cổng shadow-N-ngày / canary / 2-người-duyệt.
--
-- Thêm 5 cột nullable (ModelCard §12.2: stage/owner/trained_on + sổ chuyển giai
-- đoạn):
--   • stage           text  — staging|shadow|canary|production|retired.
--                             NULL = phiên bản LEGACY (chưa gắn stage); projection
--                             tường minh: status=ACTIVE ⇔ stage=production.
--   • stage_history    jsonb — sổ APPEND-ONLY mọi lần chuyển giai đoạn
--                             [{from,to,at,actor,approver,via,reason}].
--   • stage_entered_at timestamp — mốc vào stage hiện tại (đo cổng shadow ≥ N giờ).
--   • owner            varchar(255) — ModelCard.owner (đội sở hữu mô hình).
--   • trained_on       text  — ModelCard.trained_on (khoảng dữ liệu huấn luyện).
--
-- ADDITIVE + IDEMPOTENT: ADD COLUMN IF NOT EXISTS, không default, không NOT NULL,
-- không backfill. Trơ với code cũ (INSERT không nêu cột → NULL = legacy). Pipeline
-- (server/services/ai/modelStagePipeline.ts) chỉ đọc/ghi khi cờ
-- MODEL_STAGE_PIPELINE_ENABLED bật; OFF ⇒ activateModelVersion nguyên vẹn.
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0262 (0260 = twin_fidelity; 0261 dành cho batch song song).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "model_versions" ADD COLUMN IF NOT EXISTS "stage" text;
ALTER TABLE "model_versions" ADD COLUMN IF NOT EXISTS "stage_history" jsonb;
ALTER TABLE "model_versions" ADD COLUMN IF NOT EXISTS "stage_entered_at" timestamp;
ALTER TABLE "model_versions" ADD COLUMN IF NOT EXISTS "owner" varchar(255);
ALTER TABLE "model_versions" ADD COLUMN IF NOT EXISTS "trained_on" text;

-- Partial index: chỉ các hàng ĐÃ gắn stage (bỏ qua legacy NULL) — tra "phiên bản
-- nào đang ở stage nào cho model X" cho pipeline + dashboard.
CREATE INDEX IF NOT EXISTS "idx_model_versions_stage"
  ON "model_versions" ("modelId", "stage")
  WHERE "stage" IS NOT NULL;
