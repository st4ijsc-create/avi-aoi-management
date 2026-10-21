/**
 * ★★ Đợt 8.0 — BIỂU THỨC `{{ … }}` của Luồng AI. Spec §4.3. THUẦN, dùng chung client (xem trước) và server (chạy).
 *
 * Ngôn ngữ nhỏ CÓ CHỦ Ý — bộ tách từ + bộ phân tích Pratt + bộ đánh giá trên cây; KHÔNG `eval`, KHÔNG `new Function`,
 * KHÔNG gọi phương thức của đối tượng JS (chỉ hàm danh sách trắng dạng `ten(…)`). Lý do: tham số node do người (và
 * model, ở "mô tả → luồng") viết; dữ liệu item đến từ trigger KHÔNG TIN CẬY. Một biểu thức không bao giờ chạm được
 * `constructor`, `__proto__`, `prototype`, hay thuộc tính KẾ THỪA.
 *
 *   biến:     $json (item hiện tại) · $node("id") (item ĐẦU của node đã chạy, `.json` / `.items`) · $input (`.items`,
 *             `.length`, `.first`) · $env (CHỈ khoá được cấp) · $run (`id`, `flowId`, `batDau`)
 *   hằng:     số, 'chuỗi' / "chuỗi", true, false, null
 *   toán tử:  . [ ] ( )  !  -  * / %  + -  < <= > >=  == !=  &&  ||  ? :
 *             `==`/`!=` là so sánh CHẶT (không ép kiểu). `+` có chuỗi ⇒ nối chuỗi.
 *   hàm:      len lower upper trim round floor ceil abs min max join split contains startsWith toNumber toString isEmpty
 */

export interface ItemLuong {
  json: Record<string, unknown>;
}

export interface NguCanhBieuThuc {
  json: Record<string, unknown>;
  input?: readonly ItemLuong[];
  nodes?: Readonly<Record<string, readonly ItemLuong[]>>;
  env?: Readonly<Record<string, string>>;
  run?: { id: string; flowId: string; batDau: string };
}

export class LoiBieuThuc extends Error {
  constructor(
    message: string,
    public readonly viTri: number | null = null,
  ) {
    super(viTri === null ? message : `${message} (vị trí ${viTri})`);
    this.name = "LoiBieuThuc";
  }
}

const DO_DAI_TOI_DA = 2000;
const DO_SAU_TOI_DA = 64;
/**
 * ★ Đợt 9 (L1 của kiem-dinh) — TRẦN ĐỘ DÀI KẾT QUẢ chuỗi (ký tự): mỗi phép nối, `join`, mẫu \`{{ }}\` lẫn chữ và mỗi tham số cuối. Biểu thức dài
 * 2000 ký tự mà lặp \`a + a + a …\` trên một chuỗi lớn khuếch đại bộ nhớ hàng nghìn lần; trần chặn TRƯỚC khi cấp phát (kiểm độ dài hai vế
 * rồi mới nối), nên cả kết quả lẫn bước trung gian đều không vượt trần.
 */
export const TRAN_KET_QUA_CHUOI = 1_048_576;
const quaDai = (n: number, noi: string): never => {
  throw new LoiBieuThuc(`kết quả ${noi} dài quá ${TRAN_KET_QUA_CHUOI} ký tự`);
};
const TEN_CAM: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);

// ── tách từ ──────────────────────────────────────────────────────────────────────────────────────

type Tu =
  | { k: "so"; v: number; p: number }
  | { k: "chuoi"; v: string; p: number }
  | { k: "ten"; v: string; p: number }
  | { k: "dau"; v: string; p: number }
  | { k: "het"; p: number };

const DAU = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", ".", "[", "]", "(", ")", ","];

function tachTu(s: string): Tu[] {
  const ra: Tu[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(s.slice(i))!;
      ra.push({ k: "so", v: Number(m[0]), p: i });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let v = "";
      while (j < s.length && s[j] !== c) {
        if (s[j] === "\\") {
          const n = s[j + 1];
          v += n === "n" ? "\n" : n === "t" ? "\t" : n ?? "";
          j += 2;
        } else v += s[j++];
      }
      if (j >= s.length) throw new LoiBieuThuc("chuỗi chưa đóng", i);
      ra.push({ k: "chuoi", v, p: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i))!;
      ra.push({ k: "ten", v: m[0], p: i });
      i += m[0].length;
      continue;
    }
    const d = DAU.find((x) => s.startsWith(x, i));
    if (!d) throw new LoiBieuThuc(`ký tự không hợp lệ '${c}'`, i);
    ra.push({ k: "dau", v: d === "===" ? "==" : d === "!==" ? "!=" : d, p: i });
    i += d.length;
  }
  ra.push({ k: "het", p: s.length });
  return ra;
}

// ── phân tích (Pratt) ────────────────────────────────────────────────────────────────────────────

