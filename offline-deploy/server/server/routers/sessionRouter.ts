import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { userSessions } from "../../drizzle/schema";
import { eq, and, desc, ne } from "drizzle-orm";

export const sessionRouter = router({
  // List all sessions for current user
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    }

    const sessions = await db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, ctx.user.id),
          eq(userSessions.isActive, true)
        )
      )
      .orderBy(desc(userSessions.lastActivityAt));

    // Get current session token from context (if available)
    const currentSessionToken = (ctx as any).sessionToken || null;

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
      isCurrent: session.sessionToken === currentSessionToken,
    }));
  }),

  // Revoke a specific session
  revoke: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      // Verify the session belongs to the current user
      const session = await db
        .select()
        .from(userSessions)
        .where(
          and(
            eq(userSessions.id, input.sessionId),
            eq(userSessions.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!session[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      // Deactivate the session
      await db
        .update(userSessions)
        .set({ isActive: false })
        .where(eq(userSessions.id, input.sessionId));

      return { success: true, message: "Session revoked successfully" };
    }),

  // Revoke all sessions except current
  revokeAll: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    }

    const currentSessionToken = (ctx as any).sessionToken || null;

    // Deactivate all sessions for the user
    if (currentSessionToken) {
      // Keep current session active
      await db
        .update(userSessions)
        .set({ isActive: false })
        .where(
          and(
            eq(userSessions.userId, ctx.user.id),
            ne(userSessions.sessionToken, currentSessionToken)
          )
        );
    } else {
      // Deactivate all sessions
      await db
        .update(userSessions)
        .set({ isActive: false })
        .where(eq(userSessions.userId, ctx.user.id));
    }

    return { success: true, message: "All other sessions revoked successfully" };
  }),

  // Get session count
  count: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    }

    const sessions = await db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, ctx.user.id),
          eq(userSessions.isActive, true)
        )
      );

    return { count: sessions.length };
  }),
});

export default sessionRouter;
