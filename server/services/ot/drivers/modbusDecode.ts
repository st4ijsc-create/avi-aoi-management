/**
 * Sprint F1.2 — Modbus address + decode helpers (THUẦN, không import lib/I-O).
 *
 * Tách riêng để test offline (không cần modbus-serial / thiết bị thật).
 *
 * LỰA CHỌN scale/offset: decodeModbus chỉ trả RAW number/boolean (KHÔNG áp
 * scale/offset). Driver modbusDriver.ts áp scale/offset SAU decode — nhất quán
 * cách normalizeOpcuaValue áp scale/offset (cùng nằm "tại tầng driver" về mặt
 * ngữ nghĩa). Lý do: word→số là phép giải mã thuần kỹ thuật, còn scale/offset là
 * hiệu chỉnh kỹ thuật theo tag, để driver áp giúp hai protocol đồng nhất.
 */
import type { OtDataType } from "../otDriver";

export type ModbusRegisterType = "holding" | "input" | "coil" | "discrete";

export interface ParsedModbusAddress {
  registerType: ModbusRegisterType;
  /** Địa chỉ 0-based truyền cho modbus-serial. */
  register: number;
}

/**
 * Parse địa chỉ Modbus. Hỗ trợ:
 *   - Dạng có tiền tố: "holding:40001" | "input:30001" | "coil:1" | "discrete:1"
 *   - Dạng "Nx:offset":  "4x:1" (holding) | "3x:1" (input) | "1x:1" (discrete) | "0x:1" (coil)
 *   - Dạng Modicon thuần số: 4xxxx→holding, 3xxxx→input, 1xxxx→discrete, 0xxxx→coil
 *
 * Quy ước Modicon 1-based → register 0-based: 40001 → 0, 30001 → 0, 1 (coil 00001) → 0.
 * Sai định dạng → throw.
 */
export function parseModbusAddress(address: string): ParsedModbusAddress {
  const a = String(address ?? "").trim().toLowerCase();
  if (!a) throw new Error(`invalid Modbus address: ${address}`);

  // Dạng có tiền tố tên: "holding:40001", "coil:1", ...
  const namedMatch = a.match(/^(holding|input|coil|discrete):(\d+)$/);
  if (namedMatch) {
    const type = namedMatch[1] as ModbusRegisterType;
    const num = Number(namedMatch[2]);
    return { registerType: type, register: modiconToZeroBased(type, num) };
  }

  // Dạng "Nx:offset": 4x:1, 3x:1, 1x:1, 0x:1 (offset là 1-based)
  const xMatch = a.match(/^([0134])x:(\d+)$/);
  if (xMatch) {
    const type = bankToType(xMatch[1]);
    const offset = Number(xMatch[2]);
    if (offset < 1) throw new Error(`invalid Modbus address: ${address}`);
    return { registerType: type, register: offset - 1 };
  }

  // Dạng Modicon thuần số: 40001, 30001, 10001, 00001 / hoặc số nhỏ (coil)
  const numMatch = a.match(/^(\d+)$/);
  if (numMatch) {
    const num = Number(numMatch[1]);
    const type = modiconBankFromNumber(num);
    return { registerType: type, register: modiconToZeroBased(type, num) };
  }

  throw new Error(`invalid Modbus address: ${address}`);
}

function bankToType(bank: string): ModbusRegisterType {
  switch (bank) {
    case "0":
      return "coil";
    case "1":
      return "discrete";
    case "3":
      return "input";
    case "4":
      return "holding";
    default:
      throw new Error(`invalid Modbus bank: ${bank}`);
  }
}

/** Suy ra bank từ một số Modicon đầy đủ (4xxxx/3xxxx/1xxxx/0xxxx). */
function modiconBankFromNumber(num: number): ModbusRegisterType {
  if (num >= 40001 && num <= 49999) return "holding";
  if (num >= 30001 && num <= 39999) return "input";
  if (num >= 10001 && num <= 19999) return "discrete";
  // 1..9999 (hoặc 00001..09999) → coil
  if (num >= 1 && num <= 9999) return "coil";
  throw new Error(`invalid Modicon register: ${num}`);
}

