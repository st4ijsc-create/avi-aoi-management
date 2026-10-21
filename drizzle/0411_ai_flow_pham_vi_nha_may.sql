-- ★★ AI Local Đợt 9 (2026-10-21) — PHẠM VI NHÀ MÁY của chính Luồng AI: `ai_flows."factoryId"` và `ai_flow_credentials."factoryId"`.
-- dieu-phoi duyệt (d): đơn vị phạm vi = nhà máy (cùng đơn vị `phamViCua(ctx)` / `idsTrongPhamVi("factory", …)` dùng cho máy).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0411.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- NULL = luồng / bí mật TOÀN HỆ THỐNG: chỉ người có phạm vi "tất cả" (admin) thấy và dùng. Nhà máy bị xoá ⇒ ON DELETE SET NULL ⇒ trở
-- thành toàn hệ thống (fail-closed: từ đó chỉ admin còn thấy). Backfill luồng/bí mật CŨ: `scripts/flow-backfill-pham-vi.ts` (chạy khô
-- mặc định, in báo cáo; KHÔNG nằm trong mig). KHÔNG FUNCTION/TRIGGER. Idempotent.

ALTER TABLE public.ai_flows ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories(id) ON DELETE SET NULL;
ALTER TABLE public.ai_flow_credentials ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ai_flows_factory_idx ON public.ai_flows ("factoryId");
CREATE INDEX IF NOT EXISTS ai_flow_credentials_factory_idx ON public.ai_flow_credentials ("factoryId");
