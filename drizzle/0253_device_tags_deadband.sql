-- doc 44 W2-A3 / G1.4 — deadband + sampling per-tag trên device_tags.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: đường subscribe của OT driver là poll thuần theo pollIntervalMs của
-- ADAPTER (mặc định 5000ms) — mọi sample của mọi tag đều forward xuống telemetry
-- bus mỗi tick, không có report-by-exception per-tag (LDS-L1 §A.2 / §5.1).
--
-- Migration này thêm 2 cột NULLABLE (additive — mọi row cũ giữ nguyên, code cũ
-- không đổi hành vi; chỉ được otManager đánh giá khi OT_TAG_DEADBAND_ENABLED):
--   • "deadband"   double precision — numeric sample chỉ forward khi
--     |value − lastForwarded| ≥ deadband. NULL = không lọc theo deadband.
--   • "samplingMs" integer          — chỉ forward khi đã qua samplingMs kể từ lần
--     forward trước của tag đó. NULL = không throttle.
-- Liveness: heartbeat 60s (env DEADBAND_HEARTBEAT_MS) + LUÔN forward khi giá trị
-- đầu tiên / quality đổi / kiểu không phải number (xem otManager.ts).
--
-- ADDITIVE + IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0253 (doc 44 W2-A3; 0251/0252 thuộc batch song song khác).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "device_tags" ADD COLUMN IF NOT EXISTS "deadband" double precision;
ALTER TABLE "device_tags" ADD COLUMN IF NOT EXISTS "samplingMs" integer;
