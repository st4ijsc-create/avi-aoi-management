/**
 * AI Agent Planner (GĐ3b) — turns a natural-language goal into a validated,
 * bounded multi-step plan for the orchestrator.
 *
 * Safety / offline-first invariants:
 *  - Uses the bundled GGUF engine with grammar-constrained JSON (always
 *    parseable). When GGUF is unavailable, returns an EMPTY plan + a localized
 *    "not available" message — NEVER crashes, NEVER guesses.
 *  - Every planned step is validated AFTER generation:
 *      • read/write/navigate/prefill steps must name a REGISTERED tool;
 *      • args must pass that tool.parameters (zod) — invalid steps are dropped;
 *      • guidance/branch steps carry no tool;
 *      • the plan is truncated to AGENT_MAX_STEPS.
 *  - The planner ONLY produces a plan. It performs NO DB writes, NO tool
 *    execution, and is unaware of the HITL confirm flow (that lives in the
 *    orchestrator, on top of proposeAction/confirmAction).
 */

import { listTools, getTool, isWriteTool, isClientTool, type ToolLang } from "./aiLocalTools/toolRegistry";
import type { AgentPlan, AgentPlanStep } from "../../drizzle/schema";

/** Max steps a single plan may contain (env-overridable; mirrored by orchestrator). */
export const AGENT_MAX_STEPS = Math.max(1, Number(process.env.AGENT_MAX_STEPS ?? 6) || 6);

const STEP_KINDS = ["read", "write", "guidance", "navigate", "prefill", "branch"] as const;
type StepKind = (typeof STEP_KINDS)[number];

export interface PlanResult {
  /** Always present. Empty when GGUF unavailable or nothing valid was produced. */
  plan: AgentPlan;
  /** True when the planner could actually run (GGUF available). */
  available: boolean;
  /** Localized message when unavailable / empty. */
  message?: string;
}

// Grammar-constrained JSON schema for the planner output. `kind` is an enum so the
// decoder can only emit valid step kinds; tool/args/rationale are free-form and
// re-validated against the live registry below.
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...STEP_KINDS] },
          tool: { type: "string" },
          args: { type: "object" },
          rationale: { type: "string" },
        },
        required: ["kind"],
      },
    },
  },
  required: ["steps"],
} as const;

function notAvailableMessage(lang: ToolLang): string {
  switch (lang) {
    case "en":
      return "The local AI planner is not available (offline model not loaded). Multi-step automation is temporarily disabled.";
    case "zh":
      return "本地 AI 规划器不可用（离线模型未加载）。多步自动化暂不可用。";
    case "vi":
    default:
      return "Bộ lập kế hoạch AI cục bộ chưa khả dụng (mô hình offline chưa nạp). Tự động hoá nhiều bước tạm thời chưa dùng được.";
  }
}

/** Build a planner prompt that lists the registry with [WRITE]/[CLIENT] tags (reusing the classifier pattern). */
function buildPlannerPrompt(goal: string, lang: ToolLang): string {
  const toolDescriptions = listTools()
    .map((t) => {
      const tag = t.kind === "write" ? " [WRITE]" : t.kind === "client" ? " [CLIENT]" : " [READ]";
      return `  - ${t.name}${tag}: ${t.description}`;
    })
    .join("\n");
  return [
    "Bạn là bộ lập kế hoạch (planner) cho hệ thống AVI/AOI. Hãy chia MỤC TIÊU của người dùng",
    `thành tối đa ${AGENT_MAX_STEPS} bước tuần tự, mỗi bước dùng MỘT tool trong danh sách (hoặc guidance).`,
    "Loại bước (kind):",
    "  - read: truy vấn dữ liệu (chạy ngay).",
    "  - write: hành động thay đổi dữ liệu — sẽ cần NGƯỜI DÙNG xác nhận (HITL).",
    "  - navigate / prefill: điều hướng hoặc điền form phía client.",
    "  - guidance: chỉ dẫn bằng văn bản (không dùng tool).",
    "  - branch: rẽ nhánh có điều kiện.",
    "Chỉ dùng tool có trong danh sách. Chỉ trích args khi mục tiêu nêu RÕ.",
    "",
    "Danh sách tool:",
    toolDescriptions,
    "",
    `Ngôn ngữ trả lời: ${lang}.`,
    `Mục tiêu: ${goal}`,
    "",
    "Chỉ trả về JSON đúng schema (KHÔNG markdown, KHÔNG giải thích thừa):",
    "{\"summary\": \"...\", \"steps\": [{\"kind\": \"read|write|navigate|prefill|guidance|branch\", \"tool\": \"<tên tool>\", \"args\": { ... }, \"rationale\": \"...\"}]}",
  ].join("\n");
}

