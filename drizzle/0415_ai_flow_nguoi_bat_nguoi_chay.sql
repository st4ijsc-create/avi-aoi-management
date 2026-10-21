-- ★★ AI Local — H2 (audit bảo mật 2026-10-21): TÁCH NGƯỜI DUYỆT khỏi người BẬT phiên bản và người KÍCH HOẠT lượt.
-- `flow.duyet` trước đây không biết ai bật phiên bản / ai chạy tay lượt đang chờ duyệt ⇒ tác giả tự duyệt lượt của chính mình.
--   • ai_flow_versions."enabledBy"  — người BẬT phiên bản gần nhất (datPhienBanHoatDong / batLuongOt);
--   • ai_flow_runs."startedBy"      — người kích hoạt lượt bằng tay (chayTay); lịch / webhook / MCP / luồng con ⇒ NULL.
-- Cột thêm KHÔNG ràng buộc ngược dữ liệu cũ (NULL = chưa biết). Idempotent; không FUNCTION/TRIGGER.
--
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0415.mjs --test-only|--dev-only|--both`.

ALTER TABLE public.ai_flow_versions ADD COLUMN IF NOT EXISTS "enabledBy" integer REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.ai_flow_runs ADD COLUMN IF NOT EXISTS "startedBy" integer REFERENCES public.users(id) ON DELETE SET NULL;
