-- ============================================================================
-- Migration 0350 — Twin 3D Đợt 0 (spec 2026-09-06-nha-may-3d-digital-twin-design §5.3,
-- §5.4, §10A.4): TOÀ NHÀ + TẦNG — cấp không gian mà hệ hiện tại KHÔNG CÓ.
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501). Xem scripts/apply-migration-0350.mjs.
-- ⚠ KHÔNG có một câu DELETE/UPDATE nào trên dữ liệu có sẵn. Chỉ CREATE + ALTER ADD.
--
-- ════════════════════════════════════════════════════════════════════════════
-- VÌ SAO (§1.3 — đo được trên DB dev 2026-09-06)
-- ════════════════════════════════════════════════════════════════════════════
-- "Không có bảng buildings/floors" = 0 bảng ⇒ campus nhiều toà nhà KHÔNG dựng
-- được. Đây là chặn cứng, không phải thiếu tiện nghi: `workshops` treo thẳng vào
-- `factories`, nên "xưởng ở tầng mấy của toà nào" không có chỗ để lưu.
--
-- ĐƠN VỊ: mọi cột hình học là MILIMÉT (numeric 14,3) — §5.2. Người dùng nhập bằng
-- mét ở UI, quy đổi ở MỘT module thuần `heToaDo.ts`. Lý do lưu mm: đặt máy chính
-- xác tới mm mà vẫn biểu diễn được khuôn viên 10 km (14 chữ số).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ VÌ SAO KHÔNG DI TRÚ `factories.floorWidthM/floorDepthM` (§10A.0)
-- ════════════════════════════════════════════════════════════════════════════
-- Đo được: SIM-FAC có floorWidthM=1500, floorDepthM=1200. Đọc đúng đơn vị = 1,5 km
-- × 1,2 km — vô lý cho một xưởng lắp ráp; gần như chắc chắn ai đó nhập PIXEL vào ô
-- MÉT. Ba nhà máy còn lại NULL. Nên `twin_tang` để MẶC ĐỊNH và mang cờ
-- `nguonHinhHoc='sinh'` (badge "chưa đo"), thay vì thừa kế một con số rác mà sau
-- này không ai truy được nguồn. Script `scripts/di-tru-bo-cuc-twin.ts` BỊ CẤM đọc
-- hai cột đó.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUATERNION, KHÔNG PHẢI EULER
-- ════════════════════════════════════════════════════════════════════════════
-- `machine_positions.rotation/rotationY/rotationZ` là int Euler và = 0 ở 36/36 hàng.
-- Euler có gimbal lock + phụ thuộc thứ tự trục; three.js nội bộ dùng quaternion.
-- CHECK `|q|² − 1| < 1e-6` cưỡng chế chuẩn hoá TẠI DB — một quaternion chưa chuẩn
-- hoá làm vật thể co giãn méo trong cảnh mà KHÔNG có lỗi nào nổ (lỗi câm).
-- Mặc định (0,0,0,1) = không xoay, thoả CHECK.
--
-- TÁI CHẠY ĐƯỢC (BG-95 — migration tái chạy phục sinh ràng buộc đã bỏ): mọi câu
-- dùng IF NOT EXISTS / DO $$ có kiểm tra tồn tại, nên chạy N lần = chạy 1 lần.
-- ============================================================================

-- ─── 1. Enum nguồn: 'sinh' (máy sinh, badge "chưa đo") vs 'tay' (người nhập) ───
-- NT-4: số giả định PHẢI TỰ KHAI là giả định. Enum này là cách khai đó ở tầng DB,
-- không phải quy ước tầng ứng dụng (quy ước thì quên được, enum thì không).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'twinnguonenum') THEN
    CREATE TYPE twinnguonenum AS ENUM ('sinh', 'tay');
  END IF;
END $$;

-- ─── 2. layoutLevelEnum: thêm SITE / BUILDING / FLOOR (§5.4) ───
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS là additive thuần: giá trị cũ
-- (CORPORATION/FACTORY/WORKSHOP) KHÔNG đổi thứ tự, hàng cũ KHÔNG đụng tới.
ALTER TYPE layoutlevelenum ADD VALUE IF NOT EXISTS 'SITE';
ALTER TYPE layoutlevelenum ADD VALUE IF NOT EXISTS 'BUILDING';
ALTER TYPE layoutlevelenum ADD VALUE IF NOT EXISTS 'FLOOR';

