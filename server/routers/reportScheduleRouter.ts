import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { scheduledReports, scheduledReportLogs } from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";

// Helper to calculate next scheduled time
function calculateNextScheduledAt(
  schedule: "DAILY" | "WEEKLY" | "MONTHLY",
  scheduleTime: string,
  scheduleDayOfWeek?: number | null,
  scheduleDayOfMonth?: number | null
): Date {
  const now = new Date();
  const [hours, minutes] = scheduleTime.split(":").map(Number);
  
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  
  if (schedule === "DAILY") {
    // If time has passed today, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (schedule === "WEEKLY") {
    const targetDay = scheduleDayOfWeek ?? 1; // Default to Monday
    const currentDay = now.getDay();
    let daysUntilTarget = targetDay - currentDay;
    
    if (daysUntilTarget < 0 || (daysUntilTarget === 0 && next <= now)) {
      daysUntilTarget += 7;
    }
    
    next.setDate(next.getDate() + daysUntilTarget);
  } else if (schedule === "MONTHLY") {
    const targetDay = scheduleDayOfMonth ?? 1; // Default to 1st
    next.setDate(targetDay);
    
    // If date has passed this month, schedule for next month
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }
  
  return next;
}

export const reportScheduleRouter = router({
  // List all scheduled reports
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      isActive: z.boolean().optional(),
      reportType: z.enum(["NG_VISUAL", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY", "CUSTOM"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const { limit = 50, offset = 0, isActive, reportType } = input || {};
      
      const conditions = [];
      if (isActive !== undefined) {
        conditions.push(eq(scheduledReports.isActive, isActive));
      }
      if (reportType) {
        conditions.push(eq(scheduledReports.reportType, reportType));
      }
      
      const reports = await db
        .select()
        .from(scheduledReports)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(scheduledReports.createdAt))
        .limit(limit)
        .offset(offset);
      
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(scheduledReports)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      
      return {
        reports,
        total: Number(count),
        limit,
        offset,
      };
    }),

  // Get single report by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = (await getDb())!
      const [report] = await db
        .select()
        .from(scheduledReports)
        .where(eq(scheduledReports.id, input.id))
        .limit(1);
      
      if (!report) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      }
      
      return report;
    }),

  // Create new scheduled report
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      reportType: z.enum(["NG_VISUAL", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY", "CUSTOM"]),
      schedule: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
      scheduleTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
      scheduleDayOfWeek: z.number().min(0).max(6).optional(),
      scheduleDayOfMonth: z.number().min(1).max(31).optional(),
      recipients: z.array(z.string().email()).min(1),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      includeWorkstationHeatmap: z.boolean().default(true),
      includeTopNGPoints: z.boolean().default(true),
      includeTrendChart: z.boolean().default(true),
      includeComparison: z.boolean().default(true),
      reportFormat: z.enum(["HTML", "PDF", "EXCEL"]).default("HTML"),
      logoUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      footerText: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = (await getDb())!
      
      const nextScheduledAt = calculateNextScheduledAt(
        input.schedule,
        input.scheduleTime,
        input.scheduleDayOfWeek,
        input.scheduleDayOfMonth
      );
      
      const [result] = await db.insert(scheduledReports).values({
        name: input.name,
        description: input.description,
        reportType: input.reportType,
        schedule: input.schedule,
        scheduleTime: input.scheduleTime,
        scheduleDayOfWeek: input.scheduleDayOfWeek,
        scheduleDayOfMonth: input.scheduleDayOfMonth,
        recipients: input.recipients,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
        includeWorkstationHeatmap: input.includeWorkstationHeatmap,
        includeTopNGPoints: input.includeTopNGPoints,
        includeTrendChart: input.includeTrendChart,
        includeComparison: input.includeComparison,
        reportFormat: input.reportFormat,
        logoUrl: input.logoUrl,
        primaryColor: input.primaryColor,
        footerText: input.footerText,
        nextScheduledAt,
        createdBy: ctx.user.id,
        isActive: true,
      });
      
      return { id: result.insertId, nextScheduledAt };
    }),

  // Update scheduled report
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      reportType: z.enum(["NG_VISUAL", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY", "CUSTOM"]).optional(),
      schedule: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
      scheduleTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
      scheduleDayOfWeek: z.number().min(0).max(6).optional().nullable(),
      scheduleDayOfMonth: z.number().min(1).max(31).optional().nullable(),
      recipients: z.array(z.string().email()).min(1).optional(),
      factoryId: z.number().optional().nullable(),
      workshopId: z.number().optional().nullable(),
      lineId: z.number().optional().nullable(),
      includeWorkstationHeatmap: z.boolean().optional(),
      includeTopNGPoints: z.boolean().optional(),
      includeTrendChart: z.boolean().optional(),
      includeComparison: z.boolean().optional(),
      reportFormat: z.enum(["HTML", "PDF", "EXCEL"]).optional(),
      logoUrl: z.string().optional().nullable(),
      primaryColor: z.string().optional(),
      footerText: z.string().optional().nullable(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!
      const { id, ...updates } = input;
      
      // Get current report to calculate next scheduled time
      const [current] = await db
        .select()
        .from(scheduledReports)
        .where(eq(scheduledReports.id, id))
        .limit(1);
      
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      }
      
      // Recalculate next scheduled time if schedule changed
      let nextScheduledAt = current.nextScheduledAt;
      if (updates.schedule || updates.scheduleTime || updates.scheduleDayOfWeek !== undefined || updates.scheduleDayOfMonth !== undefined) {
        nextScheduledAt = calculateNextScheduledAt(
          updates.schedule || current.schedule,
          updates.scheduleTime || current.scheduleTime,
          updates.scheduleDayOfWeek !== undefined ? updates.scheduleDayOfWeek : current.scheduleDayOfWeek,
          updates.scheduleDayOfMonth !== undefined ? updates.scheduleDayOfMonth : current.scheduleDayOfMonth
        );
      }
      
      await db
        .update(scheduledReports)
        .set({ ...updates, nextScheduledAt })
        .where(eq(scheduledReports.id, id));
      
      return { success: true, nextScheduledAt };
    }),

  // Delete scheduled report
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!
      
      // Delete logs first
      await db.delete(scheduledReportLogs).where(eq(scheduledReportLogs.reportId, input.id));
      
      // Delete report
      await db.delete(scheduledReports).where(eq(scheduledReports.id, input.id));
      
      return { success: true };
    }),

  // Toggle active status
  toggleActive: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!
      
      const [current] = await db
        .select({ isActive: scheduledReports.isActive })
        .from(scheduledReports)
        .where(eq(scheduledReports.id, input.id))
        .limit(1);
      
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      }
      
      await db
        .update(scheduledReports)
        .set({ isActive: !current.isActive })
        .where(eq(scheduledReports.id, input.id));
      
      return { success: true, isActive: !current.isActive };
    }),

  // Get report logs
  getLogs: protectedProcedure
    .input(z.object({
      reportId: z.number(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = (await getDb())!
      
      const logs = await db
        .select()
        .from(scheduledReportLogs)
        .where(eq(scheduledReportLogs.reportId, input.reportId))
        .orderBy(desc(scheduledReportLogs.sentAt))
        .limit(input.limit)
        .offset(input.offset);
      
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(scheduledReportLogs)
        .where(eq(scheduledReportLogs.reportId, input.reportId));
      
      return {
        logs,
        total: Number(count),
      };
    }),

  // Get statistics
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!
    
    // Count by status
    const [activeCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(scheduledReports)
      .where(eq(scheduledReports.isActive, true));
    
    const [inactiveCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(scheduledReports)
      .where(eq(scheduledReports.isActive, false));
    
    // Count by schedule type
    const scheduleStats = await db
      .select({
        schedule: scheduledReports.schedule,
        count: sql<number>`count(*)`,
      })
      .from(scheduledReports)
      .groupBy(scheduledReports.schedule);
    
    // Recent logs stats (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const logStats = await db
      .select({
        status: scheduledReportLogs.status,
        count: sql<number>`count(*)`,
      })
      .from(scheduledReportLogs)
      .where(gte(scheduledReportLogs.sentAt, sevenDaysAgo))
      .groupBy(scheduledReportLogs.status);
    
    return {
      active: Number(activeCount.count),
      inactive: Number(inactiveCount.count),
      bySchedule: scheduleStats.reduce((acc, s) => {
        acc[s.schedule] = Number(s.count);
        return acc;
      }, {} as Record<string, number>),
      recentLogs: logStats.reduce((acc, l) => {
        acc[l.status] = Number(l.count);
        return acc;
      }, {} as Record<string, number>),
    };
  }),

  // Manually trigger report (for testing)
  triggerNow: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!
      
      const [report] = await db
        .select()
        .from(scheduledReports)
        .where(eq(scheduledReports.id, input.id))
        .limit(1);
      
      if (!report) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      }
      
      // Create a pending log entry
      const [logResult] = await db.insert(scheduledReportLogs).values({
        reportId: input.id,
        status: "PENDING",
        recipientCount: report.recipients.length,
        successCount: 0,
        failedCount: 0,
      });
      
      // In a real implementation, this would trigger the actual report generation
      // For now, we just mark it as pending
      
      return { 
        success: true, 
        logId: logResult.insertId,
        message: "Report generation triggered. Check logs for status.",
      };
    }),
});

export default reportScheduleRouter;
