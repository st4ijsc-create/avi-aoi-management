-- ★★★ Đợt 12 · H5.4 (2026-10-31) — LƯU LỊCH SỬ MODEL MỖI BƯỚC + TIẾP TỤC LƯỢT AGENT (bảng `ai_agent_run_lich_su`).
--
-- ⚠⚠ DDL ⇒ PHẢI CHẠY BẰNG OWNER `aoi` (`node scripts/apply-migration-0450.mjs --test-only | --dev-only | --both`). DEV chỉ sau khi
--    dieu-phoi duyệt SQL (đã duyệt 2026-10-31). Idempotent.
--
-- Mỗi lượt GỐC (cờ AI_AGENT_TIEP_TUC=1) giữ MỘT hàng: lịch sử hội thoại gửi model (bỏ system) ở ranh giới an toàn của vòng, để lượt gián đoạn
-- có thể "tiếp tục" thành lượt MỚI. Chỉ máy chủ ghi/đọc; không bao giờ nhận từ client. Nội dung đã che bí mật (hai lớp) nhưng vẫn là nội dung
-- người dùng/mã ⇒ cột "tinNhan" nằm trong danh sách ẩn TƯỜNG MINH của vai MCP chỉ-đọc `mcp_chi_doc` (scripts/mcp-cuc-bo-vai-tro.mjs).
--   "runId","userId" : FK KÉP → ai_agent_runs(id,"userId") (uq_ai_agent_runs_id_user từ 0441) ⇒ bản lưu luôn cùng chủ với lượt; xoá lượt cascade.
--   "tinNhan"        : mảng jsonb; trần 600 000 byte (máy chủ giữ ≤ 400 KB + dư); "soTin" 0..400.
--   "daTiepTucBoi"   : uuid lượt MỚI đã tiếp tục từ lượt này (NULL = chưa). Đặt bằng UPDATE có điều kiện ⇒ chỉ MỘT lần/nguồn.

CREATE TABLE IF NOT EXISTS public.ai_agent_run_lich_su (
  "runId"        uuid        PRIMARY KEY,
  "userId"       integer     NOT NULL,
  "tinNhan"      jsonb       NOT NULL,
  "soTin"        integer     NOT NULL,
  "buoc"         integer     NOT NULL DEFAULT 0,
  "capNhatLuc"   timestamptz NOT NULL DEFAULT now(),
  "daTiepTucBoi" uuid        NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_agent_run_lich_su_run_user') THEN
    ALTER TABLE public.ai_agent_run_lich_su
      ADD CONSTRAINT fk_ai_agent_run_lich_su_run_user
      FOREIGN KEY ("runId", "userId") REFERENCES public.ai_agent_runs (id, "userId") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_run_lich_su_mang') THEN
    ALTER TABLE public.ai_agent_run_lich_su ADD CONSTRAINT chk_ai_agent_run_lich_su_mang CHECK (jsonb_typeof("tinNhan") = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_run_lich_su_so_tin') THEN
    ALTER TABLE public.ai_agent_run_lich_su ADD CONSTRAINT chk_ai_agent_run_lich_su_so_tin CHECK ("soTin" BETWEEN 0 AND 400);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_run_lich_su_buoc') THEN
    ALTER TABLE public.ai_agent_run_lich_su ADD CONSTRAINT chk_ai_agent_run_lich_su_buoc CHECK ("buoc" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_run_lich_su_kich_thuoc') THEN
    ALTER TABLE public.ai_agent_run_lich_su ADD CONSTRAINT chk_ai_agent_run_lich_su_kich_thuoc CHECK (octet_length("tinNhan"::text) <= 600000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_run_lich_su_tiep_tuc') THEN
    ALTER TABLE public.ai_agent_run_lich_su ADD CONSTRAINT chk_ai_agent_run_lich_su_tiep_tuc CHECK ("daTiepTucBoi" IS NULL OR "daTiepTucBoi" <> "runId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_agent_run_lich_su_owner_idx ON public.ai_agent_run_lich_su ("userId", "capNhatLuc");

-- `avi_app` cần DML (bảng do `aoi` sở hữu). KHÔNG TRUNCATE/REFERENCES/TRIGGER (khuôn 0333/0390/0441).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_run_lich_su TO avi_app;
  END IF;
END $$;