type Nut =
  | { t: "hang"; v: unknown }
  | { t: "bien"; ten: string }
  | { t: "thanhVien"; doiTuong: Nut; khoa: Nut }
  | { t: "goi"; ten: string; doi: Nut[]; p: number }
  | { t: "mot"; op: string; a: Nut }
  | { t: "hai"; op: string; a: Nut; b: Nut }
  | { t: "baNgoi"; dk: Nut; co: Nut; khong: Nut };

const UU_TIEN: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

function phanTich(s: string): Nut {
  if (s.length > DO_DAI_TOI_DA) throw new LoiBieuThuc(`biểu thức dài quá ${DO_DAI_TOI_DA} ký tự`);
  const tu = tachTu(s);
  let i = 0;
  const xem = () => tu[i];
  const an = () => tu[i++];
  const can = (v: string) => {
    const t = an();
    if (t.k !== "dau" || t.v !== v) throw new LoiBieuThuc(`cần '${v}'`, t.p);
  };

  /** Ba ngôi (mức thấp nhất, kết hợp phải) trên một biểu thức hai ngôi. */
  function bieuThuc(sau: number): Nut {
    if (sau > DO_SAU_TOI_DA) throw new LoiBieuThuc(`biểu thức lồng sâu quá ${DO_SAU_TOI_DA}`);
    const dk = haiNgoi(1, sau + 1);
    const t = xem();
    if (t.k === "dau" && t.v === "?") {
      an();
      const co = bieuThuc(sau + 1);
      can(":");
      const khong = bieuThuc(sau + 1);
      return { t: "baNgoi", dk, co, khong };
    }
    return dk;
  }

  /** Leo ưu tiên: toán tử hai ngôi mức ≥ `mucToiThieu`, kết hợp trái. */
  function haiNgoi(mucToiThieu: number, sau: number): Nut {
    if (sau > DO_SAU_TOI_DA) throw new LoiBieuThuc(`biểu thức lồng sâu quá ${DO_SAU_TOI_DA}`);
    let trai = tienTo(sau + 1);
    for (;;) {
      const t = xem();
      if (t.k !== "dau" || !(t.v in UU_TIEN) || UU_TIEN[t.v] < mucToiThieu) return trai;
      an();
      const phai = haiNgoi(UU_TIEN[t.v] + 1, sau + 1);
      trai = { t: "hai", op: t.v, a: trai, b: phai };
    }
  }

  function tienTo(sau: number): Nut {
    if (sau > DO_SAU_TOI_DA) throw new LoiBieuThuc(`biểu thức lồng sâu quá ${DO_SAU_TOI_DA}`);
    const t = an();
    let nut: Nut;
    if (t.k === "so" || t.k === "chuoi") nut = { t: "hang", v: t.v };
    else if (t.k === "dau" && (t.v === "!" || t.v === "-")) nut = { t: "mot", op: t.v, a: tienTo(sau + 1) };
    else if (t.k === "dau" && t.v === "(") {
      nut = bieuThuc(sau + 1);
      can(")");
    } else if (t.k === "ten") {
      if (t.v === "true" || t.v === "false") nut = { t: "hang", v: t.v === "true" };
      else if (t.v === "null") nut = { t: "hang", v: null };
      else if (xem().k === "dau" && (xem() as { v: string }).v === "(") {
        an();
        const doi: Nut[] = [];
        if (!(xem().k === "dau" && (xem() as { v: string }).v === ")")) {
          for (;;) {
            doi.push(bieuThuc(sau + 1));
            const n = an();
            if (n.k === "dau" && n.v === ")") break;
            if (!(n.k === "dau" && n.v === ",")) throw new LoiBieuThuc("cần ',' hoặc ')'", n.p);
          }
        } else an();
        nut = { t: "goi", ten: t.v, doi, p: t.p };
      } else nut = { t: "bien", ten: t.v };
    } else throw new LoiBieuThuc("thiếu toán hạng", t.p);
    // hậu tố: .ten  [bieuThuc]
    for (;;) {
      const n = xem();
      if (n.k === "dau" && n.v === ".") {
        an();
        const ten = an();
        if (ten.k !== "ten") throw new LoiBieuThuc("cần tên thuộc tính sau '.'", ten.p);
        nut = { t: "thanhVien", doiTuong: nut, khoa: { t: "hang", v: ten.v } };
      } else if (n.k === "dau" && n.v === "[") {
        an();
        const k = bieuThuc(sau + 1);
        can("]");
        nut = { t: "thanhVien", doiTuong: nut, khoa: k };
      } else if (n.k === "dau" && n.v === "(") {
        throw new LoiBieuThuc("không gọi được phương thức — dùng hàm danh sách trắng, vd upper(x)", n.p);
      } else return nut;
    }
  }

  const goc = bieuThuc(0);
  const cuoi = xem();
  if (cuoi.k !== "het") throw new LoiBieuThuc("thừa ký hiệu", cuoi.p);
  return goc;
}

