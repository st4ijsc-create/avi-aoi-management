import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, roleProcedure, moduleGate } from "../_core/trpc";
import {
  listSpecialistAgents,
  runSpecialistAgent,
  runSpecialistWorkflowChain,
  buildWorkflowAgentOrder,
  listModuleAuditPresets,
  getModuleAuditPreset,
  SPECIALIST_BRIDGE_TOOLS,
  ensureSpecialistBridgeToolsRegistered,
} from "../services/aiSpecialistAgentService";
import {
  appendAiSpecialistSessionStep,
  completeAiSpecialistSession,
  createAiSpecialistSession,
  getAiSpecialistSessionDetail,
  listAiSpecialistSessions,
  getModuleImprovementStats,
  upsertSpecialistFeedback,
  getSpecialistQualityScoreboard,
} from "../db/aiSpecialist";
import { getTool, isWriteTool } from "../services/aiLocalTools/toolRegistry";
import { proposeAction } from "../services/aiCopilotActions";
import { gatherRepoContext, type RepoContextResult } from "../services/ai/repoContextService";

/**
 * Wave 1 — siết RBAC: trước đây MỌI procedure chỉ yêu cầu đăng nhập (không lọc
 * role), nghĩa là bất kỳ user nào (kể cả operator) cũng chạy được model. Khuôn
 * này khớp aiAgentCenterRouter.ts:22 (roleProcedure + moduleGate("MOD_AI")).
 */
const specialistProcedure = roleProcedure("admin", "engineer").use(moduleGate("MOD_AI"));

const runInputSchema = z.object({
  agentId: z.enum(["data-analyst", "backend-engineer", "frontend-engineer", "qa-optimizer"]),
  objective: z.string().min(10).max(8000),
  moduleName: z.string().max(200).optional(),
  currentBehavior: z.string().max(6000).optional(),
  desiredBehavior: z.string().max(6000).optional(),
  techStack: z.array(z.string().min(1).max(120)).max(40).optional(),
  codeSnippet: z.string().max(24000).optional(),
  errorLogs: z.string().max(24000).optional(),
  constraints: z.array(z.string().min(1).max(300)).max(60).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(300)).max(60).optional(),
  files: z.array(z.string().min(1).max(400)).max(80).optional(),
  includeRepoContext: z.boolean().optional(),
  language: z.enum(["vi", "en"]).optional(),
  modelId: z.string().max(255).optional(),
  saveHistory: z.boolean().optional(),
  sessionId: z.number().optional(),
});

const workflowInputSchema = runInputSchema
  .omit({ agentId: true })
  .extend({
    includeBackend: z.boolean().optional(),
    includeFrontend: z.boolean().optional(),
    includeQa: z.boolean().optional(),
  });

/**
 * Wave 1 fix round 2 (I-4/I-5) — bản TÓM TẮT GỌN của ngữ cảnh repo, là thứ DUY
 * NHẤT được lưu vào `ai_specialist_session_steps.inputPayload`.
 *
 * Vì sao không lưu nguyên khối: `repoContext` chứa tới 256KB mã nguồn + mảnh
 * RAG. Lưu nguyên khối là nhồi từng ấy byte vào DB mỗi lần chạy VÀ đẩy ngược cả
 * khối đó về trình duyệt ở MỖI lượt poll `getSessionDetail` (2s/lượt). Model
 * vẫn nhận đủ ngữ cảnh — nó nằm trong prompt, chỉ là không lưu lại.
 *
 * Vì sao vẫn phải lưu bản tóm tắt: `submitFeedback` cần biết phiên đó CÓ THẬT SỰ
 * đọc được file nào không để tự suy ra `repoContextUsed` — client không được
 * quyền tự khai (xem `deriveFeedbackFacts`).
 */
export interface RepoContextSummary {
  filesRead: number;
  skipped: number;
  truncated: number;
  totalBytes: number;
}

export function summarizeRepoContext(ctx?: RepoContextResult): RepoContextSummary {
  return {
    filesRead: ctx?.files?.length ?? 0,
    skipped: ctx?.skipped?.length ?? 0,
    truncated: ctx?.files?.filter((f) => f.truncated).length ?? 0,
    totalBytes: ctx?.totalBytes ?? 0,
  };
}

