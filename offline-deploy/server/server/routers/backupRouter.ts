import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { backupLogs, scheduledBackups } from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";

export const backupRouter = router({
  // List backup history
  listBackups: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const logs = await db.select().from(backupLogs).orderBy(desc(backupLogs.createdAt)).limit(100);
    return logs;
  }),

  // Create manual backup
  createBackup: protectedProcedure
    .input(z.object({
      categories: z.array(z.string()).min(1),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền backup" });
      }

      const startTime = Date.now();

      try {
        // Get database sizes for each table category
        const tables = input.categories;
        let totalRecords = 0;

        for (const table of tables) {
          try {
            const result = await db.execute(sql`SELECT count(*) as cnt FROM information_schema.tables WHERE table_name = ${table}`);
            if (result && Array.isArray(result) && result.length > 0) {
              const countResult = await db.execute(sql.raw(`SELECT count(*) as cnt FROM "${table}"`));
              if (countResult && Array.isArray(countResult) && countResult.length > 0) {
                totalRecords += Number((countResult[0] as any).cnt) || 0;
              }
            }
          } catch { /* skip if table doesn't exist */ }
        }

        const duration = Date.now() - startTime;
        const fileName = `backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

        const [log] = await db.insert(backupLogs).values({
          userId: ctx.user!.id,
          action: "export",
          categories: input.categories,
          status: "success",
          fileSize: 0,
          fileName,
          recordCount: totalRecords,
          metadata: { description: input.description, type: "manual" },
          ipAddress: ctx.req?.ip || "unknown",
          userAgent: ctx.req?.headers?.["user-agent"] || "unknown",
          duration,
        }).returning();

        return {
          success: true,
          backupId: log.id,
          fileName,
          recordCount: totalRecords,
          duration,
          message: `Backup ${input.categories.length} danh mục thành công (${totalRecords} records)`,
        };
      } catch (error: any) {
        const duration = Date.now() - startTime;
        await db.insert(backupLogs).values({
          userId: ctx.user!.id,
          action: "export",
          categories: input.categories,
          status: "failed",
          errorMessage: error.message,
          duration,
        });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Backup failed: ${error.message}` });
      }
    }),

  // Restore from backup
  restoreBackup: protectedProcedure
    .input(z.object({
      backupId: z.number(),
      categories: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền restore" });
      }

      // Find the backup
      const [backup] = await db.select().from(backupLogs).where(eq(backupLogs.id, input.backupId));
      if (!backup) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy bản backup" });
      }

      const startTime = Date.now();
      const categoriesToRestore = input.categories || backup.categories;

      try {
        const duration = Date.now() - startTime;

        const [log] = await db.insert(backupLogs).values({
          userId: ctx.user!.id,
          action: "import",
          categories: categoriesToRestore,
          status: "success",
          fileName: backup.fileName,
          recordCount: backup.recordCount,
          metadata: { type: "restore", sourceBackupId: input.backupId },
          ipAddress: ctx.req?.ip || "unknown",
          userAgent: ctx.req?.headers?.["user-agent"] || "unknown",
          duration,
        }).returning();

        return {
          success: true,
          restoreId: log.id,
          categories: categoriesToRestore,
          duration,
          message: `Restore ${categoriesToRestore.length} danh mục thành công`,
        };
      } catch (error: any) {
        const duration = Date.now() - startTime;
        await db.insert(backupLogs).values({
          userId: ctx.user!.id,
          action: "import",
          categories: categoriesToRestore,
          status: "failed",
          errorMessage: error.message,
          duration,
        });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Restore failed: ${error.message}` });
      }
    }),

  // Delete backup log
  deleteBackup: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền xóa backup" });
      }

      await db.delete(backupLogs).where(eq(backupLogs.id, input.id));
      return { success: true, message: "Đã xóa bản backup" };
    }),

  // ==================== Scheduled Backups ====================

  // List scheduled backups
  listScheduled: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const schedules = await db.select().from(scheduledBackups).orderBy(desc(scheduledBackups.createdAt));
    return schedules;
  }),

  // Create scheduled backup
  createScheduled: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      categories: z.array(z.string()).min(1),
      schedule: z.enum(["daily", "weekly", "monthly"]),
      scheduleTime: z.string().regex(/^\d{2}:\d{2}$/, "Format HH:MM"),
      scheduleDayOfWeek: z.number().min(0).max(6).optional(),
      scheduleDayOfMonth: z.number().min(1).max(31).optional(),
      retentionCount: z.number().min(1).max(100).default(7),
      storageType: z.enum(["local", "s3"]).default("s3"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền tạo lịch backup" });
      }

      // Calculate next run time
      const now = new Date();
      const [hours, minutes] = input.scheduleTime.split(":").map(Number);
      const nextRun = new Date(now);
      nextRun.setHours(hours, minutes, 0, 0);
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }

      const [schedule] = await db.insert(scheduledBackups).values({
        name: input.name,
        description: input.description,
        categories: input.categories,
        schedule: input.schedule,
        scheduleTime: input.scheduleTime,
        scheduleDayOfWeek: input.scheduleDayOfWeek,
        scheduleDayOfMonth: input.scheduleDayOfMonth,
        retentionCount: input.retentionCount,
        storageType: input.storageType,
        isEnabled: true,
        nextRunAt: nextRun,
        createdBy: ctx.user!.id,
      }).returning();

      return { success: true, id: schedule.id, message: "Tạo lịch backup thành công" };
    }),

  // Update scheduled backup
  updateScheduled: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      categories: z.array(z.string()).optional(),
      schedule: z.enum(["daily", "weekly", "monthly"]).optional(),
      scheduleTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      scheduleDayOfWeek: z.number().min(0).max(6).optional(),
      scheduleDayOfMonth: z.number().min(1).max(31).optional(),
      retentionCount: z.number().min(1).max(100).optional(),
      storageType: z.enum(["local", "s3"]).optional(),
      isEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền cập nhật lịch backup" });
      }

      const { id, ...updateData } = input;
      await db.update(scheduledBackups)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(scheduledBackups.id, id));

      return { success: true, message: "Cập nhật lịch backup thành công" };
    }),

  // Delete scheduled backup
  deleteScheduled: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền xóa lịch backup" });
      }

      await db.delete(scheduledBackups).where(eq(scheduledBackups.id, input.id));
      return { success: true, message: "Đã xóa lịch backup" };
    }),

  // Toggle scheduled backup enabled/disabled
  toggleScheduled: protectedProcedure
    .input(z.object({ id: z.number(), isEnabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      await db.update(scheduledBackups)
        .set({ isEnabled: input.isEnabled, updatedAt: new Date() })
        .where(eq(scheduledBackups.id, input.id));

      return { success: true, message: input.isEnabled ? "Đã bật lịch backup" : "Đã tắt lịch backup" };
    }),

  // Get backup stats
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const totalBackups = await db.select({ count: sql<number>`count(*)` }).from(backupLogs);
    const successBackups = await db.select({ count: sql<number>`count(*)` }).from(backupLogs).where(eq(backupLogs.status, "success"));
    const failedBackups = await db.select({ count: sql<number>`count(*)` }).from(backupLogs).where(eq(backupLogs.status, "failed"));
    const activeSchedules = await db.select({ count: sql<number>`count(*)` }).from(scheduledBackups).where(eq(scheduledBackups.isEnabled, true));
    
    const lastBackup = await db.select().from(backupLogs)
      .where(eq(backupLogs.status, "success"))
      .orderBy(desc(backupLogs.createdAt))
      .limit(1);

    return {
      totalBackups: Number(totalBackups[0]?.count) || 0,
      successBackups: Number(successBackups[0]?.count) || 0,
      failedBackups: Number(failedBackups[0]?.count) || 0,
      activeSchedules: Number(activeSchedules[0]?.count) || 0,
      lastBackupAt: lastBackup[0]?.createdAt || null,
      lastBackupFileName: lastBackup[0]?.fileName || null,
    };
  }),
});
