/**
 * AI Local Tools — Public entry.
 * Importing this file registers all built-in tools (side-effect from handlers.ts).
 */

import "./handlers";
import "./writeHandlers";
// Sprint F6 — line-monitoring read + insight tools (side-effect registration).
import "./handlersF6";
import "./insightHandlersF6";
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
import { classifyToolIntent, classifyToolIntentLLM, type ToolContext } from "./intentClassifier";
import { getTool, isWriteTool, isClientTool, listTools, type ClientActionDirective, type Tool, type ToolExecContext } from "./toolRegistry";
import type { ToolResult } from "./toolRegistry";
import { proposeAction, type PendingActionDTO } from "../aiCopilotActions";

export type { ToolResult, ToolResultType, ActionPreview, ToolExecContext, ToolPermission, ToolLang, ClientActionDirective } from "./toolRegistry";
export { isWriteTool, isClientTool, assertExecutable } from "./toolRegistry";
export type { ToolDecision, ToolContext } from "./intentClassifier";
export type { PendingActionDTO } from "../aiCopilotActions";
export { classifyToolIntent, classifyToolIntentLLM, listTools };

/**
 * Try to execute a tool for the given question. Returns null when no tool
 * is appropriate or when execution fails (so caller can fall back to KB).
 *
 * Pipeline:
 *   1. Heuristic classifier (instant).
 *   2. Optional LLM fallback (only when AI_TOOL_LLM_FALLBACK=1 and step 1
 *      returned no tool). Adds ~50–150ms of qwen2.5-instruct latency.
 */
export async function tryExecuteTool(
  question: string,
  context?: ToolContext,
  execCtx?: ToolExecContext,
): Promise<{
  decision: ReturnType<typeof classifyToolIntent>;
  result: ToolResult | null;
  /** Set when a write-tool was matched → confirm card to render (no execute). */
  pendingAction?: PendingActionDTO | null;
  /** Set when a client-tool (navigate/prefill) was matched → FE directive. */
  clientAction?: ClientActionDirective | null;
  /** Localized refusal when a write-tool was matched but RBAC denied it. */
  denied?: { message: string; reason?: string };
  error?: string;
}> {
  let decision = classifyToolIntent(question, context);
  if (!decision.tool) {
    const heuristicClarify = decision.clarifyMessage ?? null;
    const llm = await classifyToolIntentLLM(question);
    if (llm.tool) {
      decision = llm;
    } else if (heuristicClarify) {
      // LLM also abstained — preserve the clarifying question from heuristic.
      decision = { ...llm, clarifyMessage: heuristicClarify };
    }
  }
  if (!decision.tool) {
    return { decision, result: null };
  }
  const tool: Tool | undefined = getTool(decision.tool);
  if (!tool) {
    return { decision, result: null, error: "TOOL_NOT_REGISTERED" };
  }

  // ── Client tool (navigate/prefill): no DB, no HITL. Emit a directive. ──
  if (isClientTool(tool)) {
    if (!execCtx) {
      return { decision, result: null, error: "CLIENT_TOOL_REQUIRES_CONTEXT" };
    }
    if (typeof tool.buildClientAction !== "function") {
      return { decision, result: null, error: "CLIENT_TOOL_MISSING_BUILDER" };
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
      return { decision, result: null, denied: { message: msg, reason: "ROUTE_NOT_ALLOWED" } };
    }
    return { decision, result: null, clientAction: directive };
  }

  // ── Write tool: never execute here. Go through the HITL propose flow. ──
  if (isWriteTool(tool)) {
    if (!execCtx) {
      // No authenticated exec context (legacy call) → cannot propose safely.
      return { decision, result: null, error: "WRITE_TOOL_REQUIRES_CONTEXT" };
    }
    try {
      const proposal = await proposeAction(tool, decision.args, execCtx);
      if (!proposal.ok) {
        if (proposal.denied) {
          return { decision, result: null, denied: { message: proposal.message ?? "", reason: proposal.reason } };
        }
        return { decision, result: null, error: proposal.reason ?? "PROPOSE_FAILED" };
      }
      return { decision, result: null, pendingAction: proposal.pendingAction ?? null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { decision, result: null, error: msg };
    }
  }

  // ── Read tool (GĐ1 path, unchanged). ──
  if (typeof tool.handler !== "function") {
    return { decision, result: null, error: "READ_TOOL_MISSING_HANDLER" };
  }
  try {
    const result = await tool.handler(decision.args);
    return { decision, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { decision, result: null, error: msg };
  }
}
