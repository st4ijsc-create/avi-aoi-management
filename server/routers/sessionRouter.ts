import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

/**
 * Session management router.
 *
 * Canonical session logic lives in server/db/auth.ts (getUserSessions /
 * getSessionByToken / revokeSession / revokeAllSessions). Both this router and
 * userRouter's session procedures delegate to those helpers — no duplicated
 * query logic (audit A bug #3).
 *
 * `ctx.sessionToken` (set in _core/context.ts from the session cookie) is the
 * canonical identifier of the CALLER's session, so `isCurrent` resolves
 * correctly and `revokeAll` preserves the caller's own session.
 *
 * TODO(doc 12 §12.5): session TTL is still the pending 1-year default — do NOT
 * shorten it here until that decision is finalised with the user.
 */
export const sessionRouter = router({
  // List all active sessions for the current user
  list: protectedProcedure.query(async ({ ctx }) => {
    const sessions = await db.getUserSessions(ctx.user.id);
    const currentSessionToken = ctx.sessionToken;

    return sessions.map(session => ({
      id: session.id,
      deviceName: session.deviceName || "Unknown Device",
      deviceType: session.deviceType || "unknown",
      browser: session.browser || "Unknown Browser",
      os: session.os || "Unknown OS",
      ipAddress: session.ipAddress || "Unknown",
      location: session.location || "Unknown Location",
      lastActivityAt: session.lastActivityAt,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isCurrent: !!currentSessionToken && session.sessionToken === currentSessionToken,
    }));
  }),

  // Revoke a specific session (ownership enforced inside db.revokeSession)
  revoke: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.revokeSession(input.sessionId, ctx.user.id);
      return { success: true, message: "Session revoked successfully" };
    }),

  // Revoke all sessions EXCEPT the caller's current one
  revokeAll: protectedProcedure.mutation(async ({ ctx }) => {
    const currentSessionToken = ctx.sessionToken;

    // Resolve the caller's current session row so we can preserve it.
    let currentSessionId: number | undefined;
    if (currentSessionToken) {
      const current = await db.getSessionByToken(currentSessionToken);
      if (current && current.userId === ctx.user.id) {
        currentSessionId = current.id;
      }
    }

    await db.revokeAllSessions(ctx.user.id, currentSessionId);
    return { success: true, message: "All other sessions revoked successfully" };
  }),

  // Count active sessions
  count: protectedProcedure.query(async ({ ctx }) => {
    const sessions = await db.getUserSessions(ctx.user.id);
    return { count: sessions.length };
  }),
});

export default sessionRouter;
