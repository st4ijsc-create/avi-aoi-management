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
-- dòng ACTIVE-và-đang-mở trùng máy+loại) và lastOccurredAt lên dòng MỚI NHẤT
-- của mỗi nhóm, trong lúc TOÀN BỘ dòng trùng vẫn còn "status" = 'ACTIVE' —
-- nếu chạy sau bước 2/2, các dòng trùng đã bị DISMISSED nên COUNT(*) sẽ chỉ
-- còn ra 1.
--
-- Vòng sửa 1 — 2 chỗ sửa dưới đây (điều kiện lọc là lỗi trong SQL gốc, không
-- phải tôi tự thêm khi viết lần đầu):
--   (a) "AND r.total > 1" ở WHERE của UPDATE: KHÔNG được thiếu — thiếu điều
--       kiện này thì chạy lại migration lần 2 (vd. khi clone dev DB để dựng
--       test-db rồi replay toàn bộ migration) sẽ ÂM THẦM ghi đè
--       occurrenceCount đã tích luỹ (vd. 22) xuống còn 1: ở lần chạy 2, mỗi
--       nhóm chỉ còn đúng 1 dòng "status"='ACTIVE' (21 dòng kia đã
--       DISMISSED ở lần 1, bị loại khỏi WHERE "status"='ACTIVE' của CTE
--       ranked) nên COUNT(*) OVER (...) tính ra 1. Thêm "total > 1" khiến
--       nhóm chỉ-còn-1-dòng bị loại khỏi UPDATE này ở lần chạy sau, giữ
--       nguyên occurrenceCount đã có. Không ảnh hưởng lần chạy đầu (nhóm
--       trùng luôn có total > 1 theo định nghĩa "trùng").
--   (b) "AND \"acknowledgedAt\" IS NULL" ở WHERE của CTE ranked: khớp đúng
--       định nghĩa "đang mở" mà chỉ mục idx_predictive_alerts_open_by_machine_type
--       ở Phần (i) và Task 3 dùng (status='ACTIVE' AND acknowledgedAt IS
--       NULL). Thiếu điều kiện này thì một cảnh báo ĐÃ được kỹ thuật viên
--       tiếp nhận (acknowledgedAt khác NULL nhưng status vẫn 'ACTIVE' cho
--       tới khi resolve) vẫn bị tính vào nhóm xếp hạng — vô hại ở câu ii-a
--       (chỉ ảnh hưởng occurrenceCount) nhưng NGUY HIỂM ở câu ii-b bên dưới
--       (xem giải thích ở đó).
WITH ranked AS (
  SELECT id, "machineId", "alertType",
         ROW_NUMBER() OVER (PARTITION BY "machineId", "alertType" ORDER BY "createdAt" DESC, id DESC) AS rn,
         COUNT(*)     OVER (PARTITION BY "machineId", "alertType") AS total
  FROM "predictive_alerts"
  WHERE "status" = 'ACTIVE' AND "acknowledgedAt" IS NULL AND "machineId" IS NOT NULL
)
UPDATE "predictive_alerts" pa
SET "occurrenceCount" = r.total,
    "lastOccurredAt"  = pa."createdAt"
FROM ranked r
WHERE pa.id = r.id AND r.rn = 1 AND r.total > 1;
--> statement-breakpoint

-- (ii-b) BƯỚC 2/2 — chạy SAU bước 1/2 ở trên: các dòng KHÔNG PHẢI mới nhất
-- (rn > 1) chuyển "status" = 'DISMISSED', lý do ghi vào resolutionNotes.
-- KHÔNG đổi bất kỳ cột nào khác của các dòng này, KHÔNG DELETE — dòng vẫn
-- còn nguyên để truy vết.
--
-- Vòng sửa 1: thêm "AND \"acknowledgedAt\" IS NULL" (lỗi SQL gốc, xem giải
-- thích đầy đủ ở câu ii-a). Ở ĐÂY hậu quả nghiêm trọng hơn ii-a: nếu thiếu,
-- một cảnh báo ĐANG được kỹ thuật viên xử lý (đã acknowledge, status vẫn
-- 'ACTIVE') mà sau đó phát sinh cảnh báo mới hơn cùng máy+loại sẽ bị xếp
-- rn > 1 rồi bị DISMISS — mất dấu công việc đang làm dở của kỹ thuật viên.
-- Với điều kiện này, dòng đã acknowledge bị loại khỏi "ranked" hoàn toàn nên
-- không bao giờ bị đụng tới ở câu này (đúng nghĩa "đang mở" = chưa ai nhận).
-- (Idempotent với sửa (a) ở ii-a: câu này không cần "total > 1" — nhóm chỉ
-- còn 1 dòng thì không có rn > 1 nào để dismiss, đã tự nhiên là no-op.)
WITH ranked AS (
  SELECT id, "machineId", "alertType",
         ROW_NUMBER() OVER (PARTITION BY "machineId", "alertType" ORDER BY "createdAt" DESC, id DESC) AS rn
  FROM "predictive_alerts"
  WHERE "status" = 'ACTIVE' AND "acknowledgedAt" IS NULL AND "machineId" IS NOT NULL
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
--
-- Vòng sửa 1: bảng "ai_insights" KHÔNG có cột ghi chú dạng text (không có
-- resolutionNotes như predictive_alerts) — SQL gốc chỉ đổi status, vi phạm
-- ràng buộc "mọi dòng bị thay thế phải kèm lý do truy vết được". Sửa bằng
-- cách trộn lý do vào cột "contextJson" đã có sẵn (kiểu jsonb — đã đọc
-- drizzle/schema/aiInsight.ts để xác nhận đúng là jsonb, không phải json,
-- vì toán tử "||" trộn object chỉ định nghĩa cho jsonb) thay vì thêm cột
-- mới hay ép kiểu bừa.
UPDATE "ai_insights" ai
SET "status" = 'superseded',
    "contextJson" = COALESCE(ai."contextJson", '{}'::jsonb)
      || jsonb_build_object(
           'supersededBy', 'wave3-0308',
           'supersededReason', 'Gộp bởi Wave 3: báo cáo điều hành trùng tiêu đề cùng nguồn exec_report; giữ bản cũ nhất, bản này bị thay thế.'
         )
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY title ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "ai_insights"
  WHERE "source" = 'exec_report'
) d
WHERE ai.id = d.id AND d.rn > 1;
