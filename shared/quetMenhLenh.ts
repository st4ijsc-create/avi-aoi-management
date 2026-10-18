/**
 * Bộ QUÉT MỆNH LỆNH (prompt-injection / jailbreak) — THUẦN, KHÔNG import gì, không env/đĩa/mạng, không ném.
 *
 * Tách NGUYÊN VĂN khỏi `server/services/ai/aiSafety.ts` (2026-10-17) để extension VSCode quét kết quả tool bằng CÙNG mẫu
 * với máy chủ mà không gộp cả lớp che bí mật/rào dữ liệu của máy chủ vào bundle (chính sách phân bậc "nội dung đáng
 * ngờ": bộ thực thi nào cũng phải tự nhận ra để hạ tự trị). `aiSafety.ts` nhập lại và XUẤT LẠI — mọi người gọi cũ
 * không đổi; lưới `aiSafety*.test.ts` canh hành vi.
 */

export type InjectionRisk = "none" | "low" | "high";

export interface InjectionScanResult {
  risk: InjectionRisk;
  /** Machine-readable labels of the patterns that matched (empty when risk === "none"). */
  matched: string[];
}

// ─── Injection / jailbreak scan (INPUT) ────────────────────────
//
// Anchored to concrete attack verb+noun combinations so generic manufacturing vocabulary
// ("ignore the old alarm", "so sánh với tuần trước", "bỏ qua bước kiểm tra cũ") never lands
// in HIGH. HIGH = a clear attempt to override/exfiltrate instructions. LOW = a weaker signal
// (bare "system prompt" mention, generic "act as a ..." roleplay) worth flagging but common
// enough in legitimate use (translator/reviewer roleplay, asking what the assistant can do)
// that it must never hard-block by default.

interface LabeledPattern {
  label: string;
  re: RegExp;
}

const INJECTION_HIGH: LabeledPattern[] = [
  { label: "ignore_instructions", re: /\bignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)\b/i },
  { label: "disregard_system_prompt", re: /\bdisregard\s+(the\s+)?(system\s+)?(prompt|instructions?|rules?)\b/i },
  { label: "forget_instructions", re: /\bforget\s+(your\s+|my\s+|the\s+)?(all\s+|any\s+)?(previous|prior|earlier)\s+(instructions?|rules?)\b/i },
  { label: "reveal_system_prompt", re: /\b(reveal|show\s+me|print|output|repeat)\s+(your\s+)?(the\s+)?(system\s+)?prompt\b/i },
  { label: "reveal_instructions", re: /\bwhat\s+(is|are)\s+your\s+(system\s+)?(instructions?|rules?)\b/i },
  { label: "role_hijack", re: /\byou\s+are\s+now\s+[a-z0-9]/i },
  { label: "unrestricted_persona", re: /\b(act\s+as|become)\s+(an?\s+)?(unrestricted|jailbroken|uncensored)\b/i },
  { label: "dan_jailbreak", re: /\bDAN\b[^.]{0,20}\b(mode|jailbreak)\b/i },
  { label: "exfiltrate_secret", re: /\b(exfiltrate|leak)\s+(the\s+)?(api[\s_-]?key|secret|credentials?|password)\b/i },
  // Vietnamese: "bỏ qua [tất cả/mọi] các hướng dẫn/chỉ thị/lệnh [trước/trên/hệ thống]"
  { label: "vi_ignore_instructions", re: /\bbỏ\s*qua\s+(mọi\s+|tất\s*cả\s+)?(các\s+)?(hướng\s*dẫn|chỉ\s*thị|lệnh)\s*(trước|trên|hệ\s*thống)?/i },
  { label: "vi_reveal_system_prompt", re: /\btiết\s*lộ\s+(prompt|hướng\s*dẫn)\s*hệ\s*thống/i },
];

const INJECTION_LOW: LabeledPattern[] = [
  { label: "system_prompt_mention", re: /\bsystem\s+prompt\b/i },
  { label: "roleplay_pretend", re: /\bpretend\s+(to\s+be|you\s+are)\b/i },
  { label: "roleplay_act_as", re: /\bact\s+as\s+(a|an)\b/i },
  { label: "jailbreak_mention", re: /\bjailbreak\b/i },
  { label: "bypass_rules", re: /\bbypass\s+(your\s+)?(restrictions?|rules?|filters?)\b/i },
];

/**
 * Heuristic prompt-injection / jailbreak scan. PURE. Returns 'high' when a clear
 * override/exfiltration attempt is matched, 'low' for a weaker signal only, else 'none'.
 */
export function scanForInjection(text: string): InjectionScanResult {
  if (!text || typeof text !== "string") return { risk: "none", matched: [] };

  const highMatched = INJECTION_HIGH.filter((p) => p.re.test(text)).map((p) => p.label);
  if (highMatched.length > 0) return { risk: "high", matched: highMatched };

  const lowMatched = INJECTION_LOW.filter((p) => p.re.test(text)).map((p) => p.label);
  if (lowMatched.length > 0) return { risk: "low", matched: lowMatched };

  return { risk: "none", matched: [] };
}

