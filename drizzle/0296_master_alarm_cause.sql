-- ============================================================================
-- Migration 0296: master_alarms.cause — trường "NGUYÊN NHÂN" ISA-18.2 (doc 63 DEP-06).
--
-- ISA-18.2 bắt buộc 4 trường tại điểm cảnh báo: NGUYÊN NHÂN / HẬU QUẢ / HÀNH ĐỘNG /
-- THỜI ĐIỂM. master_alarms đã có consequence + timeToRespond (+ recommendedAction bên
-- alarm_taxonomy) nhưng "cause" KHUYẾT hẳn (P1 AUD-02: 1/4 trường không tồn tại ở
-- bất kỳ đâu trong schema). Cột text nullable — soạn trong lúc rationalization qua
-- EquipmentStandards; feed cockpit (assetCockpitService.machineAlarms) join xuống
-- operator theo alarmKey.
--
-- ADDITIVE + IDEMPOTENT. ROLLBACK: ALTER TABLE "master_alarms" DROP COLUMN "cause";
-- ============================================================================

ALTER TABLE "master_alarms" ADD COLUMN IF NOT EXISTS "cause" text;
