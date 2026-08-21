/**
 * F1 — bộ đếm DÙNG CHUNG cho nợ "hiện `err.message` thô cho người dùng" ở `client/src`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO LÀ MỘT MODULE RIÊNG, KHÔNG PHẢI REGEX CHÉP VÀO TEST
 * ══════════════════════════════════════════════════════════════════════════════════
 * Đợt hình-dạng-3 đã trả giá: bản sao của bộ đếm nằm trong scratchpad **trôi lệch** khỏi
 * bản trong cổng (623 vs 500) và không ai thấy, vì hai bên không bao giờ được so. Từ đó
 * luật là: **một bộ đếm, cổng IMPORT nó**. Script dò và cổng canh phải đếm cùng một thứ,
 * theo đúng nghĩa đen.
 *
 * ── ĐỊNH NGHĨA NỢ ────────────────────────────────────────────────────────────────
 * `mapTrpcError(error)` biến lỗi tRPC thành câu ĐÃ DỊCH theo `appCode` (vi/en/zh).
 * Mọi chỗ đưa `err.message` THÔ tới mắt người dùng là một câu tiếng Anh lọt lưới —
 * đúng thứ 1061 mã lỗi phía máy chủ được dựng ra để loại bỏ.
 *
 * KHÔNG tính là nợ:
 *  • `console.*` — không ai ngoài lập trình viên đọc;
 *  • điều khiển luồng (`.message.includes(...)`) — đọc chuỗi để QUYẾT, không để HIỆN;
 *  • `throw new Error(err.message)` — ném lại, chỗ bắt mới là nơi quyết định hiện gì;
 *  • chính `lib/trpcErrors.ts` — nó LÀ bộ dịch, phải chạm `.message`;
 *  • chỗ có dấu miễn trừ `i18n-raw-ok:` kèm LÝ DO (xem bên dưới).
 *
 * ── VÌ SAO CÓ DẤU MIỄN TRỪ ───────────────────────────────────────────────────────
 * Vài chỗ giữ chuỗi thô là ĐÚNG: `SourceTab.tsx` hiện lý do thật từ máy chủ (vd.
 * *"Unsupported document type: pptx"*) — dịch nó thành câu generic là làm người dùng
 * MẤT thông tin hành-động-được, đúng lớp lỗi F4 đã ghi sổ. Nên miễn trừ phải viết
 * ra kèm lý do, chứ không im lặng bỏ qua bằng cách sửa regex.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Định danh lỗi thường gặp + `<query>.error` / `<query>.error?.` của React Query. */
const CHAM_MESSAGE = /\b(?:[A-Za-z_$][\w$]*\.)?(?:err|error|e|ex)\??\.message\b/g;

/** File LÀ bộ dịch — chạm `.message` ở đây là bắt buộc, không phải nợ. */
const MIEN_TRU_FILE = [/client\/src\/lib\/trpcErrors\.ts$/];

const KHONG_PHAI_NO = [
  /console\s*\.\s*(?:error|warn|log|debug|info|trace)/,
  /\.message\s*\.\s*(?:includes|startsWith|endsWith|match|toLowerCase|toUpperCase|indexOf|search|slice|split|trim|replace)/,
  /(?:includes|startsWith|endsWith|test|match)\s*\([^)]*\.message/,
  /throw\s+new\s+Error/,
];

/** Dấu miễn trừ có chủ ý, PHẢI kèm lý do sau dấu hai chấm. */
export const DAU_MIEN_TRU = /i18n-raw-ok:\s*\S/;

export function duyetFile(goc) {
  const out = [];
  for (const ten of readdirSync(goc)) {
    const day = join(goc, ten);
    if (statSync(day).isDirectory()) out.push(...duyetFile(day));
    else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten)) out.push(day);
  }
  return out;
}

/**
 * Ngữ cảnh CÙNG CÂU LỆNH — lùi tới ranh giới `; { } newline`.
 *
 * ⚠ Cửa sổ theo SỐ DÒNG cố định là một cái bẫy đã trả giá ở
 * `predictiveMaintenanceService.timeframeGuard.test.ts`: cửa sổ 8 dòng nhìn thấy
 * `Number.isFinite` của câu BÊN CẠNH rồi chứng nhận cho câu không hề được canh.
 * Phạm vi câu lệnh không mượn được ngữ cảnh của hàng xóm.
 */
function cauChua(src, idx) {
  let a = idx;
  while (a > 0 && !";{}\n".includes(src[a - 1])) a--;
  let b = idx;
  while (b < src.length && !";{}\n".includes(src[b])) b++;
  return src.slice(a, b);
}

