/**
 * SCADA R1a Task 2 — LUẬT KÊNH THUẦN (không DB, không I/O): loại kênh, mức tác động, ép kiểu, dải, bước.
 *
 * Dùng bởi `dispatch()` (cổng K2 / kiểm giá trị) và router lệnh HMI (`scada.commands`) — CÙNG MỘT hàm, nên
 * `request` và `dispatch` băm cùng một giá trị đã ép kiểu (`canonicalOtValue(giaTri)`), không lệch theo cách viết
 * ("1" / 1 / true cho bool; "240.0" / 240 cho float).
 *
 * Quy ước ép kiểu KHÔNG mâu thuẫn `readbackMatches` (drivers/readbackCompare.ts): bool so như boolean, int là số nguyên,
 * float là số hữu hạn. Khác ở chỗ đây là cổng VÀO nên nghiêm hơn (từ chối thay vì `Boolean(x)` / `Math.round`).
 *
 * ⚠ QUYẾT ĐỊNH ĐIỀU PHỐI 2026-10-24 (mục 7): `goiY` CHỈ là gợi ý. `kiemGiaTriGhi` KHÔNG BAO GIỜ trả `ok` kèm giá trị đã
 * làm tròn / kẹp — giá trị lệch bước là `OFF_STEP`, người vận hành tự chọn lại.
 */
import type { DeviceTag } from "../../../drizzle/schema";
import type { MucRuiRo } from "../ot/aiControlGate";

// ─────────────────────────────────────────────────────────────────────────────
// Loại kênh · mức tác động
// ─────────────────────────────────────────────────────────────────────────────

export type LoaiKenh = "input" | "input_output" | "calculated" | "calculated_output" | "output";

/** NULL (cột chưa điền) ⇒ suy từ `writable`: ghi được = input_output, không = input (hành vi cũ). */
export function loaiKenh(tag: Pick<DeviceTag, "channelKind" | "writable">): LoaiKenh {
  return tag.channelKind ?? (tag.writable ? "input_output" : "input");
}

/** Kênh nhận lệnh ghi xuống thiết bị: input_output | calculated_output | output. */
export function laKenhGhi(tag: Pick<DeviceTag, "channelKind" | "writable">): boolean {
  const k = loaiKenh(tag);
  return k === "input_output" || k === "calculated_output" || k === "output";
}

/**
 * Mức tác động theo HƯỚNG NĂNG LƯỢNG. Fail-closed: `actuationLevel` chưa điền (NULL) ⇒ 5 (mức cao nhất, chuyển động vật lý),
 * BẤT KỂ loại kênh — người gọi quên `laKenhGhi` vẫn không bị hạ mức oan (điều phối 2026-10-24: "để trống = 5").
 */
