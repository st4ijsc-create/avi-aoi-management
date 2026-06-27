import cron, { ScheduledTask } from "node-cron";
import * as db from "../db";
import { sendEmail, createTransporterFromConfig } from "../_core/email";
import { generateNGVisualReport, generateNGVisualEmailHTML, generateReport, ReportCustomization } from "./reportGenerator";

// Store active cron jobs
const activeCronJobs = new Map<number, ScheduledTask>();

/**
 * Convert schedule configuration to cron expression
 */
function scheduleToCronExpression(schedule: {
  schedule: "DAILY" | "WEEKLY" | "MONTHLY";
  scheduleTime: string; // HH:mm format
  scheduleDayOfWeek?: number | null; // 0-6 for weekly
  scheduleDayOfMonth?: number | null; // 1-31 for monthly
}): string {
  const [hour, minute] = schedule.scheduleTime.split(":").map(Number);

  switch (schedule.schedule) {
    case "DAILY":
      // Run every day at specified time
      return `0 ${minute} ${hour} * * *`;
    
    case "WEEKLY":
      // Run every week on specified day at specified time
      const dayOfWeek = schedule.scheduleDayOfWeek || 0;
      return `0 ${minute} ${hour} * * ${dayOfWeek}`;
    
    case "MONTHLY":
      // Run every month on specified day at specified time
      const dayOfMonth = schedule.scheduleDayOfMonth || 1;
      return `0 ${minute} ${hour} ${dayOfMonth} * *`;
    
    default:
      throw new Error(`Unknown schedule type: ${schedule.schedule}`);
  }
}

/**
 * Execute a scheduled report
 */
async function executeScheduledReport(reportId: number) {
  console.log(`[ReportScheduler] Executing scheduled report ${reportId}`);
  
  try {
    // Get report configuration
    const report = await db.getScheduledReportById(reportId);
    if (!report || !report.isActive) {
      console.log(`[ReportScheduler] Report ${reportId} not found or inactive, skipping`);
      return;
    }

    // Get SMTP config
    const smtpConfig = await db.getSmtpConfig();
    if (!smtpConfig) {
      console.error(`[ReportScheduler] No SMTP config found, cannot send report ${reportId}`);
      await db.createScheduledReportLog({
        reportId,
        status: "FAILED",
        errorMessage: "SMTP configuration not found",
      });
      return;
    }

    // Calculate date range based on report type
    const endDate = new Date();
    let startDate = new Date();
    
    switch (report.reportType) {
      case "NG_VISUAL":
      case "DAILY_SUMMARY":
        // Last 24 hours
        startDate.setDate(startDate.getDate() - 1);
        break;
      case "WEEKLY_SUMMARY":
        // Last 7 days
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "MONTHLY_SUMMARY":
        // Last 30 days
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        // Default to last 24 hours
        startDate.setDate(startDate.getDate() - 1);
    }

    // Get filters from report configuration
    const factoryId = report.factoryId ?? undefined;
    const workshopId = report.workshopId ?? undefined;
    const lineId = report.lineId ?? undefined;

    // Generate report data
    const reportData = await generateNGVisualReport({
      startDate,
      endDate,
      factoryId,
      workshopId,
      lineId,
    });

    // Get customization from report
    const customization: ReportCustomization = {
      logoUrl: (report as any).logoUrl,
      primaryColor: (report as any).primaryColor,
      footerText: (report as any).footerText,
      reportFormat: (report as any).reportFormat || 'HTML',
    };

    // Generate HTML email (always needed for email body)
    const emailHTML = generateNGVisualEmailHTML(reportData, customization);

    // Send email to all recipients
    const recipients = report.recipients || [];
    if (recipients.length === 0) {
      console.warn(`[ReportScheduler] Report ${reportId} has no recipients`);
      await db.createScheduledReportLog({
        reportId,
        status: "FAILED",
        errorMessage: "No recipients configured",
      });
      return;
    }

    // Create transporter from SMTP config
    const transporter = createTransporterFromConfig(smtpConfig);

    // Prepare email options
    const mailOptions: any = {
      from: `${smtpConfig.fromName} <${smtpConfig.fromEmail}>`,
      to: recipients.join(','),
      subject: `${report.name} - ${new Date().toLocaleDateString("vi-VN")}`,
      html: emailHTML,
    };

    // Add attachment if PDF or Excel format
    if (customization.reportFormat === 'PDF' || customization.reportFormat === 'EXCEL') {
      try {
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
        
        console.log(`[ReportScheduler] Generated ${customization.reportFormat} attachment for report ${reportId}`);
      } catch (attachmentError: any) {
        console.error(`[ReportScheduler] Failed to generate attachment for report ${reportId}:`, attachmentError);
        // Continue sending email without attachment
      }
    }

    // Send email
    await transporter.sendMail(mailOptions);

    console.log(`[ReportScheduler] Report ${reportId} sent successfully to ${recipients.length} recipients (format: ${customization.reportFormat})`);
    
    // Log success
    await db.createScheduledReportLog({
      reportId,
      status: "SUCCESS",
      recipientCount: recipients.length,
    });

    // Update lastSentAt
    await db.updateScheduledReport(reportId, {
      lastSentAt: new Date(),
    });

  } catch (error: any) {
    console.error(`[ReportScheduler] Error executing report ${reportId}:`, error);
    
    // Log error
    await db.createScheduledReportLog({
      reportId,
      status: "FAILED",
      errorMessage: error.message || "Unknown error",
    });
  }
}

