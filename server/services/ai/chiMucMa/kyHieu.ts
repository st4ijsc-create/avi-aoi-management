/**
 * ★★★ Đợt 2 — CHỈ MỤC KÝ HIỆU theo dự án (tool `find_symbol` của agentCore gọi qua `index.ts`).
 *
 * Khảo sát tầng 5: agent không có symbol/LSP — muốn biết "X định nghĩa ở đâu" nó phải `grep_repo` rồi đọc từng tệp,
 * tốn 3–6 lượt tool cho một câu hỏi mà một bảng định nghĩa trả lời trong một lượt. Tệp này là bảng ấy.
 *
 * ── QUYẾT ĐỊNH ────────────────────────────────────────────────────────────────────────────────────────────────────
 *   • MẪU THEO DÒNG, không parser/LSP/tree-sitter: không thêm gói mới, chạy cho 8 họ ngôn ngữ trên dự án bất kỳ.
 *     Cái giá nói thẳng: một định nghĩa viết lạ (chữ ký trải nhiều dòng trước tên, macro sinh hàm) có thể lọt; ngược
 *     lại một lời gọi trông như định nghĩa có thể bị bắt. Hai van giảm nhiễu: (1) phương thức chỉ được nhận ở ĐÚNG
 *     mức thụt lề thân lớp (lời gọi trong thân hàm thụt sâu hơn), (2) bảng từ khoá điều khiển bị loại.
 *   • THAM CHIẾU = tìm theo RANH GIỚI TỪ (`[\w$]` hai bên), không phân tích ngữ nghĩa: một chuỗi/chú thích nhắc tên
 *     cũng là tham chiếu (đúng thứ kỹ sư cần khi đổi tên). Dòng định nghĩa bị bỏ khỏi tham chiếu.
 *   • BỘ ĐỆM theo (gốc, tệp, mtime, kích thước) — chỉ giữ KÝ HIỆU, không giữ nội dung (mã của repo này ~75 MB).
 *   • THUẦN ĐỌC, chỉ qua `hopCatChiMuc.ts` (hộp cát + che bí mật). Mọi trần (tệp, byte/tệp, thời gian, số tham chiếu)
 *     khi chạm đều khai `catBot: true` — một danh sách bị cắt mà không khai là một lời nói dối.
 */
import path from "node:path";
import fs from "node:fs";
import { napBoQuaGit } from "./boQuaGit";
import { dauVetTep, docTepChiMuc, duyetTepMa, ngonNguCuaTep, TRAN_BYTE_TEP_MAC_DINH, type NgonNgu } from "./hopCatChiMuc";

export type LoaiKyHieu = "function" | "method" | "class" | "interface" | "type" | "enum" | "const";

