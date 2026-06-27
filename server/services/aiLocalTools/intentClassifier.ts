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

function normalizeText(s: string): string {
  return s.toLowerCase().trim();
}

function findToolByTriggers(question: string): Tool | null {
  const norm = normalizeText(question);
  let best: { tool: Tool; score: number } | null = null;
  for (const tool of listTools()) {
    // Write/client tools are only matched via dedicated shortcuts or the LLM
    // router (which enforce required args / route whitelist) — never via generic
    // trigger scoring.
    if (tool.kind === "write" || tool.kind === "client") continue;
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

function extractArgsForTool(
  toolName: string,
  question: string,
  context?: ToolContext,
): Record<string, unknown> {
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
    case "get_today_stats":
    default:
      return {};
  }
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
    "Bạn là bộ phân loại ý định cho hệ thống AVI/AOI. Chọn DUY NHẤT một tool phù hợp",
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
      const { route } = await import("../aiModelRouter");
      if (await isGgufAvailable()) {
        // Model Router: intent classification is Tier 1 (fast model when GGUF_FAST_MODEL set).
        const intentRoute = route({ task: "intent", text: question });
        const { data } = await generateJSON<{ tool?: unknown; args?: unknown }>(
          TOOL_INTENT_SCHEMA,
          {
            prompt: buildClassifierPrompt(question),
            maxTokens: 120,
            temperature: 0,
            topP: 0.8,
          },
          intentRoute.modelId,
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
