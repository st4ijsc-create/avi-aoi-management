/**
 * ★★★ Đợt 3c (2026-10-17) — **TỆP CẤU HÌNH CHẠY CỦA DỰ ÁN** (`.ai-chay.json`) + phép SUY lệnh chạy / lệnh cài.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ MỘT TỆP KHAI, THAY VÌ ĐỂ MODEL/NGƯỜI GÕ LỆNH CHẠY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * "Chạy ứng dụng" là THI HÀNH MÃ CỦA DỰ ÁN trong một tiến trình sống lâu. Nếu lệnh chạy là một chuỗi tự do
 * (từ ô nhập hay từ model) thì đó là `python <bất kỳ>` — đúng thứ danh sách trắng của `run_command` tồn tại
 * để chặn. ⇒ Lệnh chạy CHỈ đến từ một trong hai nguồn, cả hai đều nằm TRONG dự án và đều đi qua thẻ duyệt
 * khi bị sửa (apply_diff là HITL):
 *   1. `package.json` → `scripts.dev`, nếu không có thì `scripts.start` (mặc định, không cần khai gì);
 *   2. `.ai-chay.json` → `chay: {loai:"npm", script:"dev"|"start"} | {loai:"python", tep:"<.py>"} |
 *      {loai:"dotnet", duAn:"<.csproj>"}` — đường đi qua `phanQuyetDuongDan` của pha A + phải TỒN TẠI.
 *   Hình dạng KHÁC ⇒ từ chối, có mã. Không có nhánh "chuỗi lệnh tự do" nào.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `npmChoPhepScriptCai` — CỜ MỞ SCRIPT CÀI ĐẶT, PHẢI KÈM LÝ DO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `npm ci`/`npm install` chạy `--ignore-scripts` MẶC ĐỊNH: script `preinstall/postinstall` của một gói phụ
 * thuộc là mã TUỲ Ý chạy lúc cài (chuỗi cung ứng). Có dự án cần thật (esbuild, sharp tải nhị phân nền
 * tảng) ⇒ mở được, nhưng chỉ bằng `{ "npmChoPhepScriptCai": { "bat": true, "lyDo": "<≥ 8 ký tự>" } }`.
 * Thiếu lý do / sai kiểu / JSON hỏng ⇒ coi như KHÔNG khai (fail-closed) — và lý do được in lên thẻ duyệt.
 *
 * ⚠ Đọc tệp: CHỈ hai tên cố định (`.ai-chay.json`, `package.json`) ngay dưới gốc dự án (gốc đã qua danh sách
 *   trắng `repoProjects`), `lstat` phải là TỆP THƯỜNG (symlink ⇒ bỏ qua — không theo liên kết ra ngoài gốc),
 *   trần kích thước. Nội dung không đi tới model: chỉ một boolean + câu lý do (lên thẻ duyệt) + tên script.
 */
import fs from "node:fs";
import path from "node:path";
import { phanQuyetDuongDan } from "../../aiLocalTools/repoSandbox";

export const TEN_TEP_CAU_HINH_CHAY = ".ai-chay.json";
/** Trần đọc — tệp cấu hình/manifest lớn hơn là bất thường, không phải "đọc cắt". */
const TRAN_BYTE_TEP = 256 * 1024;
const LY_DO_TOI_THIEU = 8;

export type KhaiBaoChay =
  | { loai: "npm"; script: "dev" | "start" }
  | { loai: "python"; tep: string }
  | { loai: "dotnet"; duAn: string };

export interface CauHinhChayDuAn {
  /** `null` ⇔ KHÔNG mở (mặc định). Có giá trị ⇔ mở CÓ CHỦ Ý, kèm lý do. */
  npmScriptCai: { lyDo: string } | null;
  /** Khai báo lệnh chạy (đã kiểm HÌNH DẠNG, chưa kiểm tồn tại). `null` ⇔ không khai. */
  chay: KhaiBaoChay | null;
  /** Lỗi hình dạng đọc được (để trả cho người, không để nuốt). */
  loi: string[];
}

