import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import {
  getSlowQueries,
  getQueryStats,
  getRecentQueries,
  analyzeQueryPatterns,
  clearMetricsHistory,
} from "../queryMonitor";

export const systemRouter = router({
  // ─── System Settings CRUD ──────────────────────────────────────────
  settings: router({
    getByCategory: protectedProcedure
      .input(z.object({ category: z.string().min(1) }))
      .query(async ({ input }) => {
        const db = await import("../db");
        return db.getSystemSettings(input.category);
      }),

    get: protectedProcedure
      .input(z.object({ key: z.string().min(1) }))
      .query(async ({ input }) => {
        const db = await import("../db");
        return db.getSystemSetting(input.key);
      }),

    upsert: adminProcedure
      .input(z.object({
        category: z.string().min(1),
        key: z.string().min(1),
        value: z.string(),
        description: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await import("../db");
        const existing = await db.getSystemSetting(input.key);
        if (existing) {
          await db.updateSystemSetting(input.key, input.value, ctx.user?.id);
        } else {
          await db.createSystemSetting({
            settingKey: input.key,
            settingValue: input.value,
            category: input.category,
            description: input.description || null,
            updatedBy: ctx.user?.id || null,
          });
        }
        return { success: true };
      }),

    bulkUpsert: adminProcedure
      .input(z.object({
        category: z.string().min(1),
        settings: z.array(z.object({
          key: z.string().min(1),
          value: z.string(),
          description: z.string().optional(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await import("../db");
        for (const setting of input.settings) {
          const existing = await db.getSystemSetting(setting.key);
          if (existing) {
            await db.updateSystemSetting(setting.key, setting.value, ctx.user?.id);
          } else {
            await db.createSystemSetting({
              settingKey: setting.key,
              settingValue: setting.value,
              category: input.category,
              description: setting.description || null,
              updatedBy: ctx.user?.id || null,
            });
          }
        }
        return { success: true };
      }),
  }),

  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  // Query Monitoring APIs
  queryMonitoring: router({
    getSlowQueries: adminProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(50),
        })
      )
      .query(({ input }) => {
        return getSlowQueries(input.limit);
      }),

    getStats: adminProcedure
      .query(() => {
        return getQueryStats();
      }),

    getRecentQueries: adminProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(50),
        })
      )
      .query(({ input }) => {
        return getRecentQueries(input.limit);
      }),

    analyzePatterns: adminProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(50).default(20),
        })
      )
      .query(({ input }) => {
        return analyzeQueryPatterns(input.limit);
      }),

    clearHistory: adminProcedure
      .mutation(() => {
        clearMetricsHistory();
        return { success: true };
      }),
  }),

  // Backup/Restore APIs
  exportConfig: adminProcedure
    .input(
      z.object({
        categories: z.array(z.string()),
      })
    )
    .query(async ({ input }) => {
      const db = await import("../db");
      return db.exportSystemConfig(input.categories);
    }),

  importConfig: adminProcedure
    .input(
      z.object({
        data: z.record(z.string(), z.array(z.any())),
        categories: z.array(z.string()),
        overwrite: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await import("../db");
      const dataTyped = input.data as Record<string, any[]>;
      return db.importSystemConfig(dataTyped, input.categories, input.overwrite ?? false);
    }),

  // Backup Logs APIs
  backupLogs: router({
    list: adminProcedure
      .input(
        z.object({
          userId: z.number().optional(),
          action: z.enum(["export", "import", "scheduled_export"]).optional(),
          status: z.enum(["success", "failed", "partial"]).optional(),
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          limit: z.number().min(1).max(100).default(50),
          offset: z.number().min(0).default(0),
        }).optional()
      )
      .query(async ({ input }) => {
        const db = await import("../db");
        return db.listBackupLogs(input);
      }),

    create: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          action: z.enum(["export", "import", "scheduled_export"]),
          categories: z.array(z.string()),
          status: z.enum(["success", "failed", "partial"]),
          fileSize: z.number().optional(),
          fileName: z.string().optional(),
          fileUrl: z.string().optional(),
          recordCount: z.number().optional(),
          errorMessage: z.string().optional(),
          metadata: z.record(z.string(), z.any()).optional(),
          ipAddress: z.string().optional(),
          userAgent: z.string().optional(),
          duration: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await import("../db");
        return db.createBackupLog(input);
      }),
  }),

  // Scheduled Backups APIs
  scheduledBackups: router({
    list: adminProcedure
      .input(
        z.object({
          enabledOnly: z.boolean().optional(),
        }).optional()
      )
      .query(async ({ input }) => {
        const db = await import("../db");
        return db.listScheduledBackups(input?.enabledOnly);
      }),

    get: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const db = await import("../db");
        return db.getScheduledBackupById(input.id);
      }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          categories: z.array(z.string()),
          schedule: z.enum(["daily", "weekly", "monthly"]),
          scheduleTime: z.string().regex(/^\d{2}:\d{2}$/),
          scheduleDayOfWeek: z.number().min(0).max(6).optional(),
          scheduleDayOfMonth: z.number().min(1).max(31).optional(),
          retentionCount: z.number().min(1).max(30).default(7),
          storageType: z.enum(["local", "s3"]).default("s3"),
          createdBy: z.number(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await import("../db");
        // Calculate next run time
        const nextRunAt = calculateNextRunTime(input.schedule, input.scheduleTime, input.scheduleDayOfWeek, input.scheduleDayOfMonth);
        return db.createScheduledBackup({ ...input, nextRunAt });
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).optional(),
          description: z.string().optional(),
          categories: z.array(z.string()).optional(),
          schedule: z.enum(["daily", "weekly", "monthly"]).optional(),
          scheduleTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          scheduleDayOfWeek: z.number().min(0).max(6).optional(),
          scheduleDayOfMonth: z.number().min(1).max(31).optional(),
          retentionCount: z.number().min(1).max(30).optional(),
          storageType: z.enum(["local", "s3"]).optional(),
          isEnabled: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const db = await import("../db");
        await db.updateScheduledBackup(id, data);
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import("../db");
        await db.deleteScheduledBackup(input.id);
        return { success: true };
      }),

    toggle: adminProcedure
      .input(z.object({ id: z.number(), isEnabled: z.boolean() }))
      .mutation(async ({ input }) => {
        const db = await import("../db");
        await db.updateScheduledBackup(input.id, { isEnabled: input.isEnabled });
        return { success: true };
      }),
  }),

  // Template Marketplace APIs
  marketplace: router({
    list: publicProcedure
      .input(
        z.object({
          category: z.string().optional(),
          publisherId: z.number().optional(),
          isFeatured: z.boolean().optional(),
          search: z.string().optional(),
          sortBy: z.enum(["rating", "downloads", "newest"]).optional(),
          limit: z.number().min(1).max(50).default(20),
          offset: z.number().min(0).default(0),
        }).optional()
      )
      .query(async ({ input }) => {
        const db = await import("../db");
        return db.listMarketplaceTemplates(input);
      }),

    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const db = await import("../db");
        return db.getMarketplaceTemplateById(input.id);
      }),

    publish: adminProcedure
      .input(
        z.object({
          templateId: z.number(),
          publisherId: z.number(),
          title: z.string().min(1),
          description: z.string().optional(),
          category: z.string().optional(),
          tags: z.array(z.string()).optional(),
          thumbnailUrl: z.string().optional(),
          previewData: z.record(z.string(), z.any()).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await import("../db");
        return db.publishTemplateToMarketplace(input);
      }),

    download: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import("../db");
        const template = await db.getMarketplaceTemplateById(input.id);
        if (!template) throw new Error("Template not found");
        
        await db.incrementTemplateDownloads(input.id);
        
        // Get the original template data
        const originalTemplate = await db.getDashboardTemplateById(template.templateId);
        return originalTemplate;
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().min(1).optional(),
          description: z.string().optional(),
          category: z.string().optional(),
          tags: z.array(z.string()).optional(),
          thumbnailUrl: z.string().optional(),
          isPublished: z.boolean().optional(),
          isFeatured: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const db = await import("../db");
        await db.updateMarketplaceTemplate(id, data);
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import("../db");
        await db.deleteMarketplaceTemplate(input.id);
        return { success: true };
      }),

    // Reviews
    reviews: router({
      list: publicProcedure
        .input(z.object({ marketplaceId: z.number() }))
        .query(async ({ input }) => {
          const db = await import("../db");
          return db.listTemplateReviews(input.marketplaceId);
        }),

      create: adminProcedure
        .input(
          z.object({
            marketplaceId: z.number(),
            userId: z.number(),
            rating: z.number().min(1).max(5),
            comment: z.string().optional(),
            isVerified: z.boolean().default(false),
          })
        )
        .mutation(async ({ input }) => {
          const db = await import("../db");
          return db.createTemplateReview(input);
        }),
    }),
  }),
});

// Helper function to calculate next run time
function calculateNextRunTime(
  schedule: "daily" | "weekly" | "monthly",
  scheduleTime: string,
  scheduleDayOfWeek?: number,
  scheduleDayOfMonth?: number
): Date {
  const [hours, minutes] = scheduleTime.split(":").map(Number);
  const now = new Date();
  const next = new Date();
  
  next.setHours(hours, minutes, 0, 0);
  
  if (schedule === "daily") {
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (schedule === "weekly" && scheduleDayOfWeek !== undefined) {
    const currentDay = now.getDay();
    let daysUntil = scheduleDayOfWeek - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
      daysUntil += 7;
    }
    next.setDate(next.getDate() + daysUntil);
  } else if (schedule === "monthly" && scheduleDayOfMonth !== undefined) {
    next.setDate(scheduleDayOfMonth);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }
  
  return next;
}
