-- ★★ AI Local Đợt 9 (2026-10-21, hàng đợi M2 của kiem-dinh) — HOST CHO PHÉP của từng BÍ MẬT: `ai_flow_credentials."hostChoPhep"`.
-- Trước đây mọi người có quyền sửa luồng dùng được MỌI bí mật và gửi nó tới bất kỳ host nào trong danh sách trắng chung
-- (`AI_FLOW_HTTP_HOST_CHO_PHEP`). Nay bí mật chỉ được gắn vào yêu cầu tới host nó KHAI.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0412.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Mảng hostname (chữ thường, không scheme/cổng/ký tự đại diện). Mặc định MẢNG RỖNG: bí mật cũ chưa khai host ⇒ KHÔNG dùng được cho tới khi
-- admin khai (`flow.biMatDatHost`) — đóng theo mặc định, không backfill. Tạo bí mật mới qua API BẮT BUỘC khai ≥ 1 host. KHÔNG FUNCTION/TRIGGER.

ALTER TABLE public.ai_flow_credentials ADD COLUMN IF NOT EXISTS "hostChoPhep" text[] NOT NULL DEFAULT '{}'::text[];
