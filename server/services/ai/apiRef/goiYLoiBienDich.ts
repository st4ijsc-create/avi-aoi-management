/**
 * ★ (2026-10-19) "Gợi ý tra cứu API (tự động)" — khuyến nghị #2 của báo cáo nguồn học
 * (`docs/superpowers/audits/2026-10-18-ai-local-nguon-hoc-code.md`), bản TẤT ĐỊNH: khi một lệnh build/test trả lỗi dạng
 * "không tìm thấy kiểu/thành viên/namespace", BỘ THỰC THI MÁY CHỦ tự trích các tên bị báo, tra chỉ mục `traApi` và gắn
 * một khối gợi ý ngắn vào cuối quan sát của lệnh — KHÔNG phụ thuộc model tự gọi `lookup_api` (bộ đo ngẫu nhiên
 * 2026-10-18/19: 2 lần gọi / 81 lượt).
 *
 * Nguyên tắc:
 *   • Không model, không cosine: regex trên đầu ra trình biên dịch/trình chạy test ⇒ tên ⇒ tra CHÍNH XÁC (`traApi`).
 *   • Chỉ gắn khi chỉ mục CÓ mục khớp; tên của chính dự án (không có trong chỉ mục) ⇒ không có dòng nào (không bịa).
 *   • Ngôn ngữ chưa có trong chỉ mục (Go, Rust) ⇒ vẫn trích tên (để sẵn khi chỉ mục mở rộng) nhưng KHÔNG tra — tra
 *     không lọc ngôn ngữ sẽ khớp nhầm C#/Java.
 *   • Tên trần (CS0246/TS2304/NameError/javac class) chỉ khớp ký hiệu MỨC NGOÀI (kiểu, hàm, module — không phải thành viên
 *     của kiểu khác: TS2304 `fs` ⇏ `ReadStreamOptions.fs`).
 *   • Trần: tối đa `TRAN_TEN` tên, mỗi tên ≤ 3 dòng, cả khối ≤ `TRAN_KY_TU` ký tự. Bộ tra hỏng/ném ⇒ `null` (lệnh vẫn
 *     trả kết quả bình thường).
 *   • Khối đánh dấu RÕ là gợi ý của HỆ THỐNG, không phải đầu ra lệnh. Tắt: `AI_AGENT_TU_TRA_API=0`.
 */
import { NGON_NGU_TRA_API, goiYNhap, tenDayDu, type MucApi, type NgonNguApi, type TraApi } from "./traApi";

export type NgonNguLoi = NgonNguApi | "go" | "rust";

export interface TenLoi {
  nn: NgonNguLoi;
  /** mã lỗi / loại ngoại lệ (CS0246, TS2339, "cannot find symbol", NameError, "undefined", E0599…) */
  ma: string;
  /** tên đưa bộ tra: tên trần, hoặc `Kieu.ThanhVien` khi lỗi là thiếu thành viên */
  ten: string;
  kieu?: string;
  thanhVien?: string;
}

export const TIEU_DE_GOI_Y_API = "Gợi ý tra cứu API (tự động)";
const DAU_KHOI =
  `[${TIEU_DE_GOI_Y_API} — system-generated hint from the local API index for names the compiler/test runner ` +
  "could not resolve; NOT part of the command output. Verify against the project before using.]";

const TRAN_TEN = 5;
const TRAN_KY_TU = 1_500;
const TRAN_CHU_KY = 160;
const TRAN_TEN_DAI = 120;

/** `AI_AGENT_TU_TRA_API` — mặc định BẬT; `0`/`false`/`off`/`no` ⇒ tắt. Đọc tại chỗ gọi. */
export function tuTraApiBat(v: string | undefined = process.env.AI_AGENT_TU_TRA_API): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return !(s === "0" || s === "false" || s === "off" || s === "no");
}

// ─── trích tên ──────────────────────────────────────────────────────────────────────────────────

const RE_DINH_DANH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const RE_MODULE = /^[@\w][\w@./-]*$/;

/** Bỏ đối số generic (lồng 2 mức), `?` nullable, `*`/`&`/`mut ` con trỏ/tham chiếu, khoảng trắng. */
function boGeneric(s: string): string {
  return s
    .trim()
    .replace(/^&\s*(?:mut\s+)?/, "")
    .replace(/^\*/, "")
    .replace(/<[^<>]*>/g, "")
    .replace(/<[^<>]*>/g, "")
    .replace(/\?$/, "")
    .trim();
}

