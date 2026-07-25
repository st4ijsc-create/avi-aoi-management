/**
 * AI Chat Assistant Service — Phase 4.3 (Manufacturing Copilot)
 *
 * Natural language chatbot that queries inspection data, defect trends,
 * machine status, runs RCA, image search, and generates reports on demand.
 *
 * WS-G3: cloud LLM removed. Order = local GGUF (primary) → keyword offline
 * fallback. The GGUF path performs JSON-based tool selection (intent) then
 * narrates the tool results locally.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⚠️ DEPRECATED BACKEND — P1 (doc 11), 2026-06-29.
 *
 * `processChat` is the INFERIOR chat backend: 6 hard-coded SQL tools, NO RAG /
 * knowledge-base retrieval. It is NO LONGER wired into production. The canonical
 * path is now `aiLocalKnowledgeService` (RAG + tool registry), reached via:
 *   • streaming → POST /api/ai/local-kb/stream (streamAnswer)
 *   • non-stream → aiChatRouter.chat → answerQuestion()  ← was processChat
 *
 * `processChat` is retained ONLY because aiChatAssistant.ws-g3.test.ts pins its
 * GGUF-ordering/offline behavior.
 *
 * doc69 W0-5 item 3 (2026-07-25): the UI tool-count footer (aiChatRouter.tools) is
 * now sourced from the REAL `aiLocalTools` registry (`listTools()`, ~67 tools), NOT
 * `getAvailableTools` below — `getAvailableTools` is no longer consumed by app code,
 * only by tests that still exercise this deprecated backend directly.
 *
 * WAVE 5 cleanup (this file's original "WAVE 2" note, renumbered — the trigger
 * condition above is now met): delete `processChat` + its 6 tool impls +
 * `getAvailableTools` + the ws-g3 test, and drop this file entirely.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { getDb } from "../db/connection";
import { sql, eq, and, gte, lte, desc, count, avg, inArray, SQL } from "drizzle-orm";
import {
  productInspections,
  measurementResults,
  dailyStatistics,
  machines,
} from "../../drizzle/schema";
import { aiModels, modelVersions } from "../../drizzle/schema/ai";

// ─── Types ─────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ChatRequest {
  conversationId: string;
  messages: ChatMessage[];
  userMessage: string;
  language?: "en" | "vi";
  /** Restrict functions available (e.g. limit to read-only) */
  allowedTools?: string[];
  /** Caller user id — used by the AI Gateway for per-user rate-limit + metrics. */
  userId?: number;
}

export interface ChatResponse {
  reply: string;
  toolsUsed: string[];
  tokensUsed: number;
}

// ─── Tool Definitions ──────────────────────────────────────────

