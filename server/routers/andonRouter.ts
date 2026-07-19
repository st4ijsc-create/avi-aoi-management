/**
 * Sprint F5a — Andon router (ALERT-ONLY).
 *
 * Andon = visual signal / notification. NONE of these endpoints write a command
 * to a machine. RBAC via module 'andon':
 *   raise        → andon/canCreate
 *   acknowledge  → andon/canEdit
 *   resolve      → andon/canEdit
 *   list/active/get/metrics → andon/canView
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, desc, sql, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
import { andonEvents } from "../../drizzle/schema";
import { raiseAndon, acknowledgeAndon, resolveAndon } from "../services/andon/andonService";
import { classifyIssue } from "../services/aiIssueClassifier";
import { getMachineByCode } from "../db/hierarchy";

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return db;
}

const stateEnum = z.enum(["green", "yellow", "red", "call"]);
const reasonEnum = z.enum(["quality", "material", "maintenance", "safety", "setup", "other"]);

export const andonRouter = router({
  raise: protectedProcedure
    .use(requirePermission("andon", "canCreate"))
    .input(z.object({
      state: stateEnum,
      reason: reasonEnum,
      title: z.string().min(1).max(255),
      message: z.string().max(2000).optional(),
      lineId: z.number().int().positive().optional(),
      stationId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return raiseAndon(
        {
          state: input.state,
          reason: input.reason,
          title: input.title,
          message: input.message,
          lineId: input.lineId,
          stationId: input.stationId,
          machineId: input.machineId,
          raisedBySystem: false,
        },
        { id: ctx.user.id, name: ctx.user.name ?? null },
      );
    }),

  /**
   * quickReport — operator "1-tap issue report" (báo sự cố).
   *
   * Minimum effort: the operator submits a short free-text (or voice-dictated)
   * description; the FAST AI model picks reason + state via classifyIssue() so
   * the operator never has to choose a category/severity. The classified Andon
   * is then raised through the SAME raiseAndon service path as `raise`.
   *
   * Same RBAC as raise (andon/canCreate). raisedBySystem:false (a human raised
   * it). Fail-safe end-to-end: a classifier failure still raises an Andon with a
   * safe default (reason "other"). An empty description is allowed → a bare
   * call-for-help. `degraded` tells the client the AI fell back to a default.
   */
  quickReport: protectedProcedure
    .use(requirePermission("andon", "canCreate"))
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      machineCode: z.string().min(1).max(100).optional(),
      stationId: z.number().int().positive().optional(),
      lineId: z.number().int().positive().optional(),
      description: z.string().max(2000).optional(),
      lang: z.enum(["vi", "en", "zh"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Resolve machineId from a scanned/typed machine code when an id wasn't passed.
      let machineId = input.machineId;
      let machineCode = input.machineCode?.trim() || undefined;
      if (machineId == null && machineCode) {
        const m = await getMachineByCode(machineCode);
        if (m) {
          machineId = m.id;
          machineCode = m.code;
        }
      }

      // FAST-model classification (never throws — returns a safe default if degraded).
      const classified = await classifyIssue({
        description: input.description,
        machineCode,
        lang: input.lang ?? "vi",
      });

      const event = await raiseAndon(
        {
          state: classified.state,
          reason: classified.reason,
          title: classified.title,
          message: input.description?.trim() || classified.title,
          machineId: machineId ?? null,
          stationId: input.stationId ?? null,
          lineId: input.lineId ?? null,
          raisedBySystem: false,
        },
        { id: ctx.user.id, name: ctx.user.name ?? null },
      );

      return {
        andonId: event.id,
        reason: classified.reason,
        state: classified.state,
        title: classified.title,
        degraded: classified.degraded,
      };
    }),

  acknowledge: protectedProcedure
    .use(requirePermission("andon", "canEdit"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const row = await acknowledgeAndon(input.id, ctx.user.id, { id: ctx.user.id, name: ctx.user.name ?? null });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Andon không tồn tại." });
      return row;
    }),

  resolve: protectedProcedure
    .use(requirePermission("andon", "canEdit"))
    .input(z.object({ id: z.number().int().positive(), notes: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const row = await resolveAndon(input.id, ctx.user.id, input.notes, { id: ctx.user.id, name: ctx.user.name ?? null });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Andon không tồn tại." });
      return row;
    }),

  list: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .input(z.object({
      status: z.enum(["raised", "acknowledged", "resolved"]).optional(),
      lineId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const conds = [];
      if (input?.status) conds.push(eq(andonEvents.status, input.status));
      if (input?.lineId) conds.push(eq(andonEvents.lineId, input.lineId));
      if (input?.machineId) conds.push(eq(andonEvents.machineId, input.machineId));
      return db
        .select()
        .from(andonEvents)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(andonEvents.raisedAt))
        .limit(input?.limit ?? 100);
    }),

  active: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .query(async () => {
      const db = await getDb();
      return db
        .select()
        .from(andonEvents)
        .where(isNull(andonEvents.resolvedAt))
        .orderBy(desc(andonEvents.raisedAt))
        .limit(200);
    }),

  get: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [row] = await db.select().from(andonEvents).where(eq(andonEvents.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Andon không tồn tại." });
      return row;
    }),

  metrics: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .input(z.object({
      sinceHours: z.number().int().min(1).max(24 * 90).default(24),
      // doc 64 IA-10 S4 — trục phạm vi (optional/additive): MTTA/MTTR theo Chuyền/Máy.
      lineId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const since = new Date(Date.now() - (input?.sinceHours ?? 24) * 3600 * 1000);
      const conds = [gte(andonEvents.raisedAt, since)];
      if (input?.lineId !== undefined) conds.push(eq(andonEvents.lineId, input.lineId));
      if (input?.machineId !== undefined) conds.push(eq(andonEvents.machineId, input.machineId));
      const [row] = await db
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${andonEvents.resolvedAt} is null)::int`,
          resolved: sql<number>`count(*) filter (where ${andonEvents.status} = 'resolved')::int`,
          avgMtta: sql<number>`coalesce(avg(${andonEvents.mttaSeconds}), 0)::float`,
          avgMttr: sql<number>`coalesce(avg(${andonEvents.mttrSeconds}), 0)::float`,
        })
        .from(andonEvents)
        .where(and(...conds));
      return {
        total: row?.total ?? 0,
        active: row?.active ?? 0,
        resolved: row?.resolved ?? 0,
        avgMttaSeconds: Math.round(row?.avgMtta ?? 0),
        avgMttrSeconds: Math.round(row?.avgMttr ?? 0),
      };
    }),
});