/**
 * Schedule a report
 */
export function scheduleReport(report: {
  id: number;
  schedule: "DAILY" | "WEEKLY" | "MONTHLY";
  scheduleTime: string;
  scheduleDayOfWeek?: number | null;
  scheduleDayOfMonth?: number | null;
}) {
  // Stop existing job if any
  stopScheduledReport(report.id);

  try {
    // Convert to cron expression
    const cronExpression = scheduleToCronExpression(report);
    console.log(`[ReportScheduler] Scheduling report ${report.id} with cron: ${cronExpression}`);

    // Create cron job
    const task = cron.schedule(cronExpression, () => {
      executeScheduledReport(report.id);
    });

    // Store task
    activeCronJobs.set(report.id, task);
    
    console.log(`[ReportScheduler] Report ${report.id} scheduled successfully`);
  } catch (error) {
    console.error(`[ReportScheduler] Failed to schedule report ${report.id}:`, error);
  }
}

/**
 * Stop a scheduled report
 */
export function stopScheduledReport(reportId: number) {
  const task = activeCronJobs.get(reportId);
  if (task) {
    task.stop();
    activeCronJobs.delete(reportId);
    console.log(`[ReportScheduler] Stopped report ${reportId}`);
  }
}

/**
 * Initialize all active scheduled reports
 */
export async function initializeScheduledReports(retries = 3, delayMs = 5000) {
  console.log("[ReportScheduler] Initializing scheduled reports...");
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Get all active scheduled reports
      const reports = await db.getScheduledReports({ isActive: true });
      
      console.log(`[ReportScheduler] Found ${reports.length} active reports`);
      
      // Schedule each report
      for (const report of reports) {
        scheduleReport({
          id: report.id,
          schedule: report.schedule,
          scheduleTime: report.scheduleTime,
          scheduleDayOfWeek: report.scheduleDayOfWeek,
          scheduleDayOfMonth: report.scheduleDayOfMonth,
        });
      }
      
      console.log(`[ReportScheduler] Initialized ${reports.length} scheduled reports`);
      return; // Success — exit
    } catch (error) {
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) {
        console.error("[ReportScheduler] Failed to initialize scheduled reports after all retries:", error);
      } else {
        const wait = delayMs * attempt;
        console.warn(`[ReportScheduler] Attempt ${attempt}/${retries} failed, retrying in ${wait / 1000}s...`, (error as any)?.cause?.code || (error as any)?.message || '');
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }
  }
}

/**
 * Shutdown all scheduled reports
 */
export function shutdownScheduledReports() {
  console.log("[ReportScheduler] Shutting down all scheduled reports...");
  
  activeCronJobs.forEach((task, reportId) => {
    task.stop();
    console.log(`[ReportScheduler] Stopped report ${reportId}`);
  });
  
  activeCronJobs.clear();
  console.log("[ReportScheduler] All scheduled reports stopped");
}

