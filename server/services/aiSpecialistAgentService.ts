import { generateText, isGgufAvailable, type GgufGenerateResult } from "./aiGgufEngine";
// doc69 Giai đoạn 4/Wave 3 D4 — specialist→action HITL bridge allow-list (see the
// block near the end of this file for the full rationale).
import { RCA_SUGGESTED_ACTION_TOOLS, ensureRcaToolsRegistered } from "./ai/rcaActionSuggester";
import type { RepoContextResult } from "./ai/repoContextService";

export type SpecialistAgentId =
  | "data-analyst"
  | "backend-engineer"
  | "frontend-engineer"
  | "qa-optimizer";

export interface SpecialistAgentInfo {
  id: SpecialistAgentId;
  name: string;
  role: string;
  focus: string[];
  outputContract: string[];
}

export interface RunSpecialistAgentInput {
  agentId: SpecialistAgentId;
  objective: string;
  moduleName?: string;
  currentBehavior?: string;
  desiredBehavior?: string;
  techStack?: string[];
  codeSnippet?: string;
  errorLogs?: string;
  constraints?: string[];
  acceptanceCriteria?: string[];
  files?: string[];
  language?: "vi" | "en";
  modelId?: string;
  /** Wave 1 — ngữ cảnh repo đã nạp sẵn (nội dung file thật + phụ thuộc + RAG). */
  repoContext?: RepoContextResult;
}

export interface SpecialistAgentRunResult {
  agent: SpecialistAgentInfo;
  modelId: string;
  output: {
    summary: string;
    diagnosis: string[];
    actionPlan: string[];
    patchHints: string[];
    testPlan: string[];
    optimizationIdeas: string[];
    risks: string[];
    reportTemplate: string[];
  };
  rawText: string;
  metrics: Pick<GgufGenerateResult, "tokensGenerated" | "tokensPrompt" | "totalTimeMs" | "tokensPerSecond">;
}

export interface RunSpecialistWorkflowInput extends Omit<RunSpecialistAgentInput, "agentId"> {
  includeBackend?: boolean;
  includeFrontend?: boolean;
  includeQa?: boolean;
}

export interface SpecialistWorkflowStepResult {
  stepOrder: number;
  agentId: SpecialistAgentId;
  result: SpecialistAgentRunResult;
}

export interface SpecialistWorkflowResult {
  orderedAgents: SpecialistAgentId[];
  steps: SpecialistWorkflowStepResult[];
  finalSummary: string;
}

const SPECIALIST_AGENTS: Record<SpecialistAgentId, SpecialistAgentInfo> = {
  "data-analyst": {
    id: "data-analyst",
    name: "Data Insight Agent",
    role: "AI Agent chuyen phan tich du lieu module va toi uu KPI",
    focus: [
      "tim pattern bat thuong va root-cause",
      "de xuat metric dashboard thuc dung",
      "uu tien khuyen nghi co the do luong",
    ],
    outputContract: [
      "summary",
      "diagnosis",
      "actionPlan",
      "optimizationIdeas",
      "risks",
    ],
  },
  "backend-engineer": {
    id: "backend-engineer",
    name: "Backend Refactor Agent",
    role: "AI Agent chuyen thiet ke moi, nang cap, tim va sua loi backend",
    focus: [
      "API contract, transaction, retry, error handling",
      "hieu nang truy van, cache, queue, scheduler",
      "bao toan backward compatibility",
    ],
    outputContract: [
      "summary",
      "diagnosis",
      "actionPlan",
      "patchHints",
      "testPlan",
      "risks",
    ],
  },
  "frontend-engineer": {
    id: "frontend-engineer",
    name: "Frontend UX Agent",
    role: "AI Agent chuyen redesign frontend, cai tien UX va sua bug giao dien",
    focus: [
      "luong nguoi dung, kha nang mo rong component",
      "state management va network state",
      "hieu nang render, accessibility, i18n",
    ],
    outputContract: [
      "summary",
      "diagnosis",
      "actionPlan",
      "patchHints",
      "testPlan",
      "optimizationIdeas",
    ],
  },
  "qa-optimizer": {
    id: "qa-optimizer",
    name: "QA Test Strategist Agent",
    role: "AI Agent chuyen kiem thu, lap test plan, va bao cao toi uu module",
    focus: [
      "test matrix unit-integration-e2e",
      "thiet ke testcase bien, negative path, race condition",
      "bao cao QA va de xuat cai tien uu tien cao",
    ],
    outputContract: [
      "summary",
      "diagnosis",
      "testPlan",
      "actionPlan",
      "reportTemplate",
      "risks",
    ],
  },
};

