-- ★★★ 2026-10-25 — KHO VẬT TƯ THEO NHÀ MÁY (lô W16 — kiểm định phamViGhi; chủ dự án quyết 2026-10-25, câu hỏi W14-Q2: kho vật tư THEO NHÀ MÁY).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0424.mjs --test-only|--dev-only|--both`.
--    DEV chỉ sau khi phiên điều phối duyệt SQL + số đo. Không drizzle-kit generate/push.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- BỐN bảng "kho vật tư" thêm "factoryId" integer NULL (FK factories(id) ON DELETE SET NULL, chỉ mục):
--   spare_parts_inventory · material_receipts · supplier_lots · lot_disposition.
-- NULL = CHƯA GÁN ⇒ chỉ người dùng toàn quyền (admin) thấy / thao tác (fail-closed) cho tới khi gán.
--
-- spare_parts_inventory: UNIQUE("partCode") ⇒ UNIQUE("partCode", COALESCE("factoryId",0)) — cùng mã phụ tùng có thể có ở nhiều nhà máy (tồn kho riêng từng nhà máy);
-- hàng NULL vẫn duy nhất theo mã (COALESCE 0). Mọi chỗ cũ tra theo partCode phải thêm nhà máy (server/routers/maintenanceRouter.ts).
--
-- BACKFILL CHỈ KHI SUY ĐƯỢC THẬT (không đoán):
--   • spare_parts_inventory ← nhà máy DUY NHẤT của các máy từng tiêu hao phụ tùng đó (work_order_parts → phiếu bảo trì → máy → trạm → chuyền → xưởng → nhà máy); nhiều nhà máy
--     hoặc chưa từng dùng ⇒ giữ NULL;
--   • supplier_lots ← material_receipts.factoryId của phiếu nhập (khi phiếu đã có nhà máy);  • lot_disposition ← supplier_lots.factoryId. (Hiện không hàng nào có nhà máy ⇒ vô tác dụng; để lần chạy lại về sau.)
-- material_receipts KHÔNG có căn cứ suy nhà máy (chỉ mã NCC / mã vật tư) ⇒ NULL, admin gán tay.
-- Idempotent (IF NOT EXISTS / WHERE "factoryId" IS NULL). ADD COLUMN nullable không default = chỉ đổi catalog.

ALTER TABLE public.spare_parts_inventory ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories (id) ON DELETE SET NULL;
ALTER TABLE public.material_receipts     ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories (id) ON DELETE SET NULL;
ALTER TABLE public.supplier_lots         ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories (id) ON DELETE SET NULL;
ALTER TABLE public.lot_disposition       ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public.factories (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_spare_factory   ON public.spare_parts_inventory ("factoryId");
CREATE INDEX IF NOT EXISTS idx_matrecv_factory ON public.material_receipts ("factoryId");
CREATE INDEX IF NOT EXISTS idx_suplot_factory  ON public.supplier_lots ("factoryId");
CREATE INDEX IF NOT EXISTS idx_lotdisp_factory ON public.lot_disposition ("factoryId");

-- UNIQUE(partCode) → UNIQUE(partCode, COALESCE(factoryId,0))
ALTER TABLE public.spare_parts_inventory DROP CONSTRAINT IF EXISTS "spare_parts_inventory_partCode_unique";
CREATE UNIQUE INDEX IF NOT EXISTS uq_spare_parts_code_factory ON public.spare_parts_inventory ("partCode", (COALESCE("factoryId", 0)));

-- Backfill spare_parts_inventory: nhà máy DUY NHẤT của các máy từng dùng phụ tùng
UPDATE public.spare_parts_inventory s
SET "factoryId" = x.fid
FROM (
  SELECT wop."partCode" AS pc, min(w."factoryId") AS fid
  FROM public.work_order_parts wop
  JOIN public.maintenance_work_orders mw ON mw.id = wop."workOrderId"
  JOIN public.machines m ON m.id = mw."machineId"
  JOIN public.stations st ON st.id = m."stationId"
  JOIN public.production_lines l ON l.id = st."lineId"
  JOIN public.workshops w ON w.id = l."workshopId"
  GROUP BY wop."partCode"
  HAVING count(DISTINCT w."factoryId") = 1
) x
WHERE s."partCode" = x.pc AND s."factoryId" IS NULL;

UPDATE public.supplier_lots l SET "factoryId" = r."factoryId"
FROM public.material_receipts r
WHERE l."receiptId" = r.id AND r."factoryId" IS NOT NULL AND l."factoryId" IS NULL;

UPDATE public.lot_disposition d SET "factoryId" = l."factoryId"
FROM public.supplier_lots l
WHERE d."supplierLotId" = l.id AND l."factoryId" IS NOT NULL AND d."factoryId" IS NULL;

COMMENT ON COLUMN public.spare_parts_inventory."factoryId" IS 'Nha may so huu ton kho phu tung (lo W16 2026-10-25). NULL = chua gan => chi toan quyen thay.';
COMMENT ON COLUMN public.material_receipts."factoryId"     IS 'Nha may nhan vat tu (lo W16 2026-10-25). NULL = chua gan => chi toan quyen thay.';
COMMENT ON COLUMN public.supplier_lots."factoryId"         IS 'Nha may so huu lo NCC (lo W16 2026-10-25). NULL = chua gan => chi toan quyen thay.';
COMMENT ON COLUMN public.lot_disposition."factoryId"       IS 'Nha may quyet dinh xu ly lo (lo W16 2026-10-25). NULL = chua gan => chi toan quyen thay.';
