/**
 * AI Local Tools — Intent Classifier
 *
 * Decides whether the user question needs a real-time data tool, and if so
 * which one + with which parameters.
 *
 * Strategy:
 *   1) Fast heuristic match using each tool's `triggers` keyword list +
 *      regex-based parameter extraction (orderCode, days, onlyOffline).
 *      → Returns instantly without calling the LLM.
 *   2) If no heuristic match: optional LLM fallback (`classifyToolIntentLLM`)
 *      asks qwen2.5-instruct to pick a tool name (or "none") and emit JSON
 *      args. Disabled by default (opt-in via AI_TOOL_LLM_FALLBACK=1) to keep
 *      latency low. The caller (`tryExecuteTool`) wires it in.
 *
 * Output is intentionally simple so tool execution stays predictable and
 * easy to audit.
 */

import { listTools, getTool, type Tool } from "./toolRegistry";
// ⚠ CHỈ nhập KIỂU (bị xoá lúc biên dịch) — không tạo cạnh nhập lúc chạy, không kéo theo lượt
//   tự đăng ký tool của `readToolsProgramming.ts`. Nhờ nó, một `ProgrammingKind` gõ sai trong
//   bảng gợi ý dưới đây là **lỗi biên dịch**, không phải một lượt `safeParse` hỏng lúc chạy.
import type { ProgrammingKind } from "../programming/programmingAdapter";

// C3a — optional page selection used to pre-fill tool args when the question
// omits a concrete identifier (e.g. "máy này sao rồi?" on the machine page).
// Structurally a subset of the service's KbQueryContext.
export interface ToolContext {
  selectedMachineCode?: string;
  selectedProductCode?: string;
  selectedLot?: string;
}

export interface ToolDecision {
  tool: string | null;
  args: Record<string, unknown>;
  reason: string;
  /**
   * When non-null, the classifier matched a tool intent but is missing a
   * required parameter (e.g. orderCode). The caller should short-circuit
   * the LLM pipeline and reply with this clarifying question instead.
   */
  clarifyMessage?: string | null;
}

// Vietnamese / English patterns that hint the user *wants* a real-time
// lookup but didn't include a concrete identifier. Used to upgrade the
// "no tool" response into a clarifying question.
const LOT_INTENT_HINT = /\b(lô|lot|lệnh\s*sản\s*xuất|order|pmo|po)\b/i;
const MACHINE_INTENT_HINT = /\b(máy|machine|line|chuyền|equipment|thiết\s*bị)\b/i;
const TODAY_INTENT_HINT = /\b(hôm\s*nay|today|ca\s*hiện\s*tại|current\s*shift)\b/i;

function buildClarifyMessage(reason: string, question: string): string | null {
  if (reason === "MISSING_ORDER_CODE") {
    return [
      "Bạn muốn tra cứu lô sản xuất nào? Vui lòng cung cấp **mã lệnh sản xuất** (ví dụ `L20260505-001` hoặc `PO12345`).",
      "Bạn cũng có thể vào *Menu › Sản xuất › Lệnh sản xuất* để chọn trực tiếp từ danh sách.",
    ].join("\n");
  }
  if (reason === "MISSING_SPEC_ARGS") {
    return [
      "Để đặt giới hạn spec, vui lòng cho biết **điểm đo** (ví dụ `điểm đo #12`) và ít nhất một giá trị **USL / LSL / Target** (ví dụ `USL=10.5 LSL=9.5`).",
      "Ví dụ đầy đủ: *đặt spec điểm đo #12: USL=10.5, LSL=9.5, target=10*.",
    ].join("\n");
  }
  if (reason === "MISSING_PROCESS_ARGS") {
    return [
      "Để xem xu hướng chỉ số công đoạn, vui lòng cho biết **chỉ số đo** (ví dụ `torque`, `lượng keo`, `cycle time`) và **máy** hoặc **loại công đoạn**.",
      "Ví dụ: *xu hướng torque máy SCR-01 trong 7 ngày*.",
    ].join("\n");
  }
  if (reason === "MISSING_CORRELATION_ARGS") {
    return [
      "Để phân tích tương quan, vui lòng cho biết **công đoạn thượng nguồn + chỉ số đo** (ví dụ `torque`) và (tùy chọn) **công đoạn hạ nguồn** có lỗi.",
      "Ví dụ: *tương quan torque với NG ở công đoạn function*.",
    ].join("\n");
  }
  // No heuristic matched but user is clearly asking about live data.
  if (reason === "NO_TRIGGER_MATCH") {
    if (LOT_INTENT_HINT.test(question)) {
      return "Bạn đang hỏi về lô sản xuất nào? Vui lòng cho biết **mã lệnh / mã lô** (ví dụ `L20260505-001`) để tôi tra dữ liệu thực tế.";
    }
    if (MACHINE_INTENT_HINT.test(question)) {
      return "Bạn muốn xem trạng thái **máy nào** hoặc **toàn bộ máy đang offline**? Hãy nêu rõ tên máy/line, hoặc nói \"máy đang offline\" để tôi liệt kê.";
    }
    if (TODAY_INTENT_HINT.test(question)) {
      return "Bạn muốn xem chỉ số nào hôm nay? Ví dụ: *sản lượng, NG rate, top lỗi, máy offline*.";
    }
  }
  return null;
}

const ORDER_CODE_REGEX = /\b(?:po|lệnh|lot|lô|order)\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]{2,30})\b/i;
// Accept also bare alphanumeric codes if user prefixes with "mã" — e.g. "mã ABC123"
const ORDER_CODE_PREFIX_VI = /\bmã\s+([A-Z0-9][A-Z0-9_-]{2,30})\b/i;
// Bare lot/order code pattern (e.g. "L20260505-001", "PO123-45") — matches even
// without an explicit prefix word. Kept conservative: must start with letter
// followed by digits and an optional "-NNN" suffix to avoid catching random
// uppercase tokens.
const BARE_LOT_CODE_REGEX = /\b([A-Z]{1,3}\d{4,12}(?:-\d{1,4})?)\b/;
const DAYS_REGEX = /(\d{1,2})\s*(?:ngày|days?)\b/i;
const OFFLINE_REGEX = /\b(offline|không.*online|mất.*kết nối|chưa.*online|đang.*offline)\b/i;
// Period-comparison hints (current vs previous week/month).
const MONTH_COMPARE_INTENT = /\b(tháng\s*này|tháng\s*trước|so\s*với\s*tháng|kỳ\s*trước|month\s*over\s*month|\bmom\b)\b/i;
const WEEK_COMPARE_INTENT = /\b(tuần\s*này|tuần\s*trước|so\s*với\s*tuần|\bwow\b)\b/i;
// OEE keyword fast-path.
const OEE_INTENT = /\b(oee|hiệu\s*suất\s*tổng\s*thể|overall\s*equipment)\b/i;
// Factory-aggregation hints.
const FACTORY_AGG_INTENT = /\b(theo\s*nhà\s*máy|từng\s*nhà\s*máy|các\s*nhà\s*máy|so\s*sánh\s*nhà\s*máy|ranking\s*nhà\s*máy|by\s*factory)\b/i;
// Per-product-model hints.
const MODEL_RANKING_INTENT = /\b(mẫu\s*sản\s*phẩm|sản\s*phẩm\s*nào|model\s*nào|theo\s*sản\s*phẩm|theo\s*model|ng\s*theo\s*model)\b/i;
// Optional machine-code extraction for OEE (e.g. "AOI-01", "M-12").
const MACHINE_CODE_REGEX = /\b([A-Z]{2,5}-?\d{1,4})\b/;

// ─── Phase B4 — Management/Analytics intents (vi+en) ─────────────────────────
// OEE with an explicit period/compare wording → the analytics OEE tool (period
// compare) instead of the legacy snapshot get_oee.
const OEE_PERIOD_COMPARE_INTENT =
  /\boee\b[\s\S]{0,40}\b(tuần\s*này|tháng\s*này|so\s*với|so\s*sánh|kỳ\s*trước|this\s*week|this\s*month|compare|vs)\b/i;
// Defect Pareto / top-N NG.
const DEFECT_PARETO_INTENT =
  /\b(pareto|top\s*\d*\s*lỗi|top\s*\d*\s*ng|lỗi\s*nhiều\s*nhất|loại\s*lỗi|80\s*\/\s*20|top\s*defect|máy\s*lỗi\s*nhiều)\b/i;
// Defect heatmap summary.
const DEFECT_HEATMAP_INTENT =
  /\b(heatmap|bản\s*đồ\s*nhiệt|điểm\s*nóng\s*lỗi|vị\s*trí\s*lỗi|hotspot|defect\s*heatmap)\b/i;
