import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { backupLogs, scheduledBackups } from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import {
  createPgDump,
  restoreFromBackup,
  listBackupFiles,
  deleteBackupFile,
  TABLE_CATEGORIES,
} from "../services/backupService";
import { testReplicationConnectivity } from "../services/backupReplicationService";

export const backupRouter = router({
  // List backup history
  listBackups: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const logs = await db.select().from(backupLogs).orderBy(desc(backupLogs.createdAt)).limit(100);
    return logs;
  }),

  // List available table categories for selection
  listCategories: protectedProcedure.query(() => {
    return Object.entries(TABLE_CATEGORIES).map(([key, tables]) => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      tableCount: tables.length,
      tables,
    }));
  }),

  // Create manual backup via pg_dump
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

      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DATABASE_URL not configured" });

      // Resolve tables from selected categories
      const tables = input.categories.flatMap(cat => TABLE_CATEGORIES[cat] ?? []);
      const uniqueTables = [...new Set(tables)];

      const startTime = Date.now();

      try {
        const result = await createPgDump({
          databaseUrl,
          tables: uniqueTables,
          label: input.categories.join("_"),
        });

        const [log] = await db.insert(backupLogs).values({
          userId: ctx.user!.id,
          action: "export",
          categories: input.categories,
          status: "success",
          fileSize: result.fileSizeBytes,
          fileName: result.fileName,
          fileUrl: result.filePath,
          recordCount: result.tableCount,
          metadata: {
            description: input.description,
            type: "manual",
            method: result.method,
            sha256: result.sha256,
            pgDumpVersion: result.pgDumpVersion,
            offsite: result.offsite ?? { skipped: true },
          },
          ipAddress: ctx.req?.ip || "unknown",
          userAgent: ctx.req?.headers?.["user-agent"] || "unknown",
          duration: result.durationMs,
        }).returning();

        return {
          success: true,
          backupId: log.id,
          fileName: result.fileName,
          fileSizeBytes: result.fileSizeBytes,
          sha256: result.sha256,
          method: result.method,
          tableCount: result.tableCount,
          duration: result.durationMs,
          offsite: result.offsite ?? { skipped: true },
          message: `Backup ${input.categories.length} danh mục thành công (${result.tableCount} bảng, ${(result.fileSizeBytes / 1024).toFixed(1)} KB)`,
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

  // Restore from backup file
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

      const [backup] = await db.select().from(backupLogs).where(eq(backupLogs.id, input.backupId));
      if (!backup) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy bản backup" });
      if (!backup.fileUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Bản backup này không có file — không thể restore" });

      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DATABASE_URL not configured" });

      const startTime = Date.now();
      const categoriesToRestore = input.categories ?? backup.categories ?? [];
      const tablesToRestore = categoriesToRestore.flatMap(cat => TABLE_CATEGORIES[cat] ?? []);

      try {
        const result = await restoreFromBackup({
          databaseUrl,
          filePath: backup.fileUrl,
          tables: tablesToRestore.length > 0 ? tablesToRestore : undefined,
        });

        const [log] = await db.insert(backupLogs).values({
          userId: ctx.user!.id,
          action: "import",
          categories: categoriesToRestore,
          status: result.warnings.length > 0 ? "partial" : "success",
          fileName: backup.fileName,
          recordCount: result.restoredTables.length,
          metadata: {
            type: "restore",
            sourceBackupId: input.backupId,
            method: result.method,
            warnings: result.warnings.slice(0, 10),
          },
          ipAddress: ctx.req?.ip || "unknown",
          userAgent: ctx.req?.headers?.["user-agent"] || "unknown",
          duration: result.durationMs,
        }).returning();

        return {
          success: true,
          restoreId: log.id,
          restoredTables: result.restoredTables,
          method: result.method,
          warnings: result.warnings,
          duration: result.durationMs,
          message: `Restore thành công: ${result.restoredTables.length} bảng, ${result.durationMs}ms` +
            (result.warnings.length > 0 ? ` (${result.warnings.length} cảnh báo)` : ""),
        };
      } catch (error: any) {
        await db.insert(backupLogs).values({
          userId: ctx.user!.id,
          action: "import",
          categories: categoriesToRestore,
          status: "failed",
          errorMessage: error.message,
          duration: Date.now() - startTime,
        });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Restore failed: ${error.message}` });
      }
    }),

  // List actual backup files on disk
  listFiles: protectedProcedure.query(() => {
    return listBackupFiles();
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

      const [log] = await db.select().from(backupLogs).where(eq(backupLogs.id, input.id));
      if (log?.fileUrl) {
        try { deleteBackupFile(log.fileUrl); } catch { /* file may already be gone */ }
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

  // ==================== Off-site Replication (ISO 22301) ====================

  // Get current replication mode/target from environment
  getReplicationStatus: protectedProcedure.query(() => {
    const s3Bucket = process.env.AWS_S3_BACKUP_BUCKET;
    const offsiteDir = process.env.OFFSITE_BACKUP_DIR;

    if (s3Bucket) {
      const prefix = process.env.AWS_S3_BACKUP_PREFIX ?? "";
      return {
        mode: "s3" as const,
        target: `s3://${s3Bucket}${prefix ? `/${prefix}` : ""}`,
        region: process.env.AWS_REGION ?? null,
        endpointUrl: process.env.AWS_S3_ENDPOINT_URL ?? null,
        sse: process.env.AWS_S3_SSE ?? null,
        storageClass: process.env.AWS_S3_STORAGE_CLASS ?? null,
      };
    }
    if (offsiteDir) {
      return { mode: "offsite_dir" as const, target: offsiteDir };
    }
    return { mode: "none" as const, target: null };
  }),

  // Test replication connectivity (admin only)
  testReplication: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin mới có quyền test replication" });
    }
    const result = await testReplicationConnectivity();
    return result;
  }),
});
