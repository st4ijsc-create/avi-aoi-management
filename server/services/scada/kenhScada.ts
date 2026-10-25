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

/** R1b-2a T1 (M1) — |số thô| từ 2^53 trở lên: double không còn phân biệt được hai số nguyên liền nhau ⇒ thiết bị không nhận đúng số. */
const MIEN_THO_AN_TOAN = 2 ** 53;

/** Làm sạch nhiễu dấu phẩy động của phép nhân/cộng (chỉ cho GỢI Ý — không bao giờ cho giá trị được chấp nhận). */
const sachSo = (n: number): number => Number(n.toPrecision(15));

/** scale / offset như driver dùng (`drivers/otScale.inverseScale`): vắng / NULL / 0 / không hữu hạn ⇒ scale 1; vắng / NULL ⇒ offset 0. */
function heSoThangDo(tag: Pick<KenhGhiThuan, "scale" | "offset">): { s: number; o: number } {
  const s = tag.scale == null ? 1 : Number(tag.scale);
  const o = tag.offset == null ? 0 : Number(tag.offset);
  return { s: Number.isFinite(s) && s !== 0 ? s : 1, o: Number.isFinite(o) ? o : 0 };
}

/** R1b-2a T2 — (s, o) = (1, 0) theo đúng cách driver đọc (`heSoThangDo`): giá trị kỹ thuật = số thô ⇒ tag int nhận đúng số nguyên. */
function laThangDoDonVi(tag: Pick<KenhGhiThuan, "scale" | "offset">): boolean {
  const { s, o } = heSoThangDo(tag);
  return s === 1 && o === 0;
}

/**
 * kiem-dinh P1-3 ("xác nhận = ghi") — tag INT có scale/offset: driver ghi `raw = Math.round((v − offset) / scale)` (`inverseScale`),
 * nên một giá trị kỹ thuật lệch lưới thô bị LÀM TRÒN IM LẶNG (scale 10: xác nhận 25 ⇒ thiết bị nhận 3 = 30). Cổng này từ chối thay vì
 * để driver làm tròn: (v − offset)/scale không nguyên (dung sai dấu phẩy động như bước) ⇒ `OFF_STEP`, `buoc` = |scale|,
 * `goiY` = offset + round((v − offset)/scale)·scale — ĐÚNG giá trị driver đã lặng lẽ ghi (hoà .5 theo `Math.round`: về phía +∞, 25 ⇒ 30)
 * — kẹp vào các điểm lưới thô nằm trong [writeMin, writeMax]; không có điểm nào trong dải, hoặc (`goiYPhaiNguyen`, tag ĐÃ khai với (s, o) =
 * (1, 0): epInt chỉ nhận số nguyên — R1b-2a T2: (s, o) ≠ (1, 0) ép bằng epFloat ⇒ false) gợi ý không phải số nguyên ⇒ không `goiY`. float / bool / string / json: driver không làm tròn ⇒ không kiểm. Gợi ý KHÔNG
 * xét `writeStep` (hiếm khi cả hai cùng có).
 *
 * R1b-2a T1 (Q-T13 b + kiem-dinh M1, điều phối 2026-10-25) — MỌI tag int, kể cả scale 1 / offset 0 (lưới thô = số nguyên; không còn lối tắt):
 *   • n = (v − o)/s không hữu hạn hoặc |n| ≥ 2^53 ⇒ `OUT_OF_RANGE` "số thô vượt miền an toàn" (trước: coi là ok — driver ghi một số thô không
 *     biểu diễn đúng được);
 *   • so lưới ở KHÔNG GIAN THÔ: lệch ⇔ |n − round(n)| > 1e-9 + 4·EPSILON·(|n| + (|v| + |o|)/|s|) — vế tuyệt đối 1e-9 tính theo SỐ THÔ nên không
 *     còn lỗ khi |scale| rất nhỏ (trước: 1e-9 ở không gian kỹ thuật ⇒ scale 1e-10 coi mọi giá trị là "trên lưới"); vế tương đối là nhiễu dấu phẩy
 *     động của v, o (đổi sang không gian thô) và của chính phép chia.
 */