/** Kiểu trong thông điệp TS ⇒ tên kiểu tra được (`"abc"` ⇒ String, `number[]` ⇒ Array, `typeof X` ⇒ X); không rõ ⇒ null. */
function kieuTs(s: string): string | null {
  let t = s.trim();
  if (/^["'`]/.test(t) || t === "string") return "String";
  if (/^-?\d/.test(t) || t === "number") return "Number";
  if (t === "boolean" || t === "true" || t === "false") return "Boolean";
  if (/\[\]$/.test(t)) return "Array";
  t = t.replace(/^typeof\s+/, "");
  t = boGeneric(t);
  return RE_DINH_DANH.test(t) ? t : null;
}

function hopLe(ten: string, laModule = false): boolean {
  return ten.length > 0 && ten.length <= TRAN_TEN_DAI && (laModule ? RE_MODULE.test(ten) : RE_DINH_DANH.test(ten));
}

/**
 * Đầu ra lệnh ⇒ các tên "không tìm thấy" theo thứ tự xuất hiện, khử trùng (theo ngôn ngữ + tên), tối đa `tran`.
 * Thuần — không tra gì.
 */
export function trichTenLoiBienDich(dauRa: string, tran = TRAN_TEN): TenLoi[] {
  const ra: TenLoi[] = [];
  const thay = new Set<string>();
  const them = (nn: NgonNguLoi, ma: string, ten: string, tv?: { kieu: string; thanhVien: string }, laModule = false): void => {
    if (ra.length >= tran) return;
    const ok = tv ? hopLe(tv.kieu) && hopLe(tv.thanhVien) : hopLe(ten, laModule);
    if (!ok) return;
    const k = `${nn}|${ten}`;
    if (thay.has(k)) return;
    thay.add(k);
    ra.push(tv ? { nn, ma, ten, kieu: tv.kieu, thanhVien: tv.thanhVien } : { nn, ma, ten });
  };
  const thanhVien = (nn: NgonNguLoi, ma: string, kieu: string | null, tv: string): void => {
    if (!kieu) return;
    them(nn, ma, `${kieu}.${tv}`, { kieu, thanhVien: tv });
  };

  const dong = String(dauRa ?? "").split(/\r?\n/);
  for (let i = 0; i < dong.length && ra.length < tran; i++) {
    const d = dong[i];
    let x: RegExpExecArray | null;

    // ── C# ──
    if ((x = /error (CS0246): The type or namespace name '([^']+)' could not be found/.exec(d))) {
      them("csharp", x[1], boGeneric(x[2]));
      continue;
    }
    if ((x = /error (CS0234): The type or namespace name '([^']+)' does not exist in the namespace '([^']+)'/.exec(d))) {
      them("csharp", x[1], `${x[3]}.${boGeneric(x[2])}`);
      continue;
    }
    if ((x = /error (CS0103): The name '([^']+)' does not exist in the current context/.exec(d))) {
      them("csharp", x[1], x[2]);
      continue;
    }
    if ((x = /error (CS1061|CS0117): '([^']+)' does not contain a definition for '([^']+)'/.exec(d))) {
      thanhVien("csharp", x[1], boGeneric(x[2]), x[3]);
      continue;
    }

    // ── TypeScript ──
    if ((x = /error (TS2304|TS2552): Cannot find name '([^']+)'/.exec(d))) {
      them("typescript", x[1], x[2]);
      continue;
    }
    if ((x = /error (TS2339|TS2551): Property '([^']+)' does not exist on type '(.*)'\.(?:\s|$)/.exec(d))) {
      thanhVien("typescript", x[1], kieuTs(x[3]), x[2]);
      continue;
    }
    if ((x = /error (TS2307): Cannot find module '([^']+)'/.exec(d))) {
      them("typescript", x[1], x[2].replace(/^node:/, ""), undefined, true);
      continue;
    }

    // ── Java (javac: "cannot find symbol" + các dòng symbol/location theo sau) ──
    if (/error: cannot find symbol/.test(d)) {
      let sym: RegExpExecArray | null = null;
      let loc: RegExpExecArray | null = null;
      for (let j = i + 1; j < Math.min(dong.length, i + 8); j++) {
        if (/error:/.test(dong[j])) break;
        sym ??= /^\s*symbol:\s+(class|interface|enum|record|variable|method)\s+([\w$]+)/.exec(dong[j]);
        loc ??= /^\s*location:\s+(?:(?:class|interface|enum|record)\s+([\w$.]+)|variable\s+[\w$]+\s+of\s+type\s+(\S+))/.exec(dong[j]);
      }
      if (sym) {
        if (sym[1] === "method") thanhVien("java", "cannot find symbol", loc ? boGeneric(loc[1] ?? loc[2] ?? "") || null : null, sym[2]);
        else them("java", "cannot find symbol", sym[2]);
      }
      continue;
    }

    // ── Python (traceback / tóm tắt pytest) ──
    if ((x = /\b(NameError): name '([^']+)' is not defined/.exec(d))) {
      them("python", x[1], x[2]);
      continue;
    }
    if ((x = /\b(AttributeError): module '([^']+)' has no attribute '([^']+)'/.exec(d))) {
      thanhVien("python", x[1], x[2], x[3]);
      continue;
    }
    if ((x = /\b(AttributeError): (?:type object '([^']+)'|'([^']+)' object) has no attribute '([^']+)'/.exec(d))) {
      thanhVien("python", x[1], x[2] ?? x[3], x[4]);
      continue;
    }
    if ((x = /\b(ModuleNotFoundError): No module named '([^']+)'/.exec(d))) {
      them("python", x[1], x[2], undefined, true);
      continue;
    }
    if ((x = /\b(ImportError): cannot import name '([^']+)' from '([^']+)'/.exec(d))) {
      thanhVien("python", x[1], x[3], x[2]);
      continue;
    }

    // ── Go ──
    if ((x = /\S+ undefined \(type (\*?[\w./]+) has no field or method (\w+)/.exec(d))) {
      thanhVien("go", "undefined", boGeneric(x[1]), x[2]);
      continue;
    }
    if ((x = /\bundefined: ([\w.]+)/.exec(d))) {
      them("go", "undefined", x[1]);
      continue;
    }

    // ── Rust ──
    if ((x = /error\[(E0425|E0433|E0412|E0422|E0423)\]: cannot find (?:type|value|function|struct|trait|macro|crate|module) `([^`]+)`/.exec(d))) {
      them("rust", x[1], x[2]);
      continue;
    }
    if ((x = /error\[(E0433|E0432)\]: (?:failed to resolve: use of (?:undeclared|unresolved) (?:type|crate|module)(?: or unlinked crate)?|unresolved import) `([^`]+)`/.exec(d))) {
      them("rust", x[1], x[2].replace(/::/g, "."));
      continue;
    }
    if ((x = /error\[(E0599)\]: no (?:method|associated item|function|variant or associated item) named `([^`]+)` found for (?:[\w ]+ )?`([^`]+)`/.exec(d))) {
      thanhVien("rust", x[1], boGeneric(x[3]) || null, x[2]);
      continue;
    }
  }
  return ra;
}

