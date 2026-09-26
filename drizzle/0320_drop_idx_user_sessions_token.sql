-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0320 — GỠ `idx_user_sessions_token` (TRÙNG chỉ số của ràng buộc UNIQUE)   ✅ **ĐÃ ÁP 2026-08-12**
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ✅ **CHỦ DỰ ÁN DUYỆT 2026-08-11.** Đuôi `.DRAFT` đã được bỏ; file áp qua đúng đường chuẩn
--     (`scripts/migrate-standalone.mjs`, `MIGRATE_STRICT=1`, owner `aoi`, **CẢ HAI** DB).
--     `0319` được duyệt **cùng lượt** và áp ngay trước file này — hai file độc lập, hai commit riêng.
--     ⚠ Lượt áp **thu hẹp** danh sách file của bộ chạy về **đúng 0319 + 0320**: repo còn nợ sổ CÓ
--       TRƯỚC (`0057`·`0066`·`0125`·`0234` `success=false`; `0308`·`0309` không hàng sổ trên prod;
--       `0300`–`0309` không hàng sổ trên test) mà lượt này **KHÔNG** được đụng tới.
--     ✅ NỬA THỨ HAI ĐÃ ĐI CÙNG LƯỢT: dòng `index("idx_user_sessions_token")` trong
--       `drizzle/schema/auth.ts` đã được xoá trong **cùng commit** — xem mục "NỬA THỨ HAI" bên dưới.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ SỐ ĐO TRÊN DB THẬT (`aoi_management`, 2026-08-12) — KHÔNG PHẢI SUY LUẬN TỪ FILE SCHEMA
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Truy vấn `pg_index` ⋈ `pg_class` cho `user_sessions` trả về SÁU chỉ số. Hai trong số đó nằm
-- trên **CÙNG MỘT CỘT, CÙNG MỘT PHƯƠNG PHÁP, CÙNG MỘT THỨ TỰ**:
--
--   user_sessions_sessionToken_unique
--       uniq=true   ràng buộc=1   147.456 byte
--       CREATE UNIQUE INDEX "user_sessions_sessionToken_unique"
--           ON public.user_sessions USING btree ("sessionToken")
--
--   idx_user_sessions_token
--       uniq=false  ràng buộc=0   139.264 byte      ← THỪA HOÀN TOÀN
--       CREATE INDEX idx_user_sessions_token
--           ON public.user_sessions USING btree ("sessionToken")
--
--   (bốn chỉ số còn lại — `_pkey`, `_user`, `_expires`, `_active` — trên cột KHÁC, không liên quan.)
--
-- Số hàng `user_sessions` hôm nay: **298** (đo lại 2026-08-12 ngay trước lượt áp; bản nháp ghi
-- **297** hôm 08-12 sớm — bảng vẫn đang nhận phiên mới, kết luận không đổi).
-- Trên `aoi_management_test` cùng hình dạng: `idx_user_sessions_token` uniq=false ràng-buộc=**0**
-- (81.920 byte) · `user_sessions_sessionToken_unique` uniq=true ràng-buộc=**1** (131.072 byte).
--
-- ⇒ Chỉ số UNIQUE phục vụ được **MỌI** truy vấn mà chỉ số thường phục vụ được: cùng cột dẫn đầu,
--   cùng btree, cùng chiều. `db.getSessionByToken` (`WHERE "sessionToken" = $1`) — đường nóng nhất
--   của toàn hệ, chạy **mỗi lượt xác thực** kể từ Pha 9 A2 — dùng được cái nào cũng như nhau, và
--   planner sẽ chọn cái nó thấy rẻ hơn. Không có hình dạng truy vấn nào phân biệt được hai chỉ số
--   này. Đây **không** phải "một chỉ số ít dùng"; nó là một chỉ số **không thể được dùng cho việc
--   gì mà cái kia không làm được**.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ CÁI GIÁ CỦA VIỆC GIỮ NÓ KHÔNG PHẢI 139 KB — MÀ LÀ MỘT LƯỢT GHI THÊM Ở ĐƯỜNG NÓNG
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 139.264 byte là phần **dễ thấy nhất và ít quan trọng nhất**. Phần thật:
--   · MỖI `INSERT` vào `user_sessions` (tức **mỗi lượt đăng nhập**) phải cập nhật **hai** cây btree
--     trên cùng một giá trị thay vì một.
--   · MỖI `UPDATE` chạm `sessionToken`, và mọi lượt `DELETE` (dọn phiên hết hạn, `session.revoke`,
--     `revokeAll`) cũng vậy.
--   · Autovacuum phải dọn **hai** cây.
-- Trên một bảng 297 hàng thì không đo được. Điểm của lượt gỡ **không** phải hiệu năng hôm nay — mà
-- là: một chỉ số không phục vụ truy vấn nào là một thứ người sau sẽ đọc thành *"cột này cần đánh
-- chỉ số riêng, chắc có lý do"*, rồi sao chép khuôn ấy sang bảng khác. Nó là **tài liệu sai**, cùng
-- loại với `twoFactor.test.ts` mà nhóm B vừa xoá.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠⚠ VÌ SAO LƯỢT GỠ NÀY AN TOÀN — VÀ CHỖ DUY NHẤT NÓ CÓ THỂ KHÔNG AN TOÀN
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- AN TOÀN, đo được: `idx_user_sessions_token` có **`ràng buộc = 0`** (không `pg_constraint` nào
-- trỏ `conindid` vào nó). Tức nó **không** đứng sau một `UNIQUE`/`PRIMARY KEY`/`FOREIGN KEY` nào;
-- `DROP INDEX` sẽ không kéo theo một ràng buộc nào. Ngược lại,
-- `user_sessions_sessionToken_unique` có **`ràng buộc = 1`** ⇒ **KHÔNG BAO GIỜ** drop cái đó: nó
-- là cơ chế cưỡng chế *"một token = một phiên"*, và mất nó là mất một bất biến an ninh.
--
-- ⚠ CHỖ DUY NHẤT CÓ THỂ KHÔNG AN TOÀN — và nó cần một quyết định của chủ dự án:
--   Nếu có ai đó (script vận hành, công cụ ngoài, một bản `db:push` cũ) **đang trông vào TÊN**
--   `idx_user_sessions_token`, lượt gỡ làm họ đỏ. Phép đo hôm nay: chuỗi ấy chỉ xuất hiện trong
--   `drizzle/**` (migration cũ + snapshot) và `drizzle/schema/auth.ts:260`. **Không** file nào
--   dưới `server/**`, `client/**`, `scripts/**` nhắc tới nó.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ NỬA THỨ HAI CỦA BẢN VÁ — ĐỪNG ÁP MỘT NỬA
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- `drizzle/schema/auth.ts:260` còn khai `index("idx_user_sessions_token").on(table.sessionToken)`.
-- Chừng nào dòng ấy còn, một lượt `npm run db:push` sẽ **TẠO LẠI** chỉ số vừa gỡ — lượt gỡ sống
-- được đúng tới lần push kế tiếp, rồi biến mất im lặng.
-- ⇒ Khi áp migration này, **cùng lượt** xoá dòng 260 của `drizzle/schema/auth.ts`.
-- ⚠ Bản nháp này **cố ý KHÔNG** sửa file schema trước: sửa schema mà chưa áp DDL là tạo **lệch**
--   theo chiều ngược (mã khai không có, DB có) — và lệch schema chính là thứ đã làm vỡ cả `INSERT`
--   ở Wave 3 (drizzle liệt kê TOÀN BỘ cột ở mọi câu lệnh). Hai nửa đi cùng một lượt, không lệch.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- CÁCH ÁP (khi chủ dự án duyệt)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--   1. đổi tên  → `0320_drop_idx_user_sessions_token.sql`
--   2. xoá dòng 260 của `drizzle/schema/auth.ts`
--   3. chạy `scripts/migrate-standalone.mjs` bằng owner **`aoi`** (owner `avi_app` ⇒ 42501)
--      trên **CẢ HAI** DB: `aoi_management` **và** `aoi_management_test`
--   4. đo lại: truy vấn `pg_index` phải còn **NĂM** chỉ số trên `user_sessions`, và
--      `user_sessions_sessionToken_unique` phải **CÒN NGUYÊN** (`uniq=true`, `ràng buộc=1`)
-- ════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ⚠ `IF EXISTS` để lượt áp lại không vỡ. KHÔNG dùng `CASCADE`: nếu một ràng buộc nào đó bất ngờ
--   phụ thuộc vào chỉ số này thì ta MUỐN câu lệnh vỡ và nói ra, chứ không muốn nó âm thầm kéo
--   theo một ràng buộc an ninh.
DROP INDEX IF EXISTS "idx_user_sessions_token";

