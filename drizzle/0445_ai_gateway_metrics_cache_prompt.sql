-- ★ Đợt 12 H0.1 (2026-10-31, dieu-phoi cấp dải 0445–0449) — `ai_gateway_metrics` TÁCH token prompt TÁI DÙNG và XỬ LÝ LẠI.
--
-- VÌ SAO: `aiLlamaServerClient` cộng `timings.cache_n` (token prompt lấy từ prefix-cache) với `timings.prompt_n` (token phải nạp
--   lại) thành một `tokensPrompt` ⇒ `tokensIn` không nói được lượt nào trúng cache. Mọi thay đổi nén ngữ cảnh / lời nhắc của Đợt 12
--   (H1) phải đo được "mất cache bao nhiêu" TRƯỚC và SAU.
--   · `cacheTokens`      — = `timings.cache_n` (dự phòng: `usage.prompt_tokens_details.cached_tokens`).
--   · `promptEvalTokens` — = `timings.prompt_n` (dự phòng: `prompt_tokens − cached_tokens`).
--   `tokensIn` GIỮ NGHĨA CŨ (= cacheTokens + promptEvalTokens khi đo được) — số cũ không gãy.
--
-- ⚠ Cả hai NULLABLE, KHÔNG default: NULL = không đo được (in-process, không-stream, hàng cũ) — KHÔNG BIẾT ≠ 0.
-- ⚠ CHECK ≥ 0 thêm `NOT VALID` rồi `VALIDATE` (dieu-phoi: bảng có thể lớn; đo DEV 2026-10-31: 22 182 hàng · 5,2 MB). Không index.
-- ⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0445.mjs --test-only|--dev-only|--both`. Repo CẤM
--   `drizzle-kit push/generate` — cột khai TAY ở `drizzle/schema/ai.ts` (`aiGatewayMetrics`) cùng lượt. Idempotent.

ALTER TABLE public.ai_gateway_metrics ADD COLUMN IF NOT EXISTS "cacheTokens" integer;
ALTER TABLE public.ai_gateway_metrics ADD COLUMN IF NOT EXISTS "promptEvalTokens" integer;
ALTER TABLE public.ai_gateway_metrics DROP CONSTRAINT IF EXISTS chk_ai_gateway_metrics_cache_prompt;
ALTER TABLE public.ai_gateway_metrics ADD CONSTRAINT chk_ai_gateway_metrics_cache_prompt
  CHECK (("cacheTokens" IS NULL OR "cacheTokens" >= 0) AND ("promptEvalTokens" IS NULL OR "promptEvalTokens" >= 0)) NOT VALID;
ALTER TABLE public.ai_gateway_metrics VALIDATE CONSTRAINT chk_ai_gateway_metrics_cache_prompt;