// Yield/FPY query (without forecast wording → query; with → forecast below).
const YIELD_INTENT = /\b(yield|fpy|tỉ\s*lệ\s*đạt|tỷ\s*lệ\s*đạt|first\s*pass|tỉ\s*lệ\s*pass)\b/i;
// SPC out-of-control.
const SPC_INTENT =
  /\b(spc|out\s*of\s*control|vượt\s*kiểm\s*soát|ngoài\s*tầm\s*kiểm\s*soát|control\s*chart|biểu\s*đồ\s*kiểm\s*soát)\b/i;
// Predictive maintenance / failure risk.
const PDM_INTENT =
  /\b(dự\s*báo\s*hỏng|rủi\s*ro\s*hỏng|bảo\s*trì\s*dự\s*đoán|predictive\s*maintenance|\bpdm\b|máy\s*sắp\s*hỏng|failure\s*risk|sức\s*khỏe\s*máy|machine\s*health)\b/i;
// Generic time-series forecast (yield/throughput).
const FORECAST_SERIES_INTENT =
  /\b(dự\s*báo|dự\s*đoán|forecast|predict)\b[\s\S]{0,20}\b(yield|sản\s*lượng|throughput|năng\s*suất|fpy)\b/i;

/** Try an analytics tool by name: extract args, zod-validate, return decision or null. */
function tryAnalyticsTool(
  toolName: string,
  reason: string,
  question: string,
  context?: ToolContext,
): ToolDecision | null {
  const tool = getTool(toolName);
  if (!tool) return null;
  const args = extractArgsForTool(toolName, question, context);
  const parsed = tool.parameters.safeParse(args);
  if (parsed.success) {
    return { tool: toolName, args: parsed.data as Record<string, unknown>, reason };
  }
  return null;
}

// ─── Sprint F6 — line-monitoring intents ─────────────────────────────────────
// A process-metric trend ("torque máy SCR-01 7 ngày", "lượng keo", "cycle time").
const PROCESS_TREND_INTENT =
  /\b(torque|lực\s*siết|mô-?men|dispense|lượng\s*keo|cycle\s*time|thời\s*gian\s*chu\s*kỳ)\b/i;
// Line balance / bottleneck.
const LINE_BALANCE_INTENT = /\b(cân\s*bằng\s*(chuyền|line)|nút\s*thắt|bottleneck|nghẽn)\b/i;
// Forecast hint → route line balance to the bottleneck INSIGHT tool instead.
const BOTTLENECK_FORECAST_HINT = /\b(dự\s*báo|sẽ\s*nghẽn|sắp\s*nghẽn|forecast)\b/i;
const PALLETIZER_INTENT = /\b(palletizer|xếp\s*pallet|máy\s*xếp\s*pallet|robot\s*pallet)\b/i;
const PACKAGING_INTENT = /\b(đóng\s*gói|packaging|throughput|sản\s*lượng\s*đóng\s*gói)\b/i;
const TELEMETRY_INTENT = /\b(telemetry|giá\s*trị\s*tag|đọc\s*tag|cảm\s*biến\s*máy|ot\s*telemetry)\b/i;
const CORRELATION_INTENT =
  /\b(tương\s*quan|correlation|ảnh\s*hưởng[\s\S]{0,15}(ng|lỗi)|liên\s*quan[\s\S]{0,15}lỗi)\b/i;
// Line code extraction, e.g. "line A", "chuyền L-01", "line L1".
const LINE_CODE_REGEX = /\b(?:line|chuyền)\s*([A-Za-z0-9][A-Za-z0-9_-]{0,15})\b/i;
// Bare serial, e.g. "serial SN12345", "SN-001".
const SERIAL_REGEX = /\b(?:serial|sn|s\/n)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,40})\b/i;
// Map keyword → { metricKey, stepType } for the process-metric trend tool.
function mapProcessMetric(question: string): { metricKey: string; stepType?: string } {
  const q = question.toLowerCase();
  if (/torque|lực\s*siết|mô-?men/.test(q)) return { metricKey: "torque", stepType: "torque" };
  if (/keo|dispense/.test(q)) return { metricKey: "volume", stepType: "dispense" };
  if (/cycle\s*time|thời\s*gian\s*chu\s*kỳ/.test(q)) return { metricKey: "cycleTimeMs" };
  return { metricKey: "value" };
}
// Map keyword → upstream stepType + metricKey for the correlation tool.
function mapCorrelationArgs(question: string): { upstreamStepType: string; metricKey: string } | null {
  const q = question.toLowerCase();
  if (/torque|lực\s*siết|mô-?men/.test(q)) return { upstreamStepType: "torque", metricKey: "torque" };
  if (/keo|dispense/.test(q)) return { upstreamStepType: "dispense", metricKey: "volume" };
  return null;
}

// GĐ2 write-tool: "đặt/cập nhật spec/USL/LSL điểm đo".
const SET_SPEC_INTENT = /\b(đặt|cập\s*nhật|set|update|chỉnh)\b[\s\S]{0,40}\b(spec|usl|lsl|target|giới\s*hạn)\b|\b(usl|lsl)\b[\s\S]{0,20}=/i;
// Measurement-point id: "điểm đo #12", "điểm đo 12", "point 12", "mpd 12".
const MP_ID_REGEX = /(?:điểm\s*đo|measurement\s*point|point|mpd|mp)\s*#?\s*(\d{1,9})/i;
// Numeric spec values: "USL=10.5", "LSL = -3", "target 7".
const USL_REGEX = /\busl\b\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i;
const LSL_REGEX = /\blsl\b\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i;
const TARGET_REGEX = /\b(?:target|nominal|mục\s*tiêu|danh\s*định)\b\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i;

// ════════════════════════════════════════════════════════════════════════════
// ★★★ Pha 6 Task 3 (F2) — nhóm tool LẬP TRÌNH (`readToolsProgramming.ts`)
// ════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠⚠ **NGUYÊN TẮC BẤT DI DỊCH CỦA MỌI BỘ TRÍCH DƯỚI ĐÂY: KHÔNG LÀM SẠCH ĐẦU VÀO.**
 *
 * Nhóm này có **hai ranh giới an ninh** — cửa `confineTarget()` (chặn `..` / đường tuyệt đối /
 * symlink / **hard link**) và hộp cát `evaluateArithmetic()` (văn phạm số học whitelist, không
 * `eval`). Cả hai nằm **trong handler**. Nếu bộ trích ở đây tự lọc `..` hay tự loại một biểu thức
 * lạ thì hai ranh giới ấy **vẫn không chạy** — cái mù chỉ đổi chỗ, và một lượt nới cửa về sau sẽ
 * **không ai thấy**.
 * ⇒ Bộ trích chỉ trả lời một câu: *"chuỗi người dùng định đưa cho tham số này là chuỗi nào?"*.
 * Việc **PHÁN XÉT** chuỗi ấy là của handler. Lưới `programmingTools.agentPath.test.ts` khoá đúng
 * điều này (`decision.args` phải mang **nguyên văn** chuỗi thù địch).
 *
 * ⚠⚠ **KHÔNG bộ trích nào được đặt ô `lang`.** Ngôn ngữ phiên có **một người chủ duy nhất** —
 * `argsWithAuthCtx()` ở `toolRegistry.ts`, và nó chỉ tiêm vào ô nào **chứng minh được** mình là
 * `z.enum(["vi","en","zh"])`. Hai tool KB ở đây (`retrieve_programming_kb`, `lookup_error_code`)
 * có một ô **trùng tên** `lang: z.string().max(16)` mà thực chất là **BỘ LỌC KHO TÀI LIỆU** — điền
 * bừa nó là tái diễn C-1 của Pha 4 (RAG rơi từ 91.678 xuống 237 chunk, **im lặng**).
 */

