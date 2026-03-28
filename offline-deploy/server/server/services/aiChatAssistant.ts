/**
 * AI Chat Assistant Service — Phase 4.3 (Manufacturing Copilot)
 *
 * Natural language chatbot that uses OpenAI function calling to query
 * inspection data, defect trends, machine status, run RCA, image search,
 * and generate reports on demand.
 */

import OpenAI from "openai";
import { getDb } from "../db/connection";
import { sql, eq, and, gte, lte, desc, count, avg, SQL } from "drizzle-orm";
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
}

export interface ChatResponse {
  reply: string;
  toolsUsed: string[];
  tokensUsed: number;
}

// ─── OpenAI Setup ──────────────────────────────────────────────

// Lazy getter — returns null if OPENAI_API_KEY is not configured
function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}
const CHAT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

// ─── Tool Definitions ──────────────────────────────────────────

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
 */
export async function processChat(request: ChatRequest): Promise<ChatResponse> {
  // Offline fallback when no OpenAI API key is configured
  if (!process.env.OPENAI_API_KEY) {
    return processOfflineChat(request);
  }

  const openai = getOpenAIClient()!;
  const systemPrompt = buildSystemPrompt(request.language ?? "vi");

  // Build messages for OpenAI
  const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  // Add conversation history (limit to last 20 messages for context window)
  const recentHistory = request.messages.slice(-20);
  for (const msg of recentHistory) {
    if (msg.role === "user" || msg.role === "assistant") {
      openaiMessages.push({ role: msg.role, content: msg.content });
    }
  }

  // Add the new user message
  openaiMessages.push({ role: "user", content: request.userMessage });

  // Filter tools if restricted
  const availableTools = request.allowedTools
    ? TOOLS.filter(t => t.type === "function" && request.allowedTools!.includes(t.function.name))
    : TOOLS;

  const toolsUsed: string[] = [];
  let totalTokens = 0;

  // First LLM call — may request tool calls
  let response = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: openaiMessages,
    tools: availableTools.length > 0 ? availableTools : undefined,
    tool_choice: availableTools.length > 0 ? "auto" : undefined,
    temperature: 0.3,
    max_tokens: 2000,
  });

  totalTokens += response.usage?.total_tokens ?? 0;
  let choice = response.choices[0]!;

  // Handle tool calls in a loop (max 3 rounds to prevent infinite loops)
  let round = 0;
  while (choice.finish_reason === "tool_calls" && choice.message.tool_calls && round < 3) {
    round++;
    openaiMessages.push(choice.message);

    // Execute all requested tool calls
    for (const toolCall of choice.message.tool_calls) {
      if (toolCall.type !== "function") continue;
      const fnName = toolCall.function.name;
      toolsUsed.push(fnName);

      let result: unknown;
      try {
        const args = JSON.parse(toolCall.function.arguments);
        result = await executeToolCall(fnName, args);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }

      openaiMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    // Follow-up LLM call with tool results
    response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: openaiMessages,
      tools: availableTools.length > 0 ? availableTools : undefined,
      tool_choice: availableTools.length > 0 ? "auto" : undefined,
      temperature: 0.3,
      max_tokens: 2000,
    });

    totalTokens += response.usage?.total_tokens ?? 0;
    choice = response.choices[0]!;
  }

  const reply = choice.message.content ?? "Xin lỗi, tôi không thể trả lời câu hỏi này.";

  return { reply, toolsUsed, tokensUsed: totalTokens };
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

