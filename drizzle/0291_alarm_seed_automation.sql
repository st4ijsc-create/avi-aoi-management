-- ============================================================================
-- Migration 0291: ALARM SEED — họ máy automation nội bộ (doc 56 Đ1 việc 8, API-7).
--   Kiểu seed 0231/0232 (INSERT ... ON CONFLICT DO NOTHING, no DDL, no flag).
--
-- alarm_taxonomy hiện phủ ~122 mã vendor (0231/0232) nhưng TRỐNG mã screw/glue/weld
-- của firmware ST4I. Quy ước firmware NỘI BỘ: nativeCode = standardCode (không cần
-- tầng map vendor), vendor='st4i'. Sau seed, mapAlarm(vendor,nativeCode) phân giải được
-- → severity ISA-18.2 → andon (mapAlarm→andon đã LIVE, EQ_INTEG=true).
--
--   • alarm_taxonomy — TỪ ĐIỂN vendor→standard (nơi mapAlarm đọc). severity theo bands
--     ISA-18.2: critical | high | medium | low | diagnostic.
--   • master_alarms  — lớp RATIONALIZATION ISA-18.2 (priority/consequence/timeToRespond)
--     để 3 họ máy hiện diện trong master alarm DB. alarmKey=standardCode,
--     assetType=machineType. priority ở đây ĐẶT TAY (chưa chạy qua derivePriority) — chỉ
--     là default hợp lý; ON CONFLICT DO NOTHING nên KHÔNG đè bản rationalize đã có.
--
-- 3 họ (9 mã):
--   SCREWDRIVE: TORQUE_OUT_OF_SPEC, SCREW_FLOAT, SCREW_CROSS_THREAD
--   DISPENSING: GLUE_CLOG, GLUE_PRESSURE_LOW, GLUE_EMPTY
--   WELDER:     WELD_TEMP_HIGH, WELD_CURRENT_LOW, WELD_TIME_SHORT
--
-- ADDITIVE + IDEMPOTENT: alarm_taxonomy ON CONFLICT ("vendor","nativeCode") DO NOTHING
--   (uq_alarmtax_vendor_native); master_alarms ON CONFLICT ("alarmKey","assetType") DO
--   NOTHING (uq_masteralarm_key_asset).
-- ROLLBACK: DELETE FROM "alarm_taxonomy" WHERE "vendor"='st4i';
--           DELETE FROM "master_alarms"  WHERE "vendor"='st4i';
-- ============================================================================

-- ── (1) alarm_taxonomy — từ điển nativeCode → standardCode (mapAlarm) ─────────
INSERT INTO "alarm_taxonomy" ("vendor","machineType","nativeCode","standardCode","severity","description","recommendedAction") VALUES
  ('st4i', 'SCREWDRIVE', 'TORQUE_OUT_OF_SPEC', 'TORQUE_OUT_OF_SPEC', 'high',   'Tightening torque outside the spec window (LSL/USL)',      'Kiểm tra cữ lực & hiệu chuẩn tô vít; đối chiếu process_spec_limits (torque); chặn/rework mối vít nghi ngờ.'),
  ('st4i', 'SCREWDRIVE', 'SCREW_FLOAT',        'SCREW_FLOAT',        'high',   'Screw not fully seated (floating / high head)',            'Kiểm tra ren lỗ & chiều dài vít; căn lại chiều cao mũi vít; rework mối vít nổi.'),
  ('st4i', 'SCREWDRIVE', 'SCREW_CROSS_THREAD', 'SCREW_CROSS_THREAD', 'high',   'Cross-thread detected (angle/torque signature abnormal)',  'Dừng đầu vít; kiểm tra đồng trục mũi-lỗ & ren; thay chi tiết hỏng ren.'),
  ('st4i', 'DISPENSING', 'GLUE_CLOG',          'GLUE_CLOG',          'high',   'Dispense nozzle clogged (no/low flow at pressure)',        'Vệ sinh/thay kim bơm; purge keo; kiểm tra độ nhớt & hạn dùng keo.'),
  ('st4i', 'DISPENSING', 'GLUE_PRESSURE_LOW',  'GLUE_PRESSURE_LOW',  'medium', 'Dispense pressure below set point',                        'Kiểm tra nguồn khí/áp & rò rỉ; hiệu chỉnh regulator; kiểm tra bơm keo.'),
  ('st4i', 'DISPENSING', 'GLUE_EMPTY',         'GLUE_EMPTY',         'high',   'Glue reservoir/syringe empty',                             'Thay/nạp ống keo; mồi lại đường keo; kiểm tra cảm biến mức keo.'),
  ('st4i', 'WELDER',     'WELD_TEMP_HIGH',     'WELD_TEMP_HIGH',     'high',   'Weld tip/temperature above the upper limit',               'Kiểm tra làm mát & dòng hàn; hạ set point nhiệt; kiểm tra mũi hàn.'),
  ('st4i', 'WELDER',     'WELD_CURRENT_LOW',   'WELD_CURRENT_LOW',   'high',   'Weld current below the lower limit (cold-joint risk)',     'Kiểm tra tiếp xúc điện cực & cáp; hiệu chuẩn nguồn hàn; làm sạch bề mặt.'),
  ('st4i', 'WELDER',     'WELD_TIME_SHORT',    'WELD_TIME_SHORT',    'medium', 'Weld time shorter than the profile minimum',               'Kiểm tra profile thời gian hàn & trigger; đối chiếu recipe weld_profile.')
