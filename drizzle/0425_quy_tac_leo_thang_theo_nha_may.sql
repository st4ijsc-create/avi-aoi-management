-- ★★★ 2026-10-25 — QUY TẮC LEO THANG CẢNH BÁO THEO NHÀ MÁY (lô W16 — kiểm định phamViGhi; chủ dự án quyết 2026-10-25, câu hỏi W14-Q3: mỗi nhà máy tự quyết).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0425.mjs --test-only|--dev-only|--both`. DEV chỉ sau khi phiên điều phối duyệt SQL + số đo.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- `alert_escalation_rules."factoryId"` integer NULL (FK factories(id) ON DELETE SET NULL, chỉ mục).
-- NULL = quy tắc MẶC ĐỊNH TOÀN TẬP ĐOÀN (các hàng đang có — KHÔNG đổi, KHÔNG backfill). Một nhà máy có quy tắc riêng (factoryId = nhà máy đó) cho cặp (severity, alertType)
-- thì cặp đó dùng quy tắc riêng; cặp khác vẫn rơi về quy tắc NULL. Sửa / xoá quy tắc NULL chỉ toàn quyền; người hẹp tạo / sửa / xoá quy tắc nhà máy mình (server/routers/alertEscalationRouter.ts).
-- Idempotent. ADD COLUMN nullable không default = chỉ đổi catalog.
ALTER TABLE public.alert_escalation_rules ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_alert_escalation_rules_factory ON public.alert_escalation_rules ("factoryId");
COMMENT ON COLUMN public.alert_escalation_rules."factoryId" IS 'Nha may so huu quy tac leo thang (lo W16 2026-10-25). NULL = mac dinh toan tap doan.';
