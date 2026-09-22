-- ════════════════════════════════════════════════════════════════════════════
-- 0358 — B7 (kế hoạch nâng cấp AI Local 2026-09-22): **SỔ ĐO LƯỢT phân biệt NGHĨ và TRẢ**
--        (`ai_gateway_metrics` + `reasoningTokens` · `thinking` · `samplingProfile`)
-- ════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO: model sản xuất đổi sang Qwen3.6-35B-A3B (nghĩ mặc định). `tokensOut` của llama-server GỘP
--   cả token trong `<think>` ⇒ sổ đo cũ không phân biệt được *"nghĩ 5.000 rồi trả 300"* với *"trả
--   5.000"*, và mọi số tok/s hay chi phí trên thanh trạng thái đều là số gộp. Ba cột mới tách hai
--   nửa ấy và ghi kèm hồ sơ sampling đang A/B (B2).
--
-- ⚠ Cả ba cột **NULLABLE, KHÔNG default**: `NULL` = lượt/đường không đo được (in-process,
--   không-stream) và mọi hàng cũ — **không biết ≠ 0**. Đặt default 0 là bịa một con số.
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501). Xem `scripts/apply-migration-0358.mjs`
--   (cùng khuôn `apply-migration-0357.mjs`).
-- ⚠ Repo này **CẤM `drizzle-kit push` và `generate`** — tệp viết TAY; cột khai vào
--   `drizzle/schema/ai.ts` (`aiGatewayMetrics`) **cùng lượt**.
--
ALTER TABLE "ai_gateway_metrics" ADD COLUMN IF NOT EXISTS "reasoningTokens" integer;
ALTER TABLE "ai_gateway_metrics" ADD COLUMN IF NOT EXISTS "thinking" boolean;
ALTER TABLE "ai_gateway_metrics" ADD COLUMN IF NOT EXISTS "samplingProfile" varchar(24);
