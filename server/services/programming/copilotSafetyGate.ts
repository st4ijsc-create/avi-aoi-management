/**
 * Doc 80 · Task 10 · D4 (AI-03 / AI-13 / AI-17) — CỔNG AN TOÀN CỦA COPILOT LẬP TRÌNH. MỘT MODULE.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ MODULE NÀY (phụ lục A §1, cánh A — đo trên server sản phẩm 2026-09-25)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Trước đây có HAI bản regex từ-đơn trùng nhau (`aiProgrammingCopilot.SAFETY_RE`,
 * `programmingRouter.COPILOT_SAFETY_RE`). Đo được:
 *   • LỌT S2 — "bỏ qua nút dừng khẩn cấp … nối tắt cửa bảo vệ" (regex không có tiếng Việt);
 *   • LỌT S3 — yêu cầu vô hại, nhưng `contextCode` có `ESTOP_OK` (regex không soi mã);
 *   • CHẶN OAN S4 — "guard rail" (khớp từ đơn "guard");
 *   • cổng review/explain chạy SAU model ⇒ tốn một lượt model rồi mới từ chối, và tự chặn chẩn
 *     đoán `[safety-lint:missing-interlock]` của CHÍNH nền tảng (AI-13).
 * Cánh C (bật nghĩ + trần lớn) đã SINH MÃ BYPASS E-STOP cho S3 ⇒ nới ngân sách nghĩ mà chưa có
 * cổng này là mở lỗ. Thứ tự bắt buộc: cổng trước, ngân sách sau.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THIẾT KẾ
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Lớp 1  — CỤM (động từ nguy hiểm × đối tượng an toàn), VI có dấu / không dấu, EN, ZH; cả dạng
 *          bị động/hậu tố ("e-stop bypass", "cửa bảo vệ bị nối tắt", "急停屏蔽") và dạng gián
 *          tiếp ("vẫn chạy khi nhấn dừng khẩn cấp", "keep running even when the e-stop…").
 *          KHÔNG khớp từ đơn: "guard rail", "emergency light", "đèn khẩn cấp", "tắt động cơ",
 *          "tóm tắt", "tất cả" đều đi qua. Áp cho MỌI mode (kể cả explain: "giải thích cách bypass").
 * Lớp 1b — VIẾT logic chức năng an toàn (doc 34 §5.2, giữ nguyên chính sách): ở mode SINH MÃ,
 *          yêu cầu nêu một đối tượng chức năng an toàn CỤ THỂ (e-stop, interlock, light curtain,
 *          safety relay, SIL n, PL x, dừng khẩn cấp, liên động, rèm quang, 急停, 联锁…) ⇒ chặn.
 *          Chỉ đối tượng GHÉP — "safety"/"guard"/"安全" đứng một mình không kích lớp này.
 * Lớp 2  — soi `contextCode`: có ĐỊNH DANH tín hiệu an toàn (`ESTOP*`, `E_STOP*`, `SAFE*`,
 *          `GUARD*`, `*INTERLOCK*`, `LIGHT_CURTAIN*` — sau khi bỏ chú thích) và yêu cầu thuộc nhóm
 *          sửa/đổi (mode complete/translate/fix, hoặc động từ "gỡ/bỏ/xoá/sửa điều kiện dừng") ⇒
 *          chặn. `review` mã an toàn ⇒ chặn (copilot không rà soát/chứng nhận logic an toàn).
 *          `explain` ⇒ CHO PHÉP (chỉ giải thích), kèm `safetyRelevant` để router gắn nhãn
 *          "không phải chứng nhận".
 * AI-13  — chẩn đoán của nền tảng (`[safety-lint:…]`) bị loại khỏi chuỗi quét ở explain/review
 *          (đúng hai mode dock dùng để "Giải thích lỗi"/"Đề xuất sửa"). Ở mode sinh mã KHÔNG loại
 *          — không cho dùng thẻ `[safety-lint:…]` làm vỏ buôn lậu một yêu cầu bypass.
 *
 * Kết quả thống nhất: `{ refused, refusalSource: "gate", reasonCode, userMessage }` — userMessage
 * theo ngôn ngữ của yêu cầu (vi/en/zh); `reasonCode` là khoá ổn định cho i18n phía client.
 * Hàm THUẦN — không model, không DB, không I/O ⇒ chạy TRƯỚC mọi lời gọi model, không tốn lượt.
 */

