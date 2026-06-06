/**
 * Sprint G2.1 — Read-back comparison helper (THUẦN, không I-O).
 *
 * So sánh giá trị MONG ĐỢI (giá trị người dùng đã ghi) với giá trị ĐỌC LẠI từ
 * thiết bị (đã áp scale → giá trị người dùng). Dùng để quyết định một write
 * `acked` là `acked_verified` (khớp) hay `acked_unverified` (lệch — CHỈ cảnh báo,
 * KHÔNG coi là failed, KHÔNG retry mù — quyết định #4).
 *
 * So sánh trên value ĐÃ SCALE (cả expected lẫn actual là giá trị người dùng).
 *   - float → |expected - actual| <= tolerance  (NaN bất kỳ bên → false)
 *   - int   → Math.round(expected) === Math.round(actual)  (NaN → false)
 *   - bool  → Boolean(expected) === Boolean(actual)
 *   - string/json → String(expected) === String(actual)
 *   - actual === null/undefined → false (đọc lại không có giá trị → coi là lệch)
 */
import type { OtDataType } from "../otDriver";

export function readbackMatches(
  expected: unknown,
  actual: unknown,
  dataType: OtDataType,
  tolerance = 1e-6,
): boolean {
  // Đọc lại không có giá trị (BAD / null) → không thể xác minh → coi là lệch.
  if (actual === null || actual === undefined) return false;

  switch (dataType) {
    case "float": {
      const e = Number(expected);
      const a = Number(actual);
      if (Number.isNaN(e) || Number.isNaN(a)) return false;
      return Math.abs(e - a) <= Math.abs(tolerance);
    }
    case "int": {
      const e = Number(expected);
      const a = Number(actual);
      if (Number.isNaN(e) || Number.isNaN(a)) return false;
      return Math.round(e) === Math.round(a);
    }
    case "bool":
      return Boolean(expected) === Boolean(actual);
    case "string":
    case "json":
    default:
      return String(expected) === String(actual);
  }
}
