-- doc 44 W6-4 (gap G5.20) — DORA deployment log (deployment frequency / lead time /
-- change-failure rate / MTTR feed).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: doraService ghi 1 row cho mỗi lần triển khai (CI/CD hook hoặc API thủ
-- công) rồi tính 4 chỉ số DORA trên cửa sổ trượt. Bảng này là NGUỒN SỰ THẬT của
-- deployment-frequency/lead-time/change-failure/MTTR.
--
--   status:      success | failed | rolled_back
--   lead_time_ms: độ trễ commit → deploy (nullable — CI có thể không cung cấp)
--
-- TÙY CHỌN + FAIL-OPEN: doraService đọc/ghi bằng RAW SQL bọc try/catch — nếu bảng
-- CHƯA áp migration, ghi event no-op và metric trả "no_data" (không bịa số). Cờ
-- DORA_ENABLED (mặc định OFF) chặn đường GHI; đọc luôn an toàn. ADDITIVE + IDEMPOTENT.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS deployment_events (
  id            serial PRIMARY KEY,
  version       varchar(128),
  commit_sha    varchar(64),
  environment   varchar(64)  NOT NULL DEFAULT 'production',
  service       varchar(128),
  status        varchar(24)  NOT NULL DEFAULT 'success',
  deployed_by   varchar(256),
  deployed_at   timestamptz  NOT NULL DEFAULT now(),
  lead_time_ms  bigint,
  meta          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- Metric windows scan by (environment, deployed_at); MTTR pairs failures→successes per env.
CREATE INDEX IF NOT EXISTS idx_deployment_events_env_time ON deployment_events (environment, deployed_at);
CREATE INDEX IF NOT EXISTS idx_deployment_events_status ON deployment_events (status);
CREATE INDEX IF NOT EXISTS idx_deployment_events_time ON deployment_events (deployed_at);
