/**
 * ★★★ Đợt 10.3 B1 — BỘ CHE cho mọi dữ liệu RỜI MÁY tới AI bên ngoài. Điểm gọi DUY NHẤT là `congNgoai.ts` (bước 6:
 * sau khi lắp xong toàn bộ yêu cầu). Thuần ngoại trừ `layTuDienNhay` (đọc DB, đệm 5 phút). Không ném.
 *
 * VÌ SAO một bộ che MỚI (đo của kiem-dinh 2026-10-26): `redactSecretsAndPII` (`aiSafety.ts`) không che JSON có khoá trong
 * nháy, IP nội bộ, `user=`, MAC, tên khách; lách được bằng ký tự rộng-0 / chữ tách. Bộ này DÙNG LẠI nó làm một tầng
 * (khoá có tiền tố, PEM, chuỗi kết nối, JWT, email, điện thoại) và cộng thêm:
 *   · chuẩn hoá trước khi khớp: NFKC (chữ toàn-độ-rộng → ASCII), bỏ ký tự rộng-0 / điều hướng hai chiều, đồng chữ
 *     Cyrillic/Hy Lạp trong từ trộn chữ, chữ tách (`p a s s w o r d`), mã phần trăm (`%70assword`);
 *   · che theo TÊN KHOÁ trên cây dữ liệu JSON (`laTenKhoaNhay` — neo theo ĐOẠN tên, không theo chuỗi con) + luật CẶP
 *     `{name: "DB_PASSWORD", value: X}`;
 *   · cùng luật tên khoá cho nhãn trong VĂN BẢN (`DB_PASSWORD=…`, YAML `password: …`, `"token": "…"`);
 *   · IP nội bộ (v4 + v6 ULA/link-local), MAC, `user=`, query URL `?token=`, `Authorization: Basic`, khoá Anthropic;
 *   · từ điển tên người dùng / khách hàng / nhà máy.
 *
 * GIỚI HẠN ĐÃ BIẾT (ghi cả ở spec §9 + README vận hành):
 *   · đồng chữ NGOÀI bảng `DONG_CHU` lọt qua luật NHÃN — luật GIÁ TRỊ (định dạng khoá) vẫn bắt khoá thật;
 *   · từ điển tên đệm 5 phút ⇒ tên vừa tạo có thể chưa bị che trong tối đa 5 phút; tên < 4 ký tự và từ thông dụng
 *     (`TU_DUNG`) KHÔNG che (dương tính giả);
 *   · bí mật nghiệp vụ không có hình dạng (công thức, tên dự án) — nhà máy chịu trách nhiệm bật "dữ liệu vận hành";
 *   · văn bản đi ra là bản ĐÃ chuẩn hoá NFKC (chữ toàn-độ-rộng thành ASCII) — chấp nhận, không đổi nghĩa.
 */
import { appError } from "../../../_core/appError";
import { redactSecretsAndPII } from "../aiSafety";

export const THAY = {
  biMat: "[REDACTED_SECRET]",
  ip: "[REDACTED_IP]",
  mac: "[REDACTED_MAC]",
  nguoiDung: "[REDACTED_USER]",
  ten: "[REDACTED_NAME]",
} as const;

export interface TuDienNhay {
  tenNguoiDung: ReadonlySet<string>;
  tenKhach: ReadonlySet<string>;
  tenNhaMay: ReadonlySet<string>;
}

export interface KetQuaChe<T> {
  giaTri: T;
  soTruongDaChe: number;
  theoLoai: Record<string, number>;
}

export const TU_DIEN_RONG: TuDienNhay = { tenNguoiDung: new Set(), tenKhach: new Set(), tenNhaMay: new Set() };

// ─── Chuẩn hoá ──────────────────────────────────────────────────────────────────────────────────────────────

const RE_RONG_0 = /[​-‍⁠﻿­᠎‪-‮⁦-⁩]/g;

/** NFKC + bỏ ký tự vô hình / điều hướng hai chiều. */
export function chuanHoaDeKhop(s: string): string {
  return s.normalize("NFKC").replace(RE_RONG_0, "");
}

