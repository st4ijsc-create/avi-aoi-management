-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0321 — `user_sessions.userId` → khoá ngoại `ON DELETE CASCADE`, khai `NOT VALID`
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Chủ dự án chấm **ĐƯỜNG B** (2026-08-11). Đường A (dọn hàng mồ côi rồi thêm FK đã kiểm đầy đủ)
-- và đường C (không làm gì) đã bị loại. Bản nháp ba đường nằm ở lịch sử git của
-- `0321_user_sessions_fk_cascade.sql.DRAFT`, xoá trong chính commit này.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- BỐI CẢNH: KHÔNG PHẢI "FK THIẾU `ON DELETE`" — MÀ LÀ **KHÔNG CÓ FK NÀO CẢ**
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Nợ khai từ Pha 7 ghi *"`user_sessions` thiếu `ON DELETE CASCADE`"*, câu ấy ngụ ý đã có một khoá
-- ngoại và chỉ thiếu hành vi kèm theo. Phép đo bác bỏ: `pg_constraint` trên `user_sessions` trả về
-- **ĐÚNG HAI** ràng buộc trên cả hai DB — `user_sessions_pkey` (p) và
-- `user_sessions_sessionToken_unique` (u). **`contype='f'` = 0 hàng.**
-- ⇒ Toàn bộ ràng buộc tham chiếu vắng mặt, nên DB chưa bao giờ có gì để cưỡng chế. Khai báo drizzle
--   khớp với sự vắng mặt ấy (`drizzle/schema/auth.ts`: `userId` không có `.references()`) — nửa thứ
--   hai của lượt này sửa đúng chỗ đó, cùng commit.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠⚠ VÙNG MÙ ĐƯỢC KHAI — ĐỌC TRƯỚC KHI TIN RẰNG LƯỢT NÀY ĐÃ ĐÓNG KÍN
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 1) **4 HÀNG MỒ CÔI CŨ TRÊN PROD VẪN Ở LẠI.** `NOT VALID` **chỉ** bỏ qua lượt kiểm hàng CŨ. Lượt
--    này xoá **0 byte** — đó là toàn bộ lý do đường B được chọn. Bốn hàng ấy (`id` 4·5·59·60, các
--    `userId` ma **301 · 302 · 1432 · 1474**, cả bốn `isActive=true`, hạn tới 2027) **vẫn nằm
--    nguyên trong bảng** sau lượt áp, và ràng buộc mới **không** phát biểu gì về chúng.
--
-- 2) **CỔNG SỔ PHIÊN VẪN CHO CHÚNG QUA.** `db.getSessionByToken` (`server/db/auth.ts`) chỉ
--    `select().from(userSessions)` — **không join `users`**. Nên cổng `chanNeuPhienDaThuHoi`
--    (`server/_core/sdk.ts`) nhìn một hàng mồ côi `isActive=true`, `expiresAt` 2027 và **CHO QUA**:
--    nó chỉ từ chối khi hàng vắng mặt, `isActive=false`, hoặc đã hết hạn.
--    ⇒ Vế **đo được**: cổng sổ phiên không chặn được một phiên của người dùng đã bị xoá.
--    ⇒ Vế **CHƯA đo, nên KHÔNG khai**: liệu một yêu cầu mang vé ấy có đi hết tới dữ liệu hay không.
--      Hồ sơ người dùng giải bằng `openId` qua `getUserByOpenId`, và hàng `users` đã biến mất, nên
--      nhiều khả năng lượt ấy vẫn hỏng ở tầng sau — **đó là suy luận, không phải phép đo**, và
--      "an toàn nhờ một thứ KHÁC đang chặn" đúng là lớp lỗi Pha 4 đã đặt tên.
--    ⇒ Đây là **vùng mù được khai**, KHÔNG phải chỗ sót. Đóng nó cần một quyết định riêng của chủ
--      dự án (dọn 4 hàng ⇒ xoá dữ liệu), hoặc siết `getSessionByToken` để join `users`.
--
-- 3) **AI ĐỌC `pg_constraint` MÀ KHÔNG ĐỌC CỘT `convalidated` SẼ TƯỞNG BẢNG ĐÃ KÍN.** Ràng buộc có
--    mặt nhưng ở trạng thái *"chưa đúng cho mọi hàng"*. Dọn xong hàng cũ thì chạy
--    `ALTER TABLE user_sessions VALIDATE CONSTRAINT "user_sessions_userId_users_id_fk";`
--    (lượt ấy KHÔNG khoá ghi — chỉ `SHARE UPDATE EXCLUSIVE`).
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- CÁI LƯỢT NÀY **THẬT SỰ** ĐÓNG ĐƯỢC
-- ════════════════════════════════════════════════════════════════════════════════════════════
--   * Mọi hàng **MỚI** bị ràng buộc đầy đủ: `INSERT`/`UPDATE` với `userId` không tồn tại ⇒ `23503`.
--   * `ON DELETE CASCADE` **nổ bình thường ngay từ bây giờ**: xoá một `users` sẽ dọn theo mọi phiên
--     của họ ⇒ nợ *"xoá người dùng để lại phiên mồ côi"* **ngừng tự lớn kể từ hôm nay**.
--     (`NOT VALID` KHÔNG làm yếu hành vi tham chiếu; nó chỉ bỏ lượt quét kiểm hàng cũ.)
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- SỐ ĐO NGAY TRƯỚC LƯỢT ÁP (owner `aoi`, cổng 5434, 2026-08-12) — ĐO LẠI, KHÔNG CHÉP LẠI
-- ════════════════════════════════════════════════════════════════════════════════════════════
--                                            aoi_management │ aoi_management_test
--   tổng hàng `user_sessions`                           298 │ 138
--   tổng hàng `users`                                     8 │ 1
--   hàng MỒ CÔI                                           4 │ 138  ← TOÀN BỘ BẢNG
--   trong đó `isActive`                                   4 │ 126
--   số `userId` ma phân biệt                              4 │  85
--   khoá ngoại hiện có (`contype='f'`)                    0 │   0
--
-- ⚠ **ĐỘ LỆCH SO VỚI BẢN NHÁP — KHAI THẲNG.** Nháp (đo sớm hơn cùng ngày) ghi DB test là
--   **136/136**, `userId` ma **83**, `isActive` **124**. Đo lại ra **138/138 · 85 · 126**.
--   Độ lệch **+2** đã truy được nguyên nhân, không phải bí ẩn: hai hàng `id=1013` và `id=1046` tạo
--   lúc `2026-08-12 14:18:01` và `14:19:41` — một lượt chạy test giữa hai phép đo, đúng cơ chế
--   nháp đã mô tả (*"test tạo user rồi dọn user, nhưng không dọn phiên"*). Sự thật ĐỊNH TÍNH không
--   đổi: **100% bảng phiên của DB test là mồ côi**.
--   **Prod thì KHÔNG đổi một hàng nào**: vẫn đúng 4 hàng mồ côi, đúng bốn `userId` 301·302·1432·1474,
--   đúng các mốc hạn — tức con số làm nền cho quyết định "có xoá dữ liệu hay không" y nguyên.
--   Vì đường B **không xoá và không kiểm hàng cũ**, số mồ côi không hề chặn lượt áp; đối chứng thật
--   nằm ở chỗ khác: **số hàng trước/sau phải bằng nhau**, đo ngay trong transaction bên dưới.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ⚠ Máy chủ sản xuất đang chạy trên cổng 3000 và ghi vào chính bảng này. `ADD CONSTRAINT` cần
--   ACCESS EXCLUSIVE trên `user_sessions` (nhanh — `NOT VALID` nên KHÔNG quét bảng). Nếu có
--   transaction dài đang giữ khoá, ta muốn lượt này **chết ra tiếng ngay** chứ không xếp hàng chặn
--   đường đăng nhập của người dùng thật.
SET LOCAL lock_timeout = '5s';

