-- doc 56 Đ2a Việc 4 — IoT IDENTITY: liên kết mqtt_clients → machines (QĐ1 = machines-row).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: một thiết bị IoT tự-phát-triển (IOT_SENSOR / IOT_GATEWAY) vừa là một
-- hàng `machines` (governance/lifecycle/asset) VỪA là một client MQTT (mqtt_clients:
-- auth broker + push). Hôm nay hai bảng KHÔNG có liên kết cứng, nên khi máy bị
-- retired/rejected thì client MQTT của nó vẫn login + nhận lệnh được (GAP-4). Cột
-- này thêm SOFT LINK mqtt_clients."machineId" → machines.id để vòng đời máy có thể
-- thu hồi credential MQTT tương ứng (server/db/hierarchy.ts revokeMachineCredentialsTx).
--
-- TÊN CỘT: giữ camelCase có nháy "machineId" cho ĐỒNG BỘ với chính bảng mqtt_clients
-- ("stationId", "deviceId", "processId", "approvedBy" đều camelCase). KHÔNG dùng
-- snake_case "machine_id" để tránh lệch với drizzle/schema/mqtt.ts (integer("machineId")).
--
-- FK: REFERENCES machines(id) ON DELETE SET NULL — xoá cứng một máy (hiếm; thường
-- soft-delete) chỉ gỡ link, KHÔNG xoá lịch sử thiết bị MQTT. Đây là FK CỨNG DUY NHẤT
-- trên mqtt_clients (stationId/processId là soft-ref theo quy ước bảng) — có chủ đích:
-- link vòng đời phải toàn vẹn tham chiếu.
--
-- ADDITIVE + IDEMPOTENT + guarded. Cột nullable, KHÔNG default → không đụng hàng cũ.
-- Cờ ứng dụng IOT_DEVICE_CLASS_ENABLED (mặc định OFF) gate MỌI hành vi đọc/ghi cột
-- này ở tầng app — migration CHỈ tạo cột + FK + index, không đụng luồng đang chạy.
--
-- ROLLBACK (an toàn):
--   ALTER TABLE "mqtt_clients" DROP CONSTRAINT IF EXISTS "fk_mqtt_clients_machine";
--   DROP INDEX IF EXISTS "idx_mqtt_clients_machine";
--   ALTER TABLE "mqtt_clients" DROP COLUMN IF EXISTS "machineId";
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "mqtt_clients" ADD COLUMN IF NOT EXISTS "machineId" integer;--> statement-breakpoint

-- FK guarded: Postgres không có ADD CONSTRAINT IF NOT EXISTS → kiểm tra pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_mqtt_clients_machine'
  ) THEN
    ALTER TABLE "mqtt_clients"
      ADD CONSTRAINT "fk_mqtt_clients_machine"
      FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_mqtt_clients_machine" ON "mqtt_clients" ("machineId");