/**
 * ★★★ Khối mã trong câu hỏi — **MỘT LUẬT DUY NHẤT, KHÔNG PHỤ THUỘC XUỐNG DÒNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ HAI BẢN TRƯỚC ĐỀU SAI, VÀ BẢN THỨ HAI SAI VÌ NÓ NEO VÀO **XUỐNG DÒNG** — MỘT DẤU HIỆU
 *     KHÔNG NÓI GÌ VỀ VIỆC TOKEN ĐẦU LÀ NHÃN HAY LÀ MÃ.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * • Bản 1 (`\r?\n?` — xuống dòng **tuỳ chọn**): ```` ```G01 X1 Y2``` ```` ⇒ `X1 Y2`, **mất `G01`**.
 * • Bản 2 (xuống dòng **bắt buộc** mới là nhãn): vá được hai hình dạng viết liền, nhưng **đẻ ra
 *   hồi quy mới** — ```` ```gcode G01 X10``` ```` ⇒ `code = "gcode G01 X10"` (nhãn **lọt vào mã**),
 *   và ```` ```VAR⏎ x : BOOL;⏎END_VAR``` ```` **VẪN CỤT** (`VAR` đứng một mình dòng đầu là cách
 *   viết **CHUẨN IEC 61131-3 ST**, không phải ca hiếm).
 *   ⚠⚠ Và lưới của bản 2 khoá **đúng ba hình dạng bản vá làm đúng** ⇒ bốn hình dạng còn lại
 *   **cổng XANH 100%**. Đó là *"lưới khoá đúng cái vừa sửa"*: nó xác nhận bản vá, **không** canh
 *   một bất biến.
 *
 * ⇒ Luật đúng **không hỏi có xuống dòng hay không**, nó hỏi **token đầu LÀ GÌ**:
 *
 *   ***Token đầu của thân khối chỉ là NHÃN khi `kindFromLabel()` NHẬN RA nó là một ngôn ngữ lập
 *   trình. Ngược lại, TOÀN BỘ thân là MÃ.***
 *
 * Một luật, đóng cả sáu hình dạng, và **suy ra từ một nguồn đã có** (`KIND_HINTS`) chứ không từ
 * một bảng hình dạng fence — bảng nào cũng có hình dạng thứ N+1.
 */
const CODE_FENCE_BODY = /```([\s\S]*?)```/;
/** Token đầu của thân khối (bỏ qua khoảng trắng/xuống dòng đứng trước). */
const FENCE_FIRST_TOKEN = /^[ \t\r\n]*([A-Za-z0-9_+#-]+)/;

/**
 * Gợi ý `ProgrammingKind` theo từ khoá. ⚠ Thứ tự có nghĩa: mục **cụ thể hơn đứng trước**
 * (`iec61131-pou` / `-ld` trước `-st`, `robot-tm` trước `gcode`).
 * ⚠ Kiểu `ProgrammingKind` cưỡng chế: thêm một biến thể gõ sai ⇒ `tsc` ĐỎ.
 */
const KIND_HINTS: ReadonlyArray<readonly [RegExp, ProgrammingKind]> = [
  [/\bir[\s-]?flow\b/i, "ir-flow"],
  [/\bpou\b/i, "iec61131-pou"],
  [/\b(?:ladder|ld|bậc\s*thang)\b/i, "iec61131-ld"],
  [/\b(?:structured\s*text|iec\s*?61131|61131|st)\b/i, "iec61131-st"],
  [/\b(?:robot\s*tm|techman|tm\s*script|tmscript)\b/i, "robot-tm"],
  [/\bzmotion\b/i, "zmotion-basic"],
  [/\bmitsubishi\b/i, "mitsubishi-engineering"],
  [/\b(?:g[\s-]?code|cnc|phay\s*cnc)\b/i, "gcode"],
];

/**
 * ★★★ **NGUỒN DUY NHẤT** trả lời *"chuỗi này có phải TÊN MỘT NGÔN NGỮ không?"*.
 *
 * ⚠ Export để lưới `toolArgCoverage.test.ts` **dựng lượng từ từ chính nó** thay vì liệt kê hình
 * dạng fence: ca ở đó hỏi hàm này *"token đầu có phải nhãn không"* rồi mới khẳng định hệ quả.
 * Đổi `KIND_HINTS` ⇒ cả sản phẩm lẫn lưới đổi **cùng lúc**, không có bản sao thứ hai để lệch.
 */
export function kindFromLabel(token: string): ProgrammingKind | undefined {
  for (const [re, kind] of KIND_HINTS) if (re.test(token)) return kind;
  return undefined;
}

/** Thân khối mã tách thành (nhãn ngôn ngữ nếu có) + (mã). Xem luật ở `CODE_FENCE_BODY`. */
function splitFence(question: string): { label?: ProgrammingKind; code: string } | undefined {
  const body = question.match(CODE_FENCE_BODY)?.[1];
  if (body === undefined) return undefined;
  const dau = body.match(FENCE_FIRST_TOKEN);
  if (dau) {
    const kind = kindFromLabel(dau[1]!);
    if (kind !== undefined) {
      const conLai = body.slice(dau[0].length).trim();
      // ⚠ Nhãn mà **không còn gì phía sau** thì nó chính là mã — đừng trả về khối rỗng.
      if (conLai) return { label: kind, code: conLai };
    }
  }
  const code = body.trim();
  return code ? { code } : undefined;
}

/** Gợi ý `kind`: ưu tiên **nhãn của khối mã** (người dùng nói thẳng), rồi tới từ khoá trong câu. */
function guessProgrammingKind(question: string): ProgrammingKind | undefined {
  const nhan = splitFence(question)?.label;
  if (nhan) return nhan;
  for (const [re, kind] of KIND_HINTS) if (re.test(question)) return kind;
  return undefined;
}

/** Mã nguồn người dùng dán vào câu hỏi (khối ```…```). Trả `undefined` khi không có. */
function extractFencedCode(question: string): string | undefined {
  return splitFence(question)?.code;
}

/**
 * Mã lỗi/cảnh báo. Hai tầng: (1) token **sau một từ khoá** và **có chữ số** (`mã lỗi AL.E6`,
 * `error code F0301`); (2) dự phòng — một token **có hình dạng mã báo động** ở bất kỳ đâu.
 * ⚠ Đòi có chữ số để "lỗi servo" không biến chữ `servo` thành mã.
 */
const ERROR_CODE_KEYED_REGEX =
  /(?:mã\s*lỗi|mã\s*cảnh\s*báo|mã\s*báo\s*động|error\s*code|alarm\s*code|fault\s*code|错误代码|报警代码|故障代码|error|alarm|fault|code|lỗi)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9._-]{0,63})/i;
/**
 * ⚠ Lookahead `(?![A-Za-z0-9._-])` bắt token phải **TRỌN VẸN**. Không có nó, `L20260505-001`
 * (một **mã lô**) bị **cắt** thành `L20260505` và đi vào RAG như một mã lỗi — im lặng, và sai
 * theo kiểu khó thấy nhất: một chuỗi *trông giống* mã lỗi.
 */
const ERROR_CODE_SHAPE_REGEX = /\b([A-Za-z]{1,4}[._-]?[A-Za-z]?\d{1,6}[A-Za-z0-9]{0,8})(?![A-Za-z0-9._-])/g;

/**
 * ★★★ RR-4 — nhánh **dự phòng** không được nuốt **MÃ MÁY**.
 *
 * ⚠ *"mã lỗi của máy AOI-01"* ⇒ nhánh có-từ-khoá trượt (token `của` không có chữ số) ⇒ nhánh hình
 * dạng vớ luôn `AOI-01` và đi tra tài liệu hãng cho một **mã máy** — sai im lặng.
 * ⇒ Phép loại dùng **`MACHINE_CODE_REGEX` đã có sẵn trong chính file này** (chủ của khái niệm "mã
 * máy"), **không** đẻ một danh sách thứ hai. Điều kiện là khớp **TRỌN TOKEN**: `AL.E6`/`F0301`
 * không phải mã máy nên vẫn qua.
 * ⚠ Quét **toàn chuỗi** (`/g`) rồi bỏ qua token bị loại — nếu chỉ lấy khớp ĐẦU TIÊN thì một mã máy
 * đứng trước sẽ che mất mã lỗi thật đứng sau.
 * ⚠ Nhánh **có từ khoá** KHÔNG đổi: người dùng viết thẳng *"mã lỗi ER-12"* thì `ER-12` là ý họ.
 */
function extractErrorCode(question: string): string | undefined {
  const keyed = question.match(ERROR_CODE_KEYED_REGEX)?.[1];
  if (keyed && /\d/.test(keyed)) return keyed;
  for (const m of question.matchAll(ERROR_CODE_SHAPE_REGEX)) {
    const token = m[1]!;
    const may = token.match(MACHINE_CODE_REGEX);
    if (may && may[1] === token) continue; // là MÃ MÁY, không phải mã lỗi
    return token;
  }
  return undefined;
}

/**
 * Đường dẫn file người dùng nêu. ⚠ Trả **NGUYÊN VĂN** — `..`, đường tuyệt đối, dấu `\` đều đi
 * qua để **cửa** `confineTarget()` là cái từ chối (xem nguyên tắc ở đầu khối).
 */
