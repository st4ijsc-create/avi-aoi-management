-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0319 — NỚI `user_sessions.ipAddress` TỪ varchar(45) SANG text        ✅ **ĐÃ ÁP 2026-08-12**
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ✅ **CHỦ DỰ ÁN DUYỆT 2026-08-11.** Đuôi `.DRAFT` đã được bỏ; file áp qua đúng đường chuẩn
--     (`scripts/migrate-standalone.mjs`, `MIGRATE_STRICT=1`, owner `aoi`, **CẢ HAI** DB) —
--     **không** chạy tay bằng `psql`: mig `0317` áp ngoài đường chuẩn và đã đẻ ra nợ sổ sách.
--     ⚠ Lượt áp **thu hẹp** danh sách file của bộ chạy về **đúng 0319 + 0320**. Repo còn nợ sổ
--       CÓ TRƯỚC mà lượt này **KHÔNG** được đụng: `0057` · `0066` · `0125` · `0234` mang
--       `success=false` từ 2026-07-19 (cả hai DB), cộng `0308` · `0309` **không có hàng sổ nào**
--       trên `aoi_management`, và `0300`–`0309` (10 file) không có hàng sổ trên `aoi_management_test`.
--       Bộ chạy sắp file theo tên ⇒ chạy nguyên danh sách với `MIGRATE_STRICT=1` sẽ **dừng ở 0057**
--       và 0319 **không bao giờ tới lượt**. Thu hẹp là bắt buộc, không phải tuỳ chọn.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ PHÁN QUYẾT TRUNG THỰC: **CÙNG LỚP LỖI, NHƯNG CÓ ĐIỀU KIỆN — VÀ ĐIỀU KIỆN ẤY KHÔNG ĐƯỢC GHIM**
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- `deviceName` (mig 0318) là **dữ liệu kẻ tấn công VÔ ĐIỀU KIỆN**: nó nạp thẳng từ header
-- `User-Agent`, ai cũng đặt được, dài bao nhiêu cũng được. `ipAddress` **KHÁC**, và khác vì một
-- lý do **CẤU HÌNH**, không phải vì một tính chất của kiểu dữ liệu:
--
--   `auditCtxFromRequest` (`server/_core/authService.ts`) đọc `req.ip ?? req.socket.remoteAddress`.
--   Express chỉ suy `req.ip` từ header **`X-Forwarded-For`** khi `app.set("trust proxy", …)` được
--   bật. Phép đo 2026-08-11: **KHÔNG có** lời gọi `trust proxy` nào trong `server/**`, và **không
--   có** biến `TRUST_PROXY` nào trong `.env` ⇒ mặc định Express là `false` ⇒ hôm nay `req.ip` là
--   **địa chỉ socket THẬT**, kẻ gọi **không** đặt được.
--
-- ⇒ Trần 45 hôm nay **không** bị một header lái. Nhưng nó an toàn **NHỜ MỘT CẤU HÌNH KHÔNG AI
--   GHIM**: đặt một reverse proxy trước ứng dụng rồi bật `trust proxy` — một việc bình thường khi
--   lên sản xuất — là `ipAddress` **lập tức** trở thành dữ liệu kẻ tấn công, và trần 45 trở thành
--   **đúng lớp lỗi C-2** với **không một dòng mã nào thay đổi**. Đó là lý do file này tồn tại:
--   *"an toàn là HỆ QUẢ của thứ khác đang tắt"* là một lớp lỗi đã ghi tên ở Pha 4.
--
-- ⚠ Còn một nguồn dài **không** cần `trust proxy`: `remoteAddress` của IPv6 link-local có thể mang
--   **zone index** (`fe80::1%eth0`). 45 là biên của dạng *IPv4-mapped IPv6* chuẩn; nó **không** kể
--   zone. Đây là một trần đoán trên một chuỗi mà chuẩn không đóng.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ VÌ SAO **KHÔNG GẤP** (và vì sao vẫn nên áp)
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Lỗ `22001` **đã đóng ở tầng ứng dụng**: `server/db/catTheoTranCot.ts` cắt **mọi** cột `varchar(n)`
-- theo trần **suy từ schema**, ngay tại người ghi duy nhất (`createUserSession`). Nên kể cả khi
-- `trust proxy` được bật, lượt `INSERT` **không vỡ** — giá trị chỉ bị **cắt**.
-- ⇒ Thiệt hại còn lại nếu KHÔNG áp: một địa chỉ IP **bị cắt cụt** trong sổ phiên và sổ kiểm toán,
--   tức một **dấu vết điều tra sai** (`203.0.113.11` cắt thành `203.0.113.1` vẫn là một IP hợp lệ
--   — sai mà **trông đúng**, kiểu hỏng tệ nhất). Đó là lý do vẫn nên áp, chỉ là không gấp.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ ĐO LẠI 2026-08-12 NGAY TRƯỚC LƯỢT ÁP (owner `aoi`, cổng 5434) — SỐ THẬT
-- ════════════════════════════════════════════════════════════════════════════════════════════
--   · phụ thuộc khung nhìn / rule trên `user_sessions.ipAddress`: **0** · **0**  (prod · test)
--   · chỉ số chạm `ipAddress`:                                    **0** · **0**
--   · số hàng `user_sessions`:                                    **298** · **136**
--   · giá trị `ipAddress` DÀI NHẤT đang có:                       **16** · **16** ký tự
--     (298/298 hàng prod có giá trị · 56/136 hàng test) ⇒ **0 hàng** đang chạm trần 45
--   ⚠ Số của bản nháp 2026-08-11 (**293** · **107** hàng) nay đã **CŨ** — bảng vẫn đang nhận
--     phiên mới. Kết luận **không đổi**: trần 45 vẫn chưa bị chạm, và lượt nới vẫn không mất dữ liệu.
--   `varchar(n)` → `text` là **binary-coercible** ⇒ Postgres **KHÔNG** viết lại bảng.
--
-- ⚠⚠⚠ **PHẠM VI CỐ Ý HẸP — VÀ ĐÂY LÀ NỢ ĐƯỢC KHAI, KHÔNG PHẢI VÙNG MÙ.**
--     Cột `ipAddress varchar(45)` có mặt ở **13 bảng** trên `aoi_management` (`audit_logs`,
--     `backup_logs`, `machines`, `machine_heartbeats`, `machine_status_logs`,
--     `manual_machine_connections`, `mqtt_clients`, `mqtt_connection_logs`,
--     `package_activity_logs`, `sync_logs`, `user_sessions`, + 2 chunk Timescale).
--     File này chỉ đụng **`user_sessions`** vì đó là bảng nằm trên **đường xác thực** — cùng phạm vi
--     với 0317/0318, và là chỗ một lượt ghi hỏng từng đúc ra phiên không thu hồi được.
--     ⇒ **12 bảng kia vẫn mang cùng một trần đoán.** Chúng KHÔNG nằm trên đường xác thực, và
--     `audit_logs` là bảng đáng bàn tiếp theo (nó cũng ghi IP của người gọi). Một lượt quét toàn
--     bảng là **quyết định riêng của chủ dự án**, không phải một dòng phụ của file này.
--
-- ⚠ SAU KHI ÁP: `drizzle/schema/auth.ts` phải đổi `ipAddress: varchar("ipAddress",{length:45})`
--   → `text("ipAddress")` (drizzle liệt kê **toàn bộ** cột ở mọi câu lệnh ⇒ ô lệch kiểu cắn ở chỗ
--   khác). Và `server/_core/tranCotSoPhien.test.ts` §1a/§2a ghim `TRAN.ipAddress = 45` ⇒ chúng sẽ
--   **ĐỎ**, đúng như phải thế. ⚠ Lúc đó `user_sessions` **không còn cột `varchar` nào** ⇒ ô cầu chì
--   §1a (`Object.keys(TRAN).length >= 5`) cũng ĐỎ: phép cắt trở thành no-op **cho bảng này**, và
--   lưới phải chuyển sang neo vào một bảng khác hoặc khai rằng tập đã rỗng **có chủ ý**.
-- ════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "user_sessions" ALTER COLUMN "ipAddress" TYPE text;

