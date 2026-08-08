-- ============================================================================
-- Migration 0313: (A) totp_consumed — sổ mã OTP đã tiêu, XUYÊN TIẾN TRÌNH
--                 (B) vram_leases."identityTruncated" — cờ cắt danh tính ĐI
--                     CÙNG DỮ LIỆU
-- (Pha 7 Task 5, docs/superpowers/plans/2026-08-07-vram-pha7-backlog.md)
-- Đề xuất + số đo: docs/superpowers/reports/
--                  2026-08-08-vram-pha7-task5-migration-de-xuat.md
--
-- ══════════════════════════════════════════════════════════════════════════
-- (A) VÌ SAO: sổ mã đã tiêu của Pha 6 (`server/_core/totpOnce.ts`) nằm TRONG
--     BỘ NHỚ. Đo được (Pha 7 Bước 1, hai ca ĐỎ tái lập được):
--       • sau một lượt restart, `__soTotpSize()` về 0 và CÙNG một mã verify
--         lại được `hopLe = true` trong khi nó vẫn trong cửa sổ ~90 s của
--         `speakeasy` ⇒ RFC 6238 §5.2 bị vi phạm ở MỌI lượt redeploy;
--       • hai bản sao `ROLE=api` có HAI cuốn sổ ⇒ mã tiêu ở A vẫn qua ở B.
--     ⇒ Sổ phải sống ở chỗ DUY NHẤT mà mọi tiến trình cùng thấy: DB.
--
-- ⚠ `tokenHash`, KHÔNG phải mã 6 số nguyên văn. Hai lý do, không phải khẩu vị:
--     1. bề rộng CỐ ĐỊNH THEO CẤU TẠO (sha-256 = 32 B) ⇒ `22001` là điều
--        KHÔNG THỂ, chứ không phải "đã chọn đủ rộng" (bài học 0311/`owner`);
--     2. không đưa một mã OTP CÒN HIỆU LỰC vào bảng và vào log truy vấn.
--     ⚠ Đây KHÔNG phải phép chống một kẻ đã đọc được DB (secret 2FA nằm ngay
--       `users.two_factor_secret` cùng DB). Nó chỉ bỏ plaintext ở nơi không
--       cần plaintext.
--
-- ⚠ KHOÁ CHÍNH GỒM `userId`: hai người dùng khác secret có thể tình cờ sinh
--   cùng 6 số, và chặn nhầm người thứ hai là một lỗi CÓ THẬT (chính docstring
--   của `totpOnce.ts` đã ghi).
--
-- ⚠ `luot` = DẤU CỦA LƯỢT GỌI. Nó có mặt vì MỘT lượt bấm nút chạy
--   `verifyTotpOnce` 2-3 LẦN (`_core/trpc.ts` khối I-4). Không có ô này, sổ
--   TỰ CHẶN MÌNH ở lượt verify thứ hai và giết 100 % lệnh VRAM/deploy.
--
-- ══════════════════════════════════════════════════════════════════════════
-- (B) VÌ SAO: `rowFromLease()` cắt NĂM ô danh tính và khai lượt cắt vào
--     `hangDaCat` — một `Set` TRONG BỘ NHỚ NGƯỜI GHI. Đo được (Bước 1): tiến
--     trình anh em đọc đúng hàng ấy thấy `owner` dài 160, KHÔNG một ô nào nói
--     nó đã mất chữ, và `truncatedIdentityWrites` của nó khai 0.
--     Và độ dài KHÔNG suy ra được: một chuỗi dài ĐÚNG BẰNG 160 thì KHÔNG bị
--     cắt, một chuỗi 161 bị cắt THÀNH 160 — hai sự thật, MỘT độ dài.
--
-- ⚠⚠ ĐANG MỞ, KHÔNG PHẢI LO XA: `VramBrokerPanel.tsx:392` GỘP hộ cục bộ với
--    hộ ANH EM rồi `:427` bơm `h.owner` thẳng vào `preempt.mutate` — một LỆNH
--    PHÁ HUỶ. Chú thích `:396` nói "owner KHÔNG cắt ngắn" là đúng cho hàng
--    của ta và SAI cho hàng anh em. Cột này là thứ đóng lỗ ấy.
--
-- ⚠⚠ KHÔNG NỚI CỘT, và điều này đã được ĐO rồi BÁC ở Pha 6 Task 5: `owner`
--    dựng từ ĐƯỜNG DẪN TUYỆT ĐỐI (`ocrService.ts:384`, `aiReranker.ts:503`),
--    trần thật của nó là trần đường dẫn của HĐH (32.767 khi
--    `LongPathsEnabled=1`). Không bề rộng `varchar` nào đuổi kịp ⇒ nới cột chỉ
--    DỜI CHỖ NÓI DỐI. Thứ đóng được lớp lỗi là NÓI RA lượt cắt.
--
-- ⚠⚠⚠ BA GIÁ TRỊ, KHÔNG PHẢI HAI — cùng kỷ luật `TrangThaiTienTrinh`
--    (`vramAdoption.ts:70`: "song" | "chet" | "khong-biet"):
--      • NULL           = KHÔNG BIẾT — người ghi hàng này chưa biết cột này
--                         (tiến trình cũ trong cửa sổ triển khai).
--                         NGƯỜI ĐỌC TUYỆT ĐỐI KHÔNG ĐƯỢC ĐỌC THÀNH "sạch".
--      • '[]'           = người ghi khai: KHÔNG cắt ô nào.
--      • '["owner", …]' = đúng những ô đã bị cắt (khoá của
--                         `VRAM_LEASE_COLUMN_MAX`, đã bị ∀-A cưỡng chế khớp
--                         drizzle ở `sharedLedgerIdentityCut.test.ts`).
--    Ép về `boolean` là bỏ mất vế "KHÔNG BIẾT" và mở lại đúng cửa fail-open mà
--    migration này sinh ra để đóng.
--
-- ⚠ `jsonb` chứ không `text[]`: `vram_events.detail->>'truncatedFields'` đã là
--   một MẢNG CHUỖI jsonb từ Pha 2A (`vramEventLog.ts:261`) — cùng một hình
--   dạng lời khai cho cả hai bảng VRAM. Và `text[]` kéo theo GOTCHA
--   `col = ANY(${jsArray})` ⇒ 500 `42809` (memory drizzle-any-array-antipattern).
--
-- ⚠ `vram_events` KHÔNG cần cột này: `sanitizeVramEvent()` đã ghi
--   `detail.truncatedFields` vào cột `detail` jsonb sẵn có.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ADDITIVE + IDEMPOTENT. Run by owner `aoi` (DDL convention — KHÔNG chạy bằng
-- role `avi_app`, sẽ lỗi 42501; đã kiểm 2026-08-08: current_user = avi_app).
-- Áp lên CẢ DB chính (`aoi_management`) LẪN DB test (`aoi_management_test`).
--
-- ⚠⚠ THỨ TỰ BẮT BUỘC: MIGRATION TRƯỚC, MÃ SAU.
--    Đảo lại ⇒ (A) `42P01` ⇒ `verifyFreshTotp` fail-closed ⇒ 100 % lượt đăng
--    nhập 2FA và 100 % lệnh deploy/VRAM bị từ chối; (B) drizzle liệt kê TOÀN
--    BỘ cột ⇒ cả `select()` lẫn `insert()` ném `42703` ⇒
--    `requeueSharedLedgerWrites()` ném lại đúng hàng độc mỗi 60 s ⇒ hỏng
--    VĨNH VIỄN với MỘT dòng cảnh báo cho cả quãng. Cùng GOTCHA đã trả giá ở
--    Wave 3 ("thêm cột chưa migrate thì CẢ INSERT cũng vỡ").
--
-- ROLLBACK:
--   ALTER TABLE "vram_leases" DROP COLUMN IF EXISTS "identityTruncated";
--   DROP TABLE IF EXISTS "totp_consumed";
--   -- ⚠ MẤT DỮ LIỆU CÓ CHỦ Ý ở lượt DROP TABLE: mọi mã đang bị giữ dùng lại
--   --   được trong phần còn lại của cửa sổ <=120 s. Đây ĐÚNG BẰNG trạng thái
--   --   trước migration (sổ trong bộ nhớ) nên không mở thêm lỗ nào — nhưng
--   --   phải nói ra, không để nó là một tác dụng phụ im lặng.
--   -- ⚠ Rồi xoá dấu vết trong bảng theo dõi của scripts/migrate-standalone.mjs
--   --   (cột `filename`), nếu không `db:push` coi là "đã chạy":
--   --   DELETE FROM "__applied_migrations"
--   --    WHERE "filename" = '0313_totp_consumed_and_identity_truncated.sql';
-- ============================================================================