const FILE_PATH_REGEX =
  /(?:đọc|mở|xem|read|open|nội\s*dung|cat)?\s*(?:file|tệp|tập\s*tin)\s*[:：]?\s*["'`]?([^\s"'`]{1,1024})/i;
const FILE_PATH_CJK_REGEX = /(?:读取|打开|查看)?\s*文件\s*[:：]?\s*["'`]?([^\s"'`]{1,1024})/;

function extractProjectPath(question: string): string | undefined {
  return question.match(FILE_PATH_REGEX)?.[1] ?? question.match(FILE_PATH_CJK_REGEX)?.[1];
}

/**
 * Biểu thức số học. Cắt phần mở đầu (từ khoá + vài từ đệm lịch sự) và phần đuôi hỏi han, rồi
 * **giao nguyên phần còn lại** cho hộp cát.
 *
 * ⚠ **Tiền điều kiện là HÌNH DẠNG, không phải AN TOÀN.** Nó tồn tại để `calc` không cướp câu
 * NGHIỆP VỤ, **không** để lọc nội dung thù địch — mọi biểu thức thoát hộp cát (`2 * constructor(3)`
 * · `1 + toString(2)` · `0 + __proto__(1)` · `2 * ("3")` · `2 * 3 & 4` · `9^9^9`) **thoả** tiền
 * điều kiện và **phải** tới được hộp cát để bị từ chối **ở đó**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ I-2 (review) — **BẢN ĐẦU LÀ MỘT HỒI QUY SẢN PHẨM DO CHÍNH TASK NÀY TẠO RA.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Tiền điều kiện cũ chỉ đòi *"có chữ số VÀ có một trong `+-*​/%^(`"*. Nhưng **mã máy / mã lô / mã
 * chuyền của hệ LUÔN có `-`** (`AOI-01`, `L20260505-001`, `L-01`) và đơn vị thường có `/` (`mm/s`)
 * ⇒ **đo được 6/24** câu nghiệp vụ đổi từ *"về KB"* sang *"thẻ `calc` báo lỗi"*. Người review đo
 * **9/14** trên bộ câu của họ. Đây là **hồi quy thật**, không phải mối lo lý thuyết.
 *
 * Ba điều kiện thay thế, **không cái nào phán xét nội dung**:
 *  1. **HÌNH DẠNG SỐ HỌC** — một toán tử **nhị phân** giữa hai toán hạng, **hoặc** một lượt **gọi
 *     hàm** `ident(`. `AOI-01` không thoả (dấu `-` đứng sau một CHỮ CÁI, không phải toán hạng).
 *  2. **KHÔNG PHẢI VĂN XUÔI** — không có từ ASCII ≥3 chữ đứng **rời** (không ngay trước `(`).
 *     `constructor(`/`toString(`/`__proto__(` **được giữ**; `tinh ti le loi cua lo` bị loại.
 *  3. **THUẦN ASCII** — mọi ký tự ngoài ASCII (tiếng Việt có dấu, Hán tự) làm bộ tách từ của hộp
 *     cát ném `illegal character` **chắc chắn**; định tuyến một câu như vậy vào `calc` chỉ đổi một
 *     câu trả lời KB lấy một thẻ báo lỗi. ⚠ Đây **KHÔNG** phải bản sao bảng chữ của bộ tách từ:
 *     nó **hẹp hơn hẳn** — `"`, `&`, `$`, `#` đều là ASCII và **vẫn đi qua** để hộp cát từ chối.
 */
/**
 * Toán tử NHỊ PHÂN giữa hai toán hạng: `2+3` · `(1+2)*3` · `9^9` · `2 * (` · `1 + sqrt`.
 *
 * ⚠⚠ **RR-3 — ĐÁNH ĐỔI THẬT, ghi cho đúng**: toán hạng **TRÁI** phải là **chữ số** hoặc `)`. Nên
 * **mọi** biểu thức mở đầu bằng một **hằng đứng rời** đều **không** với tới được từ NL:
 * `pi * 2` · `e * 3` · `tau / 2` đều trả `null`. Viết `2 * pi` / `3 * e` thì được.
 * ⚠ Vì sao **không** nới toán hạng trái sang `[A-Za-z_]`: làm thế thì `AOI-01` khớp lại
 * (`I` `-` `0`) và **hồi quy I-2 sống dậy** — đúng thứ vừa mất một vòng để đóng.
 * (Ca `★★ ĐỐI CHỨNG DƯƠNG cho I-2` khoá cả hai chiều của đánh đổi này.)
 */
const CALC_SHAPE_BINARY = /(?:\d|\))\s*[+\-*/%^]\s*(?:[\d(.]|[A-Za-z_])/;
/** Một lượt GỌI HÀM: `sqrt(` · `constructor(` · `__proto__(`. */
const CALC_SHAPE_CALL = /[A-Za-z_][A-Za-z0-9_]*\s*\(/;
/** ⚠ `\b` BẮT BUỘC: không có nó, quay lui làm `constructor(` khớp qua tiền tố `onstructo`. */
const CALC_PROSE_WORD = /[A-Za-z_][A-Za-z0-9_]{2,}\b(?!\s*\()/;
const CALC_NON_ASCII = /[^\x00-\x7F]/;
const CALC_TRIGGER_REGEX = /^[\s\S]*?(?:tính\s*toán|tính|calculate|calc|compute|计算)\s*[:：]?\s*/i;
const CALC_FILLER_REGEX =
  /^(?:\s*(?:giúp|giùm|dùm|hộ|cho|tôi|mình|em|anh|chị|với|xem|thử|nhanh|nhé|please|me|for|the|this)\b)+/i;
const CALC_TAIL_REGEX =
  /\s*(?:bằng\s*bao\s*nhiêu|là\s*bao\s*nhiêu|ra\s*bao\s*nhiêu|bao\s*nhiêu|được\s*bao\s*nhiêu|等于多少|是多少)\s*$/i;

function extractExpression(question: string): string | undefined {
  let s = question;
  const m = CALC_TRIGGER_REGEX.exec(s);
  if (m) s = s.slice(m[0].length);
  s = s.replace(CALC_FILLER_REGEX, "");
  s = s.replace(CALC_TAIL_REGEX, "");
  s = s.replace(/[\s?？!！。;；]+$/u, "").trim();
  if (s.length === 0 || s.length > 400) return undefined;
  if (!/\d/.test(s)) return undefined;
  if (CALC_NON_ASCII.test(s)) return undefined;
  if (CALC_PROSE_WORD.test(s)) return undefined;
  if (!CALC_SHAPE_BINARY.test(s) && !CALC_SHAPE_CALL.test(s)) return undefined;
  return s;
}

function normalizeText(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * ★★★ Pha 6 Task 3 (F2) — vị từ **DUY NHẤT** trả lời *"tool này có thể được chọn bằng chấm điểm
 * trigger không?"*. `findToolByTriggers` dùng chính nó; lưới `toolArgCoverage.test.ts` cũng dùng
 * chính nó để dựng lượng từ.
 * ⚠ **Đừng chép một bản sao thứ hai của vị từ này ở đâu khác** — hai bản sao trùng nhau hôm nay
 * sẽ lệch nhau ngày mai, và lượng từ sẽ canh một tập khác với tập thật (lớp lỗi đã trả giá).
 */
export function chonDuocTheoTrigger(tool: Tool): boolean {
  // Write/client tools are only matched via dedicated shortcuts or the LLM
  // router (which enforce required args / route whitelist) — never via generic
  // trigger scoring.
  return tool.kind !== "write" && tool.kind !== "client";
}

function findToolByTriggers(question: string): Tool | null {
  const norm = normalizeText(question);
  let best: { tool: Tool; score: number } | null = null;
  for (const tool of listTools()) {
    if (!chonDuocTheoTrigger(tool)) continue;
    let score = 0;
    for (const trigger of tool.triggers) {
      if (norm.includes(trigger.toLowerCase())) {
        // Longer triggers are stronger signals.
        score += trigger.length;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { tool, score };
    }
  }
  return best?.tool ?? null;
}

/**
 * ★★★ Pha 6 Task 3 (F2) — **NHÁNH `default` PHẢI PHÂN BIỆT ĐƯỢC VỚI "một tool không cần tham số".**
 *
 * ⚠⚠⚠ Bản trước viết `case "get_today_stats": default: return {};` — nghĩa là *"tool này không cần
 * tham số"* và *"tôi KHÔNG BIẾT tool này"* trả **cùng một giá trị**. Hậu quả đo được: **8 tool**
 * (`readToolsProgramming`) rơi vào `default`, nhận `{}`, `safeParse` hỏng ⇒ `INVALID_ARGS` ⇒
 * `tool: null` — chúng **chết trên đường Agent ngôn ngữ tự nhiên** qua **hai pha**, và **không lưới
 * nào đỏ**, vì không ai **hỏi được** câu *"tool này có đường lấy tham số không?"*.
 *
 * ⇒ Nhánh `default` nay trả `KHONG_CO_DUONG`. `extractArgsForTool()` quy nó về `{}` nên **hành vi
 * của 41 nhánh cũ không đổi một byte**; nhưng câu hỏi kia **giờ hỏi được** —
 * `hasArgExtractionPath()` — và lượng từ *"MỌI tool chọn được theo trigger PHẢI có đường lấy tham
 * số HOẶC nhận `{}`"* mới phát biểu được (`toolArgCoverage.test.ts`).
 */
const KHONG_CO_DUONG = Symbol("khong-co-duong-lay-tham-so");

function extractArgsRaw(
  toolName: string,
  question: string,
  context?: ToolContext,
): Record<string, unknown> | typeof KHONG_CO_DUONG {
  switch (toolName) {
    case "get_lot_status": {
      const m =
        question.match(ORDER_CODE_REGEX) ??
        question.match(ORDER_CODE_PREFIX_VI) ??
        question.match(BARE_LOT_CODE_REGEX);
      // Priority: code from question > context selection.
      const orderCode = m?.[1] ?? context?.selectedLot;
      return orderCode ? { orderCode } : {};
    }
    case "get_machine_status": {
      const offline = OFFLINE_REGEX.test(question);
      return offline ? { onlyOffline: true } : { onlyOffline: false };
    }
    case "get_defect_trend": {
      const m = question.match(DAYS_REGEX);
      const days = m ? Math.max(2, Math.min(30, parseInt(m[1]!, 10))) : 7;
      return { days };
    }
    case "get_top_defects": {
      const m = question.match(DAYS_REGEX);
      const days = m ? Math.max(1, Math.min(30, parseInt(m[1]!, 10))) : 7;
      return { days, limit: 5 };
    }
    case "get_factory_stats": {
      const m = question.match(DAYS_REGEX);
      const days = m ? Math.max(1, Math.min(30, parseInt(m[1]!, 10))) : 1;
      return { days };
    }
    case "get_ng_compare": {
      const period = WEEK_COMPARE_INTENT.test(question) ? "week" : "month";
      return { period };
    }
    case "get_oee": {
      const m = question.match(DAYS_REGEX);
      const days = m ? Math.max(1, Math.min(30, parseInt(m[1]!, 10))) : 7;
      // Priority: machine code from question > context selection. Lets
      // "OEE máy này?" on a machine page resolve without typing the code.
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      return code ? { machineCode: code, days } : { days };
    }
    case "get_model_metrics": {
      const m = question.match(DAYS_REGEX);
      const days = m ? Math.max(1, Math.min(30, parseInt(m[1]!, 10))) : 7;
      return { days, limit: 5 };
    }
    case "set_spec_limits": {
      const idMatch = question.match(MP_ID_REGEX);
      const usl = question.match(USL_REGEX);
      const lsl = question.match(LSL_REGEX);
      const target = question.match(TARGET_REGEX);
      const args: Record<string, unknown> = {
        usl: usl ? Number(usl[1]) : null,
        lsl: lsl ? Number(lsl[1]) : null,
        target: target ? Number(target[1]) : null,
      };
      if (idMatch) args.measurementPointDefId = Number(idMatch[1]);
      return args;
    }
    case "get_machine_process_result": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(30, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 1;
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const serial = question.match(SERIAL_REGEX)?.[1];
      const args: Record<string, unknown> = { days, limit: 20 };
      if (code) args.machineCode = code;
      if (serial) args.serialNumber = serial;
      return args;
    }
    case "get_process_metric_trend": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(30, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 7;
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const { metricKey, stepType } = mapProcessMetric(question);
      const args: Record<string, unknown> = { metricKey, days, source: "process", bucket: "hour" };
      if (code) args.machineCode = code;
      if (stepType) args.stepType = stepType;
      return args;
    }
    // doc 56 Đ6 — device-standardization persona tools.
    case "get_device_health": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(30, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 7;
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const args: Record<string, unknown> = { days };
      if (code) args.machineCode = code;
      // Only pin an SPC metric when the user NAMES one; otherwise the handler
      // infers the primary metric from the machine's own data (mapProcessMetric
      // defaults to "value", which would force SPC onto a non-existent key).
      if (/torque|lực\s*siết|mô-?men|keo|dispense|cycle\s*time|thời\s*gian\s*chu\s*kỳ/i.test(question)) {
        args.metricKey = mapProcessMetric(question).metricKey;
      }
      return args;
    }
    case "get_fleet_process_summary": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(90, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 7;
      const args: Record<string, unknown> = { days };
      if (/\b(automation|tự\s*động|bắt\s*vít|điểm\s*keo|hàn)\b/i.test(question)) args.deviceClass = "automation";
      else if (/\b(iot|cảm\s*biến|sensor|gateway)\b/i.test(question)) args.deviceClass = "iot";
      else if (/\b(aoi|avi|spi|kiểm\s*tra\s*quang|quang\s*học)\b/i.test(question)) args.deviceClass = "aoi_avi";
      return args;
    }
    case "get_line_balance": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(14, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 1;
      const lineCode = question.match(LINE_CODE_REGEX)?.[1];
      const args: Record<string, unknown> = { days };
      if (lineCode) args.lineCode = lineCode;
      return args;
    }
    case "analyze_line_bottleneck": {
      const days = question.match(DAYS_REGEX) ? Math.max(2, Math.min(30, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 7;
      const lineCode = question.match(LINE_CODE_REGEX)?.[1];
      const args: Record<string, unknown> = { days };
      if (lineCode) args.lineCode = lineCode;
      return args;
    }
    case "get_packaging_throughput": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(14, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 1;
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const lineCode = question.match(LINE_CODE_REGEX)?.[1];
      const args: Record<string, unknown> = { days };
      if (code) args.machineCode = code;
      if (lineCode) args.lineCode = lineCode;
      return args;
    }
    case "get_palletizer_status": {
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      return code ? { machineCode: code } : {};
    }
    case "get_ot_telemetry_latest": {
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const limit = 10;
      return code ? { machineCode: code, limit } : { limit };
    }
    case "correlate_process_quality": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(30, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 7;
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const mapped = mapCorrelationArgs(question);
      const args: Record<string, unknown> = { days };
      if (mapped) {
        args.upstreamStepType = mapped.upstreamStepType;
        args.metricKey = mapped.metricKey;
      }
      if (code) args.machineCode = code;
      return args;
    }
    // ─── Phase B4 — Management/Analytics READ tools ───────────────────────────
    case "analytics_query_oee": {
      const period = MONTH_COMPARE_INTENT.test(question)
        ? "month"
        : WEEK_COMPARE_INTENT.test(question)
          ? "week"
          : "week";
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const args: Record<string, unknown> = { period, compareToPrior: true };
      if (code) args.machineCode = code;
      return args;
    }
    case "analytics_defect_pareto": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(90, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 7;
      // "theo máy" / "by machine" → group by machine, else by defect type.
      const byMachine = /\b(theo\s*máy|by\s*machine|máy\s*lỗi|máy\s*gây\s*lỗi)\b/i.test(question);
      return { groupBy: byMachine ? "machine" : "defectType", days, topN: 5 };
    }
    case "analytics_defect_heatmap_summary": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(90, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 7;
      return { days, topN: 5 };
    }
    case "analytics_query_yield": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(180, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 14;
      const interval = MONTH_COMPARE_INTENT.test(question) ? "month" : WEEK_COMPARE_INTENT.test(question) ? "week" : "day";
      return { days, interval };
    }
    case "analytics_spc_status": {
      const days = question.match(DAYS_REGEX) ? Math.max(1, Math.min(90, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 14;
      return { days, sigma: 3 };
    }
    case "analytics_pdm_forecast": {
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      return code ? { machineCode: code } : {};
    }
    case "analytics_forecast_series": {
      const days = question.match(DAYS_REGEX) ? Math.max(3, Math.min(180, parseInt(question.match(DAYS_REGEX)![1]!, 10))) : 30;
      const metric = /\b(throughput|sản\s*lượng|năng\s*suất)\b/i.test(question) ? "throughput" : "yield";
      return { metric, days, horizon: 7, algorithm: "ewma" };
    }
    // ─── Phase P2 (group A) — high-priority READ tools ────────────────────────
    case "list_work_orders": {
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const args: Record<string, unknown> = { limit: 10 };
      if (/\b(đang\s*mở|chưa\s*xong|open)\b/i.test(question)) args.status = "open";
      else if (/\b(đang\s*làm|in\s*progress|đang\s*xử\s*lý)\b/i.test(question)) args.status = "in_progress";
      else if (/\b(đã\s*xong|hoàn\s*thành|done|completed)\b/i.test(question)) args.status = "done";
      if (code) args.machineCode = code;
      return args;
    }
    case "list_active_alerts": {
      const args: Record<string, unknown> = { limit: 10 };
      if (/\b(chưa\s*xác\s*nhận|chưa\s*ack|unacknowledged)\b/i.test(question)) args.acknowledged = false;
      else if (/\b(đã\s*xác\s*nhận|đã\s*ack|acknowledged)\b/i.test(question)) args.acknowledged = true;
      const sev = question.match(/\b(LOW|MEDIUM|HIGH|CRITICAL)\b/i)?.[1];
      if (sev) args.severity = sev.toUpperCase();
      return args;
    }
    case "list_thresholds": {
      const args: Record<string, unknown> = { limit: 15 };
      const mp = question.match(MP_ID_REGEX);
      if (mp) {
        // A named/coded point — pass the raw token so the ilike filter can match.
        args.measurementPoint = mp[1];
      }
      return args;
    }
    case "list_recipes": {
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const args: Record<string, unknown> = { limit: 15 };
      if (code) args.machineCode = code;
      return args;
    }
    // ─── Phase P2 (groups B & C) — additional READ tools ──────────────────────
    case "list_products": {
      const args: Record<string, unknown> = { limit: 15 };
      // "BOM của <code>" / "BOM cho <code>" → include that product's BOM.
      const bom = question.match(/\bbom\s*(?:của|cho|of)?\s*([A-Z0-9][A-Z0-9._-]{1,99})\b/i);
      const code = bom?.[1] ?? question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedProductCode;
      if (bom && code) {
        args.productCode = code;
      } else {
        // Free-text search term after "sản phẩm"/"product".
        const s = question.match(/\b(?:sản\s*phẩm|product)\s+([A-Za-z0-9][A-Za-z0-9._-]{1,99})\b/i)?.[1];
        if (s) args.search = s;
        else if (context?.selectedProductCode) args.search = context.selectedProductCode;
      }
      return args;
    }
    case "get_rca_history": {
      const args: Record<string, unknown> = { limit: 10 };
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      if (code) args.machineCode = code;
      // "nguyên nhân lỗi <X>" / "root cause of <X>" → defectType.
      const dt = question.match(/\b(?:nguyên\s*nhân\s*lỗi|lỗi|defect|root\s*cause\s*(?:of|cho)?)\s+([A-Za-z0-9][A-Za-z0-9_-]{1,119})\b/i)?.[1];
      if (dt && !args.machineCode) args.defectType = dt;
      return args;
    }
    case "list_users_by_role": {
      const args: Record<string, unknown> = { limit: 20 };
      const role = question.match(/\b(admin|supervisor|operator|maintenance|viewer|manager|user|quality|engineer)\b/i)?.[1];
      if (role) args.role = role.toLowerCase();
      const factory = question.match(/\b(?:nhà\s*máy|factory)\s+([A-Za-z0-9][A-Za-z0-9_-]{1,49})\b/i)?.[1];
      if (factory) args.factoryCode = factory;
      return args;
    }
    case "list_api_keys": {
      const args: Record<string, unknown> = { limit: 20 };
      if (/\b(còn\s*hiệu\s*lực|đang\s*hoạt\s*động|active)\b/i.test(question)) args.active = true;
      else if (/\b(thu\s*hồi|hết\s*hạn|revoked|inactive|vô\s*hiệu)\b/i.test(question)) args.active = false;
      return args;
    }
    case "get_change_history": {
      const args: Record<string, unknown> = { limit: 15 };
      const m = question.match(DAYS_REGEX);
      if (m) args.sinceDays = Math.max(1, Math.min(365, parseInt(m[1]!, 10)));
      const et = question.match(/\b(?:đối\s*tượng|entity|loại)\s+([A-Za-z][A-Za-z_]{1,99})\b/i)?.[1];
      if (et) args.entityType = et.toLowerCase();
      return args;
    }
    case "get_machine_health": {
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const args: Record<string, unknown> = { limit: 15 };
      if (code) args.machineCode = code;
      return args;
    }
    // ─── Phase P2 (group D) — anomalies, genealogy, energy, routing ───────────
    case "list_anomalies": {
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const args: Record<string, unknown> = { limit: 15 };
      if (code) args.machineCode = code;
      const sev = question.match(/\b(LOW|MEDIUM|HIGH|CRITICAL)\b/i)?.[1];
      if (sev) args.severity = sev.toUpperCase();
      return args;
    }
    case "trace_genealogy": {
      const args: Record<string, unknown> = { limit: 20 };
      const serial = question.match(SERIAL_REGEX)?.[1] ?? context?.selectedLot;
      // "lô <code>" / "lot <code>" → lotId (use the ORDER_CODE regex family).
      const lot =
        question.match(/\b(?:lô|lot)\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]{2,79})\b/i)?.[1];
      if (serial && /\b(?:serial|sn|s\/n)\b/i.test(question)) args.serialNumber = serial;
      else if (lot) args.lotId = lot;
      else if (serial) args.serialNumber = serial;
      return args;
    }
    case "get_energy_metrics": {
      const code = question.match(MACHINE_CODE_REGEX)?.[1] ?? context?.selectedMachineCode;
      const m = question.match(DAYS_REGEX);
      const sinceDays = m ? Math.max(1, Math.min(365, parseInt(m[1]!, 10))) : 7;
      const args: Record<string, unknown> = { sinceDays, limit: 20 };
      if (code) args.machineCode = code;
      return args;
    }
    case "get_routing": {
      const args: Record<string, unknown> = { limit: 20 };
      const lineCode = question.match(LINE_CODE_REGEX)?.[1];
      if (lineCode) args.lineCode = lineCode;
      // "quy trình của <product>" / "routing of <product>" → productCode.
      const prod =
        question.match(/\b(?:sản\s*phẩm|product)\s+([A-Za-z0-9][A-Za-z0-9._-]{1,99})\b/i)?.[1] ??
        context?.selectedProductCode;
      if (!lineCode && prod) args.productCode = prod;
      return args;
    }
    // ─── Doc 34 P2 / Pha 6 Task 3 (F2) — nhóm tool LẬP TRÌNH ──────────────────
    // ⚠ Không nhánh nào dưới đây đặt ô `lang` (xem nguyên tắc ở khối `KIND_HINTS`), và không
    //   nhánh nào làm sạch chuỗi người dùng — handler mới là nơi phán xét.
    case "retrieve_programming_kb": {
      // Cả câu hỏi LÀ truy vấn RAG. ⚠ KHÔNG đoán `vendor`: đoán sai là **lọc mất** kho đúng, im
      //   lặng — cùng lớp lỗi với ô `lang` (C-1 của Pha 4).
      const query = question.trim().slice(0, 500);
      return query ? { query } : {};
    }
    case "lookup_error_code": {
      const code = extractErrorCode(question);
      return code ? { code } : {};
    }
    case "syntax_check_program":
    case "compile_program":
    case "simulate_program": {
      const args: Record<string, unknown> = {};
      const kind = guessProgrammingKind(question);
      const code = extractFencedCode(question);
      if (kind) args.kind = kind;
      if (code) args.code = code;
      return args;
    }
    case "generate_program": {
      const args: Record<string, unknown> = { request: question.trim().slice(0, 4000) };
      const kind = guessProgrammingKind(question);
      if (kind) args.kind = kind;
      return args;
    }
    case "calc": {
      const expression = extractExpression(question);
      return expression ? { expression } : {};
    }
    case "read_project_file": {
      const p = extractProjectPath(question);
      return p ? { path: p } : {};
    }
    case "get_today_stats":
      // Tool KHÔNG có tham số nào — `{}` ở đây là một câu trả lời ĐẦY ĐỦ, khác hẳn nhánh dưới.
      return {};
    default:
      // ⚠ KHÔNG trả `{}` ở đây. Xem khối lý lẽ trên `KHONG_CO_DUONG`.
      return KHONG_CO_DUONG;
  }
}

/**
 * Đối số cho một lượt gọi tool, suy ra từ câu hỏi. Tool **không có** nhánh riêng nhận `{}` —
 * **hành vi y hệt bản trước bản vá F2**.
 */
export function extractArgsForTool(
  toolName: string,
  question: string,
  context?: ToolContext,
): Record<string, unknown> {
  const r = extractArgsRaw(toolName, question, context);
  return r === KHONG_CO_DUONG ? {} : r;
}

/**
 * ★★★ Pha 6 Task 3 (F2) — *"tool này có một đường lấy tham số riêng không?"*.
 *
 * ⚠ Câu trả lời **suy ra từ chính bộ điều phối** (`extractArgsRaw` chạy thật), **không** từ một
 * danh sách tên chép lại — danh sách nào cũng có phần tử thứ N+1. Ai "vá" bằng cách trả `{}` ở
 * nhánh `default` sẽ làm ca cầu chì *"một tên không tồn tại phải trả `false`"* ĐỎ.
 */
export function hasArgExtractionPath(toolName: string): boolean {
  return extractArgsRaw(toolName, "", undefined) !== KHONG_CO_DUONG;
}

/**
 * Classify a question and decide whether to invoke a tool.
 *
 * Returns `{ tool: null }` when no tool is appropriate — the caller should
 * proceed with the standard KB retrieval flow.
 */
export function classifyToolIntent(question: string, context?: ToolContext): ToolDecision {
  if (!question || question.trim().length < 2) {
    return { tool: null, args: {}, reason: "EMPTY" };
  }

  // ─── Phase B4 analytics short-circuits (HIGHEST priority) ─────────────────
  // Run before the OEE/period-compare/factory shortcuts so the parameterized,
  // RBAC-gated analytics tools win for management/analysis questions.
  if (PDM_INTENT.test(question)) {
    const d = tryAnalyticsTool("analytics_pdm_forecast", "PDM_FORECAST_SHORTCUT", question, context);
    if (d) return d;
  }
  if (FORECAST_SERIES_INTENT.test(question)) {
    const d = tryAnalyticsTool("analytics_forecast_series", "FORECAST_SERIES_SHORTCUT", question, context);
    if (d) return d;
  }
  if (DEFECT_HEATMAP_INTENT.test(question)) {
    const d = tryAnalyticsTool("analytics_defect_heatmap_summary", "DEFECT_HEATMAP_SHORTCUT", question, context);
    if (d) return d;
  }
  if (DEFECT_PARETO_INTENT.test(question)) {
    const d = tryAnalyticsTool("analytics_defect_pareto", "DEFECT_PARETO_SHORTCUT", question, context);
    if (d) return d;
  }
  if (SPC_INTENT.test(question)) {
    const d = tryAnalyticsTool("analytics_spc_status", "SPC_STATUS_SHORTCUT", question, context);
    if (d) return d;
  }
  if (OEE_PERIOD_COMPARE_INTENT.test(question)) {
    const d = tryAnalyticsTool("analytics_query_oee", "OEE_COMPARE_SHORTCUT", question, context);
    if (d) return d;
  }
  if (YIELD_INTENT.test(question)) {
    const d = tryAnalyticsTool("analytics_query_yield", "YIELD_QUERY_SHORTCUT", question, context);
    if (d) return d;
  }

  // High-priority short-circuits BEFORE generic trigger matching, because
  // some keywords ("hôm nay", "NG") would otherwise grab today_stats.
  if (MONTH_COMPARE_INTENT.test(question) || WEEK_COMPARE_INTENT.test(question)) {
    const args = extractArgsForTool("get_ng_compare", question, context);
    const tool = getTool("get_ng_compare");
    if (tool) {
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: "get_ng_compare", args: parsed.data as Record<string, unknown>, reason: "PERIOD_COMPARE_SHORTCUT" };
      }
    }
  }
  if (OEE_INTENT.test(question)) {
    const args = extractArgsForTool("get_oee", question, context);
    const tool = getTool("get_oee");
    if (tool) {
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: "get_oee", args: parsed.data as Record<string, unknown>, reason: "OEE_SHORTCUT" };
      }
    }
  }
  if (FACTORY_AGG_INTENT.test(question)) {
    const args = extractArgsForTool("get_factory_stats", question, context);
    const tool = getTool("get_factory_stats");
    if (tool) {
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: "get_factory_stats", args: parsed.data as Record<string, unknown>, reason: "FACTORY_AGG_SHORTCUT" };
      }
    }
  }
  if (MODEL_RANKING_INTENT.test(question)) {
    const args = extractArgsForTool("get_model_metrics", question, context);
    const tool = getTool("get_model_metrics");
    if (tool) {
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: "get_model_metrics", args: parsed.data as Record<string, unknown>, reason: "MODEL_RANKING_SHORTCUT" };
      }
    }
  }

  // GĐ2 write-tool shortcut — recognize "đặt/cập nhật spec/USL/LSL điểm đo".
  // Requires a measurement-point id AND at least one of USL/LSL/Target; else
  // ask for clarification (don't propose an under-specified write action).
  if (SET_SPEC_INTENT.test(question)) {
    const tool = getTool("set_spec_limits");
    if (tool) {
      const args = extractArgsForTool("set_spec_limits", question, context);
      const hasId = typeof args.measurementPointDefId === "number";
      const hasAnyValue = args.usl !== null || args.lsl !== null || args.target !== null;
      if (!hasId || !hasAnyValue) {
        return {
          tool: null,
          args: {},
          reason: "MISSING_SPEC_ARGS",
          clarifyMessage: buildClarifyMessage("MISSING_SPEC_ARGS", question),
        };
      }
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: "set_spec_limits", args: parsed.data as Record<string, unknown>, reason: "SET_SPEC_SHORTCUT" };
      }
      return {
        tool: null,
        args: {},
        reason: "MISSING_SPEC_ARGS",
        clarifyMessage: buildClarifyMessage("MISSING_SPEC_ARGS", question),
      };
    }
  }

  // ─── Sprint F6 short-circuits (BEFORE generic trigger scoring) ─────────────
  // Order matters: correlation wins over a bare metric trend when "tương quan"
  // is present (both mention torque/keo).
  if (CORRELATION_INTENT.test(question)) {
    const tool = getTool("correlate_process_quality");
    if (tool) {
      const args = extractArgsForTool("correlate_process_quality", question, context);
      if (!args.upstreamStepType || !args.metricKey) {
        return {
          tool: null,
          args: {},
          reason: "MISSING_CORRELATION_ARGS",
          clarifyMessage: buildClarifyMessage("MISSING_CORRELATION_ARGS", question),
        };
      }
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: "correlate_process_quality", args: parsed.data as Record<string, unknown>, reason: "CORRELATION_SHORTCUT" };
      }
      return {
        tool: null,
        args: {},
        reason: "MISSING_CORRELATION_ARGS",
        clarifyMessage: buildClarifyMessage("MISSING_CORRELATION_ARGS", question),
      };
    }
  }
  if (PALLETIZER_INTENT.test(question)) {
    const tool = getTool("get_palletizer_status");
    if (tool) {
      const args = extractArgsForTool("get_palletizer_status", question, context);
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: "get_palletizer_status", args: parsed.data as Record<string, unknown>, reason: "PALLETIZER_SHORTCUT" };
      }
    }
  }
  if (PACKAGING_INTENT.test(question)) {
    const tool = getTool("get_packaging_throughput");
    if (tool) {
      const args = extractArgsForTool("get_packaging_throughput", question, context);
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: "get_packaging_throughput", args: parsed.data as Record<string, unknown>, reason: "PACKAGING_SHORTCUT" };
      }
    }
  }
  if (LINE_BALANCE_INTENT.test(question)) {
    // Forecast wording → route to the bottleneck INSIGHT tool.
    const toolName = BOTTLENECK_FORECAST_HINT.test(question) ? "analyze_line_bottleneck" : "get_line_balance";
    const tool = getTool(toolName);
    if (tool) {
      const args = extractArgsForTool(toolName, question, context);
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: toolName, args: parsed.data as Record<string, unknown>, reason: "LINE_BALANCE_SHORTCUT" };
      }
    }
  }
  if (TELEMETRY_INTENT.test(question)) {
    const tool = getTool("get_ot_telemetry_latest");
    if (tool) {
      const args = extractArgsForTool("get_ot_telemetry_latest", question, context);
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: "get_ot_telemetry_latest", args: parsed.data as Record<string, unknown>, reason: "TELEMETRY_SHORTCUT" };
      }
    }
  }
  if (PROCESS_TREND_INTENT.test(question)) {
    const tool = getTool("get_process_metric_trend");
    if (tool) {
      const args = extractArgsForTool("get_process_metric_trend", question, context);
      const parsed = tool.parameters.safeParse(args);
      if (parsed.success) {
        return { tool: "get_process_metric_trend", args: parsed.data as Record<string, unknown>, reason: "PROCESS_TREND_SHORTCUT" };
      }
    }
  }

  const matched = findToolByTriggers(question);
  if (!matched) {
    return {
      tool: null,
      args: {},
      reason: "NO_TRIGGER_MATCH",
      clarifyMessage: buildClarifyMessage("NO_TRIGGER_MATCH", question),
    };
  }

  const args = extractArgsForTool(matched.name, question, context);

  // Required-arg validation: lot_status needs orderCode. If missing, fall back to no-tool.
  if (matched.name === "get_lot_status" && !args.orderCode) {
    return {
      tool: null,
      args: {},
      reason: "MISSING_ORDER_CODE",
      clarifyMessage: buildClarifyMessage("MISSING_ORDER_CODE", question),
    };
  }

  // Validate against zod schema; reject if shape doesn't match.
  const tool = getTool(matched.name);
  if (!tool) {
    return { tool: null, args: {}, reason: "TOOL_NOT_FOUND" };
  }
  const parsed = tool.parameters.safeParse(args);
  if (!parsed.success) {
    return { tool: null, args: {}, reason: `INVALID_ARGS:${parsed.error.message}` };
  }

  return { tool: matched.name, args: parsed.data as Record<string, unknown>, reason: "HEURISTIC_MATCH" };
}

