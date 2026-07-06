/**
 * AI Copilot Router (GĐ2) — HITL confirm/cancel/get for write-actions.
 *
 * The propose phase happens inside the KB ask/stream flow (server-side). These
 * protected procedures handle the user's explicit decision on a proposed action.
 * The session user (ctx.user) is the source of truth for ownership + RBAC re-check.
 */

import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
// Doc 37 P0-3 — gate the AI Copilot surface behind the MOD_AI license
// (flag LICENSE_MODULE_GATE_ENABLED, default OFF → pass-through).
const protectedProcedure = moduleProcedure("MOD_AI");
import {
  confirmAction,
  cancelAction,
  getAction,
  type CopilotUser,
} from "../services/aiCopilotActions";
import type { ToolLang } from "../services/aiLocalTools";

const langSchema = z.enum(["vi", "en", "zh"]).default("vi");

function toCopilotUser(user: { id: number; role: string; name?: string | null }): CopilotUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

export const aiCopilotRouter = router({
  confirmAction: protectedProcedure
    .input(z.object({ actionId: z.string().min(1), token: z.string().min(1), lang: langSchema.optional() }))
    .mutation(async ({ input, ctx }) => {
      const user = toCopilotUser(ctx.user as any);
      const lang: ToolLang = input.lang ?? "vi";
      return confirmAction(input.actionId, input.token, user, lang, {
        ip: (ctx.req as any)?.ip,
        headers: (ctx.req as any)?.headers,
        socket: (ctx.req as any)?.socket,
      });
    }),

  cancelAction: protectedProcedure
    .input(z.object({ actionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const user = toCopilotUser(ctx.user as any);
      return cancelAction(input.actionId, user, {
        ip: (ctx.req as any)?.ip,
        headers: (ctx.req as any)?.headers,
        socket: (ctx.req as any)?.socket,
      });
    }),

  getAction: protectedProcedure
    .input(z.object({ actionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const user = toCopilotUser(ctx.user as any);
      const row = await getAction(input.actionId, user);
      if (!row) return null;
      return {
        actionId: row.id,
        tool: row.tool,
        summary: row.summary,
        status: row.status,
        preview: row.previewJson ?? null,
        expiresAt: row.expiresAt.toISOString(),
        executedAt: row.executedAt ? row.executedAt.toISOString() : null,
        result: row.resultJson ?? null,
      };
    }),
});
