/**
 * AI Local Tools — Public entry.
 * Importing this file registers all built-in tools (side-effect from handlers.ts).
 */

import "./handlers";
import "./writeHandlers";
// Sprint F6 — line-monitoring read + insight tools (side-effect registration).
import "./handlersF6";
import "./insightHandlersF6";
// doc 56 Đ6 — device-standardization persona tools (device health + fleet process summary).
import "./handlersF7";
// Phase B4 — Management/Analytics READ tools (NL→analytics, forecasting, defect analytics).
import "./analyticsTools";
// Phase P2 (group A) — high-priority READ tools (work orders, alerts, thresholds, recipes).
import "./readToolsP2";
// Phase P2 (groups B & C) — products/BOM, RCA history, users, api-keys, audit, machine health.
import "./readToolsP2bc";
// Phase P2 (group D) — anomalies, genealogy trace, energy/ENPI, routing.
import "./readToolsP2d";
// Doc 34 P2 — Automation Programming Copilot tools: READ (KB retrieve / error-code /
// syntax-check / compile / simulate / generate / calc / read-file) + WRITE (workspace
// file write, HITL). Safe adapters + confined workspace; no device, no DB writes.
import "./readToolsProgramming";
import "./writeHandlers/programmingFile";
// Pha 4 Task 4 — VRAM broker state (READ-ONLY). Đây là NGƯỜI ĐỌC THẬT của `buildVramAgentState()`
// cho AI Agent: Agent repo này đi qua toolRegistry, KHÔNG qua tRPC. Ba lệnh phá huỷ CỐ Ý không
// đăng ký ở đây — xem khối đầu `vramTools.ts`.
import "./vramTools";
import { classifyToolIntent, classifyToolIntentLLM, decideNextToolLLM, type ToolContext } from "./intentClassifier";
import { runToolLoop, laLoiBoChonTool, type ToolLoopProgress, type ToolLoopResult } from "./toolLoop";
import { getTool, isWriteTool, isClientTool, listTools, type ClientActionDirective, type Tool, type ToolExecContext } from "./toolRegistry";
import type { ToolResult } from "./toolRegistry";
import { proposeAction, type PendingActionDTO } from "../aiCopilotActions";

export type { ToolResult, ToolResultType, ActionPreview, ToolExecContext, ToolPermission, ToolLang, ClientActionDirective } from "./toolRegistry";
export { isWriteTool, isClientTool, assertExecutable } from "./toolRegistry";
export type { ToolDecision, ToolContext } from "./intentClassifier";
export type { PendingActionDTO } from "../aiCopilotActions";
export { classifyToolIntent, classifyToolIntentLLM, listTools };

/**
 * ★★★ `argsWithAuthCtx` — **PHÉP LÀM SẠCH + GÁN DANH TÍNH**, nay ở `toolRegistry.ts` (module LÁ),
 * cạnh đúng kiểu `Tool` mà nó bảo vệ. Đọc toàn bộ lý lẽ ở đó.
 *
 * ⚠⚠ **NÓ TỪNG LÀ HÀM PRIVATE CỦA FILE NÀY, VÀ ĐÓ LÀ MỘT LỖ AN NINH** (Task 5, review): private ⇒
 * chỉ che được **MỘT** đường thoát. `aiAgentOrchestrator` — người gọi `Tool.handler` **THỨ HAI**
 * trong mã sản xuất — không với tới được nên gọi thẳng `tool.handler(step.args)` và **FAIL-OPEN**.
 * ⇒ Đừng bao giờ chuyển nó về private lại; `authCtxInjection.test.ts` có **bản kiểm đếm MỌI điểm
 * gọi `.handler(`** để một điểm gọi mới không lặng lẽ bỏ qua nó.
 */
import { argsWithAuthCtx } from "./toolRegistry";

/**
 * Try to execute a tool for the given question. Returns null when no tool
 * is appropriate or when execution fails (so caller can fall back to KB).
 *
 * Pipeline:
 *   1. Heuristic classifier (instant).
 *   2. Optional LLM fallback (only when AI_TOOL_LLM_FALLBACK=1 and step 1
 *      returned no tool). Adds ~50–150ms of qwen2.5-instruct latency.
 */
export interface ToolExecOutcome {
  result: ToolResult | null;
  /** Set when a write-tool was matched → confirm card to render (no execute). */
  pendingAction?: PendingActionDTO | null;
  /** Set when a client-tool (navigate/prefill) was matched → FE directive. */
  clientAction?: ClientActionDirective | null;
  /** Localized refusal when a write-tool was matched but RBAC denied it. */
  denied?: { message: string; reason?: string };
  error?: string;
}

/**
 * ★ G2-C — CHỌN TOOL cho vòng 1: heuristic trước, LLM fallback sau. Tách khỏi `tryExecuteTool` để
 * vòng lặp (`tryExecuteToolLoop`) dùng lại ĐÚNG bộ chọn này cho vòng 1 — vòng 1 của vòng lặp phải
 * cho ra quyết định GIỐNG HỆT đường một-lượt, nếu không thì bật cờ là đổi hành vi của cả những
 * câu hỏi chỉ cần một tool.
 */
