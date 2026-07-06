-- ============================================================================
-- Migration 0231: Alarm Taxonomy — REAL vendor native-code seed (doc 37 §6.4, Đợt-B2)
--
-- alarmTaxonomy.ts previously shipped only ~12 ILLUSTRATIVE mappings. This loads
-- ~122 REAL native alarm codes extracted from vendor manuals into the
-- alarm_taxonomy table (schema drizzle/schema/equipmentStandards.ts), mapping
-- vendor + nativeCode -> standardCode + ISA-18.2 severity + recommendedAction.
--
-- VENDORS: Mitsubishi MELSERVO MR-J4 (servo), Universal Robots (cobot), Fanuc
--   (robot), Delta ASDA (servo), Omron NJ/NX (PLC), Zmotion (motion controller).
--
-- SEVERITY (ISA-18.2 bands, as modelled in code): critical|high|medium|low|diagnostic.
--   "diagnostic" == the vendor WARNING band (self-clearing). asSeverity() narrows any
--   other string to "medium", so warnings are stored as "diagnostic" to round-trip.
--
-- AUTO-CLEAR: no boolean column exists on alarm_taxonomy, so self-clearing warnings
--   are tagged with a leading "[AUTO-CLEAR]" token in "description".
--
-- ADDITIVE + IDEMPOTENT: INSERT ... ON CONFLICT ("vendor","nativeCode") DO NOTHING
--   against the unique index uq_alarmtax_vendor_native. Re-runnable; no DDL, no flag.
--   This SQL is generated to MIRROR server/services/standards/alarmTaxonomyVendorSeed.ts
--   (the canonical in-memory copy) so the DB router and mapAlarm() agree.
--   Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- ============================================================================

