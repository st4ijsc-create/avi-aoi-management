import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as cachedStats from "../functions/cachedStatistics";
import { scheduleReport, stopScheduledReport } from "../services/reportScheduler";

// ============ AUDIT ROUTER (inline version) ============
export const inlineAuditRouter = router({
  list: adminProcedure
    .input(z.object({
      userId: z.number().optional(),
      action: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.number().optional(),
      status: z.enum(['success', 'failure']).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      return db.getAuditLogs(input);
    }),

  stats: adminProcedure
    .input(z.object({
      days: z.number().min(1).max(90).default(7),
    }))
    .query(async ({ input }) => {
      return db.getAuditLogStats(input.days);
    }),
});

// ============ WORKSTATION ROUTER ============
export const workstationRouter = router({
  list: protectedProcedure
    .input(z.object({
      lineId: z.number().optional(),
      workshopId: z.number().optional(),
      factoryId: z.number().optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getWorkstations(input);
    }),

  getById: protectedProcedure
    .input(z.number())
    .query(async ({ input }) => {
      return db.getWorkstationById(input);
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      lineId: z.number().optional(),
      workshopId: z.number().optional(),
      factoryId: z.number().optional(),
      processType: z.enum(['SMT', 'DIP', 'ASSEMBLY', 'TESTING', 'PACKAGING', 'OTHER']).optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createWorkstation(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      lineId: z.number().nullable().optional(),
      workshopId: z.number().nullable().optional(),
      factoryId: z.number().nullable().optional(),
      processType: z.enum(['SMT', 'DIP', 'ASSEMBLY', 'TESTING', 'PACKAGING', 'OTHER']).optional(),
      orderIndex: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateWorkstation(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.number())
    .mutation(async ({ input }) => {
      await db.deleteWorkstation(input);
      return { success: true };
    }),

  defectsByWorkstation: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      productModelId: z.number().optional(),
      machineId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getDefectsByWorkstation(input);
    }),

  summary: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getWorkstationSummary(input);
    }),

  topNGMeasurementPoints: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().default(10),
    }).optional())
    .query(async ({ input }) => {
      return db.getTopNGMeasurementPointsByWorkstation(input);
    }),

  measurementPointsByWorkstation: protectedProcedure
    .input(z.object({
      workstationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return db.getMeasurementPointsByWorkstation(input);
    }),

  // NG Trend by day
  ngTrend: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      workstationId: z.number().optional(),
      measurementPointDefId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getNGTrendByDay(input);
    }),

  // NG Comparison between two periods
  ngComparison: protectedProcedure
    .input(z.object({
      currentStartDate: z.date(),
      currentEndDate: z.date(),
      previousStartDate: z.date(),
      previousEndDate: z.date(),
    }))
    .query(async ({ input }) => {
      return db.getNGComparison(input);
    }),
});

