-- ★★ AI Local Đợt 8.4 (2026-10-20) — LUỒNG CON: hàng chờ `ai_flow_waits` thêm loại `luong-con` (node `luong.goi-con` chờ BỀN
-- tới khi lượt con đóng; lượt con mang "parentRunId" — cột có sẵn từ 0401). Spec §4.5 ("gọi sub-flow"), §4.6 (hạng luồng
-- gồm cả sub-flow); kế hoạch docs/superpowers/plans/2026-10-20-ai-local-dot8-pha4-sinh-ma-agent.md.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0404.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Chỉ ĐỔI MỘT CHECK (thêm một giá trị) + chỉ mục tra lượt con theo cha. KHÔNG FUNCTION/TRIGGER. Idempotent.

ALTER TABLE public.ai_flow_waits DROP CONSTRAINT IF EXISTS chk_ai_flow_waits_kind;
ALTER TABLE public.ai_flow_waits ADD CONSTRAINT chk_ai_flow_waits_kind CHECK (kind IN ('duyet', 'webhook', 'thoi-gian', 'luong-con'));

CREATE INDEX IF NOT EXISTS ai_flow_runs_parent_idx ON public.ai_flow_runs ("parentRunId") WHERE "parentRunId" IS NOT NULL;
