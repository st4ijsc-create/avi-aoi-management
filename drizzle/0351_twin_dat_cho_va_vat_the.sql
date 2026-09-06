-- ============================================================================
-- Migration 0351 — Twin 3D Đợt 0 (spec §5.3): ĐẶT CHỖ + VẬT THỂ + BẢN GHI.
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501).
-- ⚠ KHÔNG có một câu DELETE/UPDATE nào. Chỉ CREATE TYPE / CREATE TABLE / CREATE INDEX.
-- ⚠ PHỤ THUỘC 0350 (twin_tang, twinnguonenum). Chạy sau, không đảo thứ tự.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ★★★ VÌ SAO MỘT BẢNG `twin_dat_cho` THAY VÌ BỐN (§5.3)
-- ════════════════════════════════════════════════════════════════════════════
-- Hệ hiện tại đã có machine_positions + workshop_positions + factory_positions —
-- ba bảng cùng ngữ nghĩa "một vật thể có vị trí", đo được 36 / 0 / 0 hàng. Thuật
-- toán sinh bố cục, gizmo kéo-thả, undo/redo và API lưu batch đều thao tác ĐỒNG
-- NHẤT trên khái niệm đó; tách theo cấp buộc mọi thứ nhân bốn (bốn router, bốn
-- reducer, bốn đường undo) mà không mua thêm một bất biến nào.
--
-- ★★★ `UNIQUE ("loaiThucThe","thucTheId")` LÀ RÀNG BUỘC QUAN TRỌNG NHẤT BẢNG NÀY.
-- Một máy có ĐÚNG MỘT vị trí trong toàn hệ. Đây chính là thứ ngăn hệ toạ độ THỨ
-- TƯ ra đời — bài học đo được ở §5.1: hệ A (machines.layoutPositionX/Y, 0–1) và
-- hệ B (machine_positions, int pixel) đang song song và KHÔNG đồng bộ, vì không
-- có gì ở tầng DB cấm hai hàng cùng nói về một máy. Ở đây có.
--
-- ⚠ `thucTheId` KHÔNG có khoá ngoại — không thể có, vì nó trỏ vào bốn bảng khác
-- nhau tuỳ `loaiThucThe` (khoá ngoại đa hình). Đánh đổi được KHAI RÕ: DB không
-- cưỡng chế được "máy id=99 có tồn tại không", nên tầng service phải kiểm, và
-- script đối soát §5.6 phải đếm hàng mồ côi. Phương án thay thế (bốn cột FK
-- nullable + CHECK đúng-một-cột-khác-NULL) cưỡng chế được nhưng đưa lại đúng cái
-- "nhân bốn" mà bảng này sinh ra để tránh — và mỗi loại thực thể mới lại một cột.
--
-- KÍCH THƯỚC: rongMm/caoMm/sauMm để NULL ĐƯỢC (không NOT NULL DEFAULT). NULL ở
-- đây mang nghĩa "chưa biết" và kích hoạt chuỗi dự phòng §5.3:
--   twin_dat_cho (kichThuocDaDo=true) → equipment_3d_models.bounds
--   → twin_kich_thuoc_loai[machineType] → 1200×1800×800 mm.
-- Nếu đặt DEFAULT thì "chưa biết" biến thành "biết rồi, bằng 1200" — mất tin,
-- đúng lớp lỗi NT-3 "không có dữ liệu ≠ bình thường".
-- ============================================================================

-- ─── 1. Enum ───
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'twinnguonenum') THEN
    CREATE TYPE twinnguonenum AS ENUM ('sinh', 'tay');
  END IF;
END $$;

-- Cấp thực thể có thể đặt chỗ. 'workstation' tách khỏi 'station' vì hai bảng khác
-- nhau trong repo (stations / workstations) — gộp lại thì thucTheId nhập nhằng.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'twinthuctheenum') THEN
    CREATE TYPE twinthuctheenum AS ENUM ('workshop','line','station','machine','workstation');
  END IF;
END $$;

