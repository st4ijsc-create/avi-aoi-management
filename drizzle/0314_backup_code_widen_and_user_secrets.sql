-- ============================================================================
-- Migration 0314 (NỞ):
--   (9a) backup_codes.code  varchar(20) -> varchar(255)   ⚠ MỤC CHẶN
--   (9b) HAI MỐC "buộc đổi mật khẩu" — trên `users` (QĐ-1 chủ dự án 2026-08-09)
--   (9c) user_secrets — tách bí mật khỏi bảng dữ liệu công khai (CHỈ TẠO + CHÉP)
--   (QĐ-3) XOÁ idx_backup_codes_code (0 truy vấn dùng)
-- (Pha 7 Task 9, docs/superpowers/plans/2026-08-07-vram-pha7-backlog.md)
-- Đề xuất + lý lẽ đầy đủ:
--   docs/superpowers/reports/2026-08-09-vram-pha7-task9-migration-de-xuat.md
--
-- ⚠⚠⚠ MIGRATION NÀY **THUẦN THÊM**. Nó KHÔNG bỏ một cột nào. Lượt bỏ cột nằm ở
--     0315 (nguyên văn ở §3.2 của báo cáo, CỐ Ý CHƯA GHI THÀNH FILE) và CHỈ được
--     áp sau khi mã mới đã deploy + nghiệm thu sống ĐẠT.
--     Lý do: 8 hàm ở server/db/auth.ts đọc NGUYÊN HÀNG `users`; drizzle liệt kê
--     TOÀN BỘ cột ⇒ bỏ cột trước khi deploy = `42703` ở mọi lượt đọc `users`
--     = NGỪNG DỊCH VỤ toàn phần (GOTCHA Wave 3, lần thứ BA cùng một lớp lỗi).
--
-- ══════════════════════════════════════════════════════════════════════════
-- (9a) VÌ SAO: `bamMaDuPhong()` (server/_core/backupCodeSecret.ts:56) trả một
--      chuỗi bcrypt PHC dài **60**; cột nhận nó rộng **20**. Đo được trên
--      `aoi_management`, trong một giao dịch đã ROLLBACK:
--          22001  value too long for type character varying(20)   (routine: varchar)
--      và ĐỐI CHỨNG: một chuỗi 8 ký tự chèn ĐƯỢC ⇒ bảng/quyền/ràng buộc lành,
--      lỗi đến ĐÚNG từ bề rộng.
--      Sau Task 8a, đường băm là đường ghi **DUY NHẤT** còn lại ⇒ trước lượt vá
--      này **không ai** nhận được mã dự phòng. Bằng chứng khớp: 8/8 tài khoản
--      bật 2FA, bảng `backup_codes` có **0 hàng**.
--
-- ⚠ VÌ SAO 255 CHỨ KHÔNG 60 (QĐ-2): 60 là bề rộng của **bcrypt hôm nay**. Đổi
--   sang argon2id (~97) hay scrypt (~101) sẽ đẻ đúng lượt `22001` này lần thứ
--   hai. 255 khớp **tiền lệ trong CHÍNH DB NÀY** cho **CÙNG LOẠI GIÁ TRỊ**:
--   `users."passwordHash"` là varchar(255) và đang chứa đúng một hash bcrypt 60.
--   ⚠⚠ NHƯNG: một BỀ RỘNG vẫn là một lời hứa hình DANH SÁCH. Thứ làm `22001`
--      thành điều KHÔNG THỂ là một LƯỢNG TỪ, không phải con số:
--        ∀ giá trị `bamMaDuPhong()` sinh ra: length <= bề rộng khai ở drizzle
--      SUY RA cả hai vế (một vế từ `getTableColumns`, một vế từ lượt băm thật),
--      KHÔNG viết tay số 60. Đó là ràng buộc của Bước 5 (`backupCodeWidth.test.ts`).
--
-- ══════════════════════════════════════════════════════════════════════════
-- (9c) VÌ SAO: Task 7 đóng lượt rò ở **tầng TRẢ VỀ** (danh sách CHO PHÉP +
--      đổi kiểu). Đúng và đủ cho hôm nay — nhưng bí mật vẫn nằm **cùng hàng**
--      với dữ liệu công khai, nên **8 hàm** đọc nguyên hàng `users` vẫn kéo
--      `passwordHash` + `two_factor_secret` vào bộ nhớ tiến trình ở MỌI lượt,
--      kể cả `getUserById` — thứ `sdk.authenticateRequest` gọi mỗi request.
--      Mỗi `SELECT` mới viết ngày mai là một lỗ TIỀM NĂNG mới.
--      Tách bảng làm lượt rò **không viết ra được ở tầng DB**: một hàng `users`
--      KHÔNG CÒN CHỨA bí mật để mà rò.
--
-- ⚠ KHOÁ NGOẠI **CÓ**, và đây là chỗ khác Task 5 (`totp_consumed` cố ý KHÔNG
--   có FK). Lý do đảo ngược: hàng ở đây KHÔNG tự chết. `deleteUser()`
--   (server/db/auth.ts:122) chạy một `DELETE FROM users` trần, và DB hiện có
--   **0 khoá ngoại trỏ tới `users`** (đo được; 63 FK trong `public`, không cái
--   nào trỏ `users`) ⇒ không có FK thì xoá một tài khoản để lại **hash mật khẩu
--   và hạt giống TOTP sống lâu hơn chính tài khoản**. `ON DELETE CASCADE` biến
--   phép dọn ấy thành **cấu trúc**, không thành một dòng mã ai đó phải nhớ.
--   ⚠ Đây là khoá ngoại ĐẦU TIÊN trỏ tới `users` trong DB này — nói ra để
--     lượt sau không tưởng là tai nạn. (Nợ CÙNG LỚP đã có sẵn ở `backup_codes`,
--     KHÔNG vá ở lượt này — xem §2.8 báo cáo.)
--
-- ══════════════════════════════════════════════════════════════════════════
-- (9b) ⚠⚠ QĐ-1 CHỦ DỰ ÁN 2026-08-09: hai mốc đặt trên **`users`**, KHÔNG trên
--      `user_secrets` — **ngược** đề xuất §3.4 của báo cáo. Rủi ro đã nêu
--      (phân loại `"public"` ⇒ `user.list` phát danh sách tài khoản đang bị
--      buộc đổi mật khẩu) được đóng **ở tầng mã, theo cấu tạo**, không ở tầng
--      SQL: cả hai cột được phân loại **`"server-only"`** trong
--      `USER_FIELD_VISIBILITY` (server/_core/publicUser.ts), nên `toPublicUser()`
--      — phép chiếu theo **danh sách CHO PHÉP** — không phát chúng ra được;
--      client biết qua **một ô SUY RA tường minh** `mustChangePassword` trên
--      `auth.me`. Ba ca cưỡng chế điều đó ở `server/_core/publicUser.test.ts`
--      và `server/routers/mustChangePassword.test.ts`.
--
-- VÌ SAO HAI CỘT CHỨ KHÔNG MỘT CỜ `boolean`:
--   Một cờ `mustChangePassword boolean` cần **ai đó nhớ XOÁ nó** sau lượt đổi
--   mật khẩu. Quên đặt ⇒ hỏng IM LẶNG theo chiều MỞ (không ai bị buộc).
--   Hai mốc thời gian cho phép **SUY RA** vị từ, và tự dọn theo cấu tạo:
--       PHAI_DOI  <=>  "passwordInvalidBefore" IS NOT NULL
--                      AND ("passwordChangedAt" IS NULL
--                           OR "passwordChangedAt" <= "passwordInvalidBefore")
--   · lượt đổi mật khẩu ghi `passwordChangedAt = now()` ⇒ vị từ TỰ thành false;
--   · lượt xoay thứ hai chỉ đẩy `passwordInvalidBefore` tới ⇒ không có trạng
--     thái "cờ đã bật sẵn nên lần này không ăn";
--   · quên ghi `passwordChangedAt` ⇒ hỏng theo chiều **ĐÓNG** (bị buộc đổi dù
--     vừa đổi) — phiền, nhưng KHÔNG mở cửa.
--   BA giá trị, cùng kỷ luật `TrangThaiTienTrinh` (vramAdoption.ts:70) và cột
--   `vram_leases."identityTruncated"` của mig 0313:
--       passwordChangedAt = NULL      -> KHÔNG BIẾT mật khẩu đặt lúc nào.
--                                        Với một lượt thu hồi đang hiệu lực,
--                                        NGƯỜI ĐỌC PHẢI coi là PHẢI ĐỔI.
--       passwordInvalidBefore = NULL  -> CHƯA TỪNG thu hồi -> không buộc ai.
--   ⚠ KHÔNG đặt DEFAULT cho cả hai: một DEFAULT now() sẽ biến "chưa biết"
--     thành "vừa đổi xong" — đúng lời nói dối mà cặp cột này sinh ra để diệt.
--     Hệ quả: migration này **TRUNG TÍNH VỀ HÀNH VI** ngay lúc áp (8/8 hàng có
--     passwordInvalidBefore = NULL ⇒ 0 người bị buộc đổi).
--
-- ══════════════════════════════════════════════════════════════════════════
-- ADDITIVE + IDEMPOTENT. Chạy bằng owner `aoi` (đo được: DATABASE_URL của app
-- là `avi_app` ⇒ sẽ 42501). Áp lên CẢ `aoi_management` LẪN `aoi_management_test`.
-- ⚠⚠ THỨ TỰ BẮT BUỘC: 0314 -> deploy mã -> nghiệm thu sống -> 0315. Xem §3.5.
-- ROLLBACK: §3.6 của báo cáo Task 9.
-- ============================================================================