// ════════════════════════════════════════════════════════════════════════════
// Phase B4.3 — Automated Executive Reports (AI exec summary, shift/day/week)
//
// Additive + flag-gated default OFF. Safe no-op when EXEC_REPORT_ENABLED is not
// "true". Each scheduled period generates an AI executive summary from REAL KPIs
// (deep model via Model Router task:"report"), persists it into ai_insights, and
// optionally emits a notification. Mirrors aiBatchRcaScheduler wiring style.
//
// Flags (.env):
//   EXEC_REPORT_ENABLED   = false            (master switch, default OFF)
//   EXEC_REPORT_SCHEDULE  = "shift,day,week" (which periods to run)
//   EXEC_REPORT_LANG      = vi               (vi | en)
//   EXEC_REPORT_TZ        = Asia/Ho_Chi_Minh
//   EXEC_REPORT_SHIFT_CRON / _DAY_CRON / _WEEK_CRON  (override cron per period)
// ════════════════════════════════════════════════════════════════════════════

import type { ReportPeriod, ReportLang } from "./aiExecutiveReport";

const EXEC_REPORT_ENABLED = String(process.env.EXEC_REPORT_ENABLED ?? "false").toLowerCase() === "true";
const EXEC_REPORT_TZ = process.env.EXEC_REPORT_TZ || "Asia/Ho_Chi_Minh";

// Default cron per period: shift = every 8h, day = 06:00 daily, week = 07:00 Monday.
const EXEC_CRON: Record<ReportPeriod, string> = {
  shift: process.env.EXEC_REPORT_SHIFT_CRON || "0 0 6,14,22 * * *",
  day: process.env.EXEC_REPORT_DAY_CRON || "0 5 6 * * *",
  week: process.env.EXEC_REPORT_WEEK_CRON || "0 15 7 * * 1",
};

const execReportJobs = new Map<ReportPeriod, ScheduledTask>();

function enabledExecPeriods(): ReportPeriod[] {
  const raw = (process.env.EXEC_REPORT_SCHEDULE || "shift,day,week")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is ReportPeriod => p === "shift" || p === "day" || p === "week");
  return raw.length ? Array.from(new Set(raw)) : ["day"];
}

/** Run one executive report for a period: generate → persist → optional notify. Never throws. */
export async function runExecutiveReport(period: ReportPeriod): Promise<void> {
  try {
    const { runExecutiveReportNow } = await import("./aiExecutiveReport");
    const lang = (process.env.EXEC_REPORT_LANG as ReportLang) || "vi";
    const { summary, insightId } = await runExecutiveReportNow(period, lang);
    console.log(
      `[ExecReportScheduler] ${period} report generated (id=${insightId ?? "n/a"}, by=${summary.generatedBy}` +
        `, warnings=${summary.kpis.dataWarnings.length})`,
    );
  } catch (err) {
    console.error(`[ExecReportScheduler] ${period} run error:`, (err as any)?.message || err);
  }
}

/** Register cron jobs for the configured executive-report periods. No-op when flag OFF. */
export function startExecutiveReportScheduler(): void {
  if (!EXEC_REPORT_ENABLED) {
    console.log("[ExecReportScheduler] disabled (set EXEC_REPORT_ENABLED=true to enable)");
    return;
  }
  if (execReportJobs.size > 0) return; // already started
  for (const period of enabledExecPeriods()) {
    const expr = EXEC_CRON[period];
    try {
      const task = cron.schedule(
        expr,
        () => {
          runExecutiveReport(period).catch((e) => console.error("[ExecReportScheduler] cron error:", e));
        },
        { timezone: EXEC_REPORT_TZ },
      );
      execReportJobs.set(period, task);
      console.log(`[ExecReportScheduler] scheduled ${period} '${expr}' (${EXEC_REPORT_TZ})`);
    } catch (err) {
      console.error(`[ExecReportScheduler] failed to schedule ${period}:`, (err as any)?.message || err);
    }
  }
}

/** Stop all executive-report cron jobs. */
export function stopExecutiveReportScheduler(): void {
  execReportJobs.forEach((task, period) => {
    task.stop();
    console.log(`[ExecReportScheduler] stopped ${period}`);
  });
  execReportJobs.clear();
}

/** Status for dashboards / health. */
export function getExecutiveReportSchedulerStatus() {
  return {
    enabled: EXEC_REPORT_ENABLED,
    timezone: EXEC_REPORT_TZ,
    periods: enabledExecPeriods(),
    crons: EXEC_CRON,
    running: execReportJobs.size > 0,
  };
}