/** Internal tool descriptor (provider-agnostic, OpenAI-compatible shape). */
interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "query_inspection_stats",
      description: "Query inspection statistics (total, OK, NG, defect rate) for a date range and optional machine/product filter.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "ISO date string (YYYY-MM-DD)" },
          endDate: { type: "string", description: "ISO date string (YYYY-MM-DD)" },
          machineCode: { type: "string", description: "Machine code filter (e.g. M-001)" },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_defect_trends",
      description: "Get daily defect rate trend for a date range, grouped by day. Returns time series data.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "ISO date string (YYYY-MM-DD)" },
          endDate: { type: "string", description: "ISO date string (YYYY-MM-DD)" },
          machineCode: { type: "string", description: "Machine code filter" },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_machine_status",
      description: "Get current status and recent performance of a specific machine by its code.",
      parameters: {
        type: "object",
        properties: {
          machineCode: { type: "string", description: "Machine code (e.g. M-001)" },
        },
        required: ["machineCode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_root_cause_analysis",
      description: "Analyze a defect spike on a specific machine and time, looking at measurement data to determine root cause.",
      parameters: {
        type: "object",
        properties: {
          machineCode: { type: "string", description: "Machine code" },
          date: { type: "string", description: "Date of the spike (YYYY-MM-DD)" },
          hour: { type: "number", description: "Hour of the spike (0-23)" },
        },
        required: ["machineCode", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_model_performance",
      description: "Get AI model performance metrics including accuracy, precision, recall, and recent inference count.",
      parameters: {
        type: "object",
        properties: {
          modelCode: { type: "string", description: "AI model code. If not provided, returns all models." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_defects",
      description: "Get the most common defect types in a date range, ranked by frequency.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "ISO date string" },
          endDate: { type: "string", description: "ISO date string" },
          machineCode: { type: "string", description: "Machine code filter" },
          limit: { type: "number", description: "Max number of defect types to return (default 10)" },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
];

// ─── Main Chat Handler ─────────────────────────────────────────

/**
 * Process a user chat message with function calling.
 * The LLM decides which tools to call, we execute them,
 * and feed results back to get a final natural language response.
 *
 * @deprecated P1 (doc 11) — NO-RAG backend, no longer wired into production.
 * Use `answerQuestion`/`streamAnswer` from aiLocalKnowledgeService instead.
 * Kept only for the ws-g3 test; slated for deletion in Wave 2.
 */
export async function processChat(request: ChatRequest): Promise<ChatResponse> {
  // 1. Local GGUF model (primary). Offline-first: no cloud LLM.
  try {
    const { isGgufAvailable } = await import("./aiGgufEngine");
    if (await isGgufAvailable()) {
      return processGgufChat(request);
    }
  } catch {
    // GGUF not available, continue to offline
  }

  // 2. Keyword-based offline fallback
  return processOfflineChat(request);
}

/**
 * Build the tool-selection prompt for GGUF intent classification.
 * Instructs the LLM to pick the right tools + extract parameters as JSON.
 */
function buildToolSelectionPrompt(): string {
  return `You are a tool-selection assistant for a manufacturing quality inspection system.
Given a user message, decide which tools to call and extract their parameters.
Today's date: ${new Date().toISOString().split("T")[0]}

Available tools:
1. query_inspection_stats — Query inspection statistics (total, OK, NG, defect rate). Params: startDate (YYYY-MM-DD, required), endDate (YYYY-MM-DD, required), machineCode (optional, e.g. "M-001").
2. get_defect_trends — Get daily defect rate trend. Params: startDate (required), endDate (required), machineCode (optional).
3. get_machine_status — Get current status of a specific machine. Params: machineCode (required, e.g. "M-001").
4. run_root_cause_analysis — Analyze defect spike for a machine. Params: machineCode (required), date (YYYY-MM-DD, required), hour (0-23, optional).
5. get_model_performance — Get AI model metrics. Params: modelCode (optional).
6. get_top_defects — Get most common defect types. Params: startDate (required), endDate (required), machineCode (optional), limit (number, optional).

Rules:
- Pick 1-3 most relevant tools based on the user's question.
- If no tool clearly matches (e.g. greetings, general questions), use "query_inspection_stats" and "get_top_defects" for a general overview.
- For date ranges: default to last 30 days if unspecified. Use relative dates like "last week" = 7 days back, "this month" = 1st of current month to today.
- Extract machine codes from patterns like M-001, M001, m-1, etc. Normalize to uppercase with dash (e.g. "M-001").
- Output ONLY valid JSON, no other text.

Output format:
{"tools":[{"name":"tool_name","params":{"startDate":"2025-01-01","endDate":"2025-01-31"}}]}`;
}

/**
 * Parse the GGUF tool selection response, extracting the JSON tool calls.
 * Falls back to overview tools if parsing fails.
 */
function parseToolSelection(
  response: string,
  fallbackStartDate: string,
  fallbackEndDate: string,
): { name: string; params: Record<string, unknown> }[] {
  try {
    // Try to extract JSON from the response (may have surrounding text)
    const jsonMatch = response.match(/\{[\s\S]*"tools"[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
      return parsed.tools.map((t: any) => ({
        name: String(t.name ?? ""),
        params: t.params && typeof t.params === "object" ? t.params : {},
      })).filter((t: any) => TOOL_NAMES.has(t.name));
    }
  } catch {
    // JSON parse failed — fall through
  }

  // Fallback: return overview tools
  return [
    { name: "query_inspection_stats", params: { startDate: fallbackStartDate, endDate: fallbackEndDate } },
    { name: "get_top_defects", params: { startDate: fallbackStartDate, endDate: fallbackEndDate, limit: 5 } },
  ];
}

/** Valid tool names for validation */
const TOOL_NAMES = new Set([
  "query_inspection_stats",
  "get_defect_trends",
  "get_machine_status",
  "run_root_cause_analysis",
  "get_model_performance",
  "get_top_defects",
]);

/**
 * GGUF-powered chat: LLM-based tool selection + local LLM for narration.
 * Step 1: Use GGUF to classify user intent → select tools & extract parameters.
 * Step 2: Execute tools, feed results back to GGUF for natural language response.
 */
async function processGgufChat(request: ChatRequest): Promise<ChatResponse> {
  const isVi = (request.language ?? "vi") === "vi";
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startDate = thirtyDaysAgo.toISOString().split("T")[0]!;
  const endDate = today.toISOString().split("T")[0]!;

  const db = await getDb();
  const machineCache = new Map<string, number>();
  const toolsUsed: string[] = [];
  const toolResults: Record<string, unknown> = {};

  try {
    // Step 1: Use GGUF to classify intent and select tools.
    // Model Router (Tier 1 fast) picks the model; keep low temp for deterministic classification.
    const { chatCompletion } = await import("./aiGgufEngine");
    const { planInference } = await import("./aiGateway");
    const selectionPrompt = buildToolSelectionPrompt();

    // AI Gateway: plan (route + rate-limit + A/B + meter) the intent-classification call.
    // doc69 G2-2 — safeText is the redacted userMessage; it (not the raw message) reaches the model.
    const selPlan = planInference({ task: "intent", text: request.userMessage, userId: request.userId });
    const selStart = Date.now();
    const selectionResult = await chatCompletion({
      messages: [
        { role: "system", content: selectionPrompt },
        { role: "user", content: selPlan.safeText },
      ],
      maxTokens: 256,
      temperature: 0.1, // Low temperature for deterministic classification
    }, selPlan.decision.modelId);
    selPlan.record({
      tokensIn: selectionResult.tokensPrompt,
      tokensOut: selectionResult.tokensGenerated,
      latencyMs: Date.now() - selStart,
      outcome: "ok",
    });

    const selectedTools = parseToolSelection(selectionResult.text, startDate, endDate);

    // Step 2: Execute selected tools (with db + cache for optimization)
    for (const tool of selectedTools) {
      try {
        toolResults[tool.name] = await executeToolCall(tool.name, tool.params, db, machineCache);
        toolsUsed.push(tool.name);
      } catch (err) {
        console.error(`[aiChatAssistant] Tool ${tool.name} error:`, err);
      }
    }
  } catch (err) {
    console.error("[aiChatAssistant] GGUF tool selection error:", err);
    // Fallback: run overview tools directly
    try {
      toolResults.inspectionStats = await executeToolCall("query_inspection_stats", { startDate, endDate }, db, machineCache);
      toolsUsed.push("query_inspection_stats");
      toolResults.topDefects = await executeToolCall("get_top_defects", { startDate, endDate, limit: 5 }, db, machineCache);
      toolsUsed.push("get_top_defects");
    } catch {
      // Tools also failed — continue with empty results
    }
  }

  // Use GGUF to generate a natural language response from the tool results
  try {
    const { chatCompletion } = await import("./aiGgufEngine");
    const { planInference } = await import("./aiGateway");
    // doc69 G2-2 — redact tool-result JSON (query results, never a secret by design, but
    // defense-in-depth per the brief's "prompt/messages/tool-result text" scope) before it
    // is embedded in the prompt. Reuses the same pure redactor planInference uses internally.
    const { redactSecretsAndPII } = await import("./ai/aiSafety");
    const systemPrompt = buildSystemPrompt(request.language ?? "vi") +
      "\nYou have access to factory inspection data. Use the provided data to answer the user's question naturally.";

    const dataContext = Object.keys(toolResults).length > 0
      ? `\n\n[Factory Data]\n${redactSecretsAndPII(JSON.stringify(toolResults, null, 2)).text}`
      : "";

    // AI Gateway: route final answer by difficulty (dễ→3B/Tier1, khó→7B/Tier2) + tuned
    // decoding, with per-user rate-limit + A/B + token/latency metering.
    // doc69 G2-2 — safeText is the redacted userMessage; used below INSTEAD OF the raw
    // request.userMessage so a pasted secret never reaches the model.
    const ansPlan = planInference({ task: "chat", text: request.userMessage, userId: request.userId });

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...request.messages.slice(-10).filter(m => m.role === "user" || m.role === "assistant").map(m => ({
        role: m.role as "user" | "assistant",
        content: redactSecretsAndPII(m.content).text,
      })),
      { role: "user" as const, content: ansPlan.safeText + dataContext },
    ];

    const ansStart = Date.now();
    const result = await chatCompletion(
      { messages, maxTokens: ansPlan.decision.maxTokens, temperature: ansPlan.decision.temperature },
      ansPlan.decision.modelId,
    );
    ansPlan.record({
      tokensIn: result.tokensPrompt,
      tokensOut: result.tokensGenerated,
      latencyMs: Date.now() - ansStart,
      outcome: "ok",
    });

    const footer = isVi
      ? `\n\n_Sử dụng local LLM (GGUF) — không cần API key._`
      : `\n\n_Powered by local LLM (GGUF) — no API key needed._`;

    // doc69 G2-2 — output safety: redact any secret the model echoed back before it returns.
    return {
      reply: ansPlan.sanitizeOutput(result.text) + footer,
      toolsUsed,
      tokensUsed: result.tokensGenerated + result.tokensPrompt,
    };
  } catch (err) {
    console.error("[aiChatAssistant] GGUF chat failed:", err);
    // Fall through to offline mode
    return processOfflineChat(request);
  }
}

// ─── System Prompt ─────────────────────────────────────────────

function buildSystemPrompt(language: string): string {
  const lang = language === "vi"
    ? `Bạn là trợ lý AI chuyên về quản lý chất lượng sản xuất (Manufacturing Quality Copilot).
Hãy trả lời bằng tiếng Việt.`
    : `You are an AI assistant specialized in manufacturing quality management (Manufacturing Quality Copilot).
Answer in English.`;

  return `${lang}

You have access to tools that can query the inspection database, analyze defects, and check machine status.
When the user asks about quality data, use the appropriate tool to get real data before answering.
Always provide specific numbers and data when available.
If data is insufficient, say so honestly.
Format numbers clearly: use percentages for rates, abbreviate large numbers.
When showing trends, describe the direction (increasing/decreasing/stable).
Keep answers concise but informative.
Today's date: ${new Date().toISOString().split("T")[0]}`;
}

// ─── Tool Execution ────────────────────────────────────────────

async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  db: Awaited<ReturnType<typeof getDb>> | null,
  machineCache: Map<string, number>,
): Promise<unknown> {
  switch (name) {
    case "query_inspection_stats":
      return toolQueryInspectionStats(args, db, machineCache);
    case "get_defect_trends":
      return toolGetDefectTrends(args, db, machineCache);
    case "get_machine_status":
      return toolGetMachineStatus(args, db, machineCache);
    case "run_root_cause_analysis":
      return toolRunRCA(args, db, machineCache);
    case "get_model_performance":
      return toolGetModelPerformance(args, db);
    case "get_top_defects":
      return toolGetTopDefects(args, db, machineCache);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Tool Implementations ──────────────────────────────────────

/**
 * Get machine ID by code, with caching to avoid duplicate lookups
 */
async function getMachineIdByCode(
  db: Awaited<ReturnType<typeof getDb>> | null,
  machineCode: string,
  cache: Map<string, number>,
): Promise<number | undefined> {
  if (cache.has(machineCode)) {
    return cache.get(machineCode);
  }

  if (!db) return undefined;

  const machine = await db
    .select({ id: machines.id })
    .from(machines)
    .where(eq(machines.code, machineCode))
    .limit(1);

  if (machine[0]) {
    cache.set(machineCode, machine[0].id);
    return machine[0].id;
  }

  return undefined;
}

async function toolQueryInspectionStats(
  args: Record<string, unknown>,
  db: Awaited<ReturnType<typeof getDb>> | null,
  machineCache: Map<string, number>,
) {
  if (!db) return { error: "Database unavailable" };

  const startDate = new Date(args.startDate as string);
  const endDate = new Date(args.endDate as string);
  const machineCode = args.machineCode as string | undefined;

  const conditions: SQL[] = [
    gte(dailyStatistics.date, startDate),
    lte(dailyStatistics.date, endDate),
  ];

  if (machineCode) {
    // OPTIMIZATION: Use cached machine lookup
    const machineId = await getMachineIdByCode(db, machineCode, machineCache);
    if (machineId) {
      conditions.push(eq(dailyStatistics.machineId, machineId));
    }
  }

  const stats = await db.select({
    totalCount: sql<number>`COALESCE(SUM(${dailyStatistics.totalCount}), 0)::int`,
    okCount: sql<number>`COALESCE(SUM(${dailyStatistics.okCount}), 0)::int`,
    ngCount: sql<number>`COALESCE(SUM(${dailyStatistics.ngCount}), 0)::int`,
  })
    .from(dailyStatistics)
    .where(and(...conditions));

  const s = stats[0] ?? { totalCount: 0, okCount: 0, ngCount: 0 };
  const defectRate = s.totalCount > 0 ? ((s.ngCount / s.totalCount) * 100).toFixed(2) : "0.00";

  return {
    period: `${(args.startDate as string)} to ${(args.endDate as string)}`,
    machineCode: machineCode ?? "all",
    totalInspections: s.totalCount,
    ok: s.okCount,
    ng: s.ngCount,
    defectRate: `${defectRate}%`,
  };
}

async function toolGetDefectTrends(
  args: Record<string, unknown>,
  db: Awaited<ReturnType<typeof getDb>> | null,
  machineCache: Map<string, number>,
) {
  if (!db) return { error: "Database unavailable" };

  const startDate = new Date(args.startDate as string);
  const endDate = new Date(args.endDate as string);
  const machineCode = args.machineCode as string | undefined;

  const conditions: SQL[] = [
    gte(dailyStatistics.date, startDate),
    lte(dailyStatistics.date, endDate),
  ];

  if (machineCode) {
    // OPTIMIZATION: Use cached machine lookup
    const machineId = await getMachineIdByCode(db, machineCode, machineCache);
    if (machineId) {
      conditions.push(eq(dailyStatistics.machineId, machineId));
    }
  }

  const rows = await db.select({
    date: dailyStatistics.date,
    total: sql<number>`COALESCE(SUM(${dailyStatistics.totalCount}), 0)::int`,
    ng: sql<number>`COALESCE(SUM(${dailyStatistics.ngCount}), 0)::int`,
  })
    .from(dailyStatistics)
    .where(and(...conditions))
    .groupBy(dailyStatistics.date)
    .orderBy(dailyStatistics.date);

  return {
    trend: rows.map(r => ({
      date: r.date,
      total: r.total,
      ng: r.ng,
      defectRate: r.total > 0 ? `${((r.ng / r.total) * 100).toFixed(2)}%` : "0%",
    })),
    summary: {
      days: rows.length,
      avgDefectRate: rows.length > 0
        ? `${(rows.reduce((sum, r) => sum + (r.total > 0 ? r.ng / r.total : 0), 0) / rows.length * 100).toFixed(2)}%`
        : "N/A",
    },
  };
}

async function toolGetMachineStatus(
  args: Record<string, unknown>,
  db: Awaited<ReturnType<typeof getDb>> | null,
  machineCache: Map<string, number>,
) {
  if (!db) return { error: "Database unavailable" };

  const machineCode = args.machineCode as string;

  const machineRows = await db.select({
    id: machines.id,
    code: machines.code,
    name: machines.name,
    operationStatus: machines.operationStatus,
    stationId: machines.stationId,
  })
    .from(machines)
    .where(eq(machines.code, machineCode))
    .limit(1);

  const machine = machineRows[0];
  if (!machine) return { error: `Machine ${machineCode} not found` };

  // Cache this machine lookup for parallel tool execution
  machineCache.set(machineCode, machine.id);

  // Get recent daily stats (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const recentStats = await db.select({
    totalCount: sql<number>`COALESCE(SUM(${dailyStatistics.totalCount}), 0)::int`,
    okCount: sql<number>`COALESCE(SUM(${dailyStatistics.okCount}), 0)::int`,
    ngCount: sql<number>`COALESCE(SUM(${dailyStatistics.ngCount}), 0)::int`,
  })
    .from(dailyStatistics)
    .where(and(
      eq(dailyStatistics.machineId, machine.id),
      gte(dailyStatistics.date, sevenDaysAgo),
    ));

  const stats = recentStats[0] ?? { totalCount: 0, okCount: 0, ngCount: 0 };

  return {
    machine: {
      code: machine.code,
      name: machine.name,
      status: machine.operationStatus,
      stationId: machine.stationId,
    },
    last7Days: {
      totalInspections: stats.totalCount,
      ok: stats.okCount,
      ng: stats.ngCount,
      defectRate: stats.totalCount > 0
        ? `${((stats.ngCount / stats.totalCount) * 100).toFixed(2)}%`
        : "0%",
    },
  };
}

async function toolRunRCA(
  args: Record<string, unknown>,
  db: Awaited<ReturnType<typeof getDb>> | null,
  machineCache: Map<string, number>,
) {
  if (!db) return { error: "Database unavailable" };

  const machineCode = args.machineCode as string;
  const date = new Date(args.date as string);
  const hour = args.hour as number | undefined;

  // OPTIMIZATION: Use cached machine lookup
  const machineId = await getMachineIdByCode(db, machineCode, machineCache);
  if (!machineId) return { error: `Machine ${machineCode} not found` };

  // Get inspections for that day
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const conditions: SQL[] = [
    eq(productInspections.machineId, machineId),
    gte(productInspections.inspectionTime, dayStart),
    lte(productInspections.inspectionTime, dayEnd),
  ];

  if (hour !== undefined) {
    const hourStart = new Date(date);
    hourStart.setHours(hour, 0, 0, 0);
    const hourEnd = new Date(date);
    hourEnd.setHours(hour, 59, 59, 999);
    conditions.push(gte(productInspections.inspectionTime, hourStart));
    conditions.push(lte(productInspections.inspectionTime, hourEnd));
  }

  const inspections = await db.select({
    total: count(),
    ng: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')`,
  })
    .from(productInspections)
    .where(and(...conditions));

  const total = inspections[0]?.total ?? 0;
  const ng = (inspections[0]?.ng as number) ?? 0;

  // Get measurement deviations for NG items
  const ngInspections = await db.select({
    id: productInspections.id,
    inspectionTime: productInspections.inspectionTime,
  })
    .from(productInspections)
    .where(and(
      ...conditions,
      eq(productInspections.overallResult, "NG"),
    ))
    .limit(50);

  const ngIds = ngInspections.map(i => i.id);

  let measurementIssues: { name: string; outOfSpecCount: number }[] = [];
  if (ngIds.length > 0) {
    const measResults = await db.execute(sql`
      SELECT mpd.name, COUNT(*) as out_of_spec_count
      FROM measurement_results mr
      JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
      WHERE mr."inspectionId" = ANY(${sql`ARRAY[${sql.join(ngIds.map((id) => sql`${id}`), sql`,`)}]`}::int[])
        AND mr.result = 'NG'
      GROUP BY mpd.name
      ORDER BY out_of_spec_count DESC
      LIMIT 10
    `) as any;

    measurementIssues = (measResults.rows ?? measResults).map((r: any) => ({
      name: r.name,
      outOfSpecCount: Number(r.out_of_spec_count),
    }));
  }

  return {
    machine: machineCode,
    date: args.date,
    hour: hour ?? "all day",
    totalInspections: total,
    ngCount: ng,
    defectRate: total > 0 ? `${((ng / total) * 100).toFixed(2)}%` : "0%",
    topMeasurementIssues: measurementIssues,
    analysis: measurementIssues.length > 0
      ? `Top issue: "${measurementIssues[0]!.name}" with ${measurementIssues[0]!.outOfSpecCount} out-of-spec results.`
      : "No specific measurement issues identified.",
  };
}

async function toolGetModelPerformance(
  args: Record<string, unknown>,
  db: Awaited<ReturnType<typeof getDb>> | null,
) {
  if (!db) return { error: "Database unavailable" };

  const modelCode = args.modelCode as string | undefined;

  const conditions: SQL[] = [];
  if (modelCode) {
    conditions.push(eq(aiModels.code, modelCode));
  }

  const modelRows = await db.select({
    id: aiModels.id,
    code: aiModels.code,
    name: aiModels.name,
    modelType: aiModels.modelType,
    currentVersion: aiModels.currentVersion,
    status: aiModels.status,
    metadata: aiModels.metadata,
  })
    .from(aiModels)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(aiModels.createdAt))
    .limit(10);

  if (modelRows.length === 0) return { models: [] };

  // OPTIMIZATION: Batch load all model versions in a single query instead of N queries in a loop
  const modelIds = modelRows.map(m => m.id);
  const versionMetrics = await db.select({
    modelId: modelVersions.modelId,
    version: modelVersions.version,
    metrics: modelVersions.metrics,
    accuracy: modelVersions.accuracy,
  })
    .from(modelVersions)
    .where(inArray(modelVersions.modelId, modelIds));

  // Index metrics by modelId + version for fast lookup
  const metricsMap = new Map<string, typeof versionMetrics[0]>();
  for (const vm of versionMetrics) {
    metricsMap.set(`${vm.modelId}:${vm.version}`, vm);
  }

  const results = [];
  for (const m of modelRows) {
    let metrics: { accuracy?: string; precision?: string; recall?: string; f1Score?: string } = {};
    if (m.currentVersion) {
      const vm = metricsMap.get(`${m.id}:${m.currentVersion}`);
      if (vm) {
        const vMetrics = vm.metrics as { accuracy?: number; precision?: number; recall?: number; f1Score?: number } | null;
        if (vMetrics) {
          metrics = {
            accuracy: vMetrics.accuracy != null ? `${vMetrics.accuracy.toFixed(2)}%` : undefined,
            precision: vMetrics.precision != null ? `${vMetrics.precision.toFixed(2)}%` : undefined,
            recall: vMetrics.recall != null ? `${vMetrics.recall.toFixed(2)}%` : undefined,
            f1Score: vMetrics.f1Score != null ? `${vMetrics.f1Score.toFixed(2)}%` : undefined,
          };
        } else if (vm.accuracy) {
          metrics.accuracy = `${Number(vm.accuracy).toFixed(2)}%`;
        }
      }
    }
    results.push({
      code: m.code,
      name: m.name,
      type: m.modelType,
      version: m.currentVersion,
      status: m.status,
      metrics: {
        accuracy: metrics.accuracy ?? "N/A",
        precision: metrics.precision ?? "N/A",
        recall: metrics.recall ?? "N/A",
        f1Score: metrics.f1Score ?? "N/A",
      },
    });
  }

  return { models: results };
}

async function toolGetTopDefects(
  args: Record<string, unknown>,
  db: Awaited<ReturnType<typeof getDb>> | null,
  machineCache: Map<string, number>,
) {
  if (!db) return { error: "Database unavailable" };

  const startDate = new Date(args.startDate as string);
  const endDate = new Date(args.endDate as string);
  const machineCode = args.machineCode as string | undefined;
  const limit = (args.limit as number) ?? 10;

  // OPTIMIZATION: Use cached machine lookup if provided
  let machineId: number | undefined;
  if (machineCode) {
    machineId = await getMachineIdByCode(db, machineCode, machineCache);
  }

  const machineCondition = machineId
    ? sql`AND pi."machineId" = ${machineId}`
    : sql``;

  // Query top failing measurement points as defect types
  const results = await db.execute(sql`
    SELECT 
      mpd.name as defect_type,
      COUNT(*) as defect_count,
      ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 2) as percentage
    FROM measurement_results mr
    JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
    JOIN product_inspections pi ON mr."inspectionId" = pi.id
    WHERE pi."inspectionTime" >= ${startDate.toISOString()}
      AND pi."inspectionTime" <= ${endDate.toISOString()}
      AND pi."overallResult" = 'NG'
      AND mr.result = 'NG'
      ${machineCondition}
    GROUP BY mpd.name
    ORDER BY defect_count DESC
    LIMIT ${limit}
  `) as any;

  const rows = (results.rows ?? results) as any[];

  return {
    period: `${args.startDate} to ${args.endDate}`,
    machineCode: machineCode ?? "all",
    topDefects: rows.map((r: any) => ({
      type: r.defect_type,
      count: Number(r.defect_count),
      percentage: `${r.percentage}%`,
    })),
  };
}

// ─── Offline Chat Fallback ────────────────────────────────────

/**
 * Rule-based offline processor for when no local GGUF model is available.
 * Detects intent from message keywords, calls the appropriate tool functions
 * directly, and formats results as readable text.
 */
async function processOfflineChat(request: ChatRequest): Promise<ChatResponse> {
  const msg = request.userMessage.toLowerCase();
  const isVi = (request.language ?? "vi") === "vi";

  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startDate = thirtyDaysAgo.toISOString().split("T")[0]!;
  const endDate = today.toISOString().split("T")[0]!;

  const db = await getDb();
  const machineCache = new Map<string, number>();

  // Extract machine code if mentioned (e.g. M-001)
  const machineMatch = msg.match(/\bm[-_]?\d+\b/i);
  const machineCode = machineMatch ? machineMatch[0].toUpperCase() : undefined;

  const toolsUsed: string[] = [];
  const parts: string[] = [];

  try {
    const wantsStats  = /thống kê|statistic|inspection stat|kiểm tra|tổng số|total/.test(msg);
    const wantsTrends = /xu hướng|trend|diễn biến|biến động/.test(msg);
    const wantsMachine = (/máy|machine|trạng thái|status/.test(msg)) && !!machineCode;
    const wantsRCA    = /nguyên nhân|root cause|rca|phân tích lỗi|spike/.test(msg);
    const wantsModel  = /mô hình|model|ai model|accuracy|độ chính xác/.test(msg);
    const wantsDefects = /lỗi|defect|top defect|loại lỗi|phổ biến/.test(msg);
    const runOverview = !wantsStats && !wantsTrends && !wantsMachine && !wantsRCA && !wantsModel && !wantsDefects;

    if (runOverview || wantsStats) {
      const result = await toolQueryInspectionStats({ startDate, endDate, machineCode }, db, machineCache) as any;
      toolsUsed.push("query_inspection_stats");
      if (!result.error) {
        parts.push(isVi
          ? `📊 **Thống kê kiểm tra (${result.period}):**\n- Tổng: ${result.totalInspections.toLocaleString()} sản phẩm\n- OK: ${result.ok.toLocaleString()} | NG: ${result.ng.toLocaleString()}\n- Tỷ lệ lỗi: **${result.defectRate}**`
          : `📊 **Inspection Stats (${result.period}):**\n- Total: ${result.totalInspections.toLocaleString()} products\n- OK: ${result.ok.toLocaleString()} | NG: ${result.ng.toLocaleString()}\n- Defect rate: **${result.defectRate}**`);
      }
    }

    if (runOverview || wantsDefects) {
      const result = await toolGetTopDefects({ startDate, endDate, machineCode, limit: 5 }, db, machineCache) as any;
      toolsUsed.push("get_top_defects");
      if (!result.error && result.topDefects?.length > 0) {
        const lines = result.topDefects.map((x: any, i: number) => `  ${i + 1}. ${x.type}: ${x.count} (${x.percentage})`).join("\n");
        parts.push(isVi ? `🔴 **Top lỗi phổ biến:**\n${lines}` : `🔴 **Top Defects:**\n${lines}`);
      }
    }

    if (wantsTrends) {
      const result = await toolGetDefectTrends({ startDate, endDate, machineCode }, db, machineCache) as any;
      toolsUsed.push("get_defect_trends");
      if (!result.error) {
        parts.push(isVi
          ? `📈 **Xu hướng lỗi (${result.summary.days} ngày):** Tỷ lệ lỗi TB = ${result.summary.avgDefectRate}`
          : `📈 **Defect Trend (${result.summary.days} days):** Avg defect rate = ${result.summary.avgDefectRate}`);
      }
    }

    if (wantsMachine && machineCode) {
      const result = await toolGetMachineStatus({ machineCode }, db, machineCache) as any;
      toolsUsed.push("get_machine_status");
      if (!result.error) {
        parts.push(isVi
          ? `🔧 **Máy ${machineCode}:** ${result.machine.name} — Trạng thái: ${result.machine.status}\n  7 ngày gần: ${result.last7Days.totalInspections} sp | Tỷ lệ lỗi ${result.last7Days.defectRate}`
          : `🔧 **Machine ${machineCode}:** ${result.machine.name} — Status: ${result.machine.status}\n  Last 7 days: ${result.last7Days.totalInspections} products | Defect rate ${result.last7Days.defectRate}`);
      }
    }

    if (wantsModel) {
      const result = await toolGetModelPerformance({}, db) as any;
      toolsUsed.push("get_model_performance");
      if (!result.error && result.models?.length > 0) {
        const lines = result.models.slice(0, 3).map((m: any) =>
          `  • ${m.name} [${m.status}] — Accuracy: ${m.metrics.accuracy}`).join("\n");
        parts.push(isVi ? `🤖 **Mô hình AI:**\n${lines}` : `🤖 **AI Models:**\n${lines}`);
      }
    }

    if (wantsRCA && machineCode) {
      const result = await toolRunRCA({ machineCode, date: endDate }, db, machineCache) as any;
      toolsUsed.push("run_root_cause_analysis");
      if (!result.error) {
        parts.push(isVi
          ? `🔍 **Phân tích nguyên nhân (${machineCode}):**\n  ${result.analysis}`
          : `🔍 **Root Cause Analysis (${machineCode}):**\n  ${result.analysis}`);
      }
    }
  } catch (err) {
    parts.push(isVi
      ? `⚠️ Lỗi truy vấn dữ liệu: ${err instanceof Error ? err.message : String(err)}`
      : `⚠️ Data query error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const footer = isVi
    ? `\n\n_Chế độ offline (quy tắc) — nạp mô hình GGUF cục bộ để nhận phân tích ngôn ngữ tự nhiên._`
    : `\n\n_Offline mode (rule-based) — load a local GGUF model for natural language analysis._`;

  const welcome = isVi
    ? `Xin chào! Tôi đang chạy ở chế độ offline.\nBạn có thể hỏi về: thống kê kiểm tra, xu hướng lỗi, trạng thái máy (M-001), mô hình AI.\nVí dụ: "Thống kê 30 ngày qua" hay "Top lỗi tháng này"`
    : `Hello! Running in offline mode.\nYou can ask about: inspection stats, defect trends, machine status (M-001), AI models.\nExample: "Inspection stats last 30 days" or "Top defects this month"`;

  const reply = parts.length > 0 ? parts.join("\n\n") + footer : welcome + footer;
  return { reply, toolsUsed, tokensUsed: 0 };
}

// ─── Chat History Helpers ──────────────────────────────────────

/**
 * Get a summary of available chat tools for display in UI.
 */
export function getAvailableTools(): { name: string; description: string }[] {
  return TOOLS.filter(t => t.type === "function").map(t => ({
    name: t.function.name,
    description: t.function.description ?? "",
  }));
}