/**
 * Wave 1 fix round 2 (I-1/I-2/I-4) — MÁY CHỦ là nguồn sự thật cho phiếu chấm.
 *
 * Trước bản này client tự khai `agentId`/`moduleName`/`repoContextUsed` lúc bấm
 * chấm điểm, và cả ba đều sai được:
 *  - `repoContextUsed` lấy từ TRẠNG THÁI CÔNG TẮC HIỆN TẠI, không phải lúc giao
 *    việc (công tắc chỉ khoá ~1 giây khi dispatch, còn model chạy vài phút) —
 *    gạt công tắc trong lúc chờ là phiếu ghi sai;
 *  - client khai `true` cả khi đọc được 0 file (bỏ trống ô "File liên quan", gõ
 *    sai đường dẫn, file `.py`, file trong `node_modules/`…). Khi đó
 *    `buildRepoContextBlock` trả `""` — prompt GIỐNG HỆT lúc tắt mắt — nhưng
 *    bảng điểm vẫn ghi "có mắt", phá thẳng cột so sánh có-mắt/không-mắt.
 *
 * Quy tắc: `repoContextUsed = (tổng filesRead của các bước) > 0`. Một lượt chạy
 * KHÔNG đọc được file nào thì KHÔNG có mắt, bất kể công tắc nói gì.
 *
 * Hàm THUẦN để test được không cần DB.
 */
export function deriveFeedbackFacts(session: {
  moduleName?: string | null;
  requestedAgents?: unknown;
  steps?: Array<{ agentId?: string | null; inputPayload?: unknown }>;
}): { agentId: string; moduleName: string | null; repoContextUsed: boolean } {
  const steps = session.steps ?? [];
  const firstStepAgent = steps.find((s) => typeof s.agentId === "string" && s.agentId)?.agentId;
  const requested = Array.isArray(session.requestedAgents) ? session.requestedAgents : [];
  const requestedFirst = typeof requested[0] === "string" ? (requested[0] as string) : undefined;

  let filesRead = 0;
  for (const s of steps) {
    const summary = (s.inputPayload as { repoContextSummary?: { filesRead?: unknown } } | null | undefined)
      ?.repoContextSummary;
    const n = Number(summary?.filesRead ?? 0);
    if (Number.isFinite(n) && n > 0) filesRead += n;
  }

  return {
    agentId: firstStepAgent ?? requestedFirst ?? "unknown",
    moduleName: session.moduleName ?? null,
    repoContextUsed: filesRead > 0,
  };
}

/**
 * Wave 1 — chạy 1 phiên specialist ở tiến trình NỀN.
 * KHÔNG BAO GIỜ ném: mọi lỗi được ghi vào phiên dưới dạng status "failed", vì
 * hàm này chạy fire-and-forget (không ai await) — một promise reject không bắt
 * sẽ làm sập tiến trình Node.
 */
export async function runSpecialistSessionInBackground(args: {
  sessionId: number;
  userId: number;
  runInput: Parameters<typeof runSpecialistAgent>[0];
}): Promise<void> {
  const { sessionId, userId, runInput } = args;
  // I-5 — khối ngữ cảnh vẫn đi vào model (runInput), nhưng KHÔNG đi vào DB.
  const { repoContext, ...slimInput } = runInput;
  try {
    const result = await runSpecialistAgent(runInput);
    await appendAiSpecialistSessionStep({
      sessionId,
      stepOrder: 1,
      agentId: result.agent.id,
      status: "completed",
      inputPayload: { ...slimInput, repoContextSummary: summarizeRepoContext(repoContext) },
      outputPayload: result.output,
      modelId: result.modelId,
      tokensPrompt: result.metrics.tokensPrompt,
      tokensGenerated: result.metrics.tokensGenerated,
      totalTimeMs: result.metrics.totalTimeMs,
      tokensPerSecond: result.metrics.tokensPerSecond.toFixed(2),
    });
    await completeAiSpecialistSession(sessionId, userId, {
      status: "completed",
      summary: result.output.summary,
      aggregateOutput: { mode: "single", result: result.output, modelId: result.modelId },
    });
  } catch (error: any) {
    await completeAiSpecialistSession(sessionId, userId, {
      status: "failed",
      summary: error?.message ?? "Specialist run failed",
      aggregateOutput: { error: error?.message ?? "Unknown error" },
    }).catch(() => { /* phiên đã hỏng — không làm sập tiến trình nền */ });
  }
}

