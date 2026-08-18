-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0325 — PHẠM VI TENANT cho KHOÁ API (`api_keys`), fail-closed cho khoá chưa khai.
--
-- VÌ SAO.  `api_keys.scopes` trả lời *"khoá này LÀM ĐƯỢC GÌ"* (`bi:read`, `export:read`, …).
-- Nó CHƯA BAO GIỜ trả lời *"khoá này THẤY ĐƯỢC GÌ"*. Đo 2026-08-17 trên `aoi_management`:
-- bảng có 14 cột, KHÔNG cột nào mang tenant (`machineId` là khoá số, phục vụ đường ingest
-- theo máy). ⇒ bất kỳ khoá nào có `bi:read` đều kéo được số của TOÀN BỘ nhà máy.
--
-- BA TRẠNG THÁI, KHÔNG PHẢI HAI.  Chủ dự án chốt 2026-08-17: *"khoá API đại diện MỘT NHÀ MÁY;
-- khoá chưa khai phạm vi thì từ chối"* — nhưng BI cấp tập đoàn cũng là nhu cầu thật. Nên:
--     "dataScopeMode" IS NULL   → CHƯA KHAI      → `bi:read`/`export:read` bị TỪ CHỐI (403)
--     "dataScopeMode" = 'factory' → MỘT NHÀ MÁY  → lọc theo corporateCode/factoryCode
--     "dataScopeMode" = 'global'  → TOÀN CỤC     → thấy tất cả
--
-- ⚠⚠ VÌ SAO CẦN CỘT `dataScopeMode` THAY VÌ CHỈ HAI CỘT MÃ.  Nếu `factoryCode IS NULL` mang
-- nghĩa "toàn cục" thì mọi khoá quên khai — kể cả 27 khoá đang tồn tại — sẽ IM LẶNG trở thành
-- khoá toàn cục, và không ai phân biệt được "ĐƯỢC CẤP quyền toàn cục" với "CHƯA AI NGHĨ TỚI".
-- Đó chính xác là lớp lỗi `or()` rỗng vừa vá tuần này ở `_core/accessControl.ts`: một giá trị
-- VẮNG MẶT bị đọc thành "không lọc" (đo được: 4 tài khoản 0-gán đọc trọn 22.996/22.996 bản ghi
-- kiểm). Một cột mode TƯỜNG MINH biến hai chuyện ấy thành hai giá trị khác nhau trong CSDL.
--
-- HÀNG ĐÃ TỒN TẠI ĐIỀN GÌ.  Đo trước khi quyết định (2026-08-17):
--     aoi_management       → 27 hàng, TẤT CẢ là khoá máy (`machine:*`), scopes chỉ gồm
--                            ingest:write / equipment:read / edge:sync — KHÔNG hàng nào có
--                            `bi:read` hay `export:read`.
-- ⇒ Backfill = KHÔNG. Mọi hàng cũ giữ `dataScopeMode IS NULL` = CHƯA KHAI, đúng mặc định
--   fail-closed mà spec đòi, và không khoá đang chạy nào mất quyền (không khoá nào dùng hai
--   scope bị cưỡng chế). Điền một mặc định 'global' cho hàng cũ sẽ là đúng cái lỗ đang đóng.
--
-- RÀNG BUỘC CHECK.  Một hàng `('factory', NULL, NULL)` là lời khai RỖNG — nếu lọt vào CSDL thì
-- tầng ứng dụng phải đoán, và mọi phép đoán ở đây đều nguy hiểm. Cấm luôn ở tầng CSDL:
--     • mode NULL      ⇒ hai mã phải NULL (chưa khai thì không có mã lơ lửng)
--     • mode 'global'  ⇒ hai mã phải NULL (toàn cục không mang mã, tránh mã "trang trí")
--     • mode 'factory' ⇒ phải có ≥1 mã
-- (`server/api/v1/apiKeyScope.ts` VẪN fail-closed một lần nữa với hình dạng lệch — hai lớp,
--  vì các bản triển khai khác có thể đã ghi bằng psql trước khi có ràng buộc này.)
--
-- IDEMPOTENT: `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`; ràng buộc CHECK thêm
-- trong khối `DO $$` có kiểm `pg_constraint` (Postgres không có `ADD CONSTRAINT IF NOT EXISTS`).
-- Không câu nào INSERT, nên chạy lần hai KHÔNG sinh hàng trùng ở bất kỳ bảng nào.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "dataScopeMode" varchar(16);
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "factoryCode"   varchar(50);