export interface KyHieu {
  ten: string;
  kind: LoaiKyHieu;
  /** 1-based. */
  dong: number;
  /** Dòng định nghĩa, gọn một dòng (bỏ `{` cuối, gộp khoảng trắng, trần 200 ký tự). */
  chuKy: string;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TRÍCH (thuần)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const ID = "[A-Za-z_$][\\w$]*";
const TRAN_CHU_KY = 200;

/** Từ khoá điều khiển/biểu thức — một dòng bắt đầu bằng chúng + `(` KHÔNG BAO GIỜ là định nghĩa. */
const TU_KHOA = new Set([
  "if", "for", "foreach", "while", "switch", "catch", "return", "function", "new", "else", "do", "with", "typeof",
  "await", "super", "this", "throw", "delete", "void", "yield", "import", "export", "case", "try", "finally", "sizeof",
  "using", "lock", "fixed", "match", "when", "goto", "defer", "go", "select", "elif", "assert", "print", "base",
  "nameof", "default", "static_assert", "decltype", "alignof", "loop", "in", "is", "as", "not", "and", "or",
]);

function chuKyGon(dong: string): string {
  let s = dong.trim().replace(/\s+/g, " ");
  s = s.replace(/\s*\{\s*$/, "").replace(/\s*=>\s*\{?\s*$/, (m) => (m.includes("=>") ? " =>" : ""));
  if (s.length > TRAN_CHU_KY) s = s.slice(0, TRAN_CHU_KY - 1) + "…";
  return s;
}

/**
 * Bản sao ĐỘC LẬP của một chuỗi con. ⚠ ĐO ĐƯỢC: V8 giữ chuỗi con (`slice`/kết quả regex) dưới dạng "sliced string"
 * trỏ vào chuỗi CHA — bộ đệm ký hiệu vì thế giữ sống NGUYÊN nội dung mọi tệp (110 MB heap cho 36.830 ký hiệu của
 * repo này). Sao qua Buffer cắt liên kết ấy.
 */
function banRieng(s: string): string {
  return Buffer.from(s, "utf8").toString("utf8");
}

function doThutLe(dong: string): number {
  const m = /^[ \t]*/.exec(dong);
  return m ? m[0].replace(/\t/g, "    ").length : 0;
}

/** Bỏ chú thích cuối dòng kiểu `//` (thô — đủ để quyết "kết thúc bằng `;`/`{`"). */
function boChuThichCuoi(dong: string): string {
  const i = dong.indexOf("//");
  return (i >= 0 ? dong.slice(0, i) : dong).trimEnd();
}

// ── TS / JS ──────────────────────────────────────────────────────────────────────────────────────────────────────
const TS_HAM = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${ID})\\s*[<(]`);
const TS_LOP = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+(${ID})`);
const TS_GIAO_DIEN = new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?interface\\s+(${ID})`);
const TS_KIEU = new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?type\\s+(${ID})\\s*[<=]`);
const TS_ENUM = new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+(${ID})`);
const TS_HANG_XUAT = new RegExp(`^\\s*export\\s+(?:declare\\s+)?(?:const|let|var)\\s+(${ID})\\s*(?::[^=]*)?(?:=\\s*(.*))?$`);
const TS_HANG_DINH = new RegExp(`^(?:const|let|var)\\s+(${ID})\\s*(?::[^=]*)?=\\s*(.*)$`);
const TS_LA_MUI_TEN = new RegExp(`^(?:async\\s+)?(?:function\\b|\\(.*\\)\\s*(?::[^=]*)?=>|\\($|${ID}\\s*=>)`);
const TS_PHUONG_THUC = new RegExp(
  `^\\s*(?:(?:public|private|protected|static|readonly|async|override|abstract|declare|accessor|get|set)\\s+)*\\*?\\s*(#?${ID})\\s*(?:<[^>]*>)?\\s*\\(([^)]?)`,
);
const TS_THUOC_TINH_MUI_TEN = new RegExp(
  `^\\s*(?:(?:public|private|protected|static|readonly)\\s+)*(${ID})\\s*(?::[^=]*)?=\\s*(?:async\\s+)?(?:\\([^)]*\\)|${ID})\\s*(?::[^=]*)?=>`,
);

// ── C# / Java ────────────────────────────────────────────────────────────────────────────────────────────────────
const CJ_MOD = "(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|extern|unsafe|new|partial|readonly|final|synchronized|native|default|strictfp|transient|volatile|file|required)";
const CJ_LOP = new RegExp(`^\\s*(?:${CJ_MOD}\\s+|\\[[^\\]]*\\]\\s*|@\\w+(?:\\([^)]*\\))?\\s+)*(class|interface|struct|enum|record(?:\\s+(?:class|struct))?|@interface)\\s+(${ID})`);
const CJ_PHUONG_THUC_MOD = new RegExp(`^\\s*(?:${CJ_MOD}\\s+)+(?:(.+?)\\s+)?(${ID})\\s*(?:<[^>()]*>)?\\s*\\(`);
const CJ_PHUONG_THUC_TRAN = new RegExp(`^\\s*([\\w<>\\[\\],.?]+)\\s+(${ID})\\s*(?:<[^>()]*>)?\\s*\\(`);
const CS_HANG = new RegExp(`\\bconst\\s+[\\w<>\\[\\],.?]+\\s+(${ID})\\s*=`);
const JAVA_HANG = new RegExp(`\\bstatic\\s+final\\s+[\\w<>\\[\\],.?]+\\s+(${ID})\\s*=`);

// ── Kotlin ───────────────────────────────────────────────────────────────────────────────────────────────────────
const KT_MOD = "(?:public|private|protected|internal|override|open|abstract|suspend|inline|operator|infix|tailrec|external|actual|expect|final|data|sealed|enum|annotation|inner|value|const)";
const KT_HAM = new RegExp(`^\\s*(?:${KT_MOD}\\s+)*fun\\s+(?:<[^>]*>\\s*)?(?:[\\w.<>?]+\\.)?(${ID})\\s*\\(`);
const KT_LOP = new RegExp(`^\\s*(?:${KT_MOD}\\s+)*(class|interface|object)\\s+(${ID})`);
const KT_HANG = new RegExp(`^\\s*(?:(?:private|public|internal)\\s+)?const\\s+val\\s+(${ID})`);
const KT_BI_DANH = new RegExp(`^\\s*(?:(?:private|public|internal)\\s+)?typealias\\s+(${ID})`);

// ── Go ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const GO_HAM = new RegExp(`^func\\s+(\\([^)]*\\)\\s*)?(${ID})\\s*[\\[(]`);
const GO_KIEU = new RegExp(`^type\\s+(${ID})\\s+(?:\\[[^\\]]*\\]\\s*)?(struct|interface)?`);
const GO_HANG = new RegExp(`^const\\s+(${ID})\\b`);
const GO_HANG_TRONG_KHOI = new RegExp(`^\\s+(${ID})\\b(?:\\s+[\\w.]+)?\\s*(?:=|$)`);

// ── Rust ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const RS_PUB = "(?:pub(?:\\([^)]*\\))?\\s+)?";
const RS_HAM = new RegExp(`^\\s*${RS_PUB}(?:default\\s+)?(?:const\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:extern\\s+"[^"]*"\\s+)?fn\\s+(${ID})`);
const RS_KIEU = new RegExp(`^\\s*${RS_PUB}(struct|enum|trait|union|type)\\s+(${ID})`);
const RS_HANG = new RegExp(`^\\s*${RS_PUB}(?:const|static)\\s+(?:mut\\s+)?(${ID})\\s*:`);

// ── C / C++ ──────────────────────────────────────────────────────────────────────────────────────────────────────
const C_MACRO = new RegExp(`^\\s*#\\s*define\\s+(${ID})`);
const C_LOP = new RegExp(`^\\s*(?:template\\s*<[^>]*>\\s*)?(?:typedef\\s+)?(class|struct|union|enum(?:\\s+class|\\s+struct)?)\\s+(${ID})\\s*(?:final\\b\\s*)?(?:[:{]|$)`);
const C_TYPEDEF = new RegExp(`^\\s*typedef\\s+[^;(]*?\\b(${ID})\\s*;\\s*$`);

/** Hàm/phương thức C/C++: `kiểu tên(` hoặc `Lớp::tên(` — không kết thúc `;` (nguyên mẫu), không `=`/`.`/`->` trước `(`. */
function hamC(dong: string): { ten: string; kind: LoaiKyHieu } | null {
  const sach = boChuThichCuoi(dong);
  if (sach.endsWith(";") || sach.trimStart().startsWith("#")) return null;
  const i = sach.indexOf("(");
  if (i <= 0) return null;
  const truoc = sach.slice(0, i).trimEnd();
  if (/[=.]|->|"|\breturn\b/.test(truoc)) return null;
  const m = /(?:(~?[A-Za-z_]\w*)\s*::\s*)?(~?[A-Za-z_]\w*)$/.exec(truoc);
  if (!m) return null;
  const ten = m[2]!.replace(/^~/, "");
  const dauTien = truoc.trim().split(/[\s*&]+/)[0] ?? "";
  if (TU_KHOA.has(ten) || TU_KHOA_DAU_C.has(dauTien)) return null;
  if (m[1]) return { ten: m[2]!, kind: "method" };
  // Phải có KIỂU TRẢ VỀ đứng trước tên (một lời gọi macro `FOO(x)` ở cột 0 thì không có).
  const conLai = truoc.slice(0, truoc.length - m[0].length).trim();
  if (conLai === "" || /^(?:template\s*<[^>]*>)$/.test(conLai)) return null;
  return { ten, kind: "function" };
}

/** Từ ĐẦU dòng khiến `x(` không thể là định nghĩa C/C++ (khác `TU_KHOA`: `void`/`new` ở đây là kiểu trả về hợp lệ). */
const TU_KHOA_DAU_C = new Set(["return", "if", "else", "while", "for", "switch", "case", "do", "goto", "sizeof", "typedef", "using", "namespace", "throw", "delete"]);

interface ThanLop {
  thutLe: number;
  than: number | null;
}

/**
 * Trích định nghĩa từ nội dung MỘT tệp. Thuần, không ném. Thứ tự mẫu có tải trọng: kiểu/lớp trước hàm, hàm trước
 * phương thức (một `function` lồng trong thân lớp vẫn là `function`).
 */
export function trichKyHieu(noiDung: string, ngonNgu: NgonNgu): KyHieu[] {
  const ra: KyHieu[] = [];
  const dongs = noiDung.split(/\r?\n/);
  const ngoac = ngonNgu === "ts" || ngonNgu === "cs" || ngonNgu === "java" || ngonNgu === "c" || ngonNgu === "kt";
  const chongLop: ThanLop[] = [];
  let khoiHangGo = false;
  let trongChuThichKhoi = false;

  const them = (ten: string, kind: LoaiKyHieu, i: number) => {
    ra.push({ ten: banRieng(ten), kind, dong: i + 1, chuKy: banRieng(chuKyGon(dongs[i]!)) });
  };

  for (let i = 0; i < dongs.length; i++) {
    const dong = dongs[i]!;
    const trim = dong.trim();
    if (trim === "") continue;
    // Chú thích khối `/* … */` (thô): bỏ dòng nằm trong — tránh bắt mã mẫu trong docblock.
    if (ngonNgu !== "py") {
      if (trongChuThichKhoi) {
        if (trim.includes("*/")) trongChuThichKhoi = false;
        continue;
      }
      if (trim.startsWith("/*")) {
        if (!trim.includes("*/")) trongChuThichKhoi = true;
        continue;
      }
      if (trim.startsWith("//") || trim.startsWith("*")) continue;
    } else if (trim.startsWith("#")) continue;

    const thutLe = doThutLe(dong);
    if (ngoac) {
      while (chongLop.length > 0) {
        const dinh = chongLop[chongLop.length - 1]!;
        if (thutLe > dinh.thutLe) break;
        // Kiểu Allman: `{` mở thân lớp đứng riêng dòng, cùng thụt lề với dòng `class`.
        if (trim === "{" && dinh.than === null && thutLe === dinh.thutLe) break;
        // C++: nhãn truy cập `public:` thường đứng NGANG dòng `class` — không phải hết thân lớp.
        if (ngonNgu === "c" && /^(?:public|private|protected)\s*:$/.test(trim)) break;
        chongLop.pop();
      }
      const dinh = chongLop[chongLop.length - 1];
      if (dinh && dinh.than === null && thutLe > dinh.thutLe) dinh.than = thutLe;
    }
    const oThanLop = (): boolean => {
      const d = chongLop[chongLop.length - 1];
      return d !== undefined && d.than === thutLe;
    };
    const dayLop = () => chongLop.push({ thutLe, than: null });

    switch (ngonNgu) {
      case "ts": {
        let m: RegExpExecArray | null;
        if ((m = TS_LOP.exec(dong))) { them(m[1]!, "class", i); dayLop(); break; }
        if ((m = TS_GIAO_DIEN.exec(dong))) { them(m[1]!, "interface", i); break; }
        if ((m = TS_KIEU.exec(dong))) { them(m[1]!, "type", i); break; }
        if ((m = TS_ENUM.exec(dong))) { them(m[1]!, "enum", i); break; }
        if ((m = TS_HAM.exec(dong))) { them(m[1]!, "function", i); break; }
        if ((m = TS_HANG_XUAT.exec(dong))) {
          them(m[1]!, m[2] !== undefined && TS_LA_MUI_TEN.test(m[2].trim()) ? "function" : "const", i);
          break;
        }
        if (thutLe === 0 && (m = TS_HANG_DINH.exec(dong))) {
          if (TS_LA_MUI_TEN.test(m[2]!.trim())) them(m[1]!, "function", i);
          break;
        }
        if (oThanLop()) {
          const sach = boChuThichCuoi(dong);
          if ((m = TS_THUOC_TINH_MUI_TEN.exec(dong))) { them(m[1]!, "method", i); break; }
          m = TS_PHUONG_THUC.exec(dong);
          if (m && !TU_KHOA.has(m[1]!) && !sach.endsWith(";") && !/^["'`\d]/.test(m[2] ?? "") && !sach.includes("=>")) {
            them(m[1]!, "method", i);
          }
        }
        break;
      }
      case "cs":
      case "java": {
        let m: RegExpExecArray | null;
        if ((m = CJ_LOP.exec(dong))) {
          const k = m[1]!;
          them(m[2]!, k === "interface" || k === "@interface" ? "interface" : k === "enum" ? "enum" : "class", i);
          dayLop();
          break;
        }
        if ((m = (ngonNgu === "cs" ? CS_HANG : JAVA_HANG).exec(dong))) { them(m[1]!, "const", i); break; }
        const sach = boChuThichCuoi(dong);
        if (sach.endsWith(";")) break;
        if ((m = CJ_PHUONG_THUC_MOD.exec(dong)) && !TU_KHOA.has(m[2]!) && !/[=]/.test(m[1] ?? "")) {
          them(m[2]!, "method", i);
          break;
        }
        if (oThanLop() && (m = CJ_PHUONG_THUC_TRAN.exec(dong)) && !TU_KHOA.has(m[1]!) && !TU_KHOA.has(m[2]!)) {
          them(m[2]!, "method", i);
        }
        break;
      }
      case "kt": {
        let m: RegExpExecArray | null;
        if ((m = KT_LOP.exec(dong))) {
          them(m[2]!, m[1] === "interface" ? "interface" : /\benum\s+class\b/.test(dong) ? "enum" : "class", i);
          dayLop();
          break;
        }
        if ((m = KT_HANG.exec(dong))) { them(m[1]!, "const", i); break; }
        if ((m = KT_BI_DANH.exec(dong))) { them(m[1]!, "type", i); break; }
        if ((m = KT_HAM.exec(dong))) them(m[1]!, thutLe === 0 ? "function" : "method", i);
        break;
      }
      case "go": {
        let m: RegExpExecArray | null;
        if (khoiHangGo) {
          if (trim.startsWith(")")) { khoiHangGo = false; break; }
          if ((m = GO_HANG_TRONG_KHOI.exec(dong))) them(m[1]!, "const", i);
          break;
        }
        if (/^const\s*\($/.test(trim) && thutLe === 0) { khoiHangGo = true; break; }
        if ((m = GO_HAM.exec(dong))) { them(m[2]!, m[1] ? "method" : "function", i); break; }
        if ((m = GO_KIEU.exec(dong))) {
          them(m[1]!, m[2] === "interface" ? "interface" : m[2] === "struct" ? "class" : "type", i);
          break;
        }
        if ((m = GO_HANG.exec(dong))) them(m[1]!, "const", i);
        break;
      }
      case "rs": {
        let m: RegExpExecArray | null;
        if ((m = RS_KIEU.exec(dong))) {
          const k = m[1]!;
          them(m[2]!, k === "trait" ? "interface" : k === "enum" ? "enum" : k === "type" ? "type" : "class", i);
          break;
        }
        if ((m = RS_HAM.exec(dong))) { them(m[1]!, thutLe === 0 ? "function" : "method", i); break; }
        if ((m = RS_HANG.exec(dong))) them(m[1]!, "const", i);
        break;
      }
      case "c": {
        let m: RegExpExecArray | null;
        if ((m = C_MACRO.exec(dong))) { them(m[1]!, "const", i); break; }
        if ((m = C_LOP.exec(dong))) {
          them(m[2]!, m[1]!.startsWith("enum") ? "enum" : "class", i);
          dayLop();
          break;
        }
        if ((m = C_TYPEDEF.exec(dong))) { them(m[1]!, "type", i); break; }
        if (thutLe === 0 || oThanLop()) {
          const h = hamC(dong);
          if (h) them(h.ten, thutLe === 0 ? h.kind : "method", i);
        }
        break;
      }
      case "py": {
        let m: RegExpExecArray | null;
        if ((m = /^\s*class\s+([A-Za-z_]\w*)/.exec(dong))) { them(m[1]!, "class", i); break; }
        if ((m = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(dong))) { them(m[1]!, thutLe === 0 ? "function" : "method", i); break; }
        if ((m = /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=(?!=)/.exec(dong))) them(m[1]!, "const", i);
        break;
      }
    }
  }
  return ra;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// BỘ ĐỆM + DỰNG BẢNG
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/** Số tệp tối đa một lượt quét (trần công việc). Repo này có ~5.200 tệp mã. */
export const TRAN_TEP_KY_HIEU = 20_000;
/** Hạn giờ mặc định một lượt (lượt lạnh đọc toàn bộ mã; lượt ấm chỉ `stat`). */
export const HAN_GIO_KY_HIEU_MS = 15_000;
/** Số mục bộ đệm tối đa (mọi gốc cộng lại) — chống rò bộ nhớ khi nhiều dự án. */
const TRAN_MUC_BO_DEM = 60_000;
const TRAN_DINH_NGHIA = 50;
const TRAN_THAM_CHIEU_MAC_DINH = 20;
const TRAN_THAM_CHIEU_TOI_DA = 200;
const TRAN_DONG_MA = 240;

interface MucBoDem {
  mtimeMs: number;
  size: number;
  tranByte: number;
  kyHieu: KyHieu[];
  catBot: boolean;
}

const boDem = new Map<string, MucBoDem>();

/** Chỉ dùng trong lưới / khi đổi cấu hình. */
export function xoaBoDemKyHieu(): void {
  boDem.clear();
}

function khoaBoDem(goc: string, rel: string): string {
  return `${goc}\0${rel}`;
}

function gocHopLe(gocDuAn: unknown): string | null {
  if (typeof gocDuAn !== "string" || gocDuAn.trim() === "" || !path.isAbsolute(gocDuAn)) return null;
  const goc = path.resolve(gocDuAn);
  try {
    return fs.statSync(goc).isDirectory() ? goc : null;
  } catch {
    return null;
  }
}

/** Ký hiệu của MỘT tệp — từ bộ đệm nếu (mtime, kích thước, trần byte) khớp, không thì đọc qua hộp cát. */
function kyHieuCuaTep(goc: string, rel: string, tranByte: number): { kyHieu: KyHieu[]; catBot: boolean } | null {
  const ngonNgu = ngonNguCuaTep(rel.split("/").pop() ?? "");
  if (ngonNgu === null) return null;
  const dv = dauVetTep(goc, rel);
  if (dv === null) return null;
  const k = khoaBoDem(goc, rel);
  const cu = boDem.get(k);
  if (cu && cu.mtimeMs === dv.mtimeMs && cu.size === dv.size && cu.tranByte === tranByte) {
    // Chạm lại ⇒ dời về cuối (Map giữ thứ tự chèn ⇒ đuổi theo LRU thô).
    boDem.delete(k);
    boDem.set(k, cu);
    return cu;
  }
  const doc = docTepChiMuc(goc, rel, tranByte);
  if (!doc.ok) return null;
  const muc: MucBoDem = { mtimeMs: dv.mtimeMs, size: dv.size, tranByte, kyHieu: trichKyHieu(doc.noiDung, ngonNgu), catBot: doc.catBot };
  boDem.delete(k);
  boDem.set(k, muc);
  if (boDem.size > TRAN_MUC_BO_DEM) {
    let can = Math.ceil(TRAN_MUC_BO_DEM / 10);
    for (const kk of boDem.keys()) {
      boDem.delete(kk);
      if (--can <= 0) break;
    }
  }
  return muc;
}

export interface TuyChonQuet {
  gocDuAn: string;
  /** Trần byte đọc mỗi tệp (mặc định `TRAN_BYTE_TEP_MAC_DINH`). */
  tranByteTep?: number;
  /** Trần số tệp (mặc định `TRAN_TEP_KY_HIEU`). */
  tranTep?: number;
  /** Hạn giờ (mặc định `HAN_GIO_KY_HIEU_MS`). */
  hanGioMs?: number;
}

interface KetQuaQuet {
  goc: string;
  tep: Array<{ rel: string; kyHieu: KyHieu[] }>;
  catBot: boolean;
  hanChot: number;
  tranByte: number;
}

function quet(tc: TuyChonQuet, goc: string): KetQuaQuet {
  const tranByte = Math.max(1, Math.floor(tc.tranByteTep ?? TRAN_BYTE_TEP_MAC_DINH));
  const hanChot = Date.now() + Math.max(1, tc.hanGioMs ?? HAN_GIO_KY_HIEU_MS);
  const dt = duyetTepMa(goc, {
    tranTep: Math.max(1, Math.floor(tc.tranTep ?? TRAN_TEP_KY_HIEU)),
    hanChot,
    loc: (ten) => ngonNguCuaTep(ten) !== null,
    boQua: napBoQuaGit(goc),
  });
  let catBot = dt.catBot;
  const tep: KetQuaQuet["tep"] = [];
  for (const rel of dt.tep) {
    if (Date.now() >= hanChot) {
      catBot = true;
      break;
    }
    const kh = kyHieuCuaTep(goc, rel, tranByte);
    if (kh === null) continue;
    if (kh.catBot) catBot = true;
    tep.push({ rel, kyHieu: kh.kyHieu });
  }
  return { goc, tep, catBot, hanChot, tranByte };
}

/** Dựng (hoặc làm ấm) bảng ký hiệu của một dự án — trả thống kê. Dùng để khởi động trước và để ĐO. */
export async function dungBangKyHieu(tc: TuyChonQuet): Promise<{ soTep: number; soKyHieu: number; ms: number; catBot: boolean }> {
  const t0 = Date.now();
  const goc = gocHopLe(tc.gocDuAn);
  if (goc === null) return { soTep: 0, soKyHieu: 0, ms: 0, catBot: false };
  const q = quet(tc, goc);
  return { soTep: q.tep.length, soKyHieu: q.tep.reduce((s, t) => s + t.kyHieu.length, 0), ms: Date.now() - t0, catBot: q.catBot };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TÌM
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const DONG_NGHIA_KIND: Readonly<Record<string, LoaiKyHieu>> = {
  function: "function", func: "function", fn: "function", ham: "function",
  method: "method", phuongthuc: "method",
  class: "class", struct: "class", lop: "class", object: "class", record: "class",
  interface: "interface", trait: "interface", protocol: "interface",
  type: "type", typedef: "type", typealias: "type", kieu: "type",
  enum: "enum",
  const: "const", constant: "const", hang: "const", variable: "const", var: "const", let: "const", macro: "const",
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface KetQuaTimKyHieu {
  dinhNghia: Array<{ duong: string; dong: number; kind: string; chuKy: string }>;
  thamChieu: Array<{ duong: string; dong: number; dongMa: string }>;
  catBot: boolean;
}

/**
 * Định nghĩa khớp `ten` (CHÍNH XÁC trước; không có thì KHÔNG PHÂN BIỆT HOA/THƯỜNG) + tối đa `tran` tham chiếu (ranh
 * giới từ, bỏ dòng định nghĩa). `ten` dạng `A.b` / `A::b` ⇒ tìm `b`. `kind` lạ ⇒ bỏ qua bộ lọc (model hay đưa
 * "symbol"/"any" — lọc theo thứ không tồn tại sẽ trả rỗng sai).
 */
export async function timKyHieu(
  y: { gocDuAn: string; ten: string; kind?: string; tran?: number } & Omit<TuyChonQuet, "gocDuAn">,
): Promise<KetQuaTimKyHieu> {
  const rong: KetQuaTimKyHieu = { dinhNghia: [], thamChieu: [], catBot: false };
  const goc = gocHopLe(y.gocDuAn);
  if (goc === null) return rong;
  const tenTho = typeof y.ten === "string" ? y.ten.trim() : "";
  const ten = tenTho.split(/\.|::/).pop() ?? "";
  if (tenTho.length > 200 || !new RegExp(`^${ID}$`).test(ten)) return rong;
  const kind = y.kind ? DONG_NGHIA_KIND[y.kind.trim().toLowerCase().replace(/[\s_-]/g, "")] : undefined;
  const tran = Math.max(1, Math.min(Math.floor(y.tran ?? TRAN_THAM_CHIEU_MAC_DINH), TRAN_THAM_CHIEU_TOI_DA));

  const q = quet(y, goc);
  let catBot = q.catBot;

  const khop = (loc: (k: KyHieu) => boolean) => {
    const ds: KetQuaTimKyHieu["dinhNghia"] = [];
    for (const t of q.tep) {
      for (const k of t.kyHieu) {
        if (loc(k) && (kind === undefined || k.kind === kind)) ds.push({ duong: t.rel, dong: k.dong, kind: k.kind, chuKy: k.chuKy });
      }
    }
    return ds;
  };
  let dinhNghia = khop((k) => k.ten === ten);
  if (dinhNghia.length === 0) {
    const thuong = ten.toLowerCase();
    dinhNghia = khop((k) => k.ten.toLowerCase() === thuong);
  }
  if (dinhNghia.length > TRAN_DINH_NGHIA) {
    dinhNghia = dinhNghia.slice(0, TRAN_DINH_NGHIA);
    catBot = true;
  }

  // Tham chiếu: tệp chứa định nghĩa đi TRƯỚC (người hỏi thường cần "dùng ở đâu quanh nó"), rồi theo thứ tự duyệt.
  const dongDinhNghia = new Set(dinhNghia.map((d) => `${d.duong}\0${d.dong}`));
  // Bỏ cả dòng định nghĩa ĐÃ BỊ LỌC bởi `kind`/trần (vd. `class Kho` khi lọc `function`) — chúng không phải tham chiếu.
  for (const t of q.tep) for (const k of t.kyHieu) if (k.ten === ten) dongDinhNghia.add(`${t.rel}\0${k.dong}`);
  const tepDinhNghia = new Set(dinhNghia.map((d) => d.duong));
  const thuTu = [...q.tep.filter((t) => tepDinhNghia.has(t.rel)), ...q.tep.filter((t) => !tepDinhNghia.has(t.rel))];
  const re = new RegExp(`(?<![\\w$])${escapeRegex(ten)}(?![\\w$])`);
  const thamChieu: KetQuaTimKyHieu["thamChieu"] = [];
  ngoai: for (const t of thuTu) {
    if (Date.now() >= q.hanChot) {
      catBot = true;
      break;
    }
    const doc = docTepChiMuc(goc, t.rel, q.tranByte);
    if (!doc.ok || !doc.noiDung.includes(ten)) continue;
    const dongs = doc.noiDung.split(/\r?\n/);
    for (let i = 0; i < dongs.length; i++) {
      const d = dongs[i]!;
      if (!re.test(d) || dongDinhNghia.has(`${t.rel}\0${i + 1}`)) continue;
      if (thamChieu.length >= tran) {
        catBot = true;
        break ngoai;
      }
      const g = d.trim();
      thamChieu.push({ duong: t.rel, dong: i + 1, dongMa: g.length > TRAN_DONG_MA ? g.slice(0, TRAN_DONG_MA - 1) + "…" : g });
    }
  }
  return { dinhNghia, thamChieu, catBot };
}
