/**
 * ★ PDCA trợ lý vận hành — nguyên nhân #4 (2026-09-24): câu hỏi QUY TẮC / ĐỊNH NGHĨA bị tool dữ liệu sống cướp.
 *
 * "Giới hạn kiểm soát SPC được tính thế nào?" chạm trigger tool SPC ⇒ tool rỗng ⇒ người dùng nhận "Chưa đủ dữ liệu yield…"
 * cho một câu hỏi mà tài liệu trả lời được. Không thể cứ thế cho LLM trả lời khi tool rỗng: cổng `emptyToolGate` tồn tại vì
 * model đã đo được BỊA kết luận nhà xưởng từ kết quả rỗng. Bộ phân biệt có sẵn (`looksLikeLiveFactoryDataQuestion`) đo được
 * KHÔNG tách (thả "hôm nay có lỗi NG nào không").
 *
 * Vị từ này THẬN TRỌNG theo một chiều: `true` CHỈ khi có dấu hiệu câu hỏi quy tắc VÀ KHÔNG có bất kỳ dấu hiệu số liệu sống
 * nào (mốc thời gian, "đang", mã máy/line/lô/điểm đo cụ thể, lệnh "xem/liệt kê/xu hướng"). Nghi ngờ ⇒ `false` (đường cũ).
 * Yêu cầu an toàn đo trên tập nhãn viết TRƯỚC (`scripts/ai-eval/cau-quy-tac-vs-song*.jsonl`): 0 câu số liệu sống bị xếp quy tắc.
 *
 * ⚠ KHÔNG dùng `\b` với chữ Việt: `\b` của JS coi "ì", "đ", "ư"… là ký tự KHÔNG-từ, nên /\bthì\b/ và /\bđang\b/ KHÔNG BAO GIỜ
 *   khớp (đo được ở bản đầu: câu quy tắc trượt vì "thì"/"định nghĩa", và dấu hiệu sống "đang" chết im lặng — an toàn khi ấy
 *   chỉ nhờ may). Biên từ ở đây là biên Unicode (?<![\p{L}\p{N}_]) … (?![\p{L}\p{N}_]).
 * Module THUẦN.
 */
const tu = (alt: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alt})(?![\\p{L}\\p{N}_])`, "iu");

/** Dấu hiệu SỐ LIỆU SỐNG — có một cái là KHÔNG phải câu quy tắc. */
const DAU_HIEU_SONG: readonly RegExp[] = [
  tu("hôm nay|hôm qua|hôm kia|sáng nay|chiều nay|tối nay|đêm nay|ca này|ca sáng|ca chiều|ca đêm|tuần này|tuần trước|tháng này|tháng trước|năm nay"),
  tu("hiện tại|hiện giờ|hiện nay|bây giờ|lúc này|vừa rồi|gần đây|gần nhất|mới nhất|mới đây"),
  tu("\\d+\\s*(?:ngày|giờ|tuần|tháng)\\s*(?:qua|gần|trước)|mấy\\s*(?:ngày|tuần|tháng)\\s*qua"),
  tu("đang"),
  tu("còn\\s+(?:chạy|hoạt động|lỗi)"),
  tu("(?:line|chuyền|dây chuyền)\\s*\\d+"),
  /(?<![\p{L}\p{N}_])[A-Z]{2,}[-_]?\d+[A-Z0-9-]*/u, // AOI-03, PCB-A12, L20260505-001 — CHỮ HOA, không cờ i
  /#\s*\d+/u,
  tu("cho (?:tôi|mình|em) xem|xem giúp|liệt kê|hiển thị|thống kê|xu hướng|trend"),
  tu("(?:của|ở)\\s+(?:máy|lô|sản phẩm|line)\\s+\\S*\\d"),
  tu("(?:có|bao nhiêu)\\s+\\S+(?:\\s+\\S+)?\\s+nào\\s+(?:vượt|đang|bị|dưới|trên)"),
];

/** Dấu hiệu câu hỏi QUY TẮC / ĐỊNH NGHĨA / THỦ TỤC. */
const DAU_HIEU_QUY_TAC: readonly RegExp[] = [
  tu("thì"),
  tu("được tính|tính (?:thế|như thế) nào|công thức|định nghĩa|viết tắt|dùng để"),
  tu("mặc định|ngưỡng|mục tiêu|quy tắc|quy trình|tiêu chí|phân loại|được coi là|được đặt|được cấu hình"),
  tu("vai trò nào|ai có quyền|ai được"),
  /(?<![\p{L}\p{N}_])có (?:được|cần|bắt buộc|phải)(?![\p{L}\p{N}_])[\s\S]*(?<![\p{L}\p{N}_])không(?![\p{L}\p{N}_])/iu,
  tu("vì sao|tại sao|là gì|nghĩa là"),
  /(?<![\p{L}\p{N}_])khác(?![\p{L}\p{N}_])[\s\S]+(?:thế|như thế) nào/iu,
  tu("menu nào|ở đâu|những trạng thái|những thành phần|bao lâu một lần|khi nào"),
  tu("nên|phải"),
];

/** `true` ⇔ chắc là câu hỏi quy tắc/định nghĩa (tài liệu trả lời), KHÔNG hỏi số liệu sống. Nghi ngờ ⇒ `false`. */
export function laCauHoiQuyTac(question: string): boolean {
  const q = String(question ?? "").trim();
  if (!q) return false;
  if (DAU_HIEU_SONG.some((re) => re.test(q))) return false;
  return DAU_HIEU_QUY_TAC.some((re) => re.test(q));
}

/**
 * Ghép câu trả lời theo TÀI LIỆU với dòng dữ liệu sống RỖNG của tool (tool đứng SAU, như một ghi chú — người dùng vẫn biết
 * hệ thống đã tra số liệu và không có gì). `null` ⇔ không dùng được (model từ chối hoặc rỗng) ⇒ người gọi trả dòng tool như cũ.
 */
export function ghepQuyTacVoiDuLieuSong(traLoiTaiLieu: string | null | undefined, dongTool: string, tuChoi: (s: string) => boolean): string | null {
  const t = (traLoiTaiLieu ?? "").trim();
  if (!t || tuChoi(t)) return null;
  const d = (dongTool ?? "").trim();
  return d ? `${t}\n\n_Dữ liệu sống: ${d}_` : t;
}

/** Chỉ cho lưới: đo từng dấu hiệu SỐNG có còn sống (chống lại đúng lớp lỗi `\b` im lặng ở trên). */
export const __dauHieuSongChoTest = DAU_HIEU_SONG;