-- ── (9a) nới cột mã dự phòng ────────────────────────────────────────────────
-- `ALTER COLUMN ... TYPE` không có `IF NOT EXISTS` ⇒ tự canh bằng catalog.
-- (Bề rộng NULL — cột không tồn tại — cho vị từ NULL ⇒ khối không chạy: an toàn.)
DO $$
BEGIN
  IF (SELECT character_maximum_length
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'backup_codes'
         AND column_name  = 'code') < 255 THEN
    ALTER TABLE "backup_codes" ALTER COLUMN "code" TYPE varchar(255);
  END IF;
END $$;

-- ── (QĐ-3) chỉ mục phục vụ 0 truy vấn ───────────────────────────────────────
-- Phép đối chiếu mã dự phòng là `bcrypt.compare` TRÊN TỪNG HÀNG
-- (server/db/auth.ts:332, twoFactorRouter.ts:231/318); `eq(backupCodes.code, …)`
-- xuất hiện 0 lần trong toàn repo (đã đếm). Chỉ mục này trả chi phí ghi cho mỗi
-- mã sinh ra (10 mã/lượt bật 2FA) và đặt một hash bí mật vào một cấu trúc sắp
-- thứ tự. ⚠ Đây là mục chủ dự án ĐÃ DUYỆT (QĐ-3).
DROP INDEX IF EXISTS "idx_backup_codes_code";