-- ── (A) sổ mã OTP đã tiêu ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "totp_consumed" (
  -- `users.id` là `integer` (đã kiểm information_schema, 2026-08-08).
  -- ⚠ CỐ Ý KHÔNG có FOREIGN KEY tới `users`: một lượt xoá người dùng KHÔNG
  --   được phép làm hỏng đường xác minh, và hàng ở đây tự chết sau <=120 s.
  "userId"    integer     NOT NULL,
  -- sha-256(`${userId}:${token}`) — 32 byte, bề rộng CỐ ĐỊNH theo cấu tạo.
  "tokenHash" bytea       NOT NULL,
  -- Dấu của LƯỢT GỌI (`randomUUID()` = 36 ký tự). 64 cho một lượt đổi hình
  -- dạng dấu mà không phải migrate lần hai; KHÔNG dùng kiểu `uuid` vì
  -- `verifyTotpOnce` nhận `luot?: string` từ người gọi ⇒ một chuỗi không phải
  -- UUID sẽ thành `22P02` lúc chạy thay vì một lỗi kiểu lúc biên dịch.
  "luot"      varchar(64) NOT NULL,
  -- `nowMs + TOTP_HAN_SO_MS` (120 s). `timestamp` KHÔNG múi giờ — cùng khuôn
  -- `vram_leases.acquiredAt/updatedAt`; máy chủ chạy timezone = Etc/UTC.
  "expiresAt" timestamp   NOT NULL,
  CONSTRAINT "totp_consumed_pkey" PRIMARY KEY ("userId", "tokenHash")
);