-- ── ĐO **TRƯỚC**: chốt đáp số biết trước, ngay trong cùng transaction ────────────────────────
-- Không có bảng tạm này thì khối `DO` bên dưới chỉ đo được trạng thái SAU và phải *giả định* trạng
-- thái trước — tức là suy ra, không phải đo.
CREATE TEMP TABLE "_mig0321_truoc" ON COMMIT DROP AS
SELECT (SELECT count(*) FROM user_sessions) AS so_hang,
       (SELECT count(*) FROM user_sessions s
          LEFT JOIN users u ON u.id = s."userId"
         WHERE u.id IS NULL)                AS mo_coi;

-- ⚠ KHÔNG `IF NOT EXISTS` (Postgres không có cho `ADD CONSTRAINT`): lượt áp lại sẽ vỡ với `42710`,
--   và ta MUỐN nó vỡ ra tiếng chứ không âm thầm bỏ qua một ràng buộc an ninh.
ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_userId_users_id_fk"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE
  NOT VALID;

-- ── ĐỐI CHỨNG NGAY TRONG LƯỢT ÁP: sai thì HUỶ CẢ LƯỢT ───────────────────────────────────────
-- Cùng khuôn với 0316/0317/0318/0319/0320. Mọi phép đo nằm TRONG cùng một khối `DO`.
DO $$
DECLARE
  dinh_nghia   text;
  kieu_xoa     "char";
  da_kiem      boolean;
  hang_truoc   bigint;
  mocoi_truoc  bigint;
  hang_sau     bigint;
  mocoi_sau    bigint;
