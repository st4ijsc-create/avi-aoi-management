-- ============================================================================
-- Migration 0347 — Khối B Task 5 (B-6): CHIỀU **MÁY** + CHIỀU **PHIÊN BẢN**
-- cho cây DẠY (surface → position → capture → component).
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501). Nghiệm thu bằng vai
--   `avi_app` (cầu chì rolsuper/rolbypassrls trong scripts/apply-migration-0347.mjs).
-- ⚠ KHÔNG có một câu DELETE nào. Không xoá một byte dữ liệu lịch sử.
--
-- ════════════════════════════════════════════════════════════════════════════
-- VÌ SAO — nợ do Task 2 (`ac8d5ab2`) khai rõ và bàn giao (mối lo #4)
-- ════════════════════════════════════════════════════════════════════════════
-- Ba cấp trên của cây dạy KHÔNG có chiều máy nào; `uq_product_surfaces_model_name`
-- khoá theo `(productModelId, surfaceName)` ⇒ **hai máy đẩy hai cây khác nhau cho
-- CÙNG một product model GHI ĐÈ NHAU, im lặng**. Task 2 CỐ Ý để
-- `measurement_point_defs."machineId"` NULL vì gắn máy ở riêng cấp bốn là một
-- "chiều nửa vời" (hai nguồn sự thật về phạm vi) — đúng, và bản vá này đóng cả
-- bốn cấp cùng lúc thay vì lật quyết định đó.
--
-- ⚠⚠ VÌ SAO PHẢI XONG TRƯỚC Task 3 (Ruling R-KB-2): `measurement_results.pointDefId`
--    là **NOT NULL, KHÔNG default**. Hàng kết quả cấp component BẮT BUỘC khoá ngoại
--    vào một point-def. Nếu bản dạy còn dùng chung theo model, hàng của máy A trỏ
--    vào point-def CÓ THỂ của máy B — ghi SAI ngay lúc ghi, sửa sau phải di trú.
--
-- ════════════════════════════════════════════════════════════════════════════
-- HÌNH DẠNG ĐÃ CHỌN — hướng (A): cây dạy thuộc về `(máy, model)`
-- ════════════════════════════════════════════════════════════════════════════
-- Chiều máy có mặt ở **cả bốn cấp**, và ở ba cấp trên nó được CƯỠNG CHẾ bằng
-- **khoá ngoại GHÉP** chứ không phải bằng lời hứa của tầng ứng dụng:
--
--   product_positions ("surfaceRowId","machineId")  -> product_surfaces  (id,"machineId")
--   product_captures  ("positionRowId","machineId") -> product_positions (id,"machineId")
--   measurement_point_defs ("captureRowId","machineId") -> product_captures (id,"machineId")
--
-- => Một hàng con KHÔNG THỂ mang `machineId` khác cha nó. Đây là điểm khác biệt
--   giữa "thêm một cột máy vào ba bảng" (ba nguồn sự thật có thể lệch nhau) và
--   "một chiều máy DUY NHẤT hiện diện ở bốn cấp" (lệch là `23503`, ĐỎ TO).
--
-- ⚠ Ở cấp bốn, khoá ngoại ghép dùng MATCH SIMPLE (mặc định): nó KHÔNG cưỡng chế
--   khi một trong hai cột NULL. Điểm đo PHẲNG cũ (`captureRowId` NULL) vì thế đi
--   qua y như trước — đó là chủ đích. Lỗ "captureRowId có mà machineId NULL" được
--   bịt riêng bằng CHECK `ck_point_defs_cay_phai_co_may` bên dưới.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ĐO TRƯỚC KHI SỬA (vai `avi_app`, 2026-09-03) — vì sao mọi bước dưới đây AN TOÀN
-- ════════════════════════════════════════════════════════════════════════════
--   current_database()=aoi_management        product_surfaces/positions/captures = 0 hàng
--                                            measurement_point_defs = 110 hàng, captureRowId NOT NULL = 0
--   current_database()=aoi_management_test   product_surfaces/positions/captures = 0 hàng
--                                            measurement_point_defs = 2892 hàng, captureRowId NOT NULL = 0
-- => Ba bảng cây dạy RỖNG ở cả hai DB => `SET NOT NULL` không cần backfill.
-- => 100% hàng `measurement_point_defs` hiện có là điểm PHẲNG => CHECK bên dưới
--    đúng với mọi hàng đang sống, và index cấp bốn (xem §5) giữ NGUYÊN VĂN nghĩa cũ.
-- ⚠ Mỗi bước `SET NOT NULL` được canh bằng một `DO $$` ĐẾM hàng NULL và **RAISE
--   EXCEPTION** nếu có — thà migration ĐỎ TO còn hơn để lại một chiều nửa vời im lặng.
-- ============================================================================

-- ── §1. Cột `machineId` ở ba cấp trên ───────────────────────────────────────
-- KHÔNG khoá ngoại tới `machines` — cùng quy ước SOFT REFERENCE mà 0182/0187 đã
-- lập luận tường minh cho `inspection_program_releases."machineId"` và
-- `product_inspections."programReleaseId"`, và cùng quy ước với
-- `measurement_point_defs."machineId"` (đo `pg_constraint`: KHÔNG có FK). Giá trị
-- ghi vào luôn là `auth.machine.id` — id máy ĐÃ XÁC THỰC, không phải nhãn tự khai.
ALTER TABLE product_surfaces  ADD COLUMN IF NOT EXISTS "machineId" integer;
ALTER TABLE product_positions ADD COLUMN IF NOT EXISTS "machineId" integer;
ALTER TABLE product_captures  ADD COLUMN IF NOT EXISTS "machineId" integer;

DO $$
DECLARE n_s int; n_p int; n_c int;
BEGIN
  SELECT count(*) INTO n_s FROM product_surfaces  WHERE "machineId" IS NULL;
  SELECT count(*) INTO n_p FROM product_positions WHERE "machineId" IS NULL;
  SELECT count(*) INTO n_c FROM product_captures  WHERE "machineId" IS NULL;
  IF n_s + n_p + n_c > 0 THEN
    RAISE EXCEPTION '[0347] KHONG the SET NOT NULL: con % surface / % position / % capture chua co machineId. Backfill chung TRUOC (moi hang phai thuoc dung MOT may) roi chay lai. Migration nay TU CHOI de lai mot chieu may NUA VOI.', n_s, n_p, n_c;
  END IF;
  ALTER TABLE product_surfaces  ALTER COLUMN "machineId" SET NOT NULL;
  ALTER TABLE product_positions ALTER COLUMN "machineId" SET NOT NULL;
  ALTER TABLE product_captures  ALTER COLUMN "machineId" SET NOT NULL;
  RAISE NOTICE '[0347] machineId NOT NULL tren ca ba bang cay day';
END $$;

COMMENT ON COLUMN product_surfaces."machineId" IS
  'Khối B Task 5 (0347): máy ĐÃ XÁC THỰC đã dạy mặt này. Soft ref machines(id) — cùng quy ước 0182/0187. GỐC của chiều máy: ba cấp dưới thừa hưởng qua khoá ngoại GHÉP, không phải bằng lời hứa tầng ứng dụng.';
COMMENT ON COLUMN product_positions."machineId" IS
  'Khối B Task 5 (0347): = product_surfaces."machineId" của cha, CƯỠNG CHẾ bằng fk_positions_surface_may. Không thể lệch.';
COMMENT ON COLUMN product_captures."machineId" IS
  'Khối B Task 5 (0347): = product_positions."machineId" của cha, CƯỠNG CHẾ bằng fk_captures_position_may. Không thể lệch.';

-- ── §2. Đích cho khoá ngoại GHÉP ────────────────────────────────────────────
-- Postgres đòi cột được tham chiếu phải có UNIQUE. `id` đã là PK; cặp (id, machineId)
-- cần index riêng để làm đích cho FK ghép.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_surfaces_id_may  ON product_surfaces  (id, "machineId");
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_positions_id_may ON product_positions (id, "machineId");
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_captures_id_may  ON product_captures  (id, "machineId");

-- ── §3. Khoá ngoại GHÉP — chiều máy KHÔNG THỂ lệch giữa cha và con ──────────
-- Giữ NGUYÊN các FK một-cột đã có (`*_surfaceRowId_fkey`, `*_positionRowId_fkey`,
-- `measurement_point_defs_captureRowId_fkey`): chúng vẫn đúng, và ON DELETE của
-- chúng không đổi. FK ghép chỉ THÊM một ràng buộc, không thay ràng buộc nào.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_positions_surface_may') THEN
    ALTER TABLE product_positions ADD CONSTRAINT fk_positions_surface_may
      FOREIGN KEY ("surfaceRowId", "machineId") REFERENCES product_surfaces (id, "machineId")
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_captures_position_may') THEN
    ALTER TABLE product_captures ADD CONSTRAINT fk_captures_position_may
      FOREIGN KEY ("positionRowId", "machineId") REFERENCES product_positions (id, "machineId")
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_point_defs_capture_may') THEN
    -- MATCH SIMPLE: KHÔNG cưỡng chế khi một cột NULL => điểm đo PHẲNG cũ đi qua y
    -- như trước. ON DELETE SET NULL trùng hành vi FK một-cột đã có (0338).
    ALTER TABLE measurement_point_defs ADD CONSTRAINT fk_point_defs_capture_may
      FOREIGN KEY ("captureRowId", "machineId") REFERENCES product_captures (id, "machineId")
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── §4. Khoá hội tụ cấp surface PHẢI mang chiều máy ────────────────────────
-- ĐÂY là chỗ hai máy ghi đè nhau. `uq_product_surfaces_model_name` (productModelId,
-- surfaceName) khiến máy B UPDATE đúng hàng của máy A. Thay bằng bộ ba.
DROP INDEX IF EXISTS uq_product_surfaces_model_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_surfaces_model_may_name
  ON product_surfaces ("productModelId", "machineId", "surfaceName");

-- Cấp 2/3 KHÔNG cần đổi index: `uq_product_positions_surface_posid` khoá theo
-- `surfaceRowId` và `uq_product_captures_position_extid` khoá theo `positionRowId`
-- — hai khoá đó ĐÃ thuộc phạm vi một máy ngay khi cấp surface thuộc một máy. Thêm
-- `machineId` vào chính hai index ấy sẽ KHÔNG siết thêm gì (nó là hàm của cột kia)
-- mà chỉ làm to index.

-- ── §5. Cấp component — hai phạm vi RỜI NHAU, không chồng lấn ──────────────
-- ⚠ Đây là bẫy đo được, KHÔNG có trong kế hoạch: `uq_point_defs_product_variant_code`
--   khoá `(productModelId, COALESCE(variantId,0), code)` mà `code` = `componentExtId`.
--   Hai máy dạy CÙNG một sản phẩm rất hay mang CÙNG bộ UUID linh kiện (clone bản dạy
--   từ máy A sang máy B rồi sửa) => lượt đẩy của máy thứ hai sẽ vỡ `23505` ở một index
--   KHÔNG AI NHẮM, dù cấp surface đã tách máy xong.
-- Cách xử: TÁCH thành hai index riêng phần RỜI NHAU theo `captureRowId`:
--   · hàng PHẲNG (`captureRowId IS NULL`)     -> giữ NGUYÊN VĂN nghĩa cũ, KHÔNG có máy.
--     Đo được: 100% hàng hiện có ở CẢ HAI DB là hàng phẳng => ràng buộc trên dữ liệu
--     đang sống KHÔNG đổi một chút nào.
--   · hàng CÂY   (`captureRowId IS NOT NULL`) -> thêm `COALESCE("machineId",0)`.
-- Giữ nguyên TÊN `uq_point_defs_product_variant_code` cho nhánh phẳng: hai lưới
-- (`server/db/measurementPointIntegrity.test.ts`, `server/db/productVariant.test.ts`)
-- ghim đúng tên đó trong `pg_indexes`; đổi tên là làm đỏ hai lưới KHÔNG liên quan.
DROP INDEX IF EXISTS uq_point_defs_product_variant_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_defs_product_variant_code
  ON measurement_point_defs ("productModelId", COALESCE("variantId", 0), code)
  WHERE "deletedAt" IS NULL AND "captureRowId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_point_defs_cay_may_code
  ON measurement_point_defs ("productModelId", COALESCE("variantId", 0), COALESCE("machineId", 0), code)
  WHERE "deletedAt" IS NULL AND "captureRowId" IS NOT NULL;

-- Hàng CÂY thì BẮT BUỘC có máy. Không có cột nào khác cưỡng chế được điều này
-- (FK ghép MATCH SIMPLE bỏ qua khi có NULL) — nên nó phải là một CHECK.
DO $$
DECLARE n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_point_defs_cay_phai_co_may') THEN
    SELECT count(*) INTO n FROM measurement_point_defs
      WHERE "captureRowId" IS NOT NULL AND "machineId" IS NULL;
    IF n > 0 THEN
      RAISE EXCEPTION '[0347] % hang point-def CO captureRowId ma KHONG co machineId. Do la dung "chieu nua voi" ma ban va nay dong. Backfill machineId cho chung TRUOC.', n;
    END IF;
    ALTER TABLE measurement_point_defs ADD CONSTRAINT ck_point_defs_cay_phai_co_may
      CHECK ("captureRowId" IS NULL OR "machineId" IS NOT NULL);
  END IF;
END $$;

-- ── §6. Chiều PHIÊN BẢN — sổ bản dạy per `(máy, model)` ─────────────────────
-- ⚠ ĐO TRƯỚC RỒI MỚI KẾT LUẬN: `inspection_program_releases` (ứng viên kế hoạch nêu)
--   KHÔNG tái dùng được, ba lý do đo được chứ không phải cảm tính:
--   (1) `uq_prog_rel_product_version` là UNIQUE `("productModelId", version)` — số
--       phiên bản thuộc phạm vi SẢN PHẨM, không phải `(máy, model)`. Một lượt đẩy của
--       máy sẽ TIÊU một số phiên bản của sổ NGƯỜI KÝ.
--   (2) Vòng đời của nó đòi NGƯỜI duyệt có SoD (`approvedBy` ≠ `createdBy`, cưỡng chế
--       ở `server/services/inspectionProgramService.ts`). Cho một MÁY tự đẩy tới trạng
--       thái `released` là mở một lỗ quản trị: máy tự ký production truth.
--   (3) `snapshot` của nó là bộ điểm PHẲNG + ngưỡng do `createRelease` dựng từ
--       `measurement_point_defs`, không phải cây bốn cấp.
--   => Sổ RIÊNG, và hai sổ KHÔNG đụng nhau: sổ này ghi "máy đã dạy gì", sổ kia ghi
--     "người đã ký gì". Đo: `inspection_program_releases` = 0 hàng (dev) / 169 hàng
--     (test, 169 `released`, 0 hàng có `machineId`).
CREATE TABLE IF NOT EXISTS machine_template_versions (
  id                  serial PRIMARY KEY,
  -- Soft ref machines(id) — cùng quy ước §1.
  "machineId"         integer NOT NULL,
  "productModelId"    integer NOT NULL REFERENCES product_models(id) ON DELETE CASCADE,
  -- Đơn điệu theo (machineId, productModelId) — KHÔNG theo productModelId như 0182.
  version             integer NOT NULL,
  -- sha256 ỔN ĐỊNH của cây đã hợp lệ hoá (khoá sắp xếp). Trùng checksum => KHÔNG
  -- sinh phiên bản mới: một máy khởi động lại và đẩy lại cây Y HỆT không được đẻ
  -- ra một phiên bản mới mỗi lần. Cùng vai trò `checksum` của 0182 ("dedup/diff/
  -- tamper-evidence"), và là thứ giữ được bất biến HỘI TỤ mà Task 2 đã dựng.
  checksum            varchar(64) NOT NULL,
  "surfaceCount"      integer NOT NULL DEFAULT 0,
  "positionCount"     integer NOT NULL DEFAULT 0,
  "captureCount"      integer NOT NULL DEFAULT 0,
  "componentCount"    integer NOT NULL DEFAULT 0,
  -- BẤT BIẾN: cây NGUYÊN VĂN lúc đẩy. Đây là thứ trả lời được "bo CŨ chấm theo bản
  -- dạy nào" — hàng `measurement_point_defs` bị lượt đẩy sau GHI ĐÈ tại chỗ (đó là
  -- giá của bất biến hội tụ), nên nếu không chụp lại ở đây thì nghĩa của dữ liệu đã
  -- ghi SẼ đổi khi đẩy bản mới. Cùng vai trò `inspection_program_releases.snapshot`.
  snapshot            jsonb NOT NULL,
  "pushedAt"          timestamp NOT NULL DEFAULT now(),
  -- Lượt đẩy TRÙNG checksum gần nhất (máy vẫn sống, cây không đổi).
  "lastSeenAt"        timestamp NOT NULL DEFAULT now(),
  -- NULL = bản HIỆN HÀNH. Cùng với `pushedAt` tạo KHOẢNG [pushedAt, supersededAt)
  -- — đó là cách tra "bo chấm lúc T theo bản dạy nào" mà KHÔNG phải thêm cột vào
  -- `measurement_results` (hypertable ĐÃ NÉN, đo `timescaledb_information.hypertables`).
  "supersededAt"      timestamp,
  "previousVersionId" integer REFERENCES machine_template_versions(id) ON DELETE SET NULL,
  "createdAt"         timestamp NOT NULL DEFAULT now(),
  "updatedAt"         timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mtv_may_model_version
  ON machine_template_versions ("machineId", "productModelId", version);
-- ĐÚNG MỘT bản hiện hành cho mỗi (máy, model) — cưỡng chế ở DB, không ở lời hứa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mtv_hien_hanh
  ON machine_template_versions ("machineId", "productModelId")
  WHERE "supersededAt" IS NULL;
CREATE INDEX IF NOT EXISTS idx_mtv_khoang
  ON machine_template_versions ("machineId", "productModelId", "pushedAt");

COMMENT ON TABLE machine_template_versions IS
  'Khối B Task 5 (0347): sổ BẢN DẠY do MÁY đẩy, phạm vi (machineId, productModelId). KHÁC inspection_program_releases (sổ NGƯỜI KÝ, version theo productModelId, cần duyệt SoD). Append-only: không lượt đẩy nào xoá hàng cũ, chỉ đóng khoảng bằng supersededAt.';

-- Cột trỏ ngược: hàng point-def này được bản dạy nào ghi lần cuối.
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "templateVersionId" integer;
COMMENT ON COLUMN measurement_point_defs."templateVersionId" IS
  'Khối B Task 5 (0347): machine_template_versions(id) đã ghi hàng này lần CUỐI (soft ref). NULL = điểm đo phẳng cũ / hàng chưa qua cửa cây dạy. Muốn biết bo CŨ chấm theo bản nào thì tra KHOẢNG [pushedAt, supersededAt) — cột này chỉ nói bản HIỆN TẠI.';
CREATE INDEX IF NOT EXISTS idx_point_defs_template_version
  ON measurement_point_defs ("templateVersionId") WHERE "templateVersionId" IS NOT NULL;

-- ── §7. Quyền cho vai ứng dụng ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON machine_template_versions TO avi_app;
GRANT USAGE, SELECT ON SEQUENCE machine_template_versions_id_seq TO avi_app;
