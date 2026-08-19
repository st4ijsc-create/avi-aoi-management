-- ★★★ doc 79 · DANH SÁCH PHIÊN (2026-08-19) — bảng `ai_coding_sessions`.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ PHẢI CHẠY BẰNG OWNER `aoi`. Bằng `avi_app` sẽ nhận `42501 must be owner of ...`.
--    Áp CẢ HAI CSDL: `aoi_management` VÀ `aoi_management_test`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- HÀNG RÀO — "AI ĐỌC ĐƯỢC PHIÊN CỦA AI"
-- ----------------------------------------------------------------------------------------------
-- **CHỈ CHỦ PHIÊN**, kể cả `admin`. Phạm vi là **QUYỀN SỞ HỮU** (`userId`), KHÔNG phải tenant:
--   • RLS ở tầng CSDL của repo này **nằm im** (đo 2026-08-18: `runWithTenantScope` 0 nơi gọi
--     trong mã sản xuất) ⇒ một bảng dựa vào nó là bảng KHÔNG có hàng rào;
--   • và tenant là SAI TRỤC: A với B cùng nhà máy ⇒ cùng tenant ⇒ RLS cho qua, trong khi câu hỏi
--     phải trả lời là *"A đọc được phiên của B không"*.
-- ⇒ Hàng rào nằm trong **mệnh đề WHERE** của mọi truy vấn (`server/db/aiCodingSessions.ts`), với
--   `userId` lấy từ phiên đăng nhập. `server/routers/aiCodingSessionScope.test.ts` đo trên CSDL
--   THẬT, hai chiều, và đột biến "bỏ `eq(userId)`" phải làm nó ĐỎ.
--
-- KHÔNG MỞ QUYỀN MỚI
-- ----------------------------------------------------------------------------------------------
-- Migration này **không chèn một hàng `permissions` nào**. Tuyến phiên đòi đúng bit đã có
-- `ai_repo_read/canView` (mig 0330) — ai không đọc được mã nguồn thì cũng không đọc được bản ghi
-- chép của việc đọc mã nguồn.
--
-- HAI RÀNG BUỘC CHECK — VÌ SAO CHÚNG Ở TẦNG CSDL CHỨ KHÔNG CHỈ Ở ZOD
-- ----------------------------------------------------------------------------------------------
-- Zod canh **cửa tRPC**. CHECK canh **cái bảng**. Chúng canh hai thứ khác nhau, và cái thứ hai
-- vẫn đứng khi ai đó thêm một cửa ghi thứ hai (hoặc chạy `INSERT` thẳng):
--   1. `chk_ai_coding_sessions_project_id` — `projectId` phải là **ID**, không phải đường dẫn.
--      `D:\SOURCES\…` có `:` và `\`; `/etc/passwd` có `/`; `../..` có `.`. Cả ba bị CSDL từ chối.
--      Đây là lớp CUỐI của bất biến "client gửi ID, KHÔNG gửi đường dẫn" (trục 2).
--   2. `chk_ai_coding_sessions_turns_array` — `turns` phải là MẢNG jsonb.
-- ⚠ CHECK **không** kiểm được "mỗi lượt chỉ có role/content": vị từ ấy cần hàm sinh-tập
--   (`jsonb_array_elements`) mà CHECK của Postgres cấm dùng truy vấn con. Bất biến ấy được cưỡng
--   chế **theo cấu tạo** ở `shared/aiCodingSession.locLuot()` — một phép CHIẾU chạy ở CẢ cửa ghi
--   LẪN cửa đọc, nên một hàng bị đầu độc bằng SQL thẳng vẫn không phát ra được thẻ duyệt nào.
--
-- Idempotent: `IF NOT EXISTS` cho bảng/chỉ mục; CHECK thêm qua `DO $$ … IF NOT EXISTS` trên
-- `pg_constraint` (Postgres không có `ADD CONSTRAINT IF NOT EXISTS`).

CREATE TABLE IF NOT EXISTS ai_coding_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "projectId" varchar(64) NOT NULL,
  title       varchar(200) NOT NULL DEFAULT '',
  turns       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "turnCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- Đúng hình dạng câu truy vấn danh sách: (chủ phiên × dự án) sắp theo lần sửa gần nhất.
CREATE INDEX IF NOT EXISTS ai_coding_sessions_owner_idx
  ON ai_coding_sessions ("userId", "projectId", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_sessions_project_id'
  ) THEN
    ALTER TABLE ai_coding_sessions
      ADD CONSTRAINT chk_ai_coding_sessions_project_id
      CHECK ("projectId" ~ '^[A-Za-z0-9_-]{1,64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_sessions_turns_array'
  ) THEN
    ALTER TABLE ai_coding_sessions
      ADD CONSTRAINT chk_ai_coding_sessions_turns_array
      CHECK (jsonb_typeof(turns) = 'array');
  END IF;
END $$;

-- ⚠ `avi_app` là vai ỨNG DỤNG chạy lúc runtime; nó cần DML trên bảng mới. Cấp tường minh vì bảng
--   do `aoi` sở hữu. `IF EXISTS` để lượt chạy trên một CSDL chưa có vai `avi_app` không sập.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_coding_sessions TO avi_app;
  END IF;
END $$;