export function mucTacDongKenh(tag: Pick<DeviceTag, "actuationLevel">): MucRuiRo {
  return tag.actuationLevel ?? 5;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ép kiểu · dải · bước
// ─────────────────────────────────────────────────────────────────────────────

export type KetQuaGiaTri =
  | { ok: true; giaTri: number | boolean | string }
  // `buoc` (chỉ OFF_STEP) = lưới vừa trượt: `writeStep`, hoặc |scale| khi lệch lưới THÔ của tag int có scale (kiem-dinh P1-3).
  // `gocLuoi` (chỉ OFF_STEP, R1b-1 T13 polish m1) = gốc của lưới đó: `writeMin ?? 0` cho bước, `offset` cho lưới thô (lưới = gocLuoi + k·buoc).
  | { ok: false; ma: "TYPE_MISMATCH" | "OUT_OF_RANGE" | "OFF_STEP"; chiTiet: string; goiY?: number; buoc?: number; gocLuoi?: number };

/**
 * `scale` / `offset` TUỲ CHỌN (kiem-dinh P1-3): vắng ⇒ 1 / 0 (hành vi cũ). Cột decimal ⇒ drizzle trả CHUỖI ("10.000000") — nhận cả số.
 */
type KenhGhiThuan = Pick<DeviceTag, "dataType" | "writeMin" | "writeMax" | "writeStep"> & {
  scale?: string | number | null;
  offset?: string | number | null;
};

const RE_INT = /^[+-]?\d+$/;
const RE_FLOAT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const sai = (ma: "TYPE_MISMATCH" | "OUT_OF_RANGE" | "OFF_STEP", chiTiet: string, goiY?: number, buoc?: number, gocLuoi?: number): KetQuaGiaTri => ({
  ok: false,
  ma,
  chiTiet,
  ...(goiY === undefined ? {} : { goiY }),
  ...(buoc === undefined ? {} : { buoc }),
  ...(gocLuoi === undefined ? {} : { gocLuoi }),
});

function epBool(v: unknown): boolean | undefined {
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

/**
 * R1b-1 T10 — bộ giải mã Sparkplug B giao số nguyên 64 bit dưới dạng đối tượng kiểu Long (thư viện `long`: {low, high, unsigned} + toNumber()).
 * Nhận dạng bằng DUCK-TYPE (không import thư viện): low/high là số, unsigned là boolean, toNumber là hàm. Giá trị dựng lại từ low/high phải là số nguyên AN TOÀN VÀ khớp toNumber();
 * ngoài miền an toàn (|n| > 2^53−1) ⇒ null (người gọi coi là TYPE_MISMATCH). Không phải Long ⇒ undefined.
 */
function epLong(v: unknown): number | null | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as { low?: unknown; high?: unknown; unsigned?: unknown; toNumber?: unknown };
  if (typeof o.low !== "number" || typeof o.high !== "number" || typeof o.unsigned !== "boolean" || typeof o.toNumber !== "function") return undefined;
  // Giá trị DỰNG LẠI từ low/high (hai nửa 32 bit, bù hai; unsigned ⇒ nửa cao không dấu) — nguồn sự thật. `toNumber()` chỉ được phép XÁC NHẬN nó.
  if (!Number.isInteger(o.low) || !Number.isInteger(o.high)) return undefined;
  const lo = BigInt(o.low >>> 0);
  const goc = o.unsigned ? BigInt.asUintN(64, (BigInt(o.high >>> 0) << 32n) | lo) : BigInt.asIntN(64, (BigInt(o.high | 0) << 32n) | lo);
  if (goc > BigInt(Number.MAX_SAFE_INTEGER) || goc < -BigInt(Number.MAX_SAFE_INTEGER)) return null; // ngoài miền an toàn
  const n = Number(goc); // +0 (BigInt không có -0)
  let bao: unknown;
  try {
    bao = (o.toNumber as () => unknown).call(v);
  } catch {
    return undefined;
  }
  return bao === n ? n : undefined; // toNumber() nói khác low/high (đối tượng nói dối / hỏng) ⇒ không tin cái nào ⇒ TYPE_MISMATCH
}

/** số nguyên an toàn ⇒ số; trông như số nguyên nhưng NGOÀI dải an toàn (|n| > 2^53−1) ⇒ null; còn lại ⇒ undefined. */
function epInt(v: unknown): number | null | undefined {
  let n: number;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) return undefined;
    n = v;
  } else if (typeof v === "string") {
    const s = v.trim();
    if (!RE_INT.test(s)) return undefined;
    n = Number(s);
  } else return epLong(v);
  return Number.isSafeInteger(n) ? n : null;
}

function epFloat(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const s = v.trim();
    if (!RE_FLOAT.test(s)) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  return epLong(v) ?? undefined; // Long ngoài miền an toàn ⇒ undefined ⇒ TYPE_MISMATCH
}

/** JSON-tương-thích: null, boolean, số hữu hạn, chuỗi, mảng, đối tượng thuần (đệ quy). `undefined`, hàm, bigint, NaN … bị loại. */
function laJsonThuan(v: unknown, sau = 0): boolean {
  if (sau > 64) return false;
  if (v === null) return true;
  switch (typeof v) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(v);
    case "object": {
      if (Array.isArray(v)) return v.every((x) => laJsonThuan(x, sau + 1));
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.values(v as Record<string, unknown>).every((x) => laJsonThuan(x, sau + 1));
    }
    default:
      return false;
  }
}

/** Làm sạch nhiễu dấu phẩy động của phép nhân/cộng (chỉ cho GỢI Ý — không bao giờ cho giá trị được chấp nhận). */
const sachSo = (n: number): number => Number(n.toPrecision(15));

