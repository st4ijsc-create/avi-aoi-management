import cron, { ScheduledTask } from "node-cron";
import * as db from "../db";
import { sendEmail, createTransporterFromConfig } from "../_core/email";
import { generateNGVisualReport, generateNGVisualEmailHTML, generateReport, ReportCustomization } from "./reportGenerator";

// Store active cron jobs
const activeCronJobs = new Map<number, ScheduledTask>();

// ════════════════════════════════════════════════════════════════════════════
// Consolidated report-content builder (P1, audit G)
//
// Single source of truth that turns a scheduled-report row into the email body
// (+ optional attachment). Used by BOTH the cron (executeScheduledReport) and the
// admin sendTest / previewEmail procedures so reportType actually drives content
// instead of always emitting an NG_VISUAL report.
//
//   • DATA WINDOW   ← driven by report.schedule (DAILY=1d, WEEKLY=7d, MONTHLY=30d),
//                     overridable per-call (sendTest passes a fixed preview window).
//   • CONTENT       ← driven by report.reportType (the report category):
//        NG_VISUAL ............... NG visual report (heatmap / top-NG / trend)
//        DAILY/WEEKLY/MONTHLY_SUMMARY  statistics summary (yield by corp/factory)
//        OEE_REPORT .............. OEE summary (availability/perf/quality)
//        MACHINE_HEALTH .......... machine-health summary
//        CUSTOM .................. NG visual (safe default)
// ════════════════════════════════════════════════════════════════════════════

export type ScheduledReportType =
  | "NG_VISUAL"
  | "DAILY_SUMMARY"
  | "WEEKLY_SUMMARY"
  | "MONTHLY_SUMMARY"
  | "CUSTOM"
  | "OEE_REPORT"
  | "MACHINE_HEALTH";

export interface BuiltReportEmail {
  subject: string;
  html: string;
  attachment?: { filename: string; content: Buffer | string; contentType: string };
}

/** Map a report's schedule cadence to a lookback data window ending now. */
export function windowForSchedule(
  schedule: "DAILY" | "WEEKLY" | "MONTHLY" | null | undefined,
): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  const startDate = new Date();
  switch (schedule) {
    case "WEEKLY":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "MONTHLY":
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case "DAILY":
    default:
      startDate.setDate(startDate.getDate() - 1);
      break;
  }
  return { startDate, endDate };
}

/** Map an enhanced/db reportType + schedule to the legacy statistics frequency. */
function frequencyForReport(
  schedule: "DAILY" | "WEEKLY" | "MONTHLY" | null | undefined,
): "daily" | "weekly" | "monthly" {
  switch (schedule) {
    case "WEEKLY":
      return "weekly";
    case "MONTHLY":
      return "monthly";
    default:
      return "daily";
  }
}

/**
 * Build the email (subject + html + optional attachment) for a scheduled report,
 * dispatching on reportType for content and on schedule (or an override) for the
 * data window. This is the shared path for cron, sendTest and previewEmail.
 */
export async function buildScheduledReportEmail(
  report: {
    id: number;
    name: string;
    reportType: ScheduledReportType;
    schedule: "DAILY" | "WEEKLY" | "MONTHLY";
    factoryId?: number | null;
    workshopId?: number | null;
    lineId?: number | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
    footerText?: string | null;
    reportFormat?: "HTML" | "PDF" | "EXCEL" | null;
  },
  options?: { window?: { startDate: Date; endDate: Date }; subjectPrefix?: string },
): Promise<BuiltReportEmail> {
  const { startDate, endDate } = options?.window ?? windowForSchedule(report.schedule);
  const factoryId = report.factoryId ?? undefined;
  const workshopId = report.workshopId ?? undefined;
  const lineId = report.lineId ?? undefined;
  const prefix = options?.subjectPrefix ?? "";
  const dateStr = endDate.toLocaleDateString("vi-VN");
  const customization: ReportCustomization = {
    logoUrl: report.logoUrl,
    primaryColor: report.primaryColor,
    footerText: report.footerText,
    reportFormat: report.reportFormat || "HTML",
  };

  // Lazy import to avoid a hard cycle / pull the singleton only when needed.
  const frequency = frequencyForReport(report.schedule);

  switch (report.reportType) {
    case "DAILY_SUMMARY":
    case "WEEKLY_SUMMARY":
    case "MONTHLY_SUMMARY": {
      const { scheduledReportService } = await import("./scheduledReportService");
      const { content, html } = await scheduledReportService.previewReport({ frequency });
      return { subject: `${prefix}${report.name} - ${content.title} - ${dateStr}`, html };
    }

    case "OEE_REPORT": {
      const { scheduledReportService } = await import("./scheduledReportService");
      const svcReport = {
        id: report.id,
        name: report.name,
        type: "oee" as const,
        frequency,
        recipients: [] as string[],
        isEnabled: true,
        createdBy: 0,
        createdAt: new Date(),
      };
      const oee = await scheduledReportService.generateOEEReportContent(svcReport);
      const html = await scheduledReportService.formatOEEReportHtml(oee);
      return { subject: `${prefix}${report.name} - ${oee.title} - ${dateStr}`, html };
    }

    case "MACHINE_HEALTH": {
      const { scheduledReportService } = await import("./scheduledReportService");
      const svcReport = {
        id: report.id,
        name: report.name,
        type: "machine_health" as const,
        frequency,
        recipients: [] as string[],
        isEnabled: true,
        createdBy: 0,
        createdAt: new Date(),
      };
      const health = await scheduledReportService.generateMachineHealthReportContent(svcReport);
      const html = await scheduledReportService.formatMachineHealthReportHtml(health);
      return { subject: `${prefix}${report.name} - ${health.title} - ${dateStr}`, html };
    }

    case "NG_VISUAL":
    case "CUSTOM":
    default: {
      const reportData = await generateNGVisualReport({ startDate, endDate, factoryId, workshopId, lineId });
      const html = generateNGVisualEmailHTML(reportData, customization);
      const built: BuiltReportEmail = {
        subject: `${prefix}${report.name} - ${dateStr}`,
        html,
      };
      if (customization.reportFormat === "PDF" || customization.reportFormat === "EXCEL") {
        try {
          const { content, mimeType, extension } = await generateReport(reportData, customization.reportFormat, customization);
          built.attachment = {
            filename: `NG_Visual_Report_${endDate.toISOString().split("T")[0]}.${extension}`,
            content,
            contentType: mimeType,
          };
        } catch (e) {
          console.error(`[ReportScheduler] attachment generation failed for report ${report.id}:`, (e as any)?.message || e);
        }
      }
      return built;
    }
  }
}

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

    // Build the email via the shared, reportType-aware builder. The data window
    // is derived from report.schedule and the content from report.reportType.
    const built = await buildScheduledReportEmail(report as any);
    const emailHTML = built.html;

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
      subject: built.subject,
      html: emailHTML,
    };

    // Attach generated file when the builder produced one (PDF / Excel formats)
    if (built.attachment) {
      mailOptions.attachments = [built.attachment];
      console.log(`[ReportScheduler] Attached ${built.attachment.filename} for report ${reportId}`);
    }

    // Send email
    await transporter.sendMail(mailOptions);

    console.log(`[ReportScheduler] Report ${reportId} (type=${report.reportType}) sent to ${recipients.length} recipients`);
    
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
