-- ★★ AI Local Đợt 8.2 (2026-10-20) — BÍ MẬT của Luồng AI (khoá API / mật khẩu dùng bởi node HTTP qua `credentialRef`).
-- Spec §4.6 luật 3; kế hoạch docs/superpowers/plans/2026-10-20-ai-local-dot8-pha2-an-toan.md.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0403.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Giá trị CHỈ nằm ở dạng mã AES-256-GCM: "banMa" + iv (12 byte, ngẫu nhiên mỗi lần ghi) + tag (16 byte) + "phienBanKhoa"
-- (khoá nào đã mã — xoay khoá giải mã bằng khoá cũ theo cột này). Khoá ở biến môi trường `AI_FLOW_KHOA_BI_MAT`, KHÔNG BAO GIỜ
-- trong CSDL. API không bao giờ trả lại giá trị. KHÔNG FUNCTION/TRIGGER. Idempotent: IF NOT EXISTS + CHECK qua DO $$.

CREATE TABLE IF NOT EXISTS public.ai_flow_credentials (
  id              varchar(64) PRIMARY KEY,
  ten             varchar(120) NOT NULL,
  loai            varchar(16) NOT NULL,
  "banMa"         bytea NOT NULL,
  iv              bytea NOT NULL,
  tag             bytea NOT NULL,
  "phienBanKhoa"  integer NOT NULL,
  "createdBy"     integer REFERENCES public.users(id) ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_flow_credentials_id') THEN
    ALTER TABLE public.ai_flow_credentials ADD CONSTRAINT chk_ai_flow_credentials_id CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_flow_credentials_loai') THEN
    ALTER TABLE public.ai_flow_credentials ADD CONSTRAINT chk_ai_flow_credentials_loai CHECK (loai IN ('token', 'tai-khoan', 'khac'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_flow_credentials_ma') THEN
    ALTER TABLE public.ai_flow_credentials ADD CONSTRAINT chk_ai_flow_credentials_ma
      CHECK (octet_length(iv) = 12 AND octet_length(tag) = 16 AND octet_length("banMa") BETWEEN 1 AND 16384 AND "phienBanKhoa" >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_flow_credentials TO avi_app;
  END IF;
END $$;
