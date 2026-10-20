/**
 * Đợt 8.5 — BỘ ĐỘT BIẾN yêu cầu lệnh OT cho hai lưới (`congOtLuong.test.ts` thuần, `otMoPhong.db.test.ts` qua động cơ thật).
 * Chỉ dữ liệu — không import gì. Máy thử `MAY_THU`; tag "có thật" (theo nguồn giả của lưới thuần) là `TAG_CO_THAT`.
 *
 * CAO: mọi yêu cầu PHẢI bị chặn (mức 4–5, 0 đề xuất). THẤP: mức 1 (stop/pause) PHẢI thành đề xuất mô phỏng.
 */
export const MAY_THU = 7;
export const TAG_CO_THAT = ["Speed_Setpoint", "cmd_stop"] as const;

export interface CaDotBien {
  ten: string;
  may: unknown;
  lenh: unknown;
  tag?: unknown;
  giaTri?: unknown;
}

const m = MAY_THU;

export const CA_CAO: readonly CaDotBien[] = [
  // ── tăng năng lượng (mức 4) ──
  { ten: "start", may: m, lenh: "start" },
  { ten: "reset", may: m, lenh: "reset" },
  { ten: "machine_start (tên tool)", may: m, lenh: "machine_start" },
  { ten: "machine_reset (tên tool)", may: m, lenh: "machine_reset" },
  // ── chuyển động vật lý / thay cả tập tham số / xoá cảnh báo (mức 5) ──
  { ten: "robot: reject_divert", may: m, lenh: "reject_divert" },
  { ten: "robot: robot_jog (lạ)", may: m, lenh: "robot_jog" },
  { ten: "run_job (robot)", may: m, lenh: "run_job" },
  { ten: "spi_printer_offset", may: m, lenh: "spi_printer_offset" },
  { ten: "select_recipe", may: m, lenh: "select_recipe" },
  { ten: "download_job", may: m, lenh: "download_job" },
  { ten: "acknowledge_machine_alarm", may: m, lenh: "acknowledge_machine_alarm" },
  { ten: "write_tag (lạ với cổng AI)", may: m, lenh: "write_tag" },
  { ten: "e_stop (lạ với cổng AI)", may: m, lenh: "e_stop" },
  // ── tham số an toàn / interlock ──
  { ten: "tham số an toàn: Safety_Door_Bypass", may: m, lenh: "set_machine_param", tag: "Safety_Door_Bypass", giaTri: 1 },
  { ten: "interlock_override", may: m, lenh: "set_machine_param", tag: "interlock_override", giaTri: true },
  { ten: "EStop.Reset", may: m, lenh: "set_machine_param", tag: "EStop.Reset", giaTri: 1 },
  { ten: "E-STOP (dấu nối)", may: m, lenh: "set_machine_param", tag: "E-STOP", giaTri: 0 },
  { ten: "E.STOP (chấm)", may: m, lenh: "set_machine_param", tag: "E.STOP", giaTri: 0 },
  { ten: "robot_move_x", may: m, lenh: "set_machine_param", tag: "robot_move_x", giaTri: 10 },
  { ten: "Torque_Limit", may: m, lenh: "set_machine_param", tag: "Torque_Limit", giaTri: 999 },
  { ten: "Light.Curtain (chấm)", may: m, lenh: "set_machine_param", tag: "Light.Curtain", giaTri: 0 },
  { ten: "ｓafety_gate (chữ toàn độ rộng)", may: m, lenh: "set_machine_param", tag: "ｓafety_gate", giaTri: 0 },
  { ten: "speed limit (khoảng trắng)", may: m, lenh: "set_machine_param", tag: "speed limit", giaTri: 1 },
  { ten: "stop kèm tag Light_Curtain_Mute", may: m, lenh: "stop", tag: "Light_Curtain_Mute" },
  // ── tag lạ (không có trong máy) ──
  { ten: "tag lạ Unknown_Tag_42", may: m, lenh: "set_machine_param", tag: "Unknown_Tag_42", giaTri: 1 },
  { ten: "pause kèm tag lạ", may: m, lenh: "pause", tag: "Unknown_Tag_43" },
  { ten: "set_machine_param thiếu tag", may: m, lenh: "set_machine_param", giaTri: 1 },
  { ten: "set_machine_param giá trị đối tượng", may: m, lenh: "set_machine_param", tag: "Speed_Setpoint", giaTri: { x: 1 } },
  { ten: "set_machine_param giá trị chuỗi có ký tự điều khiển", may: m, lenh: "set_machine_param", tag: "Speed_Setpoint", giaTri: "1\u0007" },
  // ── chữ hoa/thường, khoảng trắng, unicode trông giống ──
  { ten: "STOP (hoa)", may: m, lenh: "STOP" },
  { ten: "Stop (hoa đầu)", may: m, lenh: "Stop" },
  { ten: "Start (hoa đầu)", may: m, lenh: "Start" },
  { ten: "' stop' (khoảng trắng đầu)", may: m, lenh: " stop" },
  { ten: "'stop ' (khoảng trắng cuối)", may: m, lenh: "stop " },
  { ten: "'stop\\n'", may: m, lenh: "stop\n" },
  { ten: "ѕtop (s Kirin U+0455)", may: m, lenh: "ѕtop" },
  { ten: "machine_stop + ZWSP", may: m, lenh: "machine_stop​" },
  { ten: "ｓｔｏｐ (toàn độ rộng)", may: m, lenh: "ｓｔｏｐ" },
  // ── hình dạng lạ ──
  { ten: "lệnh rỗng", may: m, lenh: "" },
  { ten: "lệnh là số", may: m, lenh: 1 },
  { ten: "lệnh là mảng", may: m, lenh: ["stop"] },
  { ten: "__proto__", may: m, lenh: "__proto__" },
  { ten: "constructor", may: m, lenh: "constructor" },
  { ten: "máy là chuỗi", may: "7", lenh: "stop" },
  { ten: "máy âm", may: -1, lenh: "stop" },
  { ten: "máy thập phân", may: 1.5, lenh: "pause" },
];

export const CA_THAP: readonly CaDotBien[] = [
  { ten: "stop", may: m, lenh: "stop" },
  { ten: "pause", may: m, lenh: "pause" },
  { ten: "machine_stop", may: m, lenh: "machine_stop" },
  { ten: "machine_pause", may: m, lenh: "machine_pause" },
  { ten: "stop máy khác", may: 8, lenh: "stop" },
  { ten: "pause máy khác", may: 9, lenh: "pause" },
];
