-- doc 40 Wave 2 — CTL-02: ROBOT COMMISSIONING / FAT GATE (bất đối xứng đã đóng).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: OT commandDispatcher đã có commissioning gate (bảng commissioning_records
-- + isCommissioned(adapterId)) — một real-write chỉ chạy khi adapter có bản ghi FAT
-- đã ký, còn hiệu lực. robotCommandDispatcher THIẾU lớp này: ROBOT_CONTROL_ENABLED=true
-- là đủ để một robot bất kỳ nhận lệnh chuyển động thật, dù chưa qua FAT.
--
-- Migration này tạo bảng SIGN-OFF LEDGER RIÊNG cho robot (KHÔNG tái dùng
-- commissioning_records vì adapterId của OT ≠ robotId — trùng khoá số sẽ nhầm robot
-- với adapter). Cấu trúc song song với commissioning_records: chỉ bản ghi status='active'
-- và (expiresAt IS NULL OR expiresAt > now()) mới commission robot cho real-motion.
--
-- Gate đọc bảng này ở robotCommandDispatcher (ROBOT_COMMISSIONING_REQUIRED, MẶC ĐỊNH ON):
-- robot CHƯA commissioned → ÉP lệnh xuống nhánh 'simulated' (honest, y như OT). Migration
-- KHÔNG tự chèn bản ghi nào → mọi robot bắt đầu ở trạng thái CHƯA commissioned (fail-safe).
--
-- Idempotent: IF NOT EXISTS. status là varchar (KHÔNG pg enum) để additive, không ALTER TYPE.
-- Numbered 0240 (0238 = machine_connection_fields; 0239 dành cho agent khác cùng Wave 2).
-- Owner chạy migration; KHÔNG tự áp.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "robot_commissioning_records" (
  "id" serial PRIMARY KEY,
  "robotId" integer NOT NULL,
  -- 'active' (đã ký & còn hiệu lực) | 'revoked' (thu hồi tay) | 'expired'.
  -- Chỉ 'active' + chưa hết hạn mới commission robot cho real-motion.
  "status" varchar(16) NOT NULL DEFAULT 'active',
  -- Tham chiếu báo cáo FAT / commissioning ngoài (doc id, ticket, checklist).
  "fatReference" varchar(255),
  -- User (users.id) ký nghiệm thu — chịu trách nhiệm.
  "signedBy" integer NOT NULL,
  "signedAt" timestamp NOT NULL DEFAULT now(),
  -- Hạn hiệu lực tuỳ chọn; NULL = không hết hạn. Quá hạn ⇒ KHÔNG commissioned.
  "expiresAt" timestamp,
  -- Đặt khi status='revoked' (ai + khi nào + vì sao).
  "revokedBy" integer,
  "revokedAt" timestamp,
  "revokeReason" text,
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_robot_commissioning_records_robot"
  ON "robot_commissioning_records" ("robotId");
CREATE INDEX IF NOT EXISTS "idx_robot_commissioning_records_status"
  ON "robot_commissioning_records" ("status");
-- Probe nhanh "robot này đã commissioned?" (robotId + status).
CREATE INDEX IF NOT EXISTS "idx_robot_commissioning_records_robot_status"
  ON "robot_commissioning_records" ("robotId", "status");
