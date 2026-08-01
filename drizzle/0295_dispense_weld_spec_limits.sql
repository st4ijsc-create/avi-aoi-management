-- ============================================================================
-- Migration 0295: SPEC LIMITS cho họ máy tự động hoá còn thiếu (doc 56 Đ7).
--
-- mig 0289 seed process_step_types cho screw/dispense/weld nhưng process_spec_limits
-- MỚI chỉ có screw_tightening. Đợt Đ7 nhân rộng sang DISPENSING (điểm keo) + WELDER
-- (hàn điểm): seed spec (lsl/usl/nominal) để spec-gate (Đ4 PROCESS_SPEC_GATE) + SPC
-- Cpk (Đ5) chạy được cho hai họ này y như máy vít — CHUẨN HOÁ TỔNG QUÁT.
--
-- Bảng process_spec_limits KHÔNG có unique constraint (stepType, metricKey, machineType);
-- seed idempotent bằng INSERT…SELECT…WHERE NOT EXISTS. Dữ liệu tinh chỉnh được (KT
-- chỉnh qua UI Threshold Advisor) — đây chỉ là mặc định khởi tạo hợp lý.
--
-- ADDITIVE + IDEMPOTENT. ROLLBACK: xoá 4 dòng seed theo (stepType, metricKey) dưới đây.
-- ============================================================================

INSERT INTO "process_spec_limits" ("machineType","stepType","metricKey","unit","lsl","usl","nominal","active")
SELECT v."machineType", v."stepType", v."metricKey", v."unit", v."lsl", v."usl", v."nominal", true
FROM (VALUES
  ('DISPENSING','glue_dispense','volume',   'ml',  0.15,  0.35,  0.25),
  ('DISPENSING','glue_dispense','pressure', 'kPa', 180.0, 320.0, 250.0),
  ('WELDER',    'weld_spot',    'weld_current','A', 1800.0, 2600.0, 2200.0),
  ('WELDER',    'weld_spot',    'weld_time', 'ms',  80.0,  220.0, 150.0)
) AS v("machineType","stepType","metricKey","unit","lsl","usl","nominal")
WHERE NOT EXISTS (
  SELECT 1 FROM "process_spec_limits" p
  WHERE p."stepType" = v."stepType" AND p."metricKey" = v."metricKey"
    AND p."machineType" IS NOT DISTINCT FROM v."machineType"
);
