-- drizzle/0338_product_config_tree.sql
-- Pha 1A — cây CẤU HÌNH 4 cấp: surface → position → capture → component.
--
-- `measurement_point_defs` TRỞ THÀNH chính cấp component (nó đã mang limits/tolerance/
-- criteria/variant/delta-sync/spec-gate/revert). KHÔNG tạo bảng component thứ hai —
-- hai bảng cùng chứa limits = hai nguồn sự thật cho ngưỡng phán NG.
--
-- Mọi cột thêm vào bảng cũ đều NULLABLE, không backfill: NULL = điểm đo phẳng cũ,
-- chạy y như trước.
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501).

CREATE TABLE IF NOT EXISTS product_surfaces (
  id                  serial PRIMARY KEY,
  "productModelId"    integer NOT NULL REFERENCES product_models(id) ON DELETE CASCADE,
  "surfaceName"       varchar(100) NOT NULL,
  "surfaceExtId"      varchar(64),
  "templateImageUrl"  text,
  "templateImageKey"  varchar(255),
  "orderIndex"        integer NOT NULL DEFAULT 0,
  "createdAt"         timestamp NOT NULL DEFAULT now(),
  "updatedAt"         timestamp NOT NULL DEFAULT now()
);
-- ⚠⚠ SỬA 2026-09-03 (Khối B Task 5): migration **0347** THAY index này bằng
-- `uq_product_surfaces_model_may_name` (productModelId, **machineId**, surfaceName).
-- File 0338 vẫn RE-RUNNABLE (`scripts/apply-migration-0338.mjs` còn được dùng), và
-- một lượt chạy lại 0338 SAU 0347 sẽ DỰNG LẠI index cũ — đo được, không phải giả
-- định: chạy lại 0338 lúc 2026-09-03 đã phục sinh nó ở CẢ HAI DB. Index cũ sống lại
-- nghĩa là hai máy dạy cùng một product model lại GHI ĐÈ NHAU, IM LẶNG. Guard dưới
-- đây làm cho 0338 nhường 0347, và chỉ dựng index cũ trên DB CHƯA có bản thay.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_product_surfaces_model_may_name') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_product_surfaces_model_name
      ON product_surfaces ("productModelId", "surfaceName");
  ELSE
    RAISE NOTICE '[0338] bo qua uq_product_surfaces_model_name: 0347 da thay bang uq_product_surfaces_model_may_name (co chieu MAY)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS product_positions (
  id                  serial PRIMARY KEY,
  "surfaceRowId"      integer NOT NULL REFERENCES product_surfaces(id) ON DELETE CASCADE,
  "positionId"        varchar(64) NOT NULL,
  "positionIndex"     integer,
  "name"              varchar(255),
  "shape"             varchar(20),
  "markerWidth"       numeric(10,4),
  "markerHeight"      numeric(10,4),
  "markerRadius"      numeric(10,4),
  -- Toạ độ TƯƠNG ĐỐI 0..1 trên ảnh template surface. Máy LUÔN gửi giá trị đã resolve
  -- (tài liệu mẫu ghi rõ), nên payload thiếu là lỗi hợp đồng, không phải cần suy đoán.
  -- Đặt tên relX/relY để không lẫn với roiX/roiY là PIXEL TUYỆT ĐỐI.
  "relX"              numeric(10,8),
  "relY"              numeric(10,8),
  "templateImageUrl"  text,
  "templateImageKey"  varchar(255),
  "createdAt"         timestamp NOT NULL DEFAULT now(),
  "updatedAt"         timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_positions_surface_posid
  ON product_positions ("surfaceRowId", "positionId");

CREATE TABLE IF NOT EXISTS product_captures (
  id                  serial PRIMARY KEY,
  "positionRowId"     integer NOT NULL REFERENCES product_positions(id) ON DELETE CASCADE,
  -- = Capture.Id phía máy (GUID). Khoá join sang manifest ảnh VÀ sang teach data.
  "captureExtId"      varchar(64) NOT NULL,
  "captureName"       varchar(255),
  "captureIndex"      integer,
  "templateImageUrl"  text,
  "templateImageKey"  varchar(255),
  "createdAt"         timestamp NOT NULL DEFAULT now(),
  "updatedAt"         timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_captures_position_extid
  ON product_captures ("positionRowId", "captureExtId");

-- Neo cấp component lên capture. NULL = điểm đo phẳng cũ.
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "captureRowId"  integer REFERENCES product_captures(id) ON DELETE SET NULL;
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "componentExtId" varchar(64);
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "roiX"      integer;
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "roiY"      integer;
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "roiWidth"  integer;
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "roiHeight" integer;

CREATE INDEX IF NOT EXISTS idx_point_defs_capture ON measurement_point_defs ("captureRowId")
  WHERE "captureRowId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_point_defs_component_ext ON measurement_point_defs ("componentExtId")
  WHERE "componentExtId" IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON product_surfaces, product_positions, product_captures TO avi_app;
GRANT USAGE, SELECT ON SEQUENCE product_surfaces_id_seq, product_positions_id_seq, product_captures_id_seq TO avi_app;
