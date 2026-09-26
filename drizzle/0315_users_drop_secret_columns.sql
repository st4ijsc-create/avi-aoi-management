-- ============================================================================
-- Migration 0315 (CO): bỏ hai cột bí mật khỏi `users`.
--
-- ⛔⛔⛔ ĐIỀU KIỆN VÀO — BA ĐIỀU, KHÔNG PHẢI MỘT:
--   (1) 0314 đã áp trên CẢ HAI DB;
--   (2) build mới ĐÃ CHẠY (`users` trong drizzle KHÔNG CÒN hai cột ấy; mọi
--       đường đọc/ghi bí mật đã trỏ `user_secrets`) — kiểm bằng
--       `git show <commit>:drizzle/schema/auth.ts`, KHÔNG bằng trí nhớ;
--   (3) NGHIỆM THU SỐNG Bước 8 ĐẠT: một tài khoản đăng ký lại 2FA và NHẬN
--       ĐƯỢC mã dự phòng trên hệ thật.
-- Áp khi (2) chưa xong ⇒ `42703` ở 8 hàm đọc nguyên hàng `users` ⇒ NGỪNG DỊCH VỤ.
--
-- ⚠ ĐÂY LÀ CÂU KHÔNG HOÀN TÁC ĐƯỢC BẰNG DDL ĐƠN THUẦN: dữ liệu đi theo cột.
--   Hoàn tác được CHỈ VÌ `user_secrets` giữ bản sao — xem §3.6.
-- Chạy bằng owner `aoi`. Áp lên CẢ hai DB.
--
-- ── BA ĐIỀU KIỆN ĐÃ ĐO LẠI TRƯỚC LƯỢT ÁP (2026-08-09) ──────────────────────
--   (1) __applied_migrations chứa `0314_backup_code_widen_and_user_secrets.sql`
--       trên `aoi_management` VÀ `aoi_management_test`.
--   (2) `dist/index.js` ĐANG CHẠY (PID 4468, khởi động 09:09:45) chứa
--       `user_secrets` và có **0** lần xuất hiện `two_factor_secret`.
--       `git show HEAD:drizzle/schema/auth.ts` ⇒ `users` không còn hai cột.
--   (3) Task 9 Bước 8: `engineer1` đăng ký lại 2FA, 10 mã dự phòng hash 60,
--       một mã xác minh THÀNH CÔNG. Task 10: xoay bí mật, nghiệm thu sống ĐẠT.
--   Chi tiết + ảnh chụp TRƯỚC/SAU: §12–§16 của
--   docs/superpowers/reports/2026-08-09-vram-pha7-task9-migration-de-xuat.md
-- ============================================================================

-- Lưới chặn cuối, chạy TRƯỚC khi bỏ.
DO $$
DECLARE thieu int; lech int;
BEGIN
  SELECT count(*) INTO thieu
    FROM "users" u LEFT JOIN "user_secrets" s ON s."userId" = u."id"
   WHERE s."userId" IS NULL;
  IF thieu > 0 THEN
    RAISE EXCEPTION 'DUNG: % hang users KHONG co hang user_secrets — chep lai truoc khi bo cot', thieu;
  END IF;

  SELECT count(*) INTO lech
    FROM "users" u JOIN "user_secrets" s ON s."userId" = u."id"
   WHERE u."passwordHash"      IS DISTINCT FROM s."passwordHash"
      OR u."two_factor_secret" IS DISTINCT FROM s."twoFactorSecret";
  -- ⚠ `lech > 0` là ĐIỀU BÌNH THƯỜNG sau khi mã mới chạy (mã mới chỉ ghi
  --   `user_secrets`; cột cũ đứng yên và HOÁ CŨ). Nên đây là CẢNH BÁO, không
  --   phải EXCEPTION — nhưng nó phải được IN RA, vì nó là con số duy nhất nói
  --   "cột cũ đã chết bao lâu rồi".
  RAISE NOTICE 'so hang co cot cu LECH voi user_secrets: % (0 = ma moi chua ghi lan nao)', lech;
END $$;

ALTER TABLE "users" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_factor_secret";