// ── đánh giá ─────────────────────────────────────────────────────────────────────────────────────

function layThuocTinh(o: unknown, khoa: unknown): unknown {
  if (o === null || o === undefined) return undefined;
  const k = typeof khoa === "number" ? khoa : String(khoa);
  if (typeof k === "string" && TEN_CAM.has(k)) throw new LoiBieuThuc(`thuộc tính bị cấm '${k}'`);
  if (typeof o === "string") {
    if (k === "length") return o.length;
    if (typeof k === "number" && Number.isInteger(k)) return o[k];
    return undefined;
  }
  if (Array.isArray(o)) {
    if (k === "length") return o.length;
    const n = typeof k === "number" ? k : /^\d+$/.test(k) ? Number(k) : NaN;
    return Number.isInteger(n) && n >= 0 && n < o.length ? o[n] : undefined;
  }
  if (typeof o === "object") {
    return Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k as string] : undefined;
  }
  return undefined;
}

const so = (x: unknown, ten: string): number => {
  if (typeof x !== "number" || Number.isNaN(x)) throw new LoiBieuThuc(`${ten} cần số, nhận ${x === null ? "null" : typeof x}`);
  return x;
};

const HAM: Record<string, (...a: unknown[]) => unknown> = {
  len: (x) => (typeof x === "string" || Array.isArray(x) ? x.length : x && typeof x === "object" ? Object.keys(x).length : 0),
  lower: (x) => String(x ?? "").toLowerCase(),
  upper: (x) => String(x ?? "").toUpperCase(),
  trim: (x) => String(x ?? "").trim(),
  round: (x, n) => {
    const p = 10 ** (n === undefined ? 0 : so(n, "round"));
    return Math.round(so(x, "round") * p) / p;
  },
  floor: (x) => Math.floor(so(x, "floor")),
  ceil: (x) => Math.ceil(so(x, "ceil")),
  abs: (x) => Math.abs(so(x, "abs")),
  min: (...a) => Math.min(...a.map((x) => so(x, "min"))),
  max: (...a) => Math.max(...a.map((x) => so(x, "max"))),
  join: (a, sep) => {
    if (!Array.isArray(a)) return "";
    const ngan = sep === undefined ? "," : String(sep);
    // ước lượng TRƯỚC khi nối: (n−1)·|sep| + Σ|phần tử| — dừng ngay khi vượt trần
    let tong = Math.max(0, a.length - 1) * ngan.length;
    if (tong > TRAN_KET_QUA_CHUOI) return quaDai(tong, "join");
    const ds: string[] = [];
    for (const x of a) {
      const s = x === null || x === undefined ? "" : String(x);
      tong += s.length;
      if (tong > TRAN_KET_QUA_CHUOI) return quaDai(tong, "join");
      ds.push(s);
    }
    return ds.join(ngan);
  },
  split: (s, sep) => String(s ?? "").split(String(sep ?? ",")).slice(0, 10_000),
  contains: (a, x) => (typeof a === "string" ? a.includes(String(x)) : Array.isArray(a) ? a.includes(x) : false),
  startsWith: (s, x) => String(s ?? "").startsWith(String(x)),
  toNumber: (x) => {
    const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
    return Number.isFinite(n) ? n : null;
  },
  toString: (x: unknown) => (x === null || x === undefined ? "" : typeof x === "object" ? JSON.stringify(x) : String(x)),
  isEmpty: (x) => x === null || x === undefined || x === "" || (Array.isArray(x) && x.length === 0) || (typeof x === "object" && !Array.isArray(x) && Object.keys(x as object).length === 0),
};

function bienGoc(ten: string, ngu: NguCanhBieuThuc): unknown {
  switch (ten) {
    case "$json":
      return ngu.json;
    case "$input": {
      const items = (ngu.input ?? []).map((x) => x.json);
      return { items, length: items.length, first: items[0] };
    }
    case "$env":
      return ngu.env ?? {};
    case "$run":
      return ngu.run ?? {};
    default:
      throw new LoiBieuThuc(`biến lạ '${ten}' (chỉ $json, $input, $env, $run, $node("id"))`);
  }
}

