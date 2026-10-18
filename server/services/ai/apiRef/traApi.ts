/**
 * ★ 2026-10-18 — `lookup_api`: tra CHÍNH XÁC ký hiệu API trong chỉ mục cục bộ (khuyến nghị #1/#2 của
 * `docs/superpowers/audits/2026-10-18-ai-local-nguon-hoc-code.md`). KHÔNG cosine, KHÔNG model: khoá = tên ngắn chữ thường,
 * tìm NHỊ PHÂN trên `chi-muc.tsv` đã sắp xếp theo byte (đọc vài KB từ đĩa mỗi lượt, không nạp 70 MB vào bộ nhớ), rồi đọc
 * đúng các dòng `muc.jsonl` theo offset. Kiểu kèm khối thành viên (`tv`) ⇒ "SqlBulkCopyOptions ⇒ KeepIdentity…" là một lần đọc.
 *
 * Chỉ mục do `scripts/ai-kb/api-ref/dung-chi-muc-api.mjs` dựng (định dạng: `scripts/ai-kb/api-ref/phanTich.mjs`) vào
 * `knowledge/api-ref/ky-hieu/` (gitignore). Vắng ⇒ `null` — bộ thực thi nói thật "chưa dựng", không bịa.
 */
import fs from "node:fs";
import path from "node:path";

export const NGON_NGU_TRA_API = ["csharp", "typescript", "java", "python"] as const;
export type NgonNguApi = (typeof NGON_NGU_TRA_API)[number];

export interface ThanhVienApi {
  /** tên NGẮN trong kiểu (`KeepIdentity`; hàm dựng = tên kiểu) */
  ten: string;
  loai: string;
  chuKy: string;
  tomTat: string;
}

export interface MucApi {
  nn: NgonNguApi;
  loai: string;
  ns: string;
  ten: string;
  cha?: string;
  chuKy: string;
  tomTat: string;
  loiThoi?: boolean;
  tep?: string;
  nguon: number;
  /** nhãn nguồn + phiên bản (từ meta.json) */
  nguonNhan?: string;
  thanhVien?: ThanhVienApi[];
  soThanhVien?: number;
}

export interface KetQuaTraApi {
  khop: MucApi[];
  /** tổng số khớp TRƯỚC khi cắt trần */
  tongKhop: number;
  catBot: boolean;
}

export interface YeuCauTraApi {
  ten: string;
  ngonNgu?: NgonNguApi;
  /** số khớp tối đa (mặc định 6, trần 20) */
  tran?: number;
}

/** Cổng tiêm của bộ thực thi: `null` = chỉ mục chưa dựng trên máy chủ này. */
export type TraApi = (y: YeuCauTraApi) => Promise<KetQuaTraApi | null>;

export interface ChiMucApiMo {
  tra(y: YeuCauTraApi): KetQuaTraApi;
  meta: { soMuc?: number; nguon?: Array<{ nhan: string; nn: string; soMuc: number }> };
}

const TRAN_MAC_DINH = 6;
const TRAN_TOI_DA = 20;
/** Số kiểu (trong các khớp đầu) được mở khối thành viên; số thành viên tối đa liệt kê mỗi kiểu. */
const SO_KIEU_MO_THANH_VIEN = 3;
const TRAN_THANH_VIEN = 60;
/** Trần số posting đọc cho một khoá (tên rất phổ biến như `ToString` có hàng nghìn) — đủ để lọc đuôi/ngôn ngữ. */
const TRAN_POSTING_DOC = 4000;

/**
 * Tên người/model gõ ⇒ { khoa (tên ngắn chữ thường), duoi (đuôi chuẩn hoá để lọc chủ) }. Bỏ `()`, đối số generic `<…>`,
 * arity `` `1 ``; tách theo `. : # / ›` và khoảng trắng. `null` khi rỗng.
 */