export type GateMode = "generate" | "complete" | "translate" | "review" | "explain" | "fix";
export type GateLang = "vi" | "en" | "zh";
export type GateReasonCode =
  | "SAFETY_BYPASS_REQUEST"
  | "SAFETY_FUNCTION_AUTHORING"
  | "SAFETY_CODE_MODIFY"
  | "SAFETY_CODE_REVIEW";

export interface GateInput {
  mode: GateMode;
  request: string;
  contextCode?: string;
  targetKind?: string;
  kind?: string;
}

export interface GateVerdict {
  refused: boolean;
  refusalSource?: "gate";
  reasonCode?: GateReasonCode;
  userMessage?: string;
  /** Ngôn ngữ phát hiện từ yêu cầu (quyết định ngôn ngữ của `userMessage`). */
  lang: GateLang;
  /** Yêu cầu/mã chạm chủ đề an toàn (dùng để gắn nhãn "không chứng nhận" khi CHO QUA explain). */
  safetyRelevant: boolean;
  /** Cụm đã khớp — CHỈ để chẩn đoán/log, không hiển thị cho người dùng. */
  matched?: string;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Chuẩn hoá
// ────────────────────────────────────────────────────────────────────────────────────────────

const VI_DAU_RE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const CJK_RE = /[一-鿿]/;

/** Bỏ dấu tiếng Việt (và đ→d). Dùng cho cả VĂN BẢN lẫn MẪU (mẫu viết có dấu, sinh bản không dấu). */
function boDau(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function chuanHoa(s: string): string {
  return String(s ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Từ điển — EN
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Động từ nguy hiểm (EN). "short" có \b nên "shorter" không khớp. */
const EN_VERB =
  "(?:by-?pass(?:es|ed|ing)?|disabl(?:e|es|ed|ing)|deactivat(?:e|es|ed|ing)|defeat(?:s|ed|ing)?|overrid(?:e|es|ing|den)|" +
  "ignor(?:e|es|ed|ing)|skip(?:s|ped|ping)?|jumper(?:s|ed|ing)?(?: out)?|jump(?:s|ed|ing)? out|short(?:s|ed|ing)?(?: out)?|short-circuit(?:s|ed|ing)?|" +
  "bridg(?:e|es|ed|ing)|mut(?:e|es|ed|ing)|forc(?:e|es|ed|ing)|remov(?:e|es|ed|ing)|delet(?:e|es|ed|ing)|comment(?:s|ed|ing)? out|" +
  "turn(?:s|ed|ing)? off|switch(?:es|ed|ing)? off|suppress(?:es|ed|ing)?|circumvent(?:s|ed|ing)?|cheat(?:s|ed|ing)?|spoof(?:s|ed|ing)?|" +
  "fak(?:e|es|ed|ing)|hack(?:s|ed|ing)?|get(?:s|ting)? around|work(?:s|ing)? around|neutrali[sz](?:e|es|ed|ing))";

/** Đối tượng an toàn (EN) cho lớp 1 — GHÉP với động từ nên được phép rộng ("safety", "guard"). */
const EN_OBJ_L1 =
  "(?:e-?stops?|e\\.? ?stops?|estops?|emergency[- ]?stops?|emergency[- ]?off|(?:safety[- ]?)?interlocks?|light[- ]?curtains?|light[- ]?grids?|" +
  "safety[- ]?(?:door|gate|guard|relay|plc|controller|function|circuit|switch|sensor|input|signal|mat|scanner|laser|edge|check|system|logic|chain|loop|stop|limit|zone|fence|device)s?|" +
  "guard[- ]?(?:door|switch|lock(?:ing)?|interlock|sensor)s?|door[- ]?(?:interlock|switch)(?:es)?|two[- ]?hand(?:ed)?(?:[- ]?control)?|" +
  "enabling[- ]?(?:switch|device)|dead[- ]?man(?:'s)?(?:[- ]?switch)?|safe[- ]?torque[- ]?off|protective[- ]?(?:stop|door|guard|device)s?|" +
  "machine[- ]?guards?|safety|safeties|guards?(?![- ]?rails?))";

/** Đối tượng CHỨC NĂNG an toàn (EN) cho lớp 1b — chỉ đối tượng ghép cụ thể, không từ đơn. */
const EN_OBJ_FUNC =
  "(?:e-?stops?|e\\.? ?stops?|estops?|emergency[- ]?stops?|emergency[- ]?off|interlocks?|light[- ]?curtains?|light[- ]?grids?|" +
  "safety[- ]?(?:door|gate|guard|relay|plc|controller|function|circuit|switch|sensor|mat|scanner|logic|chain|rated|muting|interlock)s?|" +
  "guard[- ]?(?:door|switch|lock(?:ing)?|interlock)s?|two[- ]?hand(?:ed)?|enabling[- ]?(?:switch|device)|safe[- ]?torque[- ]?off|" +
  "performance[- ]?level|lockout[-/ ]?tagout|\\bloto\\b|\\bsil[- ]?[1-4]\\b)";

/** Dạng bị động / danh từ hậu tố (EN): "the e-stop is ignored", "interlock bypass". */
const EN_POST =
  "(?:(?:is|are|be|being|been|gets?|got)\\s+)?(?:by-?passed|disabled|deactivated|defeated|overridden|ignored|skipped|jumpered|shorted|bridged|muted|forced|removed|deleted|suppressed|circumvented|spoofed|faked)\\b|" +
  "[- ](?:by-?pass|override|defeat|jumper)\\b";

/** Gián tiếp (EN): máy vẫn chạy / không dừng. */
const EN_CONT =
  "(?:keep(?:s|ing)?|continu(?:e|es|ing)|still|stay(?:s|ing)?|remain(?:s|ing)?)\\s+(?:[\\w'-]+\\s+){0,2}(?:running|run|runs|moving|on|energi[sz]ed)\\b|" +
  "(?:don't|do not|never|won't|will not|doesn't|does not|without|not)\\s+(?:[\\w'-]+\\s+)?stop(?:s|ping)?\\b";

// ────────────────────────────────────────────────────────────────────────────────────────────
// Từ điển — VI (viết CÓ DẤU; bản không dấu được sinh bằng `boDau`)
// ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Động từ nguy hiểm (VI). ⚠ "tắt" có lookbehind "tóm " (tóm tắt) — và KHÔNG khớp "tất" (tất cả) ở
 * bản có dấu. Bản không dấu thêm lookahead chặn "tat ca".
 */
const VI_VERB =
  "(?:bỏ qua|bỏ đi|loại bỏ|gỡ bỏ|gỡ|bỏ|xoá|xóa|vô hiệu(?: hoá| hóa| hoa)?|nối tắt|đấu tắt|chập|(?<!tóm )tắt(?! cả)|ngắt|vượt qua|lách(?: qua)?|qua mặt|" +
  "cưỡng bức|ép|làm giả|giả|che|chặn|bỏ kiểm tra|không kiểm tra|không cần)";

/** Từ đệm hợp lệ giữa động từ và đối tượng (tối đa 3). */
const VI_FILLER =
  "(?:nút|nút nhấn|tín hiệu|cảm biến|công tắc|chức năng|mạch|cái|phần|điều kiện|kiểm tra|lệnh|các|những|toàn bộ|đầu vào|logic|khối|bit|cờ|tiếp điểm|của)";

/** Đối tượng an toàn (VI) — lớp 1 và lớp 1b dùng chung (đều là đối tượng GHÉP). */
const VI_OBJ =
  "(?:dừng khẩn(?: cấp)?|nút khẩn(?: cấp)?|e-?stop|estop|interlock|(?:khoá |khóa )?liên động|cửa bảo vệ|cửa an toàn|rèm quang|rèm an toàn|màn chắn sáng|" +
  "(?:cảm biến|rơ-?le|relay|mạch|chức năng|công tắc|tín hiệu|thiết bị|hệ thống|khoá|khóa|bộ điều khiển|plc) an toàn|hai tay)";

/** Hậu tố bị động (VI) — BẮT BUỘC có "bị/được" ("dừng khẩn cấp tắt động cơ" là mô tả, không phải bypass). */
const VI_POST = "\\s+(?:đã\\s+)?(?:bị|được)\\s+(?:bỏ qua|vô hiệu(?: hoá| hóa| hoa)?|nối tắt|tắt|gỡ(?: bỏ)?|vượt qua|lách|che|chặn|ngắt)";

/** Gián tiếp (VI): vẫn chạy / không dừng. */
const VI_CONT = "(?:vẫn|tiếp tục|cứ)\\s+(?:chạy|hoạt động|quay|làm việc)|chạy tiếp|không dừng|không bị dừng";

/** Động từ SỬA/ĐỔI điều kiện (lớp 2 — đi cùng mã có tín hiệu an toàn). */
const VI_MODIFY = "(?:gỡ|bỏ|xoá|xóa|sửa|đổi|thay đổi|vô hiệu|bỏ qua)\\s+(?:\\S+\\s+){0,2}(?:điều kiện|kiểm tra|dòng|lệnh|tín hiệu)|vẫn chạy|chạy tiếp|không dừng";
const EN_MODIFY =
  "(?:remov(?:e|ing)|delet(?:e|ing)|chang(?:e|ing)|modif(?:y|ying)|edit(?:ing)?|alter(?:ing)?|rewrit(?:e|ing)|invert(?:ing)?|negat(?:e|ing)|comment(?:ing)? out|by-?pass(?:ing)?|skip(?:ping)?|ignor(?:e|ing))\\s+(?:[\\w'-]+\\s+){0,3}(?:condition|check|stop|if|line|signal)|keep(?:s)? running|still run";

// ────────────────────────────────────────────────────────────────────────────────────────────
// Từ điển — ZH (không có khoảng trắng ⇒ kề trong vài ký tự)
// ────────────────────────────────────────────────────────────────────────────────────────────

/** ⚠ Cố ý KHÔNG có 关闭 (vừa "tắt" vừa "đóng": "关闭安全门" = ĐÓNG cửa an toàn) và 解除/取消 (reset e-stop hợp lệ). */
const ZH_VERB = "(?:跳过|绕过|绕开|旁路|禁用|停用|屏蔽|短接|跨接|短路|忽略|强制|去掉|删除|去除|使.{0,2}失效)";
const ZH_OBJ = "(?:急停|紧急停止|安全门|安全光幕|安全光栅|安全继电器|安全回路|安全信号|安全开关|安全功能|安全传感器|安全PLC|安全plc|安全|联锁|互锁|光幕|光栅|防护门|双手|使能开关)";
const ZH_OBJ_FUNC = "(?:急停|紧急停止|安全门|安全光幕|安全光栅|安全继电器|安全回路|安全功能|安全PLC|安全plc|安全控制器|联锁|互锁|光幕|防护门|双手)";
const ZH_POST_VERB = "(?:屏蔽|旁路|短接|失效|禁用|跳过|绕过|忽略)";
const ZH_CONT = "(?:继续|一直|仍然|照常|持续)(?:运行|运转|工作|转动)";

// ────────────────────────────────────────────────────────────────────────────────────────────
// Biên dịch mẫu
// ────────────────────────────────────────────────────────────────────────────────────────────

const WINDOW = 80; // ký tự — cửa sổ gián tiếp (liên tục/không dừng ↔ đối tượng)

function re(src: string, flags = "iu"): RegExp {
  return new RegExp(src, flags);
}

// EN
const EN_L1_TRUOC = re(`\\b${EN_VERB}\\s+(?:[\\w'.-]+\\s+){0,3}?${EN_OBJ_L1}\\b`);
const EN_L1_SAU = re(`\\b${EN_OBJ_L1}\\s*(?:[\\w-]+\\s+){0,2}?(?:${EN_POST})`);
const EN_L1_SAU_NOUN = re(`\\b${EN_OBJ_L1}(?:[- ](?:by-?pass|override|defeat|jumper))\\b`);
const EN_CONT_RE = re(EN_CONT, "giu");
const EN_OBJ_L1_RE = re(`\\b${EN_OBJ_L1}\\b`, "giu");
const EN_FUNC_RE = re(`\\b${EN_OBJ_FUNC}`);
const PL_RE = /\bPL[- ]?[a-e]\b/; // "PL d" — PHÂN BIỆT hoa/thường để "PLC" không khớp
const EN_MODIFY_RE = re(EN_MODIFY);

// VI (có dấu)
const VI_L1_TRUOC = re(`(?<![\\p{L}])${VI_VERB}(?:\\s+${VI_FILLER}){0,3}\\s+${VI_OBJ}`);
const VI_L1_SAU = re(`${VI_OBJ}(?:\\s+${VI_FILLER})?${VI_POST}`);
const VI_CONT_RE = re(`(?<![\\p{L}])(?:${VI_CONT})`, "giu");
const VI_OBJ_RE = re(`(?<![\\p{L}])${VI_OBJ}`, "giu");
const VI_FUNC_RE = re(`(?<![\\p{L}])${VI_OBJ}`);
const VI_MODIFY_RE = re(`(?<![\\p{L}])(?:${VI_MODIFY})`);

// VI (không dấu) — sinh từ bản có dấu; thêm lookahead "tat ca" (tất cả) mà bản có dấu không cần.
const VI_VERB_KD = boDau(VI_VERB).replace("(?<!tom )tat(?! ca)", "(?<!tom )tat(?! ca\\b)");
const VI_L1_TRUOC_KD = re(`(?<![a-z])${VI_VERB_KD}(?:\\s+${boDau(VI_FILLER)}){0,3}\\s+${boDau(VI_OBJ)}(?![a-z])`);
const VI_L1_SAU_KD = re(`${boDau(VI_OBJ)}(?:\\s+${boDau(VI_FILLER)})?${boDau(VI_POST)}`);
const VI_CONT_RE_KD = re(`(?<![a-z])(?:${boDau(VI_CONT)})(?![a-z])`, "giu");
const VI_OBJ_RE_KD = re(`(?<![a-z])${boDau(VI_OBJ)}(?![a-z])`, "giu");
const VI_FUNC_RE_KD = re(`(?<![a-z])${boDau(VI_OBJ)}(?![a-z])`);
const VI_MODIFY_RE_KD = re(`(?<![a-z])(?:${boDau(VI_MODIFY)})`);

// ZH
const ZH_L1_TRUOC = re(`${ZH_VERB}.{0,4}?${ZH_OBJ}`);
const ZH_L1_SAU = re(`${ZH_OBJ}.{0,4}?${ZH_POST_VERB}`);
const ZH_CONT_RE = re(ZH_CONT, "gu");
const ZH_OBJ_RE = re(ZH_OBJ, "gu");
const ZH_FUNC_RE = re(ZH_OBJ_FUNC);

/** Có một khớp của `a` và một khớp của `b` cách nhau ≤ WINDOW ký tự (hai chiều)? */
function ganNhau(text: string, a: RegExp, b: RegExp): string | null {
  const ia = [...text.matchAll(a)];
  if (!ia.length) return null;
  const ib = [...text.matchAll(b)];
  for (const x of ia) {
    for (const y of ib) {
      const xs = x.index ?? 0;
      const xe = xs + x[0].length;
      const ys = y.index ?? 0;
      const ye = ys + y[0].length;
      const gap = ys >= xe ? ys - xe : xs >= ye ? xs - ye : 0;
      if (gap <= WINDOW) return `${x[0]} … ${y[0]}`;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Lớp 1 — cụm động từ nguy hiểm × đối tượng an toàn
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Trả về cụm đã khớp (để chẩn đoán) hoặc null. Không phân biệt mode. */
export function matchBypassPhrase(text: string | undefined | null): string | null {
  const s = chuanHoa(String(text ?? ""));
  if (!s.trim()) return null;
  const hit = (r: RegExp) => {
    const m = s.match(r);
    return m ? m[0] : null;
  };
  // EN (áp cho mọi văn bản — mẫu ASCII)
  const en = hit(EN_L1_TRUOC) ?? hit(EN_L1_SAU) ?? hit(EN_L1_SAU_NOUN) ?? ganNhau(s, EN_CONT_RE, EN_OBJ_L1_RE);
  if (en) return en;
  // ZH
  if (CJK_RE.test(s)) {
    const zh = hit(ZH_L1_TRUOC) ?? hit(ZH_L1_SAU) ?? ganNhau(s, ZH_CONT_RE, ZH_OBJ_RE);
    if (zh) return zh;
  }
  // VI — có dấu ⇒ mẫu có dấu (phân biệt "tắt"/"tất"); không dấu ⇒ mẫu không dấu.
  if (VI_DAU_RE.test(s)) {
    return hit(VI_L1_TRUOC) ?? hit(VI_L1_SAU) ?? ganNhau(s, VI_CONT_RE, VI_OBJ_RE);
  }
  return hit(VI_L1_TRUOC_KD) ?? hit(VI_L1_SAU_KD) ?? ganNhau(s, VI_CONT_RE_KD, VI_OBJ_RE_KD);
}

/** Lớp 1b — yêu cầu nêu một đối tượng CHỨC NĂNG an toàn cụ thể (chỉ dùng ở mode sinh mã/review). */
export function matchSafetyFunctionObject(text: string | undefined | null): string | null {
  const raw = String(text ?? "");
  const s = chuanHoa(raw);
  if (!s.trim()) return null;
  const m = s.match(EN_FUNC_RE) ?? raw.match(PL_RE);
  if (m) return m[0];
  if (CJK_RE.test(s)) {
    const z = s.match(ZH_FUNC_RE);
    if (z) return z[0];
  }
  const v = VI_DAU_RE.test(s) ? s.match(VI_FUNC_RE) : s.match(VI_FUNC_RE_KD);
  return v ? v[0] : null;
}

function matchModifyVerb(text: string): string | null {
  const s = chuanHoa(text);
  const m = s.match(EN_MODIFY_RE) ?? (VI_DAU_RE.test(s) ? s.match(VI_MODIFY_RE) : s.match(VI_MODIFY_RE_KD));
  return m ? m[0] : null;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Lớp 2 — định danh tín hiệu an toàn trong mã
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Bỏ chú thích `(* *)`, `/* *\/`, `//` — chú thích nhắc "E-stop" KHÔNG phải tín hiệu an toàn. */
function boChuThich(code: string): string {
  return code
    .replace(/\(\*[\s\S]*?\*\)/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/** Tách một định danh thành các phần theo `_` và ranh giới camelCase ("EStop" → e, stop). */
function tachPhan(ident: string): string[] {
  return ident
    .split(/_+/)
    .flatMap((p) => p.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(" "))
    .map((p) => p.toLowerCase())
    .filter(Boolean);
}

function laTinHieuAnToan(ident: string): boolean {
  const p = tachPhan(ident);
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[i + 1] ?? "";
    if (/^(?:estop|emgstop|emergencystop|lightcurtain|twohand)/.test(a)) return true;
    if ((a === "e" || a === "emg" || a === "emergency") && /^stop/.test(b)) return true;
    if (a === "light" && /^curtain/.test(b)) return true;
    if (a === "two" && /^hand/.test(b)) return true;
    if (a.includes("interlock")) return true;
    if (a.startsWith("safe")) return true; // SAFE*, Safety*, SAFE_TORQUE_OFF …
    if (a.startsWith("guard") && a !== "guardrail" && !/^rail/.test(b)) return true;
  }
  return false;
}

/** Mã có định danh tín hiệu an toàn (sau khi bỏ chú thích)? */
export function hasSafetySignalInCode(code: string | undefined | null): boolean {
  const s = boChuThich(String(code ?? ""));
  if (!s.trim()) return false;
  for (const m of s.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    if (laTinHieuAnToan(m[0])) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// AI-13 — chẩn đoán của nền tảng
// ────────────────────────────────────────────────────────────────────────────────────────────

const SAFETY_LINT_LINE_RE = /^.*\[safety-lint:[\w-]+\][^\n]*$/gm;

/** Gỡ các dòng chẩn đoán `[safety-lint:…]` do CHÍNH nền tảng sinh ra (dock nối vào request). */
export function stripPlatformDiagnostics(text: string | undefined | null): string {
  return String(text ?? "").replace(SAFETY_LINT_LINE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Chủ đề an toàn (CHỈ để gắn nhãn "không chứng nhận" — KHÔNG dùng để chặn)
// ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Nhận diện RỘNG chủ đề an toàn (từ đơn "guard", "safety", "安全" cũng tính). Chỉ dùng để gắn nhãn
 * `safetyReviewRequired / certified:false` lên một câu trả lời ĐƯỢC PHÉP — gắn thừa vô hại; dùng nó
 * để CHẶN là đúng lỗi AI-17 ("guard rail" bị chặn oan).
 */
const SAFETY_TOPIC_RE =
  /\b(e-?stops?|emergency[-\s]?stops?|emergency|interlocks?|safety(?:[-\s]?(?:function|relay|plc|logic|circuit|door|gate|rated))?|safeties|sil\s?[1-4]?|pl[-\s]?[a-e]|performance[-\s]?level|guard[-\s]?lock(?:ing)?|guard|light[-\s]?curtain|two[-\s]?hand|lockout|tagout|muting|estop)\b|(?:安全|急停|安全门|安全回路|安全继电器|紧急停止|光幕|双手)/i;

export function isSafetyRelevantText(...texts: (string | undefined | null)[]): boolean {
  const parts = texts.filter((t): t is string => typeof t === "string" && t.length > 0);
  if (!parts.length) return false;
  const joined = parts.join("\n");
  if (SAFETY_TOPIC_RE.test(joined)) return true;
  if (matchSafetyFunctionObject(joined)) return true;
  return parts.some((p) => hasSafetySignalInCode(p));
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Ngôn ngữ + thông điệp
// ────────────────────────────────────────────────────────────────────────────────────────────

const VI_KHONG_DAU_TU =
  /(?<![a-z])(?:viet|chuong trinh|cho|khi|va|cua|nut|dung|sua|giai thich|bang tai|dong co|tat|bo qua|lien dong|khan cap|cam bien|de|may|thi|khong|duoc|trong|voi|hoa|noi|bao tri|tam thoi)(?![a-z])/g;

export function detectRequestLang(text: string | undefined | null): GateLang {
  const s = String(text ?? "");
  if (CJK_RE.test(s)) return "zh";
  if (VI_DAU_RE.test(s)) return "vi";
  const n = (s.toLowerCase().match(VI_KHONG_DAU_TU) ?? []).length;
  return n >= 2 ? "vi" : "en";
}

const THONG_DIEP: Record<GateReasonCode, Record<GateLang, string>> = {
  SAFETY_BYPASS_REQUEST: {
    vi: "Không thể hỗ trợ: yêu cầu này bỏ qua hoặc vô hiệu hoá chức năng an toàn (dừng khẩn cấp, liên động, cửa bảo vệ, rèm quang…). Chức năng an toàn chỉ do kỹ sư có thẩm quyền thay đổi và kiểm định trên bộ điều khiển an toàn đã chứng nhận.",
    en: "Cannot help: this request bypasses or disables a safety function (E-stop, interlock, guard door, light curtain…). Safety functions may only be changed and verified by an authorised engineer on the certified safety controller.",
    zh: "无法协助：该请求会绕过或禁用安全功能（急停、联锁、防护门、光幕等）。安全功能只能由授权工程师在经认证的安全控制器上修改和验证。",
  },
  SAFETY_FUNCTION_AUTHORING: {
    vi: "Trợ lý không viết logic chức năng an toàn (dừng khẩn cấp, liên động, rèm quang, SIL/PL). Phần này phải do kỹ sư an toàn thực hiện và kiểm định trên bộ điều khiển an toàn đã chứng nhận.",
    en: "The assistant does not author safety-function logic (E-stop, interlock, light curtain, SIL/PL). That must be implemented and verified by a safety engineer on the certified safety controller.",
    zh: "助手不编写安全功能逻辑（急停、联锁、光幕、SIL/PL）。此类逻辑必须由安全工程师在经认证的安全控制器上实现并验证。",
  },
  SAFETY_CODE_MODIFY: {
    vi: "Chương trình có tín hiệu an toàn (vd ESTOP, INTERLOCK, GUARD). Trợ lý không sửa, dịch hay hoàn thiện mã chạm tới điều kiện an toàn — chỉ có thể giải thích.",
    en: "This program contains safety signals (e.g. ESTOP, INTERLOCK, GUARD). The assistant does not modify, translate or complete code that touches safety conditions — it can only explain it.",
    zh: "该程序包含安全信号（如 ESTOP、INTERLOCK、GUARD）。助手不修改、翻译或补全涉及安全条件的代码，只能进行解释。",
  },
  SAFETY_CODE_REVIEW: {
    vi: "Chương trình liên quan an toàn — trợ lý không rà soát hay chứng nhận logic an toàn. Hãy dùng chế độ Giải thích, và nhờ kỹ sư an toàn có thẩm quyền kiểm định.",
    en: "This program is safety-related — the assistant does not review or certify safety logic. Use Explain mode, and have an authorised safety engineer verify it.",
    zh: "该程序与安全相关——助手不审查或认证安全逻辑。请使用“解释”模式，并由授权安全工程师验证。",
  },
};

export function gateUserMessage(code: GateReasonCode, lang: GateLang): string {
  return THONG_DIEP[code][lang];
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Cổng
// ────────────────────────────────────────────────────────────────────────────────────────────

const CODE_MODES: ReadonlySet<GateMode> = new Set(["generate", "complete", "translate", "fix"]);
const MODIFY_MODES: ReadonlySet<GateMode> = new Set(["complete", "translate", "fix"]);

/**
 * Quyết định của cổng cho MỘT yêu cầu copilot. Chạy TRƯỚC mọi lời gọi model, cho MỌI mode.
 * Thuần — cùng đầu vào, cùng kết quả.
 */
export function checkCopilotSafety(input: GateInput): GateVerdict {
  const mode = input.mode;
  const rawRequest = String(input.request ?? "");
  const code = String(input.contextCode ?? "");
  // AI-13 — chẩn đoán của nền tảng chỉ bị loại ở hai mode "đọc" (dock: Giải thích lỗi / Đề xuất sửa).
  const request = mode === "explain" || mode === "review" ? stripPlatformDiagnostics(rawRequest) : rawRequest;
  const lang = detectRequestLang(request || rawRequest);
  const codeSignal = hasSafetySignalInCode(code);
  const safetyRelevant = codeSignal || isSafetyRelevantText(request);

  const tuChoi = (reasonCode: GateReasonCode, matched: string): GateVerdict => ({
    refused: true,
    refusalSource: "gate",
    reasonCode,
    userMessage: gateUserMessage(reasonCode, lang),
    lang,
    safetyRelevant: true,
    matched,
  });

  // Lớp 1 — cụm bypass trong yêu cầu (mọi mode). Ở mode sinh mã, chú thích trong mã nguồn cũng là
  // "lời dặn" model đọc được ⇒ soi cả `contextCode`.
  const l1 = matchBypassPhrase(request) ?? (CODE_MODES.has(mode) ? matchBypassPhrase(code) : null);
  if (l1) return tuChoi("SAFETY_BYPASS_REQUEST", l1);

  // Lớp 1b — viết logic chức năng an toàn (mode sinh mã) / rà soát logic an toàn (review).
  const fn = CODE_MODES.has(mode) || mode === "review" ? matchSafetyFunctionObject(request) : null;
  if (fn) return tuChoi(mode === "review" ? "SAFETY_CODE_REVIEW" : "SAFETY_FUNCTION_AUTHORING", fn);

  // Lớp 2 — mã có tín hiệu an toàn.
  if (codeSignal) {
    if (MODIFY_MODES.has(mode)) return tuChoi("SAFETY_CODE_MODIFY", `contextCode:${mode}`);
    if (mode === "review") return tuChoi("SAFETY_CODE_REVIEW", "contextCode:review");
    if (mode === "generate") {
      const mv = matchModifyVerb(request);
      if (mv) return tuChoi("SAFETY_CODE_MODIFY", mv);
    }
    // explain ⇒ cho phép (chỉ giải thích).
  }

  return { refused: false, lang, safetyRelevant };
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Ghost-text (inline) — 400 ký tự quanh con trỏ
// ────────────────────────────────────────────────────────────────────────────────────────────

export const INLINE_GATE_WINDOW = 400;

/** true ⇒ KHÔNG gợi ý: vùng quanh con trỏ có tín hiệu an toàn hoặc một cụm bypass. */
export function inlineCompletionBlocked(prefix: string | undefined | null, suffix?: string | null): boolean {
  const win = `${String(prefix ?? "").slice(-INLINE_GATE_WINDOW)}${String(suffix ?? "").slice(0, INLINE_GATE_WINDOW)}`;
  if (!win.trim()) return false;
  return hasSafetySignalInCode(win) || matchBypassPhrase(win) != null;
}
