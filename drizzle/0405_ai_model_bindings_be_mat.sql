-- ★★ AI Local Đợt 9 (2026-10-21) — PHẠM VI BỀ MẶT cho gán vai trò → model: `ai_model_bindings."scopeKind"` thêm `be-mat`
-- (bề mặt gọi model; `scopeId` = 'luong' — mọi lượt chạy Luồng AI). Thứ tự định tuyến: flow > project > be-mat > tenant >
-- global (server/services/ai/soModel/dinhTuyenVaiTro.ts). Mục đích đầu tiên: vai trò `extract` của Luồng (chạy NỀN) đi model
-- nhà trong khi bề mặt tương tác giữ 4B; đi kèm `khongDoiKhe` (bề mặt nền không kéo đổi khe nặng).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0405.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Chỉ ĐỔI MỘT CHECK (thêm `be-mat`, scopeId của nó theo danh sách trắng). Không cột mới, không FUNCTION/TRIGGER. Idempotent.

ALTER TABLE public.ai_model_bindings DROP CONSTRAINT IF EXISTS chk_ai_model_bindings_scope;
ALTER TABLE public.ai_model_bindings ADD CONSTRAINT chk_ai_model_bindings_scope CHECK (
  "scopeKind" IN ('global', 'tenant', 'project', 'flow', 'be-mat')
  AND (("scopeKind" = 'global') = ("scopeId" IS NULL))
  AND ("scopeId" IS NULL OR "scopeId" ~ '^[A-Za-z0-9_-]{1,64}$')
  AND ("scopeKind" <> 'be-mat' OR "scopeId" IN ('luong')));