/** Đồng chữ Cyrillic / Hy Lạp → Latin. CHỈ dùng khi dò nhãn (xem `suaDongChu`). */
const DONG_CHU: Readonly<Record<string, string>> = {
  а: "a", в: "b", е: "e", о: "o", р: "p", с: "c", ѕ: "s", і: "i", ј: "j", ԁ: "d", к: "k", м: "m", т: "t", у: "y",
  х: "x", һ: "h", ԛ: "q", ԝ: "w", ո: "n",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", Ѕ: "S", І: "I", Ј: "J",
  α: "a", ο: "o", ν: "v", ρ: "p", κ: "k", ι: "i", τ: "t", υ: "u",
  Α: "A", Β: "B", Ε: "E", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Χ: "X", Υ: "Y", Ζ: "Z",
};
const RE_CO_DONG_CHU = new RegExp(`[${Object.keys(DONG_CHU).join("")}]`, "u");

function boDongChu(s: string): string {
  let out = "";
  for (const ch of s) out += DONG_CHU[ch] ?? ch;
  return out;
}

/** Từ khoá nhạy dùng cho các bước GOM (đồng chữ, chữ tách, mã phần trăm) — chuỗi con, chữ thường. */
const TU_KHOA_GOM = ["password", "passwd", "pwd", "secret", "token", "apikey", "api_key", "authorization", "bearer", "credential", "privatekey", "private_key"];
const chuaTuKhoaGom = (s: string): boolean => {
  const t = s.toLowerCase();
  return TU_KHOA_GOM.some((k) => t.includes(k));
};

/** Từ trộn Latin + đồng chữ, hoặc từ toàn đồng chữ mà sau khi đổi thành từ khoá nhạy ⇒ đổi sang Latin. */
function suaDongChu(s: string): string {
  if (!RE_CO_DONG_CHU.test(s)) return s;
  return s.replace(/[\p{L}\p{M}]+/gu, (tu) => {
    if (!RE_CO_DONG_CHU.test(tu)) return tu;
    const latin = boDongChu(tu);
    return /[A-Za-z]/.test(tu) || chuaTuKhoaGom(latin) ? latin : tu;
  });
}

/** `p a s s w o r d` / `p.a.s.s.w.o.r.d` ⇒ `password` (chỉ khi bản gom chứa từ khoá nhạy). */
function gomChuTach(s: string): string {
  return s.replace(/(?<![\p{L}\p{N}])(?:[A-Za-z][ .]){3,}[A-Za-z](?![\p{L}\p{N}])/gu, (doan) => {
    const gom = doan.replace(/[ .]/g, "");
    return chuaTuKhoaGom(gom) ? gom : doan;
  });
}

/** `%70assword` ⇒ `password` (chỉ khi bản giải mã chứa từ khoá nhạy). */
function giaiPhanTram(s: string): string {
  if (!s.includes("%")) return s;
  return s.replace(/(?:%[0-9A-Fa-f]{2}|[A-Za-z0-9_-])*%[0-9A-Fa-f]{2}(?:%[0-9A-Fa-f]{2}|[A-Za-z0-9_-])*/g, (doan) => {
    try {
      const giai = decodeURIComponent(doan);
      return chuaTuKhoaGom(giai) ? giai : doan;
    } catch {
      return doan;
    }
  });
}

// ─── Tên khoá nhạy ──────────────────────────────────────────────────────────────────────────────────────────

/** So khớp NGUYÊN ĐOẠN (hoặc ghép 2–3 đoạn liền nhau) — không chuỗi con, để `maxTokens`/`passRate` không bị che. */
const TU_NHAY = new Set([
  "password", "passwd", "pwd", "secret", "token", "apikey", "xapikey", "authorization", "cookie", "session",
  "privatekey", "accesskey", "secretaccesskey", "clientsecret", "connectionstring", "connstr", "dsn", "credential",
  "credentials", "signature", "bearer", "pat", "refreshtoken", "accesstoken", "idtoken", "passphrase", "sessionid",
]);

/**
 * NGOẠI LỆ (rà kiem-dinh mục 2): đoạn CUỐI của tên là đơn vị đo / siêu dữ liệu ⇒ giá trị KHÔNG phải bí mật.
 *   count/counts/limit/budget/usage/vao/ra/uoc/giu/in/out — số đếm token (`tokenCount`, `tokenVao`, `tokensOut`);
 *   len/length/size/min/max/policy — chính sách mật khẩu (`password_policy_min_length`);
 *   type/types/expiry/expires/expiresat/ttl/timeout — loại / hạn (`tokenType: "Bearer"`, `sessionTimeout`);
 *   name/label/hint/url/uri/endpoint/path/file/header/field/algorithm/alg — TÊN / ĐỊA CHỈ của bí mật, không phải bí mật.
 * Tên GHÉP nguyên khối được miễn: `tokenizer` (tên bộ tách từ), `tokens` (số đếm).
 */
