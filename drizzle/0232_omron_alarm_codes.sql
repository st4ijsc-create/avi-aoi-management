-- ============================================================================
-- Migration 0232: Omron NJ/NX Controller EVENT CODES (8-hex) — alarm taxonomy
--
-- Extends the 7 Omron rows seeded in 0231 (which are 4-hex FINS/CIP RESPONSE
-- codes, e.g. "16#0800") with 44 REAL 8-hex CONTROLLER EVENT CODES extracted
-- from the NJ/NX-series Troubleshooting Manual (W503), section 3 "Error
-- Descriptions and Corrections". nativeCode uses Sysmac Studio's "16#XXXXXXXX"
-- 8-hex display form → NO collision with the 4-hex codes from 0231.
--
-- SEVERITY (ISA-18.2 band ← W503 "Error attributes → Level"):
--   Major fault → critical | Partial fault → high | Minor fault → medium | Observation → low
--
-- standardCode groups: HW_FAULT / CONFIG_ERROR / COMM_ERROR / COMM_TIMEOUT /
--   CIP_ERROR / MOTION_FAULT (rationalized to the platform taxonomy).
--
-- SOURCE: W503 (NJ/NX Troubleshooting Manual). Page refs in each description.
--   Ports/route verified against W506 (built-in EtherNet/IP port = 44818).
--
-- ADDITIVE + IDEMPOTENT: INSERT ... ON CONFLICT ("vendor","nativeCode") DO NOTHING
--   against uq_alarmtax_vendor_native (schema drizzle/schema/equipmentStandards.ts).
--   Re-runnable; no DDL, no flag. Mirrors OMRON_NJNX_EVENTS in
--   server/services/standards/alarmTaxonomyVendorSeed.ts so mapAlarm() & DB agree.
--   Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- ============================================================================

