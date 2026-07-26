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
import type { AgentBranchCondition, AgentPlan, AgentPlanStep, AgentStepResult } from "../../drizzle/schema";

/** Max steps a single plan may contain (env-overridable; mirrored by orchestrator). */
export const AGENT_MAX_STEPS = Math.max(1, Number(process.env.AGENT_MAX_STEPS ?? 6) || 6);

/**
 * Max number of times a single session may call `replanFromObservations`
 * (env-overridable; mirrored by the orchestrator, which owns the actual
 * budget bookkeeping on the session row). `0` legitimately disables replanning
 * — unlike AGENT_MAX_STEPS this must NOT fall back to the default on `0`, so
 * it does not use the `Number(...) || default` idiom.
 */
export const AGENT_MAX_REPLANS = (() => {
  const raw = Number(process.env.AGENT_MAX_REPLANS ?? 2);
  return Math.max(0, Number.isFinite(raw) ? raw : 2);
})();

const STEP_KINDS = ["read", "write", "guidance", "navigate", "prefill", "branch"] as const;
type StepKind = (typeof STEP_KINDS)[number];

const BRANCH_OPS = ["eq", "neq", "gt", "lt", "exists", "contains"] as const;
type BranchOp = (typeof BRANCH_OPS)[number];

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
          // `branch` steps only — see validateBranchCondition/AgentBranchCondition.
          // Free-form object here (grammar-constrained JSON can't express the
          // nested shape); re-validated strictly below.
          condition: { type: "object" },
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
    "Bạn là bộ lập kế hoạch (planner) cho hệ thống SYNAPSE. Hãy chia MỤC TIÊU của người dùng",
    `thành tối đa ${AGENT_MAX_STEPS} bước tuần tự, mỗi bước dùng MỘT tool trong danh sách (hoặc guidance).`,
    "Loại bước (kind):",
    "  - read: truy vấn dữ liệu (chạy ngay).",
    "  - write: hành động thay đổi dữ liệu — sẽ cần NGƯỜI DÙNG xác nhận (HITL).",
    "  - navigate / prefill: điều hướng hoặc điền form phía client.",
    "  - guidance: chỉ dẫn bằng văn bản (không dùng tool).",
    "  - branch: rẽ nhánh có điều kiện, đánh giá trên kết quả các bước read TRƯỚC ĐÓ (không dùng model để rẽ nhánh).",
    "    Nếu có điều kiện, đặt trong `condition`: " +
      "{\"when\": {\"path\": \"<đường-dẫn-trong-payload, vd data.count>\", \"op\": \"eq|neq|gt|lt|exists|contains\", \"value\": <giá-trị-so-sánh>}, " +
      "\"thenGoto\": <chỉ-số-bước-nếu-đúng>, \"elseGoto\": <chỉ-số-bước-nếu-sai>}. " +
      "thenGoto/elseGoto PHẢI là chỉ số bước phía SAU bước branch (không được quay lại phía trước). Bỏ trống = đi tiếp bước kế tiếp.",
    "Chỉ dùng tool có trong danh sách. Chỉ trích args khi mục tiêu nêu RÕ.",
    "",
    "Danh sách tool:",
    toolDescriptions,
    "",
    `Ngôn ngữ trả lời: ${lang}.`,
    `Mục tiêu: ${goal}`,
    "",
    "Chỉ trả về JSON đúng schema (KHÔNG markdown, KHÔNG giải thích thừa):",
    "{\"summary\": \"...\", \"steps\": [{\"kind\": \"read|write|navigate|prefill|guidance|branch\", \"tool\": \"<tên tool>\", \"args\": { ... }, \"rationale\": \"...\", \"condition\": { ... }}]}",
  ].join("\n");
}

/** True when a step kind requires a registered tool with matching capability. */
function kindNeedsTool(kind: StepKind): boolean {
  return kind === "read" || kind === "write" || kind === "navigate" || kind === "prefill";
}

