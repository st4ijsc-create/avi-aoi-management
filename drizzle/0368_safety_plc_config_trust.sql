-- ════════════════════════════════════════════════════════════════════════════
-- 0368 — doc 81 Đợt 8 task N fix 1 (quyết định chủ dự án 2026-10-11, I1): MAKER-CHECKER cho cấu hình safety-PLC THẬT
-- ════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO: bộ đọc nền safety-PLC (safetyPlcPoller.ts) ghi sự kiện e-stop / cửa bảo vệ của backend THẬT (modbus/opcua) qua
--   cửa device-ingest TIN CẬY ⇒ thông báo vượt opt-out. Gốc tin cậy là CẤU HÌNH (endpoint + bản đồ tag + gắn kết); ai có
--   machine_control canCreate cũng sửa được ⇒ chủ dự án chọn MAKER-CHECKER: một cấu hình THẬT chỉ tin cậy khi digest HIỆN
--   TẠI (do server tính) BẰNG digest đã được NGƯỜI THỨ HAI (admin, không phải người sửa cuối / tác giả kể từ lần duyệt
--   trước) duyệt. Mọi lần sửa xoá duyệt. Chưa duyệt / lệch digest ⇒ sự kiện VẪN ghi, nhưng qua cửa THƯỜNG (không vượt).
--
-- VÌ SAO BẢNG RIÊNG (không thêm cột vào safety_plc_configs): `select().from(safetyPlcConfigs)` nằm trên đường preflight thực
--   thi thật (adapterFacade, safetyTarget) — DB chưa áp 0368 mà mã có cột mới thì preflight hỏng. Bảng riêng: thiếu bảng
--   chỉ có nghĩa "chưa duyệt ⇒ không tin cậy" (đóng an toàn, CHỈ cho phần tin cậy), mọi đường khác không đổi.
--
-- NGỮ NGHĨA: một hàng / cấu hình (khoá = configId). `lastEditedBy` = người tạo/sửa cuối (qua router); `approved*` = lần duyệt
--   đang hiệu lực (NULL = chưa/đã bị xoá); `rejected*` = lần từ chối gần nhất. Digest = sha256 của (phiên bản, backend,
--   endpoint, tag map estop/zoneOccupied/resetRequired/muting × address/dataType/activeWhen, robot/station/line/factory,
--   scope, corporateCode, enabled) — tính ở ĐÚNG MỘT chỗ: server/services/safety/plc/safetyPlcTrust.ts#plcTrustDigest.
--   Ràng buộc CHECK: người duyệt ≠ người sửa cuối (lớp thứ hai sau kiểm ở ứng dụng).
--
-- QUYỀN `avi_app`: SELECT + INSERT + UPDATE. KHÔNG DELETE/TRUNCATE (hàng đi theo cấu hình qua ON DELETE CASCADE).
--
-- ⚠ DDL chạy bằng owner `aoi`: `node scripts/apply-migration-0368.mjs --test-only` (dev: `--dev-only`, do chủ dự án quyết;
--   không cờ ⇒ script TỪ CHỐI chạy — R-3-g). Áp dev TRƯỚC khi bật SAFETY_PLC_POLLER_ENABLED (thiếu bảng ⇒ không gì tin cậy).
-- ⚠ Repo CẤM `drizzle-kit push/generate` — bảng khai TAY vào drizzle/schema/safetyVision.ts cùng lượt.
-- ROLLBACK: DROP TABLE IF EXISTS "safety_plc_config_trust";
--
CREATE TABLE IF NOT EXISTS "safety_plc_config_trust" (
  "configId" integer PRIMARY KEY REFERENCES "safety_plc_configs" ("id") ON DELETE CASCADE,
  "lastEditedBy" integer,
  "lastEditedAt" timestamp NOT NULL DEFAULT now(),
  "editDigest" varchar(64),
  "approvedDigest" varchar(64),
  "approvedBy" integer,
  "approvedAt" timestamp,
  "rejectedDigest" varchar(64),
  "rejectedBy" integer,
  "rejectedAt" timestamp,
  "rejectReason" text,
  CONSTRAINT "ck_safety_plc_trust_sod" CHECK ("approvedBy" IS NULL OR "lastEditedBy" IS NULL OR "approvedBy" <> "lastEditedBy")
);
COMMENT ON TABLE "safety_plc_config_trust" IS
  'doc 81 Dot 8 N fix 1 (I1): maker-checker cua cau hinh safety-PLC that - tin cay chi khi digest hien tai = approvedDigest do nguoi thu hai duyet. Digest tinh o safetyPlcTrust.plcTrustDigest.';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    -- REVOKE tường minh: default ACL của dev cấp ĐỦ quyền cho avi_app (0357 đo 2026-09-15).
    REVOKE DELETE, TRUNCATE ON "safety_plc_config_trust" FROM avi_app;
    GRANT SELECT, INSERT, UPDATE ON "safety_plc_config_trust" TO avi_app;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- doc 81 Đợt 8 task N fix scan (security scan on 87a061041, ruling R-8-a) — idempotent additions (0368 was applied to _test
-- only; dev has not been migrated).
--   • "editorsSinceApproval": EVERY user who created / edited the config through the router since the approval in force
--     (restarts with the first edit after an approval). The approver must not be in it (app check + CHECK below).
--   • "firstApproved*": UNKNOWN provenance (pre-0368 / seeded rows, no recorded editor, or content changed outside the router
--     since the last recorded edit) needs TWO distinct approvals of the SAME digest by two different admins; the first one is
--     recorded here and is not trust. The second approver can never be the first (CHECK below).
--   • approvers are real users (id > 0).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE "safety_plc_config_trust" ADD COLUMN IF NOT EXISTS "editorsSinceApproval" integer[] NOT NULL DEFAULT '{}';
ALTER TABLE "safety_plc_config_trust" ADD COLUMN IF NOT EXISTS "firstApprovedBy" integer;
ALTER TABLE "safety_plc_config_trust" ADD COLUMN IF NOT EXISTS "firstApprovedDigest" varchar(64);
ALTER TABLE "safety_plc_config_trust" ADD COLUMN IF NOT EXISTS "firstApprovedAt" timestamp;
ALTER TABLE "safety_plc_config_trust" DROP CONSTRAINT IF EXISTS "ck_safety_plc_trust_sod_editors";
ALTER TABLE "safety_plc_config_trust" ADD CONSTRAINT "ck_safety_plc_trust_sod_editors"
  CHECK ("approvedBy" IS NULL OR NOT ("approvedBy" = ANY ("editorsSinceApproval")));