/** scale / offset như driver dùng (`drivers/otScale.inverseScale`): vắng / NULL / 0 / không hữu hạn ⇒ scale 1; vắng / NULL ⇒ offset 0. */
function heSoThangDo(tag: Pick<KenhGhiThuan, "scale" | "offset">): { s: number; o: number } {
  const s = tag.scale == null ? 1 : Number(tag.scale);
  const o = tag.offset == null ? 0 : Number(tag.offset);
  return { s: Number.isFinite(s) && s !== 0 ? s : 1, o: Number.isFinite(o) ? o : 0 };
}

/**
 * kiem-dinh P1-3 ("xác nhận = ghi") — tag INT có scale/offset: driver ghi `raw = Math.round((v − offset) / scale)` (`inverseScale`),
 * nên một giá trị kỹ thuật lệch lưới thô bị LÀM TRÒN IM LẶNG (scale 10: xác nhận 25 ⇒ thiết bị nhận 3 = 30). Cổng này từ chối thay vì
 * để driver làm tròn: (v − offset)/scale không nguyên (dung sai dấu phẩy động như bước) ⇒ `OFF_STEP`, `buoc` = |scale|,
 * `goiY` = offset + round((v − offset)/scale)·scale — ĐÚNG giá trị driver đã lặng lẽ ghi (hoà .5 theo `Math.round`: về phía +∞, 25 ⇒ 30)
 * — kẹp vào các điểm lưới thô nằm trong [writeMin, writeMax]; không có điểm nào trong dải, hoặc (`goiYPhaiNguyen`, tag ĐÃ khai: epInt chỉ
 * nhận số nguyên) gợi ý không phải số nguyên ⇒ không `goiY`. float / bool / string / json: driver không làm tròn ⇒ không kiểm. Gợi ý KHÔNG
 * xét `writeStep` (hiếm khi cả hai cùng có).
 */
function kiemLuoiTho(tag: KenhGhiThuan, v: number, goiYPhaiNguyen = true): KetQuaGiaTri {
  if (tag.dataType !== "int") return { ok: true, giaTri: v };
  const { s, o } = heSoThangDo(tag);
  if (s === 1 && o === 0) return { ok: true, giaTri: v }; // lưới thô = số nguyên: tag đã khai đã qua epInt; chưa khai — ngoài phạm vi (xem kiemLuoiThoChuaKhai)
  const n = (v - o) / s;
  if (!Number.isFinite(n) || Math.abs(n) >= 2 ** 53) return { ok: true, giaTri: v }; // vượt độ phân giải double — như nhánh bước
  const k = Math.round(n);
  const dungSai = 1e-9 * Math.max(1, Math.abs(s)) + 4 * Number.EPSILON * Math.max(Math.abs(v), Math.abs(o));
  if (Math.abs(v - (o + k * s)) <= dungSai) return { ok: true, giaTri: v };

  const { writeMin: min, writeMax: max } = tag;
  // k của các điểm lưới thô o + k·s nằm trong dải (s âm ⇒ đảo vai min/max).
  const canDuoi = s > 0 ? min : max;
  const canTren = s > 0 ? max : min;
  const kLo = canDuoi != null ? Math.ceil((canDuoi - o) / s - 1e-9) : Number.NEGATIVE_INFINITY;
  const kHi = canTren != null ? Math.floor((canTren - o) / s + 1e-9) : Number.POSITIVE_INFINITY;
  let goiY: number | undefined;
  if (kLo <= kHi) {
    let g = sachSo(o + Math.min(Math.max(k, kLo), kHi) * s);
    if (min != null) g = Math.max(g, min);
    if (max != null) g = Math.min(g, max);
    if (goiYPhaiNguyen ? Number.isSafeInteger(g) : Number.isFinite(g)) goiY = g;
  }
  return sai(
    "OFF_STEP",
    `Giá trị ${v} không ghi đúng được: thiết bị lưu số thô (giá trị − ${o}) / ${s} phải nguyên — lưới ${Math.abs(s)}.`,
    goiY,
    Math.abs(s),
    o,
  );
}

