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
 *
 * NGOẠI LỆ (R1b-2b-2a T3C fix 1, I2 / M1): `kiemDiaChiS7` — MỘT vị từ "địa chỉ S7 ghi được đúng như yêu cầu" cho lúc LƯU, ghim STOP, lúc KHỞI
 * ĐỘNG / đọc cấu hình (scadaDiag) và driver — nạp bộ phân tích của CHÍNH nodes7 (createRequire, lười). Không nạp được / thiếu hàm ⇒ fail-closed.
 */
import { createRequire } from "node:module";
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

/**
 * T3C fix 1 (M1, fail-CLOSED) — không kiểm được địa chỉ bằng nodes7: thư viện không nạp được, hoặc hàm nội bộ mà các chốt cần
 * (`NodeS7.prototype.addItemsNow`; trong phiên: `writeItems`, `prepareWritePacket`, `prepareReadPacket`) vắng / không phải hàm. Ghi, đọc, lưu cấu
 * hình, ghim STOP ⇒ từ chối với mã này (không bao giờ bỏ qua kiểm). nodes7 ghim CHÍNH XÁC 0.3.18 (T3D) — mã này chỉ xuất hiện khi gói bị thay.
 */
export const MA_S7_THU_VIEN_KHONG_KIEM_DUOC = "OT_S7_THU_VIEN_KHONG_KIEM_DUOC";

/** T3C fix 1 (M1) — lỗi có kiểu của lượt ĐỌC bị từ chối fail-closed (message bắt đầu bằng mã). */
export class LoiS7KhongKiemDuoc extends Error {
  readonly ma = MA_S7_THU_VIEN_KHONG_KIEM_DUOC;
  constructor(lyDo: string) {
    super(lyDo);
    this.name = "LoiS7KhongKiemDuoc";
  }
}

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
 * T3C — item nodes7 dựng cho MỘT lời ghi có đúng là một giá trị đơn tại địa chỉ yêu cầu? Lý do sai, hoặc null. Bản thư viện: nodes7 0.3.18
 * (`stringToS7Addr` nodeS7.js:2315-2731): undefined = BỎ; `arrayLength` ≠ 1 = ghi MẢNG ("DB1,INT2.5", "MW0.3"); bit X ngoài 0..7 = ghi SAI bit
 * (vùng M / I / Q không kiểm, :2589-2596; con trỏ offset*8+bit :1621). `choMang` (chỉ phía ĐỌC của driver): mảng đọc json vẫn nhận.
 */
export function loiItemNodes7(item: unknown, choMang = false): string | null {
  if (!item || typeof item !== "object") return "dropped by the nodes7 address parser";
  const it = item as { datatype?: unknown; bitOffset?: unknown; arrayLength?: unknown };
  if (!choMang && it.arrayLength !== 1) return `read by the nodes7 address parser as an array of ${String(it.arrayLength)}`;
  if (it.datatype === "X" && !(typeof it.bitOffset === "number" && Number.isInteger(it.bitOffset) && it.bitOffset >= 0 && it.bitOffset <= 7)) {
    return `read by the nodes7 address parser as bit ${String(it.bitOffset)}`;
  }
  return null;
}

export type MaLoiDiaChiS7 = typeof MA_S7_BIT_NGOAI_DAI | typeof MA_S7_DIA_CHI_THU_VIEN_BO | typeof MA_S7_THU_VIEN_KHONG_KIEM_DUOC;
/** `lyDo` luôn bắt đầu bằng `<ma>: ` (tiền tố errorText mà maLoiCua nhận). */
export interface LoiDiaChiS7 {
  ma: MaLoiDiaChiS7;
  lyDo: string;
}

const require_ = createRequire(import.meta.url);

/**
 * Lớp NodeS7 THẬT (gói ghim) — nạp bằng require, KHÔNG qua `vi.doMock` của test: vị từ luôn là bộ phân tích thật. undefined = không nạp được.
 * Driver dùng nó để biết phiên có phải thư viện thật (khi đó chốt trong phiên là BẮT BUỘC).
 */
export function lopNodes7That(): { prototype?: Record<string, unknown> } | undefined {
  try {
    const m = require_("nodes7") as { prototype?: Record<string, unknown>; default?: { prototype?: Record<string, unknown> } };
    return m?.prototype ? m : m?.default;
  } catch {
    return undefined;
  }
}

const boNhoKiem = new Map<string, LoiDiaChiS7 | null>();

/**
 * ★ T3C fix 1 (I2 + M1) — MỘT vị từ: nodes7 0.3.18 có ghi địa chỉ S7 này ĐÚNG như yêu cầu không? null = có; ngược lại mã + lý do:
 *   1. `parseS7Address`: bit ∉ 0..7 ⇒ `OT_S7_BIT_NGOAI_DAI`; dạng sai khác ⇒ `OT_S7_DIA_CHI_THU_VIEN_BO`;
 *   2. bộ phân tích CỦA nodes7: `NodeS7.prototype.addItemsNow` (gọi `stringToS7Addr(translationCB(k), k, connectionParams)` rồi bỏ item undefined —
 *      cùng hàm, cùng đối số với `writeItems` :467-488) trên đối tượng TÁCH RỜI (không chạm phiên nào). Item bị BỎ ("MX0.1", "PQ0", "PI0", khoá
 *      "_COMMERR"…), đổi khoá, MẢNG ("DB1,INT2.5"), bit sai ⇒ `OT_S7_DIA_CHI_THU_VIEN_BO`;
 *   3. nodes7 không nạp được / `addItemsNow` không phải hàm ⇒ `OT_S7_THU_VIEN_KHONG_KIEM_DUOC` (fail-closed; kiểm MỖI lần gọi, trước bộ nhớ).
 * Dùng ở: lưu tag (deviceAdapter.tags.*, importMapping), ghim STOP, khởi động / scadaDiag (`lyDoCauHinhDiaChiS7`), driver ghi (lớp 2) và đọc.
 * `khoa` = tagKey (nodes7 bỏ riêng "_COMMERR"); `choMang` CHỈ cho đọc của driver. Kết quả nhớ theo (chế độ, khoá, địa chỉ) — trần 4096.
 */