-- ── mitsubishi (55 codes) ──────────────────────────────────────
INSERT INTO "alarm_taxonomy" ("vendor", "machineType", "nativeCode", "standardCode", "severity", "description", "recommendedAction") VALUES
  ('mitsubishi', 'SERVO', '10', 'SERVO_UNDERVOLTAGE', 'high', 'Undervoltage — bus voltage dropped below threshold', 'Kiểm tra nguồn cấp / sụt áp; đo bus DC; reset sau khi phục hồi nguồn.'),
  ('mitsubishi', 'SERVO', '12', 'MEMORY_FAULT', 'high', 'Memory error 1 (RAM)', 'Cycle power; nếu lặp lại thay amplifier.'),
  ('mitsubishi', 'SERVO', '13', 'CLOCK_FAULT', 'high', 'Clock error', 'Cycle power; kiểm tra firmware; thay amplifier nếu lặp lại.'),
  ('mitsubishi', 'SERVO', '15', 'MEMORY_FAULT', 'high', 'Memory error 2 (EEPROM)', 'Re-write parameters; thay amplifier nếu lặp lại.'),
  ('mitsubishi', 'SERVO', '16', 'ENCODER_FAULT', 'high', 'Encoder initial communication error 1', 'Kiểm tra cáp encoder & connector; đo shield; thay cáp/encoder.'),
  ('mitsubishi', 'SERVO', '17', 'BOARD_FAULT', 'high', 'Board error (CPU/board self-check)', 'Cycle power; thay amplifier nếu lặp lại.'),
  ('mitsubishi', 'SERVO', '1A', 'CONFIG_MISMATCH', 'high', 'Servo motor combination error', 'Đối chiếu model motor↔amplifier; sửa tham số; thay đúng motor.'),
  ('mitsubishi', 'SERVO', '1E', 'ENCODER_FAULT', 'high', 'Encoder initial communication error 2', 'Kiểm tra cáp encoder & connector; thay cáp/encoder.'),
  ('mitsubishi', 'SERVO', '1F', 'ENCODER_FAULT', 'high', 'Encoder initial communication error 3', 'Kiểm tra cáp encoder & connector; thay cáp/encoder.'),
  ('mitsubishi', 'SERVO', '20', 'ENCODER_FAULT', 'high', 'Encoder normal communication error 1', 'Kiểm tra nhiễu/cáp encoder; nối đất shield; thay cáp.'),
  ('mitsubishi', 'SERVO', '21', 'ENCODER_FAULT', 'high', 'Encoder normal communication error 2', 'Kiểm tra nhiễu/cáp encoder; nối đất shield; thay cáp.'),
  ('mitsubishi', 'SERVO', '24', 'GROUND_FAULT', 'critical', 'Main circuit error (ground fault at output)', 'NGẮT nguồn; đo cách điện motor & cáp U/V/W xuống đất; sửa chạm đất trước khi cấp lại.'),
  ('mitsubishi', 'SERVO', '25', 'POSITION_LOST', 'high', 'Absolute position erased', 'Thay pin backup encoder; thực hiện lại home/absolute setup.'),
  ('mitsubishi', 'SERVO', '27', 'ENCODER_FAULT', 'high', 'Initial magnetic pole detection error', 'Kiểm tra đấu dây motor & encoder; chạy lại magnetic pole detection.'),
  ('mitsubishi', 'SERVO', '30', 'REGEN_FAULT', 'high', 'Regenerative error (regen resistor overload)', 'Giảm tần suất decel; kiểm tra/ thêm regen resistor; kiểm tra đấu nối P-C.'),
  ('mitsubishi', 'SERVO', '31', 'OVERSPEED', 'high', 'Overspeed — motor exceeded speed limit', 'Kiểm tra gain/overshoot & lệnh tốc độ; giảm tốc; tune lại.'),
  ('mitsubishi', 'SERVO', '32', 'SERVO_OVERCURRENT', 'critical', 'Overcurrent — output stage overcurrent', 'NGẮT nguồn; kiểm tra ngắn mạch U/V/W & cách điện motor; giảm tải; thay IGBT/amplifier nếu hỏng.'),
  ('mitsubishi', 'SERVO', '33', 'OVERVOLTAGE', 'high', 'Overvoltage — bus voltage too high', 'Kiểm tra regen resistor & nguồn; giảm tải quán tính/decel.'),
  ('mitsubishi', 'SERVO', '34', 'COMM_ERROR', 'high', 'SSCNET/CRC receive error', 'Kiểm tra cáp SSCNET/ quang; nối lại; thay cáp.'),
  ('mitsubishi', 'SERVO', '35', 'COMMAND_ERROR', 'medium', 'Command frequency error', 'Kiểm tra tần số xung lệnh trong dải cho phép; sửa nguồn phát lệnh.'),
  ('mitsubishi', 'SERVO', '37', 'PARAM_ERROR', 'medium', 'Parameter error', 'Đối chiếu tham số ngoài dải; nạp lại tham số hợp lệ.'),
  ('mitsubishi', 'SERVO', '3A', 'INRUSH_FAULT', 'high', 'Inrush current suppression circuit error', 'Kiểm tra tần suất bật/tắt nguồn; để amplifier nguội; thay nếu lặp lại.'),
  ('mitsubishi', 'SERVO', '45', 'OVERTEMP', 'high', 'Main circuit device overheat', 'Kiểm tra quạt & thông gió tủ; giảm tải; để nguội rồi reset.'),
  ('mitsubishi', 'SERVO', '46', 'MOTOR_OVERHEAT', 'high', 'Servo motor overheat', 'Kiểm tra tải/chu kỳ làm việc & làm mát motor; để nguội rồi reset.'),
  ('mitsubishi', 'SERVO', '47', 'COOLING_FAULT', 'high', 'Cooling fan error/stop', 'Kiểm tra/thay quạt làm mát amplifier.'),
  ('mitsubishi', 'SERVO', '50', 'OVERLOAD', 'high', 'Overload 1 (thermal, continuous)', 'Giảm tải/chu kỳ; kiểm tra kẹt cơ khí & gain; đúng cỡ motor.'),
  ('mitsubishi', 'SERVO', '51', 'OVERLOAD', 'high', 'Overload 2 (max torque held)', 'Kiểm tra kẹt cơ khí/va chạm; giảm tải; kiểm tra phanh.'),
  ('mitsubishi', 'SERVO', '52', 'POSITION_ERROR_EXCESS', 'high', 'Error excessive (following error too large)', 'Kiểm tra kẹt cơ/tải; tăng gain/giới hạn lệnh; kiểm tra phanh & encoder.'),
  ('mitsubishi', 'SERVO', '54', 'OSCILLATION', 'medium', 'Oscillation detection', 'Giảm gain / bật filter; tune lại vòng điều khiển.'),
  ('mitsubishi', 'SERVO', '56', 'SAFETY_ESTOP', 'high', 'Forced stop error (forced-stop asserted while running)', 'Giải trừ forced stop; kiểm tra chuỗi an toàn; reset.'),
  ('mitsubishi', 'SERVO', '63', 'SAFETY_STO', 'critical', 'STO timing error (functional safety)', 'Kiểm tra đấu nối/timing tín hiệu STO; kiểm tra mạch an toàn; reset theo quy trình.'),
  ('mitsubishi', 'SERVO', '64', 'SAFETY_STO', 'critical', 'Functional safety unit / STO fault', 'Kiểm tra module/đấu nối functional-safety & STO; reset theo quy trình an toàn.'),
  ('mitsubishi', 'SERVO', '66', 'ENCODER_FAULT', 'high', 'Encoder communication error (functional safety)', 'Kiểm tra cáp encoder an toàn; thay cáp/encoder.'),
  ('mitsubishi', 'SERVO', '88', 'WATCHDOG_FAULT', 'critical', 'Watchdog — internal CPU watchdog tripped', 'Cycle power; cập nhật firmware; thay amplifier nếu lặp lại.'),
  ('mitsubishi', 'SERVO', '8A', 'COMM_TIMEOUT', 'high', 'Serial/USB communication timeout', 'Kiểm tra cáp & master truyền thông; khôi phục kết nối; kiểm tra chu kỳ giao tiếp.'),
  ('mitsubishi', 'SERVO', '8D', 'COMM_ERROR', 'high', 'CC-Link IE Field communication error', 'Kiểm tra mạng CC-Link IE & node; nối lại; thay cáp.'),
  ('mitsubishi', 'SERVO', '8E', 'COMM_ERROR', 'high', 'Serial communication error', 'Kiểm tra cáp/nhiễu truyền thông; nối đất shield; thay cáp.'),
  ('mitsubishi', 'SERVO', '91', 'OVERTEMP_WARNING', 'diagnostic', '[AUTO-CLEAR] Servo amplifier overheat warning', 'Kiểm tra thông gió tủ & tải trước khi thành lỗi 45.'),
  ('mitsubishi', 'SERVO', '92', 'BATTERY_WARNING', 'diagnostic', '[AUTO-CLEAR] Battery cable disconnection warning', 'Kiểm tra/nối lại cáp pin encoder; thay pin để tránh mất absolute.'),
  ('mitsubishi', 'SERVO', '95', 'SAFETY_STO_WARNING', 'diagnostic', '[AUTO-CLEAR] STO warning', 'Kiểm tra trạng thái tín hiệu STO.'),
  ('mitsubishi', 'SERVO', '96', 'HOMING_WARNING', 'diagnostic', '[AUTO-CLEAR] Home position setting warning', 'Thực hiện lại home position setting.'),
  ('mitsubishi', 'SERVO', '9F', 'BATTERY_WARNING', 'diagnostic', '[AUTO-CLEAR] Battery warning (low voltage)', 'Thay pin backup encoder sớm để giữ vị trí absolute.'),
  ('mitsubishi', 'SERVO', 'E0', 'REGEN_WARNING', 'diagnostic', '[AUTO-CLEAR] Excessive regeneration warning', 'Giảm tần suất decel; kiểm tra regen resistor trước khi thành lỗi 30.'),
  ('mitsubishi', 'SERVO', 'E1', 'OVERLOAD_WARNING', 'diagnostic', '[AUTO-CLEAR] Overload warning 1', 'Giảm tải/chu kỳ; kiểm tra kẹt cơ trước khi thành lỗi 50.'),
  ('mitsubishi', 'SERVO', 'E2', 'OVERTEMP_WARNING', 'diagnostic', '[AUTO-CLEAR] Servo motor overheat warning', 'Giảm tải & kiểm tra làm mát motor.'),
  ('mitsubishi', 'SERVO', 'E3', 'ENCODER_WARNING', 'diagnostic', '[AUTO-CLEAR] Absolute position counter warning', 'Kiểm tra tốc độ khi mất điện; xác nhận lại absolute nếu cần.'),
  ('mitsubishi', 'SERVO', 'E6', 'SAFETY_ESTOP_WARNING', 'diagnostic', '[AUTO-CLEAR] Servo forced stop warning (EM2/EM1)', 'Giải trừ forced stop; kiểm tra chuỗi an toàn.'),
  ('mitsubishi', 'SERVO', 'E7', 'SAFETY_ESTOP_WARNING', 'diagnostic', '[AUTO-CLEAR] Controller forced stop warning', 'Giải trừ forced stop từ controller.'),
  ('mitsubishi', 'SERVO', 'E8', 'COOLING_WARNING', 'diagnostic', '[AUTO-CLEAR] Cooling fan speed reduction warning', 'Vệ sinh/thay quạt làm mát sắp tới.'),
  ('mitsubishi', 'SERVO', 'E9', 'POWER_WARNING', 'diagnostic', '[AUTO-CLEAR] Main circuit off warning (servo-on with main power off)', 'Bật nguồn mạch chính trước khi servo-on.'),
  ('mitsubishi', 'SERVO', 'EC', 'OVERLOAD_WARNING', 'diagnostic', '[AUTO-CLEAR] Overload warning 2', 'Giảm tải đỉnh/chu kỳ vận hành.'),
  ('mitsubishi', 'SERVO', 'ED', 'OVERLOAD_WARNING', 'diagnostic', '[AUTO-CLEAR] Output watt excess warning', 'Giảm công suất/chu kỳ vận hành.'),
  ('mitsubishi', 'SERVO', 'F0', 'DIAGNOSTIC_WARNING', 'diagnostic', '[AUTO-CLEAR] Tough drive warning (auto-recovery active)', 'Theo dõi; xử lý nguyên nhân gốc (nhiễu/instant power failure).'),
  ('mitsubishi', 'SERVO', 'F2', 'DIAGNOSTIC_WARNING', 'diagnostic', '[AUTO-CLEAR] Drive recorder area writing time-out warning', 'Theo dõi; kiểm tra bộ nhớ drive recorder.'),
  ('mitsubishi', 'SERVO', 'F3', 'OSCILLATION', 'diagnostic', '[AUTO-CLEAR] Oscillation detection warning', 'Giảm gain/bật filter trước khi thành rung nặng.')
