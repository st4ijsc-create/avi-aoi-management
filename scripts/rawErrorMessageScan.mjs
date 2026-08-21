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

/** Dòng chứa hit + dòng ngay trên nó — nơi hợp lệ để đặt dấu miễn trừ. */
function dongVaTren(src, idx) {
  const truoc = src.slice(0, idx).split("\n");
  const dong = truoc.length;
  const tatCa = src.split("\n");
  return { dong, van: [tatCa[dong - 2] ?? "", tatCa[dong - 1] ?? ""].join("\n") };
}

/** @returns {{file:string,dong:number,cau:string}[]} mọi chỗ còn là NỢ. */
export function demRawMessage(goc = "client/src") {
  const no = [];
  for (const file of duyetFile(goc)) {
    const rel = file.split("\\").join("/");
    if (MIEN_TRU_FILE.some((re) => re.test(rel))) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(CHAM_MESSAGE)) {
      const cau = cauChua(src, m.index);
      if (KHONG_PHAI_NO.some((re) => re.test(cau))) continue;
      const { dong, van } = dongVaTren(src, m.index);
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
