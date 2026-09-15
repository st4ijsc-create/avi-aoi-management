-- ════════════════════════════════════════════════════════════════════════════
-- 0357 — Đợt 25 Việc 2: **GHI CHÚ XỬ LÝ CHO MỘT CẢNH BÁO ANDON** (`andon_notes`)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501 permission denied for schema public).
--   Xem `scripts/apply-migration-0357.mjs` (cùng khuôn `apply-migration-0349.mjs`).
-- ⚠ Repo này **CẤM `drizzle-kit push` và `generate`** — ảnh chụp meta lệch khoảng 337
--   migration (`docs/DEPLOYMENT_GUIDE.md` §3.3, `scripts/kiem-drizzle-meta.mjs`). Tệp này
--   viết TAY, và cột được khai vào `drizzle/schema/andon.ts` **cùng lượt** (bài học
--   `workshops.tangId`: cột có trong CSDL mà vắng trong schema thì mọi truy vấn có kiểu
--   đều mù với nó, và người đọc schema kết luận "cột không tồn tại").
--
-- ─── LỖI ĐƯỢC VÁ ────────────────────────────────────────────────────────────
-- Đo 2026-09-15 (`information_schema.columns`): `andon_events` có 21 cột, **0** cột ghi
-- chú. Thủ tục DUY NHẤT nhận ghi chú là `andon.resolve`, và
-- `server/services/andon/andonService.ts:276` khi resolve thì
--
--     status = 'resolved', resolvedAt = now(), …, message: notes ?? current.message
--
-- tức nó vừa **ĐÓNG** cảnh báo vừa **GHI ĐÈ mô tả gốc của người báo**. Nối nút "ghi chú"
-- của ngăn xử lý vào đó sẽ xoá lời khai đầu tiên — đúng thứ dữ liệu mà một cuộc điều tra
-- sự cố cần nhất.
--
-- ─── VÌ SAO **BẢNG RIÊNG**, KHÔNG PHẢI MỘT CỘT TRÊN `andon_events` ──────────
-- Nghiệp vụ chủ dự án nêu là "**nhiều người cùng xử lý một sự cố**". Một cột `text` trên
-- hàng cảnh báo không đáp ứng được nó, và ba lý do dưới đây đều ĐO ĐƯỢC chứ không phải
-- sở thích kiến trúc:
--
--   1. MẤT TÁC GIẢ VÀ THỜI ĐIỂM. Một chuỗi chỉ giữ được văn bản. Câu hỏi thật của ca
--      trực sau ("ai đã thử gì, lúc mấy giờ?") không trả lời được từ một ô text.
--   2. GHI ĐÈ HOẶC NỐI CHUỖI — cả hai đều sai. Ghi đè là lặp lại đúng lỗi của `resolve`.
--      Nối chuỗi tạo một khối không cấu trúc: không sắp được theo thời gian, không lọc
--      được theo người, không xoá được một dòng sai mà không viết lại cả khối.
--   3. MẤT CẬP NHẬT KHI HAI NGƯỜI CÙNG GHI. Cột đơn buộc phải đọc-sửa-ghi; hai người
--      bấm gửi cùng lúc thì người sau đè mất ghi chú người trước. Đó CHÍNH LÀ tình huống
--      nghiệp vụ yêu cầu. Một hàng mỗi ghi chú là INSERT thuần — không có đua nào.
--
-- Một cột `jsonb` chứa mảng `{tác giả, lúc, chữ}` KHÔNG thoát được (2) và (3): nó là một
-- cái bảng đội lốt một cột, mất thêm khoá ngoại và chỉ mục.
--
-- ⇒ Bảng `andon_notes`, MỘT HÀNG MỖI GHI CHÚ. Đây là cấu trúc đơn giản nhất còn trả lời
--   được câu hỏi nghiệp vụ; mọi thứ nhỏ hơn đều trả lời sai.
--
-- ⚠ Cảnh báo **KHÔNG bị đóng**: bảng này không chạm một cột nào của `andon_events`.
--   Ghi chú là việc ĐANG xử lý, đóng cảnh báo là `resolve` — hai việc, hai thủ tục.
--
-- ─── TÁI CHẠY ĐƯỢC (bài học BG-95) ──────────────────────────────────────────
-- `IF NOT EXISTS` ở cả bảng lẫn chỉ mục; khối GRANT bọc trong `DO` có kiểm vai tồn tại,
-- nên chạy lại N lần cho cùng một kết quả và không nổ trên môi trường không có `avi_app`.

-- ─── 1. Bảng ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS andon_notes (
  "id"        serial PRIMARY KEY,
  -- ⚠ ON DELETE CASCADE: một ghi chú không có cảnh báo để treo vào thì vô nghĩa, và
  --   mọi lưới dọn dấu vết bằng `DELETE FROM andon_events` sẽ dọn luôn ghi chú của nó.
  "andonId"   integer NOT NULL REFERENCES andon_events("id") ON DELETE CASCADE,
  "note"      text NOT NULL,
  -- ⚠ NULLABLE và KHÔNG khoá ngoại sang `users` — cùng hình dạng `andon_events."raisedBy"`
  --   (`drizzle/schema/andon.ts:25`). Một ghi chú do đường hệ thống sinh ra không có
  --   người, và một tài khoản bị xoá không được phép kéo theo lịch sử xử lý sự cố.
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- ─── 2. Chỉ mục ─────────────────────────────────────────────────────────────
-- Đường đọc DUY NHẤT là "mọi ghi chú của MỘT cảnh báo, mới nhất trước"
-- (`andon.danhSachGhiChu`), nên chỉ mục ghép đúng thứ tự ấy: lọc theo "andonId" rồi
-- lấy sẵn thứ tự "createdAt" DESC mà không phải sắp lại.
CREATE INDEX IF NOT EXISTS idx_andon_notes_andon_created
  ON andon_notes ("andonId", "createdAt" DESC);

-- ─── 3. Quyền cho vai ứng dụng ──────────────────────────────────────────────
-- Trên DB dev/test hiện tại `pg_default_acl` của vai `aoi` đã cấp sẵn `arwd` cho
-- `avi_app` (đo 2026-09-15), nên khối này là THỪA ở đó — và đúng vì thế nó phải có:
-- một môi trường không có default ACL (production dựng bằng tay) sẽ tạo được bảng mà
-- ứng dụng KHÔNG đọc nổi, và triệu chứng là 42501 ở tầng router chứ không ở migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON andon_notes TO avi_app;
    GRANT USAGE, SELECT ON SEQUENCE andon_notes_id_seq TO avi_app;
  END IF;
END $$;
