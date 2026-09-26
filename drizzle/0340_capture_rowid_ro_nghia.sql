-- drizzle/0340_capture_rowid_ro_nghia.sql
-- 0340 — Pha 1B. Ba việc, cùng một gốc rễ: cây KẾT QUẢ thiếu ràng buộc.
--
-- (1) BG-8 (§13 Đ-16): HAI cột cùng tên `captureRowId` kiểu int4 trỏ HAI bảng khác nhau,
--     chỉ MỘT có FK. Hai dãy id chồng khoảng ⇒ `JOIN ON r."captureRowId" = d."captureRowId"`
--     trông tự nhiên và trả về RÁC, không gì bắt được. Đổi tên + thêm FK thật.
--     An toàn: cột có 0 giá trị khác NULL trên cả hai DB (đo 2026-08-26).
-- (2) BG-11: cây KẾT QUẢ không có khử trùng, trong khi header CÓ. Gửi lại 1 bo ⇒ 2 cây.
-- (3) BG-13: cấp component là cấp DUY NHẤT không có unique ⇒ không có đích ON CONFLICT.
--
-- Mọi cột mới đều NULLABLE. KHÔNG có lệnh xoá dữ liệu.

-- ── (1) Đổi tên + FK thật ────────────────────────────────────────────────────
-- Bọc trong DO $$ kiểm tra tồn tại TRƯỚC — RENAME COLUMN/ADD CONSTRAINT tự thân
-- KHÔNG idempotent (lượt hai sẽ lỗi vì cột/ràng buộc đã đổi tên/đã có). Hai câu
-- ALTER TABLE bên trong giữ NGUYÊN VĂN như bản gốc, chỉ thêm điều kiện bao ngoài.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'measurement_results' AND a.attname = 'captureRowId' AND NOT a.attisdropped
  ) THEN
    ALTER TABLE measurement_results RENAME COLUMN "captureRowId" TO "inspectionCaptureRowId";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_measurement_results_inspection_capture') THEN
    ALTER TABLE measurement_results
      ADD CONSTRAINT fk_measurement_results_inspection_capture
      FOREIGN KEY ("inspectionCaptureRowId") REFERENCES inspection_captures(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN measurement_results."inspectionCaptureRowId" IS
  'Trỏ inspection_captures(id) — cây KẾT QUẢ. KHÔNG phải product_captures (cây CẤU HÌNH); '
  'cột đó tên là measurement_point_defs."captureRowId". Hai dãy id chồng khoảng.';

-- ── (2) Khử trùng cây KẾT QUẢ ────────────────────────────────────────────────
-- surface định danh bằng TÊN trong phạm vi một bo (QĐ-BG6).
CREATE UNIQUE INDEX IF NOT EXISTS uq_insp_surfaces_inspection_name
  ON inspection_surfaces ("inspectionId", "surfaceName");

CREATE UNIQUE INDEX IF NOT EXISTS uq_insp_positions_surface_posid
  ON inspection_positions ("surfaceRowId", "positionId");

-- ── (3) Đích ON CONFLICT cho cấp component ───────────────────────────────────
-- Riêng phần: chỉ áp cho hàng ĐÃ chuyển sang cây và chưa xoá mềm.
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_defs_capture_component
  ON measurement_point_defs ("captureRowId", "componentExtId")
  WHERE "captureRowId" IS NOT NULL AND "componentExtId" IS NOT NULL AND "deletedAt" IS NULL;