-- Vật thể cảnh KHÔNG thuộc cây phân cấp ISA-95.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'twinvattheenum') THEN
    CREATE TYPE twinvattheenum AS ENUM (
      'tuong','cot','cua','vach_ke','vung','ke','pallet',
      'bang_tai','rao_an_toan','bien_bao','nhom','khac'
    );
  END IF;
END $$;

-- ─── 2. twin_dat_cho ───
CREATE TABLE IF NOT EXISTS twin_dat_cho (
  id              serial PRIMARY KEY,
  "tangId"        integer NOT NULL REFERENCES twin_tang(id) ON DELETE CASCADE,
  "loaiThucThe"   twinthuctheenum NOT NULL,
  "thucTheId"     integer NOT NULL,
  "viTriXMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriYMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriZMm"      numeric(14,3) NOT NULL DEFAULT 0,
  -- NULL = chưa biết (xem docblock). KHÔNG đặt DEFAULT.
  "rongMm"        numeric(14,3),
  "caoMm"         numeric(14,3),
  "sauMm"         numeric(14,3),
  -- ★ false = ba cột trên (nếu có) là SUY RA, không phải ĐO. Badge "chưa đo".
  "kichThuocDaDo" boolean NOT NULL DEFAULT false,
  "quatX"         numeric(12,9) NOT NULL DEFAULT 0,
  "quatY"         numeric(12,9) NOT NULL DEFAULT 0,
  "quatZ"         numeric(12,9) NOT NULL DEFAULT 0,
  "quatW"         numeric(12,9) NOT NULL DEFAULT 1,
  "tiLeX"         numeric(10,6) NOT NULL DEFAULT 1,
  "tiLeY"         numeric(10,6) NOT NULL DEFAULT 1,
  "tiLeZ"         numeric(10,6) NOT NULL DEFAULT 1,
  "modelId"       integer REFERENCES equipment_3d_models(id) ON DELETE SET NULL,
  "daKhoa"        boolean NOT NULL DEFAULT false,
  "hienThi"       boolean NOT NULL DEFAULT true,
  nguon           twinnguonenum NOT NULL DEFAULT 'sinh',
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_twin_dat_cho_thuc_the UNIQUE ("loaiThucThe", "thucTheId"),
  CONSTRAINT ck_dat_cho_quat CHECK (
    abs("quatX"*"quatX" + "quatY"*"quatY" + "quatZ"*"quatZ" + "quatW"*"quatW" - 1) < 0.000001)
);
CREATE INDEX IF NOT EXISTS idx_twin_dat_cho_tang ON twin_dat_cho("tangId");
CREATE INDEX IF NOT EXISTS idx_twin_dat_cho_thuc_the ON twin_dat_cho("loaiThucThe","thucTheId");