-- ── omron NJ/NX 8-hex event codes (44 codes) ─────────────────────────────────
INSERT INTO "alarm_taxonomy" ("vendor", "machineType", "nativeCode", "standardCode", "severity", "description", "recommendedAction") VALUES
  -- Controller / hardware — PLC Function Module (Major fault → critical)
  ('omron', 'PLC', '16#000E0000', 'HW_FAULT', 'critical', 'Non-volatile Memory Life Exceeded (W503 p.3-96)', 'Thay CPU Unit; lưu/khôi phục project trước khi thay.'),
  ('omron', 'PLC', '16#00110000', 'HW_FAULT', 'critical', 'CPU Unit Overheat — Operation Stopped (W503 p.3-97)', 'Kiểm tra quạt/thông gió tủ & nhiệt độ môi trường; để CPU nguội; cycle nguồn.'),
  ('omron', 'PLC', '16#00130000', 'HW_FAULT', 'critical', 'Main Memory Check Error (W503 p.3-98)', 'Cycle nguồn; nếu lặp lại thay CPU Unit; kiểm tra nhiễu.'),
  ('omron', 'PLC', '16#04010000', 'HW_FAULT', 'critical', 'I/O Bus Check Error (W503 p.3-120)', 'Kiểm tra/cắm lại I/O Connecting Cable & connector; chống nhiễu; thay Unit lỗi.'),
  ('omron', 'PLC', '16#60030000', 'HW_FAULT', 'critical', 'I/O Refreshing Timeout Error (W503 p.3-134)', 'Kiểm tra tải chu kỳ & cấu hình I/O; giảm task load; cycle nguồn.'),
  ('omron', 'PLC', '16#40160000', 'HW_FAULT', 'critical', 'Safe Mode (W503 p.3-151)', 'Kiểm tra nguyên nhân lỗi hệ thống trong log; sửa cấu hình/chương trình; cycle nguồn.'),
  -- Configuration — PLC Function Module (Major fault → critical)
  ('omron', 'PLC', '16#24010000', 'CONFIG_ERROR', 'critical', 'Unsupported Unit Detected (W503 p.3-121)', 'Gỡ Unit/PSU không hỗ trợ; thay bằng model được CPU hỗ trợ.'),
  ('omron', 'PLC', '16#24050000', 'CONFIG_ERROR', 'critical', 'Duplicate Unit Number (W503 p.3-123)', 'Đặt lại unit number duy nhất cho từng Special I/O / CPU Bus Unit.'),
  ('omron', 'PLC', '16#34010000', 'CONFIG_ERROR', 'critical', 'I/O Setting Check Error (W503 p.3-124)', 'Đối chiếu cấu hình I/O trong Sysmac Studio với phần cứng thực; nạp lại.'),
  ('omron', 'PLC', '16#10250000', 'CONFIG_ERROR', 'critical', 'Illegal User Program/Controller Configurations Mismatch (W503 p.3-141)', 'Truyền lại (download) chương trình & cấu hình từ Sysmac Studio; đối chiếu phiên bản.'),
  -- EtherCAT Master Function Module
  ('omron', 'PLC', '16#24200000', 'CONFIG_ERROR', 'medium', 'EtherCAT Slave Node Address Duplicated (W503 p.3-742)', 'Đặt node address duy nhất cho từng slave EtherCAT; đối chiếu ESI/cấu hình.'),
  ('omron', 'PLC', '16#34400000', 'CONFIG_ERROR', 'medium', 'EtherCAT Network Configuration Information Error (W503 p.3-743)', 'So khớp cấu hình mạng EtherCAT với slave thực; nạp lại network config.'),
  ('omron', 'PLC', '16#34410000', 'COMM_ERROR', 'medium', 'EtherCAT Communications Cycle Exceeded (W503 p.3-744)', 'Tăng chu kỳ PDO/giảm tải; kiểm tra số slave & băng thông; tối ưu task.'),
  ('omron', 'PLC', '16#34420000', 'CONFIG_ERROR', 'high', 'EtherCAT Parameters Not Transferred (W503 p.3-735)', 'Truyền lại tham số slave; kiểm tra kết nối khi khởi động; cycle nguồn.'),
  ('omron', 'PLC', '16#84210000', 'CONFIG_ERROR', 'medium', 'EtherCAT Network Configuration Error (W503 p.3-745)', 'Kiểm tra & sửa cấu hình mạng EtherCAT khớp với slave đang nối.'),
  ('omron', 'PLC', '16#84280000', 'COMM_ERROR', 'medium', 'EtherCAT Slave Application Error (W503 p.3-752)', 'Đọc mã lỗi ứng dụng của slave; xử lý theo manual slave; reset lỗi.'),
  ('omron', 'PLC', '16#84290000', 'COMM_ERROR', 'medium', 'EtherCAT Process Data Transmission Error (W503 p.3-753)', 'Kiểm tra cáp/nhiễu & topo EtherCAT; nối đất shield; thay cáp.'),
  ('omron', 'PLC', '16#842B0000', 'COMM_TIMEOUT', 'medium', 'EtherCAT Process Data Reception Timeout (W503 p.3-754)', 'Kiểm tra slave mất kết nối/nguồn & cáp; kiểm tra chu kỳ giao tiếp.'),
  ('omron', 'PLC', '16#842C0000', 'COMM_ERROR', 'medium', 'EtherCAT Process Data Communications Error (W503 p.3-756)', 'Kiểm tra cáp/nhiễu & slave; nối đất shield; thay cáp/slave nếu lặp lại.'),
  ('omron', 'PLC', '16#842E0000', 'COMM_ERROR', 'high', 'EtherCAT Frame Not Received (W503 p.3-738)', 'Kiểm tra đứt cáp/mất nguồn slave đầu chuỗi; đo link; thay cáp.'),
  ('omron', 'PLC', '16#84310002', 'COMM_ERROR', 'medium', 'EtherCAT Illegal Slave Disconnection Detected (W503 p.3-764)', 'Kiểm tra slave bị rớt/mất nguồn & cáp; nối lại đúng topo; reset.'),
  ('omron', 'PLC', '16#84390000', 'COMM_ERROR', 'low', 'EtherCAT Ring Disconnection Detected (W503 p.3-793)', 'Kiểm tra cáp vòng ring redundancy; nối lại đường dự phòng.'),
  -- EtherNet/IP Function Module (CIP tag data link)
  ('omron', 'PLC', '16#34290000', 'CONFIG_ERROR', 'medium', 'EtherNet/IP IP Address Setting Error (W503 p.3-685)', 'Sửa IP/subnet trong Sysmac Studio; tránh trùng dải; nạp lại.'),
  ('omron', 'PLC', '16#342A0000', 'CONFIG_ERROR', 'medium', 'EtherNet/IP DNS Setting Error (W503 p.3-686)', 'Kiểm tra địa chỉ DNS server cấu hình; sửa hoặc tắt DNS nếu không dùng.'),
  ('omron', 'PLC', '16#840A0000', 'CONFIG_ERROR', 'medium', 'EtherNet/IP IP Address Duplication Error (W503 p.3-697)', 'Tìm & sửa thiết bị trùng IP trong mạng; đặt IP duy nhất.'),
  ('omron', 'PLC', '16#84030000', 'COMM_ERROR', 'medium', 'EtherNet/IP DNS Server Connection Error (W503 p.3-689)', 'Kiểm tra kết nối tới DNS server & định tuyến; xác minh địa chỉ.'),
  ('omron', 'PLC', '16#840B0000', 'COMM_ERROR', 'medium', 'EtherNet/IP BOOTP Server Connection Error (W503 p.3-698)', 'Kiểm tra BOOTP server & mạng; hoặc đặt IP tĩnh nếu không dùng BOOTP.'),
  ('omron', 'PLC', '16#84060000', 'COMM_ERROR', 'low', 'EtherNet/IP Link OFF Detected (W503 p.3-703)', 'Kiểm tra cáp/switch & cổng built-in EtherNet/IP; đo link; thay cáp.'),
  ('omron', 'PLC', '16#84080000', 'CIP_ERROR', 'medium', 'EtherNet/IP Tag Data Link Timeout (W503 p.3-693)', 'Kiểm tra target CIP connection & tải mạng; tăng RPI/timeout; xác minh tag.'),
  ('omron', 'PLC', '16#84090000', 'CIP_ERROR', 'medium', 'EtherNet/IP Tag Data Link Connection Timeout (W503 p.3-694)', 'Kiểm tra target sẵn sàng & route CIP; xác minh tag list & Network Publish.'),
  -- CIP / serial / socket comms — PLC Function Module (Observation → low)
  ('omron', 'PLC', '16#54011C06', 'CIP_ERROR', 'low', 'CIP Communications Data Size Exceeded (W503 p.3-284)', 'Giảm kích thước dữ liệu CIP mỗi request; chia nhỏ; kiểm tra class/instance.'),
  ('omron', 'PLC', '16#54010C08', 'COMM_ERROR', 'low', 'Serial CRC Mismatch (W503 p.3-254)', 'Kiểm tra cáp/nhiễu serial & thông số truyền; nối đất shield.'),
  ('omron', 'PLC', '16#54010C0B', 'COMM_TIMEOUT', 'low', 'Serial Communications Timeout (W503 p.3-255)', 'Kiểm tra thiết bị đầu kia & cáp; xác minh baud/parity; tăng timeout.'),
  ('omron', 'PLC', '16#54010C10', 'COMM_ERROR', 'low', 'Exceptional Modbus Response (W503 p.3-257)', 'Kiểm tra function code & map thanh ghi Modbus; xác minh slave.'),
  ('omron', 'PLC', '16#54012406', 'COMM_ERROR', 'low', 'FTP Server Connection Error (W503 p.3-299)', 'Kiểm tra FTP server đích & thông tin đăng nhập/route; nối lại.'),
  ('omron', 'PLC', '16#80110000', 'COMM_ERROR', 'low', 'Packet Discarded (W503 p.3-227)', 'Kiểm tra tải mạng/nghẽn & bộ đệm; giảm lưu lượng; kiểm tra switch.'),
  -- Motion Control Function Module
  ('omron', 'PLC', '16#644C0000', 'MOTION_FAULT', 'low', 'Following Error Warning (W503 p.3-549)', 'Theo dõi sai lệch bám; kiểm tra gain/tải trước khi thành lỗi following-error limit.'),
  ('omron', 'PLC', '16#64480000', 'MOTION_FAULT', 'medium', 'Following Error Limit Exceeded (W503 p.3-527)', 'Kiểm tra kẹt cơ/tải & gain; tăng giới hạn hợp lý; kiểm tra encoder & phanh; error reset.'),
  ('omron', 'PLC', '16#64470000', 'MOTION_FAULT', 'medium', 'In-position Check Time Exceeded (W503 p.3-526)', 'Kiểm tra gain/settling & dải in-position; tăng thời gian/nới dải; error reset.'),
  ('omron', 'PLC', '16#64410000', 'MOTION_FAULT', 'medium', 'Target Position Negative Software Limit Exceeded (W503 p.3-645)', 'Kiểm tra lệnh vị trí đích trong dải software limit; sửa quỹ đạo; error reset.'),
  ('omron', 'PLC', '16#644B0000', 'MOTION_FAULT', 'medium', 'Negative Limit Input Detected (W503 p.3-530)', 'Jog trục ra khỏi giới hạn; kiểm tra công tắc hành trình & hành trình cơ; error reset.'),
  ('omron', 'PLC', '16#64570000', 'MOTION_FAULT', 'medium', 'Servo OFF Error (W503 p.3-531)', 'Kiểm tra điều kiện servo-off khi đang chạy; bật servo & reset; kiểm tra chuỗi enable.'),
  ('omron', 'PLC', '16#74210000', 'MOTION_FAULT', 'medium', 'Servo Main Circuit Power OFF (W503 p.3-533)', 'Bật nguồn mạch chính servo drive trước khi servo-on; kiểm tra đấu nối nguồn.'),
  ('omron', 'PLC', '16#74250000', 'MOTION_FAULT', 'medium', 'Homing Direction Limit Input Detected (W503 p.3-535)', 'Kiểm tra hướng home & vị trí công tắc limit; sửa tham số homing; chạy lại home.')
ON CONFLICT ("vendor", "nativeCode") DO NOTHING;