ON CONFLICT ("vendor", "nativeCode") DO NOTHING;

-- ── universal-robots (18 codes) ──────────────────────────────────────
INSERT INTO "alarm_taxonomy" ("vendor", "machineType", "nativeCode", "standardCode", "severity", "description", "recommendedAction") VALUES
  ('universal-robots', 'ROBOT', 'C3', 'COMM_ERROR', 'high', 'Controller ↔ safety/joint communication error', 'Kiểm tra cáp nội bộ & nguồn; khởi động lại controller.'),
  ('universal-robots', 'ROBOT', 'C4', 'COMM_ERROR', 'high', 'Communication error (bus/packet)', 'Kiểm tra kết nối/nhiễu; khởi động lại; cập nhật firmware.'),
  ('universal-robots', 'ROBOT', 'C10', 'COMM_TIMEOUT', 'high', 'Communication timeout (no response from module)', 'Kiểm tra cáp & nguồn joint/safety board; khởi động lại.'),
  ('universal-robots', 'ROBOT', 'C17', 'SAFETY_FAULT', 'critical', 'Safety system fault', 'Kiểm tra cấu hình an toàn & I/O an toàn; xử lý theo quy trình rồi khởi động lại.'),
  ('universal-robots', 'ROBOT', 'C50', 'POWER_FAULT', 'high', 'Power supply fault (48V/robot power)', 'Kiểm tra nguồn 48V & cầu chì; đo điện áp; thay PSU nếu lỗi.'),
  ('universal-robots', 'ROBOT', 'C55', 'SAFETY_FAULT', 'critical', 'Safety-rated fault (safety processor)', 'Ghi log; kiểm tra safety control board; liên hệ hỗ trợ nếu lặp lại.'),
  ('universal-robots', 'ROBOT', 'C56', 'SAFETY_FAULT', 'critical', 'Safety-rated fault (redundancy mismatch)', 'Kiểm tra chuỗi an toàn kép; xử lý theo quy trình; khởi động lại.'),
  ('universal-robots', 'ROBOT', 'C57', 'POWER_FAULT', 'high', 'Power/energy monitoring fault', 'Kiểm tra nguồn & tải; đo điện áp; thay PSU nếu cần.'),
  ('universal-robots', 'ROBOT', 'C59', 'SAFETY_FAULT', 'critical', 'Safety-rated fault (safety I/O)', 'Kiểm tra đấu nối safety I/O & cấu hình; xử lý rồi khởi động lại.'),
  ('universal-robots', 'ROBOT', 'C62', 'POWER_FAULT', 'high', 'Power stage fault (joint drive power)', 'Kiểm tra nguồn joint & cáp; khởi động lại; thay joint nếu lặp lại.'),
  ('universal-robots', 'ROBOT', 'C77', 'SAFETY_FAULT', 'critical', 'Safety-rated fault (safety limit violation)', 'Xem lại giới hạn an toàn đã cấu hình; xử lý theo quy trình rồi khởi động lại.'),
  ('universal-robots', 'ROBOT', 'C150', 'JOINT_LIMIT', 'high', 'Joint position out of safety/limit range', 'Jog joint về trong dải; xem lại waypoint & giới hạn khớp.'),
  ('universal-robots', 'ROBOT', 'C154', 'SINGULARITY', 'medium', 'Kinematic singularity near path', 'Điều chỉnh quỹ đạo tránh singularity; dùng MoveJ; chèn waypoint trung gian.'),
  ('universal-robots', 'ROBOT', 'C157', 'COLLISION', 'critical', 'Collision / protective stop (force/torque)', 'Dọn vật cản; kiểm tra va chạm; jog robot ra & reset sau khi kiểm tra an toàn.'),
  ('universal-robots', 'ROBOT', 'C191', 'SAFETY_FAULT', 'critical', 'Safety-rated fault (safeguard/protective)', 'Kiểm tra thiết bị bảo vệ (safeguard, light curtain); reset theo quy trình.'),
  ('universal-robots', 'ROBOT', 'C192', 'SAFETY_FAULT', 'critical', 'Safety-rated fault (safety plane/boundary)', 'Xem lại safety plane đã cấu hình; đưa TCP vào vùng an toàn; reset.'),
  ('universal-robots', 'ROBOT', 'C204', 'PATH_ERROR', 'medium', 'Path / trajectory error (unreachable or invalid)', 'Kiểm tra waypoint & vùng làm việc; sửa quỹ đạo không hợp lệ.'),
  ('universal-robots', 'ROBOT', 'C210', 'CONTROL_MODE_READONLY', 'medium', 'Controller in local/read-only mode — remote command rejected', 'Chuyển controller sang Remote Control để nhận lệnh; kiểm tra quyền điều khiển.')
