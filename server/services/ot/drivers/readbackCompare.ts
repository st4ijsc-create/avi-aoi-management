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
 *   - int   → so ở KHÔNG GIAN THÔ (R1b-2b-1 T6, mục 42): Math.round((e − o)/s) === Math.round((a − o)/s), (s, o) chuẩn hoá bởi `chuanHoaThangDo`
 *             (vắng `thangDo` ⇒ (1, 0) ⇒ Math.round(e) === Math.round(a) như cũ; NaN → false)
 *   - ĐỊA CHỈ lớp bit (`bit.lopBit`, R1b-2b-1 T6 / Task 2 concern 3): so theo luật bool BẤT KỂ dataType — expected = `boolDungGhim` khi là STOP đã
 *             xác minh (`bit.dungGhim`, đúng cách driver đã ghi) hoặc `boolTuGiaTri`; actual = `giaiMaBoolDoc`; một bên undefined ⇒ lệch
 *   - bool  → `boolTuGiaTri(expected)` === `giaiMaBoolDoc(actual)` (R1b-2b-1 T2 — CÙNG luật với đường ghi / đọc của driver: "false" khớp
 *             false; một bên ngoài luật ("off", đối tượng…) ⇒ false — không bao giờ "khớp" nhờ truthy của JS)
 *   - string/json → String(expected) === String(actual)
 *   - actual === null/undefined → false (đọc lại không có giá trị → coi là lệch)
 */
import type { OtDataType } from "../otDriver";
import { boolDungGhim, boolTuGiaTri, giaiMaBoolDoc } from "./boolNghiem";
import { chuanHoaThangDo } from "./otScale";

export function readbackMatches(
  expected: unknown,
  actual: unknown,
  dataType: OtDataType,
  tolerance = 1e-6,
  thangDo?: { scale?: number | string | null; offset?: number | string | null },
  bit?: { lopBit?: boolean; dungGhim?: boolean },
): boolean {
  // Đọc lại không có giá trị (BAD / null) → không thể xác minh → coi là lệch.
  if (actual === null || actual === undefined) return false;

  // Địa chỉ lớp bit: driver ghi MỘT BIT bất kể dataType của tag ⇒ so theo luật bool.
  if (bit?.lopBit) {
    const e = bit.dungGhim ? boolDungGhim(expected) : boolTuGiaTri(expected);
    const a = giaiMaBoolDoc(actual);
    return e !== undefined && a !== undefined && e === a;
  }

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
      const { s, o } = chuanHoaThangDo(thangDo?.scale, thangDo?.offset);
      return Math.round((e - o) / s) === Math.round((a - o) / s);
    }
    case "bool": {
      const e = boolTuGiaTri(expected);
      const a = giaiMaBoolDoc(actual);
      return e !== undefined && a !== undefined && e === a;
    }
    case "string":
    case "json":
    default:
      return String(expected) === String(actual);
  }
}