/**
 * R1b-1 T13 (điều phối 2026-10-24) — tag int CHƯA khai mô hình ghi (cột 0431 đều NULL) mà có `scale ≠ 1` hoặc `offset ≠ 0`: cổng kênh
 * sớm của `dispatch()` phải kiểm lưới thô như tag đã khai, không để driver làm tròn im lặng (scale 10: 25 ⇒ raw 3 = 30). true ⇔ phải kiểm.
 * scale 1 / offset 0 ⇒ false: hành vi cũ (giá trị đi nguyên như gửi; ngoài phạm vi T13).
 */
export function canKiemLuoiThoChuaKhai(tag: Pick<KenhGhiThuan, "dataType" | "scale" | "offset">): boolean {
  if (tag.dataType !== "int") return false;
  const { s, o } = heSoThangDo(tag);
  return s !== 1 || o !== 0;
}

/**
 * R1b-1 T13 — kiểm lưới thô cho tag int CHƯA khai (`canKiemLuoiThoChuaKhai`). Tag chưa khai KHÔNG được ép kiểu (hành vi cũ: giá trị đi nguyên
 * như người gọi gửi), nên số đem kiểm là ĐÚNG số driver sẽ dùng: `Number(giaTri)` như `inverseScale` (true ⇒ 1, "25" ⇒ 25). Không hữu hạn
 * (`"abc"`, đối tượng) ⇒ không phải chuyện làm tròn ⇒ ok (hành vi cũ). Lệch lưới ⇒ `OFF_STEP` với `buoc` = |scale| và `goiY` = điểm lưới gần
 * nhất (không đòi số nguyên — tag chưa khai không qua epInt; scale 0.5 ⇒ 2.5 là giá trị đúng lưới). `ok` trả LẠI giá trị NGUYÊN VẸN, không đổi.
 */
export function kiemLuoiThoChuaKhai(tag: Pick<KenhGhiThuan, "dataType" | "scale" | "offset">, giaTri: unknown): KetQuaGiaTri {
  const nguyenVen = { ok: true, giaTri: giaTri as number | boolean | string } as const;
  if (!canKiemLuoiThoChuaKhai(tag)) return nguyenVen;
  let x: number;
  try {
    x = Number(giaTri);
  } catch {
    return nguyenVen; // Symbol — driver cũng không ghi được; không phải chuyện làm tròn
  }
  if (!Number.isFinite(x)) return nguyenVen;
  const kq = kiemLuoiTho({ dataType: "int", writeMin: null, writeMax: null, writeStep: null, scale: tag.scale, offset: tag.offset }, x === 0 ? 0 : x, false);
  return kq.ok ? nguyenVen : kq;
}

/**
 * Ép kiểu chuẩn theo `dataType` TRƯỚC, rồi kiểm dải và bước (chỉ số: int/float).
 *
 *  • Dải: `writeMin <= v <= writeMax`, so sánh CHÍNH XÁC (không dung sai) — 239.9999999999 < 240 là ngoài dải.
 *  • Bước: v phải nằm trên lưới `base + k·step`, với `base = writeMin` khi có, ngược lại `base = 0`.
 *    Dung sai CHỈ cho phép lệch lưới do sai số dấu phẩy động: `1e-9 × max(1, |step|) + 4·EPSILON·|v|` (240.0 và bước 0.5 hợp lệ, 240.2 thì không).
 *  • `goiY` (chỉ với `OFF_STEP`) = điểm lưới gần nhất NẰM TRONG dải; không có điểm lưới nào trong dải ⇒ không có `goiY`.
 *    Gợi ý, KHÔNG BAO GIỜ thay giá trị: kết quả `ok` luôn mang đúng giá trị đã ép kiểu, chưa làm tròn.
 *  • bool/string: không kiểm dải/bước. json: chỉ nhận giá trị tương thích JSON, nguyên dạng, không kiểm dải/bước.
 *  • kiem-dinh P1-3: int có `scale`/`offset` (khi người gọi truyền) ⇒ thêm lưới THÔ sau dải + bước (`kiemLuoiTho`).
 */