// ─── tra + định dạng ────────────────────────────────────────────────────────────────────────────

const LOAI_KIEU = new Set(["type", "class", "interface", "enum", "record", "annotation", "namespace", "module"]);
const ngan = (m: MucApi) => m.ten.split(".").pop() ?? m.ten;
const cat = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const motDong = (s: string) => s.replace(/\s+/g, " ").trim();

function khoangCach(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let truoc = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const nay = [i];
    for (let j = 1; j <= y.length; j++) nay[j] = Math.min(truoc[j] + 1, nay[j - 1] + 1, truoc[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    truoc = nay;
  }
  return truoc[y.length];
}

/** Ba dòng tối đa cho một mục khớp. */
function dongMuc(t: TenLoi, m: MucApi, nhan: string): string[] {
  const ra = [`- '${t.ten}' (${t.ma}) ${nhan} ${m.loai} ${tenDayDu(m)}`];
  const nhap = goiYNhap(m);
  if (nhap) ra.push(`  import: ${nhap}`);
  const ck = motDong(m.chuKy ?? "");
  if (ck && ck !== m.ten && ck !== ngan(m)) ra.push(`  signature: ${cat(ck, TRAN_CHU_KY)}`);
  return ra;
}

async function traMot(t: TenLoi, traApi: TraApi): Promise<string[] | null> {
  const ngonNgu = t.nn as NgonNguApi;
  if (t.thanhVien && t.kieu) {
    const tv = t.thanhVien.toLowerCase();
    // 1. đúng `Kieu.ThanhVien` (lỗi vì thiếu import/using của kiểu chứa nó)
    const kq = await traApi({ ten: t.ten, ngonNgu, tran: 3 });
    if (!kq) return null;
    const dung = kq.khop.find((m) => ngan(m).toLowerCase() === tv);
    if (dung) return dongMuc(t, dung, "→");
    // 2. C#: thành viên không có trên kiểu ⇒ có thể là PHƯƠNG THỨC MỞ RỘNG thiếu `using` (List<int>.Where ⇒ System.Linq)
    if (t.nn === "csharp" && t.ma === "CS1061") {
      const mr = await traApi({ ten: t.thanhVien, ngonNgu, tran: 12 });
      const ung = (mr?.khop ?? []).filter((x) => x.loai === "method" && x.cha && ngan(x) === t.thanhVien);
      // ưu tiên mở rộng trên IEnumerable<T> (LINQ chuẩn) hơn ImmutableArrayExtensions/ParallelEnumerable…
      const m = ung.find((x) => /^\w+(?:<[^>]*>)?\((?:this )?(?:System\.Collections\.Generic\.)?IEnumerable</.test(x.chuKy ?? "")) ?? ung[0];
      if (m) return dongMuc(t, m, "→ possibly extension");
    }
    // 3. kiểu có trong chỉ mục ⇒ thành viên GẦN NHẤT (hoặc vài thành viên đầu nếu không có tên nào gần)
    // kiểu có thể khai báo GỘP nhiều nơi (TS `interface String` ở es5 + es2015…) ⇒ gộp thành viên mọi mục kiểu cùng tên
    const kk = await traApi({ ten: t.kieu, ngonNgu, tran: 6 });
    const tenKieu = (t.kieu.split(".").pop() ?? "").toLowerCase();
    const cacKieu = (kk?.khop ?? []).filter((m) => LOAI_KIEU.has(m.loai) && m.thanhVien?.length && ngan(m).toLowerCase() === tenKieu);
    const kieu = cacKieu[0];
    if (!kieu) return null;
    const tatCaTv = cacKieu.flatMap((m) => m.thanhVien ?? []);
    const nguong = Math.max(2, Math.floor(t.thanhVien.length / 3));
    const daThay = new Set<string>();
    const gan = tatCaTv
      .map((x) => ({ x, d: khoangCach(x.ten, t.thanhVien!) }))
      .filter((y) => y.d <= nguong)
      .sort((a, b) => a.d - b.d)
      .filter((y) => (daThay.has(y.x.ten) ? false : (daThay.add(y.x.ten), true)))
      .slice(0, 3);
    const ra = [`- '${t.ten}' (${t.ma}): ${kieu.loai} ${tenDayDu(kieu)} has no member '${t.thanhVien}' in the index`];
    if (gan.length) ra.push(`  closest: ${cat(gan.map((y) => motDong(y.x.chuKy && y.x.chuKy !== y.x.ten ? y.x.chuKy : `${y.x.ten}`)).join(" | "), TRAN_CHU_KY)}`);
    else {
      const ten = [...new Set(tatCaTv.map((x) => x.ten))];
      ra.push(`  members include: ${cat(ten.slice(0, 8).join(", "), TRAN_CHU_KY)}${ten.length > 8 ? ", …" : ""}`);
    }
    // (không dòng import: trình biên dịch đã phân giải được KIỂU — thiếu là THÀNH VIÊN)
    return ra;
  }
  // tên trần ⇒ chỉ ký hiệu mức ngoài (kiểu/hàm/module), đúng tên ngắn
  const kq = await traApi({ ten: t.ten, ngonNgu, tran: 4 });
  if (!kq) return null;
  const cuoi = (t.ten.split(".").pop() ?? t.ten).toLowerCase();
  const m = kq.khop.find((x) => (!x.cha || LOAI_KIEU.has(x.loai)) && ngan(x).toLowerCase() === cuoi);
  return m ? dongMuc(t, m, "→") : null;
}

/**
 * Đầu ra lệnh lỗi ⇒ khối gợi ý (đã có tiêu đề + trần) hoặc `null` (không có tên nào / không có mục khớp / bộ tra hỏng).
 * KHÔNG ném.
 */
export async function goiYTraApiTuDauRa(
  dauRa: string,
  traApi: TraApi,
  tuyChon: { tranTen?: number; tranKyTu?: number } = {},
): Promise<{ vanBan: string; ten: string[] } | null> {
  const tranKyTu = Math.max(80, tuyChon.tranKyTu ?? TRAN_KY_TU);
  const ds = trichTenLoiBienDich(dauRa, tuyChon.tranTen ?? TRAN_TEN).filter((t) => (NGON_NGU_TRA_API as readonly string[]).includes(t.nn));
  if (ds.length === 0) return null;
  const muc: Array<{ ten: string; dong: string[] }> = [];
  for (const t of ds) {
    try {
      const d = await traMot(t, traApi);
      if (d?.length) muc.push({ ten: t.ten, dong: d });
    } catch {
      /* bộ tra hỏng ⇒ bỏ tên này; lệnh vẫn trả kết quả bình thường */
    }
  }
  if (muc.length === 0) return null;
  // trần: bỏ mục cuối đến khi vừa; một mục vẫn quá dài ⇒ cắt cứng
  let giu = muc.length;
  const dung = (n: number) => [DAU_KHOI, ...muc.slice(0, n).flatMap((x) => x.dong)].join("\n");
  while (giu > 1 && dung(giu).length > tranKyTu) giu--;
  let vanBan = dung(giu);
  if (vanBan.length > tranKyTu) vanBan = `${vanBan.slice(0, tranKyTu - 1)}…`;
  return { vanBan, ten: muc.slice(0, giu).map((x) => x.ten) };
}
