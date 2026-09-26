-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0324 — PHẠM VI NHÀ MÁY cho heatmap lỗi ĐÃ LƯU (`defect_heatmap_data`).
--
-- VÌ SAO.  `defectHeatmapRouter.list/getLatest/getById` phát lại các heatmap đã lưu. Chúng
-- KHÔNG lọc được theo nhà máy vì bảng không mang một mã phạm vi nào: `factoryId` có tồn tại
-- nhưng `generate` chưa bao giờ ghi (đo 2026-08-17: 0/0 hàng có `factoryId`), và dù có ghi thì
-- nó là KHOÁ SỐ chứ không phải cái mà quyền của người dùng so sánh — `user_factory_assignments`
-- và `getAccessFilterConditions` đều làm việc trên MÃ chuỗi (`factories.code`, ví dụ `SIM-FAC`).
-- Nên thêm đúng hai cột MÃ, cùng không gian mã với `product_inspections.corporateCode/factoryCode`.
--
-- HÀNG ĐÃ TỒN TẠI ĐIỀN GÌ.  Đo trước khi quyết định (2026-08-17, cả hai CSDL):
--     aoi_management       → 0 hàng
--     aoi_management_test  → 0 hàng
-- ⇒ KHÔNG có hàng lịch sử nào để lấp. Câu `UPDATE` bên dưới vì thế là một phép SUY RA cho các
--   bản triển khai KHÁC (nếu ở đó `factoryId` có giá trị thật): nó chỉ chép mã từ đúng hàng
--   `factories` mà `factoryId` trỏ tới — không đoán. Mọi hàng còn lại giữ NULL.
--
-- NULL NGHĨA LÀ "KHÔNG RÕ NGUỒN GỐC", VÀ LUẬT ĐỌC LÀ FAIL-CLOSED.  Một heatmap là con số GỘP:
-- nó có thể gộp dữ liệu của nhiều nhà máy (admin sinh bản toàn cục), lúc ấy KHÔNG tồn tại một
-- `factoryCode` đúng để ghi. Điền một mã mặc định sẽ biến "không biết" thành một LỜI KHAI SAI và
-- cấp quyền xem một con số gộp liên nhà máy cho người chỉ được thấy một nhà máy. Vì vậy:
--     • cột NULLable, không DEFAULT, không backfill đoán mò;
--     • người gọi có phạm vi hạn chế KHÔNG nhận hàng NULL (`IN (...)` trên NULL cho UNKNOWN ⇒
--       loại — đúng chiều fail-closed), admin vẫn thấy tất cả;
--     • `generate` chỉ ghi mã khi tập hàng đóng góp có ĐÚNG MỘT mã; 0 hoặc ≥2 ⇒ NULL.
--
-- IDEMPOTENT: `IF NOT EXISTS` ở cả cột lẫn index; `UPDATE` chỉ chạm hàng còn NULL và tự suy ra
-- cùng một giá trị mỗi lần ⇒ chạy lần hai không đổi gì và không sinh hàng nào (ALTER/UPDATE
-- không chèn hàng).
-- ═══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "defect_heatmap_data" ADD COLUMN IF NOT EXISTS "corporateCode" varchar(50);
ALTER TABLE "defect_heatmap_data" ADD COLUMN IF NOT EXISTS "factoryCode" varchar(50);

-- Suy ra (KHÔNG đoán) từ `factoryId` khi nó thực sự trỏ tới một nhà máy có thật.
UPDATE "defect_heatmap_data" h
   SET "factoryCode" = f."code"
  FROM "factories" f
 WHERE h."factoryId" = f."id"
   AND h."factoryCode" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_heatmap_factory_code" ON "defect_heatmap_data" ("factoryCode");
CREATE INDEX IF NOT EXISTS "idx_heatmap_corporate_code" ON "defect_heatmap_data" ("corporateCode");
