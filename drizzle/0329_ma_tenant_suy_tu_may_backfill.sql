-- ============================================================================
-- 0329 — TRÁM GỐC cho lượt "mã tenant suy từ MÁY, không lấy từ JSON".
--
-- ⚠⚠ CHỈ DML. Không tạo/xoá/sửa một cột, một bảng, một chính sách nào. Chạy lại
--    vô hại (mọi câu đều `IS NULL`-guard hoặc `ON CONFLICT DO NOTHING`).
-- ⚠⚠ PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501 / WORM) và áp cho CẢ HAI
--    CSDL (`aoi_management`, `aoi_management_test`).
--    Khuôn: scripts/apply-migration-0329.mjs
--
-- ── VÌ SAO CẦN NÓ ───────────────────────────────────────────────────────────
-- Từ lượt này, `machineApiRouters` + `aoiPackageRouter` SUY mã tenant từ chuỗi
-- `machine → station → line → workshop → factory` thay vì đọc `input.*`. Ba trục
-- (`factoryCode`/`workshopCode`/`lineCode`) suy được 100% và khớp 100% lời khai,
-- nên chúng không cần gì cả.
--
-- ⚠ Trục THỨ TƯ thì KHÔNG. Đo trên `aoi_management` ngày 2026-08-18:
--
--     corporates                                  →   0 hàng
--     factories có "corporateCode"                 →   0 / 3
--     product_inspections mang corporateCode='SIM' →  22.995 / 22.996
--
-- Tức chuỗi phân cấp KHÔNG BIẾT nhà máy `SIM-FAC` thuộc tập đoàn nào, trong khi
-- 22.995 bản ghi kiểm đã khai `'SIM'` suốt. "Suy rồi ghi đè" mà không trám gốc
-- thì mọi hàng MỚI mất `'SIM'` — bản vá chống rò rỉ tự tay XOÁ một trục tenant
-- khỏi dữ liệu. Đây chính là việc mà 0327 đã ghi thành lời khuyên: *"Muốn siết
-- tiếp: điền mã tenant vào dữ liệu (backfill)"*.
--
-- ── MỤC 1 — TẬP ĐOÀN, SUY TỪ CHÍNH DỮ LIỆU ĐÃ CÓ ────────────────────────────
-- KHÔNG gõ tay `'SIM'` vào migration. Một nhà máy chỉ được gán tập đoàn khi
-- TOÀN BỘ bản ghi kiểm của nó khai **ĐÚNG MỘT** mã (`count(DISTINCT) = 1`). Nhà
-- máy có hai lời khai khác nhau ⇒ dữ liệu đang mâu thuẫn ⇒ **KHÔNG đoán**, để
-- nguyên NULL và để `phamViGhiMay.doiChieuKhai` bỏ lời khai kèm cảnh báo.
--
-- ── MỤC 2/3 — BACKFILL CÁC Ô CÒN TRỐNG ──────────────────────────────────────
-- `product_inspections`: 1 hàng NULL trên `aoi_management` (id 95302, máy thuộc
-- SIM-FAC/SIM-WS/SIM-L1). `inspection_packages`: 0 hàng trên CSDL thật, 160/160
-- trên CSDL test — và ở BẢNG NÀY một `factoryCode` NULL nghĩa là gói ảnh hiện ra
-- với MỌI nhà máy (`relrowsecurity = true`, vị từ `app_tenant_allows("factoryCode",
-- NULL)` ⇒ nhánh 0327 cho TRUE). Đó là quả mìn thật, không phải dọn dẹp mỹ quan.
--
-- ⚠⚠ **CHỈ ĐIỀN Ô TRỐNG, KHÔNG SỬA Ô ĐÃ CÓ.** `aoi_management_test` có 864 hàng
-- khai LỆCH mã suy ra — đó là dữ liệu dựng sẵn của các bài kiểm tra cách ly phạm
-- vi (1.239 nhà máy giả). Sửa chúng là làm hỏng chính lưới đang canh lỗ này.
--
-- ⚠ `product_inspections` là hypertable Timescale CÓ NÉN (3 chunk, 1 đã nén). Đã
--   thử UPDATE trong giao dịch rollback ngày 2026-08-18: chạy được, 1 hàng.
--
-- ── HOÀN NGUYÊN ────────────────────────────────────────────────────────────
--   UPDATE factories SET "corporateCode" = NULL WHERE "corporateCode" IN (
--     SELECT code FROM corporates WHERE description LIKE '0329:%');
--   DELETE FROM corporates WHERE description LIKE '0329:%';
-- (Hai mục backfill 2/3 KHÔNG hoàn nguyên được về NULL và cũng không nên: giá trị
--  điền vào là giá trị SUY RA từ chuỗi phân cấp, tức sự thật.)
-- ============================================================================

