-- doc 51 P0 / R1 — ONE-TIME MACHINE CLAIM TOKEN (bịt rò credential qua endpoint public)
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh (kiểm chứng doc 51): `machine.config` là publicProcedure — CHỈ cần
-- serialNumber (không auth, không secret) là trả `machines.apiKey` PLAINTEXT.
-- Serial number in trên nhãn máy → bất kỳ ai trong mạng nhà máy đọc được nhãn
-- là lấy được credential ingest của máy đó.
--
-- Cách sửa: `config` NGỪNG trả apiKey. Thay bằng luồng CLAIM MỘT LẦN:
--   1. Admin duyệt máy (machine.approve) → sinh CLAIM TOKEN entropy cao
--      (256-bit), HASH-AT-REST (SHA-256 — token là secret ngẫu nhiên đủ dài nên
--      không cần KDF chậm), TTL ngắn (mặc định 15 phút).
--      Plaintext trả cho ADMIN ĐÚNG 1 LẦN → kỹ thuật viên nhập vào máy.
--   2. Máy gọi machine.claimKey({ serialNumber, claimToken }) → đổi lấy apiKey
--      ĐÚNG 1 LẦN. Token bị đốt (usedAt) trong CÙNG transaction với lần đọc key.
--   3. Token hết hạn/đã dùng → admin mint lại qua machine.issueClaimToken.
--
-- Một máy chỉ có TỐI ĐA 1 token còn mở: mint mới → token cũ invalidatedAt.
-- Thu hồi credential (retired/decommissioned) cũng đốt token đang mở.
--
-- QĐ#1 (siết auth máy theo MIGRATION CÓ KIỂM SOÁT): migration này CHỈ tạo bảng —
-- KHÔNG đụng credential của máy đang chạy, KHÔNG backfill thu hồi (xem khối
-- "BACKFILL THỦ CÔNG" cuối file). Đường lùi có kiểm soát ở tầng ứng dụng là cờ
-- MACHINE_CONFIG_EXPOSE_APIKEY=true (mặc định FALSE = an toàn, mỗi lần dùng ghi
-- log cảnh báo có tiết chế).
--
-- ADDITIVE + IDEMPOTENT. Không có FK cứng tới machines.id — theo đúng quy ước
-- repo cho master-data (giống api_keys."machineId" ở migration 0178: soft-ref).
-- Cột đặt camelCase-có-nháy để đồng bộ họ bảng machines/api_keys.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "machine_claim_tokens" (
  "id"            serial PRIMARY KEY,
  -- soft-ref → machines.id (không FK cứng, xem ghi chú 0178)
  "machineId"     integer      NOT NULL,
  -- SHA-256 hex của plaintext. Plaintext KHÔNG BAO GIỜ được lưu.
  "tokenHash"     varchar(128) NOT NULL,
  -- Tiền tố ngắn KHÔNG bí mật (vd "mct_3f9c") để hiển thị/đối chiếu trong audit.
  "tokenPrefix"   varchar(32),
  "expiresAt"     timestamp    NOT NULL,
  -- Dấu ĐÃ DÙNG — đây là bit thực thi "một lần" (UPDATE ... WHERE "usedAt" IS NULL).
  "usedAt"        timestamp,
  "usedFromIp"    varchar(64),
  -- Bị thay thế bởi token mới / bị đốt khi thu hồi credential. Khác usedAt: chưa từng đổi được key.
  "invalidatedAt" timestamp,
  -- users.id của admin đã mint (soft-ref, nullable cho đường hệ thống).
  "issuedBy"      integer,
  "createdAt"     timestamp    NOT NULL DEFAULT now()
);

-- Đường tra cứu nóng của claimKey: hash → token. UNIQUE để một plaintext không
-- bao giờ tồn tại hai bản ghi (và để va chạm hash lộ ra ngay lúc insert).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_machine_claim_tokens_hash"
  ON "machine_claim_tokens" ("tokenHash");

-- Mint mới phải tìm nhanh token còn mở của máy để invalidate.
CREATE INDEX IF NOT EXISTS "idx_machine_claim_tokens_machine"
  ON "machine_claim_tokens" ("machineId");

-- Chỉ mục riêng cho "token còn mở" (dọn rác + kiểm tra tồn đọng).
CREATE INDEX IF NOT EXISTS "idx_machine_claim_tokens_open"
  ON "machine_claim_tokens" ("machineId", "expiresAt")
  WHERE "usedAt" IS NULL AND "invalidatedAt" IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- BACKFILL THỦ CÔNG — CỐ Ý KHÔNG CHẠY TỰ ĐỘNG (QĐ#1)
-- ════════════════════════════════════════════════════════════════════════════
-- Từ nay, transitionMachineLifecycle → 'retired'/'decommissioned' thu hồi
-- credential trong cùng transaction. Nhưng những máy ĐÃ retired/decommissioned
-- TRƯỚC migration này vẫn còn key sống (đúng lỗ hổng doc 51 đã xác minh:
-- machineAuthService chỉ chặn khi machines.isActive=false).
--
-- KHÔNG tự động thu hồi ở đây: nếu dữ liệu lifecycle bị lệch thực tế (máy gắn cờ
-- 'decommissioned' nhưng vẫn đang chạy), một lệnh UPDATE hàng loạt sẽ LÀM CHẾT
-- DÂY CHUYỀN. Chủ hệ phải KIỂM TRA rồi mới chạy.
--
-- BƯỚC 1 — Kiểm tra: máy retired/decommissioned nào còn credential sống, và
--          có còn phát traffic không (lastUsedAt/lastSyncAt gần đây = CẢNH BÁO):
--
--   SELECT m.id, m.code, m.name, m."lifecycleStatus", m."isActive",
--          (m."apiKey" IS NOT NULL)                    AS has_shared_key,
--          m."lastSyncAt",
--          count(k.id) FILTER (WHERE k."isActive")     AS live_scoped_keys,
--          max(k."lastUsedAt")                         AS last_key_use
--     FROM machines m
--     LEFT JOIN api_keys k ON k."machineId" = m.id
--    WHERE m."lifecycleStatus" IN ('retired','decommissioned')
--      AND (m."apiKey" IS NOT NULL OR k."isActive" = true)
--    GROUP BY m.id
--    ORDER BY last_key_use DESC NULLS LAST;
--
-- BƯỚC 2 — Sau khi xác nhận từng máy THỰC SỰ đã dừng, thu hồi (bỏ comment, chạy
--          trong 1 transaction, thay <ids> bằng danh sách đã duyệt):
--
--   BEGIN;
--   UPDATE api_keys SET "isActive" = false, "revokedAt" = now(), "updatedAt" = now()
--    WHERE "machineId" IN (<ids>) AND "isActive" = true;
--   UPDATE machines SET "apiKey" = NULL, "updatedAt" = now()
--    WHERE id IN (<ids>) AND "apiKey" IS NOT NULL;
--   COMMIT;
--
-- Máy cần chạy lại → admin re-commission ('decommissioned' → 'active'), duyệt
-- lại rồi phát claim token mới (machine.issueClaimToken).
