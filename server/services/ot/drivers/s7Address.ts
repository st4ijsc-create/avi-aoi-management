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
import { laMauBadThuVien } from "../chatLuong";
import { giaiMaBoolDoc } from "./boolNghiem";

/** Địa chỉ S7 đã validate — giữ nguyên dạng gốc để truyền cho NodeS7. */
export interface ParsedS7Address {
  /** Địa chỉ NodeS7 gốc (đã trim, đã chuẩn hoá hoa). */
  s7: string;
  /** Là địa chỉ bit (X / Mx.y) → true (đọc về boolean). */
  isBit: boolean;
  /**
   * G2.1 — vùng CHỈ ĐỌC trên PLC (process inputs): area I/E (digital inputs) và
   * PI (peripheral inputs). writeTags với địa chỉ này → ok:false "register type
   * not writable" (không gửi xuống thiết bị). DB/M/Q/A/PQ là ghi được.
   */
  isReadOnly: boolean;
}

// Các tiền tố TYPE NodeS7 hợp lệ trong data block.
const DB_TYPES = ["X", "BYTE", "B", "CHAR", "C", "WORD", "W", "INT", "DWORD", "DW", "DINT", "DI", "REAL", "LREAL"] as const;

/**
 * SCADA R1b-2b-2a T3C (backlog 87, AN TOÀN) — địa chỉ BIT có số bit ∉ 0..7 (một byte chỉ có bit 0..7). nodes7 0.3.18 với địa chỉ ấy:
 *   • "DB<n>,X<o>.<b>", b > 7 ⇒ `stringToS7Addr` trả undefined (nodeS7.js:2361-2364) ⇒ `writeItems` lặng lẽ BỎ item (:483-488); bỏ HẾT ⇒
 *     `prepareWritePacket` trả sớm (:673-676) trước khi xoá `writePacketArray` (:750-751) ⇒ GỬI LẠI gói ghi trước + báo ok (đo: s7BitNgoaiDai.r1b2b2.test.ts);
 *   • vùng M / I / Q ("M0.8") ⇒ KHÔNG kiểm (:2589-2596) ⇒ con trỏ offset*8+bit (:1621) = ghi SAI bit (M0.8 ⇒ M1.0).
 * Từ chối ở `parseS7Address` (lúc ghi, lúc đọc) VÀ lúc lưu cấu hình tag (`loiBitNgoaiDaiS7`); `writeTags` từ chối CẢ lô chứa địa chỉ ấy.
 */
export const MA_S7_BIT_NGOAI_DAI = "OT_S7_BIT_NGOAI_DAI";

/**
 * T3C (phòng thủ hai) — địa chỉ mà CHÍNH bộ phân tích của nodes7 0.3.18 sẽ BỎ hoặc hiểu KHÁC lời ghi được yêu cầu (vd "MX0.1": `parseS7Address`
 * nhận nhưng nodes7 không có vùng "MX"; "DB1,INT2.5" = mảng 5 INT), hoặc danh sách nodes7 dựng trong phiên khác danh sách yêu cầu (kể cả rỗng ⇒
 * phát lại gói cũ). s7Driver từ chối CẢ lô, không gói nào. Hằng ở đây (tệp nằm trong nguồn suy của maLoiDaBietCensus).
 */
export const MA_S7_DIA_CHI_THU_VIEN_BO = "OT_S7_DIA_CHI_THU_VIEN_BO";

export class LoiS7BitNgoaiDai extends Error {
  readonly ma = MA_S7_BIT_NGOAI_DAI;
  constructor(
    readonly diaChi: string,
    readonly bit: number,
  ) {
    super(`${MA_S7_BIT_NGOAI_DAI}: S7 bit address "${diaChi}" names bit ${bit} - a byte has bits 0..7 only; nothing sent`);
    this.name = "LoiS7BitNgoaiDai";
  }
}

export function laLoiS7BitNgoaiDai(e: unknown): e is LoiS7BitNgoaiDai {
  return e instanceof LoiS7BitNgoaiDai;
}

function kiemBit(address: string, isBit: boolean, bitStr: string | undefined): void {
  if (!isBit || bitStr === undefined) return;
  const bit = Number(bitStr);
  if (!(bit >= 0 && bit <= 7)) throw new LoiS7BitNgoaiDai(address, bit);
}

