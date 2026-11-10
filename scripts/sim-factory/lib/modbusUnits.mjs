// scripts/sim-factory/lib/modbusUnits.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Thuần logic Modbus unit — KHÔNG dựng server, KHÔNG mở cổng.
//
// Xuất:
//   • MODBUS_ALL_UNITS — hằng unit id mà modbus-serial coi là "mọi unit" (255).
//   • dungBangUnit(topology) — dựng bảng unit → lineNo từ topology.mjs.
//   • docThanhGhi(bangUnit, state, diaChi, unitId) — đọc giá trị thanh ghi theo unit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unit ID của server Modbus TCP để trả lời MỌI yêu cầu (modbus-serial coi 255 = all units).
 * ServerTCP với unitID: 255 sẽ phản hồi bất kỳ unit ID nào trong yêu cầu.
 */
export const MODBUS_ALL_UNITS = 255;

/**
 * Dựng bảng tra cứu unit → lineNo từ topology (hoặc danh sách line).
 *
 * @param {object|Array} topoOrLines — topology.mjs (có trường `lines`) HOẶC mảng line trực tiếp.
 * @returns {Record<number, number>} — { [modbusUnitId]: lineNo }
 */
export function dungBangUnit(topoOrLines) {
  const lines = Array.isArray(topoOrLines) ? topoOrLines : topoOrLines.lines;
  const bang = {};
  for (const line of lines) {
    bang[line.modbusUnitId] = line.lineNo;
  }
  return bang;
}

/**
 * Đọc giá trị thanh ghi (holding/input) cho một unit cụ thể.
 *
 * Quy tắc:
 *   - unitId không có trong bangUnit → trả 0.
 *   - thanh ghi chưa có trong state → trả 0.
 *   - giá trị cắt về 16 bit không dấu (& 0xffff).
 *   - state giữ giá trị số hoặc chuỗi số → Number() rồi & 0xffff.
 *
 * @param {Record<number, number>} bangUnit — bảng unit → lineNo (từ dungBangUnit).
 * @param {Record<number, object>} state — state theo lineNo, mỗi line có `tags: { [key]: value }`.
 * @param {number|string} diaChi — địa chỉ thanh ghi (số hoặc chuỗi số).
 * @param {number} unitId — unit ID của yêu cầu Modbus.
 * @returns {number} — giá trị 16-bit không dấu.
 */
export function docThanhGhi(bangUnit, state, diaChi, unitId) {
  const lineNo = bangUnit[unitId];
  if (lineNo == null) return 0;
  const s = state[lineNo];
  if (!s || !s.tags) return 0;
  const raw = s.tags[`m:${diaChi}`];
  if (raw == null) return 0;
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return num & 0xffff;
}