/** Đọc một tệp TÊN CỐ ĐỊNH ngay dưới gốc: tệp thường, không symlink, trong trần. `null` ⇔ vắng/không hợp lệ. */
function docTepGoc(goc: string, ten: string): string | null {
  const p = path.join(goc, ten);
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > TRAN_BYTE_TEP) return null;
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function laDoiTuong(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function docCauHinhChay(goc: string): CauHinhChayDuAn {
  const ra: CauHinhChayDuAn = { npmScriptCai: null, chay: null, loi: [] };
  const tho = docTepGoc(goc, TEN_TEP_CAU_HINH_CHAY);
  if (tho === null) return ra;
  let j: unknown;
  try {
    j = JSON.parse(tho);
  } catch {
    ra.loi.push(`${TEN_TEP_CAU_HINH_CHAY}: không phải JSON hợp lệ`);
    return ra;
  }
  if (!laDoiTuong(j)) {
    ra.loi.push(`${TEN_TEP_CAU_HINH_CHAY}: gốc phải là một đối tượng`);
    return ra;
  }
  const s = j.npmChoPhepScriptCai;
  if (s !== undefined) {
    if (laDoiTuong(s) && s.bat === true && typeof s.lyDo === "string" && s.lyDo.trim().length >= LY_DO_TOI_THIEU) {
      ra.npmScriptCai = { lyDo: s.lyDo.trim().slice(0, 300) };
    } else {
      ra.loi.push(`npmChoPhepScriptCai phải là {"bat": true, "lyDo": "<ít nhất ${LY_DO_TOI_THIEU} ký tự>"} — khai méo ⇒ giữ --ignore-scripts`);
    }
  }
  const c = j.chay;
  if (c !== undefined) {
    if (laDoiTuong(c) && c.loai === "npm" && (c.script === "dev" || c.script === "start")) ra.chay = { loai: "npm", script: c.script };
    else if (laDoiTuong(c) && c.loai === "python" && typeof c.tep === "string") ra.chay = { loai: "python", tep: c.tep };
    else if (laDoiTuong(c) && c.loai === "dotnet" && typeof c.duAn === "string") ra.chay = { loai: "dotnet", duAn: c.duAn };
    else ra.loi.push(`chay phải là {"loai":"npm","script":"dev"|"start"} | {"loai":"python","tep":"<.py>"} | {"loai":"dotnet","duAn":"<.csproj>"}`);
  }
  return ra;
}

/** `scripts` của `package.json` ở ĐÚNG gốc (không leo cây). `null` ⇔ vắng/hỏng. */
export function docScriptsGoc(goc: string): Record<string, string> | null {
  const tho = docTepGoc(goc, "package.json");
  if (tho === null) return null;
  try {
    const j = JSON.parse(tho) as unknown;
    if (!laDoiTuong(j) || !laDoiTuong(j.scripts)) return {};
    const ra: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.scripts)) if (typeof v === "string") ra[k] = v;
    return ra;
  } catch {
    return null;
  }
}

export type MaSuyLenhChay = "CHUA_KHAI_LENH_CHAY" | "CAU_HINH_CHAY_SAI" | "TEP_CHAY_KHONG_HOP_LE";

export type KetQuaSuyLenhChay =
  | { ok: true; khai: KhaiBaoChay; nguon: "package.json" | typeof TEN_TEP_CAU_HINH_CHAY }
  | { ok: false; ma: MaSuyLenhChay; chiTiet: string };

/** Đường tương đối trong dự án: qua hộp cát pha A + đúng đuôi + TỒN TẠI là tệp thường dưới gốc. */
function kiemTepTrongGoc(goc: string, rel: string, duoi: string): string | null {
  if (phanQuyetDuongDan(rel) !== null) return `"${rel}" bị hộp cát đường dẫn từ chối`;
  if (!rel.toLowerCase().endsWith(duoi)) return `"${rel}" phải có đuôi ${duoi}`;
  const abs = path.resolve(goc, rel);
  const tuongDoi = path.relative(path.resolve(goc), abs);
  if (tuongDoi.startsWith("..") || path.isAbsolute(tuongDoi)) return `"${rel}" nằm ngoài gốc dự án`;
  try {
    if (!fs.lstatSync(abs).isFile()) return `"${rel}" không phải tệp thường`;
  } catch {
    return `"${rel}" không tồn tại`;
  }
  return null;
}