function kiemLuoiTho(tag: KenhGhiThuan, v: number, goiYPhaiNguyen = true): KetQuaGiaTri {
  if (tag.dataType !== "int") return { ok: true, giaTri: v };
  const { s, o } = heSoThangDo(tag);
  const n = (v - o) / s;
  if (!Number.isFinite(n) || Math.abs(n) >= MIEN_THO_AN_TOAN) {
    return sai("OUT_OF_RANGE", `Giá trị ${v}: số thô vượt miền an toàn (|(giá trị − ${o}) / ${s}| ≥ 2^53) — thiết bị không lưu đúng được số thô này.`);
  }
  const k = Math.round(n);
  const dungSai = 1e-9 + 4 * Number.EPSILON * (Math.abs(n) + (Math.abs(v) + Math.abs(o)) / Math.abs(s));
  if (Math.abs(n - k) <= dungSai) return { ok: true, giaTri: v };

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
 * R1b-1 T13 (điều phối 2026-10-24) — tag int CHƯA khai mô hình ghi (cột 0431 đều NULL): cổng kênh sớm của `dispatch()` phải kiểm lưới thô như
 * tag đã khai, không để driver làm tròn im lặng (scale 10: 25 ⇒ raw 3 = 30). true ⇔ phải kiểm.
 * R1b-2a T1 (Q-T13 b, điều phối 2026-10-25) — MỌI tag int, kể cả scale 1 / offset 0 (trước: false ⇒ 2.5 đi nguyên, driver ghi 3; "abc" đi nguyên,
 * driver ghi Math.round(NaN)). `scale` / `offset` không còn quyết định có kiểm hay không; chữ ký giữ nguyên.
 */
export function canKiemLuoiThoChuaKhai(tag: Pick<KenhGhiThuan, "dataType" | "scale" | "offset">): boolean {
  return tag.dataType === "int";
}

/**
 * R1b-2a T2 (phán quyết T1 c3 của bộ điều khiển: M2 mở rộng sang float) — giá trị gửi lên tag CHƯA khai phải được kiểm ở cổng kênh sớm của
 * `dispatch()` (pass 2) ⇔ tag int (lưới thô + số hữu hạn — `canKiemLuoiThoChuaKhai`) HOẶC tag float (chỉ số hữu hạn: driver `inverseScale`
 * không làm tròn float, nhưng `Number("abc")` = NaN, `Number("")` = 0 vẫn tới thiết bị). bool / string / json: driver không đọc số ⇒ false.
 */
export function canKiemGiaTriChuaKhai(tag: Pick<KenhGhiThuan, "dataType" | "scale" | "offset">): boolean {
  return tag.dataType === "int" || tag.dataType === "float";
}

/**
 * R1b-2a T1 (kiem-dinh M2 + phán quyết K3) — số mà driver sẽ đọc từ giá trị gửi lên một tag int CHƯA khai (`inverseScale`: `Number(value)`), CHỈ khi
 * giá trị ấy là một SỐ có chủ đích: boolean ⇒ 1 / 0; số hữu hạn; chuỗi không rỗng mà `Number()` đọc ra số hữu hạn ("7", " 7 ", "0x19" — như driver);
 * đối tượng kiểu Long của Sparkplug trong miền an toàn (`epLong`). Mọi thứ khác ⇒ undefined (TYPE_MISMATCH): NaN / ±Infinity / "abc" /
 * "Infinity"; mảng (`Number([25])` = 25, `Number([])` = 0); đối tượng thường; Symbol; hàm; chuỗi rỗng / chỉ khoảng trắng (`Number("")` = 0);
 * null / undefined (`Number(null)` = 0 — luật interlock không khai giá trị đã được đổi thành `true` TRƯỚC khi tới đây, `giaTriLenhInterlock`).
 * R1b-2a T2 — CÙNG bộ đọc cho tag float chưa khai (driver `inverseScale` đọc float bằng đúng `Number(value)`).
 */
function soChoKenhSoChuaKhai(v: unknown): number | undefined {
  switch (typeof v) {
    case "boolean":
      return v ? 1 : 0;
    case "number":
      return Number.isFinite(v) ? v : undefined;
    case "bigint": {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    case "string": {
      if (v.trim() === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    case "object": {
      if (v === null) return undefined;
      const l = epLong(v);
      return typeof l === "number" ? l : undefined;
    }
    default:
      return undefined; // undefined, symbol, function
  }
}

/**
 * R1b-1 T13 — kiểm lưới thô cho tag int CHƯA khai (`canKiemLuoiThoChuaKhai`). Tag chưa khai KHÔNG được ép kiểu (hành vi cũ: giá trị đi nguyên
 * như người gọi gửi), nên số đem kiểm là ĐÚNG số driver sẽ dùng (`soChoIntChuaKhai`: true ⇒ 1, "25" ⇒ 25). Lệch lưới ⇒ `OFF_STEP` với
 * `buoc` = |scale| và `goiY` = điểm lưới gần nhất (không đòi số nguyên — tag chưa khai không qua epInt; scale 0.5 ⇒ 2.5 là giá trị đúng lưới).
 * `ok` trả LẠI giá trị NGUYÊN VẸN, không đổi.
 * R1b-2a T1 — MỌI tag int (scale 1 ⇒ lưới số nguyên: 2.5 ⇒ OFF_STEP goiY 3, buoc 1, gocLuoi 0); giá trị không phải số hữu hạn có chủ đích ⇒
 * `TYPE_MISMATCH` (M2: trước đây ok nguyên vẹn và driver ghi `Math.round(NaN)`); |số thô| ≥ 2^53 ⇒ `OUT_OF_RANGE` (M1).
 * R1b-2a T2 (phán quyết T1 c3) — tag FLOAT chưa khai: cùng bộ đọc số ⇒ không phải số hữu hạn có chủ đích ⇒ `TYPE_MISMATCH` "giá trị không phải
 * số hữu hạn — tag float không ghi được" (trước: đi nguyên, driver ghi NaN / 0); số thô (v − o)/s tràn double ⇒ `OUT_OF_RANGE`. Không lưới
 * (driver không làm tròn float). `ok` vẫn trả giá trị NGUYÊN VẸN (không ép kiểu — "1.5" đi tiếp là chuỗi như trước).
 */
export function kiemLuoiThoChuaKhai(tag: Pick<KenhGhiThuan, "dataType" | "scale" | "offset">, giaTri: unknown): KetQuaGiaTri {
  const nguyenVen = { ok: true, giaTri: giaTri as number | boolean | string } as const;
  if (!canKiemGiaTriChuaKhai(tag)) return nguyenVen;
  const x = soChoKenhSoChuaKhai(giaTri);
  if (x === undefined) return sai("TYPE_MISMATCH", `giá trị không phải số hữu hạn — tag ${tag.dataType} không ghi được`);
  if (tag.dataType === "float") {
    const { s, o } = heSoThangDo(tag);
    if (!Number.isFinite((x - o) / s)) {
      return sai("OUT_OF_RANGE", `Giá trị ${x}: số thô (giá trị − ${o}) / ${s} vượt miền số thực — thiết bị không lưu được số thô này.`);
    }
    return nguyenVen;
  }
  const kq = kiemLuoiTho({ dataType: "int", writeMin: null, writeMax: null, writeStep: null, scale: tag.scale, offset: tag.offset }, x === 0 ? 0 : x, false);
  return kq.ok ? nguyenVen : kq;
}

/**
 * R1b-2a T2 (m5) — ÉP KIỂU THUẦN theo `dataType` (KHÔNG dải / bước / lưới). MỘT hàm cho ba nơi: `kiemGiaTriGhi` (HMI `request`, kiểm cấu hình),
 * pass 1 của cổng kênh sớm `congKenhSom` và cổng 1 ràng buộc (`writesEpKieuChoRangBuoc`) của `dispatch()` — nên ba nơi luôn ra CÙNG một giá
 * trị đã ép (cùng `canonicalOtValue`, cùng băm).
 *  • int với (s, o) = (1, 0) (theo `heSoThangDo`: vắng / NULL / scale 0 ⇒ 1) ⇒ `epInt` như cũ (số nguyên an toàn; "30.0" / 2.5 ⇒ TYPE_MISMATCH);
 *  • int với (s, o) ≠ (1, 0) ⇒ số hữu hạn (`epFloat`): giá trị KỸ THUẬT của thanh ghi int scale 0.5 là 2.5 (thô 5) — trước đây epInt từ chối
 *    nhầm mọi giá trị không nguyên dù nằm đúng lưới thô. Lưới thô (số thô nguyên) do `kiemGiaTriGhi` kiểm SAU, không ở đây;
 *  • float ⇒ `epFloat`; bool / string / json như cũ. −0 ⇒ 0.
 */
export function epKieuGiaTri(tag: Pick<KenhGhiThuan, "dataType" | "scale" | "offset">, giaTri: unknown): KetQuaGiaTri {
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

  const nguyen = tag.dataType === "int" && laThangDoDonVi(tag);
  const goc = nguyen ? epInt(giaTri) : epFloat(giaTri);
  if (goc === null) return sai("TYPE_MISMATCH", "Số nguyên nằm ngoài miền an toàn (|giá trị| > 9007199254740991).");
  if (goc === undefined) {
    return sai(
      "TYPE_MISMATCH",
      nguyen ? "Giá trị phải là số nguyên." : tag.dataType === "int" ? "Giá trị phải là số hữu hạn (tag int có scale / offset: giá trị kỹ thuật = offset + k·scale)." : "Giá trị phải là số hữu hạn.",
    );
  }
  return { ok: true, giaTri: goc === 0 ? 0 : goc }; // chuẩn hoá -0 ⇒ 0 (canonicalOtValue(-0) khác canonicalOtValue(0) sẽ làm hai cách viết băm khác nhau)
}

/**
 * Ép kiểu chuẩn theo `dataType` TRƯỚC (`epKieuGiaTri`), rồi kiểm dải và bước (chỉ số: int/float), rồi lưới thô (int).
 *
 *  • Dải: `writeMin <= v <= writeMax`, so sánh CHÍNH XÁC (không dung sai) — 239.9999999999 < 240 là ngoài dải.
 *  • Bước: v phải nằm trên lưới `base + k·step`, với `base = writeMin` khi có, ngược lại `base = 0`.
 *    Dung sai CHỈ cho phép lệch lưới do sai số dấu phẩy động: `1e-9 × max(1, |step|) + 4·EPSILON·|v|` (240.0 và bước 0.5 hợp lệ, 240.2 thì không).
 *  • `goiY` (chỉ với `OFF_STEP`) = điểm lưới gần nhất NẰM TRONG dải; không có điểm lưới nào trong dải ⇒ không có `goiY`.
 *    Gợi ý, KHÔNG BAO GIỜ thay giá trị: kết quả `ok` luôn mang đúng giá trị đã ép kiểu, chưa làm tròn.
 *  • bool/string: không kiểm dải/bước. json: chỉ nhận giá trị tương thích JSON, nguyên dạng, không kiểm dải/bước.
 *  • kiem-dinh P1-3: int có `scale`/`offset` (khi người gọi truyền) ⇒ thêm lưới THÔ sau dải + bước (`kiemLuoiTho`).
 *  • R1b-2a T2 (m5): int (s, o) ≠ (1, 0) ép bằng `epFloat` (giá trị kỹ thuật, vd 2.5 trên scale 0.5) và `goiY` của lưới thô không còn bị đòi
 *    nguyên (`goiYPhaiNguyen = false`); (1, 0) giữ epInt + gợi ý nguyên.
 */
export function kiemGiaTriGhi(tag: KenhGhiThuan, giaTri: unknown): KetQuaGiaTri {
  const kieu = epKieuGiaTri(tag, giaTri);
  if (!kieu.ok || (tag.dataType !== "int" && tag.dataType !== "float")) return kieu;
  const v = kieu.giaTri as number;
  const goiYPhaiNguyen = laThangDoDonVi(tag);

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
    if (!Number.isFinite(n) || Math.abs(n) >= 2 ** 53) return kiemLuoiTho(tag, v, goiYPhaiNguyen);
    const k = Math.round(n);
    if (Math.abs(v - (base + k * step)) <= dungSai) return kiemLuoiTho(tag, v, goiYPhaiNguyen);

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
  return kiemLuoiTho(tag, v, goiYPhaiNguyen);
}
