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
import { appError } from "../_core/appError";
import { and, eq, gte, desc, sql, isNotNull } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
import { commandLog } from "../../drizzle/schema";

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
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

  /**
   * Thời lượng lệnh TRUNG BÌNH thật, suy ra từ lịch sử (ackedAt − sentAt), gộp theo
   * commandType. Dùng cho cell-twin truyền `commandDurations` vào orchestration.simulate
   * để KPI nhịp chu kỳ dựa trên số liệu thật thay vì mặc định. Read-only; nếu chưa có
   * lịch sử → durations rỗng (twin tự dùng mặc định).
   */
  avgDurations: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ sinceHours: z.number().int().min(1).max(24 * 90).default(24 * 30) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const sinceHours = input?.sinceHours ?? 24 * 30;
      const since = new Date(Date.now() - sinceHours * 3600 * 1000);
      const rows = await db
        .select({
          commandType: commandLog.commandType,
          avgMs: sql<number>`avg(extract(epoch from (${commandLog.ackedAt} - ${commandLog.sentAt})) * 1000)::float`,
          n: sql<number>`count(*)::int`,
        })
        .from(commandLog)
        .where(
          and(
            gte(commandLog.createdAt, since),
            isNotNull(commandLog.sentAt),
            isNotNull(commandLog.ackedAt),
            isNotNull(commandLog.commandType),
            sql`${commandLog.ackedAt} > ${commandLog.sentAt}`,
          ),
        )
        .groupBy(commandLog.commandType);
      const durations: Record<string, number> = {};
      let samples = 0;
      for (const r of rows) {
        if (r.commandType && Number.isFinite(r.avgMs) && r.avgMs > 0) {
          durations[r.commandType] = Math.round(r.avgMs);
          samples += r.n;
        }
      }
      return { durations, samples, sinceHours };
    }),
});