export function kiemDiaChiS7(address: string, khoa = "tag", choMang = false): LoiDiaChiS7 | null {
  let s7: string;
  try {
    s7 = parseS7Address(address).s7;
  } catch (e) {
    if (laLoiS7BitNgoaiDai(e)) return { ma: MA_S7_BIT_NGOAI_DAI, lyDo: e.message };
    return { ma: MA_S7_DIA_CHI_THU_VIEN_BO, lyDo: `${MA_S7_DIA_CHI_THU_VIEN_BO}: ${(e as Error)?.message ?? String(e)} - not an S7 address nodes7 can write` };
  }
  const addItemsNow = lopNodes7That()?.prototype?.addItemsNow;
  if (typeof addItemsNow !== "function") {
    return {
      ma: MA_S7_THU_VIEN_KHONG_KIEM_DUOC,
      lyDo: `${MA_S7_THU_VIEN_KHONG_KIEM_DUOC}: the nodes7 address parser (NodeS7.prototype.addItemsNow) is unavailable - address "${s7}" cannot be checked; refused`,
    };
  }
  const khoaNho = JSON.stringify([choMang, khoa, s7]);
  const daNho = boNhoKiem.get(khoaNho);
  if (daNho !== undefined) return daNho;
  const tach = {
    polledReadBlockList: [] as unknown[],
    translationCB: (k: string) => (k === khoa ? s7 : undefined),
    connectionParams: {},
    connectionID: "t3c-probe",
    readPacketValid: false,
  };
  let ly: string | null;
  try {
    addItemsNow.call(tach, [khoa]);
    const ds = tach.polledReadBlockList;
    ly =
      ds.length !== 1
        ? "dropped by the nodes7 address parser"
        : (ds[0] as { useraddr?: unknown }).useraddr !== khoa
          ? "renamed by the nodes7 address parser"
          : loiItemNodes7(ds[0], choMang);
  } catch (e) {
    ly = `the nodes7 address parser threw (${(e as Error)?.message ?? String(e)})`;
  }
  const kq: LoiDiaChiS7 | null = ly ? { ma: MA_S7_DIA_CHI_THU_VIEN_BO, lyDo: `${MA_S7_DIA_CHI_THU_VIEN_BO}: address "${s7}" ${ly}` } : null;
  if (boNhoKiem.size > 4096) boNhoKiem.clear();
  boNhoKiem.set(khoaNho, kq);
  return kq;
}

/**
 * T3C mục 5 + fix 1 (I2) — lý do NGẮN (không host / cổng) khi cấu hình đã lưu có tag S7 mà `kiemDiaChiS7` từ chối; null khi không có. Mã đứng đầu:
 * `OT_S7_THU_VIEN_KHONG_KIEM_DUOC` nếu có, `OT_S7_BIT_NGOAI_DAI` nếu MỌI tag hỏng là bit ngoài dải, ngược lại `OT_S7_DIA_CHI_THU_VIEN_BO`.
 * Bề mặt người dùng thấy: cột "Lỗi gần nhất" của scadaDiag (đọc cấu hình). Driver cũng gắn vào health().lastError lúc subscribe (chưa ai đọc ở
 * sản xuất — M3).
 */
export function lyDoCauHinhDiaChiS7(tags: ReadonlyArray<{ tagKey: string; address: string | null | undefined }>): string | null {
  const hong = tags.flatMap((t) => {
    const l = kiemDiaChiS7(String(t.address ?? ""), t.tagKey);
    return l ? [{ t, l }] : [];
  });
  if (hong.length === 0) return null;
  const ma: MaLoiDiaChiS7 = hong.some((h) => h.l.ma === MA_S7_THU_VIEN_KHONG_KIEM_DUOC)
    ? MA_S7_THU_VIEN_KHONG_KIEM_DUOC
    : hong.every((h) => h.l.ma === MA_S7_BIT_NGOAI_DAI)
      ? MA_S7_BIT_NGOAI_DAI
      : MA_S7_DIA_CHI_THU_VIEN_BO;
  const nhan = (m: MaLoiDiaChiS7) => (m === MA_S7_BIT_NGOAI_DAI ? "bit outside 0..7" : m === MA_S7_DIA_CHI_THU_VIEN_BO ? "not writable as given by nodes7" : "cannot be checked");
  const ds = hong
    .slice(0, 5)
    .map((h) => `${h.t.tagKey}=${String(h.t.address).trim()} [${nhan(h.l.ma)}]`)
    .join(", ");
  return `${ma}: ${hong.length} tag(s) have an S7 address the S7 library cannot write as given (${ds}${hong.length > 5 ? ", ..." : ""}) - writes to them are refused, reads fail as an invalid address`;
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