export function chuanHoaTenTra(ten: string): { khoa: string; duoi: string } | null {
  const s = String(ten ?? "")
    .trim()
    .replace(/\(.*$/s, "")
    .replace(/<[^<>]*>/g, "")
    .replace(/<[^<>]*>/g, "")
    .replace(/`+\d+/g, "")
    .replace(/\s*(?:::|[:#/›\\])\s*/g, ".")
    .replace(/\s+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .toLowerCase();
  if (!s) return null;
  const khoa = s.split(".").pop() ?? "";
  if (!khoa) return null;
  return { khoa, duoi: s };
}

/** Đọc một dòng (đến `\n`) bắt đầu từ `viTri`. */
function docDong(fd: number, viTri: number, kichThuoc: number): { dong: string; ketThuc: number } {
  const manh: Buffer[] = [];
  let p = viTri;
  let co = 256;
  while (p < kichThuoc) {
    const b = Buffer.alloc(Math.min(co, kichThuoc - p));
    const n = fs.readSync(fd, b, 0, b.length, p);
    if (n <= 0) break;
    const i = b.subarray(0, n).indexOf(10);
    if (i >= 0) {
      manh.push(b.subarray(0, i));
      return { dong: Buffer.concat(manh).toString("utf8"), ketThuc: p + i + 1 };
    }
    manh.push(b.subarray(0, n));
    p += n;
    co = Math.min(co * 4, 1 << 20);
  }
  return { dong: Buffer.concat(manh).toString("utf8"), ketThuc: kichThuoc };
}

/** Tìm nhị phân dòng có khoá đúng `khoa` trong tệp sắp xếp theo byte (`khoa\t…`). Trả phần sau tab, hoặc null. */
export function timKhoaNhiPhan(tep: string, khoa: string): string | null {
  const fd = fs.openSync(tep, "r");
  try {
    const kichThuoc = fs.fstatSync(fd).size;
    const kb = Buffer.from(khoa, "utf8");
    const khoaCua = (d: string) => {
      const t = d.indexOf("\t");
      return t < 0 ? d : d.slice(0, t);
    };
    // bất biến: `lo` là đầu một dòng; mọi dòng bắt đầu TRƯỚC `lo` có khoá < khoa; mọi dòng bắt đầu ở >= `hi` có khoá >= khoa.
    // Kết thúc ⇒ dòng bắt đầu ở `lo` là dòng ĐẦU TIÊN có khoá >= khoa.
    let lo = 0;
    let hi = kichThuoc;
    while (lo < hi) {
      const giua = Math.floor((lo + hi) / 2);
      // đầu dòng đầu tiên ở vị trí >= giua
      const dau = giua === 0 ? 0 : docDong(fd, giua - 1, kichThuoc).ketThuc;
      if (dau >= hi) {
        hi = giua;
        continue;
      }
      const { dong, ketThuc } = docDong(fd, dau, kichThuoc);
      if (Buffer.compare(Buffer.from(khoaCua(dong), "utf8"), kb) < 0) lo = ketThuc;
      else hi = giua;
    }
    let p = lo;
    for (let lan = 0; p < kichThuoc && lan < 2; lan++) {
      const { dong, ketThuc } = docDong(fd, p, kichThuoc);
      const k = khoaCua(dong);
      if (k === khoa) return dong.slice(dong.indexOf("\t") + 1);
      if (Buffer.compare(Buffer.from(k, "utf8"), kb) > 0) return null;
      p = ketThuc;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function docKhoang(fd: number, off: number, len: number): string {
  const b = Buffer.alloc(len);
  fs.readSync(fd, b, 0, len, off);
  return b.toString("utf8");
}

const LOAI_KIEU = new Set(["type", "class", "interface", "enum", "record", "annotation", "namespace", "module"]);

/** Mở chỉ mục trong `thuMuc` (cần `muc.jsonl` + `chi-muc.tsv`); thiếu ⇒ null. Không giữ fd — mỗi lượt tra mở/đóng. */
export function moChiMucApi(thuMuc: string): ChiMucApiMo | null {
  const tepMuc = path.join(thuMuc, "muc.jsonl");
  const tepKhoa = path.join(thuMuc, "chi-muc.tsv");
  if (!fs.existsSync(tepMuc) || !fs.existsSync(tepKhoa)) return null;
  let meta: ChiMucApiMo["meta"] = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(thuMuc, "meta.json"), "utf8"));
  } catch {
    /* meta tuỳ chọn */
  }
  const nhanNguon = (i: number) => meta.nguon?.[i]?.nhan;

  function tra(y: YeuCauTraApi): KetQuaTraApi {
    const tran = Math.max(1, Math.min(TRAN_TOI_DA, Math.floor(Number(y.tran) || TRAN_MAC_DINH)));
    const cn = chuanHoaTenTra(y.ten);
    if (!cn) return { khop: [], tongKhop: 0, catBot: false };
    const posting = timKhoaNhiPhan(tepKhoa, cn.khoa);
    if (!posting) return { khop: [], tongKhop: 0, catBot: false };
    const tenNganGoc = String(y.ten).trim().replace(/\(.*$/s, "").replace(/<[^<>]*>/g, "").replace(/`+\d+/g, "").split(/[.:#/›\\\s]+/).filter(Boolean).pop() ?? "";
    const fd = fs.openSync(tepMuc, "r");
    try {
      const ds: Array<MucApi & { _diem: number }> = [];
      for (const p of posting.split(",").slice(0, TRAN_POSTING_DOC)) {
        const [o, l] = p.split(".").map((x) => parseInt(x, 36));
        if (!Number.isFinite(o) || !Number.isFinite(l)) continue;
        let m: MucApi & { tv?: [number, number, number] };
        try {
          m = JSON.parse(docKhoang(fd, o, l));
        } catch {
          continue;
        }
        if (y.ngonNgu && m.nn !== y.ngonNgu) continue;
        const day = `${m.ns ? `${m.ns}.` : ""}${m.ten}`.toLowerCase().replace(/[/:#›\\]/g, ".");
        if (cn.duoi !== cn.khoa && !(day === cn.duoi || day.endsWith(`.${cn.duoi}`))) continue;
        const ngan = m.ten.split(".").pop() ?? "";
        const diem = (ngan === tenNganGoc ? 4 : 0) + (LOAI_KIEU.has(m.loai) ? 2 : 0) + (m.loiThoi ? -1 : 0);
        ds.push({ ...m, _diem: diem });
      }
      // ổn định: điểm giảm dần, giữ thứ tự tệp (nguồn khai trước — .NET → NuGet → TS → Java → Python)
      const sap = ds.map((m, i) => ({ m, i })).sort((a, b) => b.m._diem - a.m._diem || a.i - b.i).map((x) => x.m);
      // chồng lấp: cùng nn+ns+ten+chuKy (vd hai TFM) ⇒ một
      const thay = new Set<string>();
      const duyNhat = sap.filter((m) => {
        const k = `${m.nn}|${m.ns}|${m.ten}|${m.chuKy}`;
        if (thay.has(k)) return false;
        thay.add(k);
        return true;
      });
      const khop: MucApi[] = [];
      let soMo = 0;
      for (const m of duyNhat.slice(0, tran)) {
        const { _diem: _d, tv, ...con } = m as MucApi & { _diem: number; tv?: [number, number, number] };
        const ra: MucApi = { ...con, ...(nhanNguon(m.nguon) ? { nguonNhan: nhanNguon(m.nguon) } : {}) };
        if (tv && LOAI_KIEU.has(m.loai) && soMo < SO_KIEU_MO_THANH_VIEN) {
          soMo++;
          const [to, tl, tn] = tv;
          const dong = docKhoang(fd, to, tl).split("\n").filter(Boolean);
          ra.soThanhVien = tn;
          ra.thanhVien = dong.slice(0, TRAN_THANH_VIEN).flatMap((d) => {
            try {
              const x = JSON.parse(d) as MucApi;
              return [{ ten: x.loai === "ctor" ? (x.ten.split(".").pop() ?? x.ten) : x.ten.slice((x.cha ?? "").length + 1) || x.ten, loai: x.loai, chuKy: x.chuKy, tomTat: x.tomTat }];
            } catch {
              return [];
            }
          });
        }
        khop.push(ra);
      }
      return { khop, tongKhop: duyNhat.length, catBot: duyNhat.length > khop.length };
    } finally {
      fs.closeSync(fd);
    }
  }
  return { tra, meta };
}

// ─── văn bản cho model ──────────────────────────────────────────────────────────────────────────

const TRAN_KY_TU_MAC_DINH = 9_000;

function tenDayDu(m: MucApi): string {
  if (!m.ns) return m.ten;
  return m.nn === "typescript" ? `"${m.ns}" › ${m.ten}` : `${m.ns}.${m.ten}`;
}

/** Gợi ý NHẬP theo ngôn ngữ (đúng thứ lỗi CS0246/TS2304/cannot find symbol/NameError cần). */
function goiYNhap(m: MucApi): string {
  const kieuNgoai = m.cha ? m.cha.split(".")[0] : m.ten.split(".")[0];
  switch (m.nn) {
    case "csharp":
      return m.ns ? `using ${m.ns};` : "";
    case "java":
      return m.ns && m.ns !== "java.lang" ? `import ${m.ns}.${kieuNgoai};` : "";
    case "python":
      return m.loai === "module" ? `import ${m.ns}` : m.ns ? `from ${m.ns} import ${kieuNgoai}` : "";
    case "typescript":
      return m.ns ? `import { ${kieuNgoai} } from "${m.ns}";` : "(global — no import needed)";
    default:
      return "";
  }
}

/** Kết quả tra ⇒ văn bản (tiếng Anh, cho model) có trần ký tự. */
export function dinhDangKetQuaApi(ten: string, kq: KetQuaTraApi, tranKyTu = TRAN_KY_TU_MAC_DINH): string {
  if (kq.khop.length === 0) {
    return (
      `No API symbol named "${ten}" in the local API index (exact-name lookup). ` +
      "Check the spelling or try the type name / a shorter suffix; do not guess a namespace, member or signature — " +
      "if it still is not found, tell the user it may not exist in the installed library version."
    );
  }
  const dong: string[] = [`${kq.tongKhop} match(es) for "${ten}"${kq.catBot ? ` (showing ${kq.khop.length})` : ""}:`];
  kq.khop.forEach((m, i) => {
    dong.push("");
    dong.push(`[${i + 1}] ${m.nn} ${m.loai}${m.loiThoi ? " (DEPRECATED)" : ""}: ${tenDayDu(m)}`);
    if (m.chuKy && m.chuKy !== m.ten) dong.push(`    signature: ${m.chuKy}`);
    if (m.cha) dong.push(`    declared in: ${m.ns ? `${m.ns}.` : ""}${m.cha}`);
    const nhap = goiYNhap(m);
    if (nhap) dong.push(`    import: ${nhap}`);
    if (m.tomTat) dong.push(`    summary: ${m.tomTat}`);
    dong.push(`    source: ${m.nguonNhan ?? `#${m.nguon}`}${m.tep ? ` — ${m.tep}` : ""}`);
    if (m.thanhVien?.length) {
      dong.push(`    members (${m.soThanhVien ?? m.thanhVien.length}${(m.soThanhVien ?? 0) > m.thanhVien.length ? `, first ${m.thanhVien.length}` : ""}):`);
      for (const t of m.thanhVien) dong.push(`      - ${t.loai} ${t.chuKy && t.chuKy !== t.ten ? t.chuKy : t.ten}${t.tomTat ? ` — ${t.tomTat.slice(0, 120)}` : ""}`);
    }
  });
  let van = dong.join("\n");
  if (van.length > tranKyTu) van = `${van.slice(0, tranKyTu)}\n…[truncated — narrow with a qualified name like Type.Member or a language filter]`;
  return van;
}

// ─── mặc định (máy chủ) ─────────────────────────────────────────────────────────────────────────

/** Thư mục chỉ mục mặc định — `AI_API_REF_DIR` đổi được (đo/A-B). */
export function thuMucChiMucApi(): string {
  return process.env.AI_API_REF_DIR?.trim() || path.join(process.cwd(), "knowledge", "api-ref", "ky-hieu");
}

let _moLuc: { thuMuc: string; mtime: number; cm: ChiMucApiMo | null } | null = null;

/** Mở lười + mở lại khi `meta.json` đổi (bộ dựng đổi chỗ thư mục ⇒ không cần khởi động lại máy chủ). */
function layChiMucMacDinh(): ChiMucApiMo | null {
  const thuMuc = thuMucChiMucApi();
  let mtime = 0;
  try {
    mtime = fs.statSync(path.join(thuMuc, "chi-muc.tsv")).mtimeMs;
  } catch {
    _moLuc = null;
    return null;
  }
  if (!_moLuc || _moLuc.thuMuc !== thuMuc || _moLuc.mtime !== mtime) _moLuc = { thuMuc, mtime, cm: moChiMucApi(thuMuc) };
  return _moLuc.cm;
}

export const traApiMacDinh: TraApi = async (y) => {
  const cm = layChiMucMacDinh();
  return cm ? cm.tra(y) : null;
};
