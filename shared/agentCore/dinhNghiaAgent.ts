/**
 * Đợt 11.8 · T1 — ĐỊNH NGHĨA AGENT ĐẶT TÊN (`.thoca/agents/<tên>.md`). THUẦN: chỉ phân tích chuỗi, không đọc đĩa.
 *
 * ⚠ Tệp nằm trong repo của người dùng ⇒ KHÔNG TIN CẬY. Thân tệp sẽ là lời nhắc hệ thống của agent con = CHỈ THỊ
 *   (không phải dữ liệu) ⇒ bộ phân tích này chỉ có thể THU HẸP quyền, không bao giờ nới:
 *   • `approval` chỉ `hoi`|`sua` (không `tu-dong`); thiếu ⇒ `hoi`;
 *   • `tools` là tập con của `TEN_CONG_CU`, không `remember`/`delegate`;
 *   • `model` chỉ `auto` | `vai-tro:` | `ho-so:` (model ngoài `ngoai:` bị cấm ngay ở đây — M1);
 *   • tên tệp = `name`, `^[a-z][a-z0-9-]{0,31}$` (không `..`, không phân cấp thư mục, không hoa-thường lạ — M2d).
 * YAML tự viết, GIỚI HẠN (M3): `khoá: giá trị` + danh sách phẳng; KHÔNG alias/anchor/thẻ/khối/lồng/khoá lạ/khoá lặp.
 * Băm SHA-256 nội dung (đã chuẩn hoá BOM/EOL) là khoá "tin-lần-đầu" (M2a) — host PHẢI tính lại lúc dùng, không đệm.
 *
 * Thiết kế: docs/superpowers/plans/2026-10-27-dot11-8-phien-agent-agent-con.md §1 D4, §7.
 */
import { TEN_CONG_CU, type TenCongCu } from "./congCu";

export const TRAN_BYTE_TEP_DINH_NGHIA = 8 * 1024;
export const TRAN_KY_TU_THAN = 6_000;
export const TRAN_MO_TA = 200;
export const TRAN_SO_TEP_DINH_NGHIA = 16;
export const TRAN_DONG_FRONT_MATTER = 40;
export const TRAN_LUOT_DINH_NGHIA = 12;

/** Công cụ KHÔNG BAO GIỜ giao cho agent con qua định nghĩa (con không đề xuất nhớ, không giao tiếp). */
const CONG_CU_CAM_CHO_CON: ReadonlySet<string> = new Set(["remember", "delegate"]);

const RE_TEN_TEP = /^([a-z][a-z0-9-]{0,31})\.md$/;
const RE_TEN = /^[a-z][a-z0-9-]{0,31}$/;
const RE_MODEL_CUC_BO = /^(auto|vai-tro:[a-z0-9][a-z0-9._-]{0,63}|ho-so:[a-z0-9][a-z0-9._-]{0,63})$/;
const KHOA_HOP_LE: ReadonlySet<string> = new Set(["name", "description", "tools", "model", "approval", "max_turns"]);

export type NguonDinhNghia = "dungSan" | "tuRepo";

export interface DinhNghiaAgent {
  ten: string;
  moTa: string;
  congCu: TenCongCu[];
  /** `auto` | `vai-tro:<id>` | `ho-so:<id>` — KHÔNG BAO GIỜ `ngoai:`. */
  model: string;
  /** Trần chế độ của con (con thực tế = min(cha, cheDo)). Không có `tu-dong`. */
  cheDo: "hoi" | "sua";
  maxLuot?: number;
  than: string;
  /** SHA-256 hex của nội dung tệp (chuẩn hoá); với dựng sẵn: của (tên + thân). */
  bam: string;
  nguon: NguonDinhNghia;
}

export type MaLoiDinhNghia =
  | "TEN_SAI"
  | "KY_TU_AN_CAM"
  | "TEP_QUA_LON"
  | "THIEU_RAO"
  | "FRONT_MATTER_DAI"
  | "YAML_CAM"
  | "KHOA_LA"
  | "KHOA_LAP"
  | "THIEU_TRUONG"
  | "MO_TA_DAI"
  | "CONG_CU_LA"
  | "CONG_CU_RONG"
  | "MODEL_NGOAI_CAM"
  | "MODEL_SAI"
  | "APPROVAL_CAM"
  | "MAX_LUOT_SAI"
  | "THAN_RONG"
  | "THAN_DAI";

