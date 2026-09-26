-- ============================================================================
-- Migration 0353 — Twin 3D Đợt 0 (spec §5.4): MỞ RỘNG `equipment_3d_models`
-- thành THƯ VIỆN ASSET dùng được, thay vì một sổ đăng ký URI trần.
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501).
-- ⚠ KHÔNG có một câu DELETE/UPDATE nào. Chỉ ALTER TABLE ADD COLUMN IF NOT EXISTS.
-- ⚠ `bounds` ĐÃ CÓ SẴN (jsonb, drizzle/schema/twin.ts:64) — migration này KHÔNG
--   động vào nó. Đo được: NULL ở 5/5 hàng, tức cột có sẵn nhưng CHƯA AI ĐIỀN.
--
-- ════════════════════════════════════════════════════════════════════════════
-- VÌ SAO — không có bốn cột này thì thư viện asset không dùng được
-- ════════════════════════════════════════════════════════════════════════════
-- §4 đặt ngân sách hiệu năng theo SỐ TAM GIÁC; §10A.1 chặn nhập ở >2.000.000 tam
-- giác / >60 MB. Cả hai NGƯỠNG ĐÓ KHÔNG THỰC THI ĐƯỢC nếu hệ không lưu lại hai
-- con số đó lúc nạp — mỗi lần muốn biết "file này nặng bao nhiêu" lại phải tải
-- toàn bộ GLB về và đếm, tức là ngưỡng chỉ tồn tại trên giấy.
--
-- `anhXemTruocUrl`: bộ chọn asset không có ảnh xem trước buộc người dùng nạp thử
-- từng model để biết nó là cái gì — với model 40 MB thì đó là vài phút mỗi lần thử.
--
-- `phanLoai` vs `equipmentClass` (ĐÃ CÓ SẴN) — HAI THỨ KHÁC NHAU, không trùng:
--   • `equipmentClass` = LOẠI THIẾT BỊ mà model này đại diện ('AOI','ROBOT') và
--     được dùng để RESOLVE model cho một máy cụ thể.
--   • `phanLoai`       = NGĂN trong thư viện asset ('may','noi_that','ha_tang',
--     'nhan_dien'…) để lọc lúc DUYỆT. Một model 'ke hang' có phanLoai='noi_that'
--     và equipmentClass=NULL — nó không đại diện cho loại thiết bị nào cả.
--   Nhập hai khái niệm này vào một cột là lỗi câm: bộ lọc thư viện sẽ vô tình
--   ràng buộc kết quả resolve của cảnh 3D.
--
-- `nguonGoc` DEFAULT 'builtin': mọi hàng CÓ SẴN (5 hàng) được coi là model đi kèm
-- hệ, vì chúng được đăng ký bởi mã nguồn chứ không do người dùng tải lên. Đây là
-- suy luận về 5 hàng hiện có, KHÔNG phải phép đo — nhưng nó không mất tin: giá
-- trị 'nguoi_dung' chỉ được đặt bởi đường tải-lên trong §10A.1, nên phân biệt
-- "asset xoá được / asset của hệ" hình thành đúng từ lúc có đường tải lên.
-- ============================================================================

-- Số tam giác đọc từ file lúc nạp (§4 ngân sách, §10A.1 ngưỡng chặn 2.000.000).
ALTER TABLE equipment_3d_models ADD COLUMN IF NOT EXISTS "soTamGiac" integer;

-- Kích thước file byte. bigint chứ không integer: trần 60 MB của v1 vừa integer,
-- nhưng cột này còn dùng cho asset lịch sử/CAD gốc, và một int tràn ở 2,1 GB là
-- lỗi câm đắt hơn 4 byte tiết kiệm được.
ALTER TABLE equipment_3d_models ADD COLUMN IF NOT EXISTS "kichThuocByte" bigint;

-- Ảnh xem trước (thumbnail render). NULL = chưa render, UI hiện hình khối mặc định.
ALTER TABLE equipment_3d_models ADD COLUMN IF NOT EXISTS "anhXemTruocUrl" text;

-- Ngăn thư viện — KHÔNG PHẢI equipmentClass (xem docblock).
ALTER TABLE equipment_3d_models ADD COLUMN IF NOT EXISTS "phanLoai" varchar(64);

-- 'builtin' | 'nguoi_dung'. varchar chứ không enum: 0353 đã phải bám vào
-- machinetypeenum có sẵn; thêm một enum mới cho hai giá trị làm ALTER TYPE
-- xuất hiện ở mọi lần mở rộng sau (vd 'nha_cung_cap', 'thu_vien_chung').
ALTER TABLE equipment_3d_models
  ADD COLUMN IF NOT EXISTS "nguonGoc" varchar(16) NOT NULL DEFAULT 'builtin';

-- Lọc thư viện theo ngăn + nguồn gốc là truy vấn duyệt chính của §7.4.
CREATE INDEX IF NOT EXISTS idx_eq3d_phan_loai ON equipment_3d_models("phanLoai");
CREATE INDEX IF NOT EXISTS idx_eq3d_nguon_goc ON equipment_3d_models("nguonGoc");