BEGIN
  SELECT pg_get_constraintdef(oid), confdeltype, convalidated
    INTO dinh_nghia, kieu_xoa, da_kiem
    FROM pg_constraint
   WHERE conrelid = 'user_sessions'::regclass
     AND conname  = 'user_sessions_userId_users_id_fk'
     AND contype  = 'f';

  IF dinh_nghia IS NULL THEN
    RAISE EXCEPTION 'HUỶ: khoá ngoại user_sessions_userId_users_id_fk không được tạo';
  END IF;

  -- Phải có ĐÚNG hành vi CASCADE. Một FK không kèm `ON DELETE` là mặc định `NO ACTION` — nó sẽ
  -- **CHẶN** lượt xoá người dùng thay vì dọn theo, tức đổi một lỗi thành một lỗi khác.
  -- Đọc `confdeltype` (nguồn có thẩm quyền, 'c' = cascade) **và** đối chiếu chuỗi định nghĩa, để
  -- một phép đo hỏng không tự mình khai xanh được.
  IF kieu_xoa IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION 'HUỶ: confdeltype = % (chờ ''c'' = cascade); định nghĩa: %', kieu_xoa, dinh_nghia;
  END IF;
  IF dinh_nghia NOT LIKE '%ON DELETE CASCADE%' THEN
    RAISE EXCEPTION 'HUỶ: khoá ngoại thiếu ON DELETE CASCADE (đang là: %)', dinh_nghia;
  END IF;

  -- ĐƯỜNG B có chữ ký riêng: ràng buộc phải ở trạng thái CHƯA KIỂM. Nếu `convalidated` hoá ra
  -- `true` thì Postgres đã quét toàn bảng — nghĩa là ta vô tình chạy đường A, và với 4+138 hàng mồ
  -- côi thì lượt quét ấy lẽ ra phải nổ `23503`. Xanh ở đây = phép đo đang nói dối ⇒ huỷ.
  IF da_kiem IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'HUỶ: convalidated = % (chờ false — NOT VALID)', da_kiem;
  END IF;

  -- Lượt này KHÔNG được xoá một hàng nào — đó là toàn bộ lý do chọn `NOT VALID`.
  -- So TRƯỚC với SAU, không so với một hằng số chép tay (số mồ côi DB test trôi theo mỗi lượt test;
  -- một hằng số chép tay sẽ biến chuyện đó thành báo động giả và che mất báo động thật).
  SELECT so_hang, mo_coi INTO hang_truoc, mocoi_truoc FROM "_mig0321_truoc";
  SELECT count(*) INTO hang_sau FROM user_sessions;
  SELECT count(*) INTO mocoi_sau
    FROM user_sessions s LEFT JOIN users u ON u.id = s."userId" WHERE u.id IS NULL;

  IF hang_sau IS DISTINCT FROM hang_truoc THEN
    RAISE EXCEPTION 'HUỶ: số hàng user_sessions đổi % → % (lượt này phải xoá 0 byte)', hang_truoc, hang_sau;
  END IF;
  IF mocoi_sau IS DISTINCT FROM mocoi_truoc THEN
    RAISE EXCEPTION 'HUỶ: số hàng mồ côi đổi % → % (NOT VALID không được đụng hàng cũ)', mocoi_truoc, mocoi_sau;
  END IF;

  -- `sessionToken` phải VẪN UNIQUE — lượt này không được chạm bất biến an ninh của 0317/0320.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'user_sessions'::regclass AND contype = 'u'
       AND pg_get_constraintdef(oid) LIKE '%sessionToken%'
  ) THEN
    RAISE EXCEPTION 'HUỶ: ràng buộc UNIQUE trên sessionToken đã biến mất';
  END IF;

  RAISE NOTICE 'ĐỐI CHỨNG ĐẠT: FK ON DELETE CASCADE (NOT VALID, convalidated=false) đã tạo; % hàng giữ nguyên (trước=sau); % hàng mồ côi CÒN NGUYÊN (cố ý — chưa xoá gì)', hang_sau, mocoi_sau;
END $$;

COMMIT;
