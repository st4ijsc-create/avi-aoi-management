/**
 * ★ PDCA trợ lý vận hành (2026-09-24) — CÂU HỎI LẠI ("máy nào? / lô nào?") PHẢI NHƯỜNG TÀI LIỆU.
 *
 * Đo đầu–cuối 111 câu ST4I (`scripts/ai-eval/kb-dau-cuoi.mjs`, nền `kb-dau-cuoi-nen-0924`): **18/79 câu có đáp án trong
 * tài liệu** bị trả về câu hỏi lại cứng *"Bạn muốn xem trạng thái máy nào…"* trong < 1 s, KHÔNG qua truy hồi-trả lời.
 * Nguyên nhân: `buildClarifyMessage("NO_TRIGGER_MATCH")` bắn khi câu không khớp tool nào mà có chữ "máy/line/thiết bị/lô"
 * — tức MỌI câu hỏi quy trình về máy ("Khi chạy board chuẩn để kiểm tra máy thì được phép bao nhiêu cảnh báo sai?").
 * Ở đường ấy truy hồi vẫn chạy (cho `meta`), độ tin cậy 0,69–0,98, nhưng câu trả lời bị vứt.
 *
 * Luật mới: câu hỏi lại là ĐƯỜNG LUI khi tài liệu không trả lời được, không phải đường CHẶN TRƯỚC.
 *   • độ tin cậy truy hồi < `NGUONG_TIN_CAY_DUNG_LLM` (0,30 — CÙNG ngưỡng quyết định có gọi LLM ở `streamAnswer`) ⇒ hỏi
 *     lại như cũ (không có gì để trả lời);
 *   • ≥ ngưỡng ⇒ đi đường trả lời thường; model tự áp luật 2 ("ngữ cảnh không liên quan ⇒ từ chối"). Nếu model TỪ CHỐI,
 *     nối câu hỏi lại vào sau — người dùng vẫn được gợi ý nêu mã máy/lô như trước.
 * Không có ngưỡng mới nào được đặt ở đây: 0,30 là số đang chạy. Module THUẦN.
 */
export const NGUONG_TIN_CAY_DUNG_LLM = 0.3;

const TU_CHOI = /không có thông tin chính xác|don't have accurate information|没有关于此问题的准确信息/i;

/** `true` ⇔ tài liệu đủ liên quan để thử trả lời trước khi hỏi lại. */
export function nhuongChoTaiLieu(doTinCay: unknown): boolean {
  return typeof doTinCay === "number" && Number.isFinite(doTinCay) && doTinCay >= NGUONG_TIN_CAY_DUNG_LLM;
}

/** Phần cần NỐI vào câu trả lời: câu hỏi lại khi model đã từ chối; ngược lại chuỗi rỗng. */
export function phanHoiLaiSauTuChoi(traLoi: string, cauHoiLai: string | null | undefined): string {
  if (!cauHoiLai || !TU_CHOI.test(traLoi ?? "")) return "";
  if (traLoi.includes(cauHoiLai)) return "";
  return `\n\n${cauHoiLai}`;
}