ON CONFLICT ("vendor","nativeCode") DO NOTHING;--> statement-breakpoint

-- ── (2) master_alarms — điểm alarm đã rationalize (ISA-18.2) ─────────────────
-- consequence ∈ (none|minor|major|severe); priority default hợp lý (low|medium|high|
-- critical); timeToRespond = phút. isSuppressed dùng default (false).
INSERT INTO "master_alarms" ("alarmKey","assetType","vendor","nativeCode","label","priority","consequence","timeToRespond","rationalization") VALUES
  ('TORQUE_OUT_OF_SPEC', 'SCREWDRIVE', 'st4i', 'TORQUE_OUT_OF_SPEC', 'Torque ngoài spec',   'high',   'major', 5,  'Mối ghép ren sai lực siết → nguy cơ lỏng/hỏng liên kết; chặn & rework.'),
  ('SCREW_FLOAT',        'SCREWDRIVE', 'st4i', 'SCREW_FLOAT',        'Vít nổi',             'high',   'major', 5,  'Vít không siết hết → hở/lỏng; kiểm tra ren lỗ & rework.'),
  ('SCREW_CROSS_THREAD', 'SCREWDRIVE', 'st4i', 'SCREW_CROSS_THREAD', 'Vít chờn ren',        'high',   'major', 5,  'Chờn ren làm hỏng chi tiết & liên kết; dừng, kiểm tra đồng trục.'),
  ('GLUE_CLOG',          'DISPENSING', 'st4i', 'GLUE_CLOG',          'Tắc kim keo',         'high',   'major', 5,  'Không ra keo → thiếu keo/hở; vệ sinh kim & purge.'),
  ('GLUE_PRESSURE_LOW',  'DISPENSING', 'st4i', 'GLUE_PRESSURE_LOW',  'Áp keo thấp',         'medium', 'minor', 15, 'Áp thấp → lượng keo thiếu; kiểm tra khí/áp & regulator.'),
  ('GLUE_EMPTY',         'DISPENSING', 'st4i', 'GLUE_EMPTY',         'Hết keo',             'high',   'major', 5,  'Hết keo → dừng công đoạn; thay ống keo & mồi lại.'),
  ('WELD_TEMP_HIGH',     'WELDER',     'st4i', 'WELD_TEMP_HIGH',     'Nhiệt hàn cao',       'high',   'major', 5,  'Quá nhiệt → hỏng mối/chi tiết; kiểm tra làm mát & dòng hàn.'),
  ('WELD_CURRENT_LOW',   'WELDER',     'st4i', 'WELD_CURRENT_LOW',   'Dòng hàn thấp',       'high',   'major', 5,  'Dòng thấp → mối hàn nguội/yếu; kiểm tra điện cực & nguồn hàn.'),
  ('WELD_TIME_SHORT',    'WELDER',     'st4i', 'WELD_TIME_SHORT',    'Thời gian hàn ngắn',  'medium', 'minor', 15, 'Thời gian ngắn → mối hàn yếu; kiểm tra profile & trigger.')
ON CONFLICT ("alarmKey","assetType") DO NOTHING;