const JSON_OUTPUT_SCHEMA = `{
  "summary": "string",
  "diagnosis": ["string"],
  "actionPlan": ["string"],
  "patchHints": ["string"],
  "testPlan": ["string"],
  "optimizationIdeas": ["string"],
  "risks": ["string"],
  "reportTemplate": ["string"]
}`;

function stringifyList(values?: string[]): string {
  if (!values || values.length === 0) return "(none)";
  return values.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function sanitizeJsonBlock(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```") ) return trimmed;

  const withoutStart = trimmed.replace(/^```[a-zA-Z]*\n?/, "");
  return withoutStart.replace(/\n?```$/, "").trim();
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAgentOutput(rawText: string): SpecialistAgentRunResult["output"] {
  const fallback = {
    summary: rawText.trim(),
    diagnosis: [],
    actionPlan: [],
    patchHints: [],
    testPlan: [],
    optimizationIdeas: [],
    risks: [],
    reportTemplate: [],
  };

  try {
    const parsed = JSON.parse(sanitizeJsonBlock(rawText));
    return {
      summary: typeof parsed?.summary === "string" ? parsed.summary.trim() : fallback.summary,
      diagnosis: ensureStringArray(parsed?.diagnosis),
      actionPlan: ensureStringArray(parsed?.actionPlan),
      patchHints: ensureStringArray(parsed?.patchHints),
      testPlan: ensureStringArray(parsed?.testPlan),
      optimizationIdeas: ensureStringArray(parsed?.optimizationIdeas),
      risks: ensureStringArray(parsed?.risks),
      reportTemplate: ensureStringArray(parsed?.reportTemplate),
    };
  } catch {
    return fallback;
  }
}

function buildSystemPrompt(agent: SpecialistAgentInfo, language: "vi" | "en"): string {
  const languageRule =
    language === "vi"
      ? "Tra loi bang tieng Viet, ngan gon, chinh xac, uu tien hanh dong co the thuc hien ngay."
      : "Answer in English, concise and practical, with implementation-ready guidance.";

  return [
    `You are ${agent.name}.`,
    `Role: ${agent.role}.`,
    "You are working in a manufacturing quality software monorepo.",
    "Always give structured engineering output and avoid generic advice.",
    "Prioritize bug prevention, measurable impact, and maintainability.",
    languageRule,
    "Return strict JSON only with this schema:",
    JSON_OUTPUT_SCHEMA,
  ].join("\n");
}

/**
 * Wave 1 — dựng khối ngữ cảnh repo cho prompt. Trả chuỗi rỗng khi không có
 * repoContext, để prompt giữ NGUYÊN hành vi cũ (không đổi một byte).
 */
function buildRepoContextBlock(ctx?: RepoContextResult): string {
  if (!ctx) return "";
  const parts: string[] = [];

  if (ctx.files.length > 0) {
    const bodies = ctx.files.map((f) =>
      [
        `--- FILE CONTENT: ${f.path}${f.truncated ? " (truncated — only the first part is shown)" : ""}${f.redacted ? " (secrets redacted)" : ""} ---`,
        f.content,
      ].join("\n"),
    );
    parts.push(bodies.join("\n\n"));
  }

  if (ctx.skipped.length > 0) {
    parts.push(
      `Files NOT loaded (do not assume their content):\n${ctx.skipped
        .map((s) => `- ${s.path} (${s.reason})`)
        .join("\n")}`,
    );
  }

  if (ctx.dependencies.length > 0) {
    parts.push(`Files imported by the above:\n${ctx.dependencies.map((d) => `- ${d}`).join("\n")}`);
  }

  if (ctx.ragSnippets.length > 0) {
    parts.push(
      `Related context from the knowledge base:\n${ctx.ragSnippets
        .map((s) => `- (${s.sourcePath}) ${s.text}`)
        .join("\n")}`,
    );
  }

  return parts.join("\n\n");
}

function buildUserPrompt(input: RunSpecialistAgentInput): string {
  const repoBlock = buildRepoContextBlock(input.repoContext);
  return [
    `Objective: ${input.objective}`,
    `Module: ${input.moduleName ?? "(not specified)"}`,
    `Current behavior: ${input.currentBehavior ?? "(not specified)"}`,
    `Desired behavior: ${input.desiredBehavior ?? "(not specified)"}`,
    `Tech stack:\n${stringifyList(input.techStack)}`,
    `Constraints:\n${stringifyList(input.constraints)}`,
    `Acceptance criteria:\n${stringifyList(input.acceptanceCriteria)}`,
    `Related files:\n${stringifyList(input.files)}`,
    `Error logs:\n${input.errorLogs ?? "(none)"}`,
    "Code snippet:",
    input.codeSnippet ?? "(none)",
    ...(repoBlock ? [repoBlock] : []),
    "Focus your recommendations on this exact context only.",
  ].join("\n\n");
}

export function listSpecialistAgents(): SpecialistAgentInfo[] {
  return Object.values(SPECIALIST_AGENTS);
}

export function buildWorkflowAgentOrder(input: RunSpecialistWorkflowInput): SpecialistAgentId[] {
  const includeBackend = input.includeBackend !== false;
  const includeFrontend = input.includeFrontend !== false;
  const includeQa = input.includeQa !== false;

  const order: SpecialistAgentId[] = ["data-analyst"];
  if (includeBackend) order.push("backend-engineer");
  if (includeFrontend) order.push("frontend-engineer");
  if (includeQa) order.push("qa-optimizer");

  return order;
}

function buildWorkflowObjective(
  baseObjective: string,
  currentAgentId: SpecialistAgentId,
  previousSteps: SpecialistWorkflowStepResult[],
): string {
  if (previousSteps.length === 0) return baseObjective;

  const summaries = previousSteps
    .map((step) => `- ${step.agentId}: ${step.result.output.summary}`)
    .join("\n");

  return [
    baseObjective,
    "Use the previous specialist outputs below as mandatory context:",
    summaries,
    `Now focus on your role as ${currentAgentId} and provide an executable plan.`,
  ].join("\n\n");
}

export async function runSpecialistWorkflowChain(
  input: RunSpecialistWorkflowInput,
): Promise<SpecialistWorkflowResult> {
  const orderedAgents = buildWorkflowAgentOrder(input);
  const steps: SpecialistWorkflowStepResult[] = [];

  for (let i = 0; i < orderedAgents.length; i++) {
    const agentId = orderedAgents[i];
    const stepResult = await runSpecialistAgent({
      ...input,
      agentId,
      objective: buildWorkflowObjective(input.objective, agentId, steps),
    });

    steps.push({
      stepOrder: i + 1,
      agentId,
      result: stepResult,
    });
  }

  const finalSummary = steps[steps.length - 1]?.result.output.summary ?? "";
  return {
    orderedAgents,
    steps,
    finalSummary,
  };
}

export async function runSpecialistAgent(input: RunSpecialistAgentInput): Promise<SpecialistAgentRunResult> {
  const available = await isGgufAvailable();
  if (!available) {
    throw new Error("GGUF engine is not available. Ensure node-llama-cpp is installed and configured.");
  }

  const agent = SPECIALIST_AGENTS[input.agentId];
  if (!agent) {
    throw new Error(`Unknown specialist agent: ${input.agentId}`);
  }

  const result = await generateText(
    {
      systemPrompt: buildSystemPrompt(agent, input.language ?? "vi"),
      prompt: buildUserPrompt(input),
      maxTokens: 1400,
      temperature: 0.25,
      topP: 0.9,
      repeatPenalty: 1.1,
      jsonMode: true,
      language: input.language ?? "vi",
    },
    input.modelId,
  );

  return {
    agent,
    modelId: result.modelId,
    output: parseAgentOutput(result.text),
    rawText: result.text,
    metrics: {
      tokensGenerated: result.tokensGenerated,
      tokensPrompt: result.tokensPrompt,
      totalTimeMs: result.totalTimeMs,
      tokensPerSecond: result.tokensPerSecond,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Audit Presets
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleAuditPreset {
  id: string;
  label: string;
  description: string;
  moduleName: string;
  files: string[];
  techStack: string[];
  objective: string;
  constraints: string[];
  includeBackend: boolean;
  includeFrontend: boolean;
  includeQa: boolean;
}

const MODULE_AUDIT_PRESETS: Record<string, ModuleAuditPreset> = {
  "ai-chat": {
    id: "ai-chat",
    label: "AI Chat Module",
    description: "Audit toàn diện AI Chat: bảo mật IDOR, inference hiệu năng, UX conversation flow",
    moduleName: "ai-chat",
    files: [
      "server/routers/aiChatRouter.ts",
      "server/db/aiChat.ts",
      "client/src/pages/ai-chat.tsx",
    ],
    techStack: ["tRPC", "node-llama-cpp", "React 19", "Drizzle ORM", "PostgreSQL"],
    objective:
      "Audit module AI Chat: tìm lỗi bảo mật (IDOR, injection), hiệu năng inference GGUF, UX conversation flow, và đề xuất cải tiến cụ thể.",
    constraints: [
      "Không thay đổi database schema hiện có",
      "Phải backward-compatible với API hiện tại",
      "Context window GGUF tối đa 4096 token",
    ],
    includeBackend: true,
    includeFrontend: true,
    includeQa: true,
  },
  "ai-inspection-analytics": {
    id: "ai-inspection-analytics",
    label: "Inspection Analytics AI",
    description: "Audit analytics: enum correctness, SQL query hiệu năng, KPI accuracy",
    moduleName: "ai-inspection-analytics",
    files: [
      "server/services/aiInspectionAnalytics.ts",
      "server/routers/aiInspectionRouter.ts",
    ],
    techStack: ["PostgreSQL", "Drizzle ORM", "tRPC", "node-llama-cpp"],
    objective:
      "Audit module AI Inspection Analytics: kiểm tra enum OK/NG vs PASS/FAIL, tối ưu query SQL, độ chính xác phân tích xu hướng lỗi, và đề xuất KPI mới phù hợp sản xuất.",
    constraints: [
      "Enum chuẩn là OK/NG, cần backward-compatible với PASS/FAIL legacy",
      "Không break existing chart/report API",
    ],
    includeBackend: true,
    includeFrontend: false,
    includeQa: true,
  },
  "ai-analysis-hub": {
    id: "ai-analysis-hub",
    label: "AI Analysis Hub",
    description: "Audit vision + embedding + similarity search hub",
    moduleName: "ai-analysis-hub",
    files: [
      "server/routers/aiAnalysisHubRouter.ts",
      "server/services/aiGgufEngine.ts",
      "server/services/aiImageEmbedding.ts",
    ],
    techStack: ["node-llama-cpp", "GGUF", "tRPC", "Sharp", "PostgreSQL"],
    objective:
      "Audit AI Analysis Hub: bảo mật path traversal, hiệu năng embedding pipeline, logic similarity search pgvector, và mở rộng vision analysis capability.",
    constraints: [
      "Image path phải confined trong uploads/",
      "GPU layers có thể thay đổi theo hardware environment",
    ],
    includeBackend: true,
    includeFrontend: false,
    includeQa: true,
  },
  "ai-vision-language": {
    id: "ai-vision-language",
    label: "Vision Language Module",
    description: "Audit VLM router: path security, multimodal pipeline, error handling",
    moduleName: "ai-vision-language",
    files: [
      "server/routers/aiVisionLanguageRouter.ts",
      "server/services/aiVisionLanguage.ts",
      "server/utils/safeImagePath.ts",
    ],
    techStack: ["node-llama-cpp", "LLaVA/Qwen-VL GGUF", "tRPC", "Sharp"],
    objective:
      "Audit module Vision Language: kiểm tra path traversal protection, multimodal prompt engineering, xử lý lỗi ảnh corrupted, và tối ưu inference latency.",
    constraints: [
      "Image path phải validated và confined trong uploads/",
      "Chỉ hỗ trợ định dạng JPEG/PNG/WEBP",
    ],
    includeBackend: true,
    includeFrontend: false,
    includeQa: true,
  },
  "ai-specialist-agent": {
    id: "ai-specialist-agent",
    label: "Specialist Agent System",
    description: "Self-audit hệ thống multi-agent workflow chain",
    moduleName: "ai-specialist-agent",
    files: [
      "server/services/aiSpecialistAgentService.ts",
      "server/routers/aiSpecialistAgentRouter.ts",
      "server/db/aiSpecialist.ts",
      "drizzle/schema/ai.ts",
    ],
    techStack: ["node-llama-cpp", "GGUF", "tRPC", "Drizzle ORM", "PostgreSQL"],
    objective:
      "Self-audit hệ thống Specialist Agent: session ownership enforcement, workflow chain reliability, token efficiency, schema chuẩn hoá JSON output, và cải tiến output quality.",
    constraints: [
      "Session phải enforce userId ownership ở mọi query",
      "Output JSON phải parseable kể cả khi model trả về markdown code block",
    ],
    includeBackend: true,
    includeFrontend: false,
    includeQa: true,
  },
};

export function listModuleAuditPresets(): ModuleAuditPreset[] {
  return Object.values(MODULE_AUDIT_PRESETS);
}

export function getModuleAuditPreset(id: string): ModuleAuditPreset | undefined {
  return MODULE_AUDIT_PRESETS[id];
}

// ─────────────────────────────────────────────────────────────────────────────
// Specialist → Action HITL Bridge (doc69 Giai đoạn 4 / Wave 3, D4)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `SpecialistAgentRunResult.output.actionPlan` is advisory TEXT with NO trusted
 * entity context to safely auto-build tool args from (unlike
 * server/services/ai/rcaActionSuggester.ts, which is always scoped to one already-
 * verified machine via `SuggestActionsContext.machineId`). A data-analyst/backend/
 * frontend/qa-optimizer run only carries `moduleName`/`files`/`techStack` — nothing
 * this module can trust as a real machineId, so it deliberately does NOT attempt to
 * parse/guess a {tool,args} mapping out of the recommendation text — doing so would
 * mean FABRICATING an entity reference, which the brief explicitly forbids.
 *
 * Instead, the router endpoint (aiSpecialistAgentRouter.proposeRecommendationAsAction)
 * requires the CALLER (a human reviewing the actionPlan item) to supply the concrete
 * `{tool, args}` it maps to. This module's job is only to restrict `tool` to a small,
 * explicit allow-list of SAFE, non-actuation write-tools an engineering recommendation
 * could honestly justify (analysis/request writes — never machine actuation, quality
 * disposition, or a spec/limit change). That allow-list is intentionally the exact
 * same 3 tools rcaActionSuggester.ts is permitted to suggest — both bridges are
 * constrained to "advisory-write" tools for the identical reason — so it is reused
 * directly rather than duplicated (a single place to extend/audit the allow-list).
 * The router re-validates `args` against the tool's OWN zod schema (mirrors
 * aiCopilotRouter.proposeSuggestedAction) before ever calling
 * aiCopilotActions.proposeAction — never fabricated, never auto-executed (propose-
 * only; a human must still confirm via the EXISTING confirmAction flow). A
 * recommendation whose tool/args don't validate is REJECTED and stays advisory-only
 * text — never silently coerced.
 */
export const SPECIALIST_BRIDGE_TOOLS = RCA_SUGGESTED_ACTION_TOOLS;
export type SpecialistBridgeTool = (typeof SPECIALIST_BRIDGE_TOOLS)[number];

/** Idempotent (delegates to rcaActionSuggester's own registration guard) — ensures
 *  the allow-listed write-tools are registered before the router validates a
 *  candidate mapping. Re-exported so the router only needs to import from this
 *  service module, not reach into server/services/ai/rcaActionSuggester.ts directly. */
export const ensureSpecialistBridgeToolsRegistered: () => Promise<void> = ensureRcaToolsRegistered;
