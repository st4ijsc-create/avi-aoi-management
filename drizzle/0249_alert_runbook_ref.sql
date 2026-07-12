-- W0-F G5.5 (doc 44) — runbook/recommendation pointers on the CENTRAL alert table.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: `predictive_alerts` là bảng alert TRUNG TÂM (mọi alert routeAlert →
-- predictive_alerts: PdM, SPC-bridge W5-A doc 35, quality-gate, SLO burn-rate
-- doc 37/38). Alert hiện không trỏ được tới runbook/SOP hay khuyến nghị hành
-- động — người trực nhận alert phải tự tìm tài liệu.
--
-- Thêm 2 cột nullable:
--   • runbook_ref        text — đường dẫn/id runbook (vd. SloTarget.runbook).
--   • recommendation_ref text — id/đường dẫn bản khuyến nghị hành động.
-- Chỉ ghi khi nơi phát alert THẬT SỰ có sẵn tham chiếu (SLO burn-rate mang
-- runbook từ catalogue); không bịa giá trị.
--
-- ADDITIVE + IDEMPOTENT: ADD COLUMN IF NOT EXISTS, không default, không NOT NULL,
-- không backfill. Trơ với code cũ (INSERT không nêu cột → NULL).
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0249 (0245 = calendar_day_shifts; 0246-0248 dành cho batch song song).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "predictive_alerts" ADD COLUMN IF NOT EXISTS "runbook_ref" text;
ALTER TABLE "predictive_alerts" ADD COLUMN IF NOT EXISTS "recommendation_ref" text;
