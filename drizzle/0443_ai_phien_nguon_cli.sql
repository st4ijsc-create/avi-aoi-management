-- ★★★ Đợt 11.8 · T7 (2026-10-30) — phiên hợp nhất: nguồn 'cli' (CLI độc lập, doc 83).
--
-- ⚠⚠ DDL ⇒ PHẢI CHẠY BẰNG OWNER `aoi` (`node scripts/apply-migration-0443.mjs --test-only | --dev-only | --both`). DEV chỉ sau khi
--    dieu-phoi duyệt SQL. Idempotent: chỉ đổi CHECK khi định nghĩa hiện tại CHƯA có 'cli'.
--
-- 0440 đặt CHECK source IN ('web','vscode'); dieu-phoi chốt D5: thêm 'cli'. Cột "coLuotNgoai" đã có (mig 0417 của do-model) — KHÔNG thêm lại.
-- Bảng nhỏ (hàng chục) ⇒ DROP/ADD CONSTRAINT giữ khoá ngắn.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_ai_coding_sessions_source'
       AND conrelid = 'public.ai_coding_sessions'::regclass
       AND pg_get_constraintdef(oid) LIKE '%cli%'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_sessions_source' AND conrelid = 'public.ai_coding_sessions'::regclass) THEN
      ALTER TABLE public.ai_coding_sessions DROP CONSTRAINT chk_ai_coding_sessions_source;
    END IF;
    ALTER TABLE public.ai_coding_sessions
      ADD CONSTRAINT chk_ai_coding_sessions_source CHECK ("source" IN ('web', 'vscode', 'cli'));
  END IF;
END $$;
