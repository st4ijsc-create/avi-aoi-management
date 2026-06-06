/**
 * Sprint F1.3 — Mitsubishi MELSEC MC address helpers (THUẦN, không import lib/I-O).
 *
 * Tách riêng để test offline (không cần `mcprotocol` / PLC thật). Driver
 * mitsubishiMcDriver.ts dùng `parseMcAddress` để validate + dựng địa chỉ truyền
 * cho mcprotocol (setTranslationCB) và `coerceMcValue` để chuẩn hoá giá trị.
 *
 * scale/offset KHÔNG áp ở helper (chỉ ép kiểu) — driver áp sau, nhất quán F1.2.
 *
 * Cú pháp mcprotocol (xem README):
 *   - Word device:  "D0" "D100" "R2000" "W100" "ZR0" "CN199" "TN0" ...
 *   - Bit device:   "M100" "X034" "Y10" "B0" "S4" "L0" "F0" ... và "<word>.<bit>" vd "D6000.1"
 *   - Float prefix: "RFLOAT5000" "DFLOAT100" (đọc số thực 32-bit)
 * Helper giữ nguyên địa chỉ gốc để mcprotocol tự parse; chỉ suy ra cờ isBit.
 */
import type { OtDataType } from "../otDriver";

export interface ParsedMcAddress {
  /** Địa chỉ mcprotocol gốc (đã trim, đã chuẩn hoá hoa). */
  mc: string;
  /** Tên device (vd "D", "M", "X", "RFLOAT"). */
  device: string;
  /** Là địa chỉ bit → true (đọc về boolean). */
  isBit: boolean;
  /**
   * G2.1 — device CHỈ ĐỌC: X (input relay) và DX (direct input). writeTags với
   * device này → ok:false "register type not writable" (không gửi xuống thiết bị).
   */
  isReadOnly: boolean;
}

// Device CHỈ ĐỌC (input) — không cho ghi.
const READ_ONLY_DEVICES = new Set(["X", "DX"]);

// Device kiểu BIT trong MELSEC (đọc về boolean).
const BIT_DEVICES = new Set(["M", "X", "Y", "B", "S", "L", "F", "SM", "SB", "DX", "DY", "V"]);
// Device kiểu WORD hợp lệ (gồm tiền tố FLOAT).
const WORD_DEVICES = new Set([
  "D", "R", "W", "ZR", "SD", "SW", "Z", "TN", "CN", "TS", "CS", "DFLOAT", "RFLOAT", "ZRFLOAT", "WFLOAT", "TC", "CC",
]);

/**
 * Parse + validate địa chỉ MELSEC MC.
 *   - "D100" → word device D, addr 100
 *   - "M100" → bit device M, addr 100
 *   - "X034" → bit device X
 *   - "RFLOAT5000" → float word device
 *   - "D6000.1" → bit trong word (isBit)
 * Sai định dạng → throw. Trả device + cờ isBit, giữ địa chỉ gốc.
 */
export function parseMcAddress(address: string): ParsedMcAddress {
  const a = String(address ?? "").trim();
  if (!a) throw new Error(`invalid MC address: ${address}`);
  const up = a.toUpperCase();

  // <DEVICE letters><digits>[.<bit digits>]
  const m = up.match(/^([A-Z]+)(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`invalid MC address: ${address}`);

  const device = m[1];
  const hasBit = m[3] !== undefined;

  const isReadOnly = READ_ONLY_DEVICES.has(device);
  if (BIT_DEVICES.has(device)) {
    return { mc: up, device, isBit: true, isReadOnly };
  }
  if (WORD_DEVICES.has(device)) {
    // ".bit" trên word device (vd D6000.1) → đọc bit đơn
    return { mc: up, device, isBit: hasBit, isReadOnly };
  }

  throw new Error(`unknown MC device: ${device} (in ${address})`);
}

export interface CoercedMcValue {
  value: number | string | boolean | null;
  quality: "good" | "bad";
}

/**
 * Ép giá trị thô mcprotocol trả về theo dataType (KHÔNG áp scale/offset).
 *   - null/undefined (BAD) → {value:null, quality:"bad"}
 *   - bool → Boolean(raw)  (mcprotocol trả true/false hoặc 0/1)
 *   - int → Number round; float → Number; string/json → String/serialize
 * NaN sau ép → quality:"bad".
 */
export function coerceMcValue(raw: unknown, dataType: OtDataType): CoercedMcValue {
  if (raw === null || raw === undefined) {
    return { value: null, quality: "bad" };
  }
  switch (dataType) {
    case "bool":
      return { value: Boolean(raw), quality: "good" };
    case "int": {
      const n = Number(raw);
      if (Number.isNaN(n)) return { value: null, quality: "bad" };
      return { value: Math.round(n), quality: "good" };
    }
    case "float": {
      const n = Number(raw);
      if (Number.isNaN(n)) return { value: null, quality: "bad" };
      return { value: n, quality: "good" };
    }
    case "string":
      return { value: String(raw), quality: "good" };
    case "json": {
      try {
        return { value: JSON.stringify(raw), quality: "good" };
      } catch {
        return { value: null, quality: "bad" };
      }
    }
    default:
      return { value: null, quality: "bad" };
  }
}
