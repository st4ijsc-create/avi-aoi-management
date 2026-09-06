-- ════════════════════════════════════════════════════════════════════════════
-- 0355 — Twin 3D Đợt 3 CHẶN-2: hai ràng buộc UNIQUE chỉ áp cho hàng ĐANG SỐNG
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★★★ LỖI ĐƯỢC VÁ — "xoá mềm rồi tạo lại cùng mã = ngõ cụt VĨNH VIỄN".
--
-- Migration 0350 dựng hai ràng buộc UNIQUE **không có** vị từ `isActive`:
--     uq_twin_toa_nha_factory_ma  UNIQUE ("factoryId", ma)
--     uq_twin_tang_toa_nha_cap    UNIQUE ("toaNhaId", "capSo")
-- trong khi `server/db/twinCanh.ts` xoá MỀM (`isActive = false`, cố ý: xoá cứng
-- kéo CASCADE mọi tầng + mọi vị trí máy người dùng đặt tay).
--
-- Hai quyết định đó cộng lại cho ra kịch bản hỏng ĐÃ ĐO trên DB thật:
--     1) dựng xưởng mã 'TN-A'        -> OK
--     2) gõ nhầm, bấm xoá            -> isActive=false, hàng VẪN NẰM TRONG BẢNG
--     3) dựng lại cũng mã 'TN-A'     -> 23505 duplicate key
-- Hàng chết vẫn giữ chỗ của mã, và KHÔNG có đường nào trong UI lấy lại mã đó
-- (không màn "thùng rác", không nút khôi phục). Mã mất VĨNH VIỄN — người dùng
-- phải đặt 'TN-A2' cho một toà nhà mà ai cũng gọi là TN-A.
--
-- ─── VÌ SAO CHỌN PARTIAL UNIQUE, KHÔNG CHỌN find-before-create ──────────────
-- Bản vá thay thế được cân nhắc là "hồi sinh hàng isActive=false cùng mã" ở tầng
-- ứng dụng (khuôn BG-93). KHÔNG chọn, ba lý do:
--   1. BẤT BIẾN SAI CHỖ. Điều ta muốn nói là "mã duy nhất trong số các toà nhà
--      ĐANG SỐNG". Đó là một mệnh đề về DỮ LIỆU, và chỗ của nó là DB. Vá ở tầng
--      ứng dụng để nguyên ràng buộc SAI dưới DB: mọi đường ghi tương lai (script
--      seed, import hàng loạt, Đợt 4 sinh tự động) lại vấp đúng hố này.
--   2. TOCTOU. find-before-create có khe giữa SELECT và INSERT; hai request song
--      song cùng mã vẫn cho ra 23505 — tức là vẫn phải viết bản vá (b) bắt 23505,
--      nhưng lại KHÔNG chữa được ngõ cụt. Được nửa việc với giá gấp đôi.
--   3. HỒI SINH LÀ DỮ LIỆU BẤT NGỜ. Hàng cũ mang tầng, kích thước, ảnh nền, vị trí
--      máy của lần dựng trước. "Tạo mới" mà lại nhận về hình học của người khác gõ
--      tuần trước là một cú ngạc nhiên tệ hơn cả lỗi — và nó CÂM.
--      (Khuôn BG-93 đúng ở chỗ nó dùng: bảng WORM append-only, nơi xoá là bất khả
--      nên "hồi sinh" là lối duy nhất. Ở đây xoá mềm đảo được, chỗ đó thật sự trống.)
--
-- ⚠ Bản vá (b) — bắt 23505 → `appError("CONFLICT", "ENTITY_DUPLICATE")` trong
--   `server/db/twinCanh.ts` — VẪN CẦN sau migration này và KHÔNG thừa: trùng mã
--   giữa hai toà nhà ĐANG SỐNG vẫn phải bị chặn, chỉ là phải chặn bằng một câu
--   người đọc hiểu thay vì rò nguyên văn INSERT kèm tên mọi cột ra client.
--
-- ⚠ KHÔNG dùng `CONSTRAINT ... UNIQUE`: cú pháp constraint của Postgres không
--   nhận vị từ WHERE. Partial unique BẮT BUỘC phải là INDEX. Hệ quả cần biết:
--   `ON CONFLICT ON CONSTRAINT <tên>` sẽ không còn dùng được cho hai chỗ này —
--   phải viết `ON CONFLICT (cột…) WHERE "isActive"`. Hiện KHÔNG có call site nào
--   dùng ON CONFLICT trên hai bảng này (đã grep), nên không có gì phải sửa theo.
--
-- ⚠ Migration NÀY tái chạy được (idempotent). Bài học BG-95: một migration tái
--   chạy phục sinh ràng buộc đã bỏ — nên dùng IF EXISTS / IF NOT EXISTS cả hai đầu.

-- ─── 1. twin_toa_nha: mã duy nhất trong số toà nhà ĐANG SỐNG của một nhà máy ───
ALTER TABLE twin_toa_nha DROP CONSTRAINT IF EXISTS uq_twin_toa_nha_factory_ma;
DROP INDEX IF EXISTS uq_twin_toa_nha_factory_ma;

CREATE UNIQUE INDEX IF NOT EXISTS uq_twin_toa_nha_factory_ma_song
  ON twin_toa_nha ("factoryId", ma)
  WHERE "isActive";

-- ─── 2. twin_tang: cấp số duy nhất trong số tầng ĐANG SỐNG của một toà nhà ───
-- Cùng lớp lỗi, cùng cách hỏng: xoá mềm tầng 2 rồi tạo lại tầng 2 là ngõ cụt.
ALTER TABLE twin_tang DROP CONSTRAINT IF EXISTS uq_twin_tang_toa_nha_cap;
DROP INDEX IF EXISTS uq_twin_tang_toa_nha_cap;

CREATE UNIQUE INDEX IF NOT EXISTS uq_twin_tang_toa_nha_cap_song
  ON twin_tang ("toaNhaId", "capSo")
  WHERE "isActive";
