-- ★★★ doc 78 · PHA B (2026-08-18) — BIT MỚI `ai_repo_exec` CHO `engineer`.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN (doc 78 §7.3): tool chạy lệnh của trợ lý AI (`run_command`) ghim theo
-- vai `engineer`/`admin` — cùng phạm vi vai với pha A.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO MỘT MODULE MỚI, KHÔNG PHẢI MỘT `action` KHÁC CỦA `ai_repo_read`
-- ------------------------------------------------------------------------------------------
-- Mig 0330 (pha A) đã đặt trước `ai_repo_read/canEdit` cho **PHA C (ghi tệp)** — và đó là cách
-- dùng ĐÚNG của hai `action` trên một `module`: đọc và ghi **cùng một đối tượng** (tệp trong repo).
-- **Chạy lệnh là đối tượng KHÁC** — tiến trình, CPU, thời gian máy. Ba hệ quả đo được nếu gộp:
--   (a) hai năng lực nằm CÙNG MỘT HÀNG `permissions` ⇒ quản trị viên mở bảng quyền, thấy một dòng
--       "AI đọc mã nguồn" với năm ô tick, và tick thêm một ô là mở quyền SINH TIẾN TRÌNH. Đó đúng
--       là chế độ hỏng (b) mà chính mig 0330 viết ra để tránh;
--   (b) câu từ chối (`denyMessage`/`cauTuChoi` nêu đích danh module/action) sẽ nói *"bạn không có
--       quyền ai_repo_read/canCreate"* cho một người vừa xin **chạy test** — một lời khai SAI về
--       lý do, đúng lớp lỗi mà `readToolRbac.cauTuChoi` và `_uyQuyenAnh.MA_KHONG_PHAN_GIAI` tồn
--       tại để chống;
--   (c) thu hồi quyền chạy lệnh mà vẫn giữ quyền đọc mã sẽ không làm được bằng một thao tác.
-- ⇒ Tiền lệ trực tiếp: `vram_control` (Pha 5 Task 3b) — dòng catalog của nó nói thẳng *"KHÔNG bao
--   gồm quyền XEM trạng thái VRAM — mặt đọc đứng trên machine_control/canView"*. Cùng hình dạng.
--   Cột `moduleName` là `varchar(100)` tự do ⇒ bit mới = MỘT HÀNG, KHÔNG DDL; `category` dùng lại
--   `settings` đã có trong `permissioncategoryenum` ⇒ cũng không đụng enum.
--
-- BỀ MẶT ĐÃ ĐO — cấp bit này mở ĐÚNG những gì
-- ------------------------------------------------------------------------------------------
-- `ai_repo_exec` được CƯỠNG CHẾ ở đúng một chỗ:
-- `server/services/aiLocalTools/writeHandlers/repoCommand.ts` (`requiredPermission`, mà
-- `aiCopilotActions.proposeAction` kiểm ở lúc ĐỀ XUẤT và `confirmAction` kiểm LẠI ở lúc CHẠY).
-- KHÔNG router tRPC nào, KHÔNG mục menu nào, KHÔNG `RouteGuard` nào dùng tên này.
-- ⇒ Cấp nó KHÔNG mở thêm một màn hình nào, và **KHÔNG** cho phép chạy bất cứ thứ gì tự động: tool
--   là `kind: "write"` nên mọi lượt vẫn phải qua XÁC NHẬN của người dùng, và `run_command` nằm
--   trong `AUTONOMY_INELIGIBLE` nên không cấu hình nào mở được đường tự trị.
--
-- CHỈ `canCreate`, CÓ CHỦ Ý
-- ------------------------------------------------------------------------------------------
-- canView/canEdit/canDelete/canExport đều false. `canCreate` = *"tạo một lượt chạy"*. Bốn ô còn
-- lại để trống vì chúng KHÔNG có nghĩa nào trên module này — để trống thì một lượt "cấp cho đủ"
-- sau này sẽ phải giải thích chúng nghĩa là gì, thay vì trôi vào im lặng.
--
-- DANH SÁCH TRẮNG (hằng của mã nguồn, KHÔNG cấu hình được)
-- ------------------------------------------------------------------------------------------
--   npm run check · npm run check:tests · npx vitest run <đường> · git status · git diff
-- ⚠ `git checkout`, `git reset`, `rm`, `DROP` KHÔNG BAO GIỜ vào danh sách trắng — doc 78 §3 mục 1:
--   ngày 2026-08-18 một tác nhân chạy `git checkout <file>` để hoàn nguyên một sửa đổi 1 dòng và
--   xoá mất 123 dòng chưa commit.
-- ⚠ `npm run build` CỐ Ý bị loại ở lượt đầu — nó ghi đè `dist/index.js`, tức phá đúng dấu vết đang
--   được dùng để nhận diện tiến trình nào đang phục vụ cổng 3000 (so giờ khởi động tiến trình với
--   giờ build của `dist/index.js`).
--
-- `admin` KHÔNG cần hàng: `accessControl.checkPermission` short-circuit `true` cho vai admin khi
-- chưa bật scoped-admin. Hàng cho admin (nếu có) chỉ để bảng quyền của giao diện đủ mục —
-- `DEFAULT_ROLE_PERMISSIONS.admin` đã có, dành cho tài khoản admin tạo MỚI.
--
-- ⚠ KHÔNG lọc theo `isActive` — cùng lý do đã ghi ở 0323/0330: một tài khoản đang tắt mà không có
--   hàng sẽ bị `checkPermission` trả false VĨNH VIỄN sau khi bật lại. Tài khoản tắt phải bị chặn ở
--   tầng ĐĂNG NHẬP, không bằng cách bỏ trống ma trận quyền.
--
-- Idempotent (`NOT EXISTS`), DML thuần (INSERT), KHÔNG DDL ⇒ chạy được bằng cả `aoi` lẫn `avi_app`.
INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport", "grantedAt", "createdAt", "updatedAt")
SELECT u.id, 'settings', 'ai_repo_exec', false, true, false, false, false, now(), now(), now()
FROM users u
WHERE u.role IN ('engineer', 'admin')
  AND NOT EXISTS (
    SELECT 1 FROM permissions p
    WHERE p."userId" = u.id AND p."moduleName" = 'ai_repo_exec'
  );
