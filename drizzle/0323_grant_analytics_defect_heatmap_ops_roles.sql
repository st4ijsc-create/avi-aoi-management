-- ★★ QUYẾT ĐỊNH RBAC CỦA CHỦ DỰ ÁN — 2026-08-17
-- MỞ bit `analytics_defect_heatmap` (canView) cho `operator`, `maintenance`, `engineer`.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- VÌ SAO ĐI ĐƯỜNG NÀY, KHÔNG HẠ BIT CỦA TOOL
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Đường bị BÁC BỎ: hạ `analytics_defect_heatmap_summary` xuống `dashboard_view`. Nó tạo HAI cửa
-- vào cùng một lớp dữ liệu với hai mức gác khác nhau — đúng lớp cửa-hậu mà §10 của
-- `toolPermissionQuantifier.test.ts` vừa dựng ra để chống. Và hai tool KHÔNG cùng tập: heatmap có
-- cửa sổ 1..90 ngày (vs 30 của `get_top_defects`), topN 30 (vs 20), thêm lát cắt machineId +
-- productModelId ⇒ tập LỚN HƠN. §10b ghim đúng phép đo ấy.
-- ⇒ Đường đã chọn: cấp bit cho đúng vai, để trợ lý và giao diện đứng sau CÙNG MỘT luật.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ BỀ MẶT ĐÃ ĐO — KHÔNG PHẢI HIỆU ỨNG PHỤ BẤT NGỜ
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Grep toàn repo cho `analytics_defect_heatmap` ⇒ bit này được CƯỠNG CHẾ ở ĐÚNG BA chỗ:
--   1. `server/services/aiLocalTools/analyticsTools.ts` → tool `analytics_defect_heatmap_summary`
--      (`requiredPermission` + `rbacGate`) — mục tiêu của quyết định.
--   2. `client/src/lib/navigation.tsx` → mục menu `/defect-heatmap` (DUY NHẤT một mục dùng bit
--      này trong toàn bộ menu).
--   3. `client/src/App.tsx` → `<RouteGuard navHref="/defect-heatmap">` ⇒ cổng ROUTE THẬT, không
--      chỉ ẩn/hiện menu (RouteGuard uỷ quyền cho `hasAccessToItem` của chính navigation.tsx).
-- KHÔNG router tRPC nào cưỡng chế tên module này (`permissionsRouter.ts` chỉ LIỆT KÊ nó trong ma
-- trận seed + danh mục hiển thị, không gác procedure nào bằng nó).
-- ⇒ Cấp bit này mở thêm ĐÚNG MỘT màn: `/defect-heatmap`. Nhóm menu "quality" không có
-- `requiredRole`, mục `/defect-heatmap` cũng không ⇒ bit là cổng DUY NHẤT.
--
-- ⚠ VIEW-ONLY: canCreate/canEdit/canDelete/canExport đều false — đúng khuôn 0277
-- (`mqtt_monitoring` view-only) và 0322. Chủ dự án duyệt cho XEM heatmap lỗi, không duyệt thêm
-- quyền ghi/xuất. (Lưu ý: `supervisor`/`quality_inspector`/`admin` đã có bit này từ trước với
-- canExport=true — migration này KHÔNG đụng tới họ, và `NOT EXISTS` cũng không cho phép hạ bit
-- của ai đang có hàng.)
--
-- ⚠ KHÔNG lọc theo `isActive`: một trong bốn tài khoản mục tiêu đang bị TẮT. Lọc nó ra sẽ tái tạo
-- ĐÚNG lỗ mà 0322/0269/0277 sinh ra để vá — bật lại tài khoản sau này thì nó không có hàng và
-- `checkPermission` trả false VĨNH VIỄN. Tài khoản bị tắt phải bị chặn ở tầng ĐĂNG NHẬP, không
-- phải bằng cách bỏ trống ma trận quyền của nó.
--
-- Người dùng được seed TRƯỚC quyết định này không có hàng ⇒ `checkPermission` false vĩnh viễn.
-- Migration backfill idempotent cho mọi tài khoản ba vai chưa có hàng; người dùng MỚI nhận bit từ
-- `DEFAULT_ROLE_PERMISSIONS` (permissionsRouter.ts) lúc seed. Cùng khuôn với
-- 0322_grant_analytics_category_supervisor_quality.sql.
--
-- DML thuần (INSERT), KHÔNG có DDL ⇒ chạy được bằng cả `aoi` lẫn `avi_app`.
INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport", "grantedAt", "createdAt", "updatedAt")
SELECT u.id, 'analytics', 'analytics_defect_heatmap', true, false, false, false, false, now(), now(), now()
FROM users u
WHERE u.role IN ('operator', 'maintenance', 'engineer')
  AND NOT EXISTS (
    SELECT 1 FROM permissions p
    WHERE p."userId" = u.id AND p."moduleName" = 'analytics_defect_heatmap'
  );
