/**
 * Đợt-B2 (doc 37 §6.4) — REAL vendor alarm-code dataset for the ISA-18.2 taxonomy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * This file is the CANONICAL in-memory source of the ~150 REAL native alarm
 * codes extracted from vendor manuals (Mitsubishi MR-J4, Universal Robots, Fanuc,
 * Delta ASDA, Omron NJ/NX, Zmotion). alarmTaxonomy.ts spreads VENDOR_ALARM_MAPPINGS
 * into SEED_ALARM_MAPPINGS so mapAlarm() resolves them offline (pure, no DB), and
 * migration 0231 mirrors the SAME rows into the `alarm_taxonomy` table (static DML,
 * ON CONFLICT DO NOTHING) so the DB-backed router serves them too.
 *
 * SEVERITY — ISA-18.2 priority bands as modelled in this codebase:
 *   critical | high | medium | low | diagnostic
 *   The task's "warning" band == "diagnostic" here (asSeverity() narrows anything
 *   else to "medium", so warnings MUST use "diagnostic" to survive round-tripping).
 *
 * AUTO-CLEAR — the `alarm_taxonomy` table has no boolean column for it, so
 * auto-clearable (self-resetting) warnings are marked with a leading "[AUTO-CLEAR]"
 * token in `description`. All diagnostic-band vendor warnings below are auto-clear.
 *
 * SAFETY / PURE: DESCRIPTIVE metadata only — opens no control path.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { AlarmMapping } from "./alarmTaxonomy";

const AC = "[AUTO-CLEAR] "; // prefix marking an auto-clearable warning in description

// ════════════════════════════════════════════════════════════════════════════
// Mitsubishi MELSERVO MR-J4 — servo amplifier alarms (AL._ _ hex codes).
// vendor='mitsubishi', machineType='SERVO'. Faults latch; 90-9F / E0-F3 are
// self-clearing WARNINGS (diagnostic band).
// ════════════════════════════════════════════════════════════════════════════
const MITSUBISHI_MRJ4: AlarmMapping[] = [
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "10", standardCode: "SERVO_UNDERVOLTAGE", severity: "high", description: "Undervoltage — bus voltage dropped below threshold", recommendedAction: "Kiểm tra nguồn cấp / sụt áp; đo bus DC; reset sau khi phục hồi nguồn." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "12", standardCode: "MEMORY_FAULT", severity: "high", description: "Memory error 1 (RAM)", recommendedAction: "Cycle power; nếu lặp lại thay amplifier." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "13", standardCode: "CLOCK_FAULT", severity: "high", description: "Clock error", recommendedAction: "Cycle power; kiểm tra firmware; thay amplifier nếu lặp lại." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "15", standardCode: "MEMORY_FAULT", severity: "high", description: "Memory error 2 (EEPROM)", recommendedAction: "Re-write parameters; thay amplifier nếu lặp lại." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "16", standardCode: "ENCODER_FAULT", severity: "high", description: "Encoder initial communication error 1", recommendedAction: "Kiểm tra cáp encoder & connector; đo shield; thay cáp/encoder." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "17", standardCode: "BOARD_FAULT", severity: "high", description: "Board error (CPU/board self-check)", recommendedAction: "Cycle power; thay amplifier nếu lặp lại." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "1A", standardCode: "CONFIG_MISMATCH", severity: "high", description: "Servo motor combination error", recommendedAction: "Đối chiếu model motor↔amplifier; sửa tham số; thay đúng motor." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "1E", standardCode: "ENCODER_FAULT", severity: "high", description: "Encoder initial communication error 2", recommendedAction: "Kiểm tra cáp encoder & connector; thay cáp/encoder." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "1F", standardCode: "ENCODER_FAULT", severity: "high", description: "Encoder initial communication error 3", recommendedAction: "Kiểm tra cáp encoder & connector; thay cáp/encoder." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "20", standardCode: "ENCODER_FAULT", severity: "high", description: "Encoder normal communication error 1", recommendedAction: "Kiểm tra nhiễu/cáp encoder; nối đất shield; thay cáp." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "21", standardCode: "ENCODER_FAULT", severity: "high", description: "Encoder normal communication error 2", recommendedAction: "Kiểm tra nhiễu/cáp encoder; nối đất shield; thay cáp." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "24", standardCode: "GROUND_FAULT", severity: "critical", description: "Main circuit error (ground fault at output)", recommendedAction: "NGẮT nguồn; đo cách điện motor & cáp U/V/W xuống đất; sửa chạm đất trước khi cấp lại." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "25", standardCode: "POSITION_LOST", severity: "high", description: "Absolute position erased", recommendedAction: "Thay pin backup encoder; thực hiện lại home/absolute setup." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "27", standardCode: "ENCODER_FAULT", severity: "high", description: "Initial magnetic pole detection error", recommendedAction: "Kiểm tra đấu dây motor & encoder; chạy lại magnetic pole detection." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "30", standardCode: "REGEN_FAULT", severity: "high", description: "Regenerative error (regen resistor overload)", recommendedAction: "Giảm tần suất decel; kiểm tra/ thêm regen resistor; kiểm tra đấu nối P-C." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "31", standardCode: "OVERSPEED", severity: "high", description: "Overspeed — motor exceeded speed limit", recommendedAction: "Kiểm tra gain/overshoot & lệnh tốc độ; giảm tốc; tune lại." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "32", standardCode: "SERVO_OVERCURRENT", severity: "critical", description: "Overcurrent — output stage overcurrent", recommendedAction: "NGẮT nguồn; kiểm tra ngắn mạch U/V/W & cách điện motor; giảm tải; thay IGBT/amplifier nếu hỏng." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "33", standardCode: "OVERVOLTAGE", severity: "high", description: "Overvoltage — bus voltage too high", recommendedAction: "Kiểm tra regen resistor & nguồn; giảm tải quán tính/decel." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "34", standardCode: "COMM_ERROR", severity: "high", description: "SSCNET/CRC receive error", recommendedAction: "Kiểm tra cáp SSCNET/ quang; nối lại; thay cáp." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "35", standardCode: "COMMAND_ERROR", severity: "medium", description: "Command frequency error", recommendedAction: "Kiểm tra tần số xung lệnh trong dải cho phép; sửa nguồn phát lệnh." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "37", standardCode: "PARAM_ERROR", severity: "medium", description: "Parameter error", recommendedAction: "Đối chiếu tham số ngoài dải; nạp lại tham số hợp lệ." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "3A", standardCode: "INRUSH_FAULT", severity: "high", description: "Inrush current suppression circuit error", recommendedAction: "Kiểm tra tần suất bật/tắt nguồn; để amplifier nguội; thay nếu lặp lại." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "45", standardCode: "OVERTEMP", severity: "high", description: "Main circuit device overheat", recommendedAction: "Kiểm tra quạt & thông gió tủ; giảm tải; để nguội rồi reset." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "46", standardCode: "MOTOR_OVERHEAT", severity: "high", description: "Servo motor overheat", recommendedAction: "Kiểm tra tải/chu kỳ làm việc & làm mát motor; để nguội rồi reset." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "47", standardCode: "COOLING_FAULT", severity: "high", description: "Cooling fan error/stop", recommendedAction: "Kiểm tra/thay quạt làm mát amplifier." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "50", standardCode: "OVERLOAD", severity: "high", description: "Overload 1 (thermal, continuous)", recommendedAction: "Giảm tải/chu kỳ; kiểm tra kẹt cơ khí & gain; đúng cỡ motor." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "51", standardCode: "OVERLOAD", severity: "high", description: "Overload 2 (max torque held)", recommendedAction: "Kiểm tra kẹt cơ khí/va chạm; giảm tải; kiểm tra phanh." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "52", standardCode: "POSITION_ERROR_EXCESS", severity: "high", description: "Error excessive (following error too large)", recommendedAction: "Kiểm tra kẹt cơ/tải; tăng gain/giới hạn lệnh; kiểm tra phanh & encoder." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "54", standardCode: "OSCILLATION", severity: "medium", description: "Oscillation detection", recommendedAction: "Giảm gain / bật filter; tune lại vòng điều khiển." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "56", standardCode: "SAFETY_ESTOP", severity: "high", description: "Forced stop error (forced-stop asserted while running)", recommendedAction: "Giải trừ forced stop; kiểm tra chuỗi an toàn; reset." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "63", standardCode: "SAFETY_STO", severity: "critical", description: "STO timing error (functional safety)", recommendedAction: "Kiểm tra đấu nối/timing tín hiệu STO; kiểm tra mạch an toàn; reset theo quy trình." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "64", standardCode: "SAFETY_STO", severity: "critical", description: "Functional safety unit / STO fault", recommendedAction: "Kiểm tra module/đấu nối functional-safety & STO; reset theo quy trình an toàn." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "66", standardCode: "ENCODER_FAULT", severity: "high", description: "Encoder communication error (functional safety)", recommendedAction: "Kiểm tra cáp encoder an toàn; thay cáp/encoder." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "88", standardCode: "WATCHDOG_FAULT", severity: "critical", description: "Watchdog — internal CPU watchdog tripped", recommendedAction: "Cycle power; cập nhật firmware; thay amplifier nếu lặp lại." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "8A", standardCode: "COMM_TIMEOUT", severity: "high", description: "Serial/USB communication timeout", recommendedAction: "Kiểm tra cáp & master truyền thông; khôi phục kết nối; kiểm tra chu kỳ giao tiếp." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "8D", standardCode: "COMM_ERROR", severity: "high", description: "CC-Link IE Field communication error", recommendedAction: "Kiểm tra mạng CC-Link IE & node; nối lại; thay cáp." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "8E", standardCode: "COMM_ERROR", severity: "high", description: "Serial communication error", recommendedAction: "Kiểm tra cáp/nhiễu truyền thông; nối đất shield; thay cáp." },
  // ── WARNINGS (auto-clear, diagnostic band) ──
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "91", standardCode: "OVERTEMP_WARNING", severity: "diagnostic", description: AC + "Servo amplifier overheat warning", recommendedAction: "Kiểm tra thông gió tủ & tải trước khi thành lỗi 45." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "92", standardCode: "BATTERY_WARNING", severity: "diagnostic", description: AC + "Battery cable disconnection warning", recommendedAction: "Kiểm tra/nối lại cáp pin encoder; thay pin để tránh mất absolute." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "95", standardCode: "SAFETY_STO_WARNING", severity: "diagnostic", description: AC + "STO warning", recommendedAction: "Kiểm tra trạng thái tín hiệu STO." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "96", standardCode: "HOMING_WARNING", severity: "diagnostic", description: AC + "Home position setting warning", recommendedAction: "Thực hiện lại home position setting." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "9F", standardCode: "BATTERY_WARNING", severity: "diagnostic", description: AC + "Battery warning (low voltage)", recommendedAction: "Thay pin backup encoder sớm để giữ vị trí absolute." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "E0", standardCode: "REGEN_WARNING", severity: "diagnostic", description: AC + "Excessive regeneration warning", recommendedAction: "Giảm tần suất decel; kiểm tra regen resistor trước khi thành lỗi 30." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "E1", standardCode: "OVERLOAD_WARNING", severity: "diagnostic", description: AC + "Overload warning 1", recommendedAction: "Giảm tải/chu kỳ; kiểm tra kẹt cơ trước khi thành lỗi 50." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "E2", standardCode: "OVERTEMP_WARNING", severity: "diagnostic", description: AC + "Servo motor overheat warning", recommendedAction: "Giảm tải & kiểm tra làm mát motor." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "E3", standardCode: "ENCODER_WARNING", severity: "diagnostic", description: AC + "Absolute position counter warning", recommendedAction: "Kiểm tra tốc độ khi mất điện; xác nhận lại absolute nếu cần." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "E6", standardCode: "SAFETY_ESTOP_WARNING", severity: "diagnostic", description: AC + "Servo forced stop warning (EM2/EM1)", recommendedAction: "Giải trừ forced stop; kiểm tra chuỗi an toàn." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "E7", standardCode: "SAFETY_ESTOP_WARNING", severity: "diagnostic", description: AC + "Controller forced stop warning", recommendedAction: "Giải trừ forced stop từ controller." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "E8", standardCode: "COOLING_WARNING", severity: "diagnostic", description: AC + "Cooling fan speed reduction warning", recommendedAction: "Vệ sinh/thay quạt làm mát sắp tới." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "E9", standardCode: "POWER_WARNING", severity: "diagnostic", description: AC + "Main circuit off warning (servo-on with main power off)", recommendedAction: "Bật nguồn mạch chính trước khi servo-on." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "EC", standardCode: "OVERLOAD_WARNING", severity: "diagnostic", description: AC + "Overload warning 2", recommendedAction: "Giảm tải đỉnh/chu kỳ vận hành." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "ED", standardCode: "OVERLOAD_WARNING", severity: "diagnostic", description: AC + "Output watt excess warning", recommendedAction: "Giảm công suất/chu kỳ vận hành." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "F0", standardCode: "DIAGNOSTIC_WARNING", severity: "diagnostic", description: AC + "Tough drive warning (auto-recovery active)", recommendedAction: "Theo dõi; xử lý nguyên nhân gốc (nhiễu/instant power failure)." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "F2", standardCode: "DIAGNOSTIC_WARNING", severity: "diagnostic", description: AC + "Drive recorder area writing time-out warning", recommendedAction: "Theo dõi; kiểm tra bộ nhớ drive recorder." },
  { vendor: "mitsubishi", machineType: "SERVO", nativeCode: "F3", standardCode: "OSCILLATION", severity: "diagnostic", description: AC + "Oscillation detection warning", recommendedAction: "Giảm gain/bật filter trước khi thành rung nặng." },
];

// ════════════════════════════════════════════════════════════════════════════
// Universal Robots (CB/e-Series) — controller fault codes (C-codes).
// vendor='universal-robots', machineType='ROBOT'. Safety-rated stops = critical.
// NOTE: distinct vendor key from the illustrative 'universal_robots' seed rows.
// ════════════════════════════════════════════════════════════════════════════
const UNIVERSAL_ROBOTS: AlarmMapping[] = [
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C3", standardCode: "COMM_ERROR", severity: "high", description: "Controller ↔ safety/joint communication error", recommendedAction: "Kiểm tra cáp nội bộ & nguồn; khởi động lại controller." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C4", standardCode: "COMM_ERROR", severity: "high", description: "Communication error (bus/packet)", recommendedAction: "Kiểm tra kết nối/nhiễu; khởi động lại; cập nhật firmware." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C10", standardCode: "COMM_TIMEOUT", severity: "high", description: "Communication timeout (no response from module)", recommendedAction: "Kiểm tra cáp & nguồn joint/safety board; khởi động lại." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C17", standardCode: "SAFETY_FAULT", severity: "critical", description: "Safety system fault", recommendedAction: "Kiểm tra cấu hình an toàn & I/O an toàn; xử lý theo quy trình rồi khởi động lại." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C50", standardCode: "POWER_FAULT", severity: "high", description: "Power supply fault (48V/robot power)", recommendedAction: "Kiểm tra nguồn 48V & cầu chì; đo điện áp; thay PSU nếu lỗi." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C55", standardCode: "SAFETY_FAULT", severity: "critical", description: "Safety-rated fault (safety processor)", recommendedAction: "Ghi log; kiểm tra safety control board; liên hệ hỗ trợ nếu lặp lại." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C56", standardCode: "SAFETY_FAULT", severity: "critical", description: "Safety-rated fault (redundancy mismatch)", recommendedAction: "Kiểm tra chuỗi an toàn kép; xử lý theo quy trình; khởi động lại." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C57", standardCode: "POWER_FAULT", severity: "high", description: "Power/energy monitoring fault", recommendedAction: "Kiểm tra nguồn & tải; đo điện áp; thay PSU nếu cần." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C59", standardCode: "SAFETY_FAULT", severity: "critical", description: "Safety-rated fault (safety I/O)", recommendedAction: "Kiểm tra đấu nối safety I/O & cấu hình; xử lý rồi khởi động lại." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C62", standardCode: "POWER_FAULT", severity: "high", description: "Power stage fault (joint drive power)", recommendedAction: "Kiểm tra nguồn joint & cáp; khởi động lại; thay joint nếu lặp lại." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C77", standardCode: "SAFETY_FAULT", severity: "critical", description: "Safety-rated fault (safety limit violation)", recommendedAction: "Xem lại giới hạn an toàn đã cấu hình; xử lý theo quy trình rồi khởi động lại." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C150", standardCode: "JOINT_LIMIT", severity: "high", description: "Joint position out of safety/limit range", recommendedAction: "Jog joint về trong dải; xem lại waypoint & giới hạn khớp." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C154", standardCode: "SINGULARITY", severity: "medium", description: "Kinematic singularity near path", recommendedAction: "Điều chỉnh quỹ đạo tránh singularity; dùng MoveJ; chèn waypoint trung gian." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C157", standardCode: "COLLISION", severity: "critical", description: "Collision / protective stop (force/torque)", recommendedAction: "Dọn vật cản; kiểm tra va chạm; jog robot ra & reset sau khi kiểm tra an toàn." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C191", standardCode: "SAFETY_FAULT", severity: "critical", description: "Safety-rated fault (safeguard/protective)", recommendedAction: "Kiểm tra thiết bị bảo vệ (safeguard, light curtain); reset theo quy trình." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C192", standardCode: "SAFETY_FAULT", severity: "critical", description: "Safety-rated fault (safety plane/boundary)", recommendedAction: "Xem lại safety plane đã cấu hình; đưa TCP vào vùng an toàn; reset." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C204", standardCode: "PATH_ERROR", severity: "medium", description: "Path / trajectory error (unreachable or invalid)", recommendedAction: "Kiểm tra waypoint & vùng làm việc; sửa quỹ đạo không hợp lệ." },
  { vendor: "universal-robots", machineType: "ROBOT", nativeCode: "C210", standardCode: "CONTROL_MODE_READONLY", severity: "medium", description: "Controller in local/read-only mode — remote command rejected", recommendedAction: "Chuyển controller sang Remote Control để nhận lệnh; kiểm tra quyền điều khiển." },
];

// ════════════════════════════════════════════════════════════════════════════
// Fanuc robot controllers (R-30iB) — SRVO / MOTN / INTP alarm codes.
// vendor='fanuc', machineType='ROBOT'. Native codes stored in the human
// "FACILITY-code" form (facility×1000+code is the numeric encoding).
// ════════════════════════════════════════════════════════════════════════════
const FANUC: AlarmMapping[] = [
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-001", standardCode: "SAFETY_ESTOP", severity: "critical", description: "Operator panel emergency stop", recommendedAction: "Giải trừ E-stop trên operator panel; reset controller sau khi kiểm tra an toàn." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-002", standardCode: "SAFETY_ESTOP", severity: "critical", description: "Teach pendant emergency stop", recommendedAction: "Giải trừ E-stop trên teach pendant; reset controller." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-007", standardCode: "SAFETY_ESTOP", severity: "critical", description: "External emergency stop", recommendedAction: "Kiểm tra chuỗi E-stop ngoài (hàng rào/cell); giải trừ; reset." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-050", standardCode: "COLLISION", severity: "critical", description: "Collision detect alarm", recommendedAction: "Dọn vật cản; jog robot ra; reset sau kiểm tra an toàn; xem lại payload/tốc độ." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-062", standardCode: "ENCODER_FAULT", severity: "high", description: "BZAL alarm (encoder backup battery zero)", recommendedAction: "Thay pin backup encoder; re-master trục bị mất vị trí." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-199", standardCode: "CONTROLLED_STOP", severity: "high", description: "Controlled stop requested (DCS/safety controlled stop)", recommendedAction: "Xác định nguồn controlled stop; giải trừ điều kiện; reset." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-408", standardCode: "SAFETY_DCS", severity: "critical", description: "DCS SSO ext emergency stop (safety I/O)", recommendedAction: "Kiểm tra tín hiệu safe I/O DCS SSO; giải trừ; reset theo quy trình DCS." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "SRVO-409", standardCode: "SAFETY_DCS", severity: "critical", description: "DCS SSO servo disconnect", recommendedAction: "Kiểm tra mạch ngắt servo DCS; xác minh cấu hình an toàn; reset." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "MOTN-018", standardCode: "MOTION_UNREACHABLE", severity: "medium", description: "Position not reachable", recommendedAction: "Kiểm tra vị trí đích trong tầm với; sửa điểm dạy/khung tọa độ." },
  { vendor: "fanuc", machineType: "ROBOT", nativeCode: "INTP-224", standardCode: "PROGRAM_ERROR", severity: "medium", description: "TP program interpret error (jump label / instruction)", recommendedAction: "Kiểm tra nhãn/lệnh trong chương trình TP; sửa logic chương trình." },
];

// ════════════════════════════════════════════════════════════════════════════
// Delta ASDA-A2/A3 — servo drive alarms (AL0xx / AL5xx STO).
// vendor='delta', machineType='SERVO'.
// ════════════════════════════════════════════════════════════════════════════
const DELTA_ASDA: AlarmMapping[] = [
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL001", standardCode: "SERVO_OVERCURRENT", severity: "critical", description: "Overcurrent — output current exceeded limit", recommendedAction: "NGẮT nguồn; kiểm tra ngắn mạch U/V/W & cách điện motor; giảm tải; thay drive nếu hỏng." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL002", standardCode: "OVERVOLTAGE", severity: "high", description: "Overvoltage — bus voltage too high", recommendedAction: "Kiểm tra nguồn & regen resistor; giảm tải quán tính/decel." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL003", standardCode: "SERVO_UNDERVOLTAGE", severity: "high", description: "Undervoltage — main circuit voltage too low", recommendedAction: "Kiểm tra nguồn cấp/sụt áp; đo bus; reset sau khôi phục nguồn." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL004", standardCode: "CONFIG_MISMATCH", severity: "high", description: "Motor combination / mismatch error", recommendedAction: "Đối chiếu model motor↔drive; sửa tham số; thay đúng motor." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL005", standardCode: "REGEN_FAULT", severity: "high", description: "Regeneration error (regen resistor overload)", recommendedAction: "Giảm tần suất decel; kiểm tra/thêm regen resistor." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL006", standardCode: "OVERLOAD", severity: "high", description: "Overload (thermal)", recommendedAction: "Giảm tải/chu kỳ; kiểm tra kẹt cơ khí & gain; đúng cỡ motor." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL007", standardCode: "OVERSPEED", severity: "high", description: "Overspeed", recommendedAction: "Kiểm tra lệnh tốc độ & gain/overshoot; giảm tốc; tune lại." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL008", standardCode: "COMMAND_ERROR", severity: "medium", description: "Abnormal pulse control command", recommendedAction: "Kiểm tra tần số/định dạng xung lệnh; sửa nguồn phát lệnh." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL009", standardCode: "POSITION_ERROR_EXCESS", severity: "high", description: "Excessive position deviation", recommendedAction: "Kiểm tra kẹt cơ/tải; tăng gain/giới hạn lệnh; kiểm tra phanh & encoder." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL011", standardCode: "ENCODER_FAULT", severity: "high", description: "Encoder error", recommendedAction: "Kiểm tra cáp encoder & connector; nối đất shield; thay cáp/encoder." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL013", standardCode: "SAFETY_ESTOP", severity: "critical", description: "Emergency stop activated", recommendedAction: "Giải trừ E-stop; kiểm tra chuỗi an toàn; reset." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL014", standardCode: "LIMIT_SWITCH", severity: "medium", description: "Reverse (CWL) limit switch triggered", recommendedAction: "Jog ra khỏi giới hạn; kiểm tra công tắc hành trình & hành trình cơ." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL015", standardCode: "LIMIT_SWITCH", severity: "medium", description: "Forward (CCWL) limit switch triggered", recommendedAction: "Jog ra khỏi giới hạn; kiểm tra công tắc hành trình & hành trình cơ." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL016", standardCode: "OVERTEMP", severity: "high", description: "IGBT overheat", recommendedAction: "Kiểm tra quạt/thông gió & tải; để nguội rồi reset." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL017", standardCode: "MEMORY_FAULT", severity: "high", description: "Memory / absolute data error", recommendedAction: "Nạp lại tham số; thay pin absolute; thay drive nếu lặp lại." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL020", standardCode: "COMM_ERROR", severity: "high", description: "Serial communication error", recommendedAction: "Kiểm tra cáp/nhiễu & thông số truyền thông; nối lại." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL022", standardCode: "POWER_FAULT", severity: "high", description: "Main circuit power leak / phase loss", recommendedAction: "Kiểm tra pha nguồn vào & đấu nối; đo điện áp 3 pha." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL023", standardCode: "OVERLOAD_WARNING", severity: "diagnostic", description: AC + "Early overload warning", recommendedAction: "Giảm tải/chu kỳ trước khi thành AL006." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL024", standardCode: "ENCODER_FAULT", severity: "high", description: "Encoder initial magnetic field error", recommendedAction: "Kiểm tra đấu dây motor & encoder; chạy lại magnetic field detection." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL500", standardCode: "SAFETY_STO", severity: "critical", description: "STO function activated (both channels)", recommendedAction: "Kiểm tra tín hiệu STO & mạch an toàn; giải trừ; reset theo quy trình." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL501", standardCode: "SAFETY_STO", severity: "critical", description: "STO_A lost (channel A)", recommendedAction: "Kiểm tra kênh STO_A & đấu nối; xác minh redundancy; reset." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL502", standardCode: "SAFETY_STO", severity: "critical", description: "STO_B lost (channel B)", recommendedAction: "Kiểm tra kênh STO_B & đấu nối; xác minh redundancy; reset." },
  { vendor: "delta", machineType: "SERVO", nativeCode: "AL503", standardCode: "SAFETY_STO", severity: "critical", description: "STO self-diagnosis error", recommendedAction: "Kiểm tra mạch STO; nếu lặp lại thay drive; reset theo quy trình an toàn." },
];

// ════════════════════════════════════════════════════════════════════════════
// Omron NJ/NX machine controllers — network/comms event codes (16# hex).
// vendor='omron', machineType='PLC'.
// ════════════════════════════════════════════════════════════════════════════
const OMRON_NJNX: AlarmMapping[] = [
  { vendor: "omron", machineType: "PLC", nativeCode: "16#0800", standardCode: "COMM_ERROR", severity: "high", description: "FINS command error / response error", recommendedAction: "Kiểm tra đích FINS & định tuyến; xác minh node address; nối lại." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#0C08", standardCode: "COMM_ERROR", severity: "high", description: "CRC / frame check error", recommendedAction: "Kiểm tra cáp/nhiễu truyền thông; nối đất shield; thay cáp." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#0C10", standardCode: "COMM_ERROR", severity: "high", description: "Modbus exception response", recommendedAction: "Kiểm tra map thanh ghi & function code Modbus; xác minh slave." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#1C00", standardCode: "COMM_ERROR", severity: "high", description: "CIP explicit message error", recommendedAction: "Kiểm tra đường dẫn CIP & class/instance; xác minh thiết bị EtherNet/IP." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#1C04", standardCode: "COMM_TIMEOUT", severity: "high", description: "CIP request timeout", recommendedAction: "Kiểm tra kết nối/độ trễ mạng & tải target; tăng timeout hợp lý." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#2001", standardCode: "COMM_CONFIG", severity: "medium", description: "TCP/UDP port already in use", recommendedAction: "Giải phóng/đổi port; kiểm tra socket khác đang chiếm; đóng kết nối cũ." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#2006", standardCode: "COMM_TIMEOUT", severity: "high", description: "Socket service timeout", recommendedAction: "Kiểm tra peer & kết nối mạng; khôi phục socket; tăng timeout." },
];

// ════════════════════════════════════════════════════════════════════════════
// Omron NJ/NX Controller EVENT CODES (8-hex) — extracted from the NJ/NX-series
// Troubleshooting Manual (W503), section 3 "Error Descriptions and Corrections".
// vendor='omron', machineType='PLC'. nativeCode uses Sysmac's "16#XXXXXXXX" form
// (8-hex), distinct from the 4-hex FINS/CIP response codes above (no collision).
//
// ISA-18.2 severity ← W503 "Error attributes → Level":
//   Major fault → critical | Partial fault → high | Minor fault → medium | Observation → low
// Page numbers reference W503 (mig 0232 header lists them). Idempotent DB mirror = migration 0232.
// ════════════════════════════════════════════════════════════════════════════
const OMRON_NJNX_EVENTS: AlarmMapping[] = [
  // ── Controller / hardware — PLC Function Module (Major fault → critical) ──
  { vendor: "omron", machineType: "PLC", nativeCode: "16#000E0000", standardCode: "HW_FAULT", severity: "critical", description: "Non-volatile Memory Life Exceeded (W503 p.3-96)", recommendedAction: "Thay CPU Unit; lưu/khôi phục project trước khi thay." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#00110000", standardCode: "HW_FAULT", severity: "critical", description: "CPU Unit Overheat — Operation Stopped (W503 p.3-97)", recommendedAction: "Kiểm tra quạt/thông gió tủ & nhiệt độ môi trường; để CPU nguội; cycle nguồn." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#00130000", standardCode: "HW_FAULT", severity: "critical", description: "Main Memory Check Error (W503 p.3-98)", recommendedAction: "Cycle nguồn; nếu lặp lại thay CPU Unit; kiểm tra nhiễu." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#04010000", standardCode: "HW_FAULT", severity: "critical", description: "I/O Bus Check Error (W503 p.3-120)", recommendedAction: "Kiểm tra/cắm lại I/O Connecting Cable & connector; chống nhiễu; thay Unit lỗi." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#60030000", standardCode: "HW_FAULT", severity: "critical", description: "I/O Refreshing Timeout Error (W503 p.3-134)", recommendedAction: "Kiểm tra tải chu kỳ & cấu hình I/O; giảm task load; cycle nguồn." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#40160000", standardCode: "HW_FAULT", severity: "critical", description: "Safe Mode (W503 p.3-151)", recommendedAction: "Kiểm tra nguyên nhân lỗi hệ thống trong log; sửa cấu hình/chương trình; cycle nguồn." },
  // ── Configuration — PLC Function Module (Major fault → critical) ──
  { vendor: "omron", machineType: "PLC", nativeCode: "16#24010000", standardCode: "CONFIG_ERROR", severity: "critical", description: "Unsupported Unit Detected (W503 p.3-121)", recommendedAction: "Gỡ Unit/PSU không hỗ trợ; thay bằng model được CPU hỗ trợ." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#24050000", standardCode: "CONFIG_ERROR", severity: "critical", description: "Duplicate Unit Number (W503 p.3-123)", recommendedAction: "Đặt lại unit number duy nhất cho từng Special I/O / CPU Bus Unit." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#34010000", standardCode: "CONFIG_ERROR", severity: "critical", description: "I/O Setting Check Error (W503 p.3-124)", recommendedAction: "Đối chiếu cấu hình I/O trong Sysmac Studio với phần cứng thực; nạp lại." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#10250000", standardCode: "CONFIG_ERROR", severity: "critical", description: "Illegal User Program/Controller Configurations Mismatch (W503 p.3-141)", recommendedAction: "Truyền lại (download) chương trình & cấu hình từ Sysmac Studio; đối chiếu phiên bản." },
  // ── EtherCAT Master Function Module ──
  { vendor: "omron", machineType: "PLC", nativeCode: "16#24200000", standardCode: "CONFIG_ERROR", severity: "medium", description: "EtherCAT Slave Node Address Duplicated (W503 p.3-742)", recommendedAction: "Đặt node address duy nhất cho từng slave EtherCAT; đối chiếu ESI/cấu hình." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#34400000", standardCode: "CONFIG_ERROR", severity: "medium", description: "EtherCAT Network Configuration Information Error (W503 p.3-743)", recommendedAction: "So khớp cấu hình mạng EtherCAT với slave thực; nạp lại network config." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#34410000", standardCode: "COMM_ERROR", severity: "medium", description: "EtherCAT Communications Cycle Exceeded (W503 p.3-744)", recommendedAction: "Tăng chu kỳ PDO/giảm tải; kiểm tra số slave & băng thông; tối ưu task." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#34420000", standardCode: "CONFIG_ERROR", severity: "high", description: "EtherCAT Parameters Not Transferred (W503 p.3-735)", recommendedAction: "Truyền lại tham số slave; kiểm tra kết nối khi khởi động; cycle nguồn." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#84210000", standardCode: "CONFIG_ERROR", severity: "medium", description: "EtherCAT Network Configuration Error (W503 p.3-745)", recommendedAction: "Kiểm tra & sửa cấu hình mạng EtherCAT khớp với slave đang nối." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#84280000", standardCode: "COMM_ERROR", severity: "medium", description: "EtherCAT Slave Application Error (W503 p.3-752)", recommendedAction: "Đọc mã lỗi ứng dụng của slave; xử lý theo manual slave; reset lỗi." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#84290000", standardCode: "COMM_ERROR", severity: "medium", description: "EtherCAT Process Data Transmission Error (W503 p.3-753)", recommendedAction: "Kiểm tra cáp/nhiễu & topo EtherCAT; nối đất shield; thay cáp." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#842B0000", standardCode: "COMM_TIMEOUT", severity: "medium", description: "EtherCAT Process Data Reception Timeout (W503 p.3-754)", recommendedAction: "Kiểm tra slave mất kết nối/nguồn & cáp; kiểm tra chu kỳ giao tiếp." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#842C0000", standardCode: "COMM_ERROR", severity: "medium", description: "EtherCAT Process Data Communications Error (W503 p.3-756)", recommendedAction: "Kiểm tra cáp/nhiễu & slave; nối đất shield; thay cáp/slave nếu lặp lại." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#842E0000", standardCode: "COMM_ERROR", severity: "high", description: "EtherCAT Frame Not Received (W503 p.3-738)", recommendedAction: "Kiểm tra đứt cáp/mất nguồn slave đầu chuỗi; đo link; thay cáp." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#84310002", standardCode: "COMM_ERROR", severity: "medium", description: "EtherCAT Illegal Slave Disconnection Detected (W503 p.3-764)", recommendedAction: "Kiểm tra slave bị rớt/mất nguồn & cáp; nối lại đúng topo; reset." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#84390000", standardCode: "COMM_ERROR", severity: "low", description: "EtherCAT Ring Disconnection Detected (W503 p.3-793)", recommendedAction: "Kiểm tra cáp vòng ring redundancy; nối lại đường dự phòng." },
  // ── EtherNet/IP Function Module (CIP tag data link) ──
  { vendor: "omron", machineType: "PLC", nativeCode: "16#34290000", standardCode: "CONFIG_ERROR", severity: "medium", description: "EtherNet/IP IP Address Setting Error (W503 p.3-685)", recommendedAction: "Sửa IP/subnet trong Sysmac Studio; tránh trùng dải; nạp lại." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#342A0000", standardCode: "CONFIG_ERROR", severity: "medium", description: "EtherNet/IP DNS Setting Error (W503 p.3-686)", recommendedAction: "Kiểm tra địa chỉ DNS server cấu hình; sửa hoặc tắt DNS nếu không dùng." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#840A0000", standardCode: "CONFIG_ERROR", severity: "medium", description: "EtherNet/IP IP Address Duplication Error (W503 p.3-697)", recommendedAction: "Tìm & sửa thiết bị trùng IP trong mạng; đặt IP duy nhất." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#84030000", standardCode: "COMM_ERROR", severity: "medium", description: "EtherNet/IP DNS Server Connection Error (W503 p.3-689)", recommendedAction: "Kiểm tra kết nối tới DNS server & định tuyến; xác minh địa chỉ." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#840B0000", standardCode: "COMM_ERROR", severity: "medium", description: "EtherNet/IP BOOTP Server Connection Error (W503 p.3-698)", recommendedAction: "Kiểm tra BOOTP server & mạng; hoặc đặt IP tĩnh nếu không dùng BOOTP." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#84060000", standardCode: "COMM_ERROR", severity: "low", description: "EtherNet/IP Link OFF Detected (W503 p.3-703)", recommendedAction: "Kiểm tra cáp/switch & cổng built-in EtherNet/IP; đo link; thay cáp." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#84080000", standardCode: "CIP_ERROR", severity: "medium", description: "EtherNet/IP Tag Data Link Timeout (W503 p.3-693)", recommendedAction: "Kiểm tra target CIP connection & tải mạng; tăng RPI/timeout; xác minh tag." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#84090000", standardCode: "CIP_ERROR", severity: "medium", description: "EtherNet/IP Tag Data Link Connection Timeout (W503 p.3-694)", recommendedAction: "Kiểm tra target sẵn sàng & route CIP; xác minh tag list & Network Publish." },
  // ── CIP / serial / socket comms — PLC Function Module (Observation → low) ──
  { vendor: "omron", machineType: "PLC", nativeCode: "16#54011C06", standardCode: "CIP_ERROR", severity: "low", description: "CIP Communications Data Size Exceeded (W503 p.3-284)", recommendedAction: "Giảm kích thước dữ liệu CIP mỗi request; chia nhỏ; kiểm tra class/instance." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#54010C08", standardCode: "COMM_ERROR", severity: "low", description: "Serial CRC Mismatch (W503 p.3-254)", recommendedAction: "Kiểm tra cáp/nhiễu serial & thông số truyền; nối đất shield." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#54010C0B", standardCode: "COMM_TIMEOUT", severity: "low", description: "Serial Communications Timeout (W503 p.3-255)", recommendedAction: "Kiểm tra thiết bị đầu kia & cáp; xác minh baud/parity; tăng timeout." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#54010C10", standardCode: "COMM_ERROR", severity: "low", description: "Exceptional Modbus Response (W503 p.3-257)", recommendedAction: "Kiểm tra function code & map thanh ghi Modbus; xác minh slave." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#54012406", standardCode: "COMM_ERROR", severity: "low", description: "FTP Server Connection Error (W503 p.3-299)", recommendedAction: "Kiểm tra FTP server đích & thông tin đăng nhập/route; nối lại." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#80110000", standardCode: "COMM_ERROR", severity: "low", description: "Packet Discarded (W503 p.3-227)", recommendedAction: "Kiểm tra tải mạng/nghẽn & bộ đệm; giảm lưu lượng; kiểm tra switch." },
  // ── Motion Control Function Module ──
  { vendor: "omron", machineType: "PLC", nativeCode: "16#644C0000", standardCode: "MOTION_FAULT", severity: "low", description: "Following Error Warning (W503 p.3-549)", recommendedAction: "Theo dõi sai lệch bám; kiểm tra gain/tải trước khi thành lỗi following-error limit." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#64480000", standardCode: "MOTION_FAULT", severity: "medium", description: "Following Error Limit Exceeded (W503 p.3-527)", recommendedAction: "Kiểm tra kẹt cơ/tải & gain; tăng giới hạn hợp lý; kiểm tra encoder & phanh; error reset." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#64470000", standardCode: "MOTION_FAULT", severity: "medium", description: "In-position Check Time Exceeded (W503 p.3-526)", recommendedAction: "Kiểm tra gain/settling & dải in-position; tăng thời gian/nới dải; error reset." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#64410000", standardCode: "MOTION_FAULT", severity: "medium", description: "Target Position Negative Software Limit Exceeded (W503 p.3-645)", recommendedAction: "Kiểm tra lệnh vị trí đích trong dải software limit; sửa quỹ đạo; error reset." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#644B0000", standardCode: "MOTION_FAULT", severity: "medium", description: "Negative Limit Input Detected (W503 p.3-530)", recommendedAction: "Jog trục ra khỏi giới hạn; kiểm tra công tắc hành trình & hành trình cơ; error reset." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#64570000", standardCode: "MOTION_FAULT", severity: "medium", description: "Servo OFF Error (W503 p.3-531)", recommendedAction: "Kiểm tra điều kiện servo-off khi đang chạy; bật servo & reset; kiểm tra chuỗi enable." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#74210000", standardCode: "MOTION_FAULT", severity: "medium", description: "Servo Main Circuit Power OFF (W503 p.3-533)", recommendedAction: "Bật nguồn mạch chính servo drive trước khi servo-on; kiểm tra đấu nối nguồn." },
  { vendor: "omron", machineType: "PLC", nativeCode: "16#74250000", standardCode: "MOTION_FAULT", severity: "medium", description: "Homing Direction Limit Input Detected (W503 p.3-535)", recommendedAction: "Kiểm tra hướng home & vị trí công tắc limit; sửa tham số homing; chạy lại home." },
];

// ════════════════════════════════════════════════════════════════════════════
// Zmotion motion controllers — controller/firmware error codes.
// vendor='zmotion', machineType='MOTION'.
// ════════════════════════════════════════════════════════════════════════════
const ZMOTION: AlarmMapping[] = [
  { vendor: "zmotion", machineType: "MOTION", nativeCode: "212", standardCode: "STATE_ERROR", severity: "medium", description: "Controller state error (invalid operation for current state)", recommendedAction: "Kiểm tra trạng thái controller trước lệnh; đưa về trạng thái hợp lệ." },
  { vendor: "zmotion", machineType: "MOTION", nativeCode: "213", standardCode: "FILE_ERROR", severity: "medium", description: "File download error", recommendedAction: "Kiểm tra kết nối & dung lượng bộ nhớ; tải lại file chương trình." },
  { vendor: "zmotion", machineType: "MOTION", nativeCode: "217", standardCode: "UNSUPPORTED_OP", severity: "low", description: "Unsupported command/operation", recommendedAction: "Kiểm tra lệnh có được model/firmware hỗ trợ; dùng lệnh thay thế." },
  { vendor: "zmotion", machineType: "MOTION", nativeCode: "260", standardCode: "HARDWARE_FAULT", severity: "high", description: "Hardware fault", recommendedAction: "Cycle power; kiểm tra module phần cứng; thay controller nếu lặp lại." },
  { vendor: "zmotion", machineType: "MOTION", nativeCode: "265", standardCode: "HARDWARE_FAULT", severity: "high", description: "RAM error", recommendedAction: "Cycle power; nếu lặp lại thay controller." },
  { vendor: "zmotion", machineType: "MOTION", nativeCode: "272", standardCode: "COMM_ERROR", severity: "high", description: "Ethernet hardware error", recommendedAction: "Kiểm tra cổng/cáp Ethernet & PHY; thay cáp; kiểm tra phần cứng mạng." },
  { vendor: "zmotion", machineType: "MOTION", nativeCode: "285", standardCode: "CONFIG_MISMATCH", severity: "high", description: "Firmware version mismatch", recommendedAction: "Cập nhật firmware khớp với công cụ/chương trình; đối chiếu phiên bản." },
  { vendor: "zmotion", machineType: "MOTION", nativeCode: "1009", standardCode: "MOTION_BUSY", severity: "low", description: "Axis in motion — command rejected", recommendedAction: "Chờ trục dừng hoặc gọi CANCEL trước khi ra lệnh mới." },
  { vendor: "zmotion", machineType: "MOTION", nativeCode: "1013", standardCode: "UNSUPPORTED_OP", severity: "low", description: "ATYPE not supported for this axis", recommendedAction: "Đặt ATYPE hợp lệ cho loại trục; kiểm tra khả năng phần cứng trục." },
];

/**
 * All REAL vendor alarm mappings (doc 37 §6.4), one flat list. Spread into
 * SEED_ALARM_MAPPINGS by alarmTaxonomy.ts and mirrored to the DB by migration 0231.
 */
export const VENDOR_ALARM_MAPPINGS: AlarmMapping[] = [
  ...MITSUBISHI_MRJ4,
  ...UNIVERSAL_ROBOTS,
  ...FANUC,
  ...DELTA_ASDA,
  ...OMRON_NJNX,
  ...OMRON_NJNX_EVENTS,
  ...ZMOTION,
];
