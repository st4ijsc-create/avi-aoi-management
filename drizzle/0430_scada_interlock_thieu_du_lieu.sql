-- SCADA R0 Task 9 (2026-10-23, K3/D2/D11) — `interlock_rules."khiThieuDuLieu"`: luật interlock làm gì khi KHÔNG có dữ liệu để đánh giá.
-- Trước đây `compare()` trả false khi quan sát null ⇒ cổng CHO QUA lệnh khi thiếu telemetry (fail-open). Quyết định chủ dự án D2: thiếu /
-- xấu / không chắc / cũ / mơ hồ ⇒ CHẶN (fail-closed).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0430.mjs --test-only|--dev-only|--both`.
--    DEV chỉ sau khi phiên điều phối duyệt SQL + nhận số đếm luật (xem brief Task 9).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- 'chan'     (mặc định, mọi luật hiện có): thiếu dữ liệu ⇒ cổng inline CHẶN lệnh.
-- 'cho_qua'  : thiếu dữ liệu ⇒ cổng bỏ qua luật đó (chủ luật chủ động chấp nhận). KHÔNG backfill: luật cũ nhận 'chan'. KHÔNG FUNCTION/TRIGGER.

ALTER TABLE public.interlock_rules ADD COLUMN IF NOT EXISTS "khiThieuDuLieu" varchar(8) NOT NULL DEFAULT 'chan';
ALTER TABLE public.interlock_rules DROP CONSTRAINT IF EXISTS interlock_rules_khi_thieu_du_lieu_chk;
ALTER TABLE public.interlock_rules ADD CONSTRAINT interlock_rules_khi_thieu_du_lieu_chk CHECK ("khiThieuDuLieu" IN ('chan','cho_qua'));
