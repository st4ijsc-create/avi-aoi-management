/**
 * Sprint G2.2a — Command Audit Log router (READ-ONLY).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This router is QUERY-ONLY over the append-only command_log table. It has NO
 *     mutations, does NOT import commandDispatcher, and has NO driver write path.
 *     It surfaces the audit trail of every command the dispatcher handled
 *     (rejected/failed/simulated/sent/acked/...), across hitl + interlock triggers.
 * RBAC via module 'machine_control': all endpoints → canView.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, desc, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
import { commandLog } from "../../drizzle/schema";

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return db;
}

const triggerKindEnum = z.enum(["hitl", "interlock"]);
const statusEnum = z.enum([
  "simulated", "sent", "acked", "failed", "timeout", "rejected", "acked_verified", "acked_unverified",
]);

export const commandLogRouter = router({
  list: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      adapterId: z.number().int().positive().optional(),
      triggerKind: triggerKindEnum.optional(),
      status: statusEnum.optional(),
      since: z.coerce.date().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const conds = [];
      if (input?.machineId != null) conds.push(eq(commandLog.machineId, input.machineId));
      if (input?.adapterId != null) conds.push(eq(commandLog.adapterId, input.adapterId));
      if (input?.triggerKind != null) conds.push(eq(commandLog.triggerKind, input.triggerKind));
      if (input?.status != null) conds.push(eq(commandLog.status, input.status));
      if (input?.since != null) conds.push(gte(commandLog.createdAt, input.since));
      return db
        .select()
        .from(commandLog)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(commandLog.createdAt))
        .limit(input?.limit ?? 100);
    }),

  get: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [row] = await db.select().from(commandLog).where(eq(commandLog.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Command log không tồn tại." });
      return row;
    }),

  stats: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ sinceHours: z.number().int().min(1).max(24 * 90).default(24) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const since = new Date(Date.now() - (input?.sinceHours ?? 24) * 3600 * 1000);
      const byStatus = await db
        .select({ status: commandLog.status, count: sql<number>`count(*)::int` })
        .from(commandLog)
        .where(gte(commandLog.createdAt, since))
        .groupBy(commandLog.status);
      const byTrigger = await db
        .select({ triggerKind: commandLog.triggerKind, count: sql<number>`count(*)::int` })
        .from(commandLog)
        .where(gte(commandLog.createdAt, since))
        .groupBy(commandLog.triggerKind);
      return { byStatus, byTrigger };
    }),
});