ON CONFLICT ("vendor", "nativeCode") DO NOTHING;

-- ── fanuc (10 codes) ──────────────────────────────────────
INSERT INTO "alarm_taxonomy" ("vendor", "machineType", "nativeCode", "standardCode", "severity", "description", "recommendedAction") VALUES
  ('fanuc', 'ROBOT', 'SRVO-001', 'SAFETY_ESTOP', 'critical', 'Operator panel emergency stop', 'Giải trừ E-stop trên operator panel; reset controller sau khi kiểm tra an toàn.'),
  ('fanuc', 'ROBOT', 'SRVO-002', 'SAFETY_ESTOP', 'critical', 'Teach pendant emergency stop', 'Giải trừ E-stop trên teach pendant; reset controller.'),
  ('fanuc', 'ROBOT', 'SRVO-007', 'SAFETY_ESTOP', 'critical', 'External emergency stop', 'Kiểm tra chuỗi E-stop ngoài (hàng rào/cell); giải trừ; reset.'),
  ('fanuc', 'ROBOT', 'SRVO-050', 'COLLISION', 'critical', 'Collision detect alarm', 'Dọn vật cản; jog robot ra; reset sau kiểm tra an toàn; xem lại payload/tốc độ.'),
  ('fanuc', 'ROBOT', 'SRVO-062', 'ENCODER_FAULT', 'high', 'BZAL alarm (encoder backup battery zero)', 'Thay pin backup encoder; re-master trục bị mất vị trí.'),
  ('fanuc', 'ROBOT', 'SRVO-199', 'CONTROLLED_STOP', 'high', 'Controlled stop requested (DCS/safety controlled stop)', 'Xác định nguồn controlled stop; giải trừ điều kiện; reset.'),
  ('fanuc', 'ROBOT', 'SRVO-408', 'SAFETY_DCS', 'critical', 'DCS SSO ext emergency stop (safety I/O)', 'Kiểm tra tín hiệu safe I/O DCS SSO; giải trừ; reset theo quy trình DCS.'),
  ('fanuc', 'ROBOT', 'SRVO-409', 'SAFETY_DCS', 'critical', 'DCS SSO servo disconnect', 'Kiểm tra mạch ngắt servo DCS; xác minh cấu hình an toàn; reset.'),
  ('fanuc', 'ROBOT', 'MOTN-018', 'MOTION_UNREACHABLE', 'medium', 'Position not reachable', 'Kiểm tra vị trí đích trong tầm với; sửa điểm dạy/khung tọa độ.'),
  ('fanuc', 'ROBOT', 'INTP-224', 'PROGRAM_ERROR', 'medium', 'TP program interpret error (jump label / instruction)', 'Kiểm tra nhãn/lệnh trong chương trình TP; sửa logic chương trình.')
