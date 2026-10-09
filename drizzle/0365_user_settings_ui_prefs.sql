-- ════════════════════════════════════════════════════════════════════════════
-- 0365 — doc 81 Đợt 4 Task D1: SỞ THÍCH GIAO DIỆN THEO TÀI KHOẢN (`user_settings.uiPrefs`)
-- ════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO: "Hiện Labs" (Đợt 3 Task 5) và kích thước/gập panel WorkbenchShell chỉ nằm trong localStorage ⇒ đổi máy /
--   đổi trình duyệt là mất. Nay server giữ một bản theo tài khoản; localStorage vẫn là bộ nhớ đệm tức thời của client.
--
-- NGỮ NGHĨA: một object JSON phẳng `{ khoá: giá trị }` cho mỗi người dùng.
--   • Danh sách khoá hợp lệ nằm ở ĐÚNG MỘT chỗ: `shared/uiPrefs.ts` (`checkUiPrefsPatch`) — router từ chối mọi khoá
--     khác. KHÔNG lặp lại thành CHECK ở đây (hai nguồn sẽ lệch); CHECK chỉ giữ HÌNH (object) và TRẦN 16 KB.
--   • Ghi = gộp `uiPrefs || bản_vá` trong MỘT câu (server/db/userUiPrefs.ts) — không đọc-sửa-ghi.
--   • Trần 16384 byte đo bằng `octet_length("uiPrefs"::text)` — CÙNG phép đo router dùng trong mệnh đề WHERE của
--     câu gộp (vượt ⇒ 0 hàng ⇒ BAD_REQUEST). CHECK là lớp thứ hai cho đường ghi khác (SQL tay).
--
-- CỘT KHÔNG KHAI vào drizzle schema (`drizzle/schema/dashboard.ts#userSettings`): `select().from(userSettings)` liệt kê
--   mọi cột đã khai ⇒ DB chưa áp 0365 sẽ hỏng 42703 ở trang cài đặt người dùng (bài học 0361; khuôn 0363). Chỉ
--   `server/db/userUiPrefs.ts` đọc/ghi cột bằng SQL thô.
--
-- QUYỀN `avi_app`: KHÔNG đổi. Bảng đã cấp SELECT/INSERT/UPDATE/DELETE cho avi_app từ trước (đo trên _test 2026-10-10:
--   s/i/u/d = true, truncate = false); quyền UPDATE mức BẢNG phủ cột mới. Script áp chỉ KIỂM (không GRANT/REVOKE).
--
-- ⚠ DDL chạy bằng owner `aoi` (`avi_app` → 42501): `node scripts/apply-migration-0365.mjs --test-only`
--   (dev: `--dev-only`, do chủ dự án quyết; không cờ ⇒ script TỪ CHỐI chạy — R-3-g).
-- ⚠ Repo CẤM `drizzle-kit push/generate`.
-- ROLLBACK: ALTER TABLE "user_settings" DROP CONSTRAINT IF EXISTS "chk_user_settings_ui_prefs";
--           ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "uiPrefs";
--
-- Hằng số mặc định không đổi (PG ≥ 11) ⇒ ADD COLUMN chỉ đổi catalog, không viết lại bảng.
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "uiPrefs" jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.user_settings'::regclass AND conname = 'chk_user_settings_ui_prefs'
  ) THEN
    ALTER TABLE "user_settings" ADD CONSTRAINT "chk_user_settings_ui_prefs"
      CHECK (jsonb_typeof("uiPrefs") = 'object' AND octet_length("uiPrefs"::text) <= 16384);
  END IF;
END $$;
COMMENT ON COLUMN "user_settings"."uiPrefs" IS
  'doc 81 Dot 4 Task D1: so thich giao dien theo tai khoan (showLabs + kich thuoc/gap panel WorkbenchShell). Danh sach khoa: shared/uiPrefs.ts. Tran 16384 byte.';