-- ── 1) TẬP ĐOÀN ────────────────────────────────────────────────────────────
CREATE TEMP TABLE _t0329_corp ON COMMIT DROP AS
SELECT f.id AS factory_id, min(pi."corporateCode") AS ma
FROM factories f
JOIN workshops w        ON w."factoryId"   = f.id
JOIN production_lines pl ON pl."workshopId" = w.id
JOIN stations st         ON st."lineId"     = pl.id
JOIN machines m          ON m."stationId"   = st.id
JOIN product_inspections pi ON pi."machineId" = m.id
WHERE f."corporateCode" IS NULL
  AND pi."corporateCode" IS NOT NULL
  AND btrim(pi."corporateCode") <> ''
GROUP BY f.id
HAVING count(DISTINCT pi."corporateCode") = 1;

INSERT INTO corporates (code, name, description)
SELECT DISTINCT c.ma, c.ma,
       '0329: suy từ product_inspections."corporateCode" (một mã duy nhất cho toàn bộ máy của nhà máy)'
FROM _t0329_corp c
ON CONFLICT (code) DO NOTHING;

UPDATE factories f
SET "corporateCode" = c.ma, "updatedAt" = now()
FROM _t0329_corp c
WHERE f.id = c.factory_id AND f."corporateCode" IS NULL;

-- ── 2) product_inspections: điền Ô TRỐNG từ chuỗi phân cấp của máy ─────────
UPDATE product_inspections pi
SET "corporateCode" = COALESCE(pi."corporateCode", ch.corp),
    "factoryCode"   = COALESCE(pi."factoryCode",   ch.fac),
    "workshopCode"  = COALESCE(pi."workshopCode",  ch.ws),
    "lineCode"      = COALESCE(pi."lineCode",      ch.line)
FROM (
  SELECT m.id AS machine_id, f."corporateCode" AS corp, f.code AS fac,
         w.code AS ws, pl.code AS line
  FROM machines m
  JOIN stations st         ON st.id = m."stationId"
  JOIN production_lines pl ON pl.id = st."lineId"
  JOIN workshops w         ON w.id  = pl."workshopId"
  JOIN factories f         ON f.id  = w."factoryId"
) ch
WHERE pi."machineId" = ch.machine_id
  AND (pi."factoryCode"  IS NULL
    OR pi."workshopCode" IS NULL
    OR pi."lineCode"     IS NULL
    OR (pi."corporateCode" IS NULL AND ch.corp IS NOT NULL));

-- ── 3) inspection_packages: cùng luật (bảng CÓ RLS — NULL = mọi nhà máy thấy) ─
UPDATE inspection_packages ip
SET "factoryCode" = COALESCE(ip."factoryCode", ch.fac),
    "lineCode"    = COALESCE(ip."lineCode",    ch.line),
    "updatedAt"   = now()
FROM (
  SELECT m.id AS machine_id, f.code AS fac, pl.code AS line
  FROM machines m
  JOIN stations st         ON st.id = m."stationId"
  JOIN production_lines pl ON pl.id = st."lineId"
  JOIN workshops w         ON w.id  = pl."workshopId"
  JOIN factories f         ON f.id  = w."factoryId"
) ch
WHERE ip."machineId" = ch.machine_id
  AND (ip."factoryCode" IS NULL OR ip."lineCode" IS NULL);
