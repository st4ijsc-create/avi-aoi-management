/**
 * AI Inbox Router — per-user "AI Action Inbox" (push, 1-tap approve).
 *
 * Design ref: docs/ECOSYSTEM/05_AI_MINIMAL_EFFORT_UX_IDEAS_2026-06.md (§1, §3).
 *
 * Read + dismiss only. Approve/confirm of a PROPOSAL goes through the EXISTING
 * aiCopilot.confirmAction route (the UI calls it with the token from list()).
 * This router NEVER executes a tool — list/count aggregate, dismiss acknowledges
 * an insight or cancels a proposal (reuses the HITL cancel flow).
 *
 * Register in server/routers.ts as key "aiInbox" (see service report for wiring).
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  listInbox,
  countInbox,
  dismissInboxItem,
  type InboxUser,
} from "../services/aiActionInbox";

function toInboxUser(user: { id: number; role: string; name?: string | null }): InboxUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

function reqMeta(ctx: any) {
  return {
    ip: ctx.req?.ip,
    headers: ctx.req?.headers,
    socket: ctx.req?.socket,
  };
}

export const aiInboxRouter = router({
  /** Unified, severity-sorted feed for the current user. */
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const user = toInboxUser(ctx.user as any);
      return listInbox(user, { limit: input?.limit });
    }),

  /** Cheap actionable count for a nav badge. */
  count: protectedProcedure.query(async ({ ctx }) => {
    const user = toInboxUser(ctx.user as any);
    return countInbox(user);
  }),

  /** Acknowledge an insight / cancel a proposal. Never executes anything. */
  dismiss: protectedProcedure
    .input(z.object({ type: z.enum(["proposal", "insight", "alert"]), id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = toInboxUser(ctx.user as any);
      return dismissInboxItem(user, input.type, input.id, reqMeta(ctx));
    }),
});