const DOAN_CUOI_MIEN = new Set([
  "count", "counts", "limit", "limits", "budget", "usage", "vao", "ra", "uoc", "giu", "in", "out", "used",
  "len", "length", "size", "min", "max", "policy", "rule", "rules",
  "type", "types", "expiry", "expires", "expiresat", "ttl", "timeout", "age",
  "name", "label", "hint", "url", "uri", "endpoint", "path", "file", "header", "field", "algorithm", "alg", "id",
]);
const TEN_MIEN = new Set(["tokenizer", "tokens", "maxtokens"]);

function tachDoan(ten: string): string[] {
  return boDongChu(chuanHoaDeKhop(ten))
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_.\-]+/)
    .filter(Boolean);
}

/** Tên khoá (JSON / nhãn văn bản) có phải tên của một bí mật không. */
export function laTenKhoaNhay(ten: string): boolean {
  const doan = tachDoan(ten);
  if (doan.length === 0) return false;
  const gop = doan.join("");
  if (TEN_MIEN.has(gop)) return false;
  // `sessionId` là bí mật (định danh phiên) dù `id` thuộc đoạn miễn.
  if (gop === "sessionid") return true;
  if (doan.length > 1 && DOAN_CUOI_MIEN.has(doan[doan.length - 1]!)) return false;
  if (TU_NHAY.has(gop)) return true;
  for (let i = 0; i < doan.length; i++) {
    let ghep = "";
    for (let j = i; j < Math.min(doan.length, i + 3); j++) {
      ghep += doan[j];
      if (TU_NHAY.has(ghep)) return true;
    }
  }
  return false;
}

// ─── Luật trên văn bản ──────────────────────────────────────────────────────────────────────────────────────

const OCT = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const RE_IPV4_NOI_BO = new RegExp(
  `(?<![\\d.])(?:10\\.${OCT}\\.${OCT}\\.${OCT}|172\\.(?:1[6-9]|2\\d|3[01])\\.${OCT}\\.${OCT}|192\\.168\\.${OCT}\\.${OCT}` +
    `|127\\.${OCT}\\.${OCT}\\.${OCT}|169\\.254\\.${OCT}\\.${OCT}|100\\.(?:6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.${OCT}\\.${OCT})(?![\\d]|\\.\\d)`,
  "g",
);
const RE_IPV6_NOI_BO = /(?<![0-9A-Fa-f:])(?:fe[89ab][0-9a-f]|f[cd][0-9a-f]{2})(?::[0-9a-f]{0,4}){1,7}(?![0-9A-Fa-f:])/gi;
const RE_MAC = /(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])/g;

/** Khoá có tiền tố mà `aiSafety` chưa biết (thân có `-`): Anthropic, OpenAI dạng chung. */
const RE_KHOA_THEM = /(?<![A-Za-z0-9])(?:sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,})/g;
const RE_BASIC = /(Authorization["']?\s*[:=]\s*["']?Basic\s+)[A-Za-z0-9+/=]{8,}/gi;
const RE_QUERY = /([?&](?:token|api_key|apikey|access_token|key|password|secret|sig|signature|auth)=)[^&#\s"']+/gi;
const RE_NHAN = /(?<![A-Za-z0-9_.])([A-Za-z][A-Za-z0-9_.-]{0,63})(["']?[ \t]*[=:](?![=:/])[ \t]*)("[^"\n]*"|'[^'\n]*'|[^\s"',;&}\])=]+)/g;
const RE_NGUOI_DUNG = /(?<![A-Za-z0-9_])((?:user(?:name)?|login|uid)["']?[ \t]*[=:][ \t]*)(["']?)([A-Za-z0-9._@\\-]+)(?![^\s"',;&})\]])/gi;

