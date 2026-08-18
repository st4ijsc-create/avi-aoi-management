-- ★★ QUYẾT ĐỊNH RBAC CỦA CHỦ DỰ ÁN — 2026-08-17
-- MỞ bit `analytics_category` (canView) cho `supervisor` và `quality_inspector`.
--
-- LÝ DO: tool trợ lý `get_model_metrics` (xếp hạng model sản phẩm theo tỉ lệ NG) đứng sau
-- `analytics_category/canView` — bit của `/category-analytics`, màn DUY NHẤT thật sự chia
-- OK/NG/yield theo sản phẩm. Trước quyết định này CHỈ `admin` được seed bit ấy, nên
-- `supervisor` và `quality_inspector` hỏi trợ lý "model nào NG nhiều nhất?" thì bị TỪ CHỐI.
--
-- ⚠ HỆ QUẢ ĐÃ ĐO, KHÔNG PHẢI HIỆU ỨNG PHỤ BẤT NGỜ: bit này được cưỡng chế ở ĐÚNG HAI chỗ
-- trong toàn repo —
--   1. `server/services/aiLocalTools/handlers.ts` → tool `get_model_metrics` (mục tiêu),
--   2. `client/src/lib/navigation.tsx` → mục menu `/category-analytics`, mà `App.tsx` bọc
--      trong `<RouteGuard navHref="/category-analytics">` ⇒ đây là cổng ROUTE thật, không
--      chỉ ẩn/hiện menu.
-- ⇒ Cấp bit này MỞ LUÔN trang `/category-analytics` cho hai vai. Không router tRPC nào khác
-- dùng tên module này (đã grep toàn repo), nên không có bề mặt thứ ba.
-- Dữ liệu trang ấy đọc (productCategory.list / factory.list / inspection.list /
-- productModel.list) vốn đã nằm trong tầm của cả hai vai qua `history_view` + `analytics_view`
-- + `analytics_advanced`, nên đây là mở BỀ MẶT, không mở LỚP DỮ LIỆU MỚI.
--
-- ⚠ VIEW-ONLY: canCreate/canEdit/canDelete/canExport đều false — đúng khuôn 0277
-- (`mqtt_monitoring` view-only). Quyết định là để trợ lý trả lời được, không phải cấp thêm
-- quyền ghi. (Nút xuất của `/category-analytics` là CSV/PDF dựng phía client, KHÔNG đọc bit
-- `canExport` của module này, nên view-only vẫn dùng được trang một cách đầy đủ.)
--
-- Người dùng được seed TRƯỚC quyết định này không có hàng ⇒ `checkPermission` trả false vĩnh
-- viễn. Migration backfill idempotent cho mọi supervisor/quality_inspector chưa có hàng; người
-- dùng MỚI nhận bit từ `DEFAULT_ROLE_PERMISSIONS` (permissionsRouter.ts) lúc seed.
-- Cùng khuôn với 0269_grant_settings_factory_to_engineer.sql và
-- 0277_grant_mqtt_view_operator_engineer.sql.
--
-- DML thuần (INSERT), KHÔNG có DDL ⇒ chạy được bằng cả `aoi` lẫn `avi_app`
-- (đã kiểm: has_table_privilege('avi_app','permissions','INSERT') = true).
INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport", "grantedAt", "createdAt", "updatedAt")
SELECT u.id, 'analytics', 'analytics_category', true, false, false, false, false, now(), now(), now()
FROM users u
WHERE u.role IN ('supervisor', 'quality_inspector')
  AND NOT EXISTS (
    SELECT 1 FROM permissions p
    WHERE p."userId" = u.id AND p."moduleName" = 'analytics_category'
  );
