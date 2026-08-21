/**
 * NGUỒN SỰ THẬT DUY NHẤT cho phép đếm "chuỗi tiếng Việt hình dạng thứ ba".
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO FILE NÀY TỒN TẠI — một sự cố đã đo được
 * ══════════════════════════════════════════════════════════════════════════════
 * Kế hoạch F12 ghi rõ: *"đừng viết bộ quét thứ hai; lệch nhau là ngân sách không
 * bao giờ về 0 được"*. Rồi chuyện đó xảy ra thật: một bản sao logic trong scratchpad
 * khai **623** trong khi cổng khai **500** — lệch đúng 123 mục, vì bản sao thiếu phép
 * miễn trừ `t(` trải nhiều dòng thêm ở lượt 2026-08-18. Ai tin bản sao sẽ đi "sửa"
 * 123 mục vốn đã đúng.
 *
 * ⇒ Từ đây `viStringCoverage.unit.test.ts` (cổng) và mọi công cụ di trú đều import
 *   TỪ ĐÂY. Muốn đổi cách đếm thì đổi ở một chỗ, và cổng đỏ ngay nếu con số đổi.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const CHU_VIET =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

export function walkTsx(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "locales") continue; // file dịch, không phải mã
      out.push(...walkTsx(full));
    } else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Bỏ comment `//` ở CUỐI dòng. Phép bỏ comment theo đầu dòng không thấy nó, nên
 * `const X = ...; // ghi chú tiếng Việt` bị đếm thành nợ — nó không phải nợ.
 * ⚠ Không cắt ở `://` (URL) và không cắt phần `//` nằm TRONG chuỗi.
 */
