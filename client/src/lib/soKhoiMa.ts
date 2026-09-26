/**
 * ★★★ 2026-08-23 · LÔ 3 — **SO MỘT KHỐI MÃ MODEL VIẾT VỚI TỆP THẬT TRÊN ĐĨA (tầng 2, tất định).**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TỒN TẠI — ca thật đã đo (buổi đóng vai "người xem lại", 2026-08-23)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hỏi *"Giải thích lớp Calculator"* → văn xuôi model chứa khối mã CÓ SẴN `if (b == 0) throw…`
 * trong khi thẻ bằng chứng "Đọc tệp trong repo" ngay dưới cho thấy tệp thật CHƯA có guard ấy (bug
 * còn nguyên). Hai khối mâu thuẫn trong MỘT câu trả lời; người xem lại không tinh kết luận "đã sửa
 * rồi". Module này cho giao diện một phép đối chiếu TẤT ĐỊNH giữa khối và tệp — để cái mâu thuẫn
 * ấy được GỌI TÊN thay vì bắt người đọc tự bắt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ NGUYÊN LÝ BẤT DI DỊCH: **KHÔNG phân biệt được "model trích dẫn" với "model đề xuất mã mới"**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cùng một khối khác-với-đĩa có thể là một bản vá hợp lệ (model ĐỀ XUẤT thêm guard) hoặc một trích
 * dẫn sai (model khai đây là mã HIỆN TẠI). Vậy phép so KHÔNG được phán "đúng/sai" — nó chỉ nói
 * quan hệ đo được với đĩa: `khop` · `khac` · `khong-du-can-cu`. Câu chữ hiển thị (và việc "khác"
 * nghĩa là gì) thuộc về tầng nhãn (`KhoiMaCoNhan`), không thuộc về đây.
 *
 * ⚠ THUẦN — 0 import, không chạm DOM/DB. Lưới + đột biến đo thẳng (`soKhoiMa.unit.test.ts`).
 */

/** Ba kết cục của phép so — và CHỈ ba. `khong-du-can-cu` nghĩa là IM LẶNG tuyệt đối ở tầng nhãn. */
export type KetCucSoKhoi = "khop" | "khac" | "khong-du-can-cu";

/**
 * ★ Ngưỡng "khối đủ lớn để mang BĂNG NHÃN" (tầng 1). Dưới ngưỡng: chỉ viền nhạt + tooltip — một
 * băng chữ trên mỗi khối `x + 1` hai dòng là nhiễu, và nhiễu làm người ta thôi đọc nhãn thật.
 * Đếm theo DÒNG THÔ của khối như người dùng nhìn thấy (không phải dòng đã chuẩn hoá).
 */
export const NGUONG_DONG_BANG_NHAN = 4;

/**
 * ★ Sàn số dòng CHUẨN tối thiểu để phép so được phép nói. Một khối 1–2 dòng chuẩn (`return null;`…)
 * xuất hiện ở khắp nơi — "khớp" của nó không chứng minh gì, "khác" của nó cũng vậy ⇒ im lặng.
 */
export const SAN_DONG_CHUAN_DE_SO = 3;

/**
 * Chuẩn hoá một văn bản mã thành danh sách DÒNG CHUẨN để so:
 *   • CRLF → LF (tệp trên đĩa Windows là CRLF, khối trong markdown là LF — lệch EOL không phải
 *     lệch mã);
 *   • trim từng dòng (thụt đầu dòng khác nhau không phải lệch mã);
 *   • BỎ dòng trống và dòng chỉ gồm ngoặc/dấu `{ } ( ) ; ,` — chúng là "chất kết dính" cú pháp,
 *     trùng nhau giữa mọi tệp cùng ngôn ngữ nên chỉ tạo khớp giả.
 */
export function chuanHoaDongMa(vanBan: string): string[] {
  const ra: string[] = [];
  for (const dongTho of vanBan.split("\n")) {
    const dong = dongTho.replace(/\r$/, "").trim();
    if (dong === "") continue;
    if (/^[{}();,]+$/.test(dong.replace(/\s+/g, ""))) continue;
    ra.push(dong);
  }
  return ra;
}

