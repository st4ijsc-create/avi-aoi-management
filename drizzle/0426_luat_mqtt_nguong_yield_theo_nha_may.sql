-- ★★★ 2026-10-25 — LUẬT CẢNH BÁO MQTT + NGƯỠNG YIELD THEO NHÀ MÁY (lô W17b — kiểm định phamViGhi; chủ dự án quyết 2026-10-25).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0426.mjs --test-only|--dev-only|--both`. DEV chỉ sau khi phiên điều phối duyệt SQL + số đo.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- `mqtt_alert_rules."factoryId"` · `yield_alert_thresholds."factoryId"` · `mqtt_alert_history."factoryId"` : integer NULL (FK factories(id) ON DELETE SET NULL, chỉ mục).
-- NULL = MẶC ĐỊNH TOÀN TẬP ĐOÀN (các hàng đang có — KHÔNG đổi, KHÔNG backfill).
--   • khoá tự nhiên GHI ĐÈ: mqtt_alert_rules = (ruleType, categoryId) · yield_alert_thresholds = (metricType). Nhà máy có hàng riêng cho khoá nào thì khoá đó dùng hàng riêng;
--     khoá khác rơi về hàng NULL.
--   • yield_alert_thresholds: MỖI nhà máy tối đa MỘT hàng cho một metricType ⇒ chỉ mục duy nhất từng phần (factoryId, metricType) WHERE factoryId IS NOT NULL (cột mới nên không thể vi phạm).
--   • mqtt_alert_history.factoryId = nhà máy của luật đã kích (snapshot lúc kích) — để đọc lịch sử lọc theo phạm vi.
-- Idempotent. ADD COLUMN nullable không default = chỉ đổi catalog.
ALTER TABLE public.mqtt_alert_rules ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mqtt_alert_rules_factory ON public.mqtt_alert_rules ("factoryId");
ALTER TABLE public.yield_alert_thresholds ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_yield_thresholds_factory ON public.yield_alert_thresholds ("factoryId");
CREATE UNIQUE INDEX IF NOT EXISTS uq_yield_thresholds_factory_metric ON public.yield_alert_thresholds ("factoryId", "metricType") WHERE "factoryId" IS NOT NULL;
ALTER TABLE public.mqtt_alert_history ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mqtt_alert_history_factory ON public.mqtt_alert_history ("factoryId");
COMMENT ON COLUMN public.mqtt_alert_rules."factoryId" IS 'Nha may so huu luat canh bao MQTT (lo W17b 2026-10-25). NULL = mac dinh toan tap doan. Khoa ghi de = (ruleType, categoryId).';
COMMENT ON COLUMN public.yield_alert_thresholds."factoryId" IS 'Nha may so huu nguong yield (lo W17b 2026-10-25). NULL = mac dinh toan tap doan. Khoa ghi de = metricType.';
COMMENT ON COLUMN public.mqtt_alert_history."factoryId" IS 'Nha may cua luat da kich (snapshot, lo W17b 2026-10-25). NULL = luat mac dinh.';