async function executeToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "query_inspection_stats":
      return toolQueryInspectionStats(args);
    case "get_defect_trends":
      return toolGetDefectTrends(args);
    case "get_machine_status":
      return toolGetMachineStatus(args);
    case "run_root_cause_analysis":
      return toolRunRCA(args);
    case "get_model_performance":
      return toolGetModelPerformance(args);
    case "get_top_defects":
      return toolGetTopDefects(args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Tool Implementations ──────────────────────────────────────

async function toolQueryInspectionStats(args: Record<string, unknown>) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  const startDate = new Date(args.startDate as string);
  const endDate = new Date(args.endDate as string);
  const machineCode = args.machineCode as string | undefined;

  const conditions: SQL[] = [
    gte(dailyStatistics.date, startDate),
    lte(dailyStatistics.date, endDate),
  ];

  if (machineCode) {
    // Find machine ID by code
    const machine = await db.select({ id: machines.id })
      .from(machines)
      .where(eq(machines.code, machineCode))
      .limit(1);
    if (machine[0]) {
      conditions.push(eq(dailyStatistics.machineId, machine[0].id));
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

async function toolGetDefectTrends(args: Record<string, unknown>) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  const startDate = new Date(args.startDate as string);
  const endDate = new Date(args.endDate as string);
  const machineCode = args.machineCode as string | undefined;

  const conditions: SQL[] = [
    gte(dailyStatistics.date, startDate),
    lte(dailyStatistics.date, endDate),
  ];

  if (machineCode) {
    const machine = await db.select({ id: machines.id })
      .from(machines)
      .where(eq(machines.code, machineCode))
      .limit(1);
    if (machine[0]) {
      conditions.push(eq(dailyStatistics.machineId, machine[0].id));
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

async function toolGetMachineStatus(args: Record<string, unknown>) {
  const db = await getDb();
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

async function toolRunRCA(args: Record<string, unknown>) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  const machineCode = args.machineCode as string;
  const date = new Date(args.date as string);
  const hour = args.hour as number | undefined;

  const machineRows = await db.select({ id: machines.id, code: machines.code })
    .from(machines)
    .where(eq(machines.code, machineCode))
    .limit(1);

  if (!machineRows[0]) return { error: `Machine ${machineCode} not found` };
  const machineId = machineRows[0].id;

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
      JOIN measurement_point_defs mpd ON mr.point_def_id = mpd.id
      WHERE mr.inspection_id = ANY(${ngIds})
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

async function toolGetModelPerformance(args: Record<string, unknown>) {
  const db = await getDb();
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

  // For each model, try to get latest version metrics
  const results = [];
  for (const m of modelRows) {
    let metrics: { accuracy?: string; precision?: string; recall?: string; f1Score?: string } = {};
    if (m.currentVersion) {
      const ver = await db.select({ metrics: modelVersions.metrics, accuracy: modelVersions.accuracy })
        .from(modelVersions)
        .where(and(eq(modelVersions.modelId, m.id), eq(modelVersions.version, m.currentVersion)))
        .limit(1);
      const vMetrics = ver[0]?.metrics as { accuracy?: number; precision?: number; recall?: number; f1Score?: number } | null;
      if (vMetrics) {
        metrics = {
          accuracy: vMetrics.accuracy != null ? `${vMetrics.accuracy.toFixed(2)}%` : undefined,
          precision: vMetrics.precision != null ? `${vMetrics.precision.toFixed(2)}%` : undefined,
          recall: vMetrics.recall != null ? `${vMetrics.recall.toFixed(2)}%` : undefined,
          f1Score: vMetrics.f1Score != null ? `${vMetrics.f1Score.toFixed(2)}%` : undefined,
        };
      } else if (ver[0]?.accuracy) {
        metrics.accuracy = `${Number(ver[0].accuracy).toFixed(2)}%`;
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

async function toolGetTopDefects(args: Record<string, unknown>) {
  const db = await getDb();
  if (!db) return { error: "Database unavailable" };

  const startDate = new Date(args.startDate as string);
  const endDate = new Date(args.endDate as string);
  const machineCode = args.machineCode as string | undefined;
  const limit = (args.limit as number) ?? 10;

  let machineFilter = "";
  const params: unknown[] = [startDate, endDate];

  if (machineCode) {
    const machine = await db.select({ id: machines.id })
      .from(machines)
      .where(eq(machines.code, machineCode))
      .limit(1);
    if (machine[0]) {
      machineFilter = `AND pi.machine_id = $3`;
      params.push(machine[0].id);
    }
  }

  // Query for top NG inspection labels/reasons
  const results = await db.execute(sql`
    SELECT 
      COALESCE(pi.defect_type, pi.overall_result) as defect_type,
      COUNT(*) as defect_count,
      ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 2) as percentage
    FROM product_inspections pi
    WHERE pi.inspected_at >= ${startDate}
      AND pi.inspected_at <= ${endDate}
      AND pi.overall_result = 'NG'
      ${machineCode ? sql`AND pi.machine_id = (SELECT id FROM machines WHERE code = ${machineCode} LIMIT 1)` : sql``}
    GROUP BY COALESCE(pi.defect_type, pi.overall_result)
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
 * Rule-based offline processor for when no OpenAI API key is configured.
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
      const result = await toolQueryInspectionStats({ startDate, endDate, machineCode }) as any;
      toolsUsed.push("query_inspection_stats");
      if (!result.error) {
        parts.push(isVi
          ? `📊 **Thống kê kiểm tra (${result.period}):**\n- Tổng: ${result.totalInspections.toLocaleString()} sản phẩm\n- OK: ${result.ok.toLocaleString()} | NG: ${result.ng.toLocaleString()}\n- Tỷ lệ lỗi: **${result.defectRate}**`
          : `📊 **Inspection Stats (${result.period}):**\n- Total: ${result.totalInspections.toLocaleString()} products\n- OK: ${result.ok.toLocaleString()} | NG: ${result.ng.toLocaleString()}\n- Defect rate: **${result.defectRate}**`);
      }
    }

    if (runOverview || wantsDefects) {
      const result = await toolGetTopDefects({ startDate, endDate, machineCode, limit: 5 }) as any;
      toolsUsed.push("get_top_defects");
      if (!result.error && result.topDefects?.length > 0) {
        const lines = result.topDefects.map((x: any, i: number) => `  ${i + 1}. ${x.type}: ${x.count} (${x.percentage})`).join("\n");
        parts.push(isVi ? `🔴 **Top lỗi phổ biến:**\n${lines}` : `🔴 **Top Defects:**\n${lines}`);
      }
    }

    if (wantsTrends) {
      const result = await toolGetDefectTrends({ startDate, endDate, machineCode }) as any;
      toolsUsed.push("get_defect_trends");
      if (!result.error) {
        parts.push(isVi
          ? `📈 **Xu hướng lỗi (${result.summary.days} ngày):** Tỷ lệ lỗi TB = ${result.summary.avgDefectRate}`
          : `📈 **Defect Trend (${result.summary.days} days):** Avg defect rate = ${result.summary.avgDefectRate}`);
      }
    }

    if (wantsMachine && machineCode) {
      const result = await toolGetMachineStatus({ machineCode }) as any;
      toolsUsed.push("get_machine_status");
      if (!result.error) {
        parts.push(isVi
          ? `🔧 **Máy ${machineCode}:** ${result.machine.name} — Trạng thái: ${result.machine.status}\n  7 ngày gần: ${result.last7Days.totalInspections} sp | Tỷ lệ lỗi ${result.last7Days.defectRate}`
          : `🔧 **Machine ${machineCode}:** ${result.machine.name} — Status: ${result.machine.status}\n  Last 7 days: ${result.last7Days.totalInspections} products | Defect rate ${result.last7Days.defectRate}`);
      }
    }

    if (wantsModel) {
      const result = await toolGetModelPerformance({}) as any;
      toolsUsed.push("get_model_performance");
      if (!result.error && result.models?.length > 0) {
        const lines = result.models.slice(0, 3).map((m: any) =>
          `  • ${m.name} [${m.status}] — Accuracy: ${m.metrics.accuracy}`).join("\n");
        parts.push(isVi ? `🤖 **Mô hình AI:**\n${lines}` : `🤖 **AI Models:**\n${lines}`);
      }
    }

    if (wantsRCA && machineCode) {
      const result = await toolRunRCA({ machineCode, date: endDate }) as any;
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
    ? `\n\n_Chế độ offline — cấu hình OPENAI_API_KEY để nhận phân tích ngôn ngữ tự nhiên._`
    : `\n\n_Offline mode — set OPENAI_API_KEY for natural language analysis._`;

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
