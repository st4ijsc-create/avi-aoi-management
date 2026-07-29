-- Wave 3 §7 — một-cảnh-báo-mở cho mỗi (máy × loại).
-- Phần (i): cột đếm số lần tái diễn.
ALTER TABLE "predictive_alerts"
  ADD COLUMN IF NOT EXISTS "occurrenceCount" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "lastOccurredAt" timestamptz;
--> statement-breakpoint

-- Chỉ mục phục vụ truy vấn tìm-cảnh-báo-mở ở Task 3.
CREATE INDEX IF NOT EXISTS "idx_predictive_alerts_open_by_machine_type"
  ON "predictive_alerts" ("machineId", "alertType")
  WHERE "status" = 'ACTIVE' AND "acknowledgedAt" IS NULL;
--> statement-breakpoint

-- Phần (ii): GỘP đống tồn — KHÔNG XOÁ DÒNG NÀO (spec §5).
-- Mỗi (machineId, alertType) giữ dòng MỚI NHẤT; các dòng cũ chuyển DISMISSED
-- kèm lý do vào resolutionNotes.
--
-- KHÁC VỚI BRIEF GỐC: brief gộp bước "ghi occurrenceCount lên dòng giữ lại"
-- (CTE `keepers`, một UPDATE) và bước "chuyển các dòng cũ sang DISMISSED"
-- (UPDATE chính) vào CHUNG một câu lệnh `WITH ranked AS (...), keepers AS
-- (UPDATE ... RETURNING ...) UPDATE ...`. Tách thành 2 câu lệnh tuần tự riêng
-- biệt ở đây, vì:
--   1. Tài liệu PostgreSQL (queries-with.html) khuyến cáo THẲNG: "you should
--      generally avoid trying to modify a single row twice in a single
--      statement. In particular avoid writing WITH sub-statements that could
--      affect the same rows changed by ... a sibling sub-statement. The
--      effects of such a statement will not be predictable." Bản gốc có 2 CTE
--      ghi lên CÙNG bảng "predictive_alerts" trong CÙNG một câu lệnh — đúng
--      hình dạng mà tài liệu khuyên tránh, dù ở đây 2 tập dòng bị ghi
--      (rn = 1 và rn > 1) tách rời nhau (không đè lên nhau).
--   2. Việc CTE `keepers` không được câu lệnh chính tham chiếu nhưng vẫn chắc
--      chắn được thực thi là ĐÚNG theo tài liệu ("Data-modifying statements
--      in WITH are executed exactly once, and always to completion,
--      independently of whether the primary query reads all — or indeed any
--      — of their output.") — nhưng đây là hành vi tinh vi, không thể kiểm
--      chứng lại bằng cách chạy thật ở bước này (không được phép chạy
--      migration). Tách câu lệnh loại bỏ hẳn nhu cầu phải tin vào hành vi đó.
-- Kết quả: 2 câu lệnh độc lập, THỨ TỰ CHẠY LÀ BẮT BUỘC (xem ghi chú ở từng
-- câu) — vì file .sql này được áp bằng cách gửi nguyên văn tới Postgres
-- (xem scripts/apply-migration-*.mjs dùng `sql.unsafe(content)`), Postgres
-- chạy các câu lệnh phân tách bởi dấu ";" tuần tự trong CÙNG một transaction
-- ngầm định — đúng thứ tự viết trong file.

-- (ii-a) BƯỚC 1/2 — PHẢI chạy trước bước 2/2: ghi occurrenceCount (= tổng số
-- dòng ACTIVE trùng máy+loại) và lastOccurredAt lên dòng MỚI NHẤT của mỗi
-- nhóm, trong lúc TOÀN BỘ dòng trùng vẫn còn "status" = 'ACTIVE' — nếu chạy
-- sau bước 2/2, các dòng trùng đã bị DISMISSED nên COUNT(*) sẽ chỉ còn ra 1.
WITH ranked AS (
  SELECT id, "machineId", "alertType",
         ROW_NUMBER() OVER (PARTITION BY "machineId", "alertType" ORDER BY "createdAt" DESC, id DESC) AS rn,
         COUNT(*)     OVER (PARTITION BY "machineId", "alertType") AS total
  FROM "predictive_alerts"
  WHERE "status" = 'ACTIVE' AND "machineId" IS NOT NULL
)
UPDATE "predictive_alerts" pa
SET "occurrenceCount" = r.total,
    "lastOccurredAt"  = pa."createdAt"
FROM ranked r
WHERE pa.id = r.id AND r.rn = 1;
--> statement-breakpoint

-- (ii-b) BƯỚC 2/2 — chạy SAU bước 1/2 ở trên: các dòng KHÔNG PHẢI mới nhất
-- (rn > 1) chuyển "status" = 'DISMISSED', lý do ghi vào resolutionNotes.
-- KHÔNG đổi bất kỳ cột nào khác của các dòng này, KHÔNG DELETE — dòng vẫn
-- còn nguyên để truy vết.
WITH ranked AS (
  SELECT id, "machineId", "alertType",
         ROW_NUMBER() OVER (PARTITION BY "machineId", "alertType" ORDER BY "createdAt" DESC, id DESC) AS rn
  FROM "predictive_alerts"
  WHERE "status" = 'ACTIVE' AND "machineId" IS NOT NULL
)
UPDATE "predictive_alerts" pa
SET "status" = 'DISMISSED',
    "resolutionNotes" = COALESCE(pa."resolutionNotes", '') ||
      'Gộp bởi Wave 3: đã thay bằng cảnh báo mở mới nhất của cùng máy và cùng loại.'
FROM ranked r
WHERE pa.id = r.id AND r.rn > 1;
--> statement-breakpoint

-- Phần (iii): báo cáo điều hành trùng — giữ bản CŨ NHẤT mỗi tiêu đề, không
-- xoá, chỉ đổi status sang 'superseded' (ai_insights.status là varchar tự
-- do, không ràng buộc enum).
UPDATE "ai_insights" ai
SET "status" = 'superseded'
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY title ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "ai_insights"
  WHERE "source" = 'exec_report'
) d
WHERE ai.id = d.id AND d.rn > 1;
