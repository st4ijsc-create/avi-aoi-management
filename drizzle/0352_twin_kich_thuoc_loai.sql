-- ============================================================================
-- Migration 0352 — Twin 3D Đợt 0 (spec §5.3 QĐ-7, §10B.1): KÍCH THƯỚC MẶC ĐỊNH
-- THEO LOẠI MÁY.
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501).
-- ⚠ KHÔNG có một câu DELETE nào. INSERT ... ON CONFLICT DO NOTHING (tái chạy được).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ★★★ MỌI HÀNG SEED ĐẶT `laGiaDinh = true`. KHÔNG NGOẠI LỆ.
-- ════════════════════════════════════════════════════════════════════════════
-- Đo được (§1.3): `bounds IS NULL` ở 5/5 hàng `equipment_3d_models`. Nghĩa là
-- KHÔNG MỘT MÁY NÀO trong hệ có kích thước thật. Mọi con số dưới đây là ước lượng
-- theo chủng loại thiết bị SMT/kiểm tra công nghiệp phổ biến — chúng tồn tại để
-- cảnh 3D có hình khối hợp lý thay vì mọi máy cùng một hộp, KHÔNG phải để ai đó
-- đọc ra "máy AOI của ta rộng 1,45 m".
--
-- Đây là NT-4 ở tầng DB: số giả định phải TỰ KHAI là giả định. Cột `laGiaDinh`
-- là lời khai đó. Kỹ thuật đo thật rồi sửa trong Inspector → `laGiaDinh=false`
-- → badge "chưa đo" TỰ TẮT. Không có đường nào khác tắt được badge — cố ý.
--
-- ⚠⚠ CẠM BẪY ĐÃ TRÁNH: cám dỗ đặt laGiaDinh=false cho vài loại "chắc chắn đúng"
-- (vd REFLOW dài ~4 m thì ai cũng biết). KHÔNG. "Ai cũng biết" không phải phép đo,
-- và một hàng false lẫn trong bảng làm mất khả năng đếm "còn bao nhiêu loại chưa
-- đo" bằng một câu COUNT — đúng lớp lỗi BG-127 (câu đếm mù cấu trúc).
--
-- ════════════════════════════════════════════════════════════════════════════
-- PHẠM VI: 24 giá trị — KHÔNG PHẢI "25+" NHƯ SPEC VIẾT
-- ════════════════════════════════════════════════════════════════════════════
-- Spec §5.3 nói "Seed cho 25+ giá trị của machineTypeEnum". Đếm thật trên
-- `drizzle/schema/enums.ts` (parse enum, không đếm dòng): **24** giá trị. Bảng
-- dưới seed ĐỦ CẢ 24, và câu kiểm cuối file cưỡng chế "0 loại thiếu" — nên con số
-- trong spec sai không gây hại, nhưng đã ghi lại ở đây thay vì im lặng sửa spec.
--
-- Đơn vị: mm. rong = trục X (bề ngang), cao = trục Z (chiều cao), sau = trục Y
-- (chiều sâu theo hướng băng chuyền) — quy ước §5.2.
-- ============================================================================

