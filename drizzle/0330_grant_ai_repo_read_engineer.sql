-- ★★★ doc 78 · PHA A (2026-08-18) — BIT MỚI `ai_repo_read` CHO `engineer`.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN (doc 78 §7.3): ba tool đọc mã nguồn của trợ lý AI
-- (`read_file`, `list_files`, `grep_repo`) ghim theo vai `engineer`/`admin`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO MỘT BIT MỚI, KHÔNG MƯỢN BIT CÓ SẴN
-- ------------------------------------------------------------------------------------------
-- ĐO trên `DEFAULT_ROLE_PERMISSIONS` (`server/routers/permissionsRouter.ts`): `engineer` giữ 20
-- module, và ĐÚNG HAI trong số đó không vai nào khác giữ — `settings_factory` và
-- `settings_measurement_points`. Mượn một trong hai sẽ:
--   (a) làm câu từ chối NÓI SAI lý do ("bạn không có quyền settings_factory" cho một người vừa
--       xin đọc một file .ts) — đúng lớp lỗi mà `readToolRbac.cauTuChoi` và
--       `_uyQuyenAnh.MA_KHONG_PHAN_GIAI` tồn tại để chống;
--   (b) buộc "quyền đọc mã nguồn nền tảng" đi theo mọi quyết định RBAC về CẤU HÌNH NHÀ MÁY — cấp
--       `settings_factory` cho `supervisor` là một quyết định hợp lý, và nó sẽ mở đọc mã nguồn
--       trong im lặng.
-- ⇒ Cùng lý lẽ đã dựng `vram_control` (Pha 5 Task 3b): một `moduleName` MỚI. Cột `moduleName` là
--   `varchar(100)` tự do ⇒ bit mới = MỘT HÀNG, KHÔNG DDL; `category` dùng lại `settings` đã có
--   trong `permissioncategoryenum` ⇒ cũng không đụng enum.
--
-- BỀ MẶT ĐÃ ĐO — cấp bit này mở ĐÚNG những gì
-- ------------------------------------------------------------------------------------------
-- `ai_repo_read` được CƯỠNG CHẾ ở đúng một chỗ: `server/services/aiLocalTools/repoReadTools.ts`
-- (`requiredPermission` + `rbacGate` cho cả ba tool). KHÔNG router tRPC nào, KHÔNG mục menu nào,
-- KHÔNG `RouteGuard` nào dùng tên này. ⇒ Cấp nó KHÔNG mở thêm một màn hình nào.
--
-- VIEW-ONLY, CÓ CHỦ Ý
-- ------------------------------------------------------------------------------------------
-- canCreate/canEdit/canDelete/canExport đều false. Pha A **không ghi một byte nào**; pha C (ghi
-- tệp, doc 78 §4) sẽ xin `ai_repo_read/canEdit` RIÊNG — để "đọc được" và "ghi được" không bao giờ
-- là cùng một bit. Cùng khuôn 0277/0322/0323.
--
-- `admin` KHÔNG cần hàng: `accessControl.checkPermission` short-circuit `true` cho vai admin khi
-- chưa bật scoped-admin. Hàng cho admin (nếu có) chỉ để bảng quyền của giao diện đủ mục —
-- `DEFAULT_ROLE_PERMISSIONS.admin` đã có, dành cho tài khoản admin tạo MỚI.
--
-- ⚠ KHÔNG lọc theo `isActive` — cùng lý do đã ghi ở 0323: một tài khoản đang tắt mà không có hàng
--   sẽ bị `checkPermission` trả false VĨNH VIỄN sau khi bật lại. Tài khoản tắt phải bị chặn ở tầng
--   ĐĂNG NHẬP, không bằng cách bỏ trống ma trận quyền.
--
-- Idempotent (`NOT EXISTS`), DML thuần (INSERT), KHÔNG DDL ⇒ chạy được bằng cả `aoi` lẫn `avi_app`.
INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport", "grantedAt", "createdAt", "updatedAt")
SELECT u.id, 'settings', 'ai_repo_read', true, false, false, false, false, now(), now(), now()
FROM users u
WHERE u.role IN ('engineer', 'admin')
  AND NOT EXISTS (
    SELECT 1 FROM permissions p
    WHERE p."userId" = u.id AND p."moduleName" = 'ai_repo_read'
  );
