/**
 * AI Agent Router (GĐ3b) — multi-step agentic orchestration over the GĐ2 HITL
 * write flow. All procedures are protected; the session user (ctx.user) is the
 * source of truth for the agentic gate, ownership, and RBAC re-check (delegated
 * to the orchestrator + core confirmAction).
 *
 * Streaming is via tRPC request/response (mutation/query), NOT SSE — each call
 * advances the plan to the next stopping point and returns the new state.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  startSession,
  approvePlan,
  confirmStep,
  cancelSession,
  getSession,
  canUseAgentic,
  type AgentUser,
} from "../services/aiAgentOrchestrator";
import { startPlaybook, listPlaybooks } from "../services/aiPlaybookEngine";
import type { ToolLang } from "../services/aiLocalTools";

const langSchema = z.enum(["vi", "en", "zh"]).default("vi");

function toAgentUser(user: { id: number; role: string; name?: string | null }): AgentUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

function reqMeta(ctx: any) {
  return { ip: ctx.req?.ip, headers: ctx.req?.headers, socket: ctx.req?.socket };
}

export const aiAgentRouter = router({
  /** Plan a goal and park at awaiting_approval. Gated: disallowed role → { enabled:false }. */
  startSession: protectedProcedure
    .input(
      z.object({
        goal: z.string().min(2).max(2000),
        lang: langSchema.optional(),
        context: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const user = toAgentUser(ctx.user as any);
      const lang: ToolLang = input.lang ?? "vi";
      if (!canUseAgentic(user)) {
        return { ok: false, enabled: false, message: "Agentic mode chưa được bật cho vai trò này." };
      }
      return startSession(input.goal, { user, lang, req: reqMeta(ctx) });
    }),

  /** User approves the plan → run to the first stopping point (read/done/awaiting_confirm). */
  approvePlan: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const user = toAgentUser(ctx.user as any);
      return approvePlan(input.sessionId, { user, req: reqMeta(ctx) });
    }),

  /** Confirm the pending write at the current step (calls core confirmAction), then resume. */
  confirmStep: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1), actionId: z.string().min(1), token: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const user = toAgentUser(ctx.user as any);
      return confirmStep(input.sessionId, input.actionId, input.token, { user, req: reqMeta(ctx) });
    }),

  /** Abort the session + cancel any pending proposed actions. */
  cancelSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const user = toAgentUser(ctx.user as any);
      return cancelSession(input.sessionId, { user, req: reqMeta(ctx) });
    }),

  /** List static playbooks (SOPs) the user is permitted to run. Gated: agentic. */
  listPlaybooks: protectedProcedure.query(async ({ ctx }) => {
    const user = toAgentUser(ctx.user as any);
    if (!canUseAgentic(user)) return { ok: false, enabled: false, playbooks: [] as Awaited<ReturnType<typeof listPlaybooks>> };
    const playbooks = await listPlaybooks(user);
    return { ok: true, enabled: true, playbooks };
  }),

  /**
   * Start a static playbook. Gated by the agentic role AND the playbook's
   * requiredPermission (re-checked in the engine). Parks at awaiting_approval;
   * drive it with approvePlan / confirmStep like any agent session.
   */
  startPlaybook: protectedProcedure
    .input(
      z.object({
        playbookId: z.string().min(1).max(120),
        lang: langSchema.optional(),
        context: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const user = toAgentUser(ctx.user as any);
      const lang: ToolLang = input.lang ?? "vi";
      if (!canUseAgentic(user)) {
        return { ok: false, enabled: false, message: "Agentic mode chưa được bật cho vai trò này." };
      }
      return startPlaybook(input.playbookId, { user, lang, context: input.context, req: reqMeta(ctx) });
    }),

  /** Fetch session state (owner only). */
  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const user = toAgentUser(ctx.user as any);
      const row = await getSession(input.sessionId, user);
      if (!row) return null;
      return {
        sessionId: row.id,
        goal: row.goal,
        status: row.status,
        cursor: row.cursor,
        plan: row.planJson ?? { steps: [] },
        stepResults: row.stepResults ?? [],
        writeCount: row.writeCount,
        linkedActionIds: row.linkedActionIds ?? [],
        expiresAt: row.expiresAt.toISOString(),
      };
    }),
});