-- ─── 3. twin_vat_the ───
-- Tường, cột, cửa, vạch kẻ sàn, VÙNG AN TOÀN (polygon), kệ, pallet, biển báo,
-- và mọi GLB người dùng nhập.
--
-- ⚠ `loai='vung'` + `diemDa` THAY THẾ `factory_zones` — an toàn vì factory_zones
-- đo được 0 DÒNG, nên KHÔNG có một byte dữ liệu nào để mất. Khác biệt: `points`
-- của factory_zones là toạ độ chuẩn hoá 0–1, còn `diemDa` ở đây là MM — nhất quán
-- với phần còn lại của hệ. Migration này KHÔNG xoá factory_zones (§5.4: bảng cũ
-- giữ nguyên, hai editor cũ chạy song song).
--
-- `chaId` tự tham chiếu: một file GLB nhập vào giữ được CÂY NODE gốc (mái/tường/cột
-- ẩn-hiện-xoá độc lập, §10A.1) thay vì bị bẹp thành một khối không tháo được.
CREATE TABLE IF NOT EXISTS twin_vat_the (
  id              serial PRIMARY KEY,
  "tangId"        integer NOT NULL REFERENCES twin_tang(id) ON DELETE CASCADE,
  "chaId"         integer REFERENCES twin_vat_the(id) ON DELETE CASCADE,
  loai            twinvattheenum NOT NULL,
  ten             varchar(255) NOT NULL,
  "modelId"       integer REFERENCES equipment_3d_models(id) ON DELETE SET NULL,
  "viTriXMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriYMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriZMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "rongMm"        numeric(14,3),
  "caoMm"         numeric(14,3),
  "sauMm"         numeric(14,3),
  "quatX"         numeric(12,9) NOT NULL DEFAULT 0,
  "quatY"         numeric(12,9) NOT NULL DEFAULT 0,
  "quatZ"         numeric(12,9) NOT NULL DEFAULT 0,
  "quatW"         numeric(12,9) NOT NULL DEFAULT 1,
  "tiLeX"         numeric(10,6) NOT NULL DEFAULT 1,
  "tiLeY"         numeric(10,6) NOT NULL DEFAULT 1,
  "tiLeZ"         numeric(10,6) NOT NULL DEFAULT 1,
  -- Màu ĐÈ tuỳ chọn (#RRGGBB / #RRGGBBAA). NULL = lấy màu theo `loai` từ
  -- mauTrangThai.ts. §10.2 CẤM hardcode hex trong component 3D; cột này là lối
  -- thoát cho VẬT TRANG TRÍ do người dùng tô, KHÔNG dùng cho màu trạng thái máy.
  mau             varchar(9),
  -- Polygon cho loai='vung' / 'vach_ke': [[xMm,yMm],…] trong hệ mm của tầng.
  "diemDa"        jsonb,
  "thuocTinh"     jsonb NOT NULL DEFAULT '{}',
  "thuTu"         integer NOT NULL DEFAULT 0,
  "daKhoa"        boolean NOT NULL DEFAULT false,
  "hienThi"       boolean NOT NULL DEFAULT true,
  -- ★ Mặc định 'tay' (KHÁC twin_dat_cho, mặc định 'sinh'): vật thể cảnh phần lớn
  -- do người vẽ tay. Tường bao sinh tự động (§10A.2) phải GHI ĐÈ thành 'sinh'.
  nguon           twinnguonenum NOT NULL DEFAULT 'tay',
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_vat_the_quat CHECK (
    abs("quatX"*"quatX" + "quatY"*"quatY" + "quatZ"*"quatZ" + "quatW"*"quatW" - 1) < 0.000001)
);
CREATE INDEX IF NOT EXISTS idx_twin_vat_the_tang ON twin_vat_the("tangId");
CREATE INDEX IF NOT EXISTS idx_twin_vat_the_cha ON twin_vat_the("chaId");

-- ─── 4. twin_ban_ghi — phiên bản bố cục ───
-- ★ MÀN VẬN HÀNH CHỈ ĐỌC BẢN `daXuatBan=true`. Người đang dựng kéo máy lung tung
-- KHÔNG được làm rối màn hình vận hành đang chạy — đây là lý do tồn tại của bảng
-- này, không phải "tính năng lịch sử cho vui".
CREATE TABLE IF NOT EXISTS twin_ban_ghi (
  id              serial PRIMARY KEY,
  "tangId"        integer NOT NULL REFERENCES twin_tang(id) ON DELETE CASCADE,
  nhan            varchar(255) NOT NULL,
  -- Ảnh chụp TOÀN BỘ đặt-chỗ + vật-thể của tầng tại thời điểm xuất bản. Tự chứa
  -- (không JOIN lại bảng sống) để một bản đã xuất bản KHÔNG đổi hình khi ai đó
  -- sửa bảng sống — đó chính là ý nghĩa của "phiên bản".
  "anhChup"       jsonb NOT NULL,
  "daXuatBan"     boolean NOT NULL DEFAULT false,
  "nguoiTao"      integer REFERENCES users(id),
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_twin_ban_ghi_tang ON twin_ban_ghi("tangId");
CREATE INDEX IF NOT EXISTS idx_twin_ban_ghi_xuat_ban ON twin_ban_ghi("tangId","daXuatBan");