/**
 * Wave 1 — cùng khuôn "không bao giờ ném" như `runSpecialistSessionInBackground`,
 * nhưng cho chuỗi nhiều agent (`runWorkflowChain` / `runModuleAudit`). Giữ nguyên
 * per-step persistence mà 2 luồng đó đã có trước đây — chỉ dời ra khỏi request path.
 */
export async function runSpecialistWorkflowSessionInBackground(args: {
  sessionId: number;
  userId: number;
  workflowInput: Parameters<typeof runSpecialistWorkflowChain>[0];
  mode: "workflow" | "module-audit";
  presetMeta?: { id: string; label: string };
}): Promise<void> {
  const { sessionId, userId, workflowInput, mode, presetMeta } = args;
  // I-4 — nhánh này vốn đã lưu gọn; nay thêm bản tóm tắt ngữ cảnh để
  // `deriveFeedbackFacts` suy được `repoContextUsed` cho CẢ phiên workflow/audit
  // (trước đây client hardcode `true` cho mọi phiên audit, kể cả khi đọc 0 file).
  const repoContextSummary = summarizeRepoContext(workflowInput.repoContext);
  try {
    const workflow = await runSpecialistWorkflowChain(workflowInput);

    for (const step of workflow.steps) {
      await appendAiSpecialistSessionStep({
        sessionId,
        stepOrder: step.stepOrder,
        agentId: step.agentId,
        status: "completed",
        inputPayload:
          mode === "module-audit"
            ? { objective: workflowInput.objective, moduleName: workflowInput.moduleName, repoContextSummary }
            : {
                objective: step.result.output.summary,
                moduleName: workflowInput.moduleName,
                files: workflowInput.files,
                repoContextSummary,
              },
        outputPayload: step.result.output,
        modelId: step.result.modelId,
        tokensPrompt: step.result.metrics.tokensPrompt,
        tokensGenerated: step.result.metrics.tokensGenerated,
        totalTimeMs: step.result.metrics.totalTimeMs,
        tokensPerSecond: step.result.metrics.tokensPerSecond.toFixed(2),
      });
    }

    await completeAiSpecialistSession(sessionId, userId, {
      status: "completed",
      summary: workflow.finalSummary,
      aggregateOutput:
        mode === "module-audit"
          ? {
              mode: "module-audit",
              presetId: presetMeta?.id,
              presetLabel: presetMeta?.label,
              orderedAgents: workflow.orderedAgents,
              finalSummary: workflow.finalSummary,
            }
          : {
              mode: "workflow",
              orderedAgents: workflow.orderedAgents,
              finalSummary: workflow.finalSummary,
            },
    });
  } catch (error: any) {
    await completeAiSpecialistSession(sessionId, userId, {
      status: "failed",
      summary: error?.message ?? "Workflow failed",
      aggregateOutput: { error: error?.message ?? "Unknown error", mode },
    }).catch(() => { /* phiên đã hỏng — không làm sập tiến trình nền */ });
  }
}

