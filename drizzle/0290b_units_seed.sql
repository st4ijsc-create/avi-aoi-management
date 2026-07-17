-- ============================================================================
-- Migration 0290b: UNIT REGISTRY SEED (doc 56 Đ1 việc 7, API-6). Seed
-- units_of_measure + unit_conversions cho các dimension automation/IoT.
--
-- ⚠ ÁP SAU 0290a (đã COMMIT các giá trị enum 'torque'/'pressure'/'flow'/'current'/
--   'frequency'). File này THAM CHIẾU các giá trị đó ở cột "dimension" → nếu gộp chung
--   0290a sẽ lỗi "unsafe use of new value of enum type" (gotcha 0242). Runner sort theo
--   tên file nên 0290a chạy & commit TRƯỚC 0290b — KHÔNG đổi thứ tự.
--
-- Bảng units_of_measure / unit_conversions ĐÃ tồn tại từ migration 0123 — CHỈ seed thêm.
-- ADDITIVE + IDEMPOTENT: ON CONFLICT DO NOTHING (unique "code"; unique ("fromUomCode",
--   "toUomCode")). Quy đổi: value_to = value_from * factor + offset (offset=0 cho mọi
--   cặp tuyến tính dưới đây; chỉ nhiệt độ mới cần offset — chưa seed cặp nhiệt độ).
-- ROLLBACK (không bắt buộc — dữ liệu tham chiếu vô hại):
--   DELETE FROM "unit_conversions" WHERE "fromUomCode" IN (...) ; DELETE FROM
--   "units_of_measure" WHERE "code" IN ('Nm','mNm','kgf·cm',...);
-- ============================================================================

INSERT INTO "units_of_measure" ("code","name","dimension","isBase") VALUES
  -- torque (base = Nm)
  ('Nm',      'Newton mét',             'torque',      true),
  ('mNm',     'Milli Newton mét',       'torque',      false),
  ('kgf·cm',  'Kilôgam-lực centimet',   'torque',      false),
  ('kgf·m',   'Kilôgam-lực mét',        'torque',      false),
  ('lbf·in',  'Pound-lực inch',         'torque',      false),
  ('lbf·ft',  'Pound-lực foot',         'torque',      false),
  -- pressure (base = kPa)
  ('kPa',     'Kilôpascal',             'pressure',    true),
  ('Pa',      'Pascal',                 'pressure',    false),
  ('bar',     'Bar',                    'pressure',    false),
  ('MPa',     'Mêgapascal',             'pressure',    false),
  ('psi',     'Pound trên inch vuông',  'pressure',    false),
  -- flow (base = mL/min)
  ('mL/min',  'Mililít trên phút',      'flow',        true),
  ('L/min',   'Lít trên phút',          'flow',        false),
  ('mL/s',    'Mililít trên giây',      'flow',        false),
  -- current (base = A)
  ('A',       'Ampe',                   'current',     true),
  ('mA',      'Miliampe',               'current',     false),
  ('kA',      'Kilôampe',               'current',     false),
  -- frequency (base = Hz)
  ('Hz',      'Hertz',                  'frequency',   true),
  ('kHz',     'Kilôhertz',              'frequency',   false),
  ('rpm',     'Vòng trên phút',         'frequency',   false),
  -- các dimension đã có — bổ sung đơn vị hay dùng cho automation/IoT (không đặt isBase
  -- để tránh xung đột với base có thể seed nơi khác)
  ('mL',      'Mililít',                'volume',      false),
  ('mg',      'Miligam',                'mass',        false),
  ('°C',      'Độ C',                   'temperature', false)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

INSERT INTO "unit_conversions" ("fromUomCode","toUomCode","factor","offset") VALUES
  -- torque ↔ Nm (base)
  ('mNm',    'Nm',     0.001,           0),
  ('Nm',     'mNm',    1000,            0),
  ('kgf·cm', 'Nm',     0.098066500000,  0),
  ('Nm',     'kgf·cm', 10.197162129779, 0),
  ('kgf·m',  'Nm',     9.806650000000,  0),
  ('Nm',     'kgf·m',  0.101971621298,  0),
  ('lbf·in', 'Nm',     0.112984829028,  0),
  ('Nm',     'lbf·in', 8.850745791327,  0),
  ('lbf·ft', 'Nm',     1.355817948331,  0),
  ('Nm',     'lbf·ft', 0.737562149277,  0),
  -- pressure ↔ kPa (base)
  ('Pa',     'kPa',    0.001,           0),
  ('kPa',    'Pa',     1000,            0),
  ('bar',    'kPa',    100,             0),
  ('kPa',    'bar',    0.01,            0),
  ('MPa',    'kPa',    1000,            0),
  ('kPa',    'MPa',    0.001,           0),
  ('psi',    'kPa',    6.894757293168,  0),
  ('kPa',    'psi',    0.145037737730,  0),
  -- flow ↔ mL/min (base)
  ('L/min',  'mL/min', 1000,            0),
  ('mL/min', 'L/min',  0.001,           0),
  ('mL/s',   'mL/min', 60,              0),
  ('mL/min', 'mL/s',   0.016666666667,  0),
  -- current ↔ A (base)
  ('mA',     'A',      0.001,           0),
  ('A',      'mA',     1000,            0),
  ('kA',     'A',      1000,            0),
  ('A',      'kA',     0.001,           0),
  -- frequency ↔ Hz (base)
  ('kHz',    'Hz',     1000,            0),
  ('Hz',     'kHz',    0.001,           0),
  ('rpm',    'Hz',     0.016666666667,  0),
  ('Hz',     'rpm',    60,              0)
ON CONFLICT ("fromUomCode","toUomCode") DO NOTHING;
