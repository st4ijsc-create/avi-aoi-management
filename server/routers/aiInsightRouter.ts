/**
 * Phase 4 WS4.2 — AI insights router (read + acknowledge/dismiss).
 * Advisory data produced by the AI orchestration watcher. No action execution here.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db/connection";
import { aiInsights } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

export const aiInsightRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["new", "acknowledged", "dismissed"]).optional(),
      machineCode: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conds = [];
      if (input?.status) conds.push(eq(aiInsights.status, input.status));
      if (input?.machineCode) conds.push(eq(aiInsights.machineCode, input.machineCode));
      const where = conds.length ? and(...conds) : undefined;
      return db.select().from(aiInsights)
        .where(where)
        .orderBy(desc(aiInsights.createdAt))
        .limit(input?.limit ?? 50);
    }),

  setStatus: protectedProcedure
    .input(z.object({ id: z.number(), status: z.enum(["acknowledged", "dismissed", "new"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db.update(aiInsights)
        .set({ status: input.status, acknowledgedBy: ctx.user?.id ?? null })
        .where(eq(aiInsights.id, input.id))
        .returning();
      return row;
    }),
});
