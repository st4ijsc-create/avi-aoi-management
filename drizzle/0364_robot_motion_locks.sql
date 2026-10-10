-- ════════════════════════════════════════════════════════════════════════════
-- 0364 — doc 81 Đợt 4 Task B4 (QĐ-4c): KHOÁ CHUYỂN ĐỘNG robot sống qua một lần KHỞI ĐỘNG LẠI (`robot_motion_locks`)
-- ════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO: khoá chuyển động (robotDriver.ts `MotionLock`, ruling R13) chỉ nằm trong BỘ NHỚ của driver. Robot bị khoá vì
--   mất kết nối / kết cục lệnh không rõ, rồi tiến trình khởi động lại ⇒ driver mới, khoá MẤT ⇒ chuyển động được phép
--   lại mà không có lệnh DỪNG được xác nhận hay thao tác gỡ khoá có kiểm toán nào. Quyết định chủ dự án QĐ-4c: lưu khoá;
--   khởi động lại ⇒ robot bắt đầu ở trạng thái KHOÁ.
--
-- NGỮ NGHĨA: một hàng = robot `robotId` ĐANG bị khoá (tối đa một hàng mỗi robot — khoá chính).
--   • ghi khi `MotionLock.lock()` chạy (UPSERT); XOÁ khi `clearByStop` / `clearByOperator`;
--   • nạp lúc đăng ký driver (robotManager.startRobots) ⇒ robot bị khoá trước khi khởi động lại vẫn khoá sau đó;
--   • khoá trong bộ nhớ vẫn là NGUỒN SỰ THẬT khi đang chạy; ghi CSDL lỗi KHÔNG chặn lock() (chỉ log);
--   • nạp lỗi ⇒ fail-closed: robot bắt đầu KHOÁ với lý do `persistUnknown` (gỡ bằng thao tác có kiểm toán).
--   • `generation` = thế hệ khoá mà người vận hành phải trích khi gỡ (compare-and-clear) — giữ đơn điệu qua khởi động lại.
--   • KHÔNG khoá ngoại tới `robots` (khuôn 0363): xoá một robot không bị hàng khoá chặn lại; hàng mồ côi vô hại (chỉ được
--     đọc theo robotId của robot đang đăng ký).
--
-- QUYỀN `avi_app`: SELECT + INSERT + UPDATE + DELETE (gỡ khoá = xoá hàng). KHÔNG TRUNCATE.
--
-- ⚠ DDL chạy bằng owner `aoi` (`avi_app` → 42501): `node scripts/apply-migration-0364.mjs --test-only`
--   (dev: `--dev-only`, do chủ dự án quyết; không cờ ⇒ script TỪ CHỐI chạy — R-3-g).
-- ⚠ Repo CẤM `drizzle-kit push/generate` — bảng khai TAY vào `drizzle/schema/robot.ts` cùng lượt.
-- ROLLBACK: DROP TABLE IF EXISTS "robot_motion_locks";
--
CREATE TABLE IF NOT EXISTS "robot_motion_locks" (
  "robotId" integer PRIMARY KEY,
  "reasonCode" varchar(64) NOT NULL,
  "detail" text,
  "generation" integer NOT NULL CHECK ("generation" >= 1),
  "lockedAt" timestamp NOT NULL DEFAULT now()
);
COMMENT ON TABLE "robot_motion_locks" IS
  'doc 81 Dot 4 Task B4 (QD-4c): khoa chuyen dong robot dang dat - nap luc dang ky driver, xoa khi STOP xac nhan / go khoa co kiem toan.';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    -- REVOKE tường minh: default ACL của dev cấp ĐỦ quyền cho avi_app (0357 đo 2026-09-15).
    REVOKE TRUNCATE ON "robot_motion_locks" FROM avi_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "robot_motion_locks" TO avi_app;
  END IF;
END $$;
