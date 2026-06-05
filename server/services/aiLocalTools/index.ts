/**
 * AI Local Tools — Public entry.
 * Importing this file registers all built-in tools (side-effect from handlers.ts).
 */

import "./handlers";
import "./writeHandlers";
import { classifyToolIntent, classifyToolIntentLLM, type ToolContext } from "./intentClassifier";
import { getTool, isWriteTool, listTools, type Tool, type ToolExecContext } from "./toolRegistry";
import type { ToolResult } from "./toolRegistry";
import { proposeAction, type PendingActionDTO } from "../aiCopilotActions";

export type { ToolResult, ToolResultType, ActionPreview, ToolExecContext, ToolPermission, ToolLang } from "./toolRegistry";
export { isWriteTool, assertExecutable } from "./toolRegistry";
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