ON CONFLICT ("vendor", "nativeCode") DO NOTHING;

-- ── delta (23 codes) ──────────────────────────────────────
INSERT INTO "alarm_taxonomy" ("vendor", "machineType", "nativeCode", "standardCode", "severity", "description", "recommendedAction") VALUES
  ('delta', 'SERVO', 'AL001', 'SERVO_OVERCURRENT', 'critical', 'Overcurrent — output current exceeded limit', 'NGẮT nguồn; kiểm tra ngắn mạch U/V/W & cách điện motor; giảm tải; thay drive nếu hỏng.'),
  ('delta', 'SERVO', 'AL002', 'OVERVOLTAGE', 'high', 'Overvoltage — bus voltage too high', 'Kiểm tra nguồn & regen resistor; giảm tải quán tính/decel.'),
  ('delta', 'SERVO', 'AL003', 'SERVO_UNDERVOLTAGE', 'high', 'Undervoltage — main circuit voltage too low', 'Kiểm tra nguồn cấp/sụt áp; đo bus; reset sau khôi phục nguồn.'),
  ('delta', 'SERVO', 'AL004', 'CONFIG_MISMATCH', 'high', 'Motor combination / mismatch error', 'Đối chiếu model motor↔drive; sửa tham số; thay đúng motor.'),
  ('delta', 'SERVO', 'AL005', 'REGEN_FAULT', 'high', 'Regeneration error (regen resistor overload)', 'Giảm tần suất decel; kiểm tra/thêm regen resistor.'),
  ('delta', 'SERVO', 'AL006', 'OVERLOAD', 'high', 'Overload (thermal)', 'Giảm tải/chu kỳ; kiểm tra kẹt cơ khí & gain; đúng cỡ motor.'),
  ('delta', 'SERVO', 'AL007', 'OVERSPEED', 'high', 'Overspeed', 'Kiểm tra lệnh tốc độ & gain/overshoot; giảm tốc; tune lại.'),
  ('delta', 'SERVO', 'AL008', 'COMMAND_ERROR', 'medium', 'Abnormal pulse control command', 'Kiểm tra tần số/định dạng xung lệnh; sửa nguồn phát lệnh.'),
  ('delta', 'SERVO', 'AL009', 'POSITION_ERROR_EXCESS', 'high', 'Excessive position deviation', 'Kiểm tra kẹt cơ/tải; tăng gain/giới hạn lệnh; kiểm tra phanh & encoder.'),
  ('delta', 'SERVO', 'AL011', 'ENCODER_FAULT', 'high', 'Encoder error', 'Kiểm tra cáp encoder & connector; nối đất shield; thay cáp/encoder.'),
  ('delta', 'SERVO', 'AL013', 'SAFETY_ESTOP', 'critical', 'Emergency stop activated', 'Giải trừ E-stop; kiểm tra chuỗi an toàn; reset.'),
  ('delta', 'SERVO', 'AL014', 'LIMIT_SWITCH', 'medium', 'Reverse (CWL) limit switch triggered', 'Jog ra khỏi giới hạn; kiểm tra công tắc hành trình & hành trình cơ.'),
  ('delta', 'SERVO', 'AL015', 'LIMIT_SWITCH', 'medium', 'Forward (CCWL) limit switch triggered', 'Jog ra khỏi giới hạn; kiểm tra công tắc hành trình & hành trình cơ.'),
  ('delta', 'SERVO', 'AL016', 'OVERTEMP', 'high', 'IGBT overheat', 'Kiểm tra quạt/thông gió & tải; để nguội rồi reset.'),
  ('delta', 'SERVO', 'AL017', 'MEMORY_FAULT', 'high', 'Memory / absolute data error', 'Nạp lại tham số; thay pin absolute; thay drive nếu lặp lại.'),
  ('delta', 'SERVO', 'AL020', 'COMM_ERROR', 'high', 'Serial communication error', 'Kiểm tra cáp/nhiễu & thông số truyền thông; nối lại.'),
  ('delta', 'SERVO', 'AL022', 'POWER_FAULT', 'high', 'Main circuit power leak / phase loss', 'Kiểm tra pha nguồn vào & đấu nối; đo điện áp 3 pha.'),
  ('delta', 'SERVO', 'AL023', 'OVERLOAD_WARNING', 'diagnostic', '[AUTO-CLEAR] Early overload warning', 'Giảm tải/chu kỳ trước khi thành AL006.'),
  ('delta', 'SERVO', 'AL024', 'ENCODER_FAULT', 'high', 'Encoder initial magnetic field error', 'Kiểm tra đấu dây motor & encoder; chạy lại magnetic field detection.'),
  ('delta', 'SERVO', 'AL500', 'SAFETY_STO', 'critical', 'STO function activated (both channels)', 'Kiểm tra tín hiệu STO & mạch an toàn; giải trừ; reset theo quy trình.'),
  ('delta', 'SERVO', 'AL501', 'SAFETY_STO', 'critical', 'STO_A lost (channel A)', 'Kiểm tra kênh STO_A & đấu nối; xác minh redundancy; reset.'),
  ('delta', 'SERVO', 'AL502', 'SAFETY_STO', 'critical', 'STO_B lost (channel B)', 'Kiểm tra kênh STO_B & đấu nối; xác minh redundancy; reset.'),
  ('delta', 'SERVO', 'AL503', 'SAFETY_STO', 'critical', 'STO self-diagnosis error', 'Kiểm tra mạch STO; nếu lặp lại thay drive; reset theo quy trình an toàn.')