function danhGiaNut(n: Nut, ngu: NguCanhBieuThuc): unknown {
  switch (n.t) {
    case "hang":
      return n.v;
    case "bien":
      return bienGoc(n.ten, ngu);
    case "thanhVien":
      return layThuocTinh(danhGiaNut(n.doiTuong, ngu), danhGiaNut(n.khoa, ngu));
    case "goi": {
      if (n.ten === "$node") {
        if (n.doi.length !== 1) throw new LoiBieuThuc("$node cần đúng một id", n.p);
        const id = String(danhGiaNut(n.doi[0], ngu));
        const items = ngu.nodes?.[id];
        if (!items) throw new LoiBieuThuc(`node '${id}' chưa chạy hoặc không tồn tại`, n.p);
        return { json: items[0]?.json ?? {}, items: items.map((x) => x.json) };
      }
      const f = Object.prototype.hasOwnProperty.call(HAM, n.ten) ? HAM[n.ten] : undefined;
      if (!f) throw new LoiBieuThuc(`hàm '${n.ten}' không có trong danh sách cho phép`, n.p);
      return f(...n.doi.map((d) => danhGiaNut(d, ngu)));
    }
    case "mot": {
      const a = danhGiaNut(n.a, ngu);
      return n.op === "!" ? !a : -so(a, "dấu '-'");
    }
    case "hai": {
      if (n.op === "&&") return danhGiaNut(n.a, ngu) && danhGiaNut(n.b, ngu);
      if (n.op === "||") return danhGiaNut(n.a, ngu) || danhGiaNut(n.b, ngu);
      const a = danhGiaNut(n.a, ngu);
      const b = danhGiaNut(n.b, ngu);
      switch (n.op) {
        case "==":
          return a === b;
        case "!=":
          return a !== b;
        case "+":
          if (typeof a === "string" || typeof b === "string") {
            const sa = typeof a === "string" ? a : `${a ?? ""}`;
            const sb = typeof b === "string" ? b : `${b ?? ""}`;
            if (sa.length + sb.length > TRAN_KET_QUA_CHUOI) return quaDai(sa.length + sb.length, "phép nối");
            return sa + sb;
          }
          return so(a, "'+'") + so(b, "'+'");
        case "-":
          return so(a, "'-'") - so(b, "'-'");
        case "*":
          return so(a, "'*'") * so(b, "'*'");
        case "/":
          return so(a, "'/'") / so(b, "'/'");
        case "%":
          return so(a, "'%'") % so(b, "'%'");
        case "<":
          return (a as number) < (b as number);
        case "<=":
          return (a as number) <= (b as number);
        case ">":
          return (a as number) > (b as number);
        case ">=":
          return (a as number) >= (b as number);
      }
      throw new LoiBieuThuc(`toán tử lạ '${n.op}'`);
    }
    case "baNgoi":
      return danhGiaNut(n.dk, ngu) ? danhGiaNut(n.co, ngu) : danhGiaNut(n.khong, ngu);
  }
}

/** Đánh giá MỘT biểu thức (không có `{{ }}`). */
export function danhGia(bieuThuc: string, ngu: NguCanhBieuThuc): unknown {
  return danhGiaNut(phanTich(bieuThuc), ngu);
}

/** Chỉ kiểm cú pháp (cho giao diện / `kiemLuong`). */
export function kiemCuPhap(bieuThuc: string): string | null {
  try {
    phanTich(bieuThuc);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const RE_MAU = /\{\{([\s\S]*?)\}\}/g;

/**
 * Đánh giá một CHUỖI tham số có thể chứa `{{ … }}`. Chuỗi CHỈ gồm đúng một `{{ x }}` ⇒ trả NGUYÊN kiểu giá trị;
 * lẫn chữ ⇒ nối chuỗi (đối tượng ⇒ JSON). Không có `{{` ⇒ trả nguyên chuỗi.
 */
export function danhGiaChuoi(mau: string, ngu: NguCanhBieuThuc): unknown {
  const nguyen = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(mau);
  if (nguyen && !nguyen[1].includes("}}")) return danhGia(nguyen[1], ngu);
  if (!mau.includes("{{")) return mau;
  let tong = 0;
  const ra = mau.replace(RE_MAU, (m, bt: string) => {
    const v = danhGia(bt, ngu);
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    tong += s.length - m.length;
    if (tong + mau.length > TRAN_KET_QUA_CHUOI) return quaDai(tong + mau.length, "mẫu");
    return s;
  });
  if (ra.length > TRAN_KET_QUA_CHUOI) return quaDai(ra.length, "mẫu");
  return ra;
}

/** Đánh giá đệ quy mọi chuỗi trong tham số node (đối tượng/mảng lồng). */
export function danhGiaThamSo(v: unknown, ngu: NguCanhBieuThuc, sau = 0): unknown {
  if (sau > DO_SAU_TOI_DA) throw new LoiBieuThuc("tham số lồng sâu quá");
  if (typeof v === "string") return danhGiaChuoi(v, ngu);
  if (Array.isArray(v)) return v.map((x) => danhGiaThamSo(x, ngu, sau + 1));
  if (v && typeof v === "object") {
    const ra: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (TEN_CAM.has(k)) continue;
      ra[k] = danhGiaThamSo(x, ngu, sau + 1);
    }
    return ra;
  }
  return v;
}
