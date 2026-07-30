/**
 * Maintenance Schedule CRUD router (key "maintenanceSchedule") — doc 40 Wave 4c
 * (§11 · persona CMMS hub /cmms).
 *
 * Quản lý master-data LỊCH BẢO TRÌ theo chu kỳ (maintenance_schedules): thời-gian
 * (TIME_BASED), theo giờ chạy (USAGE_BASED), theo điều kiện / dự đoán. Đây CHỈ là
 * bề mặt CRUD — nó KHÔNG tự sinh work-order; việc auto-gen PREVENTIVE work-order
 * từ nextDueAt vẫn do backgroundJobs điều khiển bằng cờ PM_SCHEDULE_GEN_ENABLED
 * (mặc định OFF). Router này không bật/không đụng tới cờ đó.
 *
 * SAFETY: pure master-data. KHÔNG ghi giá trị nào xuống máy (không commandDispatcher,
 * không driver.writeTags). Mọi writer đều getDb()-guarded.
 *
 * RBAC: đọc = machine_status/canView; ghi = machine_control (canCreate/canEdit/
 * canDelete). Admin luôn qua; non-admin thiếu grant → FORBIDDEN (fail-safe).
 *
 * HỢP ĐỒNG (Agent C): mỗi bản ghi trả về { id, machineId, machineCode, name,
 * taskType, intervalDays, intervalUsageHours, nextDueAt, lastPerformedAt,
 * description, isActive } — trong đó `name` = cột taskName, `taskType` = cột
 * scheduleType (giữ đúng tên hợp đồng bất kể tên cột DB).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { and, desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { maintenanceSchedules, machines } from "../../drizzle/schema";

const READ = "machine_status";
// QA4c-2: PM schedule là công việc BẢO TRÌ → dùng machine_downtime (maintenance/
// supervisor/engineer/admin đều có write-bit) thay machine_control (maintenance
// KHÔNG có canCreate) — đúng persona "kỹ thuật viên bảo trì tự lập lịch PM".
const WRITE = "machine_downtime";

const SCHEDULE_TYPES = ["TIME_BASED", "USAGE_BASED", "CONDITION_BASED", "PREDICTIVE"] as const;

type ScheduleRow = typeof maintenanceSchedules.$inferSelect;

/** Normalize a DB row into the inter-agent contract shape (name / taskType aliases). */
function normalize(r: ScheduleRow) {
  return {
    id: r.id,
    machineId: r.machineId,
    machineCode: r.machineCode ?? null,
    name: r.taskName,
    taskType: r.scheduleType,
    intervalDays: r.intervalDays ?? null,
    intervalUsageHours: r.intervalUsageHours ?? null,
    nextDueAt: r.nextDueAt ?? null,
    lastPerformedAt: r.lastPerformedAt ?? null,
    description: r.description ?? null,
    isActive: r.isActive,
    factoryId: r.factoryId ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function getRow(id: number): Promise<ScheduleRow> {
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
  const [row] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, id)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `maintenance_schedule ${id} not found` });
  return row;
}

export const maintenanceScheduleRouter = router({
  // ── list (read) — filter by machine / active ─────────────────────────────────
  list: protectedProcedure
    .use(requirePermission(READ, "canView"))
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      isActive: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conds: any[] = [];
      if (input?.machineId) conds.push(eq(maintenanceSchedules.machineId, input.machineId));
      if (input?.isActive !== undefined) conds.push(eq(maintenanceSchedules.isActive, input.isActive));
      const rows = await db.select().from(maintenanceSchedules)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(maintenanceSchedules.nextDueAt))
        .limit(input?.limit ?? 200);
      return rows.map(normalize);
    }),

  // ── get one (read) ───────────────────────────────────────────────────────────
  get: protectedProcedure
    .use(requirePermission(READ, "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => normalize(await getRow(input.id))),

  // ── create (write) ───────────────────────────────────────────────────────────
  create: protectedProcedure
    .use(requirePermission(WRITE, "canCreate"))
    .input(z.object({
      machineId: z.number().int().positive(),
      name: z.string().min(2).max(256),
      taskType: z.enum(SCHEDULE_TYPES).default("TIME_BASED"),
      intervalDays: z.number().int().min(1).max(3650).nullable().optional(),
      intervalUsageHours: z.number().int().min(1).max(1_000_000).nullable().optional(),
      nextDueAt: z.string().datetime().nullable().optional(),
      lastPerformedAt: z.string().datetime().nullable().optional(),
      description: z.string().max(4000).nullable().optional(),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const [machine] = await db.select({ code: machines.code, id: machines.id })
        .from(machines).where(eq(machines.id, input.machineId)).limit(1);
      if (!machine) throw new TRPCError({ code: "NOT_FOUND", message: `Machine ${input.machineId} not found` });

      const [row] = await db.insert(maintenanceSchedules).values({
        machineId: input.machineId,
        machineCode: machine.code ?? null,
        scheduleType: input.taskType,
        taskName: input.name,
        description: input.description ?? null,
        intervalDays: input.intervalDays ?? null,
        intervalUsageHours: input.intervalUsageHours ?? null,
        nextDueAt: input.nextDueAt ? new Date(input.nextDueAt) : null,
        lastPerformedAt: input.lastPerformedAt ? new Date(input.lastPerformedAt) : null,
        isActive: input.isActive,
      } as any).returning();
      return normalize(row);
    }),

  // ── update (write) — partial ─────────────────────────────────────────────────
  update: protectedProcedure
    .use(requirePermission(WRITE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(2).max(256).optional(),
      taskType: z.enum(SCHEDULE_TYPES).optional(),
      intervalDays: z.number().int().min(1).max(3650).nullable().optional(),
      intervalUsageHours: z.number().int().min(1).max(1_000_000).nullable().optional(),
      nextDueAt: z.string().datetime().nullable().optional(),
      lastPerformedAt: z.string().datetime().nullable().optional(),
      description: z.string().max(4000).nullable().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      await getRow(input.id); // 404 if missing

      const patch: Record<string, any> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.taskName = input.name;
      if (input.taskType !== undefined) patch.scheduleType = input.taskType;
      if (input.intervalDays !== undefined) patch.intervalDays = input.intervalDays;
      if (input.intervalUsageHours !== undefined) patch.intervalUsageHours = input.intervalUsageHours;
      if (input.nextDueAt !== undefined) patch.nextDueAt = input.nextDueAt ? new Date(input.nextDueAt) : null;
      if (input.lastPerformedAt !== undefined) patch.lastPerformedAt = input.lastPerformedAt ? new Date(input.lastPerformedAt) : null;
      if (input.description !== undefined) patch.description = input.description;
      if (input.isActive !== undefined) patch.isActive = input.isActive;

      const [row] = await db.update(maintenanceSchedules).set(patch)
        .where(eq(maintenanceSchedules.id, input.id)).returning();
      return normalize(row);
    }),

  // ── enable / disable (write) — quick toggle without a full update ─────────────
  setEnabled: protectedProcedure
    .use(requirePermission(WRITE, "canEdit"))
    .input(z.object({ id: z.number().int().positive(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      await getRow(input.id);
      const [row] = await db.update(maintenanceSchedules)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(eq(maintenanceSchedules.id, input.id)).returning();
      return normalize(row);
    }),

  // ── remove (write) ───────────────────────────────────────────────────────────
  remove: protectedProcedure
    .use(requirePermission(WRITE, "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      await getRow(input.id); // 404 if missing
      await db.delete(maintenanceSchedules).where(eq(maintenanceSchedules.id, input.id));
      return { deleted: true, id: input.id };
    }),
});