-- ─── 3. twin_toa_nha ───
CREATE TABLE IF NOT EXISTS twin_toa_nha (
  id              serial PRIMARY KEY,
  "factoryId"     integer NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  ma              varchar(64)  NOT NULL,
  ten             varchar(255) NOT NULL,
  -- Vị trí góc toà nhà trong khuôn viên, mm, gốc = gốc khuôn viên nhà máy.
  "viTriXMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriYMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriZMm"      numeric(14,3) NOT NULL DEFAULT 0,
  -- Bao ngoài. Mặc định 60×40×12 m = một xưởng vừa, KHÔNG phải số đo (nguon='sinh').
  "rongMm"        numeric(14,3) NOT NULL DEFAULT 60000,
  "sauMm"         numeric(14,3) NOT NULL DEFAULT 40000,
  "caoMm"         numeric(14,3) NOT NULL DEFAULT 12000,
  "quatX"         numeric(12,9) NOT NULL DEFAULT 0,
  "quatY"         numeric(12,9) NOT NULL DEFAULT 0,
  "quatZ"         numeric(12,9) NOT NULL DEFAULT 0,
  "quatW"         numeric(12,9) NOT NULL DEFAULT 1,
  -- §10A.4 — vỏ nhà nhập từ bản vẽ (con đường A). NULL = dựng bằng khối (con đường B).
  "modelVoId"     integer REFERENCES equipment_3d_models(id) ON DELETE SET NULL,
  -- §10A.4 — đơn vị của file gốc ('mm'|'cm'|'m'|'inch'), để mở lại hộp thoại hiệu
  -- chỉnh khi phát hiện nhập sai đơn vị (nhập sai = nhà to gấp 1000 lần).
  "donViNguon"    varchar(8),
  nguon           twinnguonenum NOT NULL DEFAULT 'sinh',
  "isActive"      boolean NOT NULL DEFAULT true,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_twin_toa_nha_factory_ma UNIQUE ("factoryId", ma),
  CONSTRAINT ck_toa_nha_quat CHECK (
    abs("quatX"*"quatX" + "quatY"*"quatY" + "quatZ"*"quatZ" + "quatW"*"quatW" - 1) < 0.000001)
);
CREATE INDEX IF NOT EXISTS idx_twin_toa_nha_factory ON twin_toa_nha("factoryId");

-- ─── 4. twin_tang ───
CREATE TABLE IF NOT EXISTS twin_tang (
  id                serial PRIMARY KEY,
  "toaNhaId"        integer NOT NULL REFERENCES twin_toa_nha(id) ON DELETE CASCADE,
  -- 1,2,3… ; ÂM = hầm. Không dùng 0 để tránh nhập nhằng "tầng trệt" vs "chưa đặt".
  "capSo"           integer NOT NULL,
  ten               varchar(255) NOT NULL,
  -- Cao độ SÀN của tầng so với gốc toà nhà (mm). Tầng 1 = 0.
  "caoDoMm"         numeric(14,3) NOT NULL DEFAULT 0,
  "caoThongThuyMm"  numeric(14,3) NOT NULL DEFAULT 6000,
  -- §10A.4 — kích thước MẶT SÀN (có thể nhỏ hơn toà nhà: tầng lửng/kỹ thuật).
  "daiMm"           numeric(14,3),
  "rongMm"          numeric(14,3),
  -- §10A.4 — 'nhap_tay' | 'ban_ve' | 'sinh'. varchar chứ không enum: ba giá trị này
  -- thuộc quy trình NHẬP LIỆU (còn thêm nguồn mới ở §16: dxf, dwg, quét laser…),
  -- không phải bất biến ngữ nghĩa như `nguon`; ALTER TYPE cho mỗi nguồn mới là phí.
  "nguonHinhHoc"    varchar(16) NOT NULL DEFAULT 'sinh',
  -- Ảnh nền mặt bằng + tỉ lệ hiệu chuẩn (công cụ "Đặt tỉ lệ", §7.4).
  "anhNenUrl"       text,
  "anhNenKey"       text,
  "tiLeMmMoiPx"     numeric(12,6),
  -- ★ `daHieuChuan=false` là mặc định CỐ Ý: chưa ai click hai điểm + nhập khoảng
  -- cách thật thì tỉ lệ chỉ là phỏng đoán, và UI phải nói thế.
  "daHieuChuan"     boolean NOT NULL DEFAULT false,
  nguon             twinnguonenum NOT NULL DEFAULT 'sinh',
  "isActive"        boolean NOT NULL DEFAULT true,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_twin_tang_toa_nha_cap UNIQUE ("toaNhaId", "capSo")
);
CREATE INDEX IF NOT EXISTS idx_twin_tang_toa_nha ON twin_tang("toaNhaId");

-- ─── 5. workshops.tangId (§5.4) ───
-- ON DELETE SET NULL, KHÔNG CASCADE: xoá một tầng không được kéo theo cái xưởng
-- (xưởng là thực thể nghiệp vụ có lịch sử sản xuất; tầng chỉ là chỗ nó đứng).
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS "tangId" integer;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_workshops_tang'
  ) THEN
    ALTER TABLE workshops
      ADD CONSTRAINT fk_workshops_tang
      FOREIGN KEY ("tangId") REFERENCES twin_tang(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_workshops_tang ON workshops("tangId");
