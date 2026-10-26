/**
 * Sprint F4b — INVERSE scale/offset helper (THUẦN, không I-O).
 *
 * Đọc về (readTags) áp xuôi:  value = raw * scale + offset.
 * Ghi xuống (writeTags) áp NGƯỢC: raw = (value - offset) / scale.
 *
 * Chỉ áp cho int/float. bool/string/json KHÔNG inverse (giữ nguyên value).
 * Dùng chung cho opcuaDriver + modbusDriver để hai protocol nhất quán.
 * Chiều XUÔI (đọc) có MỘT nguồn: `scaleXuoi` dưới đây (R1b-2b-1 T6 fix round 1).
 */
import type { OtDataType } from "../otDriver";

/**
 * Tính giá trị RAW cần ghi xuống thiết bị từ giá trị người dùng.
 *  - int   → Math.round((value - offset) / scale)
 *  - float → (value - offset) / scale
 *  - bool / string / json → trả value nguyên trạng (không inverse).
 * scale mặc định 1, offset mặc định 0. scale = 0 → coi như 1 (tránh chia 0).
 */
export function inverseScale(
  value: unknown,
  dataType: OtDataType,
  scale = 1,
  offset = 0,
): unknown {
  if (dataType !== "int" && dataType !== "float") {
    return value;
  }
  const s = scale === 0 || scale == null ? 1 : scale;
  const o = offset ?? 0;
  const raw = (Number(value) - o) / s;
  return dataType === "int" ? Math.round(raw) : raw;
}

/**
 * R1b-2b-1 T6 fix round 1 (phát hiện ở nghiệm thu T16) — MỘT nguồn phép scale XUÔI phía ĐỌC: giá trị driver trả cho tag int / float từ số thô
 * (đã giải mã):
 *  - int   → Math.round(raw * scale + offset)   (làm tròn SAU scale ⇒ tag int scale lẻ đọc về số NGUYÊN: thô 5 × 0,5 ⇒ 3)
 *  - float → raw * scale + offset
 * scale / offset nhận ĐÚNG như driver đọc vẫn dùng (`tag.scale ?? 1`, `tag.offset ?? 0`; KHÔNG chuẩn hoá 0 ⇒ 1 — giữ nguyên hành vi đọc cũ).
 * Đường đọc của MỌI driver gọi hàm này (Modbus, SLMP, S7, MC, EIP, OPC UA `normalizeOpcuaValue`); `readbackMatches` cũng gọi nó để MÔ PHỎNG
 * giá trị driver sẽ đọc về cho số thô vừa ghi. Đổi phép tính ở đây = đổi cả đường đọc lẫn so đọc lại, cùng lúc.
 */
export function scaleXuoi(raw: number, dataType: "int" | "float", scale?: number | null, offset?: number | null): number {
  const n = raw * (scale ?? 1) + (offset ?? 0);
  return dataType === "int" ? Math.round(n) : n;
}

/**
 * R1b-2b-1 T6 (C8) — MỘT nguồn chuẩn hoá (scale, offset) cho mọi nơi so / kiểm ở không gian thô: NULL / 0 / không hữu hạn ⇒ scale 1;
 * NULL / không hữu hạn ⇒ offset 0. Chấp nhận số hoặc chuỗi số (cột numeric của postgres.js). `kenhScada.heSoThangDo` và
 * `readbackCompare` đều dùng hàm này.
 */
export function chuanHoaThangDo(scale?: number | string | null, offset?: number | string | null): { s: number; o: number } {
  const s = scale == null ? 1 : Number(scale);
  const o = offset == null ? 0 : Number(offset);
  return { s: Number.isFinite(s) && s !== 0 ? s : 1, o: Number.isFinite(o) ? o : 0 };
}