// ─── G2-C — LỚP "DỮ LIỆU KHÔNG TIN CẬY" (tool result · chunk RAG · corpus Studio) ──
//
// ⚠⚠ VÌ SAO PHẢI CÓ MỘT DANH SÁCH THỨ HAI, THAY VÌ NỚI `INJECTION_HIGH`.
// `scanForInjection` chạy trên **câu hỏi của chính người dùng** và cả file này đã ghi rõ vì sao
// biên của nó phải HẸP: một vận hành viên nói *"bỏ qua chỉ dẫn cũ trong SOP"* là câu HỢP LỆ, và
// chặn nhầm nó là chặn người dùng thật. Ở phạm vi **DỮ LIỆU** (một dòng Pareto lỗi, một chunk KB,
// một `textSummary` của tool) câu ấy KHÔNG BAO GIỜ xuất hiện một cách chính đáng — nên cùng một
// chuỗi mang HAI ý nghĩa khác nhau tuỳ nó đến từ đâu. Đó là lý do có hai danh sách chứ không phải
// một danh sách nới rộng: nới `INJECTION_HIGH` sẽ kéo theo đường người dùng và đẻ ra dương tính
// giả ở đúng chỗ file này cố tránh (xem đầu file). `scanUntrustedContent` là **SIÊU TẬP**
// (HIGH ∪ DATA_EXTRA) — canh bằng ca "siêu tập, không phải tập rời" trong `aiSafetyUntrusted.test.ts`.
const INJECTION_DATA_EXTRA: LabeledPattern[] = [
  // "bỏ qua (mọi/tất cả/các) chỉ dẫn|hướng dẫn|nội dung|quy tắc|yêu cầu (ở) trên/trước/phía trên".
  // Khác `vi_ignore_instructions` ở chỗ nhận thêm "chỉ dẫn"/"nội dung"/"quy tắc"/"yêu cầu" — đúng
  // những từ mà một người vận hành CÓ THỂ dùng chính đáng, nên chúng chỉ có mặt ở danh sách DỮ LIỆU.
  {
    label: "vi_ignore_above_data",
    re: /\bb(?:ỏ|o)\s*qua\s+(?:mọi\s+|tất\s*cả\s+|toàn\s*bộ\s+)?(?:các\s+|những\s+)?(?:chỉ\s*dẫn|hướng\s*dẫn|chỉ\s*thị|nội\s*dung|quy\s*tắc|yêu\s*cầu|lệnh)\s*(?:ở\s*)?(?:trên|trước|phía\s*trên|bên\s*trên)/i,
  },
  { label: "en_ignore_above_data", re: /\bignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:text\s+|content\s+|context\s+)?above\b/i },
  /**
   * ★ MỆNH LỆNH GỌI TOOL NẰM TRONG DỮ LIỆU — đây là lớp tấn công mà vòng lặp tự do KHUẾCH ĐẠI.
   * Neo vào **hình dạng định danh snake_case** (`set_machine_param`, `get_top_defects`): ≥1 dấu
   * gạch dưới nối các từ thường. Văn bản sản xuất bình thường ("cần call kỹ thuật viên") không có
   * hình dạng đó, nên mẫu này không cần biết registry vẫn đủ hẹp — và CỐ Ý không đọc registry:
   * module này THUẦN, một cạnh nhập tới `toolRegistry` sẽ kéo theo lượt tự đăng ký tool.
   */
  {
    label: "tool_call_directive",
    re: /(?:\b(?:call|run|execute|invoke|trigger)|g(?:ọ|o)i|ch(?:ạ|a)y|th(?:ự|u)c\s*(?:thi|hi(?:ệ|e)n))\s+(?:the\s+|tool\s+|c(?:ô|o)ng\s*c(?:ụ|u)\s+)?[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i,
  },
  // Dấu VAI hội thoại nhúng trong dữ liệu — không có phiên bản chính đáng nào trong văn bản nhà máy.
  // (Cố ý KHÔNG bắt "System:" đầu dòng: một `textSummary` trạng thái máy nói "System: online" là thật.)
  { label: "role_marker_injection", re: /(?:<\|\s*(?:im_start|im_end|system|user|assistant)\s*\|>|<<SYS>>|\[\/?INST\])/i },
  { label: "new_instructions_data", re: /\b(?:new\s+instructions?|updated\s+instructions?)\s*[:：]/i },
  { label: "new_instructions_data", re: /(?:chỉ\s*dẫn|hướng\s*dẫn)\s+mới\s*[:：]/i },
];

/**
 * Quét injection cho nội dung **KHÔNG do người dùng gõ** (kết quả tool, chunk KB/Studio).
 * Siêu tập của `scanForInjection`: HIGH ∪ DATA_EXTRA → 'high', rồi LOW → 'low', else 'none'.
 * PURE, không ném.
 */
export function scanUntrustedContent(text: string): InjectionScanResult {
  if (!text || typeof text !== "string") return { risk: "none", matched: [] };

  const highMatched = [...INJECTION_HIGH, ...INJECTION_DATA_EXTRA]
    .filter((p) => p.re.test(text))
    .map((p) => p.label);
  // `new_instructions_data` có hai mẫu (vi/en) cùng nhãn — khử trùng để nhãn trả về là TẬP.
  if (highMatched.length > 0) return { risk: "high", matched: [...new Set(highMatched)] };

  const lowMatched = INJECTION_LOW.filter((p) => p.re.test(text)).map((p) => p.label);
  if (lowMatched.length > 0) return { risk: "low", matched: [...new Set(lowMatched)] };

  return { risk: "none", matched: [] };
}