export type KetQuaPhanTich = { ok: true; dn: DinhNghiaAgent } | { ok: false; ma: MaLoiDinhNghia; thongDiep: string };

const loi = (ma: MaLoiDinhNghia, thongDiep: string): KetQuaPhanTich => ({ ok: false, ma, thongDiep });

// ─── UTF-8 + SHA-256 thuần ─────────────────────────────────────────────────────────────────────

function utf8(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Hex(bytes: number[]): string {
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const b = bytes.slice();
  const bitLen = bytes.length * 8;
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < b.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((b[off + 4 * i] << 24) | (b[off + 4 * i + 1] << 16) | (b[off + 4 * i + 2] << 8) | b[off + 4 * i + 3]) | 0;
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + bb) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

function chuanHoa(s: string): string {
  return s.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/** SHA-256 (hex) của nội dung đã bỏ BOM và đổi EOL về LF — băm KHÔNG đổi theo CRLF/LF. */
export function bamNoiDung(noiDung: string): string {
  return sha256Hex(utf8(chuanHoa(noiDung)));
}

// ─── phân tích ─────────────────────────────────────────────────────────────────────────────────

/** Ký tự đầu của giá trị mà YAML đầy đủ hiểu đặc biệt (anchor, alias, thẻ, khối, luồng, chỉ thị) — CẤM. */
const DAU_YAML_CAM = /^[&*!|>{%@`]/;

function boNgoac(v: string): string {
  const m = /^(["'])(.*)\1$/.exec(v);
  return m ? m[2] : v;
}

/**
 * Ký tự ẨN/điều khiển (Trojan Source): người duyệt đọc nội dung hiển thị rồi xác nhận băm, nên không được có ký tự làm
 * nội dung hiển thị KHÁC nội dung băm. TỪ CHỐI (không "làm sạch rồi nhận"). Khoảng [thấp, cao] theo mã điểm:
 * C0 trừ tab/LF/CR, DEL+C1, soft hyphen, ALM (bidi), Hangul filler, Mongolian separator, ZWSP..RLM, dấu tách dòng/đoạn,
 * bidi embedding/override, word joiner..bidi isolate, Hangul filler 3164, bộ chọn biến thể, BOM, thẻ.
 */
const KHOANG_KY_TU_AN: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x115f, 0x1160],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
];

/** Có ký tự ẩn không. BOM ĐẦU tệp được phép (`chuanHoa` bỏ nó, băm không tính nó). */
export function coKyTuAn(s: string): boolean {
  const thau = s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  for (const ch of thau) {
    const cp = ch.codePointAt(0)!;
    for (const [lo, hi] of KHOANG_KY_TU_AN) if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

export function phanTichDinhNghia(tenTep: string, noiDung: string): KetQuaPhanTich {
  if (coKyTuAn(tenTep)) return loi("KY_TU_AN_CAM", "tên tệp chứa ký tự ẩn/điều khiển");
  const mt = RE_TEN_TEP.exec(tenTep);
  if (!mt) return loi("TEN_SAI", "tên tệp phải là <tên>.md với tên theo ^[a-z][a-z0-9-]{0,31}$");
  if (utf8(noiDung).length > TRAN_BYTE_TEP_DINH_NGHIA) return loi("TEP_QUA_LON", `tệp vượt ${TRAN_BYTE_TEP_DINH_NGHIA} byte`);

  if (coKyTuAn(noiDung)) return loi("KY_TU_AN_CAM", "nội dung chứa ký tự ẩn/điều khiển (bidi, zero-width, thẻ…): không được chấp nhận");

  const s = chuanHoa(noiDung);
  if (!s.startsWith("---\n")) return loi("THIEU_RAO", "tệp phải mở đầu bằng dòng ---");
  const dong = s.slice(4).split("\n");
  const dongDong = dong.indexOf("---");
  if (dongDong < 0) return loi("THIEU_RAO", "thiếu dòng --- đóng front-matter");
  const fm = dong.slice(0, dongDong);
  if (fm.length > TRAN_DONG_FRONT_MATTER) return loi("FRONT_MATTER_DAI", `front-matter vượt ${TRAN_DONG_FRONT_MATTER} dòng`);
  const than = dong.slice(dongDong + 1).join("\n").trim();

  const gt = new Map<string, string>();
  const ds: string[] = [];
  let khoaDangLiet: string | null = null;
  for (const d of fm) {
    if (d.trim() === "" || d.trimStart().startsWith("#")) continue;
    if (/^\s/.test(d)) {
      const m = /^\s+-\s+(\S.*)$/.exec(d);
      if (!khoaDangLiet || khoaDangLiet !== "tools" || !m) return loi("YAML_CAM", "dòng thụt lề/lồng không được hỗ trợ");
      ds.push(boNgoac(m[1].trim()));
      continue;
    }
    khoaDangLiet = null;
    const m = /^([^\s:][^:]*?):(?:[ \t]+(.*))?$/.exec(d);
    if (!m) return loi("YAML_CAM", "dòng không có dạng khoá: giá trị");
    const khoa = m[1].trim();
    if (!KHOA_HOP_LE.has(khoa)) return loi("KHOA_LA", `khoá không được hỗ trợ: ${khoa.slice(0, 40)}`);
    if (gt.has(khoa)) return loi("KHOA_LAP", `khoá lặp: ${khoa}`);
    const v = (m[2] ?? "").trim();
    if (v === "") {
      if (khoa !== "tools") return loi("YAML_CAM", `khoá ${khoa} cần giá trị một dòng`);
      khoaDangLiet = "tools";
      gt.set(khoa, "");
      continue;
    }
    if (DAU_YAML_CAM.test(v)) return loi("YAML_CAM", `giá trị của ${khoa} dùng cú pháp YAML bị cấm (anchor/alias/thẻ/khối)`);
    if (v.startsWith("[")) {
      if (khoa !== "tools" || !v.endsWith("]")) return loi("YAML_CAM", `danh sách chỉ dùng cho tools: [a, b]`);
      for (const p of v.slice(1, -1).split(",")) if (p.trim() !== "") ds.push(boNgoac(p.trim()));
      gt.set(khoa, "[]");
      continue;
    }
    gt.set(khoa, boNgoac(v));
  }

  const ten = gt.get("name");
  const moTa = gt.get("description");
  if (ten === undefined || moTa === undefined || !gt.has("tools")) return loi("THIEU_TRUONG", "thiếu name / description / tools");
  if (!RE_TEN.test(ten) || ten !== mt[1]) return loi("TEN_SAI", "name phải khớp tên tệp và ^[a-z][a-z0-9-]{0,31}$");
  if (moTa.length > TRAN_MO_TA) return loi("MO_TA_DAI", `description vượt ${TRAN_MO_TA} ký tự`);

  if (ds.length === 0) return loi("CONG_CU_RONG", "tools rỗng");
  const hop = new Set<string>(TEN_CONG_CU);
  const thay = new Set<string>();
  for (const c of ds) {
    if (!hop.has(c) || CONG_CU_CAM_CHO_CON.has(c) || thay.has(c)) return loi("CONG_CU_LA", `công cụ không hợp lệ/cấm/lặp: ${c.slice(0, 40)}`);
    thay.add(c);
  }

  const model = gt.get("model") ?? "auto";
  if (model.toLowerCase().startsWith("ngoai:")) return loi("MODEL_NGOAI_CAM", "agent con không được dùng model ngoài");
  if (!RE_MODEL_CUC_BO.test(model)) return loi("MODEL_SAI", "model chỉ nhận auto | vai-tro:<id> | ho-so:<id>");

  const approval = gt.get("approval") ?? "hoi";
  if (approval !== "hoi" && approval !== "sua") return loi("APPROVAL_CAM", "approval chỉ nhận hoi | sua");

  let maxLuot: number | undefined;
  if (gt.has("max_turns")) {
    const v = gt.get("max_turns")!;
    const n = /^\d{1,3}$/.test(v) ? Number(v) : NaN;
    if (!(n >= 1 && n <= TRAN_LUOT_DINH_NGHIA)) return loi("MAX_LUOT_SAI", `max_turns phải từ 1 đến ${TRAN_LUOT_DINH_NGHIA}`);
    maxLuot = n;
  }

  if (than === "") return loi("THAN_RONG", "thân tệp (lời dặn) rỗng");
  if (than.length > TRAN_KY_TU_THAN) return loi("THAN_DAI", `thân tệp vượt ${TRAN_KY_TU_THAN} ký tự`);

  return {
    ok: true,
    dn: {
      ten,
      moTa,
      congCu: ds as TenCongCu[],
      model,
      cheDo: approval,
      ...(maxLuot !== undefined ? { maxLuot } : {}),
      than,
      bam: bamNoiDung(noiDung),
      nguon: "tuRepo",
    },
  };
}

// ─── dựng sẵn ──────────────────────────────────────────────────────────────────────────────────

const DOC: TenCongCu[] = ["read_file", "list_dir", "find_files", "grep", "find_symbol", "search_code", "search_docs", "lookup_api"];

function dungSan(d: Omit<DinhNghiaAgent, "bam" | "nguon">): DinhNghiaAgent {
  return { ...d, bam: bamNoiDung(`${d.ten}\n${d.than}`), nguon: "dungSan" };
}

export const DINH_NGHIA_DUNG_SAN: readonly DinhNghiaAgent[] = [
  dungSan({
    ten: "kham-pha",
    moTa: "Read-only codebase explorer: finds where things live and reports concise findings.",
    congCu: DOC,
    model: "auto",
    cheDo: "hoi",
    than: "You are a read-only code explorer. Locate the relevant files, symbols and call paths for the task, quote exact paths and line numbers, and report a short summary. Never modify anything.",
  }),
  dungSan({
    ten: "viet-test",
    moTa: "Writes or extends tests for a given unit and runs them.",
    congCu: [...DOC, "edit_file", "write_file", "run_command"],
    model: "auto",
    cheDo: "sua",
    than: "You write focused tests for the named unit following the repository's existing test style. Run the test command, fix failing tests you wrote, and report which tests were added and their result.",
  }),
  dungSan({
    ten: "review",
    moTa: "Read-only reviewer: inspects code for bugs and risks and proposes fixes in text.",
    congCu: DOC,
    model: "auto",
    cheDo: "hoi",
    than: "You review the named code for correctness bugs, unsafe input handling and missing tests. Report findings ranked by severity with exact locations and a suggested fix in prose. Never modify anything.",
  }),
  dungSan({
    ten: "plc",
    moTa: "PLC/Structured Text helper: checks IEC 61131-3 code against references and compiles it.",
    congCu: ["read_file", "list_dir", "find_files", "grep", "search_docs", "lookup_api", "compile_st"],
    model: "auto",
    cheDo: "hoi",
    than: "You assist with IEC 61131-3 Structured Text. Look up vendor documentation before assuming an API, compile candidate code with compile_st, and report compiler diagnostics and the corrected snippet. Never modify files.",
  }),
];

// ─── lọc tập tệp lấy từ repo ───────────────────────────────────────────────────────────────────

export interface TepDinhNghiaTho {
  ten: string;
  noiDung: string;
}

export interface CanhBaoDinhNghia {
  ten: string;
  ma: MaLoiDinhNghia | "TRUNG_DUNG_SAN" | "QUA_SO_TEP";
  thongDiep: string;
}

/** Tệp hỏng / trùng tên dựng sẵn / quá số lượng bị BỎ kèm cảnh báo; tệp repo không bao giờ ghi đè agent dựng sẵn (M2c). */
export function locDinhNghiaTuRepo(tep: readonly TepDinhNghiaTho[]): { nhan: DinhNghiaAgent[]; canhBao: CanhBaoDinhNghia[] } {
  const nhan: DinhNghiaAgent[] = [];
  const canhBao: CanhBaoDinhNghia[] = [];
  const tenDungSan = new Set(DINH_NGHIA_DUNG_SAN.map((d) => d.ten));
  tep.forEach((t, i) => {
    if (i >= TRAN_SO_TEP_DINH_NGHIA) {
      if (i === TRAN_SO_TEP_DINH_NGHIA) {
        canhBao.push({ ten: t.ten, ma: "QUA_SO_TEP", thongDiep: `chỉ nhận tối đa ${TRAN_SO_TEP_DINH_NGHIA} tệp định nghĩa` });
      }
      return;
    }
    const r = phanTichDinhNghia(t.ten, t.noiDung);
    if (!r.ok) {
      canhBao.push({ ten: t.ten, ma: r.ma, thongDiep: r.thongDiep });
      return;
    }
    if (tenDungSan.has(r.dn.ten)) {
      canhBao.push({ ten: t.ten, ma: "TRUNG_DUNG_SAN", thongDiep: `trùng tên agent dựng sẵn: ${r.dn.ten}` });
      return;
    }
    nhan.push(r.dn);
  });
  return { nhan, canhBao };
}
