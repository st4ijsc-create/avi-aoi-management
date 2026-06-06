/**
 * Sprint F1.2 — OPC-UA address + value helpers (THUẦN, không import lib/I-O).
 *
 * Tách riêng để test offline (không cần node-opcua / thiết bị thật). Driver
 * opcuaDriver.ts dùng các hàm này để parse nodeId và chuẩn hoá giá trị đọc về.
 */
import type { OtDataType } from "../otDriver";

/** Một nodeId OPC-UA đã được validate. */
export interface ParsedOpcuaAddress {
  nodeId: string;
}

/**
 * Parse + validate một địa chỉ OPC-UA dạng nodeId.
 * Hỗ trợ định danh: i (numeric), s (string), g (guid), b (bytestring).
 * Ví dụ hợp lệ: "ns=2;s=Temperature", "ns=0;i=2258".
 * Sai định dạng → throw.
 */
export function parseOpcuaAddress(address: string): ParsedOpcuaAddress {
  const nodeId = String(address ?? "").trim();
  // ns=<digits>;<i|s|g|b>=<anything-non-empty>
  if (!/^ns=\d+;[isgb]=.+$/.test(nodeId)) {
    throw new Error(`invalid OPC-UA nodeId: ${address}`);
  }
  return { nodeId };
}

/** Kết quả chuẩn hoá: giá trị + chất lượng good/bad. */
export interface NormalizedOpcuaValue {
  value: number | string | boolean | null;
  quality: "good" | "bad";
}

/**
 * Chuẩn hoá giá trị thô đọc từ OPC-UA về kiểu khai báo của tag, áp scale/offset.
 *
 * - raw null/undefined → {value:null, quality:"bad"}.
 * - bool → Boolean(raw).
 * - int → Math.round(Number(raw)*scale+offset).
 * - float → Number(raw)*scale+offset.
 * - string → String(raw).
 * - json → object (giữ nguyên) hoặc JSON.parse nếu là chuỗi.
 *
 * scale default 1, offset default 0. Số NaN sau khi ép → quality:"bad".
 */
export function normalizeOpcuaValue(
  raw: unknown,
  dataType: OtDataType,
  scale = 1,
  offset = 0,
): NormalizedOpcuaValue {
  if (raw === null || raw === undefined) {
    return { value: null, quality: "bad" };
  }

  const s = scale ?? 1;
  const o = offset ?? 0;

  switch (dataType) {
    case "bool":
      return { value: Boolean(raw), quality: "good" };

    case "int": {
      const n = Number(raw) * s + o;
      if (Number.isNaN(n)) return { value: null, quality: "bad" };
      return { value: Math.round(n), quality: "good" };
    }

    case "float": {
      const n = Number(raw) * s + o;
      if (Number.isNaN(n)) return { value: null, quality: "bad" };
      return { value: n, quality: "good" };
    }

    case "string":
      return { value: String(raw), quality: "good" };

    case "json": {
      if (typeof raw === "string") {
        try {
          // JSON.parse có thể trả object/array → lưu lại dạng chuỗi chuẩn hoá.
          const parsed = JSON.parse(raw);
          return { value: JSON.stringify(parsed), quality: "good" };
        } catch {
          return { value: null, quality: "bad" };
        }
      }
      // object/array → serialize để khớp kiểu OtSample.value (string|number|boolean|null)
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