/**
 * ★ Lệnh chạy của dự án: `.ai-chay.json` thắng; vắng ⇒ `scripts.dev` rồi `scripts.start` của package.json.
 */
export function suyLenhChay(goc: string): KetQuaSuyLenhChay {
  const ch = docCauHinhChay(goc);
  const scripts = docScriptsGoc(goc);
  if (ch.chay) {
    const k = ch.chay;
    if (k.loai === "npm") {
      if (!scripts || typeof scripts[k.script] !== "string") {
        return { ok: false, ma: "TEP_CHAY_KHONG_HOP_LE", chiTiet: `package.json ở gốc không có scripts.${k.script}` };
      }
      return { ok: true, khai: k, nguon: TEN_TEP_CAU_HINH_CHAY };
    }
    const loi = k.loai === "python" ? kiemTepTrongGoc(goc, k.tep, ".py") : kiemTepTrongGoc(goc, k.duAn, ".csproj");
    if (loi) return { ok: false, ma: "TEP_CHAY_KHONG_HOP_LE", chiTiet: loi };
    return { ok: true, khai: k, nguon: TEN_TEP_CAU_HINH_CHAY };
  }
  if (ch.loi.some((l) => l.startsWith("chay ") || l.includes("JSON") || l.includes("gốc phải"))) {
    return { ok: false, ma: "CAU_HINH_CHAY_SAI", chiTiet: ch.loi.join("; ") };
  }
  if (scripts && typeof scripts.dev === "string") return { ok: true, khai: { loai: "npm", script: "dev" }, nguon: "package.json" };
  if (scripts && typeof scripts.start === "string") return { ok: true, khai: { loai: "npm", script: "start" }, nguon: "package.json" };
  return {
    ok: false,
    ma: "CHUA_KHAI_LENH_CHAY",
    chiTiet:
      `Dự án không có scripts "dev"/"start" trong package.json và không có ${TEN_TEP_CAU_HINH_CHAY}. ` +
      `Python/.NET cần khai: {"chay":{"loai":"python","tep":"app.py"}} hoặc {"chay":{"loai":"dotnet","duAn":"src/App/App.csproj"}}.`,
  };
}

/**
 * ★ Lệnh CÀI gợi ý cho dự án — CHỈ là chuỗi trong danh sách trắng; người gọi vẫn đưa nó qua `run_command`
 * (propose → thẻ duyệt). Thứ tự: npm (lock ⇒ `npm ci`, không ⇒ `npm install`) · Python (`.venv` vắng ⇒ tạo
 * venv TRƯỚC) · .NET (`*.csproj|*.sln` ở gốc ⇒ `dotnet restore`). Rỗng ⇔ không nhận ra hệ sinh thái nào.
 */
export function suyLenhCaiDat(goc: string): string[] {
  const ra: string[] = [];
  const co = (ten: string) => {
    try {
      return fs.lstatSync(path.join(goc, ten)).isFile();
    } catch {
      return false;
    }
  };
  if (co("package.json")) ra.push(co("package-lock.json") ? "npm ci" : "npm install");
  if (co("requirements.txt")) {
    const venv = process.platform === "win32" ? path.join(".venv", "Scripts", "python.exe") : path.join(".venv", "bin", "python");
    ra.push(co(venv) ? "pip install -r requirements.txt" : "python -m venv .venv");
  }
  let tenGoc: string[] = [];
  try {
    tenGoc = fs.readdirSync(goc);
  } catch {
    tenGoc = [];
  }
  if (tenGoc.some((t) => /\.(csproj|sln|slnx)$/i.test(t))) ra.push("dotnet restore");
  return ra;
}
