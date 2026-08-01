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

/**
 * ── BẢNG DEVICE-CODE HEX THẬT (spec-verified) ──────────────────────────────
 * Nguồn: MELSEC Communication Protocol Reference Manual (SH-081227ENG) §8.1
 *   "Device code list" p68; và SLMP Reference Manual (SH-080956ENG) §5.2
 *   "Device (Device Access)" p35-36. Binary code — iQ-R subcommand 0002/0003 =
 *   2 byte (00xxH); Q/L subcommand 0000/0001 = 1 byte (giá trị trong ngoặc):
 *
 *     SM 0091H(91)  SD 00A9H(A9)  X 009CH(9C)  Y 009DH(9D)  M 0090H(90)
 *     L 0092H(92)   F 0093H(93)   V 0094H(94)  B 00A0H(A0)  D 00A8H(A8)
 *     W 00B4H(B4)   TS 00C1H(C1)  TC 00C0H(C0) TN 00C2H(C2)
 *     STS 00C7H(C7="SS")  STC 00C6H(C6="SC")  STN 00C8H(C8="SN")
 *     CS 00C4H(C4)  CC 00C3H(C3)  CN 00C5H(C5) SB 00A1H(A1)  SW 00B5H(B5)
 *     S 0098H(98, step relay)     DX 00A2H(A2) DY 00A3H(A3)  Z 00CCH(CC)
 *     R 00AFH(AF)   ZR 00B0H(B0)  RD 002CH     LZ 0062H
 *     Long timer  LTS 0051H / LTC 0050H / LTN 0052H
 *     Long ret. timer  LSTS 0059H / LSTC 0058H / LSTN 005AH
 *     Long counter LCS 0055H / LCC 0054H / LCN 0056H   (iQ-R, subcmd 0002/0003)
 *     Module access U\G 00ABH · CPU buffer HG 002EH
 *   Notation (radix của SỐ device): HEX cho X Y B W SB SW DX DY Z; DECIMAL cho
 *   phần còn lại (SH-081227 p68, cột "Notation").
 *
 * ⚠️ Các mã hex TRÊN chỉ dùng khi mã hoá SLMP/MC 3E/4E frame — `mcprotocol`
 *   (1E frame) KHÔNG dùng: nó gửi ASCII device name (1 ký tự; 2 ký tự cho T/C).
 *   Bảng để lại cho SLMP-3E encoder tương lai (xem TODO M7 trong driver).
 * ───────────────────────────────────────────────────────────────────────────
 */

// Device kiểu BIT trong MELSEC (đọc về boolean). SỬA: TS/TC (timer contact/coil)
// và CS/CC (counter contact/coil) là BIT (00C1H/00C0H/00C4H/00C3H) — trước đây bị
// xếp NHẦM sang WORD (SH-081227 p68 / SLMP p35-36). S = step relay (0098H, bit).
const BIT_DEVICES = new Set([
  "M", "X", "Y", "B", "S", "L", "F", "SM", "SB", "DX", "DY", "V",
  "TS", "TC", "CS", "CC",
]);
// Device kiểu WORD hợp lệ (gồm tiền tố FLOAT). Trong nhóm timer/counter CHỈ
// TN (timer current 00C2H) và CN (counter current 00C5H) là WORD.
const WORD_DEVICES = new Set([
  "D", "R", "W", "ZR", "SD", "SW", "Z", "TN", "CN", "DFLOAT", "RFLOAT", "ZRFLOAT", "WFLOAT",
]);

// Device có SỐ viết HỆ 16 (Notation=Hexadecimal, SH-081227 p68). Còn lại hệ 10.
// SỬA: parser cũ chỉ nhận \d+ → LOẠI SAI địa chỉ hex hợp lệ ("X1A", "B1F0").
const HEX_NOTATION_DEVICES = new Set(["X", "Y", "B", "W", "SB", "SW", "DX", "DY", "Z"]);

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

  // <DEVICE letters><number>[.<bit>]. Số device có thể HỆ 16 cho device thuộc
  // HEX_NOTATION_DEVICES (X/Y/B/W/SB/SW/DX/DY/Z), HỆ 10 cho phần còn lại.
  const m = up.match(/^([A-Z]+)([0-9A-F]+)(?:\.([0-9A-F]+))?$/);
  if (!m) throw new Error(`invalid MC address: ${address}`);

  const device = m[1];
  const numPart = m[2];
  const hasBit = m[3] !== undefined;

  // Device hệ 10 nhưng số chứa A–F → địa chỉ sai (vd "D1A").
  if (!HEX_NOTATION_DEVICES.has(device) && /[A-F]/.test(numPart)) {
    throw new Error(`invalid MC address (decimal device with hex digit): ${address}`);
  }

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