// ============ SCHEDULED REPORT ROUTER ============
export const scheduledReportRouter = router({
  list: protectedProcedure
    .input(z.object({
      isActive: z.boolean().optional(),
      reportType: z.string().optional(),
      schedule: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getScheduledReports(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getScheduledReportById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      reportType: z.enum(["NG_VISUAL", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY", "CUSTOM", "OEE_REPORT", "MACHINE_HEALTH"]).default("NG_VISUAL"),
      schedule: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("DAILY"),
      scheduleTime: z.string().default("08:00"),
      scheduleDayOfWeek: z.number().min(0).max(6).optional(),
      scheduleDayOfMonth: z.number().min(1).max(31).optional(),
      recipients: z.array(z.string().email()),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      includeWorkstationHeatmap: z.boolean().default(true),
      includeTopNGPoints: z.boolean().default(true),
      includeTrendChart: z.boolean().default(true),
      includeComparison: z.boolean().default(true),
      isActive: z.boolean().default(true),
      // Customization fields
      reportFormat: z.enum(["HTML", "PDF", "EXCEL"]).default("HTML"),
      logoUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      footerText: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createScheduledReport({
        ...input,
        createdBy: ctx.user.id,
      });
      
      // Schedule the report if active
      if (input.isActive) {
        const report = await db.getScheduledReportById(id);
        if (report) {
          scheduleReport({
            id: report.id,
            schedule: report.schedule,
            scheduleTime: report.scheduleTime,
            scheduleDayOfWeek: report.scheduleDayOfWeek,
            scheduleDayOfMonth: report.scheduleDayOfMonth,
          });
        }
      }
      
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      reportType: z.enum(["NG_VISUAL", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY", "CUSTOM", "OEE_REPORT", "MACHINE_HEALTH"]).optional(),
      schedule: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
      scheduleTime: z.string().optional(),
      scheduleDayOfWeek: z.number().min(0).max(6).optional(),
      scheduleDayOfMonth: z.number().min(1).max(31).optional(),
      recipients: z.array(z.string().email()).optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      includeWorkstationHeatmap: z.boolean().optional(),
      includeTopNGPoints: z.boolean().optional(),
      includeTrendChart: z.boolean().optional(),
      includeComparison: z.boolean().optional(),
      isActive: z.boolean().optional(),
      // Customization fields
      reportFormat: z.enum(["HTML", "PDF", "EXCEL"]).optional(),
      logoUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      footerText: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateScheduledReport(id, data);
      
      // Re-schedule if schedule/time changed or isActive changed
      const report = await db.getScheduledReportById(id);
      if (report) {
        if (report.isActive) {
          scheduleReport({
            id: report.id,
            schedule: report.schedule,
            scheduleTime: report.scheduleTime,
            scheduleDayOfWeek: report.scheduleDayOfWeek,
            scheduleDayOfMonth: report.scheduleDayOfMonth,
          });
        } else {
          stopScheduledReport(id);
        }
      }
      
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // Stop scheduler first
      stopScheduledReport(input.id);
      
      await db.deleteScheduledReport(input.id);
      return { success: true };
    }),

  getLogs: protectedProcedure
    .input(z.object({
      reportId: z.number(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      return db.getScheduledReportLogs(input.reportId, input.limit);
    }),

  sendTest: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const report = await db.getScheduledReportById(input.id);
      if (!report) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
      }

      const smtpConfig = await db.getSmtpConfig();
      if (!smtpConfig) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'SMTP config not found. Please configure SMTP first.' });
      }

      try {
        const { generateNGVisualReport, generateNGVisualEmailHTML, generateReport } = await import('../services/reportGenerator');
        const { createTransporterFromConfig } = await import('../_core/email');
        
        // Generate report data
        const reportData = await generateNGVisualReport({
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          endDate: new Date(),
          factoryId: report.factoryId ?? undefined,
          workshopId: report.workshopId ?? undefined,
          lineId: report.lineId ?? undefined,
        });

        // Get customization from report
        const customization = {
          logoUrl: (report as any).logoUrl,
          primaryColor: (report as any).primaryColor,
          footerText: (report as any).footerText,
          reportFormat: (report as any).reportFormat || 'HTML',
        };

        // Generate HTML email (always needed for email body)
        const emailHtml = generateNGVisualEmailHTML(reportData, customization);

        // Create email transporter
        const transporter = createTransporterFromConfig(smtpConfig);

        // Prepare email options
        const mailOptions: any = {
          from: `${smtpConfig.fromName} <${smtpConfig.fromEmail}>`,
          to: report.recipients.join(','),
          subject: `[TEST] ${report.name} - NG Visual Report`,
          html: emailHtml,
        };

        // Add attachment if PDF or Excel format
        if (customization.reportFormat === 'PDF' || customization.reportFormat === 'EXCEL') {
          const { content, mimeType, extension } = await generateReport(
            reportData,
            customization.reportFormat,
            customization
          );
          
          const dateStr = new Date().toISOString().split('T')[0];
          mailOptions.attachments = [{
            filename: `NG_Visual_Report_${dateStr}.${extension}`,
            content: content,
            contentType: mimeType,
          }];
        }

        // Send test email
        await transporter.sendMail(mailOptions);

        // Log test send
        await db.createScheduledReportLog({
          reportId: report.id,
          status: 'SUCCESS',
          sentAt: new Date(),
          recipientCount: report.recipients.length,
          errorMessage: null,
        });

        return { success: true, message: `Test email sent successfully (format: ${customization.reportFormat})` };
      } catch (error: any) {
        // Log failure
        await db.createScheduledReportLog({
          reportId: report.id,
          status: 'FAILED',
          sentAt: new Date(),
          recipientCount: 0,
          errorMessage: error.message,
        });

        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: `Failed to send test email: ${error.message}` 
        });
      }
    }),

  // Preview email with real data
  previewEmail: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const report = await db.getScheduledReportById(input.id);
      if (!report) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
      }

      const { generateNGVisualReport, generateNGVisualEmailHTML } = await import('../services/reportGenerator');
      
      // Generate report data with real filters
      const reportData = await generateNGVisualReport({
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        endDate: new Date(),
        factoryId: report.factoryId ?? undefined,
        workshopId: report.workshopId ?? undefined,
        lineId: report.lineId ?? undefined,
      });

      // Get customization from report
      const customization = {
        logoUrl: (report as any).logoUrl,
        primaryColor: (report as any).primaryColor,
        footerText: (report as any).footerText,
        reportFormat: (report as any).reportFormat || 'HTML',
      };

      // Generate HTML email
      const emailHtml = generateNGVisualEmailHTML(reportData, customization);

      return {
        html: emailHtml,
        reportData,
        customization,
      };
    }),

  uploadLogo: adminProcedure
    .input(z.object({
      base64: z.string(),
      filename: z.string(),
      mimeType: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { storagePut } = await import('../storage');
      
      // Extract base64 data
      const base64Data = input.base64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Generate unique filename
      const ext = input.filename.split('.').pop() || 'png';
      const uniqueFilename = `report-logos/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      
      // Upload to S3
      const { url } = await storagePut(uniqueFilename, buffer, input.mimeType);
      
      return { url };
    }),

  // Report Templates
  listTemplates: protectedProcedure
    .query(async () => {
      const { reportTemplates } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const result = await database.select().from(reportTemplates).where(eq(reportTemplates.isActive, true));
      return result;
    }),

  getTemplateById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const { reportTemplates } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const result = await database.select().from(reportTemplates).where(eq(reportTemplates.id, input.id));
      return result[0] || null;
    }),

  getTemplateByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      const { reportTemplates } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const result = await database.select().from(reportTemplates).where(eq(reportTemplates.code, input.code));
      return result[0] || null;
    }),

  createFromTemplate: adminProcedure
    .input(z.object({
      templateCode: z.string(),
      name: z.string().min(1).max(255),
      recipients: z.array(z.string().email()).min(1),
      scheduleTime: z.string().default("08:00"),
      scheduleDayOfWeek: z.number().min(0).max(6).optional(),
      scheduleDayOfMonth: z.number().min(1).max(31).optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      // Get template
      const { reportTemplates } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const templateResult = await database.select().from(reportTemplates).where(eq(reportTemplates.code, input.templateCode));
      const template = templateResult[0];
      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }

      // Map template type to schedule
      const scheduleMap: Record<string, 'DAILY' | 'WEEKLY' | 'MONTHLY'> = {
        'DAILY': 'DAILY',
        'WEEKLY': 'WEEKLY',
        'MONTHLY': 'MONTHLY',
        'CUSTOM': 'DAILY',
      };

      // Map template type to report type
      const reportTypeMap: Record<string, "NG_VISUAL" | "DAILY_SUMMARY" | "WEEKLY_SUMMARY" | "MONTHLY_SUMMARY" | "CUSTOM" | "OEE_REPORT" | "MACHINE_HEALTH"> = {
        'DAILY_QUALITY': 'DAILY_SUMMARY',
        'WEEKLY_SUMMARY': 'WEEKLY_SUMMARY',
        'MONTHLY_PERFORMANCE': 'MONTHLY_SUMMARY',
      };

      // Create scheduled report from template
      const sections = template.sections as any;
      const reportType: "NG_VISUAL" | "DAILY_SUMMARY" | "WEEKLY_SUMMARY" | "MONTHLY_SUMMARY" | "CUSTOM" | "OEE_REPORT" | "MACHINE_HEALTH" = reportTypeMap[template.code] || 'CUSTOM';
      const schedule: 'DAILY' | 'WEEKLY' | 'MONTHLY' = scheduleMap[template.templateType] || 'DAILY';
      const id = await db.createScheduledReport({
        name: input.name,
        description: template.description ?? undefined,
        reportType,
        schedule,
        scheduleTime: input.scheduleTime,
        scheduleDayOfWeek: input.scheduleDayOfWeek,
        scheduleDayOfMonth: input.scheduleDayOfMonth,
        recipients: input.recipients,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
        includeWorkstationHeatmap: sections.includeMachineComparison || false,
        includeTopNGPoints: sections.includeTopNGPoints || false,
        includeTrendChart: sections.includeTrendCharts || false,
        includeComparison: true,
        isActive: input.isActive,
        createdBy: ctx.user.id,
      });

      // Schedule if active
      if (input.isActive) {
        const report = await db.getScheduledReportById(id);
        if (report) {
          scheduleReport({
            id: report.id,
            schedule: report.schedule,
            scheduleTime: report.scheduleTime,
            scheduleDayOfWeek: report.scheduleDayOfWeek,
            scheduleDayOfMonth: report.scheduleDayOfMonth,
          });
        }
      }

      return { id, templateUsed: template.code };
    }),

  // Preview statistics report
  previewStatisticsReport: adminProcedure
    .input(z.object({
      frequency: z.enum(['daily', 'weekly', 'monthly']),
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { scheduledReportService } = await import('../services/scheduledReportService');
      return scheduledReportService.previewReport(input);
    }),

  // Send one-time statistics report
  sendStatisticsReport: adminProcedure
    .input(z.object({
      name: z.string(),
      frequency: z.enum(['daily', 'weekly', 'monthly']),
      recipients: z.array(z.string().email()).min(1),
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { scheduledReportService } = await import('../services/scheduledReportService');
      const content = await scheduledReportService.generateAndSendReport({
        name: input.name,
        type: 'statistics',
        frequency: input.frequency,
        recipients: input.recipients,
        corporateCode: input.corporateCode,
        factoryCode: input.factoryCode,
      });
      return { 
        success: true, 
        message: `Report sent to ${input.recipients.length} recipients`,
        summary: content.summary,
      };
    }),
});

// ============= SMTP Configuration Router =============
export const smtpRouter = router({
  getConfig: adminProcedure
    .query(async () => {
      const config = await db.getSmtpConfig();
      // Don't return password to frontend
      if (config) {
        return {
          ...config,
          password: config.password ? '********' : '',
        };
      }
      return null;
    }),

  updateConfig: adminProcedure
    .input(z.object({
      host: z.string().min(1),
      port: z.number().min(1).max(65535),
      secure: z.boolean(),
      username: z.string().min(1),
      password: z.string().optional(),
      fromEmail: z.string().email(),
      fromName: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      // If password is '********', don't update it
      const dataToUpdate: any = { ...input };
      if (input.password === '********' || !input.password) {
        const existing = await db.getSmtpConfig();
        if (existing) {
          dataToUpdate.password = existing.password;
        } else {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Password is required for new SMTP config' });
        }
      }
      
      const id = await db.createOrUpdateSmtpConfig(dataToUpdate);
      return { success: true, id };
    }),

  testConnection: adminProcedure
    .input(z.object({
      host: z.string().optional(),
      port: z.number().optional(),
      secure: z.boolean().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      fromEmail: z.string().optional(),
      fromName: z.string().optional(),
    }).optional())
    .mutation(async ({ input }) => {
      let config: any;
      
      if (input && input.host && input.username) {
        // Use provided config for testing
        config = input;
        // If password is masked, get from database
        if (input.password === '********' || !input.password) {
          const existingConfig = await db.getSmtpConfig();
          if (existingConfig) {
            config.password = existingConfig.password;
          } else {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Password is required' });
          }
        }
      } else {
        // Use saved config from database
        config = await db.getSmtpConfig();
        if (!config) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'SMTP config not found. Please save config first.' });
        }
      }
      
      try {
        const { testSmtpConnection } = await import('../_core/email');
        await testSmtpConnection(config);
        return { success: true, message: 'SMTP connection successful' };
      } catch (error: any) {
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: `SMTP connection failed: ${error.message}` 
        });
      }
    }),

  // Email Template Config endpoints
  getEmailTemplates: adminProcedure.query(async () => {
    return db.getEmailTemplateConfigs();
  }),

  getEmailTemplateById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getEmailTemplateConfigById(input.id);
    }),

  getDefaultEmailTemplate: adminProcedure.query(async () => {
    return db.getDefaultEmailTemplateConfig();
  }),

  createEmailTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      logoUrl: z.string().optional().nullable(),
      companyName: z.string().optional().nullable(),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      warningColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      dangerColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      fontFamily: z.string().optional(),
      footerText: z.string().optional().nullable(),
      footerLinks: z.string().optional().nullable(), // JSON string
      contactEmail: z.string().email().optional().nullable(),
      contactPhone: z.string().optional().nullable(),
      contactAddress: z.string().optional().nullable(),
      socialLinks: z.string().optional().nullable(), // JSON string
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.createEmailTemplateConfig({
        ...input,
        createdBy: ctx.user.id,
      });
      return result;
    }),

  updateEmailTemplate: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      logoUrl: z.string().optional().nullable(),
      companyName: z.string().optional().nullable(),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      warningColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      dangerColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      fontFamily: z.string().optional(),
      footerText: z.string().optional().nullable(),
      footerLinks: z.string().optional().nullable(),
      contactEmail: z.string().email().optional().nullable(),
      contactPhone: z.string().optional().nullable(),
      contactAddress: z.string().optional().nullable(),
      socialLinks: z.string().optional().nullable(),
      isDefault: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateEmailTemplateConfig(id, data);
      return { success: true };
    }),

  deleteEmailTemplate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteEmailTemplateConfig(input.id);
      return { success: true };
    }),

  setDefaultEmailTemplate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.setDefaultEmailTemplateConfig(input.id);
      return { success: true };
    }),
});

// ============ SYSTEM CONFIG ROUTER ============
export const systemConfigRouter = router({
  list: adminProcedure.query(async () => {
    return db.getAllSystemConfig();
  }),

  getByKey: adminProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      return db.getSystemConfigByKey(input.key);
    }),

  update: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.updateSystemConfig(input.key, input.value, ctx.user.id);
      return { success: true };
    }),

  create: adminProcedure
    .input(z.object({
      configKey: z.string(),
      configValue: z.string(),
      description: z.string().optional(),
      dataType: z.enum(["STRING", "NUMBER", "BOOLEAN", "JSON"]).optional(),
      isEditable: z.boolean().optional(),
      requiresRestart: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      return db.createSystemConfig(input);
    }),
});

// ============ CORPORATE/FACTORY STATS ROUTER ============
export const corporateFactoryStatsRouter = router({
  yieldRateByCorporate: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return cachedStats.getCachedYieldRateByCorporate({
        ...input,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
    }),

  yieldRateByFactory: protectedProcedure
    .input(z.object({
      corporateCode: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return cachedStats.getCachedYieldRateByFactory({
        ...input,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
    }),

  throughputByCorporate: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      interval: z.enum(['hour', 'day', 'week']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      return cachedStats.getCachedThroughputByCorporate({
        ...input,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
    }),

  throughputByFactory: protectedProcedure
    .input(z.object({
      corporateCode: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      interval: z.enum(['hour', 'day', 'week']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      return cachedStats.getCachedThroughputByFactory({
        ...input,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
    }),

  // Machine statistics with caching
  machineStats: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return cachedStats.getCachedMachineStats(input);
    }),

  // Cache statistics for monitoring
  cacheStats: adminProcedure
    .query(async () => {
      return cachedStats.getCacheStats();
    }),

  // Cache health check
  cacheHealth: adminProcedure
    .query(async () => {
      return cachedStats.getCacheHealth();
    }),

  // Redis connection status with history
  redisConnectionStatus: adminProcedure
    .query(async () => {
      const { redisService } = await import('../services/redisService');
      return redisService.getConnectionStatus();
    }),

  // Redis connection history
  redisConnectionHistory: adminProcedure
    .query(async () => {
      const { redisService } = await import('../services/redisService');
      return redisService.getConnectionHistory();
    }),

  // Clear all statistics cache
  clearCache: adminProcedure
    .mutation(async () => {
      await cachedStats.invalidateStatisticsCache();
      return { success: true, message: 'Statistics cache cleared' };
    }),

  // Cache warming statistics
  warmingStats: adminProcedure
    .query(async () => {
      const { cacheWarmingService } = await import('../services/cacheWarmingService');
      return cacheWarmingService.getStats();
    }),

  // Trigger cache warming manually
  triggerWarming: adminProcedure
    .mutation(async () => {
      const { cacheWarmingService } = await import('../services/cacheWarmingService');
      await cacheWarmingService.triggerWarming();
      return { success: true, message: 'Cache warming triggered' };
    }),

  // Update cache warming configuration
  updateWarmingConfig: adminProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      intervalMinutes: z.number().min(5).max(1440).optional(), // 5 min to 24 hours
      warmOnStartup: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { cacheWarmingService } = await import('../services/cacheWarmingService');
      cacheWarmingService.updateConfig(input);
      return { success: true, message: 'Cache warming triggered' };
    }),
});
