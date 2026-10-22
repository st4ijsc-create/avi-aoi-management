-- ★★ AI Local Đợt 9 (2026-10-21, dieu-phoi duyệt) — `ai_gateway_metrics` ĐO CẢ LƯỢT PHỤ của một yêu cầu.
--
-- VÌ SAO: vòng kiểm biên dịch ST của /v1 (`server/services/ai/st/kiemBienDichSt.ts`) gọi model LẠI tối đa 2 lần trong CÙNG một
--   yêu cầu (sửa theo lỗi biên dịch). Các lượt ấy chiếm khe :8091 và token THẬT, nhưng sổ đo chỉ có một hàng/yêu cầu ⇒ chi phí
--   báo THẤP GIẢ, và A/B cờ AI_KIEM_BIEN_DICH_ST không đọc được chi phí từ sổ.
--   · `requestId` — mã yêu cầu (vd `chatcmpl-…` của /v1); hàng chính và mọi lượt phụ của nó MANG CÙNG mã ⇒ gộp được.
--   · `luotPhu`   — NULL = lượt chính (mọi hàng cũ, mọi đường khác); khác NULL = loại lượt phụ (`sua-bien-dich-st`).
--
-- ⚠ Cả hai NULLABLE, KHÔNG default (không biết ≠ giá trị). CHECK theo HÌNH DẠNG (không danh sách trắng — thêm loại lượt phụ
--   không cần migration). Không index: đọc theo `createdAt` như cũ rồi gộp theo `requestId` trong cửa sổ đó.
-- ⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0406.mjs --test-only|--dev-only|--both`. Repo CẤM
--   `drizzle-kit push/generate` — cột khai TAY ở `drizzle/schema/ai.ts` (`aiGatewayMetrics`) cùng lượt. Idempotent.

ALTER TABLE public.ai_gateway_metrics ADD COLUMN IF NOT EXISTS "requestId" varchar(64);
ALTER TABLE public.ai_gateway_metrics ADD COLUMN IF NOT EXISTS "luotPhu" varchar(32);
ALTER TABLE public.ai_gateway_metrics DROP CONSTRAINT IF EXISTS chk_ai_gateway_metrics_luot_phu;
ALTER TABLE public.ai_gateway_metrics ADD CONSTRAINT chk_ai_gateway_metrics_luot_phu
  CHECK ("luotPhu" IS NULL OR "luotPhu" ~ '^[a-z0-9-]{1,32}$');
