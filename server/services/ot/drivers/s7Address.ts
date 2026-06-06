/**
 * Sprint F1.3 — Siemens S7 address helpers (THUẦN, không import lib/I-O).
 *
 * Tách riêng để test offline (không cần `nodes7` / PLC thật). Driver s7Driver.ts
 * dùng `s7AddrSpec` để dựng địa chỉ truyền cho NodeS7 (setTranslationCB) và dùng
 * `coerceS7Value` để chuẩn hoá giá trị NodeS7 trả về theo dataType của tag.
 *
 * LỰA CHỌN scale/offset: helper KHÔNG áp scale/offset (chỉ ép kiểu thuần). Driver
 * áp scale/offset SAU khi đọc — nhất quán với modbus/opcua F1.2.
 *
 * Cú pháp NodeS7 (xem README nodes7):
 *   - Data block:  "DB<n>,<TYPE><byteOffset>[.<bit>]"  vd "DB1,REAL0", "DB1,X14.0", "DB1,INT12"
 *   - Memory/IO bit/word:  "M32.2" (bit), "MR4" (real MD4), "MD4", "MW0", "I0.0", "Q0.0"...
 * Helper này CHỈ validate dạng & suy ra dataType gợi ý; địa chỉ gốc giữ nguyên để
 * truyền thẳng cho NodeS7 (lib tự parse). Nhờ vậy ta không phải tự encode lại S7.
 */
import type { OtDataType } from "../otDriver";

/** Địa chỉ S7 đã validate — giữ nguyên dạng gốc để truyền cho NodeS7. */
export interface ParsedS7Address {
  /** Địa chỉ NodeS7 gốc (đã trim, đã chuẩn hoá hoa). */
  s7: string;
  /** Là địa chỉ bit (X / Mx.y) → true (đọc về boolean). */
  isBit: boolean;
}

// Các tiền tố TYPE NodeS7 hợp lệ trong data block.
const DB_TYPES = ["X", "BYTE", "B", "CHAR", "C", "WORD", "W", "INT", "DWORD", "DW", "DINT", "DI", "REAL", "LREAL"] as const;

/**
 * Parse + validate địa chỉ S7 theo cú pháp NodeS7.
 *   - "DB1,REAL0"   → data block real
 *   - "DB1,X14.0"   → data block bit
 *   - "DB1,INT12"   → data block int16
 *   - "M0.0"        → memory bit
 *   - "MD4" / "MR4" → memory dword/real
 *   - "MW0" "I0.0" "Q0.0" "QW4" ...
 * Sai định dạng → throw. Trả về địa chỉ chuẩn hoá để truyền cho NodeS7.
 */
export function parseS7Address(address: string): ParsedS7Address {
  const a = String(address ?? "").trim();
  if (!a) throw new Error(`invalid S7 address: ${address}`);
  const up = a.toUpperCase();

  // Data block: DB<n>,<TYPE><offset>[.<bit>]
  const db = up.match(/^DB(\d+),([A-Z]+)(\d+)(?:\.(\d+))?$/);
  if (db) {
    const type = db[2];
    if (!DB_TYPES.includes(type as (typeof DB_TYPES)[number])) {
      throw new Error(`invalid S7 DB data type: ${type}`);
    }
    const isBit = type === "X";
    if (isBit && db[4] === undefined) {
      throw new Error(`S7 DB bit address requires .<bit>: ${address}`);
    }
    return { s7: up, isBit };
  }

  // Memory/IO/PI/PQ: <AREA><MODIFIER?><offset>[.<bit>]
  //   AREA: M (memory), I/E (input), Q/A (output), T, C
  //   MODIFIER: X bit, B byte, W word, D dword, R real, none = bit nếu có .bit
  const mem = up.match(/^([MIEQAT C]|PI|PQ)([XBWDR]?)(\d+)(?:\.(\d+))?$/);
  if (mem) {
    const modifier = mem[2];
    const hasBit = mem[4] !== undefined;
    // Bit khi: có chỉ định bit (.y) và không phải word/dword/real
    const isBit =
      (modifier === "X") || (modifier === "" && hasBit);
    return { s7: up, isBit };
  }

  throw new Error(`invalid S7 address: ${address}`);
}

/**
 * Ép giá trị thô NodeS7 trả về theo dataType khai báo (KHÔNG áp scale/offset).
 *   - giá trị BAD của NodeS7 (null/undefined) → {value:null, quality:"bad"}
 *   - bool → Boolean(raw)
 *   - int → ép Number (round), float → Number
 *   - string/json → String(raw)
 * Số NaN sau ép → quality:"bad".
 */
export interface CoercedS7Value {
  value: number | string | boolean | null;
  quality: "good" | "bad";
}

export function coerceS7Value(raw: unknown, dataType: OtDataType): CoercedS7Value {
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
