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
  /**
   * doc 81 Đợt 1B Task 12 — dạng `nsu=<uri>;<id>`: URI namespace (chỉ số ns do server cấp,
   * có thể đổi sau khi tải lại project PLC ⇒ driver phân giải qua NamespaceArray mỗi phiên).
   */
  namespaceUri?: string;
  /** Phần định danh `i=…|s=…|g=…|b=…` (chỉ có ở dạng nsu=). */
  identifier?: string;
}

/**
 * Parse + validate một địa chỉ OPC-UA dạng nodeId.
 * Hỗ trợ định danh: i (numeric), s (string), g (guid), b (bytestring).
 * Ví dụ hợp lệ: "ns=2;s=Temperature", "ns=0;i=2258",
 * "nsu=http://www.siemens.com/simatic-s7-opcua;s=DB1.Temp" (Task 12).
 * Sai định dạng → throw.
 */
/**
 * doc 81 Đợt 1B final wave (item 4, F3 census) — lỗi về MỘT NODE có mã: địa chỉ nodeId sai
 * định dạng, hoặc không đọc được DataType của node. Người nhận là OpcuaDriver (resolveAddress /
 * writeTags bắt và đưa vào lý do "bad"/`error` của ĐÚNG tag đó, không kéo sập batch). Message giữ
 * nguyên văn; `reasonCode` là phần máy-đọc.
 */
export type OpcuaNodeReason = "opcua_invalid_node_id" | "opcua_datatype_unknown";

export class OpcuaNodeError extends Error {
  readonly reasonCode: OpcuaNodeReason;
  constructor(reasonCode: OpcuaNodeReason, message: string) {
    super(message);
    this.name = "OpcuaNodeError";
    this.reasonCode = reasonCode;
  }
}

export function parseOpcuaAddress(address: string): ParsedOpcuaAddress {
  const nodeId = String(address ?? "").trim();
  // ns=<digits>;<i|s|g|b>=<anything-non-empty>
  if (/^ns=\d+;[isgb]=.+$/.test(nodeId)) {
    return { nodeId };
  }
  // nsu=<uri không rỗng>;<i|s|g|b>=<anything-non-empty> — URI dừng ở ";x=" ĐẦU TIÊN.
  const m = /^nsu=(.+?);([isgb]=.+)$/.exec(nodeId);
  if (m && m[1].trim()) {
    return { nodeId, namespaceUri: m[1], identifier: m[2] };
  }
  throw new OpcuaNodeError("opcua_invalid_node_id", `invalid OPC-UA nodeId: ${address}`);
}

// ── doc 81 Đợt 1B Task 12 — ghi đúng kiểu dựng sẵn của node ───────────────────────
// Mã DataType dựng sẵn theo OPC UA Part 6 §5.1.2 (node-opcua `DataType` dùng cùng số).
export const OPCUA_BUILTIN = {
  Boolean: 1,
  SByte: 2,
  Byte: 3,
  Int16: 4,
  UInt16: 5,
  Int32: 6,
  UInt32: 7,
  Int64: 8,
  UInt64: 9,
  Float: 10,
  Double: 11,
  String: 12,
} as const;

const BUILTIN_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(OPCUA_BUILTIN).map(([k, v]) => [v, k]),
);

/**
 * Miền số nguyên theo Part 3. Int64/UInt64 kẹp vào miền mà Variant của node-opcua 2.174 MÃ
 * HOÁ ĐƯỢC từ một number (đo: Int64 −4294967297 ⇒ Variant ném Error("") rỗng; ≥ −2^32 và
 * ≤ 2^53−1 thì đúng) — fix round 1 #4.
 */
const INT_RANGE: Record<number, [number, number]> = {
  [OPCUA_BUILTIN.SByte]: [-128, 127],
  [OPCUA_BUILTIN.Byte]: [0, 255],
  [OPCUA_BUILTIN.Int16]: [-32768, 32767],
  [OPCUA_BUILTIN.UInt16]: [0, 65535],
  [OPCUA_BUILTIN.Int32]: [-2147483648, 2147483647],
  [OPCUA_BUILTIN.UInt32]: [0, 4294967295],
  [OPCUA_BUILTIN.Int64]: [-4294967296, Number.MAX_SAFE_INTEGER],
  [OPCUA_BUILTIN.UInt64]: [0, Number.MAX_SAFE_INTEGER],
};

/**
 * Trần Float: FLT_MAX như thường viết (3.4028235e38 — làm tròn về float32 vẫn ra FLT_MAX
 * 3.4028234663852886e38). Fix round 1 #4. Double: mọi số HỮU HẠN; NaN/±Infinity bị từ chối
 * (toFiniteNumber) — không ghi NaN/Inf xuống PLC.
 */
const FLOAT32_MAX = 3.4028235e38;

/** Tên kiểu dựng sẵn (cho thông điệp lỗi). */
export function opcuaBuiltinName(builtinType: number): string {
  return BUILTIN_NAME[builtinType] ?? `builtin#${builtinType}`;
}

export type CoercedOpcuaWrite =
  | { ok: true; dataType: number; value: number | boolean | string }
  | { ok: false; error: string };

function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Ép giá trị ghi về ĐÚNG kiểu dựng sẵn của node (đọc từ thuộc tính DataType) + kiểm miền.
 * THUẦN. Trước Task 12 driver luôn gửi Int32/Double ⇒ server trả BadTypeMismatch với
 * Float/Int16/UInt16/UInt32/Byte (BE1 §1.1). Ngoài miền / sai dạng ⇒ ok:false (không gửi).
 */
export function coerceOpcuaWriteValue(raw: unknown, builtinType: number): CoercedOpcuaWrite {
  const name = BUILTIN_NAME[builtinType];
  if (!name) {
    return { ok: false, error: `unsupported OPC UA data type (builtin id ${builtinType}) for write` };
  }
  if (builtinType === OPCUA_BUILTIN.Boolean) {
    if (typeof raw === "boolean") return { ok: true, dataType: builtinType, value: raw };
    if (raw === 0 || raw === 1) return { ok: true, dataType: builtinType, value: raw === 1 };
    if (typeof raw === "string") {
      const s = raw.trim().toLowerCase();
      if (s === "true" || s === "1") return { ok: true, dataType: builtinType, value: true };
      if (s === "false" || s === "0") return { ok: true, dataType: builtinType, value: false };
    }
    return { ok: false, error: `value ${JSON.stringify(raw)} is not a Boolean (true/false/0/1)` };
  }
  if (builtinType === OPCUA_BUILTIN.String) {
    if (raw === null || raw === undefined) return { ok: false, error: "value is empty for String" };
    return { ok: true, dataType: builtinType, value: typeof raw === "string" ? raw : String(raw) };
  }
  const n = toFiniteNumber(raw);
  if (n === null) return { ok: false, error: `value ${JSON.stringify(raw)} is not a finite number for ${name}` };
  if (builtinType === OPCUA_BUILTIN.Double) return { ok: true, dataType: builtinType, value: n };
  if (builtinType === OPCUA_BUILTIN.Float) {
    if (Math.abs(n) > FLOAT32_MAX) return { ok: false, error: `value ${n} out of range for Float` };
    return { ok: true, dataType: builtinType, value: n };
  }
  const range = INT_RANGE[builtinType];
  const r = Math.round(n);
  if (Math.abs(n - r) > 1e-9) return { ok: false, error: `value ${n} is not an integer for ${name}` };
  if (r < range[0] || r > range[1]) {
    return { ok: false, error: `value ${r} out of range for ${name} [${range[0]}..${range[1]}]` };
  }
  return { ok: true, dataType: builtinType, value: r };
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