/** Giá trị trông như KIỂU / BIỂU THỨC mã (không phải giá trị bí mật) ⇒ giữ, để mã gửi đi rà vẫn đọc được. */
const RE_GIA_TRI_MA = /^(?:string|number|boolean|null|undefined|true|false|any|unknown|none|nil|str|int|bytes|optional|void)$|^(?:process\.env|import\.meta|os\.environ|\$\{|\{\{)|^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\(.*)?$|^[A-Za-z_$][\w$]*\(/;

function laGiaTriMa(v: string): boolean {
  return v.startsWith("[REDACTED") || RE_GIA_TRI_MA.test(v);
}

// ─── Từ điển tên ────────────────────────────────────────────────────────────────────────────────────────────

/** Từ thông dụng KHÔNG che dù trùng tên người dùng / nhà máy (dương tính giả). */
export const TU_DUNG: ReadonlySet<string> = new Set([
  "admin", "administrator", "test", "user", "users", "pass", "root", "demo", "guest", "system", "factory", "nha may",
  "operator", "engineer", "manager", "default", "public", "support", "service", "unknown", "khach", "khach hang",
]);

interface NutTen {
  con: Map<string, NutTen>;
  /** một tên trong từ điển KẾT THÚC ở nút này */
  ket: boolean;
}
const DEM_CHI_MUC = new WeakMap<TuDienNhay, NutTen>();
const RE_TU = /[\p{L}\p{N}]+/gu;

/** Cây tiền tố theo TỪ (chữ thường) — "Công ty TNHH …" chung từ đầu vẫn tra O(độ dài tên), không O(số tên). */
function chiMucCua(tu: TuDienNhay): NutTen {
  const co = DEM_CHI_MUC.get(tu);
  if (co) return co;
  const goc: NutTen = { con: new Map(), ket: false };
  for (const tap of [tu.tenNguoiDung, tu.tenKhach, tu.tenNhaMay]) {
    for (const ten of tap) {
      const chuan = chuanHoaDeKhop(ten).trim().replace(/\s+/g, " ").toLowerCase();
      if (chuan.length < 4 || TU_DUNG.has(chuan)) continue;
      const cacTu = chuan.match(RE_TU);
      if (!cacTu) continue;
      let nut = goc;
      for (const w of cacTu) {
        let sau = nut.con.get(w);
        if (!sau) nut.con.set(w, (sau = { con: new Map(), ket: false }));
        nut = sau;
      }
      nut.ket = true;
    }
  }
  DEM_CHI_MUC.set(tu, goc);
  return goc;
}

/** Ngăn cách giữa hai từ của MỘT tên: ≤ 3 ký tự, không xuống dòng (vd " ", ", ", " - "). */
const RE_NGAN_TEN = /^[^\p{L}\p{N}\n]{1,3}$/u;

/**
 * Che tên theo cây tiền tố TỪ (lệch kế hoạch "một regex hợp nhất": regex 5 000 nhánh không có trần thời gian trên V8,
 * đo 615 ms/200 KB với tên chung từ đầu; cây từ < 50 ms). Ngữ nghĩa: nguyên từ, không phân biệt hoa-thường, khớp DÀI nhất.
 */
function cheTen(s: string, tu: TuDienNhay, dem: (loai: string) => void): string {
  const goc = chiMucCua(tu);
  if (goc.con.size === 0) return s;
  const cacTu = [...s.matchAll(RE_TU)].map((m) => ({ w: m[0].toLowerCase(), bd: m.index!, kt: m.index! + m[0].length }));
  let out = "";
  let viTri = 0;
  for (let i = 0; i < cacTu.length; i++) {
    let nut: NutTen | undefined = goc;
    let cuoi = -1;
    for (let j = i; j < cacTu.length; j++) {
      if (j > i && !RE_NGAN_TEN.test(s.slice(cacTu[j - 1]!.kt, cacTu[j]!.bd))) break;
      nut = nut.con.get(cacTu[j]!.w);
      if (!nut) break;
      if (nut.ket) cuoi = j;
    }
    if (cuoi < 0) continue;
    out += s.slice(viTri, cacTu[i]!.bd) + THAY.ten;
    viTri = cacTu[cuoi]!.kt;
    dem("ten");
    i = cuoi;
  }
  return viTri === 0 ? s : out + s.slice(viTri);
}

// ─── API ────────────────────────────────────────────────────────────────────────────────────────────────────

function boDem(): { dem: (loai: string, n?: number) => void; theoLoai: Record<string, number>; tong: () => number } {
  const theoLoai: Record<string, number> = {};
  return {
    theoLoai,
    dem: (loai, n = 1) => {
      theoLoai[loai] = (theoLoai[loai] ?? 0) + n;
    },
    tong: () => Object.values(theoLoai).reduce((a, b) => a + b, 0),
  };
}

function cheChuoiVao(s: string, tu: TuDienNhay, dem: (loai: string, n?: number) => void): string {
  let t = giaiPhanTram(gomChuTach(suaDongChu(chuanHoaDeKhop(s))));

  t = t.replace(RE_KHOA_THEM, () => (dem("api_key"), THAY.biMat));
  t = t.replace(RE_BASIC, (_k, nhan: string) => (dem("basic"), nhan + THAY.biMat));
  const nen = redactSecretsAndPII(t);
  t = nen.text;
  for (const r of nen.redactions) dem(r.type, r.count);
  t = t.replace(RE_QUERY, (_k, nhan: string) => (dem("query"), nhan + THAY.biMat));
  t = t.replace(RE_NHAN, (khop, nhan: string, ngan: string, giaTri: string) => {
    if (!laTenKhoaNhay(nhan)) return khop;
    const nhay = giaTri[0] === '"' || giaTri[0] === "'" ? giaTri[0] : "";
    const loi = nhay ? giaTri.slice(1, -1) : giaTri;
    if (loi.length === 0 || laGiaTriMa(loi)) return khop;
    dem("nhan");
    return `${nhan}${ngan}${nhay}${THAY.biMat}${nhay}`;
  });
  t = t.replace(RE_NGUOI_DUNG, (khop, nhan: string, nhay: string, giaTri: string) => {
    if (laGiaTriMa(giaTri)) return khop;
    dem("nguoi_dung");
    return `${nhan}${nhay}${THAY.nguoiDung}`;
  });
  t = t.replace(RE_IPV4_NOI_BO, () => (dem("ip"), THAY.ip));
  t = t.replace(RE_IPV6_NOI_BO, () => (dem("ip"), THAY.ip));
  t = t.replace(RE_MAC, () => (dem("mac"), THAY.mac));
  return cheTen(t, tu, dem);
}

/** Che một chuỗi văn bản. */
export function cheChuoi(s: string, tu: TuDienNhay = TU_DIEN_RONG): KetQuaChe<string> {
  const d = boDem();
  if (typeof s !== "string" || s.length === 0) return { giaTri: s, soTruongDaChe: 0, theoLoai: d.theoLoai };
  const giaTri = cheChuoiVao(s, tu, d.dem);
  return { giaTri, soTruongDaChe: d.tong(), theoLoai: d.theoLoai };
}

const KHOA_TEN_CAP = new Set(["name", "key", "header", "field", "param", "ten", "khoa", "bien", "variable", "env"]);
const KHOA_GIA_TRI_CAP = ["value", "val", "data", "giaTri", "gia_tri"];
const RE_TRONG_NHU_JSON = /^\s*[[{"]/;
const SO_LOP_JSON_TOI_DA = 3;

/** Bóc tối đa 3 lớp JSON.stringify; trả số lớp + giá trị nếu đáy là object/mảng. */
function bocJson(s: string): { lop: number; giaTri: unknown } | null {
  let cur: unknown = s;
  for (let lop = 1; lop <= SO_LOP_JSON_TOI_DA; lop++) {
    if (typeof cur !== "string" || !RE_TRONG_NHU_JSON.test(cur)) return null;
    try {
      cur = JSON.parse(cur);
    } catch {
      return null;
    }
    if (cur !== null && typeof cur === "object") return { lop, giaTri: cur };
  }
  return null;
}

function cheNut(v: unknown, tu: TuDienNhay, dem: (loai: string, n?: number) => void, sau: number): unknown {
  if (sau > 64) return THAY.biMat; // cây sâu bất thường ⇒ che cả nhánh (fail-closed)
  if (typeof v === "string") {
    const boc = bocJson(v);
    if (boc) {
      let ra: unknown = cheNut(boc.giaTri, tu, dem, sau + 1);
      for (let i = 0; i < boc.lop; i++) ra = JSON.stringify(ra);
      return ra;
    }
    return cheChuoiVao(v, tu, dem);
  }
  if (Array.isArray(v)) return v.map((x) => cheNut(x, tu, dem, sau + 1));
  if (v === null || typeof v !== "object") return v;
  const goc = v as Record<string, unknown>;
  // Luật CẶP: {name: "DB_PASSWORD", value: X} ⇒ che X.
  const capNhay = Object.entries(goc).some(([k, x]) => KHOA_TEN_CAP.has(k.toLowerCase()) && typeof x === "string" && laTenKhoaNhay(x));
  const ra: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(goc)) {
    if (x !== null && x !== undefined && (laTenKhoaNhay(k) || (capNhay && KHOA_GIA_TRI_CAP.includes(k)))) {
      dem("khoa_json");
      ra[k] = typeof x === "number" || typeof x === "boolean" ? null : THAY.biMat;
      continue;
    }
    ra[k] = cheNut(x, tu, dem, sau + 1);
  }
  return ra;
}

/**
 * Che CÂY DỮ LIỆU (nội dung tin nhắn, kết quả tool, đối số). KHÔNG gọi trên trường giao thức (`maxTokens`, `model`…)
 * hay schema tool (dùng `cheSchemaTool`).
 */
export function cheGiaTri(v: unknown, tu: TuDienNhay = TU_DIEN_RONG): KetQuaChe<unknown> {
  const d = boDem();
  const giaTri = cheNut(v, tu, d.dem, 0);
  return { giaTri, soTruongDaChe: d.tong(), theoLoai: d.theoLoai };
}

/** Che schema tool: chỉ che CHUỖI (mô tả, ví dụ, mặc định); giữ nguyên tên thuộc tính và kiểu. */
export function cheSchemaTool(schema: unknown, tu: TuDienNhay = TU_DIEN_RONG): KetQuaChe<unknown> {
  const d = boDem();
  const di = (v: unknown, sau: number): unknown => {
    if (sau > 64) return {};
    if (typeof v === "string") return cheChuoiVao(v, tu, d.dem);
    if (Array.isArray(v)) return v.map((x) => di(x, sau + 1));
    if (v === null || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, di(x, sau + 1)]));
  };
  const giaTri = di(schema, 0);
  return { giaTri, soTruongDaChe: d.tong(), theoLoai: d.theoLoai };
}

// ─── Từ điển từ DB (đệm 5 phút) ─────────────────────────────────────────────────────────────────────────────

export const HAN_DEM_TU_DIEN_MS = 5 * 60 * 1000;
let demTuDien: { luc: number; tu: TuDienNhay } | null = null;

export interface NguonTenNhay {
  docTen(): Promise<{ nguoiDung: string[]; khach: string[]; nhaMay: string[] }>;
}

const nguonTenMacDinh: NguonTenNhay = {
  async docTen() {
    const { getDb } = await import("../../../db/connection");
    const { users, customers, factories } = await import("../../../../drizzle/schema");
    const db = await getDb();
    if (!db) throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "tuDienNhay", reason: "dbUnavailable" });
    const [u, c, f] = await Promise.all([
      db.select({ username: users.username, name: users.name }).from(users),
      db.select({ name: customers.name }).from(customers),
      db.select({ name: factories.name }).from(factories),
    ]);
    return {
      nguoiDung: u.flatMap((r) => [r.username, r.name]).filter((x): x is string => typeof x === "string"),
      khach: c.map((r) => r.name),
      nhaMay: f.map((r) => r.name),
    };
  },
};

/**
 * Từ điển tên nhạy. Đọc DB lỗi ⇒ NÉM (người gọi — cổng — từ chối gửi: không che được tên thì không gửi).
 */
export async function layTuDienNhay(nguon: NguonTenNhay = nguonTenMacDinh, bayGio = Date.now()): Promise<TuDienNhay> {
  if (demTuDien && bayGio - demTuDien.luc < HAN_DEM_TU_DIEN_MS) return demTuDien.tu;
  const ten = await nguon.docTen();
  const tu: TuDienNhay = { tenNguoiDung: new Set(ten.nguoiDung), tenKhach: new Set(ten.khach), tenNhaMay: new Set(ten.nhaMay) };
  demTuDien = { luc: bayGio, tu };
  return tu;
}

/** Chỉ cho test. */
export function __xoaDemTuDien(): void {
  demTuDien = null;
}