async function chonToolVong1(question: string, context?: ToolContext) {
  let decision = classifyToolIntent(question, context);
  if (!decision.tool) {
    const heuristicClarify = decision.clarifyMessage ?? null;
    const llm = await classifyToolIntentLLM(question);
    if (llm.tool) {
      decision = llm;
    } else if (heuristicClarify) {
      // LLM also abstained — preserve the clarifying question from heuristic.
      decision = { ...llm, clarifyMessage: heuristicClarify };
    } else if (laLoiBoChonTool(llm.reason)) {
      /**
       * ★ G2-C — LỖ THỨ HAI CỦA CÙNG MỘT LỚP LỖI, ĐO ĐƯỢC BẰNG CHÍNH PHÉP ĐO CỦA TASK NÀY.
       *
       * Nhánh này TRƯỚC ĐÂY không tồn tại: khi heuristic không khớp VÀ không có câu hỏi lại,
       * `decision` giữ nguyên quyết định HEURISTIC (`reason: "NO_TRIGGER_MATCH"`) và lý do hỏng
       * THẬT của bộ chọn LLM bị **đánh rơi ngay tại đây** — trước cả chỗ `tryExecuteTool` đọc nó.
       * Phát hiện bằng phép đo: bench đa bước báo `khong_co_tool` cho những ca mà nguyên nhân
       * thật là gateway đang chặn nhịp (`RateLimitError` ⇒ rơi sang Ollama ⇒ `LLM_FETCH_ERROR`).
       * Một cổng "không tìm thấy tool" và một engine đang chết trông GIỐNG HỆT nhau từ ngoài.
       */
      decision = { ...decision, reason: llm.reason };
    }
  }
  return decision;
}

export async function tryExecuteTool(
  question: string,
  context?: ToolContext,
  execCtx?: ToolExecContext,
): Promise<ToolExecOutcome & { decision: ReturnType<typeof classifyToolIntent> }> {
  const decision = await chonToolVong1(question, context);
  const outcome = await executeDecision(decision, execCtx);
  // ★ G2-C (mục 4 của brief) — TRƯỚC ĐÂY: bộ chọn LLM chết (engine offline / HTTP lỗi) ⇒ trả
  // `{decision, result: null}` KHÔNG có `error` nào, pipeline rơi thẳng sang RAG, người dùng hỏi
  // "OEE line 2 hôm nay" nhận câu trả lời dựa trên TÀI LIỆU mà không một dấu hiệu nào cho biết
  // số liệu sống chưa lấy được. Nay lý do hỏng được GIỮ để `aiLocalKnowledgeService` nói ra.
  if (!decision.tool && !outcome.error && laLoiBoChonTool(decision.reason)) {
    return { decision, ...outcome, error: decision.reason };
  }
  return { decision, ...outcome };
}

/**
 * ★ G2-C — CHẠY một quyết định đã có. **ĐÂY LÀ ĐIỂM GỌI `Tool.handler(` DUY NHẤT của file này**,
 * và nó phải ở lại file này: `authCtxInjection.test.ts` có bản kiểm đếm AST khẳng định toàn repo
 * chỉ có ĐÚNG HAI file chứa điểm gọi `.handler(` (file này + `aiAgentOrchestrator`). Tách hàm ra
 * một module mới sẽ làm lưới đó đỏ — cố ý, vì mỗi điểm gọi mới là một đường có thể fail-open
 * quanh `argsWithAuthCtx`.
 *
 * Vòng lặp G2-C dùng lại NGUYÊN hàm này cho MỌI vòng ⇒ ba bất biến (HITL cho write · directive
 * client · `argsWithAuthCtx` xoá `__authCtx` model bịa) đúng ở vòng thứ N y như vòng 1, theo CẤU
 * TẠO chứ không nhờ ai nhớ chép lại.
 */