ON CONFLICT ("vendor", "nativeCode") DO NOTHING;

-- ── omron (7 codes) ──────────────────────────────────────
INSERT INTO "alarm_taxonomy" ("vendor", "machineType", "nativeCode", "standardCode", "severity", "description", "recommendedAction") VALUES
  ('omron', 'PLC', '16#0800', 'COMM_ERROR', 'high', 'FINS command error / response error', 'Kiểm tra đích FINS & định tuyến; xác minh node address; nối lại.'),
  ('omron', 'PLC', '16#0C08', 'COMM_ERROR', 'high', 'CRC / frame check error', 'Kiểm tra cáp/nhiễu truyền thông; nối đất shield; thay cáp.'),
  ('omron', 'PLC', '16#0C10', 'COMM_ERROR', 'high', 'Modbus exception response', 'Kiểm tra map thanh ghi & function code Modbus; xác minh slave.'),
  ('omron', 'PLC', '16#1C00', 'COMM_ERROR', 'high', 'CIP explicit message error', 'Kiểm tra đường dẫn CIP & class/instance; xác minh thiết bị EtherNet/IP.'),
  ('omron', 'PLC', '16#1C04', 'COMM_TIMEOUT', 'high', 'CIP request timeout', 'Kiểm tra kết nối/độ trễ mạng & tải target; tăng timeout hợp lý.'),
  ('omron', 'PLC', '16#2001', 'COMM_CONFIG', 'medium', 'TCP/UDP port already in use', 'Giải phóng/đổi port; kiểm tra socket khác đang chiếm; đóng kết nối cũ.'),
  ('omron', 'PLC', '16#2006', 'COMM_TIMEOUT', 'high', 'Socket service timeout', 'Kiểm tra peer & kết nối mạng; khôi phục socket; tăng timeout.')
