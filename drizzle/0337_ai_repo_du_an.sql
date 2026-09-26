-- ★★★ QUẢN LÝ DỰ ÁN (2026-08-23) — bảng `ai_repo_du_an`: dự án hộp cát ĐĂNG KÝ QUA UI (nguồn DB).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ PHẢI CHẠY BẰNG OWNER `aoi`. Bằng `avi_app` sẽ nhận `42501 must be owner of ...`.
--    Áp CẢ HAI CSDL: `aoi_management` VÀ `aoi_management_test`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO CÓ BẢNG NÀY — VÀ VÌ SAO NÓ **KHÔNG** THAY `.env`
-- ----------------------------------------------------------------------------------------------
-- Hôm nay thêm một dự án cho không gian lập trình AI = sửa tay `AI_REPO_SANDBOX_ROOTS` trong
-- `.env` + khởi động lại. Bảng này mở MỘT đường qua UI cho admin (mutation `repoWorkspace.themDuAn`,
-- sàn `adminProcedure` + 2FA) — cùng mức tin cậy với việc admin sửa `.env`. Hai nguồn CỘNG lại,
-- không thay nhau:
--   • mục từ `.env` giữ nguyên, KHÔNG xoá được qua UI (env thắng khi trùng `id`);
--   • bảng này chỉ THÊM; xoá qua UI chỉ chạm được mục nguồn DB.
--
-- BẤT BIẾN "CLIENT GỬI ID, KHÔNG GỬI ĐƯỜNG DẪN" **KHÔNG ĐỔI**
-- ----------------------------------------------------------------------------------------------
-- Mọi lượt THỰC THI tool vẫn chỉ nhận `id`; server tra id → gốc (`repoProjects.gocTheoId`). Đường
-- dẫn xuất hiện đúng MỘT chỗ mới: mutation ĐĂNG KÝ của admin — và server xác thực fail-closed
-- (tuyệt đối · realpath tồn tại · là thư mục · không lồng gốc đã có · không thư mục cấm · trần số
-- mục) TRƯỚC khi một hàng được ghi. Xem `repoProjects.kiemTraDangKyDuAn` + lưới
-- `server/routers/quanLyDuAnRepo.test.ts`.
--
-- CHECK Ở TẦNG CSDL — LỚP CUỐI, KHÔNG PHẢI LỚP DUY NHẤT
-- ----------------------------------------------------------------------------------------------
--   1. `chk_ai_repo_du_an_id` — `id` phải là **ID** (`[A-Za-z0-9_-]{1,64}`), không phải đường dẫn.
--      Một cửa ghi thứ hai (hoặc `INSERT` tay) cũng không nhét được `D:\...` vào cột id.
--   2. `chk_ai_repo_du_an_ten` — tên 1..100 ký tự, CẤM `#;=|`: bốn ký tự ấy phá vỡ định dạng
--      `id=Tên|đường;...` của `.env` (bài học dotenv) — DB không cần chúng nhưng giữ để một mục DB
--      còn xuất ngược ra env được mà không đổi nghĩa.
-- ⚠ CHECK **không** kiểm được "gốc tồn tại trên đĩa" hay "không lồng gốc đã có" — hai vị từ ấy cần
--   nhìn hệ tệp + danh sách env lúc chạy, nên chúng sống ở `kiemTraDangKyDuAn` (server-side,
--   fail-closed) và được đo bằng lưới + đột biến.
--
-- `nguoiTao` CỐ Ý KHÔNG có FK → users:
--   một dự án là CẤU HÌNH hạ tầng, không phải dữ liệu của một người. FK CASCADE sẽ xoá dự án khi
--   xoá tài khoản admin đã đăng ký nó (cấu hình bốc hơi theo người); RESTRICT thì chặn xoá tài
--   khoản vì một hàng cấu hình. Cột chỉ để truy vết "ai đăng ký" (audit đầy đủ hơn nằm ở
--   `audit_logs` qua `logCrudOperation`).
--
-- Idempotent: `IF NOT EXISTS` cho bảng; CHECK qua `DO $$ … IF NOT EXISTS` trên `pg_constraint`
-- (Postgres không có `ADD CONSTRAINT IF NOT EXISTS`).

CREATE TABLE IF NOT EXISTS ai_repo_du_an (
  id          varchar(64) PRIMARY KEY,
  ten         varchar(100) NOT NULL,
  goc         text NOT NULL,
  "nguoiTao"  integer NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_repo_du_an_id'
  ) THEN
    ALTER TABLE ai_repo_du_an
      ADD CONSTRAINT chk_ai_repo_du_an_id
      CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_repo_du_an_ten'
  ) THEN
    ALTER TABLE ai_repo_du_an
      ADD CONSTRAINT chk_ai_repo_du_an_ten
      CHECK (char_length(ten) BETWEEN 1 AND 100 AND ten !~ '[#;=|]');
  END IF;
END $$;

-- ⚠ `avi_app` là vai ỨNG DỤNG chạy lúc runtime; bảng do `aoi` sở hữu nên phải cấp DML tường minh.
--   KHÔNG cấp UPDATE: không có đường "sửa dự án" — chỉ THÊM và XOÁ (sửa = xoá rồi thêm lại, để
--   mọi thay đổi đều là một lượt xác thực fail-closed trọn vẹn). `IF EXISTS` để lượt chạy trên một
--   CSDL chưa có vai `avi_app` không sập.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, DELETE ON ai_repo_du_an TO avi_app;
  END IF;
END $$;
