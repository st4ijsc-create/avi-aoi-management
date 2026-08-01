-- doc 44 W5-B2 (gap G4.17) — cache tương quan ĐỊNH LƯỢNG defect ⇄ tham số công đoạn trước.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: defectCorrelationService.correlateStationDefect() tính Pearson/point-
-- biserial + p-value + hồi quy logistic đơn biến trên process_results.metrics theo
-- genealogy — nhiều truy vấn + thống kê. Bảng này CACHE kết quả top-k theo chữ ký
-- (machine_id, defect_type, window_days) với TTL (RCA_QUANT_CACHE_TTL_MS, mặc định 6h).
--
-- TÙY CHỌN + FAIL-OPEN: service đọc/ghi bằng RAW SQL bọc try/catch — nếu bảng CHƯA
-- áp migration, correlateStationDefect vẫn chạy (chỉ không cache). ADDITIVE + IDEMPOTENT.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS defect_correlation_cache (
  id           serial PRIMARY KEY,
  signature    varchar(256) NOT NULL,
  machine_id   integer,
  defect_type  varchar(256),
  window_days  integer NOT NULL,
  total_units  integer NOT NULL DEFAULT 0,
  defect_units integer NOT NULL DEFAULT 0,
  factors      jsonb   NOT NULL DEFAULT '[]'::jsonb,
  notes        jsonb   NOT NULL DEFAULT '[]'::jsonb,
  computed_at  timestamp NOT NULL DEFAULT now()
);

-- One cached row per correlation signature (ON CONFLICT (signature) DO UPDATE upsert).
CREATE UNIQUE INDEX IF NOT EXISTS uq_defect_corr_cache_sig ON defect_correlation_cache (signature);
-- TTL sweep / freshness lookups scan by computed_at.
CREATE INDEX IF NOT EXISTS idx_defect_corr_cache_computed ON defect_correlation_cache (computed_at);
CREATE INDEX IF NOT EXISTS idx_defect_corr_cache_machine ON defect_correlation_cache (machine_id);