/**
 * ★★★ SO MỘT KHỐI VỚI MỘT TỆP — theo TẬP DÒNG CHUẨN, chắc mới nói.
 *
 *   • `tep.biCat === true` ⇒ **luôn** `khong-du-can-cu`, đứng TRƯỚC mọi phép so. Một bản đọc bị
 *     cắt (trần 64 KB) không chứng minh được "khác": dòng của khối có thể nằm đúng ở phần chưa
 *     đọc. Đây là lớp lỗi *"khẳng định TOÀN THỂ từ phép đo BỘ PHẬN"* — đã bị một lượt đột biến
 *     bắt quả tang trong repo này (`nhanXetChiThayDinhNghia`/GREP_DEADLINE cùng lập trường).
 *   • khối < `SAN_DONG_CHUAN_DE_SO` dòng chuẩn ⇒ `khong-du-can-cu` (khối quá nhỏ, khớp giả rẻ).
 *   • MỌI dòng chuẩn của khối đều có trong tập dòng chuẩn của tệp ⇒ `khop`.
 *   • Có ≥1 dòng CÓ trong tệp VÀ ≥1 dòng KHÔNG có ⇒ `khac`.
 *   • 0 dòng chung (mã hoàn toàn mới — có thể là đề xuất hợp lệ cho một tệp khác/tệp mới) ⇒
 *     `khong-du-can-cu`.
 *
 * ⚠ So theo TẬP (mỗi-dòng-có-mặt), KHÔNG so theo thứ tự/liền kề: mục tiêu là bắt "model chèn một
 *   dòng KHÔNG có trên đĩa rồi khai là mã hiện tại", không phải diff chính xác — diff thật đã có
 *   ở thẻ duyệt. Hệ quả được chấp nhận: một khối xáo thứ tự dòng thật vẫn ra `khop`.
 */
export function soKhoiVoiTep(khoi: string, tep: { noiDung: string; biCat: boolean }): KetCucSoKhoi {
  if (tep.biCat) return "khong-du-can-cu";
  const dongKhoi = chuanHoaDongMa(khoi);
  if (dongKhoi.length < SAN_DONG_CHUAN_DE_SO) return "khong-du-can-cu";
  const tapTep = new Set(chuanHoaDongMa(tep.noiDung));
  let co = 0;
  for (const d of dongKhoi) if (tapTep.has(d)) co++;
  if (co === dongKhoi.length) return "khop";
  if (co > 0) return "khac";
  return "khong-du-can-cu";
}

/**
 * ★ BẢNG đuôi-tệp ↔ nhãn fence — DANH SÁCH TRẮNG nhỏ, vắng mặt ⇒ KHÔNG so (im lặng, không đoán).
 * Chỉ những cặp chắc chắn; một cặp thiếu làm mất một chip, một cặp SAI làm chip nói dối — bất đối
 * xứng ấy quyết định bảng này hẹp.
 */
const NGON_NGU_THEO_DUOI: Readonly<Record<string, readonly string[]>> = {
  cs: ["csharp", "cs", "c#"],
  ts: ["typescript", "ts"],
  tsx: ["typescript", "tsx", "ts"],
  js: ["javascript", "js"],
  jsx: ["javascript", "jsx", "js"],
  mjs: ["javascript", "js"],
  cjs: ["javascript", "js"],
  py: ["python", "py"],
  json: ["json", "jsonc"],
  sql: ["sql"],
  css: ["css"],
  html: ["html", "htm"],
  md: ["markdown", "md"],
  sh: ["bash", "sh", "shell"],
  yml: ["yaml", "yml"],
  yaml: ["yaml", "yml"],
  xml: ["xml"],
  // PLC structured text — workspace lập trình của repo có tệp .st thật (main.st).
  st: ["st", "iecst", "structured-text"],
};

/**
 * Neo khối↔tệp có HỢP LỆ về ngôn ngữ không: nhãn fence của khối phải khớp đuôi tệp của thẻ đọc.
 * Fence không nhãn (đầu ra lệnh, ```text) hay đuôi lạ ⇒ `false` ⇒ tầng nhãn không so, không chip.
 */
