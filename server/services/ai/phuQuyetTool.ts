/**
 * phuQuyetTool.ts — ★ B6 (2026-09-23): **HYBRID "PHỦ QUYẾT"** cho bộ chọn tool chế độ lập trình. Vị từ THUẦN.
 *
 * ─── VÌ SAO ────────────────────────────────────────────────────────────────────────────────────
 * Đo trên cùng thước (`scripts/ai-eval/toolcall-coding-*.json`, `eval-toolcall.mjs --coding`):
 *   · heuristic tất định (`classifyCodingToolIntent`, 3 ms) giỏi LỆNH và THAM SỐ nhưng trượt đúng lớp G11/G13: câu HỎI hay
 *     yêu cầu VIẾT MỚI mà chỉ NHẮC tên một lệnh/tệp/thư mục vẫn bị gọi tool (cặp đối kháng 1/4, held-out 0/2);
 *   · tool-calling gốc của model (5 tool, nghĩ TẮT, ~0,7 s/ca) phân biệt tốt "nhắc" với "yêu cầu" nhưng thỉnh thoảng không
 *     chịu chạy lệnh (held-out HC3) và làm mất tính TẤT ĐỊNH của cổng "đọc server/routers.ts PHẢI gọi read_file".
 * ⇒ Kết hợp mà KHÔNG trao thêm quyền cho model: heuristic đề xuất như cũ; CHỈ khi câu mang **tín hiệu yếu** (dạng câu hỏi,
 *   hoặc yêu cầu VIẾT/TẠO MỚI không phải sửa) thì hỏi model làm ý kiến thứ hai; model phải **xác nhận ĐÚNG tool ấy**, nếu
 *   không ⇒ KHÔNG gọi tool. Model KHÔNG BAO GIỜ thêm tool, đổi tool hay đổi tham số — chỉ được nói KHÔNG.
 *
 * ─── RANH GIỚI ─────────────────────────────────────────────────────────────────────────────────
 *   · Tín hiệu mạnh (câu mệnh lệnh không dấu hỏi, không từ hỏi, không "viết mới") ⇒ KHÔNG gọi model (0 ms thêm, tất định).
 *   · Model vắng/lỗi/quá hạn ⇒ GIỮ đề xuất heuristic (hành vi cũ) — một lớp phủ quyết hỏng không được làm hỏng đường cũ.
 *   · Không áp cho ý định GHI (sửa/tạo tệp): các dòng ấy có HITL riêng và cần tool đọc của chính chúng (bên gọi lo).
 */

/** Lý do một câu bị coi là tín hiệu YẾU (để nhật ký nói được vì sao model được hỏi). */
export type LyDoYeu = "dau-hoi" | "tu-hoi" | "viet-moi";

function boDau(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Từ hỏi / giải thích / so sánh — tiếng Việt không dấu. */
const TU_HOI_VI =
  /(^|[^a-z])(giai thich|la gi|lam gi|the nao|nhu the nao|lam sao|tai sao|vi sao|co nen|nen dung|nen lam|nen to chuc|nen chon|khac nhau|so sanh|y nghia|co tac dung)([^a-z]|$)/;
/** Từ hỏi / giải thích / so sánh — tiếng Anh. */
const TU_HOI_EN =
  /\b(explain|what is|what's|what does|what are|why|how do|how does|how should|how can|how to|should i|difference|compare|meaning of)\b/i;
/** Động từ VIẾT/TẠO MỚI. */
const VIET_MOI_VI = /(^|[^a-z])(viet|tao|sinh|soan)([^a-z]|$)/;
const VIET_MOI_EN = /\b(write|create|generate|scaffold)\b/i;
/** Động từ SỬA/THÊM VÀO tệp có sẵn — thắng "viết" (vd "viết thêm hàm X vào tệp Y" là SỬA). */
const SUA_VI = /(^|[^a-z])(sua|chinh sua|tai cau truc|refactor|doi ten|cap nhat|them [^.?!]{0,40} vao)([^a-z]|$)/;
const SUA_EN = /\b(fix|refactor|rename|update|modify|edit|add [^.?!]{0,40} to)\b/i;

/**
 * `null` ⇔ tín hiệu MẠNH (giữ heuristic, không hỏi model). Ngược lại trả lý do đầu tiên khớp. Hàm THUẦN.
 * Thứ tự kiểm: dấu hỏi → từ hỏi → viết mới (không phải sửa).
 */
export function tinHieuYeu(question: string): LyDoYeu | null {
  const q = String(question ?? "").trim();
  if (q === "") return null;
  if (/[?？]\s*$/.test(q)) return "dau-hoi";
  const k = boDau(q);
  if (TU_HOI_VI.test(k) || TU_HOI_EN.test(q)) return "tu-hoi";
  const sua = SUA_VI.test(k) || SUA_EN.test(q);
  if (!sua && (VIET_MOI_VI.test(k) || VIET_MOI_EN.test(q))) return "viet-moi";
  return null;
}

/** Tối thiểu của một quyết định chọn tool (khớp `ToolDecision` của intentClassifier). */
export interface QuyetDinhTool {
  tool: string | null;
  args: Record<string, unknown>;
  reason: string;
}

/**
 * Kết hợp heuristic với ý kiến thứ hai của model. Hàm THUẦN.
 * @param heuristic quyết định của `classifyCodingToolIntent`
 * @param ykienModel tool model chọn (`null` = model nói "không gọi tool"); `undefined` = KHÔNG hỏi được (vắng/lỗi/quá hạn)
 * @param lyDo      kết quả `tinHieuYeu` — `null` ⇒ không phủ quyết
 */
export function ketHopPhuQuyet(
  heuristic: QuyetDinhTool,
  ykienModel: string | null | undefined,
  lyDo: LyDoYeu | null,
): QuyetDinhTool {
  if (heuristic.tool === null || lyDo === null) return heuristic;
  if (ykienModel === undefined) return heuristic; // lớp phủ quyết hỏng ⇒ hành vi cũ
  if (ykienModel === heuristic.tool) return heuristic; // xác nhận ⇒ giữ tham số của heuristic
  return { tool: null, args: {}, reason: `CODING_VETO_NATIVE:${lyDo}:${heuristic.tool}→${ykienModel ?? "none"}` };
}