ALTER TABLE "safety_plc_config_trust" DROP CONSTRAINT IF EXISTS "ck_safety_plc_trust_two_person";
ALTER TABLE "safety_plc_config_trust" ADD CONSTRAINT "ck_safety_plc_trust_two_person"
  CHECK ("approvedBy" IS NULL OR "firstApprovedBy" IS NULL OR "approvedBy" <> "firstApprovedBy");
ALTER TABLE "safety_plc_config_trust" DROP CONSTRAINT IF EXISTS "ck_safety_plc_trust_real_actor";
ALTER TABLE "safety_plc_config_trust" ADD CONSTRAINT "ck_safety_plc_trust_real_actor"
  CHECK (("approvedBy" IS NULL OR "approvedBy" > 0) AND ("firstApprovedBy" IS NULL OR "firstApprovedBy" > 0));

-- ════════════════════════════════════════════════════════════════════════════
-- doc 81 Đợt 8 task N fix scan 3 (ruling R-8-c) — DURABLE poll state of the background safety-PLC poller (one row per
-- config). Replaces the in-memory edge state and the system_settings heartbeat (removed: an admin-editable registry could
-- forge "healthy" or pre-claim an alarm).
--   • "link" + "flags" = the CONFIRMED edge state: advanced ONLY after the transition events were recorded; a restarted /
--     failed-over poller continues from it (no re-sent held trip, no lost release);
--   • "lastAttemptAt" / "lastOkAt" (epoch ms, bigint — no time-zone drift) = health: every instance computes the SAME
--     monitoring state from enabled configs × these rows; an enabled config WITHOUT a row is STALE;
--   • "staleAlarmEpisode" = cluster-wide compare-and-set: one "monitoring stale" alarm per episode.
-- Written only by safetyPlcPoller / its watchdog (safetyPlcPollerHealth.ts); no router writes it.
-- ROLLBACK: DROP TABLE IF EXISTS "safety_plc_poll_state";
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "safety_plc_poll_state" (
  "configId" integer PRIMARY KEY REFERENCES "safety_plc_configs" ("id") ON DELETE CASCADE,
  "link" varchar(16) NOT NULL DEFAULT 'unknown',
  "flags" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "intervalMs" integer,
  "lastAttemptAt" bigint,
  "lastOkAt" bigint,
  "writerInstance" varchar(64),
  "staleAlarmEpisode" varchar(200),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ck_safety_plc_poll_state_link" CHECK ("link" IN ('unknown', 'online', 'offline'))
);
COMMENT ON TABLE "safety_plc_poll_state" IS
  'doc 81 Dot 8 N fix scan 3 (R-8-c): durable confirmed edge state + last attempt / last decided read per safety-PLC config (background poller); health is computed from these rows on every instance.';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    REVOKE DELETE, TRUNCATE ON "safety_plc_poll_state" FROM avi_app;
    GRANT SELECT, INSERT, UPDATE ON "safety_plc_poll_state" TO avi_app;
  END IF;
END $$;