export const aiSpecialistAgentRouter = router({
  listAgents: specialistProcedure.query(async () => {
    return {
      agents: listSpecialistAgents(),
      usageHint: "Call aiSpecialistAgent.run with objective + module context to get actionable recommendations.",
    };
  }),

  run: specialistProcedure
    .input(runInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { saveHistory: _s, sessionId: _sid, includeRepoContext, ...runInput } = input;

      const created = await createAiSpecialistSession({
        userId: ctx.user.id,
        sessionType: "single",
        moduleName: runInput.moduleName,
        objective: runInput.objective,
        requestedAgents: [runInput.agentId],
        language: runInput.language ?? "vi",
        status: "running",
      });

      const repoContext =
        includeRepoContext === false
          ? undefined
          : await gatherRepoContext({ files: runInput.files, objective: runInput.objective });

      // Fire-and-forget: KHÔNG await — trả sessionId ngay để FE poll.
      void runSpecialistSessionInBackground({
        sessionId: created.id,
        userId: ctx.user.id,
        runInput: { ...runInput, repoContext },
      });

      return { sessionId: created.id, started: true as const };
    }),

  runWorkflowChain: specialistProcedure
    .input(workflowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { saveHistory: _s, sessionId: _sid, includeRepoContext, ...workflowInput } = input;
      const orderedAgents = buildWorkflowAgentOrder(workflowInput);

      const created = await createAiSpecialistSession({
        userId: ctx.user.id,
        sessionType: "workflow",
        moduleName: workflowInput.moduleName,
        objective: workflowInput.objective,
        requestedAgents: orderedAgents,
        language: workflowInput.language ?? "vi",
        status: "running",
      });

      const repoContext =
        includeRepoContext === false
          ? undefined
          : await gatherRepoContext({ files: workflowInput.files, objective: workflowInput.objective });

      // Fire-and-forget: KHÔNG await — trả sessionId ngay để FE poll.
      void runSpecialistWorkflowSessionInBackground({
        sessionId: created.id,
        userId: ctx.user.id,
        workflowInput: { ...workflowInput, repoContext },
        mode: "workflow",
      });

      return { sessionId: created.id, started: true as const };
    }),

  listSessions: specialistProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      moduleName: z.string().max(255).optional(),
      status: z.string().max(30).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const sessions = await listAiSpecialistSessions(ctx.user.id, input);
      return {
        sessions,
        count: sessions.length,
      };
    }),

  getSessionDetail: specialistProcedure
    .input(z.object({ sessionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const session = await getAiSpecialistSessionDetail(input.sessionId, ctx.user.id);
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }
      return session;
    }),

  // ─── Module Audit Presets ───────────────────────────────────────────────────

  listModuleAuditPresets: specialistProcedure.query(async () => {
    return {
      presets: listModuleAuditPresets(),
    };
  }),

  runModuleAudit: specialistProcedure
    .input(
      z.object({
        presetId: z.string().min(1).max(100),
        overrideObjective: z.string().min(10).max(8000).optional(),
        language: z.enum(["vi", "en"]).optional(),
        modelId: z.string().max(255).optional(),
        saveHistory: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const preset = getModuleAuditPreset(input.presetId);
      if (!preset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Module audit preset '${input.presetId}' not found`,
        });
      }

      const objective = input.overrideObjective ?? preset.objective;
      const language = input.language ?? "vi";

      const orderedAgents = buildWorkflowAgentOrder({
        objective,
        includeBackend: preset.includeBackend,
        includeFrontend: preset.includeFrontend,
        includeQa: preset.includeQa,
      });

      const created = await createAiSpecialistSession({
        userId: ctx.user.id,
        sessionType: "module-audit",
        moduleName: preset.moduleName,
        objective,
        requestedAgents: orderedAgents,
        language,
        status: "running",
      });

      const repoContext = await gatherRepoContext({ files: preset.files, objective });

      // Fire-and-forget: KHÔNG await — trả sessionId ngay để FE poll.
      void runSpecialistWorkflowSessionInBackground({
        sessionId: created.id,
        userId: ctx.user.id,
        workflowInput: {
          objective,
          moduleName: preset.moduleName,
          files: preset.files,
          techStack: preset.techStack,
          constraints: preset.constraints,
          includeBackend: preset.includeBackend,
          includeFrontend: preset.includeFrontend,
          includeQa: preset.includeQa,
          language,
          modelId: input.modelId,
          repoContext,
        },
        mode: "module-audit",
        presetMeta: { id: preset.id, label: preset.label },
      });

      return { sessionId: created.id, started: true as const };
    }),

  // ─── Specialist → Action HITL Bridge (doc69 Giai đoạn 4/Wave 3, D4) ─────────
  //
  // Turns ONE concrete actionPlan[] recommendation into a PROPOSED (HITL) action.
  // `recommendation` is the exact advisory text this proposal is FOR (kept only for
  // traceability/audit — it is NOT parsed to derive the tool/args, see the doc
  // comment on SPECIALIST_BRIDGE_TOOLS in aiSpecialistAgentService.ts for why). The
  // caller supplies the concrete {tool,args} mapping; this endpoint restricts `tool`
  // to the small explicit allow-list and RE-VALIDATES `args` against that tool's OWN
  // zod schema (mirrors aiCopilotRouter.proposeSuggestedAction) before ever calling
  // proposeAction — never fabricated, never auto-executed. proposeAction still runs
  // its own RBAC gate + (if D2 autonomy is ever enabled) the SAME denylist/guardrail
  // checks every other proposal goes through — this bridge adds NO bypass.
  proposeRecommendationAsAction: specialistProcedure
    .input(
      z.object({
        recommendation: z.string().min(1).max(2000),
        tool: z.enum(SPECIALIST_BRIDGE_TOOLS),
        args: z.record(z.string(), z.unknown()),
        lang: z.enum(["vi", "en", "zh"]).default("vi"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureSpecialistBridgeToolsRegistered();
      const tool = getTool(input.tool);
      if (!tool || !isWriteTool(tool)) {
        return {
          ok: false as const,
          advisory: true as const,
          reason: "TOOL_UNAVAILABLE",
          message: "Công cụ không khả dụng — khuyến nghị vẫn ở dạng văn bản tư vấn.",
        };
      }

      const parsed = (tool.parameters as z.ZodType<any>).safeParse(input.args);
      if (!parsed.success) {
        return {
          ok: false as const,
          advisory: true as const,
          reason: "ARGS_OUT_OF_BOUNDS",
          message: "Tham số không hợp lệ — khuyến nghị vẫn ở dạng văn bản tư vấn.",
        };
      }

      const user = { id: ctx.user.id, role: String(ctx.user.role), name: ctx.user.name ?? null };
      const res = await proposeAction(tool, parsed.data as Record<string, unknown>, { user, lang: input.lang });
      if (!res.ok || !res.pendingAction) {
        return {
          ok: false as const,
          advisory: false as const,
          reason: res.reason ?? "PROPOSE_FAILED",
          message: res.message,
        };
      }
      return {
        ok: true as const,
        advisory: false as const,
        pendingAction: res.pendingAction,
        sourceRecommendation: input.recommendation,
      };
    }),

  // ─── Improvement Score ──────────────────────────────────────────────────────

  getModuleImprovementScore: specialistProcedure
    .input(z.object({ moduleName: z.string().max(255).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const stats = await getModuleImprovementStats(ctx.user.id, input?.moduleName);
      if (!stats) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }
      return stats;
    }),

  // ─── Wave 1 Task 3 — Quality Feedback (human rating half of the quality gate) ─

  // `agentId`, `moduleName` và `repoContextUsed` CỐ Ý không có trong input: máy
  // chủ nắm sự thật về phiên, client thì không (xem `deriveFeedbackFacts`). Bỏ
  // hẳn khỏi hợp đồng thay vì "nhận rồi phớt lờ" để không ai hiểu nhầm là mình
  // điều khiển được chúng.
  submitFeedback: specialistProcedure
    .input(z.object({
      sessionId: z.number().int().positive(),
      rating: z.enum(["useful", "partial", "useless"]),
      usefulSections: z.array(z.enum([
        "diagnosis", "actionPlan", "patchHints", "testPlan", "optimizationIdeas", "risks",
      ])).max(6).optional(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // getAiSpecialistSessionDetail lọc theo userId y hệt getAiSpecialistSessionById
      // (cùng chốt sở hữu), nhưng trả kèm `steps` — nơi chứa `repoContextSummary`.
      const session = await getAiSpecialistSessionDetail(input.sessionId, ctx.user.id);
      if (!session) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Session does not belong to current user" });
      }
      return upsertSpecialistFeedback({
        ...input,
        userId: ctx.user.id,
        ...deriveFeedbackFacts(session),
      });
    }),

  getQualityScoreboard: specialistProcedure
    .input(z.object({ mineOnly: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return getSpecialistQualityScoreboard(input?.mineOnly ? ctx.user.id : undefined);
    }),
});