// ─── LLM-based fallback ────────────────────────────────────────────────────

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_QA_MODEL = process.env.OLLAMA_QA_MODEL ?? "qwen2.5-instruct";
// Read at call-time (not module-load) so tests/runtime config toggles take effect.
const llmFallbackEnabled = () => process.env.AI_TOOL_LLM_FALLBACK === "1";

// WS-G4 — rollback switch. Default (false) → classify intent via bundled GGUF engine
// (grammar-constrained JSON, no Ollama daemon). USE_LEGACY_OLLAMA=true → legacy HTTP path.
const useLegacyOllama = () => (process.env.USE_LEGACY_OLLAMA ?? "false").toLowerCase() === "true";

// Fixed JSON schema for grammar-constrained decoding (GBNF). Guarantees parseable JSON
// with at least { tool: string }; args is an optional free-form object validated by zod below.
const TOOL_INTENT_SCHEMA = {
  type: "object",
  properties: {
    tool: { type: "string" },
    args: { type: "object" },
  },
  required: ["tool"],
} as const;

function buildClassifierPrompt(question: string): string {
  const toolDescriptions = listTools()
    .map((t) => {
      const tag = t.kind === "write" ? " [WRITE]" : t.kind === "client" ? " [CLIENT]" : "";
      return `  - ${t.name}${tag}: ${t.description}`;
    })
    .join("\n");
  return [
    "Bạn là bộ phân loại ý định cho hệ thống SYNAPSE. Chọn DUY NHẤT một tool phù hợp",
    "với câu hỏi của người dùng (hoặc \"none\" nếu không tool nào phù hợp).",
    "Tool [WRITE] là hành động thay đổi dữ liệu (sẽ cần người dùng xác nhận sau).",
    "Tool [CLIENT] chỉ điều hướng / điền form (không thay đổi dữ liệu).",
    "",
    "Danh sách tool:",
    toolDescriptions,
    "",
    "Quy tắc trích args (chỉ trích khi câu hỏi nêu RÕ; thiếu tham số bắt buộc → \"none\"):",
    "  - get_lot_status: { \"orderCode\": \"<mã lệnh>\" } (bắt buộc).",
    "  - get_machine_status: { \"onlyOffline\": true|false }",
    "  - get_defect_trend: { \"days\": 2..30 } (mặc định 7)",
    "  - get_top_defects: { \"days\": 1..30, \"limit\": 5 }",
    "  - get_today_stats: {}",
    "  - acknowledge_alert: { \"id\": <int> }",
    "  - acknowledge_predictive_alert: { \"predictiveAlertId\": <int>, \"notes\"?: string }",
    "  - resolve_predictive_alert: { \"predictiveAlertId\": <int>, \"resolutionNotes\": string } (notes bắt buộc).",
    "  - create_measurement_point: { \"productModelId\": <int>, \"code\": string, \"name\": string, \"measurementTypeCode\": string, \"usl\"?, \"lsl\"?, \"nominalValue\"? }",
    "  - update_measurement_point: { \"id\": <int>, \"name\"?, \"unit\"?, \"upperLimit\"?, \"lowerLimit\"?, \"nominalValue\"? }",
    "  - set_yield_threshold: { \"scope\": \"FPY|FY|NTF|UPH\" hoặc \"thresholdId\": <int>, \"field\": \"warning|critical|target\", \"value\": <number> }",
    "  - navigate: { \"route\": \"/<đường-dẫn>\" }",
    "  - prefill_form: { \"route\": \"/<đường-dẫn>\", \"values\": { ... } }",
    "",
    `Câu hỏi: ${question}`,
    "",
    "Chỉ trả về JSON một dòng đúng schema sau (KHÔNG kèm markdown, KHÔNG giải thích):",
    "{\"tool\": \"<tên tool hoặc none>\", \"args\": { ... }}",
  ].join("\n");
}

