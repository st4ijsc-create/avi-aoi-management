import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
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
  getAiSpecialistSessionById,
  getAiSpecialistSessionDetail,
  listAiSpecialistSessions,
  getModuleImprovementStats,
} from "../db/aiSpecialist";
import { getTool, isWriteTool } from "../services/aiLocalTools/toolRegistry";
import { proposeAction } from "../services/aiCopilotActions";

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

export const aiSpecialistAgentRouter = router({
  listAgents: protectedProcedure.query(async () => {
    return {
      agents: listSpecialistAgents(),
      usageHint: "Call aiSpecialistAgent.run with objective + module context to get actionable recommendations.",
    };
  }),

  run: protectedProcedure
    .input(runInputSchema)
    .mutation(async ({ ctx, input }) => {
      const saveHistory = input.saveHistory !== false;
      const { saveHistory: _saveHistory, sessionId, ...runInput } = input;
      let activeSessionId = sessionId;

      if (saveHistory && activeSessionId) {
        const existing = await getAiSpecialistSessionById(activeSessionId, ctx.user.id);
        if (!existing) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Session does not belong to current user" });
        }
      }

      if (saveHistory && !activeSessionId) {
        const created = await createAiSpecialistSession({
          userId: ctx.user.id,
          sessionType: "single",
          moduleName: runInput.moduleName,
          objective: runInput.objective,
          requestedAgents: [runInput.agentId],
          language: runInput.language ?? "vi",
          status: "running",
        });
        activeSessionId = created.id;
      }

      try {
        const result = await runSpecialistAgent(runInput);

        if (saveHistory && activeSessionId) {
          await appendAiSpecialistSessionStep({
            sessionId: activeSessionId,
            stepOrder: 1,
            agentId: result.agent.id,
            status: "completed",
            inputPayload: runInput,
            outputPayload: result.output,
            modelId: result.modelId,
            tokensPrompt: result.metrics.tokensPrompt,
            tokensGenerated: result.metrics.tokensGenerated,
            totalTimeMs: result.metrics.totalTimeMs,
            tokensPerSecond: result.metrics.tokensPerSecond.toFixed(2),
          });

          await completeAiSpecialistSession(activeSessionId, ctx.user.id, {
            status: "completed",
            summary: result.output.summary,
            aggregateOutput: {
              mode: "single",
              result: result.output,
              modelId: result.modelId,
            },
          });
        }

        return {
          ...result,
          sessionId: activeSessionId,
        };
      } catch (error: any) {
        if (saveHistory && activeSessionId) {
          await completeAiSpecialistSession(activeSessionId, ctx.user.id, {
            status: "failed",
            summary: error?.message ?? "Workflow failed",
            aggregateOutput: {
              error: error?.message ?? "Unknown error",
            },
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Specialist agent failed: ${error?.message ?? "Unknown error"}`,
        });
      }
    }),

  runWorkflowChain: protectedProcedure
    .input(workflowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const saveHistory = input.saveHistory !== false;
      const { saveHistory: _saveHistory, sessionId, ...workflowInput } = input;
      const orderedAgents = buildWorkflowAgentOrder(workflowInput);
      let activeSessionId = sessionId;

      if (saveHistory && activeSessionId) {
        const existing = await getAiSpecialistSessionById(activeSessionId, ctx.user.id);
        if (!existing) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Session does not belong to current user" });
        }
      }

      if (saveHistory && !activeSessionId) {
        const created = await createAiSpecialistSession({
          userId: ctx.user.id,
          sessionType: "workflow",
          moduleName: workflowInput.moduleName,
          objective: workflowInput.objective,
          requestedAgents: orderedAgents,
          language: workflowInput.language ?? "vi",
          status: "running",
        });
        activeSessionId = created.id;
      }

      try {
        const workflow = await runSpecialistWorkflowChain(workflowInput);

        if (saveHistory && activeSessionId) {
          for (const step of workflow.steps) {
            await appendAiSpecialistSessionStep({
              sessionId: activeSessionId,
              stepOrder: step.stepOrder,
              agentId: step.agentId,
              status: "completed",
              inputPayload: {
                objective: step.result.output.summary,
                moduleName: workflowInput.moduleName,
                files: workflowInput.files,
              },
              outputPayload: step.result.output,
              modelId: step.result.modelId,
              tokensPrompt: step.result.metrics.tokensPrompt,
              tokensGenerated: step.result.metrics.tokensGenerated,
              totalTimeMs: step.result.metrics.totalTimeMs,
              tokensPerSecond: step.result.metrics.tokensPerSecond.toFixed(2),
            });
          }

          await completeAiSpecialistSession(activeSessionId, ctx.user.id, {
            status: "completed",
            summary: workflow.finalSummary,
            aggregateOutput: {
              mode: "workflow",
              orderedAgents: workflow.orderedAgents,
              finalSummary: workflow.finalSummary,
            },
          });
        }

        return {
          ...workflow,
          sessionId: activeSessionId,
        };
      } catch (error: any) {
        if (saveHistory && activeSessionId) {
          await completeAiSpecialistSession(activeSessionId, ctx.user.id, {
            status: "failed",
            summary: error?.message ?? "Workflow failed",
            aggregateOutput: {
              error: error?.message ?? "Unknown error",
              orderedAgents,
            },
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Workflow chain failed: ${error?.message ?? "Unknown error"}`,
        });
      }
    }),

  listSessions: protectedProcedure
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

  getSessionDetail: protectedProcedure
    .input(z.object({ sessionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const session = await getAiSpecialistSessionDetail(input.sessionId, ctx.user.id);
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }
      return session;
    }),

  // ─── Module Audit Presets ───────────────────────────────────────────────────

  listModuleAuditPresets: protectedProcedure.query(async () => {
    return {
      presets: listModuleAuditPresets(),
    };
  }),

  runModuleAudit: protectedProcedure
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

      const saveHistory = input.saveHistory !== false;
      const objective = input.overrideObjective ?? preset.objective;
      const language = input.language ?? "vi";
      let activeSessionId: number | undefined;

      if (saveHistory) {
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
        activeSessionId = created.id;
      }

      try {
        const workflow = await runSpecialistWorkflowChain({
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
        });

        if (saveHistory && activeSessionId) {
          for (const step of workflow.steps) {
            await appendAiSpecialistSessionStep({
              sessionId: activeSessionId,
              stepOrder: step.stepOrder,
              agentId: step.agentId,
              status: "completed",
              inputPayload: { objective, moduleName: preset.moduleName },
              outputPayload: step.result.output,
              modelId: step.result.modelId,
              tokensPrompt: step.result.metrics.tokensPrompt,
              tokensGenerated: step.result.metrics.tokensGenerated,
              totalTimeMs: step.result.metrics.totalTimeMs,
              tokensPerSecond: step.result.metrics.tokensPerSecond.toFixed(2),
            });
          }

          await completeAiSpecialistSession(activeSessionId, ctx.user.id, {
            status: "completed",
            summary: workflow.finalSummary,
            aggregateOutput: {
              mode: "module-audit",
              presetId: preset.id,
              presetLabel: preset.label,
              orderedAgents: workflow.orderedAgents,
              finalSummary: workflow.finalSummary,
            },
          });
        }

        return {
          preset,
          ...workflow,
          sessionId: activeSessionId,
        };
      } catch (error: any) {
        if (saveHistory && activeSessionId) {
          await completeAiSpecialistSession(activeSessionId, ctx.user.id, {
            status: "failed",
            summary: error?.message ?? "Module audit failed",
            aggregateOutput: { error: error?.message, presetId: preset.id },
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Module audit failed: ${error?.message ?? "Unknown error"}`,
        });
      }
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
  proposeRecommendationAsAction: protectedProcedure
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

  getModuleImprovementScore: protectedProcedure
    .input(z.object({ moduleName: z.string().max(255).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const stats = await getModuleImprovementStats(ctx.user.id, input?.moduleName);
      if (!stats) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }
      return stats;
    }),
});
