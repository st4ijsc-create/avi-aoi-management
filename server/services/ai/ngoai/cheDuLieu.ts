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

/**
 * `%70assword` ⇒ `password` (chỉ khi bản giải mã chứa từ khoá nhạy). TUYẾN TÍNH (rà kiem-dinh F: regex cũ dò lại từ mỗi vị
 * trí ⇒ 2,2 s ở 80 KB): lớp ký tự đơn `+` khớp tối đa một lần mỗi chuỗi liền; giải từng `%XX` ASCII (đủ cho dò nhãn).
 */
function giaiPhanTram(s: string): string {
  if (!s.includes("%")) return s;
  return s.replace(/[A-Za-z0-9_%-]+/g, (doan) => {
    if (!doan.includes("%")) return doan;
    const giai = doan.replace(/%([0-7][0-9A-Fa-f])/g, (_k, h: string) => String.fromCharCode(parseInt(h, 16)));
    return giai !== doan && chuaTuKhoaGom(giai) ? giai : doan;
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

/**
 * `DB_PASS`, `root_pass`, `mysql_pass` (rà kiem-dinh lô 1, điểm 2): đoạn CUỐI là `pass` và có tiền tố. `pass` đứng một mình,
 * `passed`, `passRate` vẫn KHÔNG nhạy (từ vựng QC Pass/Fail). Giá trị kiểu QC (`GIA_TRI_QC`) dưới tên này được giữ.
 */
function laTenDuoiPass(doan: string[]): boolean {
  return doan.length > 1 && doan[doan.length - 1] === "pass";
}
export function laTenPass(ten: string): boolean {
  return laTenDuoiPass(tachDoan(ten));
}
const GIA_TRI_QC = /^(?:pass(?:ed)?|fail(?:ed)?|ok|ng|true|false|-?\d+(?:[.,]\d+)?\s*%?)$/i;
/** Giá trị QC (Pass/Fail/OK/NG/bool/số/%) — dưới tên kiểu `*_pass` thì KHÔNG phải mật khẩu. */
export function laGiaTriQc(v: unknown): boolean {
  return typeof v === "boolean" || typeof v === "number" || (typeof v === "string" && GIA_TRI_QC.test(v.trim()));
}

/** Tên khoá (JSON / nhãn văn bản) có phải tên của một bí mật không. */
/** Đệm kết quả theo tên (nhãn lặp lại rất nhiều trong một văn bản — `a:b a:b …`); xoá sạch khi quá 4 096 mục. */
const DEM_TEN_NHAY = new Map<string, boolean>();
export function laTenKhoaNhay(ten: string): boolean {
  const co = DEM_TEN_NHAY.get(ten);
  if (co !== undefined) return co;
  const kq = laTenKhoaNhayTinh(ten);
  if (DEM_TEN_NHAY.size >= 4096) DEM_TEN_NHAY.clear();
  DEM_TEN_NHAY.set(ten, kq);
  return kq;
}

function laTenKhoaNhayTinh(ten: string): boolean {
  const doan = tachDoan(ten);
  if (doan.length === 0) return false;
  const gop = doan.join("");
  if (TEN_MIEN.has(gop)) return false;
  // `sessionId` là bí mật (định danh phiên) dù `id` thuộc đoạn miễn.
  if (gop === "sessionid") return true;
  if (doan.length > 1 && DOAN_CUOI_MIEN.has(doan[doan.length - 1]!)) return false;
  if (TU_NHAY.has(gop)) return true;
  if (laTenDuoiPass(doan)) return true;
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
/** URL webhook MANG bí mật trong đường dẫn (rà kiem-dinh E): Slack, Discord, Teams, bot Telegram. */
const RE_WEBHOOK =
  /(https?:\/\/(?:hooks\.slack\.com\/(?:services|workflows|triggers)\/|(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/|[A-Za-z0-9.-]*webhook\.office\.com\/|api\.telegram\.org\/bot))[^\s"'<>]+/gi;
const RE_TELEGRAM = /(?<![A-Za-z0-9])\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g;
/** Nhãn + ngăn (KHÔNG gồm giá trị — giá trị quét tay ở `cheNhan`, chỉ khi nhãn nhạy ⇒ tuyến tính). */
const RE_NHAN_DAU = /(?<![A-Za-z0-9_.])([A-Za-z][A-Za-z0-9_.-]{0,63})((?:\\?["'])?[ \t]*[=:](?![=:/])[ \t]*)/g;
const RE_NGUOI_DUNG = /(?<![A-Za-z0-9_])((?:user(?:name)?|login|uid)["']?[ \t]*[=:][ \t]*)(["']?)([A-Za-z0-9._@\\-]+)(?![^\s"',;&})\]])/gi;

/**
 * TRẦN CHUỖI LIỀN (rà kiem-dinh F — ReDoS): nhiều regex của tầng cũ `aiSafety` (email, chuỗi kết nối) tốn BẬC HAI theo độ
 * dài một chuỗi liền (đo: `"10.1.1.".repeat(20000)` ⇒ 11,6 s, chặn vòng lặp sự kiện chung với đường STOP). Chuỗi liền
 * ≥ 2 000 ký tự không trắng KHÔNG phải văn xuôi / mã đọc được — che NGUYÊN khối (fail-closed, che thừa) TRƯỚC mọi luật
 * khác ⇒ mọi luật sau chạy trên chuỗi liền có trần (chi phí ≤ 2 000 × n). Lookbehind neo ở ĐẦU chuỗi liền ⇒ tuyến tính.
 * Lưới "TUYẾN TÍNH" trong `cheDuLieu.test.ts` đỏ khi bỏ dòng này (họ `x://a:b`: 6 s) — KHI tầng cũ còn bậc hai (trước `134988874`).
 *
 * ★ NỚI 2 000 → 8 000 (2026-10-26, dieu-phoi c — ĐO trên `aiSafety` TUYẾN TÍNH đã ở main `134988874`): KHÔNG trần, 12 họ xấu × 256 KB
 * (trần mỗi chuỗi của cổng) ⇒ chậm nhất 30 ms (`a-…%`), tỉ lệ t(2n)/t(n) 1,0–2,8 ⇒ trần không còn cần cho HIỆU NĂNG. Giá của 2 000:
 * log JSON gọn bị cắt 2,4 KB (`log:{"may":…,"nhietDo":[600 số]…` không đóng) bị che NGUYÊN khối ⇒ mất dữ liệu kỹ thuật vô hại; 8 000
 * giữ được. Vẫn GIỮ trần (phòng thủ nếu tầng cũ hồi quy bậc hai; khối liền > 8 KB thường là base64 / tệp nhị phân ⇒ che là đúng).
 */
const RE_KHONG_TRANG_DAI = /(?<!\S)\S{8000,}/g;

/** PEM khoá riêng — quét TUYẾN TÍNH (regex lười `[\s\S]*?` của tầng cũ bậc hai khi nhiều BEGIN không END). Không có END ⇒ che tới hết văn bản. */
function chePem(t: string, dem: (loai: string) => void): string {
  if (!t.includes("-----BEGIN")) return t;
  let out = "";
  let i = 0;
  for (;;) {
    const b = t.indexOf("-----BEGIN", i);
    if (b < 0) break;
    const hetNhan = t.indexOf("-----", b + 10);
    if (hetNhan < 0) break;
    if (hetNhan - b > 60 || !/PRIVATE KEY$/.test(t.slice(b + 10, hetNhan))) {
      out += t.slice(i, b + 10);
      i = b + 10;
      continue;
    }
    const e = t.indexOf("-----END", hetNhan + 5);
    const k = e < 0 ? -1 : t.indexOf("-----", e + 8);
    out += t.slice(i, b) + THAY.biMat;
    dem("private_key");
    i = e < 0 || k < 0 ? t.length : k + 5;
  }
  return out + t.slice(i);
}

/** Nhãn mà giá trị là CẢ DÒNG (chứa `;`, `,`, `=`): cookie, header xác thực. */
const NHAN_CA_DONG = new Set(["cookie", "setcookie", "authorization", "proxyauthorization"]);
const NGAT_GIA_TRI = new Set([";", ",", "&", "}", "]", ")", '"', "'"]);

/** Vị trí kết thúc giá trị bắt đầu ở `p`: chuỗi nháy cùng dòng ⇒ tới nháy đóng; còn lại ⇒ tới hết dòng (hoặc ký tự ngắt). */
function ketThucGiaTri(t: string, p: number, caDong: boolean): number {
  const q = t[p];
  let i = p;
  // JSON thoát một lớp trong văn bản (`\"password\":\"x\"`) ⇒ giá trị tới `\"` kế cùng dòng.
  if (q === "\\" && t[p + 1] === '"') {
    const e = t.indexOf('\\"', p + 2);
    const nl = t.indexOf("\n", p + 2);
    if (e >= 0 && (nl < 0 || e < nl)) return e + 2;
  }
  if (q === '"' || q === "'") {
    const e = t.indexOf(q, p + 1);
    const nl = t.indexOf("\n", p + 1);
    if (e >= 0 && (nl < 0 || e < nl)) return e + 1;
    i = p + 1; // nháy không đóng ⇒ quét như không nháy
  }
  for (; i < t.length; i++) {
    const c = t[i]!;
    if (c === "\n" || c === "\r") break;
    // chỗ trống đã che (`[REDACTED_…]`) là MỘT khối — `]` của nó không ngắt giá trị (vd tầng cũ đã che từ đầu của passphrase).
    if (c === "[" && t.startsWith("[REDACTED_", i)) {
      const e = t.indexOf("]", i);
      if (e > 0) {
        i = e;
        continue;
      }
    }
    // mẫu `${{ … }}` / `{{ … }}` / `${ … }` là một khối — `}` bên trong không ngắt giá trị.
    const dong = t.startsWith("${{", i) || t.startsWith("{{", i) ? "}}" : t.startsWith("${", i) ? "}" : null;
    if (dong) {
      const e = t.indexOf(dong, i + 2);
      const nl = t.indexOf("\n", i);
      if (e > 0 && (nl < 0 || e < nl)) {
        i = e + dong.length - 1;
        continue;
      }
    }
    if (!caDong && NGAT_GIA_TRI.has(c)) break;
  }
  while (i > p && (t[i - 1] === " " || t[i - 1] === "\t")) i--;
  return i;
}

/** Nhãn nhạy (`laTenKhoaNhay`) + `:`/`=` ⇒ che giá trị (rà kiem-dinh A/C: cookie cả dòng; giá trị nhiều từ không nháy tới hết dòng). */
function cheNhan(t: string, dem: (loai: string) => void): string {
  let out = "";
  let viTri = 0;
  RE_NHAN_DAU.lastIndex = 0;
  for (let m = RE_NHAN_DAU.exec(t); m; m = RE_NHAN_DAU.exec(t)) {
    const nhan = m[1]!;
    if (!laTenKhoaNhay(nhan)) continue;
    const p = m.index + m[0].length;
    const kt = ketThucGiaTri(t, p, NHAN_CA_DONG.has(nhan.toLowerCase().replace(/[-_]/g, "")));
    const tho = t.slice(p, kt);
    const nhay =
      tho.length >= 4 && tho.startsWith('\\"') && tho.endsWith('\\"')
        ? '\\"'
        : (tho[0] === '"' || tho[0] === "'") && tho.length > 1 && tho.endsWith(tho[0])
          ? tho[0]
          : "";
    const loi = (nhay ? tho.slice(nhay.length, -nhay.length) : tho).trim();
    if (!loi || laGiaTriMa(loi) || (laTenPass(nhan) && laGiaTriQc(loi))) continue;
    out += t.slice(viTri, p) + nhay + THAY.biMat + nhay;
    dem("nhan");
    viTri = kt;
    RE_NHAN_DAU.lastIndex = kt;
  }
  return viTri === 0 ? t : out + t.slice(viTri);
}

// ── Nhãn tiếng Việt (rà kiem-dinh D) — dò trên bản BỎ DẤU, chữ thường, CÙNG ĐỘ DÀI ⇒ chỉ số dùng chung với bản gốc. ──

function boDauGiuDoDai(s: string): string {
  if (!/[^\x00-\x7F]/.test(s)) return s.toLowerCase();
  let o = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c.charCodeAt(0) < 0x80) o += c.toLowerCase();
    else if (c === "đ" || c === "Đ") o += "d";
    else {
      const b = c.normalize("NFD")[0]!.toLowerCase();
      o += b.length === 1 ? b : c;
    }
  }
  return o;
}

/**
 * `mật khẩu: X`, `mat khau = X`, `mk: X`, `mã PIN của máy: X`, `Mật khẩu của tôi là X` … Nhãn ngắn dễ trùng (`mk`, `pin`)
 * chỉ tính khi sau nó là `:`/`=` hoặc "là"; giá trị dạng phần trăm (`Mức pin: 80%`) giữ nguyên.
 */
const RE_NHAN_VIET =
  /(?<![a-z0-9])(mat khau|matkhau|mat ma|mk|ma pin|pin|ma bi mat|khoa bi mat|khoa api|ma xac thuc|ma xac minh|ma otp|otp)((?:[ \t]+[a-z0-9]+){0,5}?)(?:([ \t]*[:=][ \t]*)|([ \t]+la(?![a-z0-9])[ \t]*:?[ \t]*))/g;
const RE_PHAN_TRAM = /^\d{1,3}(?:[.,]\d+)?\s*%$/;
/** ≥ 6 ký tự và (có cả chữ lẫn số, hoặc có ký tự đặc biệt). */
function trongNhuBiMat(v: string): boolean {
  return v.length >= 6 && ((/\p{L}/u.test(v) && /\d/.test(v)) || /[^\p{L}\p{N}\s]/u.test(v));
}
const RE_CHEN_GIUA_VIET = /^[ \t]+(?:cua|cho|moi|cu|hien|mac|dang)(?![a-z0-9])/;

function cheNhanViet(t: string, dem: (loai: string) => void): string {
  const bo = boDauGiuDoDai(t);
  if (bo.length !== t.length) return t;
  let out = "";
  let viTri = 0;
  RE_NHAN_VIET.lastIndex = 0;
  for (let m = RE_NHAN_VIET.exec(bo); m; m = RE_NHAN_VIET.exec(bo)) {
    // Chữ chen giữa nhãn và ngăn: "của/cho/mới/cũ/hiện/mặc/đang …" luôn được; ≤ 3 từ BẤT KỲ ("mật khẩu wifi là …") chỉ khi giá trị
    // TRÔNG NHƯ bí mật (rà kiem-dinh lô 1, điểm 3) — "mật khẩu mạnh là mật khẩu dài" không phải.
    const chenTuDo = !!m[2] && !RE_CHEN_GIUA_VIET.test(m[2]);
    if (chenTuDo && m[2]!.trim().split(/\s+/).length > 3) {
      RE_NHAN_VIET.lastIndex = m.index + m[1]!.length;
      continue;
    }
    const p = m.index + m[0].length;
    let kt: number;
    if (m[3] !== undefined) kt = ketThucGiaTri(t, p, false);
    else {
      kt = p;
      while (kt < t.length && !/\s/.test(t[kt]!)) kt++;
      while (kt > p && /[.,!?;:)]/.test(t[kt - 1]!)) kt--;
    }
    const loi = t.slice(p, kt).trim();
    // `pin` / `mk` ngắn dễ trùng (chân GPIO `pin: 13`) ⇒ giá trị phải ≥ 4 ký tự.
    const ngan = m[1] === "pin" || m[1] === "mk";
    // Dạng "… là X" (văn xuôi): X ngắn toàn chữ ("là gì", "là mật …") là câu, không phải bí mật.
    const vanXuoi = m[4] !== undefined && loi.length < 4 && !/[\d\W_]/.test(loi.normalize("NFD").replace(/\p{M}/gu, ""));
    if (!loi || RE_PHAN_TRAM.test(loi) || laGiaTriMa(loi) || (ngan && loi.length < 4) || vanXuoi || (chenTuDo && !trongNhuBiMat(loi))) {
      if (chenTuDo) RE_NHAN_VIET.lastIndex = m.index + m[1]!.length;
      continue;
    }
    out += t.slice(viTri, p) + THAY.biMat;
    dem("nhan_viet");
    viTri = kt;
    RE_NHAN_VIET.lastIndex = kt;
  }
  return viTri === 0 ? t : out + t.slice(viTri);
}

/**
 * Giá trị TRÔNG NHƯ MÃ (không phải bí mật) ⇒ giữ, để mã gửi đi rà vẫn đọc được. HẸP CÓ CHỦ Ý (rà kiem-dinh B: `my.company.secret`,
 * `v1.public.…`, `abc(def` là bí mật thật) — chỉ: (i) toàn từ khoá KIỂU (`string`, `string | null`); (ii) truy cập thuộc
 * tính có TIỀN TỐ NGỮ CẢNH MÃ rõ (`req.`, `this.`, `process.env.`, `config.`…), biến môi trường / mẫu (`$X`, `${…}`, `{{…}}`);
 * (iii) chỉ gồm chỗ trống đã che. Mọi thứ khác ⇒ CHE (lỗi về phía che thừa).
 */
const KIEU_MA = new Set([
  "string", "number", "boolean", "null", "undefined", "any", "unknown", "void", "never", "bigint", "object", "none", "nil",
  "str", "int", "float", "bytes", "bool", "optional", "true", "false",
]);
const RE_TIEN_TO_MA =
  /^(?:(?:req|request|res|this|self|cls|config|cfg|conf|settings|options|opts|args|argv|params|props|input|body|ctx|context|env|secrets|vault|process\.env|os\.environ|import\.meta\.env)(?:\.[A-Za-z_$][\w$]*|\[[^\]\s]{1,64}\])+|process\.env|\$\{\{[^}]{1,80}\}\}|\$\{[^}\s]{1,80}\}|\{\{[^}]{1,80}\}\}|\$[A-Za-z_][A-Za-z0-9_]{0,63}|os\.getenv\([^)]{1,80}\)?)$/;