/** True when a step kind requires a registered tool with matching capability. */
function kindNeedsTool(kind: StepKind): boolean {
  return kind === "read" || kind === "write" || kind === "navigate" || kind === "prefill";
}

/**
 * Validate one raw step against the live registry. Returns a normalized step or
 * null when it must be dropped (unknown kind, missing/unknown tool, bad args,
 * or a tool whose kind doesn't match the step kind).
 */
function validateStep(raw: any): AgentPlanStep | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind as StepKind;
  if (!STEP_KINDS.includes(kind)) return null;

  const rationale = typeof raw.rationale === "string" ? raw.rationale : undefined;

  // guidance / branch carry no tool.
  if (!kindNeedsTool(kind)) {
    return { kind, tool: null, rationale };
  }

  const toolName = typeof raw.tool === "string" ? raw.tool : "";
  if (!toolName) return null;
  const tool = getTool(toolName);
  if (!tool) return null;

  // Enforce that the planned kind matches the tool's capability.
  if (kind === "write" && !isWriteTool(tool)) return null;
  if ((kind === "navigate" || kind === "prefill") && !isClientTool(tool)) return null;
  if (kind === "read" && (isWriteTool(tool) || isClientTool(tool))) return null;

  const rawArgs = raw.args && typeof raw.args === "object" && !Array.isArray(raw.args) ? raw.args : {};
  const parsed = tool.parameters.safeParse(rawArgs);
  if (!parsed.success) return null;

  return { kind, tool: toolName, args: parsed.data as Record<string, unknown>, rationale };
}

/**
 * Plan a goal into a validated, bounded AgentPlan. Offline-safe: returns an
 * empty plan + message when GGUF is unavailable.
 */
export async function planGoal(
  goal: string,
  opts: { lang?: ToolLang } = {},
): Promise<PlanResult> {
  const lang: ToolLang = opts.lang ?? "vi";
  const trimmed = (goal ?? "").trim();
  if (trimmed.length < 2) {
    return { plan: { steps: [] }, available: true, message: notAvailableMessage(lang) };
  }

  const { generateJSON, isGgufAvailable } = await import("./aiGgufEngine");

  if (!(await isGgufAvailable())) {
    return { plan: { steps: [] }, available: false, message: notAvailableMessage(lang) };
  }

  let raw: { summary?: unknown; steps?: unknown };
  try {
    const { data } = await generateJSON<{ summary?: unknown; steps?: unknown }>(
      PLAN_SCHEMA,
      {
        prompt: buildPlannerPrompt(trimmed, lang),
        maxTokens: 512,
        temperature: 0,
        topP: 0.8,
      },
    );
    raw = data ?? {};
  } catch {
    // Inference failure → degrade to an empty plan (do NOT crash the session).
    return { plan: { steps: [] }, available: true, message: notAvailableMessage(lang) };
  }

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const steps: AgentPlanStep[] = [];
  for (const rs of rawSteps) {
    if (steps.length >= AGENT_MAX_STEPS) break; // cut to the limit
    const v = validateStep(rs);
    if (v) steps.push(v);
  }

  const plan: AgentPlan = { steps };
  if (typeof raw.summary === "string") plan.summary = raw.summary;
  return { plan, available: true };
}
