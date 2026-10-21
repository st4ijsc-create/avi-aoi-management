-- ★★ AI Local Đợt 9 (2026-10-21) — CHỦ LƯỢT CHẠY của Luồng AI: `ai_flow_runs."chuLuong"` = người mà phạm vi dữ liệu của lượt được tính theo
-- (dieu-phoi duyệt (a): lượt từ lịch/webhook/MCP chạy dưới NGƯỜI BẬT phiên bản; chạy tay chạy dưới NGƯỜI BẤM; luồng con kế thừa cha).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0410.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- NULL (chưa có / người dùng đã bị xoá ⇒ ON DELETE SET NULL) ⇒ node tham chiếu tài nguyên theo id TỪ CHỐI (đóng theo mặc định).
-- Phạm vi tính lại LÚC CHẠY từ người dùng hiện tại (khoá / mất quyền ⇒ từ chối), không chụp lại lúc tạo lượt. KHÔNG FUNCTION/TRIGGER.
-- Idempotent.

ALTER TABLE public.ai_flow_runs ADD COLUMN IF NOT EXISTS "chuLuong" integer REFERENCES public.users(id) ON DELETE SET NULL;