-- ── (9b) hai MỐC trên `users` — QĐ-1 ────────────────────────────────────────
-- ⚠ KHÔNG DEFAULT (xem khối lý do ở header). NULL/NULL = trung tính.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt"     timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordInvalidBefore" timestamp;

-- ── (9c) bảng bí mật ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_secrets" (
  -- 1:1 với `users`. PK trên `userId` ⇒ "một người một hàng" là CẤU TRÚC,
  -- không phải một quy ước. `users.id` là `integer` (đã kiểm information_schema).
  "userId"          integer PRIMARY KEY
                    REFERENCES "users"("id") ON DELETE CASCADE,

  -- bcrypt PHC. NULL được: tài khoản OAuth/SSO không có mật khẩu cục bộ —
  -- đúng như `users."passwordHash"` hôm nay (nullable), giữ nguyên ngữ nghĩa.
  "passwordHash"    varchar(255),

  -- hạt giống TOTP base32 (đo được: dài nhất 52). 255 = giữ nguyên bề rộng cũ,
  -- KHÔNG thu hẹp: một lượt migrate không phải chỗ để đổi thêm một bất biến.
  "twoFactorSecret" varchar(255),

  -- cùng khuôn `vram_leases`/`totp_consumed`: `timestamp` KHÔNG múi giờ,
  -- máy chủ chạy timezone = Etc/UTC.
  "updatedAt"       timestamp NOT NULL DEFAULT now()
);

-- ⚠ KHÔNG chỉ mục nào ngoài PK: đường đọc DUY NHẤT là theo `userId`, và PK đã
--   phục vụ nó. Một chỉ mục trên `passwordHash`/`twoFactorSecret` sẽ trả chi phí
--   ghi cho 0 truy vấn — và đặt một bí mật vào một cấu trúc sắp thứ tự.

-- Chép dữ liệu. `DO NOTHING` (KHÔNG `DO UPDATE`): nếu file này chạy lại trong
-- một lượt khôi phục, hàng ở `user_secrets` là bản MỚI HƠN — đè nó bằng bản trên
-- `users` sẽ HỒI SINH một mật khẩu cũ. Im lặng, và không hoàn tác được.
-- ⚠ Câu ĐỒNG BỘ LẠI (ON CONFLICT DO UPDATE) nằm ở §3.5 báo cáo và CHỈ được chạy
--   ngay TRƯỚC khi build mới khởi động — không phải ở đây.
INSERT INTO "user_secrets" ("userId", "passwordHash", "twoFactorSecret", "updatedAt")
SELECT u."id", u."passwordHash", u."two_factor_secret", now()
  FROM "users" u
ON CONFLICT ("userId") DO NOTHING;

-- ⚠ `pg_default_acl` của DB này ĐÃ có `{avi_app=arwd/aoi}` cho mọi bảng do `aoi`
--   tạo (đo được) ⇒ dòng dưới là dòng LÀM RÕ, KHÔNG phải dòng cứu mạng.
--   Giữ lại vì một vai khác `aoi` chạy lượt này sẽ tạo ra một bảng `avi_app`
--   không đọc nổi. (Câu này đã suýt bị viết sai ở mig 0313; phép đo sửa nó.)
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_secrets" TO "avi_app";
