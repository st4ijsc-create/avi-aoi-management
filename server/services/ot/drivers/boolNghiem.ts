/**
 * SCADA R1b-2b-1 Task 2 (kiem-dinh G1) — MỘT luật bool cho mọi bên: cổng kênh của `dispatch()`, mọi driver GHI, mọi bộ giải mã ĐỌC và phép so
 * đọc lại. THUẦN (không I/O, không import gì của driver).
 *
 * Vì sao: trước bản này mỗi driver ghi `Boolean(x)` ⇒ chuỗi "false" / "0" / "off" thành TRUE trên thiết bị (JS: mọi chuỗi không rỗng là truthy),
 * còn cổng kênh chỉ ép kiểu tag bool ĐÃ khai. Nay:
 *   • `boolTuGiaTri` — TẬP HỢP LỆ (8 giá trị): boolean; số 1 / 0; chuỗi sau `trim().toLowerCase()` là "1" / "true" / "0" / "false". Mọi thứ khác
 *     (2, -1, NaN, "on", "yes", "", mảng, đối tượng, null) ⇒ undefined.
 *   • `boolGhi` — đường GHI thường: ngoài tập ⇒ NÉM `LoiGiaTriBool` (lớp có kiểu — rawErrorCensus); driver bắt trong khối try của từng write ⇒
 *     write đó `{ ok: false }`, không bao giờ cả lô.
 *   • `boolDungGhim` — CHỈ đường ghi một STOP ĐÃ XÁC MINH (giá trị ghim; `OtWrite.dungGhim`). KD-T2 (điều phối 2026-10-26): một ghim STOP CŨ
 *     không bao giờ bị driver chặn ⇒ KHÔNG NÉM: tập hợp lệ ra đúng như `boolTuGiaTri` ("false" ⇒ FALSE); số hữu hạn khác 0 ⇒ TRUE (quy ước
 *     thanh ghi, ghim 255 trên coil ⇒ TRUE); mọi giá trị khác ⇒ truthy của JS (hành vi cũ). Ghim MỚI ngoài tập trên địa chỉ coil / bit bị từ
 *     chối lúc ĐẶT (`stopPin.datStopPin`, điều kiện 1b) ⇒ nhánh "truthy cũ" chỉ còn phục vụ ghim có từ trước (census TEST / DEV: 0 ghim như vậy).
 *   • `giaiMaBoolDoc` — đường ĐỌC: số hữu hạn ⇒ `raw !== 0`; boolean ⇒ chính nó; chuỗi ⇒ `boolTuGiaTri`; còn lại ⇒ undefined (driver ra
 *     `{ value: null, quality: "bad" }`).
 *
 * ĐỐI XỨNG GHI ↔ ĐỌC (một luật, hai chiều): với mọi v trong tập hợp lệ, `giaiMaBoolDoc(boolGhi(v)) === boolTuGiaTri(v)` và thiết bị lưu bit thành
 * 0 / 1 ⇒ `giaiMaBoolDoc(boolGhi(v) ? 1 : 0) === boolTuGiaTri(v)`. Phía đọc coi MỌI số khác 0 là TRUE — cùng quy ước với `boolDungGhim` (STOP
 * 255 ghi TRUE, thanh ghi đọc 255 ra TRUE). Phía ghi THƯỜNG chặt hơn phía đọc có chủ đích: người gọi gửi 2 là lỗi của người gọi (từ chối),
 * thiết bị trả 2 là quy ước thanh ghi (TRUE).
 */

/** Ném bởi `boolGhi` khi giá trị không thuộc tập hợp lệ. Lớp có kiểu (không phải `Error` thô — `server/_core/rawErrorCensus.test.ts`). */
export class LoiGiaTriBool extends Error {
  readonly giaTri: unknown;
  constructor(giaTri: unknown) {
    super(`giá trị bool không hợp lệ: ${moTa(giaTri)}`);
    this.name = "LoiGiaTriBool";
    this.giaTri = giaTri;
  }
}

function moTa(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

/** Tập hợp lệ — xem đầu tệp. */
export function boolTuGiaTri(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === 1) return true;
  if (v === 0) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "1" || s === "true") return true;
    if (s === "0" || s === "false") return false;
  }
  return undefined;
}

/** Đường GHI thường — ngoài tập hợp lệ ⇒ ném `LoiGiaTriBool`. */
export function boolGhi(v: unknown): boolean {
  const b = boolTuGiaTri(v);
  if (b === undefined) throw new LoiGiaTriBool(v);
  return b;
}

/** Đường GHI của STOP ĐÃ XÁC MINH (giá trị ghim) — không bao giờ ném (KD-T2). Xem đầu tệp. */
export function boolDungGhim(v: unknown): boolean {
  const b = boolTuGiaTri(v);
  if (b !== undefined) return b;
  if (typeof v === "number" && Number.isFinite(v)) return v !== 0;
  return Boolean(v);
}

/** Một chỗ chọn luật cho mọi driver: STOP đã xác minh ⇒ `boolDungGhim`, ngược lại ⇒ `boolGhi`. */
export function boolChoGhi(v: unknown, dungGhim: boolean | undefined): boolean {
  return dungGhim === true ? boolDungGhim(v) : boolGhi(v);
}

/** Đường ĐỌC — xem đầu tệp. */
export function giaiMaBoolDoc(raw: unknown): boolean | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw !== 0 : undefined;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return boolTuGiaTri(raw);
  return undefined;
}