-- ── ĐỐI CHỨNG NGAY TRONG LƯỢT ÁP: sai thì HUỶ CẢ LƯỢT ───────────────────────────────────────
-- ⚠ Đối chứng phải nằm TRONG cùng một khối `DO` với mọi phép đo nó dùng: `GET DIAGNOSTICS
--   ROW_COUNT` ở một khối `DO` RIÊNG **không** thấy `ROW_COUNT` của câu lệnh trước đó (đo được
--   2026-08-10).
DO $$
DECLARE
  kieu     text;
  tran     integer;
  kieu_dev text;
  so_hang  bigint;
BEGIN
  SELECT data_type, character_maximum_length INTO kieu, tran
    FROM information_schema.columns
   WHERE table_name = 'user_sessions' AND column_name = 'ipAddress';

  IF kieu <> 'text' OR tran IS NOT NULL THEN
    RAISE EXCEPTION 'HUỶ: cột ipAddress chưa thành text (kiểu=%, trần=%)', kieu, tran;
  END IF;

  -- `deviceName` phải VẪN là `text` (mig 0318) — lượt này không được kéo lùi nó.
  SELECT data_type INTO kieu_dev
    FROM information_schema.columns
   WHERE table_name = 'user_sessions' AND column_name = 'deviceName';
  IF kieu_dev <> 'text' THEN
    RAISE EXCEPTION 'HUỶ: deviceName không còn là text (=%), mig 0318 đã bị hoàn nguyên?', kieu_dev;
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
  RAISE NOTICE 'ĐỐI CHỨNG ĐẠT: ipAddress = text, deviceName còn text, UNIQUE sessionToken còn nguyên, % hàng giữ nguyên', so_hang;
END $$;

COMMIT;
