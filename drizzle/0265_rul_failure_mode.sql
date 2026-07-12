-- doc 44 W5-B3 (gaps G4.7 software + G4.8 software) — RUL survival estimates +
-- failure-mode classification store.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SYNAPSE Tầng-4 §7.2:
--   • "Dự đoán RUL": khi CÓ đủ lịch sử hỏng hóc → ước tính tuổi thọ CÒN LẠI.
--     rul_estimates ghi mọi lần ước tính. method='weibull' khi fit survival
--     Weibull 2-tham-số trên ĐỦ quan sát hỏng thật (>= RUL_MIN_OBSERVATIONS,
--     default 5); method='heuristic' khi thiếu → FALLBACK trung thực (KHÔNG bịa
--     confidence). confidence suy TỪ SỐ QUAN SÁT hỏng thật.
--   • "Phân loại chế độ hỏng": failure_events ghi thời-điểm-hỏng + chế-độ-hỏng.
--     failure_mode='unknown' reason='no vibration sensor' khi KHÔNG có cảm biến
--     rung (hầu hết máy hiện tại) — KHÔNG đoán bừa. features = phổ tần/rung khi CÓ.
--
-- ADDITIVE + IDEMPOTENT (CREATE … IF NOT EXISTS). Không đụng bảng hiện có. Nguồn
-- dữ liệu hỏng cho survival fit ĐỌC từ bảng THẬT (maintenance_work_orders +
-- downtime_events); failure_events là sổ chuẩn tiến-về-trước (classifier ghi vào).
-- Maintained by server/services/ai/rulEstimatorService (cờ RUL_WEIBULL_ENABLED)
-- + server/services/ai/failureModeClassifier (cờ FAILURE_MODE_ENABLED), both OFF.
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0265 (0263/0264 dành cho batch song song).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "rul_estimates" (
  "id"            serial PRIMARY KEY,
  "machine_id"    integer NOT NULL,
  "machine_type"  text,
  "component_key" text NOT NULL DEFAULT 'machine',
  "method"        text NOT NULL,
  "rul_hours"     double precision,
  "age_hours"     double precision,
  "shape"         double precision,
  "scale"         double precision,
  "observations"  integer NOT NULL DEFAULT 0,
  "failures"      integer NOT NULL DEFAULT 0,
  "censored"      integer NOT NULL DEFAULT 0,
  "confidence"    double precision NOT NULL DEFAULT 0,
  "note"          text,
  "computed_at"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_rul_estimates_machine" ON "rul_estimates" ("machine_id", "computed_at");
CREATE INDEX IF NOT EXISTS "idx_rul_estimates_type" ON "rul_estimates" ("machine_type");

CREATE TABLE IF NOT EXISTS "failure_events" (
  "id"                  serial PRIMARY KEY,
  "machine_id"          integer NOT NULL,
  "machine_type"        text,
  "component_key"       text,
  "failure_mode"        text,
  "failure_mode_reason" text,
  "occurred_at"         timestamptz NOT NULL,
  "ttf_hours"           double precision,
  "censored"            boolean NOT NULL DEFAULT false,
  "source"              text NOT NULL,
  "source_id"           integer,
  "features"            jsonb,
  "confidence"          double precision,
  "created_at"          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_failure_events_machine" ON "failure_events" ("machine_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "idx_failure_events_type" ON "failure_events" ("machine_type");
CREATE INDEX IF NOT EXISTS "idx_failure_events_mode" ON "failure_events" ("failure_mode");
