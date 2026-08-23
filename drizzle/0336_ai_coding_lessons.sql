-- ★★★ doc 82 · BỘ NHỚ XUYÊN PHIÊN (2026-08-23) — bảng `ai_coding_lessons`.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ PHẢI CHẠY BẰNG OWNER `aoi`. Bằng `avi_app` sẽ nhận `42501 must be owner of ...`.
--    Áp CẢ HAI CSDL: `aoi_management` VÀ `aoi_management_test`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- LỖ ĐƯỢC BỊT
-- ----------------------------------------------------------------------------------------------
-- `ai_coding_sessions` (mig 0333) LƯU hội thoại nhưng KHÔNG có gì đọc ngược vào model — nó là
-- NHẬT KÝ, không phải TRÍ NHỚ. doc 81 mở trí nhớ TRONG một phiên; xuyên phiên vẫn chưa có. Bảng
-- này là trí nhớ xuyên phiên, và nó **tự tới** mỗi lượt (xem `ai/codingLessonContext.ts`) chứ
-- không chờ một nhịp đọc bảng thủ công hằng tháng.
--
-- HÀNG RÀO — "AI ĐỌC ĐƯỢC BÀI HỌC CỦA AI"
-- ----------------------------------------------------------------------------------------------
-- **CHỈ CHỦ SỞ HỮU**, kể cả `admin`. RIÊNG TƯ, y như phiên. Chia sẻ theo đội đã được cân và bị
-- LOẠI trong lượt này: một bài học đi vào MỌI prompt sau đó của người đọc nó, nên một bảng dùng
-- chung là một kênh **tiêm prompt ngang hàng** (B gõ, prompt của A nhận, không ai duyệt) — đổi
-- hạng mối đe doạ chứ không nới một chút. Lý lẽ đầy đủ ở `drizzle/schema/aiCodingLesson.ts`.
-- ⇒ Hàng rào nằm trong **mệnh đề WHERE** của mọi truy vấn (`server/db/aiCodingLessons.ts`), với
--   `userId` lấy từ phiên đăng nhập. `server/routers/aiCodingLessonScope.test.ts` đo trên CSDL
--   THẬT, hai chiều, và đột biến "bỏ `eq(userId)`" phải làm nó ĐỎ.
--
-- KHÔNG MỞ QUYỀN MỚI
-- ----------------------------------------------------------------------------------------------
-- Migration này **không chèn một hàng `permissions` nào**. Đường ghi/đọc bài học nằm TRONG phiên
-- lập trình, sau đúng bit đã có `ai_repo_read/canView` (mig 0330).
--
-- BA RÀNG BUỘC — VÌ SAO Ở TẦNG CSDL CHỨ KHÔNG CHỈ Ở TẦNG ỨNG DỤNG
-- ----------------------------------------------------------------------------------------------
--   1. `chk_ai_coding_lessons_project_id` — `projectId` phải là ID, KHÔNG phải đường dẫn.
--      `D:\SOURCES\…` có `:` và `\`; `/etc/passwd` có `/`; `../..` có `.`. Cả ba bị CSDL từ chối.
--   2. `chk_ai_coding_lessons_risk` — `mucRuiRo` ∈ {'none','low'}. **'high' KHÔNG LƯU ĐƯỢC.**
--      Cửa ghi đã từ chối một bài học rủi ro cao, nhưng lời từ chối ở tầng ứng dụng là một LỜI HỨA;
--      CHECK là một HÀNG RÀO. Đây là chỗ "bài học chứa câu ra lệnh nới quyền" chết lần thứ hai —
--      và là chỗ đột biến M4 chứng minh nó không xanh vì một lý do khác.
--   3. `ux_ai_coding_lessons_khoa` UNIQUE (userId, projectId, khoaTrung) — bài học TRÙNG không
--      nhân bản được, kể cả hai tab gửi cùng lúc. Bằng `SELECT`-rồi-`INSERT` thì đó là một điều
--      kiện chạy đua; ở đây nó là thuộc tính của cái bảng.
--
-- Idempotent: `IF NOT EXISTS` cho bảng/chỉ mục; CHECK thêm qua `DO $$ … IF NOT EXISTS` trên
-- `pg_constraint` (Postgres không có `ADD CONSTRAINT IF NOT EXISTS`).

CREATE TABLE IF NOT EXISTS ai_coding_lessons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "projectId" varchar(64) NOT NULL,
  "noiDung"   text NOT NULL,
  "khoaTrung" text NOT NULL,
  "mucRuiRo"  varchar(8) NOT NULL DEFAULT 'none',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- Đúng hình dạng câu truy vấn đọc: (chủ sở hữu × dự án) sắp theo lần sửa gần nhất.
CREATE INDEX IF NOT EXISTS ai_coding_lessons_owner_idx
  ON ai_coding_lessons ("userId", "projectId", "updatedAt");

-- ★★★ "TRÙNG ⇒ KHÔNG NHÂN BẢN" — thuộc tính của BẢNG.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_coding_lessons_khoa
  ON ai_coding_lessons ("userId", "projectId", "khoaTrung");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_lessons_project_id'
  ) THEN
    ALTER TABLE ai_coding_lessons
      ADD CONSTRAINT chk_ai_coding_lessons_project_id
      CHECK ("projectId" ~ '^[A-Za-z0-9_-]{1,64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_lessons_risk'
  ) THEN
    ALTER TABLE ai_coding_lessons
      ADD CONSTRAINT chk_ai_coding_lessons_risk
      CHECK ("mucRuiRo" IN ('none', 'low'));
  END IF;
END $$;

-- ⚠ `avi_app` là vai ỨNG DỤNG chạy lúc runtime; nó cần DML trên bảng mới. Cấp tường minh vì bảng
--   do `aoi` sở hữu. `IF EXISTS` để lượt chạy trên một CSDL chưa có vai `avi_app` không sập.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_coding_lessons TO avi_app;
  END IF;
END $$;
