-- ★★★ Đợt 11.3-C (2026-10-31) — CỔNG DUYỆT KẾ HOẠCH của lượt agent (UX-D02), sổ `ai_agent_runs`.
--
-- ⚠⚠ DDL ⇒ PHẢI CHẠY BẰNG OWNER `aoi` (`node scripts/apply-migration-0444.mjs --test-only | --dev-only | --both`). DEV chỉ sau khi
--    dieu-phoi duyệt SQL (đã duyệt 2026-10-31). Idempotent.
--
-- Lượt agent (chế độ sua/tu-dong, cờ AI_AGENT_CONG_KE_HOACH) dừng TRƯỚC tool ghi/lệnh đầu tiên cho tới khi NGƯỜI duyệt kế hoạch (todo_write).
-- Cột chỉ do máy chủ ghi. Một kế hoạch hiệu lực mỗi lượt; lịch sử duyệt/đổi/duyệt lại nằm ở sự kiện của lượt.
--   keHoachBam       : SHA-256 hex của danh sách bước đã chuẩn hoá (hàm dùng chung shared/agentCore/keHoach.ts) — máy chủ tự tính, không tin client.
--   keHoachViec      : danh sách bước đang chờ/đã duyệt (chữ thuần, đã cắt trần) để mở lại màn vẫn thấy.
--   keHoachTrangThai : cho | duyet | bac | het-gio.
--   keHoachDuyetBoi  : ai bấm. FK ON DELETE SET NULL (xoá user không mất lượt) ⇒ KHÔNG đặt NOT NULL trong CHECK (sẽ chặn xoá user);
--                      máy chủ luôn điền khi duyệt (kiểm ở mã + test).

ALTER TABLE public.ai_agent_runs
  ADD COLUMN IF NOT EXISTS "keHoachBam" varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS "keHoachViec" jsonb NULL,
  ADD COLUMN IF NOT EXISTS "keHoachTrangThai" varchar(12) NULL,
  ADD COLUMN IF NOT EXISTS "keHoachNopLuc" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "keHoachDuyetLuc" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "keHoachDuyetBoi" integer NULL REFERENCES public.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_runs_ke_hoach_tt_chk') THEN
    ALTER TABLE public.ai_agent_runs ADD CONSTRAINT ai_agent_runs_ke_hoach_tt_chk
      CHECK ("keHoachTrangThai" IS NULL OR "keHoachTrangThai" IN ('cho','duyet','bac','het-gio'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_runs_ke_hoach_viec_chk') THEN
    ALTER TABLE public.ai_agent_runs ADD CONSTRAINT ai_agent_runs_ke_hoach_viec_chk
      CHECK ("keHoachViec" IS NULL OR jsonb_typeof("keHoachViec") = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_runs_ke_hoach_duyet_chk') THEN
    ALTER TABLE public.ai_agent_runs ADD CONSTRAINT ai_agent_runs_ke_hoach_duyet_chk
      CHECK ("keHoachTrangThai" IS DISTINCT FROM 'duyet' OR ("keHoachBam" IS NOT NULL AND "keHoachDuyetLuc" IS NOT NULL));
  END IF;
END $$;
