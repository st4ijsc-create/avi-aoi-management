/**
 * SCADA R1a Task 12 fix round 1 (phán quyết c1) — giá trị lệnh mà luật interlock THẬT SỰ GỬI xuống thiết bị.
 *
 * `interlockEngine` (auto-block) gửi `rule.commandValue ?? true` (luật không khai giá trị ⇒ ghi `true`), và `dispatch()` (bước kiểm luật
 * interlock) so lệnh với ĐÚNG giá trị đó. Một hàm cho cả ba nơi: engine, dispatcher, và kiểm nhất quán lúc cấu hình
 * (`server/services/scada/nhatQuanKenh.ts`) — kiểm cái được gửi, không phải cái được lưu. Thuần, không import gì.
 */
export function giaTriLenhInterlock(rule: { commandValue?: unknown }): unknown {
  return rule.commandValue ?? true;
}