/**
 * Validate + normalize a raw `condition` payload for a `branch` step.
 * STRUCTURAL validity only (types / enum membership) — index-bounds and
 * forward-only enforcement happen at the orchestrator at EVAL time, which is
 * the only place that knows the step's actual position in the final plan
 * (this validator runs mid-assembly, before dropped steps can shift indices).
 * Malformed/partial input → undefined: the step keeps today's no-condition
 * skip/fall-through behavior — it is never dropped, this never throws.
 */
function validateBranchCondition(raw: any): AgentBranchCondition | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const when = raw.when;
  if (!when || typeof when !== "object") return undefined;
  const path = typeof when.path === "string" ? when.path : "";
  const op = when.op as BranchOp;
  if (!BRANCH_OPS.includes(op)) return undefined;

  const condition: AgentBranchCondition = { when: { path, op } };
  if (Object.prototype.hasOwnProperty.call(when, "value")) condition.when.value = when.value;
  if (typeof when.observationTool === "string") condition.when.observationTool = when.observationTool;
  if (Number.isInteger(raw.thenGoto)) condition.thenGoto = raw.thenGoto;
  if (Number.isInteger(raw.elseGoto)) condition.elseGoto = raw.elseGoto;
  return condition;
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

  // guidance / branch carry no tool. branch MAY carry a validated condition
  // (backward-compatible: no condition → today's unconditional skip).
  if (!kindNeedsTool(kind)) {
    const step: AgentPlanStep = { kind, tool: null, rationale };
    if (kind === "branch") {
      const condition = validateBranchCondition(raw.condition);
      if (condition) step.condition = condition;
    }
    return step;
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

// ============= Wave 3 / D1 — observe→replan =============
//
// The orchestrator calls replanFromObservations() after a `read` step yields a
// result, to let the planner adapt the NOT-YET-EXECUTED tail of the plan
// based on what actually happened (rather than blindly running the
// up-front plan). This function is a pure "propose" — it has no notion of a
// session, a cursor, or a replan budget; ALL of that bounding (replan budget,
// step cap, write cap, forward-only cursor) lives in the orchestrator, which
// treats this function's output as untrusted input to re-clamp.

/** One already-executed step, paired with its outcome — context for the replanner. */
export interface ReplanExecutedEntry {
  step: AgentPlanStep;
  result: AgentStepResult;
}

export interface ReplanInput {
  goal: string;
  /** Steps already executed (in order), paired with their outcome (includes read-step observations). */
  executed: ReplanExecutedEntry[];
  /** The current not-yet-executed tail of the plan (may be empty). */
  remaining: AgentPlanStep[];
  lang?: ToolLang;
}

export interface ReplanResult {
  /**
   * True when the planner returned a well-formed, validated steps array (even
   * an intentionally empty one — "no more steps needed"). False means
   * offline / inference error / malformed output: the caller MUST keep
   * running `steps` (== the input `remaining`, unchanged) — never crash,
   * never fabricate.
   */
  changed: boolean;
  /** The adapted tail. Equals the input `remaining` verbatim when changed=false. */
  steps: AgentPlanStep[];
  available: boolean;
  message?: string;
}

function buildReplanPrompt(input: ReplanInput, lang: ToolLang, stepBudget: number): string {
  const toolDescriptions = listTools()
    .map((t) => {
      const tag = t.kind === "write" ? " [WRITE]" : t.kind === "client" ? " [CLIENT]" : " [READ]";
      return `  - ${t.name}${tag}: ${t.description}`;
    })
    .join("\n");
  const executedLines =
    input.executed
      .map((e, i) => {
        const label = `[${e.step.kind}${e.step.tool ? ":" + e.step.tool : ""}]`;
        const payload = e.result.payload !== undefined ? ` → ${JSON.stringify(e.result.payload).slice(0, 500)}` : "";
        const msg = e.result.message ? ` (${e.result.message})` : "";
        return `  ${i}. ${label} ${e.result.status}${payload}${msg}`;
      })
      .join("\n") || "  (chưa có bước nào)";
  const remainingLines =
    input.remaining
      .map((s, i) => `  ${i}. [${s.kind}${s.tool ? ":" + s.tool : ""}] ${s.rationale ?? ""}`)
      .join("\n") || "  (không còn bước nào)";

  return [
    "Bạn là bộ lập kế hoạch (planner) cho hệ thống SYNAPSE, đang ĐIỀU CHỈNH một kế hoạch",
    "đang chạy dựa trên kết quả QUAN SÁT ĐƯỢC từ các bước đã thực thi (observe→replan).",
    `Mục tiêu ban đầu: ${input.goal}`,
    "",
    "Các bước ĐÃ THỰC THI và kết quả (không được lặp lại các bước này):",
    executedLines,
    "",
    "Các bước CÒN LẠI trong kế hoạch hiện tại (chưa chạy):",
    remainingLines,
    "",
    `Hãy đề xuất PHẦN CÒN LẠI của kế hoạch (tối đa ${stepBudget} bước) — có thể GIỮ NGUYÊN, THAY THẾ,`,
    "hoặc THÊM bước dựa trên kết quả quan sát ở trên.",
    "Loại bước (kind): read | write | navigate | prefill | guidance | branch (như khi lập kế hoạch ban đầu).",
    "Chỉ dùng tool có trong danh sách sau. Chỉ trích args khi mục tiêu nêu RÕ.",
    "",
    "Danh sách tool:",
    toolDescriptions,
    "",
    `Ngôn ngữ trả lời: ${lang}.`,
    "",
    "Chỉ trả về JSON đúng schema (KHÔNG markdown, KHÔNG giải thích thừa):",
    "{\"summary\": \"...\", \"steps\": [{\"kind\": \"read|write|navigate|prefill|guidance|branch\", \"tool\": \"<tên tool>\", \"args\": { ... }, \"rationale\": \"...\", \"condition\": { ... }}]}",
  ].join("\n");
}

/**
 * Adapt the not-yet-executed tail of a running plan given what has actually
 * happened so far. Uses the SAME GGUF path + the SAME validateStep validation
 * as planGoal (grammar-constrained JSON, live tool-registry check, kind/arg
 * validation) — never fabricates a step, never crashes.
 *
 * Offline / no GGUF / inference error / malformed (`steps` not an array)
 * output → `{ changed: false, steps: input.remaining, ... }`: the caller MUST
 * keep running the EXISTING remaining plan unchanged. This function is a pure
 * proposal — the orchestrator independently re-clamps the result to the
 * session's live step budget and NEVER lets it touch already-executed steps.
 */
export async function replanFromObservations(input: ReplanInput): Promise<ReplanResult> {
  const lang: ToolLang = input.lang ?? "vi";
  const noChange: ReplanResult = { changed: false, steps: input.remaining, available: true };

  const { generateJSON, isGgufAvailable } = await import("./aiGgufEngine");
  if (!(await isGgufAvailable())) {
    return { ...noChange, available: false, message: notAvailableMessage(lang) };
  }

  // Never ask for more steps than could still fit the overall step cap
  // (executed steps + this tail). The orchestrator re-clamps independently.
  const stepBudget = Math.max(1, AGENT_MAX_STEPS - input.executed.length);

  let raw: { summary?: unknown; steps?: unknown };
  try {
    const { data } = await generateJSON<{ summary?: unknown; steps?: unknown }>(
      PLAN_SCHEMA,
      {
        prompt: buildReplanPrompt(input, lang, stepBudget),
        maxTokens: 512,
        temperature: 0,
        topP: 0.8,
      },
    );
    raw = data ?? {};
  } catch {
    // Inference failure → degrade to no-change (do NOT crash the session).
    return noChange;
  }

  if (!Array.isArray(raw.steps)) {
    return noChange; // malformed output → keep the existing remaining plan
  }

  const steps: AgentPlanStep[] = [];
  for (const rs of raw.steps) {
    if (steps.length >= stepBudget) break; // cut to the (session-aware) limit
    const v = validateStep(rs);
    if (v) steps.push(v);
  }

  return { changed: true, steps, available: true };
}