ON CONFLICT ("vendor", "nativeCode") DO NOTHING;

-- ── zmotion (9 codes) ──────────────────────────────────────
INSERT INTO "alarm_taxonomy" ("vendor", "machineType", "nativeCode", "standardCode", "severity", "description", "recommendedAction") VALUES
  ('zmotion', 'MOTION', '212', 'STATE_ERROR', 'medium', 'Controller state error (invalid operation for current state)', 'Kiểm tra trạng thái controller trước lệnh; đưa về trạng thái hợp lệ.'),
  ('zmotion', 'MOTION', '213', 'FILE_ERROR', 'medium', 'File download error', 'Kiểm tra kết nối & dung lượng bộ nhớ; tải lại file chương trình.'),
  ('zmotion', 'MOTION', '217', 'UNSUPPORTED_OP', 'low', 'Unsupported command/operation', 'Kiểm tra lệnh có được model/firmware hỗ trợ; dùng lệnh thay thế.'),
  ('zmotion', 'MOTION', '260', 'HARDWARE_FAULT', 'high', 'Hardware fault', 'Cycle power; kiểm tra module phần cứng; thay controller nếu lặp lại.'),
  ('zmotion', 'MOTION', '265', 'HARDWARE_FAULT', 'high', 'RAM error', 'Cycle power; nếu lặp lại thay controller.'),
  ('zmotion', 'MOTION', '272', 'COMM_ERROR', 'high', 'Ethernet hardware error', 'Kiểm tra cổng/cáp Ethernet & PHY; thay cáp; kiểm tra phần cứng mạng.'),
  ('zmotion', 'MOTION', '285', 'CONFIG_MISMATCH', 'high', 'Firmware version mismatch', 'Cập nhật firmware khớp với công cụ/chương trình; đối chiếu phiên bản.'),
  ('zmotion', 'MOTION', '1009', 'MOTION_BUSY', 'low', 'Axis in motion — command rejected', 'Chờ trục dừng hoặc gọi CANCEL trước khi ra lệnh mới.'),
  ('zmotion', 'MOTION', '1013', 'UNSUPPORTED_OP', 'low', 'ATYPE not supported for this axis', 'Đặt ATYPE hợp lệ cho loại trục; kiểm tra khả năng phần cứng trục.')
ON CONFLICT ("vendor", "nativeCode") DO NOTHING;
