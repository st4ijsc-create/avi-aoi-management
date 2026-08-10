-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0317 — NỚI `user_sessions.sessionToken` TỪ varchar(255) SANG text
-- BẢN NHÁP — CHƯA ÁP. Chờ chủ dự án duyệt. Áp bằng owner `aoi` lên CẢ HAI DB.
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ VÌ SAO — LỖI ĐANG SỐNG, ĐO ĐƯỢC 2026-08-10
--
--   `user_sessions.sessionToken` giữ nguyên văn JWT phiên. Trần hiện tại 255.
--     · dài nhất trên 276 hàng thật: 233  ⇒ dư địa chỉ 22 ký tự
--     · `createLocalUser` sinh openId 31 ký tự cho MỌI tài khoản mới
--     · dấu tiếng Việt là 2 byte UTF-8, base64 đếm BYTE ⇒ ngân sách tên còn ~10 ký tự tiếng Việt
--     · đo thật: name = 'Trần Văn Bảo'  ⇒  token 257 > 255  ⇒  PostgresError 22001
--
--   Hậu quả KHÔNG phải "lỗi khi đăng nhập": `authService.ts` nuốt lỗi ghi sổ, nên lượt đăng nhập
--   vẫn thành công NHƯNG **không có hàng `user_sessions` nào của riêng nó** ⇒ phiên ấy vô hình với
--   `session.list` và **NGOÀI TẦM `session.revoke`**. Task 2 của Pha 8 vừa biến `user_sessions`
--   thành đường thu hồi CHÍNH, nên lỗ này nay nặng hơn lúc phát hiện.
--
--   Trên 8 tài khoản hiện có: 0/8 vỡ — nhưng **2 người chỉ còn 2 ký tự biên**, sống sót chỉ vì
--   mang openId cũ NGẮN HƠN openId mà mã hôm nay sinh ra.
--
-- ⚠ VÌ SAO `text` CHỨ KHÔNG PHẢI `varchar(512)`
--
--   Postgres lưu `varchar(n)` và `text` **y hệt nhau** (cùng `varlena`); `n` chỉ là một ràng buộc
--   kiểm tra lúc ghi. Không tốn thêm ô đĩa, không đổi hiệu năng. Và một con số mới (512) chỉ dời
--   cùng lớp lỗi sang chỗ khác — nó vẫn là một TRẦN ĐOÁN, trong khi độ dài JWT phụ thuộc dữ liệu
--   người dùng mà ta không kiểm soát.
--
-- ⚠ ĐO TRƯỚC KHI SOẠN — không có gì chặn lượt đổi kiểu
--     · phụ thuộc khung nhìn / rule: **0** (cả hai DB)
--     · ràng buộc: PRIMARY KEY (id) · UNIQUE ("sessionToken") — cái sau vẫn đúng trên `text`
--     · chỉ số trên cột: `user_sessions_sessionToken_unique` + `idx_user_sessions_token`
--       (⚠ cái thứ hai là chỉ số TRÙNG với chỉ số của ràng buộc UNIQUE — nợ riêng, KHÔNG xử ở đây)
--     · btree trên `text` giới hạn ~2704 byte/mục; token ~233 ⇒ còn rất xa
--   `varchar(n)` → `text` là **binary-coercible** ⇒ Postgres KHÔNG viết lại bảng. Khoá
--   ACCESS EXCLUSIVE trong lượt đổi; với 276 hàng là mili-giây.
-- ════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "user_sessions" ALTER COLUMN "sessionToken" TYPE text;

-- ── ĐỐI CHỨNG NGAY TRONG LƯỢT ÁP: sai thì HUỶ CẢ LƯỢT ───────────────────────────────────────
DO $$
DECLARE
  kieu       text;
  tran       integer;
  so_hang    bigint;
  con_unique boolean;
BEGIN
  SELECT data_type, character_maximum_length INTO kieu, tran
    FROM information_schema.columns
   WHERE table_name = 'user_sessions' AND column_name = 'sessionToken';

  IF kieu <> 'text' OR tran IS NOT NULL THEN
    RAISE EXCEPTION 'HUỶ: cột chưa thành text (kiểu=%, trần=%)', kieu, tran;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'user_sessions'::regclass
       AND contype  = 'u'
       AND pg_get_constraintdef(oid) LIKE '%sessionToken%'
  ) INTO con_unique;

  IF NOT con_unique THEN
    RAISE EXCEPTION 'HUỶ: ràng buộc UNIQUE trên sessionToken đã biến mất sau lượt đổi kiểu';
  END IF;

  SELECT count(*) INTO so_hang FROM user_sessions;
  RAISE NOTICE 'ĐỐI CHỨNG ĐẠT: sessionToken = text, UNIQUE còn nguyên, % hàng giữ nguyên', so_hang;
END $$;

COMMIT;
