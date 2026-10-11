-- ════════════════════════════════════════════════════════════════════════════
-- 0371 — doc 81 Đợt 9 Group U (owner decision 2026-10-12): trusted safety events bound to DURABLE rows (U3) + the read mode
--        of the background safety-PLC poller (U1 OPC-UA subscription / polling fallback, U2 Modbus latch)
-- ════════════════════════════════════════════════════════════════════════════
--
-- U3 — VÌ SAO: đến Đợt 8, "sự kiện an toàn tin cậy" (thông báo vượt opt-out) được đánh dấu trong BỘ NHỚ của instance đã ghi
--   (trustedSafetyOrigin.ts, khoá = safety_events.id, TTL 10 phút). Với nhiều instance + fan-out Redis, một gói phát lại (cùng
--   id, khác máy / khác nội dung) tới instance còn giữ dấu ⇒ thêm một lần vượt opt-out. Chủ dự án: "bind trust to durable rows,
--   never to instance memory".
--   NGỮ NGHĨA: một hàng / sự kiện tin cậy, ghi TRONG CÙNG giao dịch với hàng safety_events (safetyAuditService.recordFromDeviceIngest).
--   "digest" = sha256 của nội dung sự kiện mà thông báo dùng (id, loại, robot/station/line, near-miss) — tính ở ĐÚNG MỘT chỗ:
--   server/services/safety/trustedSafetyOrigin.ts#trustedEventDigest. Bộ máy luật TIÊU THỤ đúng MỘT lần:
--     UPDATE ... SET "consumedAt" = now() WHERE "eventId" = $id AND "consumedAt" IS NULL AND digest = $d AND còn hạn RETURNING
--   ⇒ lần thứ hai (instance khác, gói Redis phát lại, nội dung bị sửa) không bao giờ được vượt opt-out.
--   Trigger chặn "tái vũ trang": một hàng đã tiêu thụ không thể quay về chưa tiêu thụ; nội dung (eventId, origin, eventType,
--   digest, createdAt) không bao giờ đổi sau khi chèn.
-- U1/U2 — "readMode" trên safety_plc_poll_state: chế độ đọc thật của cấu hình (subscription | poll_fallback | poll |
--   poll_latch | sim). Bảng nguồn an toàn hiển thị "polling (short presses may be missed)" khi không phải subscription / latch.
--
-- QUYỀN `avi_app`: safety_event_trust SELECT + INSERT + UPDATE (UPDATE chỉ đi một chiều nhờ trigger). KHÔNG DELETE/TRUNCATE
--   (hàng đi theo safety_events qua ON DELETE CASCADE).
-- ⚠ DDL chạy bằng owner `aoi`: `node scripts/apply-migration-0371.mjs --test-only` (dev: `--dev-only`, chủ dự án quyết; không
--   cờ ⇒ TỪ CHỐI — R-3-g). Thiếu bảng ⇒ cửa device-ingest ghi sự kiện như THƯỜNG (không vượt) — đóng an toàn cho phần tin cậy.
--   Thiếu cột readMode ⇒ bộ đọc nền không lưu được trạng thái ⇒ sức khoẻ STALE + cảnh báo (ồn nhưng an toàn): áp 0371 TRƯỚC
--   khi bật SAFETY_PLC_POLLER_ENABLED.
-- ⚠ Repo CẤM `drizzle-kit push/generate`; hai bảng này chỉ được đọc / ghi bằng SQL thô ở module của chúng (census).
-- ROLLBACK: DROP TABLE IF EXISTS "safety_event_trust"; DROP FUNCTION IF EXISTS safety_event_trust_guard();
--           ALTER TABLE "safety_plc_poll_state" DROP COLUMN IF EXISTS "readMode";
--
CREATE TABLE IF NOT EXISTS "safety_event_trust" (
  "eventId" integer PRIMARY KEY REFERENCES "safety_events" ("id") ON DELETE CASCADE,
  "origin" varchar(32) NOT NULL,
  "eventType" varchar(24) NOT NULL,
  "digest" varchar(64) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "consumedAt" timestamptz,
  "consumedBy" varchar(64),
  CONSTRAINT "ck_safety_event_trust_origin" CHECK ("origin" IN ('robot_telemetry', 'safety_plc')),
  CONSTRAINT "ck_safety_event_trust_digest" CHECK ("digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_safety_event_trust_consumed" CHECK (("consumedAt" IS NULL) = ("consumedBy" IS NULL))
);
COMMENT ON TABLE "safety_event_trust" IS
  'doc 81 Dot 9 U3: trusted safety event bound to its durable safety_events row (digest) and consumed exactly once by the rules engine (consumedAt). Written by safetyAuditService.recordFromDeviceIngest in the same transaction as the event.';

CREATE OR REPLACE FUNCTION safety_event_trust_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."consumedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'safety_event_trust % already consumed (one-way)', OLD."eventId" USING ERRCODE = '23514';
  END IF;
  IF NEW."eventId" IS DISTINCT FROM OLD."eventId" OR NEW."origin" IS DISTINCT FROM OLD."origin"
     OR NEW."eventType" IS DISTINCT FROM OLD."eventType" OR NEW."digest" IS DISTINCT FROM OLD."digest"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'safety_event_trust % content is immutable', OLD."eventId" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "trg_safety_event_trust_guard" ON "safety_event_trust";
CREATE TRIGGER "trg_safety_event_trust_guard" BEFORE UPDATE ON "safety_event_trust"
  FOR EACH ROW EXECUTE FUNCTION safety_event_trust_guard();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    -- REVOKE tường minh: default ACL của dev cấp ĐỦ quyền cho avi_app (0357 đo 2026-09-15).
    REVOKE DELETE, TRUNCATE ON "safety_event_trust" FROM avi_app;
    GRANT SELECT, INSERT, UPDATE ON "safety_event_trust" TO avi_app;
  END IF;
END $$;

-- U1 / U2 — read mode of the background poller (NULL = not reported yet, e.g. written by a pre-Đợt-9 poller).
ALTER TABLE "safety_plc_poll_state" ADD COLUMN IF NOT EXISTS "readMode" varchar(32);
ALTER TABLE "safety_plc_poll_state" DROP CONSTRAINT IF EXISTS "ck_safety_plc_poll_state_read_mode";
ALTER TABLE "safety_plc_poll_state" ADD CONSTRAINT "ck_safety_plc_poll_state_read_mode"
  CHECK ("readMode" IS NULL OR "readMode" IN ('subscription', 'poll_fallback', 'poll', 'poll_latch', 'sim'));