export async function executeDecision(
  decision: { tool: string | null; args: Record<string, unknown> },
  execCtx?: ToolExecContext,
): Promise<ToolExecOutcome> {
  if (!decision.tool) {
    return { result: null };
  }
  const tool: Tool | undefined = getTool(decision.tool);
  if (!tool) {
    return { result: null, error: "TOOL_NOT_REGISTERED" };
  }

  // ── Client tool (navigate/prefill): no DB, no HITL. Emit a directive. ──
  if (isClientTool(tool)) {
    if (!execCtx) {
      return { result: null, error: "CLIENT_TOOL_REQUIRES_CONTEXT" };
    }
    if (typeof tool.buildClientAction !== "function") {
      return { result: null, error: "CLIENT_TOOL_MISSING_BUILDER" };
    }
    const directive = tool.buildClientAction(decision.args, execCtx);
    if (!directive) {
      // Route not whitelisted (or otherwise rejected) → refuse politely.
      const msg =
        execCtx.lang === "en"
          ? "I can't open that page (not in the allowed list)."
          : execCtx.lang === "zh"
            ? "无法打开该页面（不在允许列表中）。"
            : "Tôi không thể mở trang đó (không nằm trong danh sách cho phép).";
      return { result: null, denied: { message: msg, reason: "ROUTE_NOT_ALLOWED" } };
    }
    return { result: null, clientAction: directive };
  }

  // ── Write tool: never execute here. Go through the HITL propose flow. ──
  if (isWriteTool(tool)) {
    if (!execCtx) {
      // No authenticated exec context (legacy call) → cannot propose safely.
      return { result: null, error: "WRITE_TOOL_REQUIRES_CONTEXT" };
    }
    try {
      const proposal = await proposeAction(tool, decision.args, execCtx);
      if (!proposal.ok) {
        if (proposal.denied) {
          return { result: null, denied: { message: proposal.message ?? "", reason: proposal.reason } };
        }
        return { result: null, error: proposal.reason ?? "PROPOSE_FAILED" };
      }
      return { result: null, pendingAction: proposal.pendingAction ?? null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { result: null, error: msg };
    }
  }

  // ── Read tool (GĐ1 path, unchanged). ──
  if (typeof tool.handler !== "function") {
    return { result: null, error: "READ_TOOL_MISSING_HANDLER" };
  }
  try {
    // ★★★ C-1 — danh tính phiên THẬT đi vào args ở ĐÂY (xem `argsWithAuthCtx`). Không có dòng này,
    // mọi read tool có RBAC là MÃ CHẾT trên đường Agent.
    const result = await tool.handler(argsWithAuthCtx(tool, decision.args, execCtx));
    return { result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { result: null, error: msg };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ G2-C — VÒNG LẶP TOOL TỰ DO CÓ CHẶN (wiring). Chính sách thuần ở `toolLoop.ts`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Cờ bật đường vòng lặp. **Mặc định TẮT** — bật là đổi hình dạng chi phí của MỌI lượt chat có
 * tool (tới `maxRounds` lượt suy luận chọn-tool thay vì 1), nên nó phải là một quyết định vận
 * hành có ý thức, không phải mặc định trôi vào.
 */
export function toolLoopEnabled(): boolean {
  return process.env.AI_TOOL_LOOP_ENABLED === "1";
}

export interface TryExecuteToolLoopResult extends ToolExecOutcome {
  decision: ReturnType<typeof classifyToolIntent>;
  /** null ⇔ cờ TẮT (đường một-lượt cũ, không đổi một byte nào). */
  loop: ToolLoopResult | null;
}

/**
 * Điểm vào DUY NHẤT của đường chat cho việc chạy tool.
 *
 * ⚠ CỜ TẮT ⇒ **uỷ quyền nguyên vẹn** cho `tryExecuteTool`: không một nhánh mới nào chạy, không
 * một lượt suy luận thêm nào, `loop: null`. Đây là điều kiện để bật/tắt cờ là một phép đo A/B
 * sạch chứ không phải "hai đường code hơi khác nhau".
 *
 * Cờ BẬT ⇒ `runToolLoop` với: bộ chọn vòng 1 y hệt đường cũ, bộ chọn vòng ≥2 là
 * `decideNextToolLLM` (có nhìn quan sát ĐÃ LÀM SẠCH), executor là `executeDecision` (một đường
 * duy nhất ⇒ HITL/RBAC/`argsWithAuthCtx` không thể trôi), cầu chì là `isKillSwitchTripped`.
 */
export async function tryExecuteToolLoop(
  question: string,
  context?: ToolContext,
  execCtx?: ToolExecContext,
  onProgress?: (p: ToolLoopProgress) => void,
): Promise<TryExecuteToolLoopResult> {
  if (!toolLoopEnabled()) {
    return { ...(await tryExecuteTool(question, context, execCtx)), loop: null };
  }

  const loop = await runToolLoop({
    deciders: {
      first: () => chonToolVong1(question, context),
      next: (quanSat) => decideNextToolLLM(question, quanSat),
    },
    execute: (decision) => executeDecision(decision, execCtx),
    // Nhập ĐỘNG: `autonomyPolicy` kéo theo `db/connection`; một cạnh nhập tĩnh sẽ bắt mọi test
    // của file này phải dựng DB. Cầu chì đã tự fail-CLOSED khi DB hỏng (xem hàm đó).
    killSwitch: async () => {
      const { isKillSwitchTripped } = await import("../ai/autonomyPolicy");
      return isKillSwitchTripped();
    },
    onProgress,
  });

  return {
    decision: loop.firstDecision,
    result: loop.lastResult,
    pendingAction: loop.pendingAction,
    clientAction: loop.clientAction,
    denied: loop.denied ?? undefined,
    // Lỗi ĐẦU TIÊN đại diện cho lượt — trường này vốn đã tồn tại và vốn đã bị người gọi vứt đi;
    // `loop.errors` giữ đủ mọi lỗi cho người gọi nào muốn nói thật (xem `aiLocalKnowledgeService`).
    error: loop.errors[0]?.code,
    loop,
  };
}

export { runToolLoop, docTranVongLap, TOOL_LOOP_DEFAULTS } from "./toolLoop";
export type { ToolLoopResult, ToolLoopProgress, ToolLoopStop, ToolLoopRound } from "./toolLoop";
