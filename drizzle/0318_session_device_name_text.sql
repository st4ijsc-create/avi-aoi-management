-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0318 — NỚI `user_sessions.deviceName` TỪ varchar(255) SANG text        ✅ **ĐÃ ÁP 2026-08-11**
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ✅ **CHỦ DỰ ÁN DUYỆT 2026-08-11.** Đuôi `.DRAFT` đã được bỏ; file áp qua đúng đường chuẩn
--     (`scripts/migrate-standalone.mjs`, owner `aoi`, **CẢ HAI** DB) — **không** chạy tay bằng
--     `psql`: mig `0317` áp ngoài đường chuẩn và đã đẻ ra một chú thích sai về sổ sách (M-1).
--     ⚠ Lượt áp thu hẹp danh sách file của bộ chạy về **đúng 0318** (repo còn **6** migration
--       "pending" là nợ CÓ TRƯỚC: 0057 · 0066 · 0125 · 0234 mang `success=false` từ 2026-07-19,
--       và 0308 · 0309 **không có hàng sổ nào** — cùng lớp nợ mà 0317 vừa để lại). Brief cấm mọi
--       DDL ngoài 0318, nên sáu file ấy **KHÔNG** được đụng tới, và chúng vẫn là nợ đang mở.
--
-- ⚠⚠ **LƯỢT VÁ ĐÃ SHIP KHÔNG PHỤ THUỘC FILE NÀY.** Lỗ C-2 đã được đóng ở tầng ứng dụng:
--     `server/db/catTheoTranCot.ts` cắt **mọi** cột `varchar(n)` theo trần **suy từ schema** ngay
--     tại người ghi duy nhất (`createUserSession`). Mig này là **đường vá 2** — *"đúng LỚP LỖI"*,
--     theo chính lý lẽ của 0317: một trần đoán trên dữ liệu ngoài tầm kiểm soát là **lớp lỗi**,
--     không phải một con số cụ thể. Áp nó ⇒ cột rời tập bị cắt **tự động** (phép cắt đọc trần từ
--     schema), không phải sửa dòng mã nào.
--
-- ⚠ VÌ SAO — LỖ ĐANG SỐNG, ĐO ĐƯỢC 2026-08-10 TRÊN MÁY CHỦ PID 37600
--
--   `deviceName` được nạp **thẳng** từ `req.headers["user-agent"]` (`authService.establishSession`)
--   — **không phải dữ liệu người dùng, mà là dữ liệu KẺ TẤN CÔNG**, đặt tuỳ ý trong một header.
--     · login với UA **3.770** ký tự      ⇒ HTTP 200, `user_sessions` **0 hàng mới**
--     · `auth.logout`                     ⇒ HTTP 200 {"success":true}
--     · `auth.me` sau đó                  ⇒ HTTP 200, **VẪN ĐỦ HỒ SƠ**
--   ⇒ Kẻ tấn công **tự chọn** cho phiên của mình trở nên vô hình với `session.list` và ngoài tầm
--     `session.revoke` / `revokeAll` / `auth.logout`, sống tới `exp` (đo được: **2027-08-09**).
--
-- ⚠ VÌ SAO `text` CHỨ KHÔNG PHẢI `varchar(512)` / `varchar(4096)`
--
--   Postgres lưu `varchar(n)` và `text` **y hệt nhau** (cùng `varlena`); `n` chỉ là một ràng buộc
--   kiểm lúc ghi. Không tốn thêm ô đĩa, không đổi hiệu năng. Một con số mới chỉ **dời** cùng lớp
--   lỗi sang chỗ khác. Độ dài UA do bên ngoài quyết định ⇒ mọi trần đều là TRẦN ĐOÁN.
--   ⚠ Sau lượt áp, phép cắt ở tầng ứng dụng vẫn giữ **`ipAddress` (45)** và bốn cột còn lại — nên
--     một UA dài sẽ được lưu **NGUYÊN VĂN**. Đó là chủ ý: `deviceName` là dữ liệu chẩn đoán, và
--     một chuỗi dài trong cột `text` không tốn gì. Ai muốn chặn phình sổ thì đặt trần **ở tầng ứng
--     dụng** (một con số nói ra được), không đặt bằng một `varchar(n)` làm vỡ câu `INSERT`.
--
-- ⚠ ĐO NGAY TRƯỚC LƯỢT ÁP (2026-08-11, owner `aoi`, cổng 5434) — SỐ THẬT, không phải kỳ vọng:
--     · phụ thuộc khung nhìn / rule trên cột `deviceName`:  **0** · **0**   (prod · test)
--       (`pg_depend`⋈`pg_rewrite` khoá theo `attname='deviceName'`; `pg_rules` trên bảng: 0 · 0)
--     · chỉ số trên cột `deviceName`:                       **0** · **0**
--       (6 chỉ số trên `user_sessions`, không cái nào chạm `deviceName`: pkey · userId · isActive
--        · expiresAt · UNIQUE sessionToken · idx sessionToken)
--     · số hàng `user_sessions`:                            **293** · **107**
--   `varchar(n)` → `text` là **binary-coercible** ⇒ Postgres **KHÔNG** viết lại bảng. Khoá
--   ACCESS EXCLUSIVE trong lượt đổi; với vài trăm hàng là mili-giây.
--
-- ⚠ HAI DB: `aoi_management` **và** `aoi_management_test`. Bỏ sót DB test ⇒ lưới đo một thứ khác
--   với sản xuất, đúng lớp lỗi đã ba lần làm một lượt nghiệm thu nói dối.
-- ════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "user_sessions" ALTER COLUMN "deviceName" TYPE text;

