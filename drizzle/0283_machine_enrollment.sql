-- doc 51 P3 / §5.1 — ZERO-TOUCH ENROLLMENT (gỡ nghẽn single-admin per-machine)
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: hôm nay register→'pending', PHẢI admin approve+issueKey từng máy mới
-- có credential (nghẽn admin khi triển khai hàng loạt). Bảng này thêm ENROLLMENT
-- TOKEN: admin phát 1 token entropy-cao (256-bit) — one-time (1 máy) HOẶC allowlist
-- (khớp serialNumber theo pattern, dùng nhiều lần tới maxUses) — máy HỢP LỆ tự
-- pending→approved + tự nhận khoá mk_ scoped (mặc định ingest:write+equipment:read),
-- KHÔNG cần admin bấm từng máy. VẪN audit + revoke được.
--
-- Xây trên ĐÚNG hạ tầng claim-token P0 (0273): HASH-AT-REST (SHA-256 — token là
-- secret ngẫu nhiên đủ dài nên không cần KDF chậm), TTL, thu-hồi. Khác claim-token:
--   • claim-token đổi lấy machines.apiKey CÓ SẴN (một lần, cho 1 máy đã duyệt).
--   • enrollment-token TỰ DUYỆT máy + TỰ CẤP khoá mk_ mới; có thể allowlist (N máy).
--
-- BẢO MẬT (QĐ#1 — bật CÓ KIỂM SOÁT):
--   • Cờ ứng dụng ENROLLMENT_ENABLED mặc định OFF: endpoint public `enroll` từ
--     chối khi cờ tắt (migration này CHỈ tạo bảng — không đụng luồng đang chạy).
--   • Single-use thực thi bằng UPDATE ... SET "useCount"="useCount"+1
--     WHERE "useCount" < "maxUses" RETURNING (đua nhau chỉ một bên thắng).
--   • plaintext token trả cho ADMIN đúng 1 lần; DB chỉ giữ hash.
--   • per-IP throttle ở tầng router (chống brute-force allowlist).
--
-- ADDITIVE + IDEMPOTENT. Không FK cứng tới machines/users (soft-ref, theo đúng quy
-- ước master-data của repo — giống api_keys."machineId" 0178, machine_claim_tokens 0273).
-- Cột camelCase-có-nháy để đồng bộ họ bảng machines/api_keys/machine_claim_tokens.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "machine_enrollment_tokens" (
  "id"             serial PRIMARY KEY,
  -- SHA-256 hex của plaintext. Plaintext KHÔNG BAO GIỜ được lưu.
  "tokenHash"      varchar(128) NOT NULL,
  -- Tiền tố ngắn KHÔNG bí mật (vd "met_3f9c") để hiển thị/đối chiếu trong audit.
  "tokenPrefix"    varchar(32),
  -- Allowlist: pattern khớp serialNumber. NULL = one-time cho 1 máy bất kỳ.
  -- Hỗ trợ khớp CHÍNH XÁC ("AOI-777") hoặc TIỀN TỐ có dấu * cuối ("AOI-2026-*").
  "serialPattern"  varchar(120),
  -- Scope cấp cho khoá mk_ tự phát. Tối thiểu ingest:write; mặc định + equipment:read
  -- (máy cần đọc cấu hình/heartbeat). Admin có thể siết hẹp hơn khi phát token.
  "scopes"         jsonb NOT NULL DEFAULT '["ingest:write","equipment:read"]'::jsonb,
  -- Số lần dùng tối đa: one-time = 1; allowlist batch = N. Bit thực thi single-use.
  "maxUses"        integer NOT NULL DEFAULT 1,
  "useCount"       integer NOT NULL DEFAULT 0,
  "expiresAt"      timestamp NOT NULL,
  -- Admin thu hồi thủ công (khác hết-hạn/hết-lượt).
  "revokedAt"      timestamp,
  "lastUsedAt"     timestamp,
  "lastUsedFromIp" varchar(64),
  -- Nhãn admin (vd "Batch line A 2026-07"), soft-ref users.id của người phát.
  "note"           varchar(255),
  "issuedBy"       integer,
  "createdAt"      timestamp NOT NULL DEFAULT now()
);

-- Đường tra cứu nóng của enroll: hash → token. UNIQUE để một plaintext không bao
-- giờ tồn tại hai bản ghi (và để va chạm hash lộ ra ngay lúc insert).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_machine_enrollment_tokens_hash"
  ON "machine_enrollment_tokens" ("tokenHash");

-- Liệt kê/dọn token còn hiệu lực (chưa thu hồi, chưa hết hạn, còn lượt).
CREATE INDEX IF NOT EXISTS "idx_machine_enrollment_tokens_open"
  ON "machine_enrollment_tokens" ("expiresAt")
  WHERE "revokedAt" IS NULL;