-- Chỉ mục cho LƯỢT TỰ DỌN (`DELETE … WHERE "expiresAt" <= $1`).
-- ⚠ Hôm nay bảng chỉ có vài chục hàng nên bộ lập lịch sẽ seq-scan và chỉ mục
--   này KHÔNG được dùng. Nó vẫn phải có, vì "bảng nhỏ" là HỆ QUẢ của việc phép
--   tự dọn đang chạy đúng — và một cơ chế đứng trên hệ quả của một thứ khác là
--   đúng lớp lỗi "an toàn là HỆ QUẢ của một thứ khác đang hỏng" (đã sáu lần).
CREATE INDEX IF NOT EXISTS "totp_consumed_expires_idx"
  ON "totp_consumed" ("expiresAt");

-- ── (B) cờ cắt danh tính đi CÙNG DỮ LIỆU ───────────────────────────────────
-- NULL = KHÔNG BIẾT (xem khối trên). KHÔNG đặt DEFAULT: một DEFAULT '[]' sẽ
-- biến "người ghi chưa biết cột này" thành "người ghi khai không cắt gì" —
-- tức tự tay dựng lại đúng lời nói dối mà cột này sinh ra để diệt.
ALTER TABLE "vram_leases" ADD COLUMN IF NOT EXISTS "identityTruncated" jsonb;

-- ── Quyền cho vai ứng dụng ──────────────────────────────────────────────────
-- ⚠ ĐO TRƯỚC KHI VIẾT DÒNG NÀY (2026-08-08), và phép đo đã sửa một câu tôi
--   suýt viết sai: DB **CÓ** default ACL — `pg_default_acl` khai
--   `{avi_app=arwd/aoi}` cho mọi bảng do `aoi` tạo ⇒ `totp_consumed` sẽ có
--   quyền cho `avi_app` **kể cả khi không có dòng dưới đây**. Đây KHÔNG phải
--   một dòng cứu mạng, nó là một dòng LÀM RÕ.
-- ⚠ Vì sao vẫn giữ: default ACL là một tính chất của **vai đang tạo bảng**,
--   không phải của bảng. Ai chạy lượt này bằng một vai khác `aoi` (hoặc trên
--   một DB dựng lại thiếu `ALTER DEFAULT PRIVILEGES`) sẽ có một bảng mà
--   `avi_app` không đọc nổi ⇒ `42501` ⇒ `verifyFreshTotp` fail-closed ⇒ ĐÚNG
--   hình dạng ngừng dịch vụ mà khối "THỨ TỰ BẮT BUỘC" mô tả, chỉ khác nguyên
--   nhân. Nói ra rẻ hơn nhiều so với để nó là một điều kiện ngầm.
-- ⚠ `vram_leases` đã thuộc `aoi` với `avi_app=arwd` (đo được) ⇒ cột mới KHÔNG
--   cần cấp thêm quyền.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "totp_consumed" TO "avi_app";
