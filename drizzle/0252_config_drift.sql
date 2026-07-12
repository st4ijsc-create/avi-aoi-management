-- doc 44 Batch W2-A2 (gap G1.11) — config-drift snapshots (SYNAPSE Tầng-1 §6.4).
--
-- ════════════════════════════════════════════════════════════════════════════
-- "Kiểm soát trôi cấu hình": so khớp cấu hình ĐANG CHẠY của một entity kết nối
-- (device_adapter + tập device_tags của nó) với bản ĐÃ DUYỆT; cảnh báo khi lệch.
-- Một hàng cho mỗi (entity_type, entity_id):
--   config_hash     sha256 của cấu hình hiện tại — SECRET ĐÃ LOẠI trước khi băm
--                   (password/token/credential trong connectionOptions + userinfo
--                   trong endpoint — xem configDriftService.redactSecrets).
--   approved_hash   hash lúc duyệt (NULL = chưa duyệt).
--   status          'unapproved' | 'in_sync' | 'drift' (text app-validated —
--                   repo convention, no pg enum, mirrors 0226/0248 reasoning).
--   payload_summary tóm tắt KHÔNG-secret (adapterCode/protocol/tagCount) — KHÔNG
--                   bao giờ chứa connection password/secret.
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS, không FK (soft ref
-- entity_id → device_adapters.id để sweep không khoá đường ingest), không ALTER.
-- Trơ cho tới khi CONFIG_DRIFT_ENABLED=true (default OFF).
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0252 (0251 = asset_urn_lifecycle của cùng batch W2-A2).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "config_snapshots" (
  "id"                serial PRIMARY KEY NOT NULL,
  "entity_type"       text NOT NULL,
  "entity_id"         integer NOT NULL,
  "config_hash"       text NOT NULL,
  "approved_hash"     text,
  "approved_by"       integer,
  "approved_at"       timestamp,
  "drift_detected_at" timestamp,
  "status"            text DEFAULT 'unapproved' NOT NULL,
  "payload_summary"   jsonb,
  "created_at"        timestamp DEFAULT now() NOT NULL,
  "updated_at"        timestamp DEFAULT now() NOT NULL
);

-- Một entity chỉ có 1 snapshot hiện hành — service upsert theo cặp này.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_config_snapshots_entity"
  ON "config_snapshots" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_config_snapshots_status"
  ON "config_snapshots" ("status");