/**
 * Thay mọi COMMENT bằng khoảng trắng cùng độ dài (giữ nguyên offset/số dòng).
 *
 * ⚠ HIỆU CHỈNH NHIỆT KẾ, KHÔNG PHẢI TRẢ NỢ. Mốc 139 đầu tiên đếm cả những comment
 * NÓI VỀ `err.message` — trong đó có đúng các comment cảnh báo *"KHÔNG toast
 * error.message ở đây"* (`Login.tsx`), tức thước đang tố chính lời cảnh báo chống lại
 * món nợ nó đi tìm. Đây là bản sao của bài học `viStringCoverage` (623 vs 619): thước
 * dôi ra vì cách đếm, không vì có nợ. Số giảm nhờ sửa thước phải được nói ra như vậy,
 * nếu không lần sau sẽ có người đọc nó thành "đã sửa được ngần ấy chỗ".
 */
function boComment(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let trangThai = "ma"; // ma | chuoi | mau | dong | khoi
  let dauChuoi = "";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (trangThai === "ma") {
      if (c === "/" && d === "/") { trangThai = "dong"; out += "  "; i += 2; continue; }
      if (c === "/" && d === "*") { trangThai = "khoi"; out += "  "; i += 2; continue; }
      if (c === '"' || c === "'") { trangThai = "chuoi"; dauChuoi = c; out += c; i++; continue; }
      if (c === "`") { trangThai = "mau"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (trangThai === "chuoi" || trangThai === "mau") {
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if ((trangThai === "chuoi" && c === dauChuoi) || (trangThai === "mau" && c === "`")) trangThai = "ma";
      out += c; i++; continue;
    }
    if (trangThai === "dong") {
      if (c === "\n") { trangThai = "ma"; out += c; i++; continue; }
      out += " "; i++; continue;
    }
    // khoi
    if (c === "*" && d === "/") { trangThai = "ma"; out += "  "; i += 2; continue; }
    out += c === "\n" ? c : " ";
    i++;
  }
  return out;
}

/**
 * Dòng chứa hit + TOÀN BỘ khối comment liền kề phía trên — nơi hợp lệ đặt dấu miễn trừ.
 *
 * ⚠ Bản đầu chỉ nhìn ĐÚNG MỘT dòng trên. Một miễn trừ viết bằng chú thích ba dòng (lý do
 * dài thì đương nhiên phải xuống dòng — mà cổng lại BẮT BUỘC có lý do) sẽ không được nhận,
 * vì dòng sát hit là dòng CUỐI của khối chứ không phải dòng mang dấu. Thước phải khớp cách
 * người ta thật sự viết comment, nếu không nó ép người dùng viết lý do một dòng cho vừa
 * thước — tức thước làm hỏng đúng thứ nó đòi hỏi.
 */
function dongVaTren(src, idx) {
  const tatCa = src.split("\n");
  const dong = src.slice(0, idx).split("\n").length;
  const van = [tatCa[dong - 1] ?? ""];
  for (let i = dong - 2; i >= 0; i--) {
    const ln = (tatCa[i] ?? "").trim();
    if (!ln.startsWith("//") && !ln.startsWith("*") && !ln.startsWith("/*") && !ln.startsWith("{/*")) break;
    van.push(tatCa[i]);
  }
  return { dong, van: van.join("\n") };
}

/** @returns {{file:string,dong:number,cau:string}[]} mọi chỗ còn là NỢ. */
export function demRawMessage(goc = "client/src") {
  const no = [];
  for (const file of duyetFile(goc)) {
    const rel = file.split("\\").join("/");
    if (MIEN_TRU_FILE.some((re) => re.test(rel))) continue;
    const goc = readFileSync(file, "utf8");
    // Quét trên bản ĐÃ BỎ COMMENT (giữ nguyên offset) — nhưng dấu miễn trừ thì tra trên
    // bản GỐC, vì bản thân dấu miễn trừ LÀ một comment.
    const src = boComment(goc);
    for (const m of src.matchAll(CHAM_MESSAGE)) {
      const cau = cauChua(src, m.index);
      if (KHONG_PHAI_NO.some((re) => re.test(cau))) continue;
      const { dong, van } = dongVaTren(goc, m.index);
      if (DAU_MIEN_TRU.test(van)) continue;
      no.push({ file: rel, dong, cau: cau.replace(/\s+/g, " ").trim().slice(0, 160) });
    }
  }
  return no;
}

// ⚠ `file://${argv[1]}` KHÔNG khớp trên Windows: `pathToFileURL` sinh `file:///D:/...`
// (ba gạch) còn phép nối tay ra `file://D:/...` (hai gạch) ⇒ script im lặng không chạy
// gì, mà im lặng thì trông y hệt "không có nợ nào". Cùng lớp lỗi với glob rỗng ở Pha 4.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const no = demRawMessage(process.argv[2] ?? "client/src");
  const theoFile = new Map();
  for (const r of no) theoFile.set(r.file, (theoFile.get(r.file) ?? 0) + 1);
  console.log(`TỔNG NỢ: ${no.length} chỗ / ${theoFile.size} file\n`);
  for (const [f, n] of [...theoFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(3)}  ${f}`);
  }
}
