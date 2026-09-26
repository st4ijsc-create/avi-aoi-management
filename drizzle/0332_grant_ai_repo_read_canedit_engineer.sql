-- ★★★ doc 78 · PHA C (2026-08-19) — CẤP `ai_repo_read/canEdit=true` CHO `engineer` (+ admin cho đủ mục).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN (doc 78 §7): cho AI GHI tệp, ghim theo vai `engineer`/`admin`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO `canEdit` CỦA `ai_repo_read`, KHÔNG PHẢI MỘT MODULE MỚI
-- ------------------------------------------------------------------------------------------
-- ĐỌC (pha A, `read_file`/`list_files`/`grep_repo`) và GHI (pha C, `apply_diff`) tác động lên
-- **cùng một đối tượng** — tệp trong repo. Đó đúng là chỗ để dùng HAI `action` trên MỘT `module`:
--   • `canView` = đọc  (mig 0330 đã cấp)
--   • `canEdit` = ghi   (mig NÀY cấp)
-- Khác `ai_repo_exec` (pha B, chạy lệnh) — đối tượng KHÁC (tiến trình/CPU/thời gian máy) nên là
-- module RIÊNG. Nhờ tách theo action, THU quyền ghi mà GIỮ quyền đọc chỉ cần bỏ một ô tick trên
-- cùng một hàng — không phải xoá cả module.
--
-- BỀ MẶT ĐÃ ĐO — cấp bit này mở ĐÚNG những gì
-- ------------------------------------------------------------------------------------------
-- `ai_repo_read/canEdit` được CƯỠNG CHẾ ở đúng một chỗ:
-- `server/services/aiLocalTools/writeHandlers/applyDiff.ts` (`requiredPermission`, mà
-- `aiCopilotActions.proposeAction` kiểm ở lúc ĐỀ XUẤT và `confirmAction` kiểm LẠI ở lúc GHI).
-- KHÔNG router tRPC nào, KHÔNG mục menu nào, KHÔNG `RouteGuard` nào dùng cặp này.
-- ⇒ Cấp nó KHÔNG mở thêm một màn hình nào, và KHÔNG cho ghi tự động: `apply_diff` là `kind:"write"`
--   nên MỌI lượt vẫn phải qua XÁC NHẬN của người dùng (HITL), và còn ba hàng rào nữa (tệp bẩn ⇒
--   từ chối · băm chống TOCTOU · hộp cát `writeConfined`).
--
-- `admin` KHÔNG cần hàng để cổng chạy: `accessControl.checkPermission` short-circuit `true` cho vai
-- admin khi chưa bật scoped-admin. Cập nhật hàng admin (nếu có) chỉ để BẢNG QUYỀN của giao diện
-- hiển thị đúng trạng thái — cùng lý do đã ghi ở 0330/0331.
--
-- ⚠ KHÔNG lọc theo `isActive` — cùng lý do 0323/0330/0331: một tài khoản đang tắt mà không được
--   cập nhật sẽ mang quyền SAI sau khi bật lại. Tài khoản tắt phải bị chặn ở tầng ĐĂNG NHẬP.
--
-- Idempotent (UPDATE có điều kiện `IS DISTINCT FROM` + INSERT `NOT EXISTS`), DML thuần, KHÔNG DDL
-- ⇒ chạy được bằng cả `aoi` lẫn `avi_app`, áp CẢ HAI CSDL.

-- (1) Hàng ĐÃ CÓ (mig 0330 tạo với canEdit=false) ⇒ nâng canEdit lên true. `IS DISTINCT FROM true`
--     làm lượt chạy lại thành no-op (idempotent).
UPDATE permissions p
SET "canEdit" = true, "updatedAt" = now()
FROM users u
WHERE p."userId" = u.id
  AND p."moduleName" = 'ai_repo_read'
  AND u.role IN ('engineer', 'admin')
  AND p."canEdit" IS DISTINCT FROM true;

-- (2) Tài khoản engineer/admin CHƯA có hàng `ai_repo_read` (vd 0330 chưa từng chạy trên CSDL này)
--     ⇒ tạo mới với CẢ canView LẪN canEdit = true.
INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport", "grantedAt", "createdAt", "updatedAt")
SELECT u.id, 'settings', 'ai_repo_read', true, false, true, false, false, now(), now(), now()
FROM users u
WHERE u.role IN ('engineer', 'admin')
  AND NOT EXISTS (
    SELECT 1 FROM permissions p
    WHERE p."userId" = u.id AND p."moduleName" = 'ai_repo_read'
  );
