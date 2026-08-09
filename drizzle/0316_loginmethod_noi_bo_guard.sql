-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 0316 — CHỐT BẤT BIẾN "CÓ MẬT KHẨU ⇒ PHẢI ĐƯỢC CÔNG NHẬN LÀ NỘI BỘ"
-- BẢN NHÁP — CHƯA ÁP. Chờ chủ dự án duyệt. Áp bằng owner `aoi` lên CẢ HAI DB.
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ VÌ SAO KHÔNG PHẢI `CHECK ("loginMethod" IN ('local','password'))` NHƯ ĐỀ XUẤT BAN ĐẦU
--
--   Đo ngày 2026-08-09 trên mã đang chạy: `loginMethod` là một TẬP MỞ theo thiết kế.
--     · server/_core/oauth.ts:302   ghi `providerParam` — TÊN NHÀ CUNG CẤP ĐỘNG
--     · server/_core/oauth.ts:500   ghi `userInfo.loginMethod ?? userInfo.platform ?? null`
--     · server/_core/sdk.ts:317     ghi như trên
--     · server/_core/samlProvider.ts:364 ghi 'saml'
--   ⇒ Một CHECK giới hạn vào tập ĐÓNG sẽ thoả 100% dữ liệu hôm nay (local=4, password=4)
--     và LÀM HỎNG lượt đăng nhập OAuth/SAML ĐẦU TIÊN xảy ra sau đó. Đó là một quả mìn hẹn giờ,
--     và nó cùng lớp lỗi với chính sự cố nó định vá: nhận diện bằng CÁCH VIẾT, không phải KHÁI NIỆM.
--
-- ⚠ BẤT BIẾN THẬT SỰ CẦN CHỐT (đo được, không suy ra)
--
--   Nhà tù I-4 xảy ra khi một tài khoản CÓ MẬT KHẨU nhưng `loginMethod` không nằm trong tập mà mã
--   công nhận là nội bộ ⇒ `user.changePassword` từ chối ⇒ chủ tài khoản không thoát ra được.
--   Vậy bất biến là:  **CÓ `passwordHash` ⇒ `loginMethod` PHẢI được công nhận là nội bộ.**
--
--   Đo được hôm nay (cả hai DB, owner `aoi`):
--     aoi_management       local|4|4   password|4|4     (cột 3 = số hàng CÓ passwordHash)
--     aoi_management_test  local|1|1
--   ⇒ 100% hàng hiện có THOẢ bất biến. Không hàng nào phải sửa; lượt áp không đụng dữ liệu.
--
--   Và nó AN TOÀN với OAuth: `oauth.ts:298-303` upsert KHÔNG đặt `passwordHash`, nên tài khoản
--   OAuth/SAML không có mật khẩu ⇒ nằm ngoài tầm ràng buộc ⇒ `providerParam` động vẫn tự do.
--
--   Bất biến bắc qua HAI bảng (`users` × `user_secrets`) nên CHECK không diễn đạt được — phải là
--   trigger. Đó là lý do duy nhất dùng trigger ở đây, không phải sở thích.
-- ════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Tập nội bộ. ⚠ PHẢI KHỚP `PHUONG_THUC_XAC_THUC_NOI_BO` ở `shared/xacThucNoiBo.ts`.
-- Đây là NGUỒN THỨ HAI của cùng một khái niệm ⇒ rủi ro "N+1" mới. Lưới đi kèm
-- (`server/_core/xacThucNoiBoDb.test.ts`, soạn ở lượt áp) ĐỌC ĐỊNH NGHĨA HÀM NÀY TỪ DB
-- rồi so với hằng TS, hai chiều: lệch bất kỳ chiều nào ⇒ ĐỎ.
CREATE OR REPLACE FUNCTION kiem_xac_thuc_noi_bo() RETURNS trigger AS $$
DECLARE
  noi_bo   CONSTANT text[] := ARRAY['local','password'];
  ph       text;
  lm       text;
  uid      integer;
BEGIN
  IF TG_TABLE_NAME = 'user_secrets' THEN
    uid := NEW."userId";
    ph  := NEW."passwordHash";
    SELECT u."loginMethod" INTO lm FROM users u WHERE u.id = uid;
  ELSE
    uid := NEW.id;
    lm  := NEW."loginMethod";
    SELECT s."passwordHash" INTO ph FROM user_secrets s WHERE s."userId" = uid;
  END IF;

  IF ph IS NOT NULL AND NOT (lm = ANY (noi_bo)) THEN
    RAISE EXCEPTION
      'users.id=% có passwordHash nhưng loginMethod=% không được công nhận là xác thực nội bộ; '
      'chủ tài khoản sẽ KHÔNG đổi được mật khẩu (nhà tù I-4). Tập nội bộ: %',
      uid, COALESCE(lm,'<NULL>'), array_to_string(noi_bo, ',')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_xac_thuc_noi_bo        ON users;
DROP TRIGGER IF EXISTS trg_user_secrets_xac_thuc_noi_bo ON user_secrets;

CREATE TRIGGER trg_users_xac_thuc_noi_bo
  AFTER INSERT OR UPDATE OF "loginMethod" ON users
  FOR EACH ROW EXECUTE FUNCTION kiem_xac_thuc_noi_bo();

CREATE TRIGGER trg_user_secrets_xac_thuc_noi_bo
  AFTER INSERT OR UPDATE OF "passwordHash" ON user_secrets
  FOR EACH ROW EXECUTE FUNCTION kiem_xac_thuc_noi_bo();

-- ── ĐỐI CHỨNG NGAY TRONG LƯỢT ÁP: dữ liệu hiện có phải THOẢ, nếu không thì HUỶ CẢ LƯỢT ──────
DO $$
DECLARE vi_pham integer;
BEGIN
  SELECT count(*) INTO vi_pham
  FROM users u JOIN user_secrets s ON s."userId" = u.id
  WHERE s."passwordHash" IS NOT NULL
    AND NOT (u."loginMethod" = ANY (ARRAY['local','password']));
  IF vi_pham > 0 THEN
    RAISE EXCEPTION 'HUỶ: % hàng đang VI PHẠM bất biến — vá dữ liệu trước khi chốt ràng buộc', vi_pham;
  END IF;
  RAISE NOTICE 'ĐỐI CHỨNG ĐẠT: 0 hàng vi phạm; trigger đã chốt.';
END $$;

COMMIT;