-- ⚠⚠ VIẾT BẰNG `CASE`, KHÔNG BẰNG CHUỖI `OR` — ĐÂY LÀ LẦN THỨ HAI CỦA CÙNG MỘT LỚP LỖI.
-- Bản đầu của migration này viết:
--     CHECK ( (mode IS NULL AND …) OR (mode = 'global' AND …) OR (mode = 'factory' AND …) )
-- và lưới test bắt ngay: hàng `(NULL, 'CORP_A', NULL)` **LỌT QUA**. Lý do là logic BA GIÁ TRỊ
-- của SQL, không phải lỗi đánh máy:
--     vế 1 → FALSE (corporateCode không NULL)
--     vế 2 → `NULL = 'global'` là **NULL**; `NULL AND FALSE` = FALSE
--     vế 3 → `NULL = 'factory'` là **NULL**; `NULL AND TRUE` = **NULL**
--     ⇒ FALSE OR FALSE OR NULL = **NULL**, và một CHECK chỉ TỪ CHỐI khi biểu thức là FALSE —
--       biểu thức NULL được coi là THOẢ.
-- Tức: cùng một lớp lỗi với `or()` rỗng (giá trị VẮNG MẶT được đọc thành "cho qua"), lần này
-- ở ngay trong cái ràng buộc dựng ra để chặn nó. `CASE` phân nhánh trên `IS NULL` TRƯỚC nên
-- không nhánh nào phải so sánh với NULL, và `ELSE false` khiến mọi mode lạ ('GLOBAL', '*',
-- 'Factory') bị TỪ CHỐI thay vì lọt.
--
-- DROP-rồi-ADD (thay vì `IF NOT EXISTS`) là CỐ Ý: các bản triển khai đã chạy bản đầu sẽ được
-- SỬA khi chạy lại, thay vì giữ mãi ràng buộc hỏng vì "nó đã tồn tại rồi". Vẫn idempotent:
-- chạy bao nhiêu lần cũng ra đúng một ràng buộc, và không câu nào chèn hàng.
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_data_scope_mode_chk";

-- Hàng LỆCH có sẵn (chỉ có thể sinh ra dưới ràng buộc thủng của bản đầu) được đưa về CHƯA KHAI
-- trước khi siết. Đây là phép đọc FAIL-CLOSED của một lời khai không mạch lạc: mất quyền đọc
-- thì quản trị viên khai lại được trong một phút; đoán ra một phạm vi từ dữ liệu lệch thì có
-- thể phát số của nhà máy khác cho tới khi ai đó tình cờ phát hiện. Không có hàng lệch (đường
-- đi bình thường) thì câu này không chạm hàng nào.
UPDATE "api_keys"
   SET "dataScopeMode" = NULL, "corporateCode" = NULL, "factoryCode" = NULL
 WHERE NOT (
   CASE
     WHEN "dataScopeMode" IS NULL      THEN "corporateCode" IS NULL AND "factoryCode" IS NULL
     WHEN "dataScopeMode" = 'global'   THEN "corporateCode" IS NULL AND "factoryCode" IS NULL
     WHEN "dataScopeMode" = 'factory'  THEN "corporateCode" IS NOT NULL OR "factoryCode" IS NOT NULL
     ELSE false
   END
 );

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_data_scope_mode_chk" CHECK (
  CASE
    WHEN "dataScopeMode" IS NULL      THEN "corporateCode" IS NULL AND "factoryCode" IS NULL
    WHEN "dataScopeMode" = 'global'   THEN "corporateCode" IS NULL AND "factoryCode" IS NULL
    WHEN "dataScopeMode" = 'factory'  THEN "corporateCode" IS NOT NULL OR "factoryCode" IS NOT NULL
    ELSE false
  END
);

CREATE INDEX IF NOT EXISTS "idx_api_keys_data_scope_mode" ON "api_keys" ("dataScopeMode");
