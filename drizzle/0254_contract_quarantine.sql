-- doc 44 Batch W2-B2 (gap G2.6) — quarantine store for contract-INVALID inbound messages.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: W0-E (mig 0248) đã persist registry contract_schemas + seam
-- validateMessage(subject, payload) nhưng CHƯA enforce ở ingest. Batch này bật
-- enforcement theo env CONTRACT_VALIDATE_INGEST_MODE (off|log|quarantine,
-- default OFF): ở mode "quarantine", message vi phạm contract bị CHẶN khỏi
-- pipeline và ghi vào bảng này để người vận hành review / discard / replay
-- (server/services/contracts/ingestValidation.ts + contractsRouter).
--
--   • payload jsonb — CAP 64KB: payload serialize >64KB được thay bằng wrapper
--     { truncated: true, sizeBytes, preview } (không bao giờ ghi payload khổng lồ).
--   • errors jsonb — mảng string lỗi từ jsonSchemaValidator (cap 50 dòng).
--   • status: quarantined → reviewed | replayed | discarded (text thuần, không
--     pg enum — mirrors 0248/ncr reasoning để migration chỉ là IF NOT EXISTS).
--   • Retention: sweep xoá row cũ hơn CONTRACT_QUARANTINE_RETENTION_DAYS
--     (default 30; <=0 tắt) — timer chỉ chạy khi mode != off.
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS, không FK (soft-ref
-- reviewed_by → users.id theo convention). Trơ hoàn toàn khi
-- CONTRACT_VALIDATE_INGEST_MODE=off (default).
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0254 (0253 = device_tags_deadband; 0255 = genealogy_correlation).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "contract_quarantine" (
  "id"          serial PRIMARY KEY NOT NULL,
  "subject"     text NOT NULL,
  "source"      text NOT NULL,
  "payload"     jsonb NOT NULL,
  "errors"      jsonb NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL,
  "status"      text DEFAULT 'quarantined' NOT NULL,
  "reviewed_by" integer,
  "reviewed_at" timestamp
);

-- Tra cứu theo subject + thời gian (màn review) và retention sweep (received_at).
CREATE INDEX IF NOT EXISTS "idx_contract_quarantine_subject_received"
  ON "contract_quarantine" ("subject", "received_at");
CREATE INDEX IF NOT EXISTS "idx_contract_quarantine_status"
  ON "contract_quarantine" ("status");