/** Chuyển số Modicon 1-based về offset 0-based theo bank. */
function modiconToZeroBased(type: ModbusRegisterType, num: number): number {
  let base: number;
  switch (type) {
    case "holding":
      base = 40000;
      break;
    case "input":
      base = 30000;
      break;
    case "discrete":
      base = 10000;
      break;
    case "coil":
      base = 0;
      break;
  }
  // Nếu người dùng đã truyền dạng đầy đủ (>= base) → trừ base; ngược lại coi là 1-based thuần.
  const oneBased = num > base ? num - base : num;
  if (oneBased < 1) throw new Error(`invalid Modbus register offset: ${num}`);
  return oneBased - 1;
}

/**
 * Số word (16-bit register) cần đọc cho một dataType.
 *   bool / int → 1 word
 *   float / int32 / uint32 → 2 word
 * (Tham số `bytes` để mở rộng tương lai; hiện chưa dùng.)
 */
export function wordCountFor(dataType: OtDataType, _bytes?: number): number {
  switch (dataType) {
    case "bool":
    case "int":
    case "string":
    case "json":
      return 1;
    case "float":
      return 2;
    default:
      return 1;
  }
}

export interface DecodeModbusOpts {
  /** Thứ tự byte trong mỗi word khi đọc float (mặc định big). */
  endianness?: "big" | "little";
  /** Thứ tự ghép 2 word cho float32 (mặc định big = word cao trước). */
  wordOrder?: "big" | "little";
  /** int 1-word: signed (int16) mặc định true; false → uint16. */
  signed?: boolean;
}

/**
 * Giải mã mảng word (mỗi phần tử là 16-bit 0..65535) về số/boolean RAW.
 * KHÔNG áp scale/offset (xem ghi chú đầu file).
 *
 *   - bool → Boolean(words[0])
 *   - int  → int16 (signed mặc định) hoặc uint16 từ words[0]
 *   - float → float32 ghép 2 word theo wordOrder, đọc theo endianness
 */
export function decodeModbus(
  words: number[],
  dataType: OtDataType,
  opts: DecodeModbusOpts = {},
): number | boolean {
  const endianness = opts.endianness ?? "big";
  const wordOrder = opts.wordOrder ?? "big";
  const signed = opts.signed ?? true;

  switch (dataType) {
    case "bool":
      return Boolean(words[0]);

    case "int": {
      const w = words[0] & 0xffff;
      if (signed) {
        // int16: bù 2
        return w >= 0x8000 ? w - 0x10000 : w;
      }
      return w;
    }

    case "float": {
      if (words.length < 2) throw new Error("decodeModbus: float requires 2 words");
      const hi = words[0] & 0xffff;
      const lo = words[1] & 0xffff;
      // wordOrder big → word cao (hi) đứng trước; little → swap.
      const first = wordOrder === "big" ? hi : lo;
      const second = wordOrder === "big" ? lo : hi;
      const buf = Buffer.alloc(4);
      buf.writeUInt16BE(first, 0);
      buf.writeUInt16BE(second, 2);
      return endianness === "big" ? buf.readFloatBE(0) : buf.readFloatLE(0);
    }

    default:
      // int kiểu khác / string / json không decode số → trả word đầu thô
      return words[0] & 0xffff;
  }
}

/**
 * Mã hoá một số RAW thành mảng word (16-bit) để GHI xuống Modbus — đối xứng
 * decodeModbus (round-trip encode→decode trả lại giá trị gốc với cùng opts).
 *
 *   - bool → [value ? 1 : 0]
 *   - int  → 1 word: int16 (signed) hoặc uint16, kẹp & 0xffff
 *   - float → float32 ghép 2 word theo wordOrder + endianness
 *
 * KHÔNG áp scale/offset (driver đã inverse-scale trước khi gọi). Dùng cho coil
 * (1 word) và holding register.
 */
export function encodeModbus(
  value: number | boolean,
  dataType: OtDataType,
  opts: DecodeModbusOpts = {},
): number[] {
  const endianness = opts.endianness ?? "big";
  const wordOrder = opts.wordOrder ?? "big";

  switch (dataType) {
    case "bool":
      return [value ? 1 : 0];

    case "float": {
      const buf = Buffer.alloc(4);
      if (endianness === "big") buf.writeFloatBE(Number(value), 0);
      else buf.writeFloatLE(Number(value), 0);
      const first = buf.readUInt16BE(0);
      const second = buf.readUInt16BE(2);
      // wordOrder big → first(hi) đứng trước; little → swap.
      return wordOrder === "big" ? [first, second] : [second, first];
    }

    case "int":
    default: {
      // int16/uint16: ép về 16-bit không dấu để gửi xuống.
      return [Math.round(Number(value)) & 0xffff];
    }
  }
}
