-- doc 56 Đ0 việc 5 — DEVICE-CLASS TAXONOMY: WELDER + lớp thiết bị IoT (nền Trục 0).
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1) machinetypeenum +3: 'WELDER' (máy hàn — process automation), 'IOT_SENSOR'
--    (cảm biến IoT tự phát triển — telemetry-only), 'IOT_GATEWAY' (gateway IoT
--    trung chuyển). Đồng bộ 1:1 với MACHINE_TYPES (server/constants/machineTypes.ts),
--    machineTypeEnum (drizzle/schema/enums.ts) và map dẫn xuất DEVICE_CLASS_BY_TYPE
--    (24 type → aoi_avi | automation | iot). capabilityModel có profile cho cả 3
--    lớp mới (IOT_* telemetry-only, countsTowardOee=false — consumer OEE wire ở Đ5).
-- 2) robotjobtypeenum +1: 'weld' (job hàn cho robot hàn — drizzle/schema/robot.ts).
-- 3) machines.device_type_key varchar(64) NULL — khóa governance trỏ về
--    device_types."typeKey" (stamp lúc admin approve + backfill máy cũ qua
--    scripts/seed-device-types.mjs). Nullable, KHÔNG FK có chủ đích: device_types
--    version hóa theo (typeKey, version) — resolve ở tầng service
--    (deviceTypeRegistry.resolveDeviceTypeKeyForMachineType).
--
-- KHÔNG có bảng mới, KHÔNG có dữ liệu seed trong file này (seed 24 leaf nằm ở
-- scripts/seed-device-types.mjs — idempotent). Idempotent nhờ ADD VALUE IF NOT
-- EXISTS / ADD COLUMN IF NOT EXISTS.
--
-- ROLLBACK: cột device_type_key DROP được an toàn
--   (ALTER TABLE "machines" DROP COLUMN IF EXISTS "device_type_key";).
--   Giá trị enum KHÔNG rollback được trong Postgres — để nguyên là VÔ HẠI (máy
--   không dùng type mới thì không có row nào tham chiếu; tiền lệ 0241/0242).
--
-- LƯU Ý (gotcha ghi trong 0242): mỗi ADD VALUE phải là một câu lệnh auto-commit
-- riêng (Postgres không cho dùng giá trị enum mới trong cùng transaction đã thêm
-- nó). Migration này KHÔNG tham chiếu các giá trị mới ở nơi khác nên an toàn chạy
-- tuần tự.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TYPE "machinetypeenum" ADD VALUE IF NOT EXISTS 'WELDER';--> statement-breakpoint
ALTER TYPE "machinetypeenum" ADD VALUE IF NOT EXISTS 'IOT_SENSOR';--> statement-breakpoint
ALTER TYPE "machinetypeenum" ADD VALUE IF NOT EXISTS 'IOT_GATEWAY';--> statement-breakpoint
ALTER TYPE "robotjobtypeenum" ADD VALUE IF NOT EXISTS 'weld';--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "device_type_key" varchar(64);
