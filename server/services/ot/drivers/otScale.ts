/**
 * Sprint F4b — INVERSE scale/offset helper (THUẦN, không I-O).
 *
 * Đọc về (readTags) áp xuôi:  value = raw * scale + offset.
 * Ghi xuống (writeTags) áp NGƯỢC: raw = (value - offset) / scale.
 *
 * Chỉ áp cho int/float. bool/string/json KHÔNG inverse (giữ nguyên value).
 * Dùng chung cho opcuaDriver + modbusDriver để hai protocol nhất quán.
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
