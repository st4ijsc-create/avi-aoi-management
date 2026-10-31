-- ★★★ Đợt 11.8 · M4/S7 (2026-10-30) — THẺ DUYỆT GẮN LƯỢT AGENT ở tầng CSDL.
--
-- ⚠⚠ DDL ⇒ PHẢI CHẠY BẰNG OWNER `aoi` (`node scripts/apply-migration-0442.mjs --test-only | --dev-only | --both`). DEV chỉ sau khi
--    dieu-phoi duyệt SQL. Idempotent.
--
-- VÌ SAO: thẻ `pending_action` do agent (kể cả agent CON) đề xuất duyệt được qua NHIỀU đường (tRPC `aiAgent.duyet`, hộp thư
-- `aiCopilot.confirmAction`, CLI, MCP…). Một cổng riêng ở một đường là lỗ. Điểm chặn CHUNG là `confirmAction`: nó tra cột này —
-- thẻ có `agentRunId` ⇒ lượt đó và MỌI tổ tiên (ai_agent_runs.parentRunId) phải CÒN CHẠY (dang-chay | cho-duyet) và cùng chủ; lượt đã
-- huỷ/xong/gián đoạn/không còn hàng sổ ⇒ từ chối (fail-closed), kể cả sau khi máy chủ khởi động lại (không phụ thuộc bộ nhớ).
--
-- KHÔNG có khoá ngoại: ON DELETE SET NULL sẽ biến một thẻ được bảo vệ thành thẻ "không gắn lượt" (fail-open); hàng sổ bị mất ⇒ thẻ bị
-- TỪ CHỐI (không thấy lượt = không còn sống). Cột chỉ do máy chủ ghi (bộ thực thi agent) ngay sau khi đề xuất, TRƯỚC khi phát thẻ.

ALTER TABLE public.ai_pending_actions ADD COLUMN IF NOT EXISTS "agentRunId" uuid NULL;

CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_agent_run
  ON public.ai_pending_actions ("agentRunId") WHERE "agentRunId" IS NOT NULL;