CREATE TABLE IF NOT EXISTS twin_kich_thuoc_loai (
  "loaiMay"     machinetypeenum PRIMARY KEY,
  "rongMm"      numeric(14,3) NOT NULL,
  "caoMm"       numeric(14,3) NOT NULL,
  "sauMm"       numeric(14,3) NOT NULL,
  -- ★ true = ƯỚC LƯỢNG theo chủng loại, KHÔNG phải số đo. Xem docblock.
  "laGiaDinh"   boolean NOT NULL DEFAULT true,
  "ghiChu"      text,
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

-- ─── Seed 24/24 giá trị machinetypeenum ───
-- ON CONFLICT DO NOTHING: chạy lại KHÔNG đè giá trị kỹ thuật đã đo lại
-- (laGiaDinh=false). Đây là bất biến NT-4: "sinh tự động không đè bản nhập tay".
INSERT INTO twin_kich_thuoc_loai ("loaiMay","rongMm","caoMm","sauMm","laGiaDinh","ghiChu") VALUES
  -- Nhóm kiểm tra quang/điện — thân máy inline, cao ~1,5 m kể cả tháp đèn.
  ('AVI',              1200, 1500, 1000, true, 'GIA DINH — kiem tra hinh anh inline, khung tuong tu AOI'),
  ('AOI',              1300, 1500, 1100, true, 'GIA DINH — AOI inline SMT pho bien'),
  ('SPI',              1200, 1500, 1000, true, 'GIA DINH — do be day kem han, than nho hon AOI'),
  ('AXI',              1600, 1900, 1400, true, 'GIA DINH — X-ray co buong chan tia, lon va cao hon AOI'),
  ('ICT',              1500, 1800, 1200, true, 'GIA DINH — tu test in-circuit kem ban dinh'),
  ('FCT',              1400, 1800, 1200, true, 'GIA DINH — tu test chuc nang'),
  ('ICT_FUNC',         1800, 1800, 1300, true, 'GIA DINH — cell gop ICT + functional, rong hon ca hai'),
  ('CMM',              1600, 2000, 1800, true, 'GIA DINH — may do toa do co ban da granite, sau lon'),
  -- Nhóm SMT — máy dài theo hướng băng chuyền.
  ('MOUNTER',          2200, 1600, 1800, true, 'GIA DINH — may gan linh kien chip mounter'),
  ('REFLOW',           4500, 1600, 1300, true, 'GIA DINH — lo han doi luu nhieu vung, DAI nhat day chuyen'),
  ('STENCIL_PRINTER',  1500, 1600, 1400, true, 'GIA DINH — may in kem han qua khuon'),
  ('WAVE_SOLDER',      3500, 1700, 1500, true, 'GIA DINH — han song / han chon loc'),
  -- Nhóm tự động hoá / robot.
  ('AUTOMATION',       1500, 1800, 1200, true, 'GIA DINH — tram tu dong hoa chung, khung tu dieu khien'),
  ('ROBOT',            1000, 1800,  1000, true, 'GIA DINH — robot cong nghiep 6 truc + de, tam voi ~1,4 m'),
  ('ROBOT_TEST',       2000, 2000, 1600, true, 'GIA DINH — cell test robot co rao an toan bao quanh'),
  ('WELDER',           1800, 2000, 1500, true, 'GIA DINH — cell han co buong chan ho quang'),
  ('PALLETIZER',       2500, 2400, 2000, true, 'GIA DINH — xep pallet, CAO nhat vi tam voi doc'),
  ('PACKAGING',        2500, 1800, 1400, true, 'GIA DINH — tram dong goi inline'),
  -- Nhóm trạm thao tác / cấp liệu — nhỏ, thấp.
  ('ASSEMBLY',         1500, 1200, 900,  true, 'GIA DINH — ban lap rap, cao ngang tam thao tac dung'),
  ('SCREWDRIVE',       1000, 1400, 800,  true, 'GIA DINH — tram bat vit tu dong'),
  ('DISPENSING',       1200, 1500, 1000, true, 'GIA DINH — tram nho keo/kem'),
  ('FEEDER',            600, 1200, 500,  true, 'GIA DINH — xe/gia cap linh kien, khong phai may dung'),
  -- Nhóm IoT — thiết bị treo tường/tủ, KHÔNG đứng sàn.
  ('IOT_SENSOR',        120,  120,  80,  true, 'GIA DINH — cam bien IoT tu phat trien, gan tren may/tuong'),
  ('IOT_GATEWAY',       300,  200, 150,  true, 'GIA DINH — gateway/relay IoT trong tu dien')
ON CONFLICT ("loaiMay") DO NOTHING;

-- ─── Cầu chì: KHÔNG loại nào của enum bị bỏ sót ───
-- Phép đo ĐỘC LẬP với danh sách INSERT ở trên: liệt kê TOÀN BỘ nhãn enum từ
-- pg_enum rồi trừ đi bảng seed (bài học BG-127 — hai phép đo cùng kiểu cùng sai;
-- ở đây một bên là danh sách tôi gõ tay, bên kia là sự thật của catalog).
DO $$
DECLARE thieu text;
BEGIN
  SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) INTO thieu
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'machinetypeenum'
    AND NOT EXISTS (
      SELECT 1 FROM twin_kich_thuoc_loai k WHERE k."loaiMay"::text = e.enumlabel
    );
  IF thieu IS NOT NULL THEN
    RAISE EXCEPTION 'twin_kich_thuoc_loai thieu % loai machinetypeenum: %',
      array_length(string_to_array(thieu, ', '), 1), thieu;
  END IF;
END $$;

-- ─── Cầu chì 2: KHÔNG hàng seed nào tự nhận là số đo ───
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM twin_kich_thuoc_loai WHERE "laGiaDinh" = false;
  IF n > 0 THEN
    RAISE NOTICE 'twin_kich_thuoc_loai: % hang co laGiaDinh=false (da do lai bang tay) — KHONG de.', n;
  END IF;
END $$;