function tryParseClassifierJson(raw: string): { tool: string; args: Record<string, unknown> } | null {
  // Pull out first {...} block defensively in case model wraps in fences.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (obj && typeof obj.tool === "string") {
      return {
        tool: obj.tool,
        args: (obj.args && typeof obj.args === "object") ? (obj.args as Record<string, unknown>) : {},
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * LLM-based classifier (fallback). Calls Ollama with a tiny budget. Returns
 * a validated ToolDecision or `{ tool: null }` when the model abstains, the
 * args fail schema validation, or Ollama is unreachable.
 *
 * No-op (returns null decision) when AI_TOOL_LLM_FALLBACK !== "1".
 */
export async function classifyToolIntentLLM(question: string): Promise<ToolDecision> {
  if (!llmFallbackEnabled()) {
    return { tool: null, args: {}, reason: "LLM_FALLBACK_DISABLED" };
  }
  if (!question || question.trim().length < 2) {
    return { tool: null, args: {}, reason: "EMPTY" };
  }

  let parsed: { tool: string; args: Record<string, unknown> } | null = null;

  if (!useLegacyOllama()) {
    // Default: bundled GGUF engine with grammar-constrained JSON (always parseable).
    try {
      const { generateJSON, isGgufAvailable } = await import("../aiGgufEngine");
      // doc69 G2-3 (Wave 1, W1-1b) — migrated from a raw route() call to routeInference so
      // this previously-unmetered background inference is now visible in ai_gateway_metrics.
      // SAME {task,text} input `route()` always used → decision.modelId is byte-identical to
      // before (model selection UNCHANGED); this only adds metering + a rate-limit slot.
      // Already fail-safe: any throw here (including RateLimitError) is caught below,
      // falling through to the legacy Ollama HTTP path exactly like every other GGUF
      // classify failure already did.
      const { routeInference } = await import("../aiGateway");
      if (await isGgufAvailable()) {
        // Model Router: intent classification is Tier 1 (fast model when GGUF_FAST_MODEL set).
        const { result: data } = await routeInference<{ tool?: unknown; args?: unknown } | undefined>(
          { task: "intent", text: question },
          async (intentRoute) => {
            const out = await generateJSON<{ tool?: unknown; args?: unknown }>(
              TOOL_INTENT_SCHEMA,
              {
                prompt: buildClassifierPrompt(question),
                maxTokens: 120,
                temperature: 0,
                topP: 0.8,
              },
              intentRoute.modelId,
            );
            return { result: out.data, tokensIn: out.tokensPrompt, tokensOut: out.tokensGenerated };
          },
        );
        if (data && typeof data.tool === "string") {
          parsed = {
            tool: data.tool,
            args:
              data.args && typeof data.args === "object" && !Array.isArray(data.args)
                ? (data.args as Record<string, unknown>)
                : {},
          };
        } else {
          return { tool: null, args: {}, reason: "LLM_NONE" };
        }
      }
      // GGUF unavailable → fall through to Ollama HTTP below (offline-first degrade).
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[intentClassifier] GGUF classify failed, falling back to Ollama:", msg);
      parsed = null;
    }
  }

  // Legacy / fallback: Ollama /api/generate format:json.
  if (parsed === null) {
    let raw = "";
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_QA_MODEL,
          prompt: buildClassifierPrompt(question),
          stream: false,
          format: "json",
          options: { temperature: 0, top_p: 0.8, num_predict: 80 },
        }),
      });
      if (!res.ok) return { tool: null, args: {}, reason: `LLM_HTTP_${res.status}` };
      const json = (await res.json()) as { response?: string };
      raw = (json.response ?? "").trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { tool: null, args: {}, reason: `LLM_FETCH_ERROR:${msg}` };
    }
    parsed = tryParseClassifierJson(raw);
  }

  if (!parsed || parsed.tool === "none") {
    return { tool: null, args: {}, reason: "LLM_NONE" };
  }

  const tool = getTool(parsed.tool);
  if (!tool) {
    return { tool: null, args: {}, reason: `LLM_UNKNOWN_TOOL:${parsed.tool}` };
  }

  const validated = tool.parameters.safeParse(parsed.args);
  if (!validated.success) {
    return { tool: null, args: {}, reason: `LLM_INVALID_ARGS:${validated.error.message}` };
  }

  return { tool: parsed.tool, args: validated.data as Record<string, unknown>, reason: "LLM_MATCH" };
}
