-- doc 44 W5-B1 (gap G4.12) — TRAINED NTF / false-call classifier registry.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh (audit T4): ntfPredictorService tự khai "HONEST HEURISTIC v1 — NOT A
-- TRAINED MODEL" (blend 3 tín hiệu tay). Bảng này lưu một CLASSIFIER thật (head
-- multinomial-logistic thuần TS, tái dùng embeddingHeadTrainer) học từ verdict
-- người (product_inspections đã review + measurement_corrections). Artifact
-- (weights + vocab + standardization + temperature) lưu INLINE trong "artifact"
-- (JSON) → phiên bản tự chứa, bất biến, không cần fs.
--
-- DEDICATED table (KHÔNG dùng ai_models/model_versions): NTF classifier là model
-- BẢNG SỐ trên nhãn người, khác hẳn model ảnh/embedding trong registry thị giác
-- — tách ra để không nhiễu UI/A-B/drift của registry đó.
--
-- LIFECYCLE append-only: retrain = INSERT hàng mới 'candidate'; chỉ lên 'active'
-- khi metric TEST độc lập THẮNG baseline heuristic (quality gate). Kích hoạt 1
-- hàng ⇒ 'retired' hàng active cũ (ntfClassifierService, có tx). Cờ
-- NTF_CLASSIFIER_ENABLED OFF ⇒ ntfPredictorService giữ nguyên heuristic (không đọc
-- bảng này). Idempotent (IF NOT EXISTS). Additive — không đụng bảng hiện có.
-- Numbered 0263 (0262 = model_stage; 0265 = rul_failure_mode batch song song).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "ntf_classifier_models" (
  "id"                serial PRIMARY KEY,
  "version"           varchar(50) NOT NULL,
  "status"            varchar(20) NOT NULL DEFAULT 'candidate',
  "featureSchema"     varchar(32) NOT NULL,
  "classLabels"       jsonb NOT NULL,
  "featureNames"      jsonb NOT NULL,
  "artifact"          jsonb NOT NULL,
  "datasetChecksum"   varchar(64) NOT NULL,
  "sampleCount"       integer NOT NULL DEFAULT 0,
  "trainCount"        integer NOT NULL DEFAULT 0,
  "valCount"          integer NOT NULL DEFAULT 0,
  "testCount"         integer NOT NULL DEFAULT 0,
  "labelDistribution" jsonb,
  "metrics"           jsonb,
  "valMetrics"        jsonb,
  "baselineMetrics"   jsonb,
  "gate"              jsonb,
  "classBalance"      jsonb,
  "machineId"         integer,
  "productModelId"    integer,
  "notes"             text,
  "createdBy"         integer,
  "activatedAt"       timestamp,
  "createdAt"         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_ntf_clf_status"   ON "ntf_classifier_models" ("status");
CREATE INDEX IF NOT EXISTS "idx_ntf_clf_created"  ON "ntf_classifier_models" ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_ntf_clf_checksum" ON "ntf_classifier_models" ("datasetChecksum");

-- Belt-and-suspenders: at most ONE active model per scope (global scope = machineId
-- NULL → COALESCE to -1 so NULLs are de-duplicated). Application also retires the
-- prior active in the same transaction on activate.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ntf_clf_active_scope"
  ON "ntf_classifier_models" (COALESCE("machineId", -1))
  WHERE "status" = 'active';