-- ── ĐỐI CHỨNG NGAY TRONG LƯỢT ÁP: sai thì HUỶ CẢ LƯỢT ───────────────────────────────────────
-- ⚠ Đối chứng phải nằm TRONG cùng một khối `DO` với mọi phép đo nó dùng: `GET DIAGNOSTICS
--   ROW_COUNT` ở một khối `DO` RIÊNG **không** thấy `ROW_COUNT` của câu lệnh trước đó (đã đo được
--   2026-08-10 — một cầu chì báo "chạm 0 hàng" trong khi câu lệnh vẫn đúng).
DO $$
DECLARE
  kieu    text;
  tran    integer;
  so_hang bigint;
BEGIN
  SELECT data_type, character_maximum_length INTO kieu, tran
    FROM information_schema.columns
   WHERE table_name = 'user_sessions' AND column_name = 'deviceName';

  IF kieu <> 'text' OR tran IS NOT NULL THEN
    RAISE EXCEPTION 'HUỶ: cột chưa thành text (kiểu=%, trần=%)', kieu, tran;
  END IF;

  -- `sessionToken` phải VẪN là `text` và VẪN UNIQUE — lượt này không được chạm nó.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'user_sessions'::regclass
       AND contype  = 'u'
       AND pg_get_constraintdef(oid) LIKE '%sessionToken%'
  ) THEN
    RAISE EXCEPTION 'HUỶ: ràng buộc UNIQUE trên sessionToken đã biến mất';
  END IF;

  SELECT count(*) INTO so_hang FROM user_sessions;
  RAISE NOTICE 'ĐỐI CHỨNG ĐẠT: deviceName = text, UNIQUE sessionToken còn nguyên, % hàng giữ nguyên', so_hang;
END $$;

COMMIT;

-- ── SAU KHI ÁP: nhớ sửa khai báo TS cho KHỚP DB ─────────────────────────────────────────────
--   `drizzle/schema/auth.ts:238`  `deviceName: varchar("deviceName", { length: 255 })`
--                              →  `deviceName: text("deviceName")`
--   ⚠ drizzle liệt kê **toàn bộ** cột ở mọi câu lệnh, nên một ô lệch kiểu cắn ở chỗ khác chứ không
--     cắn tại đây. Và lưới `server/_core/tranCotSoPhien.test.ts` §1a ghim `TRAN.deviceName = 255`
--     ⇒ nó sẽ **ĐỎ** ngay sau lượt áp, đúng như nó phải thế: đổi trần là một quyết định nói ra.
