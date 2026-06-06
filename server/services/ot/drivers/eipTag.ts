/**
 * Sprint F1.3 — EtherNet/IP (Allen-Bradley CIP) tag helpers (THUẦN, không import lib/I-O).
 *
 * Tách riêng để test offline (không cần `st-ethernet-ip` / PLC thật). Driver
 * ethernetIpDriver.ts dùng `parseEipTag` để tách tên tag + scope (program),
 * truyền cho `PLC.newTag(name, program)`, và `coerceEipValue` để chuẩn hoá giá trị.
 *
 * scale/offset KHÔNG áp ở helper — driver áp sau, nhất quán F1.2.
 *
 * Cú pháp địa chỉ (quy ước nội bộ, map sang ControlLogix tag):
 *   - "MyTag"                     → controller-scope tag, program=null
 *   - "Program:MainProgram.MyTag" → program-scope tag, program="MainProgram", name="MyTag"
 *   - "MyUDT.Member"              → controller tag với member path (giữ nguyên trong name)
 *   - "MyArray[3]"                → phần tử mảng (giữ nguyên trong name)
 */
import type { OtDataType } from "../otDriver";

export interface ParsedEipTag {
  /** Tên tag truyền cho newTag(name, ...). */
  name: string;
  /** Program scope (null = controller scope). */
  program: string | null;
}

/**
 * Parse địa chỉ tag EtherNet/IP.
 *   - "Program:Prog.Tag" → {name:"Tag", program:"Prog"}
 *   - "Tag" / "UDT.Member" / "Arr[2]" → {name, program:null}
 * Sai định dạng (rỗng) → throw.
 */
export function parseEipTag(address: string): ParsedEipTag {
  const a = String(address ?? "").trim();
  if (!a) throw new Error(`invalid EtherNet/IP tag: ${address}`);

  // Program-scope: "Program:<ProgName>.<TagPath>"
  const prog = a.match(/^Program:([A-Za-z_][A-Za-z0-9_]*)\.(.+)$/);
  if (prog) {
    const program = prog[1];
    const name = prog[2].trim();
    if (!name) throw new Error(`invalid EtherNet/IP tag (empty name): ${address}`);
    return { name, program };
  }

  // Controller-scope: tên tag (có thể chứa .member và [index])
  if (!/^[A-Za-z_][A-Za-z0-9_.[\]]*$/.test(a)) {
    throw new Error(`invalid EtherNet/IP tag: ${address}`);
  }
  return { name: a, program: null };
}

export interface CoercedEipValue {
  value: number | string | boolean | null;
  quality: "good" | "bad";
}

/**
 * Ép giá trị tag.value (st-ethernet-ip) theo dataType (KHÔNG áp scale/offset).
 *   - null/undefined → {value:null, quality:"bad"}
 *   - bool → Boolean; int → round; float → Number; string/json → String/serialize
 * NaN sau ép → quality:"bad".
 */
export function coerceEipValue(raw: unknown, dataType: OtDataType): CoercedEipValue {
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
