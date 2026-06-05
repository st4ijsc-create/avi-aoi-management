/**
 * AI Local Tools — Public entry.
 * Importing this file registers all built-in tools (side-effect from handlers.ts).
 */

import "./handlers";
import { classifyToolIntent, classifyToolIntentLLM, type ToolContext } from "./intentClassifier";
import { getTool, listTools, type Tool } from "./toolRegistry";
import type { ToolResult } from "./toolRegistry";

export type { ToolResult, ToolResultType } from "./toolRegistry";
export type { ToolDecision, ToolContext } from "./intentClassifier";
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
export async function tryExecuteTool(question: string, context?: ToolContext): Promise<{
  decision: ReturnType<typeof classifyToolIntent>;
  result: ToolResult | null;
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
  try {
    const result = await tool.handler(decision.args);
    return { decision, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { decision, result: null, error: msg };
  }
}