export function kiemGiaTriGhi(tag: KenhGhiThuan, giaTri: unknown): KetQuaGiaTri {
  switch (tag.dataType) {
    case "bool": {
      const b = epBool(giaTri);
      return b === undefined ? sai("TYPE_MISMATCH", "Giá trị bool phải là true/false, 1/0, \"1\"/\"0\" hoặc \"true\"/\"false\".") : { ok: true, giaTri: b };
    }
    case "string":
      return typeof giaTri === "string" ? { ok: true, giaTri } : sai("TYPE_MISMATCH", "Giá trị phải là chuỗi.");
    case "json":
      // Nguyên dạng (identity) — canonicalOtValue sẽ băm đúng cái người gọi gửi. Không ép, không kiểm dải.
      // `as string` là CỐ Ý: kiểu `KetQuaGiaTri.giaTri` do brief cố định (number|boolean|string); với json, giá trị trả về là JSON
      // đã phân tích (đối tượng/mảng/…) — ép kiểu chỉ để khớp chữ ký, không đổi giá trị.
      return laJsonThuan(giaTri) ? { ok: true, giaTri: giaTri as string } : sai("TYPE_MISMATCH", "Giá trị không tương thích JSON.");
    case "int":
    case "float":
      break;
    default:
      return sai("TYPE_MISMATCH", "Kiểu dữ liệu kênh không được hỗ trợ.");
  }

  const goc = tag.dataType === "int" ? epInt(giaTri) : epFloat(giaTri);
  if (goc === null) return sai("TYPE_MISMATCH", "Số nguyên nằm ngoài miền an toàn (|giá trị| > 9007199254740991).");
  if (goc === undefined) {
    return sai("TYPE_MISMATCH", tag.dataType === "int" ? "Giá trị phải là số nguyên." : "Giá trị phải là số hữu hạn.");
  }
  const v = goc === 0 ? 0 : goc; // chuẩn hoá -0 ⇒ 0 (canonicalOtValue(-0) khác canonicalOtValue(0) sẽ làm hai cách viết băm khác nhau)

  const { writeMin: min, writeMax: max, writeStep: step } = tag;
  if (min != null && v < min) return sai("OUT_OF_RANGE", `Giá trị ${v} nhỏ hơn giới hạn dưới ${min}.`);
  if (max != null && v > max) return sai("OUT_OF_RANGE", `Giá trị ${v} lớn hơn giới hạn trên ${max}.`);

  if (step != null && step > 0) {
    const base = min ?? 0;
    // Dung sai = tuyệt đối 1e-9×max(1,|step|) + tương đối 4·EPSILON·|v| (độ phân giải dấu phẩy động ở độ lớn của v:
    // 1e8+0.3 với bước 0.1 không bị OFF_STEP oan). Khi |v−base|/step ≥ 2^53 lưới vượt độ phân giải double ⇒ coi là nằm trên lưới (nhánh riêng bên dưới).
    const dungSai = 1e-9 * Math.max(1, Math.abs(step)) + 4 * Number.EPSILON * Math.abs(v);
    const n = (v - base) / step;
    // |n| ≥ 2^53 (hoặc tràn ra Infinity): bước nhỏ hơn độ phân giải double của v ⇒ không phân biệt được điểm lưới — coi là hợp lệ.
    if (!Number.isFinite(n) || Math.abs(n) >= 2 ** 53) return kiemLuoiTho(tag, v);
    const k = Math.round(n);
    if (Math.abs(v - (base + k * step)) <= dungSai) return kiemLuoiTho(tag, v);

    // Gợi ý: bước gần nhất, kẹp vào các bước còn NẰM TRONG dải.
    const kMin = min != null ? 0 : Number.NEGATIVE_INFINITY; // base === min ⇒ bước đầu tiên là k = 0
    const kMax = max != null ? Math.floor((max - base + dungSai) / step) : Number.POSITIVE_INFINITY;
    let goiY: number | undefined;
    if (kMin <= kMax) {
      const kg = Math.min(Math.max(k, kMin), kMax);
      let g = sachSo(base + kg * step);
      if (min != null) g = Math.max(g, min);
      if (max != null) g = Math.min(g, max);
      goiY = g;
    }
    return sai("OFF_STEP", `Giá trị ${v} không nằm trên bước ${step} (tính từ ${base}).`, goiY, step, base);
  }
  return kiemLuoiTho(tag, v);
}
