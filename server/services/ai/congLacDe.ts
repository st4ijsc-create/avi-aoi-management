/**
 * ★ PDCA trợ lý vận hành vòng 5 (2026-09-24) — CỔNG CÂU LẠC ĐỀ CÙNG MIỀN.
 *
 * Câu "Máy gắp đặt báo lỗi nozzle hút không lên thì xử lý thế nào?" (tài liệu KHÔNG có) được trả lời bằng cách kéo hướng dẫn
 * AOI sang máy khác (N19, lặp 3/3). Điểm truy hồi KHÔNG tách được câu lạc đề cùng miền (vòng 1–2: không ngưỡng cosine /
 * reranker nào làm được). Hai tín hiệu yếu, ghép lại (đo trên 111 câu huấn luyện, xác nhận trên 24 câu GIỮ LẠI viết trước):
 *   1. ĐỘ PHỦ từ nội dung của câu hỏi (trọng số IDF) trong các đoạn sẽ đưa cho model — rẻ, không gọi model. Một mình thì
 *      KHÔNG đủ: câu tiếng Việt hỏi tài liệu tiếng Anh ("góc thấm ướt" ↔ "Wetting angle") có độ phủ thấp như câu lạc đề.
 *   2. TỰ KIỂM bằng model (tắt nghĩ): "đoạn trích có trả lời TRỰC TIẾP câu hỏi không?" — 0/32 câu lạc đề nói CO, nhưng một
 *      mình lại chặn 19/79 câu có tài liệu.
 *   ⇒ Chặn CHỈ KHI độ phủ < NGUONG_PHU VÀ tự kiểm nói KHONG. Tự kiểm chỉ chạy khi độ phủ thấp (≈ 15–25 % lượt).
 * Module này là phần THUẦN (tách từ, IDF, độ phủ, đọc kết quả tự kiểm); lời gọi model nằm ở service.
 */

export const NGUONG_PHU = 0.6;

/** Từ chức năng + từ chung của miền — không mang nội dung phân biệt câu hỏi. */
const TU_DUNG = new Set(
  "là và của có không thì được bao nhiêu nào gì thế như sao khi phải cần cho các một những với này đó để từ trong ra vào lên hay hoặc bị đã sẽ đang ai ở đâu mấy lần thường theo trên dưới về rồi xử lý máy lỗi".split(" ").concat(
    // ★ Vòng 9 — độ phủ còn đo trên BẢN DỊCH tiếng Anh của câu hỏi (`ai/dichTruyVan.ts`): từ chức năng tiếng Anh.
    "the a an is are was were be been of to in on at for by with from and or not no do does did how what which when where who why many much often long often can should must will would this that these those it its there".split(" "),
  ),
);

export function tachTu(s: string): string[] {
  return String(s ?? "").toLowerCase().normalize("NFC").match(/[\p{L}\p{N}_]+/gu) ?? [];
}

export interface BangIdf {
  readonly n: number;
  readonly df: ReadonlyMap<string, number>;
}

export function taoBangIdf(vanBan: Iterable<string>): BangIdf {
  const df = new Map<string, number>();
  let n = 0;
  for (const t of vanBan) {
    n++;
    for (const w of new Set(tachTu(t))) df.set(w, (df.get(w) ?? 0) + 1);
  }
  return { n, df };
}

const idf = (b: BangIdf, w: string) => Math.log((b.n + 1) / ((b.df.get(w) ?? 0) + 1));

/** Tỉ lệ (theo IDF) từ nội dung của câu hỏi có mặt trong các đoạn. Không có từ nội dung ⇒ 1 (không đủ căn cứ để chặn). */
export function doPhuTu(cauHoi: string, doan: readonly string[], bang: BangIdf): number {
  const tu = [...new Set(tachTu(cauHoi))].filter((t) => t.length > 1 && !TU_DUNG.has(t));
  if (!tu.length) return 1;
  const co = new Set(doan.flatMap((d) => tachTu(d)));
  const tong = tu.reduce((s, t) => s + idf(bang, t), 0);
  if (tong <= 0) return 1;
  return tu.filter((t) => co.has(t)).reduce((s, t) => s + idf(bang, t), 0) / tong;
}

export const canTuKiem = (phu: number): boolean => Number.isFinite(phu) && phu < NGUONG_PHU;

/** Đọc câu trả lời một từ của tự kiểm. Mơ hồ/rỗng ⇒ `true` (KHÔNG chặn — nghi ngờ thì để đường trả lời cũ quyết). */
export function tuKiemCo(traLoi: string | null | undefined): boolean {
  const t = String(traLoi ?? "").trim().toUpperCase();
  if (/^KH[OÔ]NG/.test(t)) return false;
  return true;
}

export function lenhTuKiem(cauHoi: string, doan: readonly string[]): { he: string; nd: string } {
  const ngCanh = doan.map((d, i) => `[${i + 1}] ${String(d).slice(0, 1200)}`).join("\n\n");
  return {
    he: "Bạn là bộ kiểm tra. Chỉ trả lời đúng MỘT từ: CO hoặc KHONG.",
    nd: `Các đoạn trích:\n${ngCanh}\n\nCâu hỏi: ${cauHoi}\n\nCác đoạn trích trên có chứa thông tin trả lời TRỰC TIẾP câu hỏi này (đúng đối tượng, đúng loại máy/thiết bị được hỏi) không? Trả lời CO hoặc KHONG.`,
  };
}

export const congLacDeBat = (): boolean => process.env.AI_KB_CONG_LAC_DE !== "0";