/**
 * T3C — lỗi "bit ngoài 0..7" của một địa chỉ S7 (dùng lúc LƯU cấu hình / đọc cấu hình), null nếu không phải lớp lỗi này. CHỈ lớp này: địa chỉ sai
 * dạng khác giữ hành vi cũ (không chặn lúc lưu; driver từ chối lúc ghi / đọc).
 */
export function loiBitNgoaiDaiS7(address: string): LoiS7BitNgoaiDai | null {
  try {
    parseS7Address(address);
    return null;
  } catch (e) {
    return laLoiS7BitNgoaiDai(e) ? e : null;
  }
}

/**
 * T3C mục 5 — lý do NGẮN (không host / cổng) khi cấu hình đã lưu có tag S7 bit ∉ 0..7: "OT_S7_BIT_NGOAI_DAI: 2 tag(s) … : stop=DB1,X0.9, …".
 * null khi không có. Dùng ở health().lastError của driver (lúc subscribe = khởi động) và cột "Lỗi gần nhất" của scadaDiag (đọc cấu hình).
 */
export function lyDoCauHinhBitNgoaiDaiS7(tags: ReadonlyArray<{ tagKey: string; address: string | null | undefined }>): string | null {
  const hong = tags.filter((t) => loiBitNgoaiDaiS7(String(t.address ?? "")) !== null);
  if (hong.length === 0) return null;
  const ds = hong.slice(0, 5).map((t) => `${t.tagKey}=${String(t.address).trim()}`).join(", ");
  return `${MA_S7_BIT_NGOAI_DAI}: ${hong.length} tag(s) name a bit outside 0..7 (${ds}${hong.length > 5 ? ", ..." : ""}) - writes to them are refused, reads fail as an invalid address`;
}

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
    kiemBit(a, isBit, db[4]); // T3C
    // Data blocks are always writable.
    return { s7: up, isBit, isReadOnly: false };
  }

  // Memory/IO/PI/PQ: <AREA><MODIFIER?><offset>[.<bit>]
  //   AREA: M (memory), I/E (input), Q/A (output), T, C
  //   MODIFIER: X bit, B byte, W word, D dword, R real, none = bit nếu có .bit
  const mem = up.match(/^([MIEQAT C]|PI|PQ)([XBWDR]?)(\d+)(?:\.(\d+))?$/);
  if (mem) {
    const area = mem[1];
    const modifier = mem[2];
    const hasBit = mem[4] !== undefined;
    // Bit khi: có chỉ định bit (.y) và không phải word/dword/real
    const isBit =
      (modifier === "X") || (modifier === "" && hasBit);
    // Process INPUTS là read-only: I/E (digital input), PI (peripheral input).
    const isReadOnly = area === "I" || area === "E" || area === "PI";
    kiemBit(a, isBit, mem[4]); // T3C
    return { s7: up, isBit, isReadOnly };
  }

  throw new Error(`invalid S7 address: ${address}`);
}

/**
 * Ép giá trị thô NodeS7 trả về theo dataType khai báo (KHÔNG áp scale/offset).
 *   - giá trị BAD của NodeS7 → {value:null, quality:"bad"}: null/undefined, VÀ chuỗi chất lượng "BAD <mã>" mà nodes7 đặt vào chỗ giá trị
 *     cho item lỗi (R1b-2a T13 fix round 2, I2 — `laGiaTriBadThuVien`; trước đây bool đọc TRUE / string đọc "BAD 255" là good)
 *   - bool → `giaiMaBoolDoc(raw)` (R1b-2b-1 T2; chuỗi lạ ⇒ bad)
 *   - int → ép Number (round), float → Number
 *   - string/json → String(raw)
 * Số NaN sau ép → quality:"bad".
 */
export interface CoercedS7Value {
  value: number | string | boolean | null;
  quality: "good" | "bad";
}

export function coerceS7Value(raw: unknown, dataType: OtDataType, tuyChon?: { thuVienBaoLoi?: boolean }): CoercedS7Value {
  if (raw === null || raw === undefined || laMauBadThuVien(raw, dataType, tuyChon?.thuVienBaoLoi ?? true)) {
    return { value: null, quality: "bad" };
  }
  switch (dataType) {
    case "bool": {
      // R1b-2b-1 T2 — MỘT luật bool phía ĐỌC (`giaiMaBoolDoc`): số khác 0 ⇒ TRUE, "false" ⇒ FALSE, chuỗi lạ ⇒ bad (trước: `Boolean("x")` = TRUE).
      const b = giaiMaBoolDoc(raw);
      return b === undefined ? { value: null, quality: "bad" } : { value: b, quality: "good" };
    }
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