const RE_CHI_CHO_TRONG = /^(?:\[REDACTED_[A-Z]+\]\s*)+$/;

function laGiaTriMa(v: string): boolean {
  if (RE_CHI_CHO_TRONG.test(v) || RE_TIEN_TO_MA.test(v)) return true;
  const tu = v.split(/[\s|&?<>[\]]+/).filter(Boolean);
  return tu.length > 0 && tu.every((x) => KIEU_MA.has(x.toLowerCase()));
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

/**
 * JSON NHÚNG trong văn bản (rà lô 2: `"Hệ thống. [{"name":"DB_PASSWORD","value":"x"}]"` — cả chuỗi không parse được nên luật CẶP / tên
 * khoá trên cây không chạy). MỘT lượt tuyến tính ghép ngoặc (bỏ qua ngoặc trong chuỗi "…"), lấy các cặp NGOÀI CÙNG `{…}` / `[…]`, thử
 * `JSON.parse` từng đoạn (≤ 256 KB); đoạn parse được ⇒ che theo CÂY (`cheNut`), phần còn lại che theo luật văn bản.
 */
const TRAN_DOAN_JSON = 256 * 1024;
function tachJsonNhung(t: string): Array<{ van: string } | { json: unknown }> {
  if (!/[{[]/.test(t)) return [{ van: t }];
  const cap: Array<[number, number]> = [];
  const ngan: Array<{ i: number; c: string }> = [];
  let trongChuoi = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (trongChuoi) {
      if (c === "\\") i++;
      else if (c === '"' || c === "\n") trongChuoi = false;
      continue;
    }
    if (c === '"') {
      if (ngan.length) trongChuoi = true; // chỉ coi là chuỗi JSON khi đang trong ngoặc
    } else if (c === "{" || c === "[") ngan.push({ i, c });
    else if (c === "}" || c === "]") {
      const mo = ngan.pop();
      if (!mo || (mo.c === "{") !== (c === "}")) ngan.length = 0;
      else if (ngan.length === 0) cap.push([mo.i, i]);
    }
  }
  const ra: Array<{ van: string } | { json: unknown }> = [];
  let viTri = 0;
  for (const [a, b] of cap) {
    if (b - a + 1 > TRAN_DOAN_JSON || b - a < 2) continue;
    let v: unknown;
    try {
      v = JSON.parse(t.slice(a, b + 1));
    } catch {
      continue;
    }
    if (v === null || typeof v !== "object") continue;
    if (a > viTri) ra.push({ van: t.slice(viTri, a) });
    ra.push({ json: v });
    viTri = b + 1;
  }
  if (viTri === 0) return [{ van: t }];
  if (viTri < t.length) ra.push({ van: t.slice(viTri) });
  return ra;
}

function cheChuoiVao(s: string, tu: TuDienNhay, dem: (loai: string, n?: number) => void, sau = 0): string {
  const t = chePem(chuanHoaDeKhop(s), dem);
  return tachJsonNhung(t)
    .map((d) => ("json" in d ? JSON.stringify(cheNut(d.json, tu, dem, sau + 1)) : cheVanBan(d.van, tu, dem)))
    .join("");
}

function cheVanBan(van: string, tu: TuDienNhay, dem: (loai: string, n?: number) => void): string {
  let t = van.replace(RE_KHONG_TRANG_DAI, () => (dem("chuoi_lien_dai"), THAY.biMat));
  t = giaiPhanTram(gomChuTach(suaDongChu(t)));

  t = t.replace(RE_WEBHOOK, (_k, dau: string) => (dem("webhook"), dau + THAY.biMat));
  t = t.replace(RE_TELEGRAM, () => (dem("api_key"), THAY.biMat));
  t = t.replace(RE_KHOA_THEM, () => (dem("api_key"), THAY.biMat));
  t = t.replace(RE_BASIC, (_k, nhan: string) => (dem("basic"), nhan + THAY.biMat));
  const nen = redactSecretsAndPII(t);
  t = nen.text;
  for (const r of nen.redactions) dem(r.type, r.count);
  t = t.replace(RE_QUERY, (_k, nhan: string) => (dem("query"), nhan + THAY.biMat));
  t = cheNhanViet(cheNhan(t, dem), dem);
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

/** Gán thuộc tính RIÊNG — `ra["__proto__"] = …` sẽ đổi prototype (thả nhánh im lặng / ô nhiễm), không phải tạo khoá. */
function datRieng(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

function cheNut(v: unknown, tu: TuDienNhay, dem: (loai: string, n?: number) => void, sau: number): unknown {
  if (sau > 64) {
    dem("cay_qua_sau");
    return THAY.biMat; // cây sâu bất thường ⇒ che cả nhánh (fail-closed)
  }
  if (typeof v === "string") {
    const boc = bocJson(v);
    if (boc) {
      let ra: unknown = cheNut(boc.giaTri, tu, dem, sau + 1);
      for (let i = 0; i < boc.lop; i++) ra = JSON.stringify(ra);
      return ra;
    }
    return cheChuoiVao(v, tu, dem, sau);
  }
  if (Array.isArray(v)) return v.map((x) => cheNut(x, tu, dem, sau + 1));
  if (v === null || typeof v !== "object") return v;
  const goc = v as Record<string, unknown>;
  // Luật CẶP: {name: "DB_PASSWORD", value: X} ⇒ che X.
  const capNhay = Object.entries(goc).some(([k, x]) => KHOA_TEN_CAP.has(k.toLowerCase()) && typeof x === "string" && laTenKhoaNhay(x));
  const ra: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(goc)) {
    const nhayTheoTen = laTenKhoaNhay(k) && !(laTenPass(k) && laGiaTriQc(x));
    if (x !== null && x !== undefined && (nhayTheoTen || (capNhay && KHOA_GIA_TRI_CAP.includes(k)))) {
      dem("khoa_json");
      datRieng(ra, k, typeof x === "number" || typeof x === "boolean" ? null : THAY.biMat);
      continue;
    }
    datRieng(ra, k, cheNut(x, tu, dem, sau + 1));
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