export function neoKhopNgonNgu(nhanFence: string | null | undefined, duongDanTep: string): boolean {
  if (!nhanFence) return false;
  const duoi = /\.([A-Za-z0-9#]+)$/.exec(duongDanTep)?.[1]?.toLowerCase();
  if (!duoi) return false;
  const nhan = NGON_NGU_THEO_DUOI[duoi];
  return nhan !== undefined && nhan.includes(nhanFence.toLowerCase());
}

/** Neo đối chiếu: MỘT bản đọc tệp thật mà client đang giữ (đường dẫn + nội dung + cờ "bản cắt"). */
export interface NeoDocTep {
  duongDan: string;
  noiDung: string;
  /** true ⇔ bản đọc KHÔNG trọn vẹn (bị cắt theo trần byte HOẶC đã bị che bí mật) ⇒ không đủ căn cứ. */
  biCat: boolean;
}

/**
 * ★ Bóc NEO từ `data` của một thẻ tool `read_file`/`read_project_file` — hình dạng ĐO TRÊN SERVER:
 *   • `repoReadTools.read_file`      → `{ path, bytes, truncated, redacted, content }`
 *   • `readToolsProgramming` (P2)    → `{ path, bytes, truncated, content }` (không có `redacted`)
 * Trả `null` cho MỌI hình dạng khác — kể cả thẻ tổng `{ files: [...] }` mà đường sinh-mã phát
 * (`aiLocalKnowledgeService.streamCodingGenerate`): thẻ ấy KHÔNG mang nội dung, nên tầng 2 với nó
 * là `khong-du-can-cu` theo cấu tạo — đây là GIỚI HạN đã khai của cả lô, không phải một lỗi.
 *
 * ⚠ `redacted === true` cũng quy về `biCat`: nội dung đã bị che bí mật KHÔNG còn là byte trên đĩa,
 *   so trên nó là so trên một vật đã bị thiết bị đo sửa — cùng lớp lỗi với bản cắt.
 */
export function bocTheDocTep(data: unknown): NeoDocTep | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { path?: unknown; content?: unknown; truncated?: unknown; redacted?: unknown };
  if (typeof d.path !== "string" || d.path === "") return null;
  if (typeof d.content !== "string") return null;
  if (typeof d.truncated !== "boolean") return null;
  return {
    duongDan: d.path,
    noiDung: d.content,
    biCat: d.truncated === true || d.redacted === true,
  };
}

/**
 * ★ Thẻ tool này có phải MỘT LƯỢT ĐỌC TỪ ĐĨA không (để gắn chip bằng chứng tầng 1)?
 * Hai hình dạng thật: bản đọc MỘT tệp (như `bocTheDocTep`) và thẻ TỔNG `{ files: [{path,…}] }`
 * của đường sinh-mã — cả hai đều là lời khai "byte này đến từ đĩa", nên cả hai đều nhận chip.
 */
export function laKetQuaDocTuDia(data: unknown): boolean {
  if (bocTheDocTep(data) !== null) return true;
  if (!data || typeof data !== "object") return false;
  const files = (data as { files?: unknown }).files;
  return (
    Array.isArray(files) &&
    files.length > 0 &&
    files.every((f) => !!f && typeof f === "object" && typeof (f as { path?: unknown }).path === "string")
  );
}

/**
 * ★★★ NEO CHỈ ÁP CHO CÂU TRẢ LỜI **CÙNG LƯỢT** VỚI THẺ ĐỌC — vị trí của nó trong transcript.
 *
 * Client chỉ giữ MỘT thẻ tool (`streamTool`, bị ghi đè mỗi sự kiện và bị xoá đầu mỗi lượt gửi) —
 * tức "thẻ GẦN NHẤT TRƯỚC khối" của brief thu về: thẻ ấy chỉ đứng trước các khối của **câu trả lời
 * lượt hiện tại**. Câu ấy là phần tử `assistant` ĐẦU TIÊN sau phần tử `user` CUỐI CÙNG (các câu
 * assistant nối sau — đầu ra lệnh của `handleConfirm` — vẫn cùng lượt về thời gian, nhưng khối
 * trong chúng là ĐẦU RA MÁY với fence không nhãn ⇒ tự trượt cổng ngôn ngữ). Mọi câu TRƯỚC đó được
 * sinh khi thẻ hiện tại CHƯA tồn tại ⇒ so chúng với thẻ này là so với một mốc thời gian sai.
 * Không có `user` nào / sau `user` cuối không phải `assistant` ⇒ `null` (không neo).
 */
export function viTriCauTraLoiCungLuot(luot: ReadonlyArray<{ role: string }>): number | null {
  let cuoiUser = -1;
  for (let i = luot.length - 1; i >= 0; i--) {
    if (luot[i]!.role === "user") {
      cuoiUser = i;
      break;
    }
  }
  if (cuoiUser < 0) return null;
  const sau = cuoiUser + 1;
  return sau < luot.length && luot[sau]!.role === "assistant" ? sau : null;
}

/**
 * Định dạng MỐC-NHẬN cho chip (`HH:MM:SS`, 24 giờ, giờ máy người xem). Đây là lúc client NHẬN sự
 * kiện tool qua SSE, KHÔNG phải lúc server đọc đĩa — payload thẻ đọc không mang timestamp, và lô
 * này cấm đổi server để cõng thêm dữ liệu. Hai mốc lệch nhau mili-giây trên LAN; ghi rõ để không
 * ai đọc nó thành mốc-đọc.
 */
export function dinhDangLucNhan(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
