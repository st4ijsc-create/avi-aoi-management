/**
 * Sprint G2.1 — Read-back comparison helper (THUẦN, không I-O).
 *
 * So sánh giá trị MONG ĐỢI (giá trị người dùng đã ghi) với giá trị ĐỌC LẠI từ
 * thiết bị (đã áp scale → giá trị người dùng). Dùng để quyết định một write
 * `acked` là `acked_verified` (khớp) hay `acked_unverified` (lệch — CHỈ cảnh báo,
 * KHÔNG coi là failed, KHÔNG retry mù — quyết định #4).
 *
 * int / float — R1b-2b-1 T6 fix round 1 (phát hiện ở nghiệm thu T16, ô R1-đc): so với giá trị ĐỌC MÔ PHỎNG, KHÔNG so ở không gian thô.
 *   Driver THẬT trả tag int đã scale xuôi RỒI làm tròn (`otScale.scaleXuoi`: Math.round(raw·s + o)). Bản T6 đầu suy thô từ giá trị ĐÃ làm tròn
 *   (round((a − o)/s)) ⇒ lượt ghi ĐÚNG bị `acked_unverified` (scale 0,5: ghi 2,5 ⇒ thô 5 ⇒ đọc 3 ⇒ round(3/0,5) = 6 ≠ 5). Nay:
 *     rawGhi    = inverseScale(e, dataType, s, o)          — ĐÚNG số driver ghi xuống
 *     docMongDoi = scaleXuoi(rawGhi, dataType, s, o)        — ĐÚNG số driver sẽ đọc về nếu thiết bị giữ rawGhi (cùng hàm với đường đọc)
 *   (s, o) chuẩn hoá bởi `chuanHoaThangDo` (NULL / 0 / không hữu hạn ⇒ 1; NULL ⇒ 0).
 *   - int   → Math.round(actual) === docMongDoi (driver thật luôn trả số nguyên ⇒ round là không đổi; giữ round để vắng `thangDo` ⇒ (1, 0) ⇒
 *             Math.round(e) === Math.round(a) ĐÚNG như cũ); NaN → false
 *   - float → |docMongDoi − actual| <= tolerance (vắng thang đo ⇒ docMongDoi = e ⇒ như cũ); NaN → false
 *   ⚠ GIỚI HẠN (R1b-2b-2 mục 64): làm tròn có thể CHE số thô sai — scale 0,5: thô 6 và thô 5 cùng đọc 3 ⇒ "khớp". Không phát hiện được nếu không
 *     có đọc lại THÔ thật (giá trị trước scale) từ driver. Số thô sai làm ĐỔI giá trị đọc đã làm tròn (thô 7 ⇒ 4 ≠ 3) thì vẫn lệch.
 *   - ĐỊA CHỈ lớp bit (`bit.lopBit`, R1b-2b-1 T6 / Task 2 concern 3): so theo luật bool BẤT KỂ dataType — expected = `boolDungGhim` khi là STOP đã
 *             xác minh (`bit.dungGhim`, đúng cách driver đã ghi) hoặc `boolTuGiaTri`; actual = `giaiMaBoolDoc`; một bên undefined ⇒ lệch
 *   - bool  → `boolTuGiaTri(expected)` === `giaiMaBoolDoc(actual)` (R1b-2b-1 T2 — CÙNG luật với đường ghi / đọc của driver: "false" khớp
 *             false; một bên ngoài luật ("off", đối tượng…) ⇒ false — không bao giờ "khớp" nhờ truthy của JS)
 *   - string/json → String(expected) === String(actual)
 *   - actual === null/undefined → false (đọc lại không có giá trị → coi là lệch)
 */
import type { OtDataType } from "../otDriver";
import { boolDungGhim, boolTuGiaTri, giaiMaBoolDoc } from "./boolNghiem";
import { chuanHoaThangDo, inverseScale, scaleXuoi } from "./otScale";

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
    case "float":
    case "int": {
      const e = Number(expected);
      const a = Number(actual);
      if (Number.isNaN(e) || Number.isNaN(a)) return false;
      const { s, o } = chuanHoaThangDo(thangDo?.scale, thangDo?.offset);
      // Mô phỏng đường ghi rồi đường đọc của driver (cùng hai hàm driver dùng) — xem chú thích đầu tệp.
      const docMongDoi = scaleXuoi(Number(inverseScale(e, dataType, s, o)), dataType, s, o);
      if (dataType === "int") return Math.round(a) === docMongDoi;
      return Math.abs(docMongDoi - a) <= Math.abs(tolerance);
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