-- ── ĐỐI CHỨNG NGAY TRONG LƯỢT ÁP: sai thì HUỶ CẢ LƯỢT ───────────────────────────────────────
-- Cùng khuôn với 0316/0317/0318/0319. Lượt này GỠ một thứ, nên đối chứng phải chứng minh **cả
-- hai** vế: cái đáng gỡ đã biến mất, VÀ cái tuyệt đối không được chạm vẫn còn nguyên.
DO $$
DECLARE
  con_thua   integer;
  con_unique integer;
  so_chi_so  integer;
  so_hang    bigint;
BEGIN
  -- 1. chỉ số thừa phải BIẾN MẤT
  SELECT count(*) INTO con_thua
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'user_sessions'::regclass AND c.relname = 'idx_user_sessions_token';
  IF con_thua <> 0 THEN
    RAISE EXCEPTION 'HUỶ: idx_user_sessions_token vẫn còn (% bản)', con_thua;
  END IF;

  -- 2. chỉ số UNIQUE phải CÒN NGUYÊN, và vẫn phải còn ràng buộc đứng sau nó.
  --    Đây là bất biến an ninh "một token = một phiên" — mất nó là mất cưỡng chế.
  SELECT count(*) INTO con_unique
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'user_sessions'::regclass
     AND c.relname  = 'user_sessions_sessionToken_unique'
     AND i.indisunique
     AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conindid = c.oid AND pc.contype = 'u');
  IF con_unique <> 1 THEN
    RAISE EXCEPTION 'HUỶ: chỉ số UNIQUE trên sessionToken không còn nguyên vẹn (đếm=%)', con_unique;
  END IF;

  -- 3. đúng NĂM chỉ số còn lại (sáu trừ một) — bắt cả trường hợp gỡ nhầm thêm cái khác
  SELECT count(*) INTO so_chi_so
    FROM pg_index i WHERE i.indrelid = 'user_sessions'::regclass;
  IF so_chi_so <> 5 THEN
    RAISE EXCEPTION 'HUỶ: user_sessions còn % chỉ số, chờ đợi 5', so_chi_so;
  END IF;

  SELECT count(*) INTO so_hang FROM user_sessions;
  RAISE NOTICE 'ĐỐI CHỨNG ĐẠT: idx thừa đã gỡ, UNIQUE sessionToken còn nguyên, còn % chỉ số, % hàng giữ nguyên', so_chi_so, so_hang;
END $$;

COMMIT;
