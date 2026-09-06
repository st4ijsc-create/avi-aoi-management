-- ============================================================================
-- Migration 0354 — Twin 3D Đợt 0: CẦU CHÌ NỀN MÓNG.
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501).
-- ⚠ KHÔNG tạo bảng, KHÔNG sửa dữ liệu. Migration này CHỈ ĐO và NỔ nếu 0350–0353
--   không hạ cánh đủ. Nó không thay đổi một byte nào của DB.
--
-- ════════════════════════════════════════════════════════════════════════════
-- VÌ SAO CÓ TỆP NÀY — bài học BG-95 + "khai mà KHÔNG đọc kết quả"
-- ════════════════════════════════════════════════════════════════════════════
-- `scripts/migrate-standalone.mjs` ghi hàng `__applied_migrations(success=true)`
-- khi mọi câu lệnh KHÔNG NÉM LỖI. Nhưng 0350–0353 dùng dày đặc `IF NOT EXISTS` và
-- `DO $$ IF NOT EXISTS ... END $$` cho tính tái-chạy — mà đó chính là hình dạng có
-- thể "chạy sạch" trong khi KHÔNG TẠO GÌ CẢ (vd chạy nhầm DB, hoặc một CREATE TABLE
-- bị bỏ qua vì tên bảng trùng một thứ khác). "success=true" khi đó là LỜI KHAI, không
-- phải phép đo — đúng lớp lỗi đã lặp 6 lần trong dự án này.
--
-- Tệp này biến lời khai thành phép đo: nó ĐỌC pg_catalog (nguồn sự thật độc lập với
-- mọi thứ 0350–0353 tự nói về mình) và RAISE EXCEPTION nếu thiếu. Migration đỏ ở
-- đây = `db:push` đỏ = không ai đi tiếp mà tưởng nền đã có.
--
-- Cầu chì kiểm 5 nhóm bất biến, KHÔNG kiểm "bảng có tồn tại" một cách hời hợt:
--   (1) 5 bảng mới đủ mặt
--   (2) 3 enum mới đủ mặt, và layoutlevelenum ĐÃ nở thêm SITE/BUILDING/FLOOR
--   (3) hai CHECK quaternion THỰC SỰ nằm trên bảng (không phải chỉ có trong tệp)
--   (4) UNIQUE(loaiThucThe,thucTheId) — bất biến chống-hệ-toạ-độ-thứ-tư
--   (5) 24/24 loại máy có kích thước mặc định, và cột 10A.4 + cột asset đủ mặt
-- ============================================================================

-- ─── (1) Năm bảng mới ───
DO $$
DECLARE thieu text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t) INTO thieu
  FROM unnest(ARRAY['twin_toa_nha','twin_tang','twin_dat_cho','twin_vat_the',
                    'twin_ban_ghi','twin_kich_thuoc_loai']) AS t
  WHERE to_regclass('public.' || t) IS NULL;
  IF thieu IS NOT NULL THEN
    RAISE EXCEPTION 'Twin D0: thieu bang %', thieu;
  END IF;
END $$;

-- ─── (2) Enum ───
DO $$
DECLARE thieu text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t) INTO thieu
  FROM unnest(ARRAY['twinnguonenum','twinthuctheenum','twinvattheenum']) AS t
  WHERE NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = t);
  IF thieu IS NOT NULL THEN
    RAISE EXCEPTION 'Twin D0: thieu enum %', thieu;
  END IF;
END $$;

-- layoutlevelenum phải nở đúng 3 nhãn mới, GIỮ NGUYÊN 3 nhãn cũ (kiểm cả hai
-- chiều: thiếu nhãn mới = 0350 không áp; mất nhãn cũ = ai đó đã tái tạo enum,
-- nguy hiểm hơn nhiều vì hàng factory_layouts cũ sẽ vỡ).
DO $$
DECLARE thieu text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t) INTO thieu
  FROM unnest(ARRAY['CORPORATION','FACTORY','WORKSHOP','SITE','BUILDING','FLOOR']) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
    WHERE ty.typname = 'layoutlevelenum' AND e.enumlabel = t
  );
  IF thieu IS NOT NULL THEN
    RAISE EXCEPTION 'Twin D0: layoutlevelenum thieu nhan %', thieu;
  END IF;
END $$;

-- ─── (3) CHECK quaternion thật sự nằm trên bảng ───
-- Một quaternion chưa chuẩn hoá làm vật thể co giãn méo trong cảnh mà KHÔNG lỗi
-- nào nổ. Nếu CHECK vắng mặt thì cả tầng bảo vệ đó là hư cấu.
DO $$
DECLARE thieu text;
BEGIN
  SELECT string_agg(c, ', ' ORDER BY c) INTO thieu
  FROM unnest(ARRAY['ck_toa_nha_quat','ck_dat_cho_quat','ck_vat_the_quat']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = c AND contype = 'c'
  );
  IF thieu IS NOT NULL THEN
    RAISE EXCEPTION 'Twin D0: thieu CHECK quaternion %', thieu;
  END IF;
END $$;

-- ─── (4) ★★★ Bất biến chống hệ toạ độ THỨ TƯ ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_twin_dat_cho_thuc_the' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'Twin D0: MAT rang buoc UNIQUE(loaiThucThe,thucTheId) — mot may co the co NHIEU vi tri, he toa do thu tu se ra doi';
  END IF;
END $$;

-- ─── (5) Cột 10A.4 + cột asset 0353 + phủ 24/24 loại máy ───
DO $$
DECLARE thieu text;
BEGIN
  SELECT string_agg(x.bang || '.' || x.cot, ', ' ORDER BY x.bang, x.cot) INTO thieu
  FROM (VALUES
    ('twin_tang','daiMm'), ('twin_tang','rongMm'), ('twin_tang','nguonHinhHoc'),
    ('twin_toa_nha','modelVoId'), ('twin_toa_nha','donViNguon'),
    ('workshops','tangId'),
    ('equipment_3d_models','soTamGiac'), ('equipment_3d_models','kichThuocByte'),
    ('equipment_3d_models','anhXemTruocUrl'), ('equipment_3d_models','phanLoai'),
    ('equipment_3d_models','nguonGoc')
  ) AS x(bang, cot)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = x.bang AND column_name = x.cot
  );
  IF thieu IS NOT NULL THEN
    RAISE EXCEPTION 'Twin D0: thieu cot %', thieu;
  END IF;
END $$;

DO $$
DECLARE so_enum integer; so_seed integer;
BEGIN
  SELECT count(*) INTO so_enum FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'machinetypeenum';
  SELECT count(*) INTO so_seed FROM twin_kich_thuoc_loai;
  IF so_seed < so_enum THEN
    RAISE EXCEPTION 'Twin D0: twin_kich_thuoc_loai phu %/% loai may', so_seed, so_enum;
  END IF;
  RAISE NOTICE 'Twin D0 nen mong DAT: %/% loai may co kich thuoc mac dinh (tat ca laGiaDinh=true)', so_seed, so_enum;
END $$;
