-- doc 44 W0-D / G1.7 — correlation id + per-command deadline on the command ledger.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: command_log (sổ cái append-only của commandDispatcher) chưa mang
-- correlation id xuyên tầng (order → work-order → command → ack, LDS-L1) và chưa
-- lưu deadline riêng của từng lệnh (mọi lệnh dùng chung OT_CONTROL_TIMEOUT_MS).
--
-- Migration này thêm 2 cột NULLABLE (additive — mọi row cũ giữ nguyên, code cũ
-- không đổi hành vi):
--   • "correlation_id" text    — id truy vết xuyên tầng; điền từ
--     DispatchInput.correlationId, fallback AsyncLocalStorage backbone
--     (server/services/observability/correlation.ts), else NULL.
--   • "deadline_ms"    integer — deadline ack (ms) caller yêu cầu cho LỆNH NÀY;
--     NULL = dùng timeout env toàn cục như trước.
--
-- ADDITIVE + IDEMPOTENT: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0246 (0245 = calendar_day_shifts).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "command_log" ADD COLUMN IF NOT EXISTS "correlation_id" text;
ALTER TABLE "command_log" ADD COLUMN IF NOT EXISTS "deadline_ms" integer;

-- G1.7/G1.16 — trace lookups + đo cmd→ack latency theo correlation id. Partial
-- (bỏ NULL) để index nhỏ: đa số row lịch sử không có correlation id.
CREATE INDEX IF NOT EXISTS "idx_command_log_correlation"
  ON "command_log" ("correlation_id")
  WHERE "correlation_id" IS NOT NULL;