export function boCommentCuoiDong(ln) {
  let trongChuoi = null;
  for (let i = 0; i < ln.length - 1; i++) {
    const c = ln[i];
    if (trongChuoi) {
      if (c === "\\") i++;
      else if (c === trongChuoi) trongChuoi = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { trongChuoi = c; continue; }
    if (c === "/" && ln[i + 1] === "/") return ln.slice(0, i);
  }
  return ln;
}

/**
 * Bốn khuôn ĐÃ ĐÚNG, không được tính là nợ — mỗi khuôn kèm lý do đo được:
 *  · `pick("vi", "en", "zh")` — bộ chọn ba ngôn ngữ tự viết (`MachineAISummary`),
 *    đã trả đúng chữ theo `i18n.language`; bọc `t()` là làm THỪA.
 *  · `["khoa.i18n", "tiếng Việt"]` — tuple [khoá, mặc định], phần tử đầu LÀ khoá.
 *  · `defaultValue: "…"` — đúng là defaultValue của i18n, nhánh (a) lo.
 *  · `{ labelKey/key: "…", label/fallback: "…" }` — khoá đi kèm trên cùng dòng.
 */
export function LA_KHUON_DUNG(ln) {
  if (/\bpick\s*\(\s*[`"']/.test(ln)) return true;
  if (/\[\s*["'`][a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+["'`]\s*,\s*["'`]/.test(ln)) return true;
  if (/\bdefaultValue\s*:/.test(ln)) return true;
  if (/\b(labelKey|titleKey|descKey|key)\s*:\s*["'`][a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+["'`]/.test(ln)) return true;
  if (/\b(fallback|labelFallback|titleFallback|descFallback)\s*:/.test(ln)) return true;
  // `header: "Mã vật liệu", headerKey: "masterData.col.code"` — CÙNG khuôn [khoá,
  // mặc định], chỉ khác tên. `header` BẮT BUỘC ở lại tiếng Việt: nó là khoá khớp
  // cột file Excel người dùng tải lên (`masterDataIO.mapAndValidate`) và là hàng
  // tiêu đề của file template. Dịch nó = mọi file cũ hết nhập được.
  if (/\bheaderKey\s*:\s*["'`][a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+["'`]/.test(ln)) return true;
  // `findCol("code", "mã", "ma", …)` — BÍ DANH CỘT, không phải nhãn.
  // `BulkImportDialog` dò tiêu đề cột trong file Excel NGƯỜI DÙNG tải lên bằng chính
  // các chuỗi này (chuẩn hoá bỏ dấu cách/gạch rồi so khớp). Chúng là DỮ LIỆU ĐẦU VÀO
  // của phép khớp; "dịch" chúng sang tiếng Anh/Trung nghĩa là file tiếng Việt của
  // người dùng thôi nhận ra được — làm HỎNG chức năng nhập chứ không cải thiện i18n.
  // Cùng lớp với `MasterDataColumn.header`; xem docblock ở `shared/masterDataIO.ts`.
  if (/\bfindCol\s*\(/.test(ln)) return true;
  // `{ key: "q1", default: "…tiếng Việt…" }` — CÙNG khuôn [khoá, mặc định], chỉ khác
  // tên trường và khoá không có dấu chấm (`ManagementInsight` ghép tiền tố lúc gọi:
  // `t(\`mgmtInsight.qa.examples.\${ex.key}\`, ex.default)`). Đã kiểm 2026-08-21: cả ba
  // khoá `q1/q2/q3` có đủ vi/en/zh ⇒ không phải nợ.
  if (/\bkey\s*:\s*["'`][\w-]+["'`]/.test(ln) && /\bdefault\s*:\s*["'`]/.test(ln)) return true;
  return false;
}

/** Dòng KHAI một khoá i18n (`labelKey: "a.b.c"`), bất kể có gì khác trên dòng. */
const KHAI_KHOA = /\b(labelKey|titleKey|descKey|key)\s*:\s*["'`][a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+["'`]/;

/** Dòng CHỈ gồm `tên: "một chuỗi"` — không lời gọi, không toán tử, không gì khác. */
const CHI_LA_CAP_THUOC_TINH = /^\s*[A-Za-z_$][\w$]*\s*:\s*(["'`])(?:(?!\1)[^\\]|\\.)*\1\s*,?\s*$/;

/** Dòng MỞ ĐẦU bằng một thuộc tính object (`tên:` hoặc `"tên":`). */
const LA_THUOC_TINH_OBJECT = /^\s*(?:[A-Za-z_$][\w$]*|["'][^"']+["'])\s*:/;

/** Mở một lời gọi `t(` mà đối số ĐẦU là khoá i18n — kể cả khi khoá nằm ở dòng sau. */
const MO_T_CO_KHOA =
  /\bt\s*\(\s*(?:["'`][a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+["'`]|`[^`]*\$\{|$)/;

/**
 * Xoá THÂN mọi lời gọi `t(...)` trên dòng (đếm ngoặc, tôn trọng chuỗi), giữ phần
 * còn lại.
 *
 * ⚠ VÌ SAO PHẢI CÓ — lỗ này do chính đợt di trú F13 phơi ra. Luật cũ là *"dòng nào
 * có `t(` thì bỏ qua CẢ DÒNG"*, đúng cho khuôn `t("khoá", "mặc định tiếng Việt")`.
 * Nhưng một dòng được di trú MỘT PHẦN thì tàng hình vĩnh viễn:
 *
 *     cond ? "Tăng" : cond2 ? t("k.giam", "Giảm") : t("k.onDinh", "Ổn định")
 *              ↑ còn nguyên tiếng Việt, mà cả dòng đã được miễn đếm
 *
 * Đúng ba chỗ như vậy do bộ di trú của tôi tạo ra (ternary LỒNG, và nhánh nằm cạnh
 * một `t()` sẵn có). Bản vá tự đào lỗ cho chính nó — và cổng khai xanh.
 * ⇒ Nay gỡ `t(...)` rồi mới hỏi "còn chữ Việt không", thay vì bỏ qua cả dòng.
 */
export function goBoTCalls(ln) {
  let out = "", i = 0;
  while (i < ln.length) {
    const m = ln.slice(i).match(/\bt\s*\(/);
    if (!m) { out += ln.slice(i); break; }
    const start = i + m.index;
    out += ln.slice(i, start);
    let j = start + m[0].length, d = 1, q = null;
    while (j < ln.length && d > 0) {
      const c = ln[j];
      if (q) { if (c === "\\") j++; else if (c === q) q = null; }
      else if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "(") d++;
      else if (c === ")") d--;
      j++;
    }
    if (d > 0) return out; // `t(` chưa đóng trên dòng này → phần sau thuộc về nó
    i = j;
  }
  return out;
}

/** Đếm ngoặc tròn NẰM NGOÀI chuỗi — để biết một lời gọi `t(` đã đóng chưa. */
export function demNgoacNgoaiChuoi(ln) {
  let trongChuoi = null;
  let d = 0;
  for (let i = 0; i < ln.length; i++) {
    const c = ln[i];
    if (trongChuoi) {
      if (c === "\\") i++;
      else if (c === trongChuoi) trongChuoi = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { trongChuoi = c; continue; }
    if (c === "(") d++;
    else if (c === ")") d--;
  }
  return d;
}

/**
 * ★ Trần an toàn cho phép theo dõi `t(` nhiều dòng. Nếu phép đếm ngoặc lạc, độ sâu sẽ
 * KHÔNG BAO GIỜ về 0 và phần còn lại của file được miễn trừ trong im lặng — đúng lớp
 * lỗi "thước rỗng" đã trả giá ở Pha 4. Quá trần thì BỎ theo dõi, và số lần chạm trần
 * được IN RA thay vì nuốt.
 */
const TRAN_DONG_TRONG_MOT_T = 12;

/**
 * File có BẢNG DỊCH TỰ VIẾT đủ ba ngôn ngữ — nhánh `vi` của bảng KHÔNG phải nợ.
 *
 * `ReportExportButton` giữ `LABELS: Record<lang, Record<key, string>>` với đủ
 * `en`/`vi`/`zh`, chọn bằng `getLabels(i18n.language)`. Người dùng en/zh KHÔNG hề
 * thấy tiếng Việt ở đây. Bọc `t()` là làm lại một việc đã xong — và tệ hơn, sẽ phải
 * bỏ bảng đang chạy đúng để đổi lấy rủi ro.
 * Cùng lớp với `pick("vi","en","zh")` ở `MachineAISummary`.
 *
 * ⚠ Điều kiện để nằm trong danh sách này: file phải có ĐỦ ba nhánh ngôn ngữ VÀ chọn
 * theo `i18n.language`. Thiếu một nhánh thì nó là nợ thật, không được miễn.
 */
const FILE_CO_BANG_DICH_RIENG = [/ReportExportButton\.tsx$/];

/**
 * Đếm chuỗi tiếng Việt "hình dạng thứ ba" — string literal trong BIỂU THỨC, tức
 * không phải `>text<` cũng không phải `attr="text"` (hai hình dạng đó có cổng riêng).
 *
 * @param clientSrc thư mục gốc `client/src`
 * @param chiTiet   true ⇒ trả kèm từng dòng bị đếm (dùng cho công cụ di trú)
 */
export function demHinhDangBa(clientSrc = resolve("client/src"), chiTiet = false) {
  const byFile = [];
  const dong = [];
  let total = 0;
  let chamTran = 0;

  for (const file of walkTsx(clientSrc)) {
    if (FILE_CO_BANG_DICH_RIENG.some((re) => re.test(file.split("\\").join("/")))) continue;
    const noiDung = readFileSync(file, "utf8");
    const lines = noiDung.split("\n");

    /**
     * Khuôn TRƯỜNG HẬU-TỐ-NGÔN-NGỮ: `name` / `nameVi` / `nameZh` chọn theo `language`.
     * Nhánh `Vi` của một bộ ĐỦ BA không phải nợ — người dùng zh vẫn có chữ để đọc.
     *
     * ⚠ Chỉ miễn khi file THẬT SỰ có nhánh `Zh`. Đo ngày 2026-08-21: 2 file đủ cặp
     * (`DashboardWidgetManager`, `ResizableDashboard`) nhưng `DefectCatalogPage` có 11
     * trường `*Vi:` mà **0** trường `*Zh:`, `FactoryCommandView` 6/0 — đó là nợ THẬT,
     * và một luật miễn trừ theo mặt chữ "cứ thấy `nameVi` là bỏ qua" sẽ giấu đúng
     * chúng đi. Điều kiện phải là CÓ CẶP, không phải CÓ TÊN.
     */
    const coCapNgonNgu =
      /\b[a-zA-Z]+Vi\s*:/.test(noiDung) && /\b[a-zA-Z]+Zh\s*:/.test(noiDung);
    let inBlock = false;
    let n = 0;
    /** >0 nghĩa là đang ở TRONG thân một lời gọi `t(` mở từ dòng trước. */
    let sauT = 0;
    let dongTrongT = 0;
    let dongMaTruoc = "";
    lines.forEach((ln, idx) => {
      const tr = ln.trim();
      if (inBlock) { if (tr.includes("*/")) inBlock = false; return; }
      if (tr.startsWith("/*") || tr.startsWith("{/*")) { inBlock = !tr.includes("*/"); return; }
      if (tr.startsWith("//") || tr.startsWith("*")) return;

      const dangTrongThanT = sauT > 0;
      if (sauT > 0) {
        sauT += demNgoacNgoaiChuoi(ln);
        if (++dongTrongT > TRAN_DONG_TRONG_MOT_T) { chamTran++; sauT = 0; }
        else if (sauT <= 0) sauT = 0;
      } else if (MO_T_CO_KHOA.test(ln)) {
        const d = demNgoacNgoaiChuoi(ln);
        if (d > 0) { sauT = d; dongTrongT = 0; }
      }
      const khoaODongTruoc = KHAI_KHOA.test(dongMaTruoc);
      dongMaTruoc = ln;

      if (!CHU_VIET.test(ln)) return;
      if (dangTrongThanT && !LA_THUOC_TINH_OBJECT.test(ln)) return;
      if (khoaODongTruoc && CHI_LA_CAP_THUOC_TINH.test(ln)) return;
      if (/>[^<>{}]*[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ][^<>{}]*</i.test(ln)) return;
      if (/\b(placeholder|title|label|aria-label|description|alt|tooltip)\s*=\s*["'`][^"'`]*[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(ln)) return;
      if (LA_KHUON_DUNG(ln)) return;
      if (coCapNgonNgu && /\b[a-zA-Z]+Vi\s*:/.test(ln)) return;
      // Gỡ thân `t(...)` thay vì bỏ qua cả dòng — xem docblock `goBoTCalls`.
      const sach = boCommentCuoiDong(goBoTCalls(ln));
      if (!CHU_VIET.test(sach)) return;
      const chuoi = sach.match(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g);
      if (chuoi?.some((s) => CHU_VIET.test(s))) {
        n++;
        if (chiTiet) dong.push({ file: file.replace(clientSrc, "").split("\\").join("/"), line: idx + 1, text: tr });
      }
    });
    if (n) { byFile.push([file.replace(clientSrc, ""), n]); total += n; }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile, chamTran, dong };
}

// Chạy trực tiếp: in bảng.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("viStringScan.mjs")) {
  const { total, byFile, chamTran } = demHinhDangBa();
  console.log(`TỔNG ${total} trên ${byFile.length} file · chạm trần: ${chamTran}`);
  byFile.slice(0, 25).forEach(([f, n]) => console.log(String(n).padStart(4), f.split("\\").join("/")));
}
