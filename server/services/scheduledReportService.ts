/**
 * Scheduled Report Service
 * 
 * Features:
 * - Schedule daily/weekly reports
 * - Generate report content (statistics summary)
 * - Send reports via email
 * - Store report history
 */

import * as db from '../db';
import { sendEmail } from '../_core/email';
import { notifyOwner } from '../_core/notification';
import { getFactoryTimezone, nextRunInZone } from '../utils/factoryTime';

// Email template config interface - matches db schema
interface EmailTemplateConfig {
  id: number;
  name: string;
  logoUrl: string | null;
  companyName: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  warningColor?: string | null;
  successColor?: string | null;
  errorColor?: string | null;
  backgroundColor: string | null;
  textColor?: string | null;
  linkColor?: string | null;
  fontFamily: string | null;
  headingFontFamily?: string | null;
  fontSize?: string | null;
  footerText: string | null;
  copyrightText?: string | null;
  socialLinks?: any;
  contactEmail: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
  isDefault: boolean;
}

export type ReportFrequency = 'daily' | 'weekly' | 'monthly';
export type ReportType = 'statistics' | 'alerts' | 'comprehensive' | 'oee' | 'machine_health';

export interface ScheduledReport {
  id: number;
  name: string;
  type: ReportType;
  frequency: ReportFrequency;
  recipients: string[];
  corporateCode?: string;
  factoryCode?: string;
  isEnabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
  /** Wall-clock fire time "HH:mm" in the FACTORY timezone (doc 27 A1). */
  scheduleTime?: string;
  /** 0 (Sunday) – 6, weekly schedules only. */
  scheduleDayOfWeek?: number | null;
  /** 1–31, monthly schedules only. */
  scheduleDayOfMonth?: number | null;
  createdBy: number;
  createdAt: Date;
}

export interface ReportContent {
  title: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalInspections: number;
    okCount: number;
    ngCount: number;
    ntfCount: number;
    yieldRate: string;
  };
  corporateStats: Array<{
    corporateCode: string;
    totalInspections: number;
    yieldRate: string;
  }>;
  factoryStats: Array<{
    factoryCode: string;
    corporateCode: string;
    totalInspections: number;
    yieldRate: string;
  }>;
  topNGMachines: Array<{
    machineName: string;
    ngCount: number;
    yieldRate: string;
  }>;
  generatedAt: Date;
}

export interface OEEReportContent {
  title: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalMachines: number;
    avgAvailability: string;
    avgPerformance: string;
    avgQuality: string;
    avgOEE: string;
    totalDowntime: number;
  };
  machineOEE: Array<{
    machineId: number;
    machineCode: string;
    availability: number;
    performance: number;
    quality: number;
    oee: number;
    timestamp: Date;
  }>;
  downtimeByCategory: Record<string, number>;
  machinesNeedingAttention: Array<{
    machineId: number;
    machineCode: string;
    availability: number;
    performance: number;
    quality: number;
    oee: number;
    timestamp: Date;
  }>;
  generatedAt: Date;
}

export interface MachineHealthReportContent {
  title: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalMachines: number;
    healthyCount: number;
    warningCount: number;
    criticalCount: number;
    avgHealthScore: string;
  };
  machineHealth: Array<{
    machineId: number;
    machineCode: string;
    healthScore: number;
    oee: number;
    status: 'healthy' | 'warning' | 'critical';
  }>;
  machinesNeedingMaintenance: Array<{
    machineId: number;
    machineCode: string;
    healthScore: number;
    oee: number;
    status: 'healthy' | 'warning' | 'critical';
  }>;
  generatedAt: Date;
}

class ScheduledReportService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.log('[ScheduledReport] Scheduler already running');
      return;
    }

    console.log('[ScheduledReport] Starting scheduler...');
    this.isRunning = true;

    // Check every hour for reports to run
    this.intervalId = setInterval(() => {
      this.checkAndRunReports();
    }, 60 * 60 * 1000); // 1 hour

    // Also run immediately on start
    this.checkAndRunReports();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[ScheduledReport] Scheduler stopped');
  }

  /**
   * Check and run due reports
   */
  private async checkAndRunReports(): Promise<void> {
    try {
      const reports = await this.getDueReports();
      
      for (const report of reports) {
        try {
          await this.runReport(report);
        } catch (err: any) {
          console.error(`[ScheduledReport] Failed to run report ${report.id}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error('[ScheduledReport] Error checking reports:', err.message);
    }
  }

  /**
   * Get reports that are due to run, queried from the database.
   */
  private async getDueReports(): Promise<ScheduledReport[]> {
    const rows = await db.getReportsDueForSending();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: (r.reportType ?? "statistics") as ReportType,
      frequency: (r.schedule?.toLowerCase() ?? "daily") as ReportFrequency,
      recipients: (r.recipients as string[]) ?? [],
      isEnabled: r.isActive,
      lastRunAt: r.lastSentAt ?? undefined,
      nextRunAt: r.nextScheduledAt ?? undefined,
      scheduleTime: r.scheduleTime ?? undefined,
      scheduleDayOfWeek: r.scheduleDayOfWeek,
      scheduleDayOfMonth: r.scheduleDayOfMonth,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Compute the next scheduled run strictly after `after` (default: now).
   *
   * Doc 27 §6 A1 (P0): scheduleTime is a FACTORY-timezone wall-clock time.
   * The old implementation used bare `new Date()` + setHours, i.e. the
   * server/OS timezone — on a UTC host a "06:00 daily" report drifted to
   * 06:00 UTC (13:00 Asia/Ho_Chi_Minh), the +7h manual-data-patch incident
   * (doc 27 §6 A1). Now delegates to nextRunInZone, which evaluates
   * the schedule on the factory wall clock (env FACTORY_TZ, default
   * Asia/Ho_Chi_Minh) and returns the correct UTC instant, DST-safe.
   */
  private computeNextRun(
    frequency: ReportFrequency,
    scheduleTime: string,
    opts?: { dayOfWeek?: number | null; dayOfMonth?: number | null; after?: Date },
  ): Date {
    return nextRunInZone({
      frequency,
      time: scheduleTime,
      dayOfWeek: opts?.dayOfWeek,
      dayOfMonth: opts?.dayOfMonth,
      timeZone: getFactoryTimezone(),
      after: opts?.after,
    });
  }

  /**
   * Run a specific report
   */
  async runReport(report: ScheduledReport): Promise<void> {
    console.log(`[ScheduledReport] Running report: ${report.name}`);

    const content = await this.generateReportContent(report);
    const html = await this.formatReportHtml(content);

    // Send to all recipients
    for (const email of report.recipients) {
      await sendEmail({
        to: email,
        subject: `[AVI/AOI] ${content.title}`,
        html,
      });
    }

    // Advance nextScheduledAt so this report is not re-triggered immediately.
    // Uses the report's REAL scheduleTime (previously hardcoded "08:00") and
    // evaluates it on the factory timezone wall clock (doc 27 A1).
    const nextRun = this.computeNextRun(report.frequency, report.scheduleTime ?? "08:00", {
      dayOfWeek: report.scheduleDayOfWeek,
      dayOfMonth: report.scheduleDayOfMonth,
    });
    await db.updateReportNextSchedule(report.id, nextRun);

    // Also notify owner
    await notifyOwner({
      title: `Báo cáo tự động: ${report.name}`,
      content: `Đã gửi báo cáo ${report.frequency} đến ${report.recipients.length} người nhận.\nTổng kiểm tra: ${content.summary.totalInspections}\nYield Rate: ${content.summary.yieldRate}%`,
    });

    console.log(`[ScheduledReport] Report sent to ${report.recipients.length} recipients. Next run: ${nextRun.toISOString()}`);
  }

  /**
   * Generate report content
   */
  async generateReportContent(report: ScheduledReport): Promise<ReportContent> {
    const { start, end } = this.getReportPeriod(report.frequency);

    // Get statistics
    const yieldByCorporate = await db.getYieldRateByCorporate({
      startDate: start,
      endDate: end,
    });

    const yieldByFactory = await db.getYieldRateByFactory({
      corporateCode: report.corporateCode,
      startDate: start,
      endDate: end,
    });

    // Calculate summary
    const totalInspections = yieldByCorporate.reduce((sum, c) => sum + c.totalInspections, 0);
    const okCount = yieldByCorporate.reduce((sum, c) => sum + c.okCount, 0);
    const ngCount = yieldByCorporate.reduce((sum, c) => sum + c.ngCount, 0);
    const ntfCount = yieldByCorporate.reduce((sum, c) => sum + c.ntfCount, 0);
    const yieldRate = totalInspections > 0 
      ? ((okCount / totalInspections) * 100).toFixed(2) 
      : '0.00';

    // Get top NG machines from factory stats
    interface NGMachine {
      machineName: string;
      ngCount: number;
      yieldRate: string;
    }
    
    const topNGMachines: NGMachine[] = yieldByFactory
      .filter(f => f.ngCount > 0)
      .sort((a, b) => b.ngCount - a.ngCount)
      .slice(0, 10)
      .map(f => ({
        machineName: f.factoryCode,
        ngCount: f.ngCount,
        yieldRate: f.yieldRate,
      }));

    return {
      title: this.getReportTitle(report),
      period: { start, end },
      summary: {
        totalInspections,
        okCount,
        ngCount,
        ntfCount,
        yieldRate,
      },
      corporateStats: yieldByCorporate.map(c => ({
        corporateCode: c.corporateCode,
        totalInspections: c.totalInspections,
        yieldRate: c.yieldRate,
      })),
      factoryStats: yieldByFactory.map(f => ({
        factoryCode: f.factoryCode,
        corporateCode: f.corporateCode,
        totalInspections: f.totalInspections,
        yieldRate: f.yieldRate,
      })),
      topNGMachines,
      generatedAt: new Date(),
    };
  }

  /**
   * Get report period based on frequency
   */
  private getReportPeriod(frequency: ReportFrequency): { start: Date; end: Date } {
    const end = new Date();
    const start = new Date();

    switch (frequency) {
      case 'daily':
        start.setDate(start.getDate() - 1);
        break;
      case 'weekly':
        start.setDate(start.getDate() - 7);
        break;
      case 'monthly':
        start.setMonth(start.getMonth() - 1);
        break;
    }

    return { start, end };
  }

  /**
   * Get report title
   */
  private getReportTitle(report: ScheduledReport): string {
    const periodMap = {
      daily: 'Hàng ngày',
      weekly: 'Hàng tuần',
      monthly: 'Hàng tháng',
    };
    return `Báo cáo ${periodMap[report.frequency]} - ${report.name}`;
  }

  /**
   * Format report as HTML with email template branding
   */
  async formatReportHtml(content: ReportContent, templateConfig?: EmailTemplateConfig | null): Promise<string> {
    const formatDate = (date: Date) => date.toLocaleDateString('vi-VN');
    const formatNumber = (num: number) => num.toLocaleString('vi-VN');

    // Get default template if not provided
    if (!templateConfig) {
      templateConfig = await db.getDefaultEmailTemplateConfig();
    }

    // Default values if no template
    const primaryColor = templateConfig?.primaryColor || '#2563eb';
    const secondaryColor = templateConfig?.secondaryColor || '#1e40af';
    const backgroundColor = templateConfig?.backgroundColor || '#f0f9ff';
    const textColor = templateConfig?.textColor || '#333333';
    const linkColor = templateConfig?.linkColor || '#2563eb';
    const fontFamily = templateConfig?.fontFamily || 'Arial, sans-serif';
    const headingFontFamily = templateConfig?.headingFontFamily || fontFamily;
    const companyName = templateConfig?.companyName || 'AVI/AOI Factory Management System';
    const logoUrl = templateConfig?.logoUrl;
    const footerText = templateConfig?.footerText || 'Báo cáo được tạo tự động bởi hệ thống';
    const copyrightText = templateConfig?.copyrightText || `© ${new Date().getFullYear()} ${companyName}`;
    const contactEmail = templateConfig?.contactEmail;
    const contactPhone = templateConfig?.contactPhone;
    const contactAddress = templateConfig?.contactAddress;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: ${fontFamily}; line-height: 1.6; color: ${textColor}; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #ffffff; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid ${primaryColor}; }
    .logo { max-height: 60px; margin-bottom: 10px; }
    .company-name { font-family: ${headingFontFamily}; font-size: 14px; color: ${secondaryColor}; margin: 0; }
    h1 { font-family: ${headingFontFamily}; color: ${primaryColor}; border-bottom: 2px solid ${primaryColor}; padding-bottom: 10px; }
    h2 { font-family: ${headingFontFamily}; color: ${secondaryColor}; margin-top: 30px; }
    a { color: ${linkColor}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .summary { background: ${backgroundColor}; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
    .stat-card { background: white; padding: 15px; border-radius: 6px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 24px; font-weight: bold; color: ${primaryColor}; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: ${backgroundColor}; font-weight: 600; color: ${secondaryColor}; }
    .yield-high { color: #16a34a; }
    .yield-medium { color: #ca8a04; }
    .yield-low { color: #dc2626; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; text-align: center; }
    .footer-contact { margin-top: 10px; }
    .footer-contact a { color: ${linkColor}; }
  </style>
</head>
<body>
  <div class="header">
    ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" class="logo" />` : ''}
    <p class="company-name">${companyName}</p>
  </div>
  <h1>${content.title}</h1>
  <p>Kỳ báo cáo: ${formatDate(content.period.start)} - ${formatDate(content.period.end)}</p>
  
  <div class="summary">
    <h2 style="margin-top: 0;">Tổng quan</h2>
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-value">${formatNumber(content.summary.totalInspections)}</div>
        <div class="stat-label">Tổng kiểm tra</div>
      </div>
      <div class="stat-card">
        <div class="stat-value ${this.getYieldClass(parseFloat(content.summary.yieldRate))}">${content.summary.yieldRate}%</div>
        <div class="stat-label">Yield Rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #16a34a;">${formatNumber(content.summary.okCount)}</div>
        <div class="stat-label">OK</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #dc2626;">${formatNumber(content.summary.ngCount + content.summary.ntfCount)}</div>
        <div class="stat-label">NG/NTF</div>
      </div>
    </div>
  </div>

  <h2>Thống kê theo Công ty</h2>
  <table>
    <thead>
      <tr>
        <th>Mã Công ty</th>
        <th>Tổng kiểm tra</th>
        <th>Yield Rate</th>
      </tr>
    </thead>
    <tbody>
      ${content.corporateStats.map(c => `
        <tr>
          <td>${c.corporateCode}</td>
          <td>${formatNumber(c.totalInspections)}</td>
          <td class="${this.getYieldClass(parseFloat(c.yieldRate))}">${c.yieldRate}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Thống kê theo Nhà máy</h2>
  <table>
    <thead>
      <tr>
        <th>Mã Nhà máy</th>
        <th>Công ty</th>
        <th>Tổng kiểm tra</th>
        <th>Yield Rate</th>
      </tr>
    </thead>
    <tbody>
      ${content.factoryStats.slice(0, 20).map(f => `
        <tr>
          <td>${f.factoryCode}</td>
          <td>${f.corporateCode}</td>
          <td>${formatNumber(f.totalInspections)}</td>
          <td class="${this.getYieldClass(parseFloat(f.yieldRate))}">${f.yieldRate}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  ${content.topNGMachines.length > 0 ? `
  <h2>Top 10 Máy có NG cao nhất</h2>
  <table>
    <thead>
      <tr>
        <th>Tên máy</th>
        <th>Số lượng NG</th>
        <th>Yield Rate</th>
      </tr>
    </thead>
    <tbody>
      ${content.topNGMachines.map(m => `
        <tr>
          <td>${m.machineName}</td>
          <td style="color: #dc2626;">${formatNumber(m.ngCount)}</td>
          <td class="${this.getYieldClass(parseFloat(m.yieldRate))}">${m.yieldRate}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  ` : ''}

  <div class="footer">
    <p>${footerText}</p>
    <p>Thời gian tạo: ${content.generatedAt.toLocaleString('vi-VN')}</p>
    ${(contactEmail || contactPhone || contactAddress) ? `
    <div class="footer-contact">
      ${contactEmail ? `<p>Email: <a href="mailto:${contactEmail}">${contactEmail}</a></p>` : ''}
      ${contactPhone ? `<p>Điện thoại: ${contactPhone}</p>` : ''}
      ${contactAddress ? `<p>Địa chỉ: ${contactAddress}</p>` : ''}
    </div>
    ` : ''}
    <p style="margin-top: 15px; font-size: 11px; color: #999;">${copyrightText}</p>
  </div>
</body>
</html>
    `;
  }

  private getYieldClass(yieldRate: number): string {
    if (yieldRate >= 95) return 'yield-high';
    if (yieldRate >= 85) return 'yield-medium';
    return 'yield-low';
  }

  /**
   * Generate and send a one-time report
   */
  async generateAndSendReport(params: {
    name: string;
    type: ReportType;
    frequency: ReportFrequency;
    recipients: string[];
    corporateCode?: string;
    factoryCode?: string;
  }): Promise<ReportContent> {
    const report: ScheduledReport = {
      id: 0,
      name: params.name,
      type: params.type,
      frequency: params.frequency,
      recipients: params.recipients,
      corporateCode: params.corporateCode,
      factoryCode: params.factoryCode,
      isEnabled: true,
      createdBy: 0,
      createdAt: new Date(),
    };

    const content = await this.generateReportContent(report);
    const html = await this.formatReportHtml(content);

    // Send to all recipients
    for (const email of params.recipients) {
      await sendEmail({
        to: email,
        subject: `[AVI/AOI] ${content.title}`,
        html,
      });
    }

    return content;
  }

  /**
   * Generate OEE Report Content — reads from persistent oeeMetrics DB table,
   * NOT the in-memory socket store (which is lost on server restart).
   */
  async generateOEEReportContent(report: ScheduledReport): Promise<OEEReportContent> {
    const { start, end } = this.getReportPeriod(report.frequency);

    // Query persisted OEE metrics from DB for the report period
    const { oeeMetrics, downtimeEvents } = await import('../../drizzle/schema');
    const { getDb } = await import('../db/connection');
    const { and, gte, lte, desc, sql } = await import('drizzle-orm');

    const conn = await getDb();
    const rows = conn ? await conn
      .select({
        machineId: oeeMetrics.machineId,
        machineCode: oeeMetrics.machineCode,
        availability: oeeMetrics.availability,
        performance: oeeMetrics.performance,
        quality: oeeMetrics.quality,
        oee: oeeMetrics.oee,
        timestamp: oeeMetrics.timestamp,
      })
      .from(oeeMetrics)
      .where(and(gte(oeeMetrics.timestamp, start), lte(oeeMetrics.timestamp, end)))
      .orderBy(desc(oeeMetrics.timestamp))
      .limit(500) : [];

    // Latest OEE per machine (most recent reading in the period)
    const latestByMachine = new Map<number, typeof rows[0]>();
    for (const row of rows) {
      if (!latestByMachine.has(row.machineId)) latestByMachine.set(row.machineId, row);
    }
    const oeeData = Array.from(latestByMachine.values()).map(r => ({
      machineId: r.machineId,
      machineCode: r.machineCode,
      // oeeMetrics stores as percentage×100 (e.g. 85.5% → 8550); convert back to 0-100
      availability: Number(r.availability) / 100,
      performance: Number(r.performance) / 100,
      quality: Number(r.quality) / 100,
      oee: Number(r.oee) / 100,
      timestamp: r.timestamp,
    }));

    // Calculate averages
    const avgAvailability = oeeData.length > 0
      ? oeeData.reduce((sum, m) => sum + m.availability, 0) / oeeData.length : 0;
    const avgPerformance = oeeData.length > 0
      ? oeeData.reduce((sum, m) => sum + m.performance, 0) / oeeData.length : 0;
    const avgQuality = oeeData.length > 0
      ? oeeData.reduce((sum, m) => sum + m.quality, 0) / oeeData.length : 0;
    const avgOEE = oeeData.length > 0
      ? oeeData.reduce((sum, m) => sum + m.oee, 0) / oeeData.length : 0;

    // Downtime summary from persisted downtimeEvents table
    const dtRows = conn ? await conn
      .select({
        category: downtimeEvents.category,
        duration: downtimeEvents.duration,
      })
      .from(downtimeEvents)
      .where(and(gte(downtimeEvents.startTime, start), lte(downtimeEvents.startTime, end))) : [];

    const downtimeByCategory: Record<string, number> = {};
    let totalDowntime = 0;
    for (const d of dtRows) {
      if (d.duration) {
        downtimeByCategory[d.category] = (downtimeByCategory[d.category] || 0) + d.duration;
        totalDowntime += d.duration;
      }
    }

    // Get machines needing attention (OEE < 80%)
    const machinesNeedingAttention = oeeData
      .filter(m => m.oee < 80)
      .sort((a, b) => a.oee - b.oee)
      .slice(0, 5);
    
    return {
      title: `Báo cáo OEE ${this.getReportPeriodLabel(report.frequency)}`,
      period: { start, end },
      summary: {
        totalMachines: oeeData.length,
        avgAvailability: avgAvailability.toFixed(2),
        avgPerformance: avgPerformance.toFixed(2),
        avgQuality: avgQuality.toFixed(2),
        avgOEE: avgOEE.toFixed(2),
        totalDowntime,
      },
      machineOEE: oeeData,
      downtimeByCategory,
      machinesNeedingAttention,
      generatedAt: new Date(),
    };
  }
  
  /**
   * Generate Machine Health Report Content
   */
  async generateMachineHealthReportContent(report: ScheduledReport): Promise<MachineHealthReportContent> {
    const { start, end } = this.getReportPeriod(report.frequency);
    
    // Import health functions. OEE now comes from the canonical single source
    // (oeeService.getAllMachinesOEELive) instead of the retired in-memory socket path.
    const { getMachineHealthScore } = await import('../_core/socket');
    const { getAllMachinesOEELive } = await import('./oeeService');

    // Get all OEE metrics and calculate health scores (live values may be null when
    // a machine lacks uptime/production data → coalesce to 0 for the rollup).
    const allOEE = (await getAllMachinesOEELive()).map(m => ({
      machineId: m.machineId,
      machineCode: m.machineCode,
      oee: m.oee ?? 0,
      availability: m.availability ?? 0,
      quality: m.quality ?? 0,
    }));
    const healthData: Array<{
      machineId: number;
      machineCode: string;
      healthScore: number;
      oee: number;
      status: 'healthy' | 'warning' | 'critical';
    }> = [];
    
    for (const metrics of allOEE) {
      const health = getMachineHealthScore(metrics.machineId);
      const score = health?.score || metrics.oee * 0.8 + metrics.availability * 0.1 + metrics.quality * 0.1;
      
      healthData.push({
        machineId: metrics.machineId,
        machineCode: metrics.machineCode,
        healthScore: score,
        oee: metrics.oee,
        status: score >= 80 ? 'healthy' : score >= 60 ? 'warning' : 'critical',
      });
    }
    
    // Count by status
    const healthyCount = healthData.filter(m => m.status === 'healthy').length;
    const warningCount = healthData.filter(m => m.status === 'warning').length;
    const criticalCount = healthData.filter(m => m.status === 'critical').length;
    
    // Machines needing maintenance
    const machinesNeedingMaintenance = healthData
      .filter(m => m.status === 'critical' || m.status === 'warning')
      .sort((a, b) => a.healthScore - b.healthScore);
    
    return {
      title: `Báo cáo Sức khỏe Máy ${this.getReportPeriodLabel(report.frequency)}`,
      period: { start, end },
      summary: {
        totalMachines: healthData.length,
        healthyCount,
        warningCount,
        criticalCount,
        avgHealthScore: healthData.length > 0 
          ? (healthData.reduce((sum, m) => sum + m.healthScore, 0) / healthData.length).toFixed(2)
          : '0',
      },
      machineHealth: healthData,
      machinesNeedingMaintenance,
      generatedAt: new Date(),
    };
  }
  
  /**
   * Format OEE Report as HTML
   */
  async formatOEEReportHtml(content: OEEReportContent, templateConfig?: EmailTemplateConfig | null): Promise<string> {
    if (!templateConfig) {
      templateConfig = await db.getDefaultEmailTemplateConfig();
    }
    
    const primaryColor = templateConfig?.primaryColor || '#2563eb';
    const secondaryColor = templateConfig?.secondaryColor || '#1e40af';
    const backgroundColor = templateConfig?.backgroundColor || '#f0f9ff';
    const companyName = templateConfig?.companyName || 'AVI/AOI Factory Management System';
    const logoUrl = templateConfig?.logoUrl;
    const footerText = templateConfig?.footerText || 'Báo cáo được tạo tự động bởi hệ thống';
    
    const formatDate = (date: Date) => date.toLocaleDateString('vi-VN');
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid ${primaryColor}; }
    .logo { max-height: 60px; margin-bottom: 10px; }
    h1 { color: ${primaryColor}; }
    h2 { color: ${secondaryColor}; margin-top: 30px; }
    .summary { background: ${backgroundColor}; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
    .stat-card { background: white; padding: 15px; border-radius: 6px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 24px; font-weight: bold; color: ${primaryColor}; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: ${backgroundColor}; font-weight: 600; color: ${secondaryColor}; }
    .oee-high { color: #16a34a; }
    .oee-medium { color: #ca8a04; }
    .oee-low { color: #dc2626; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" class="logo" />` : ''}
    <h1>${content.title}</h1>
    <p>Giai đoạn: ${formatDate(content.period.start)} - ${formatDate(content.period.end)}</p>
  </div>
  
  <h2>Tổng quan OEE</h2>
  <div class="summary">
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-value">${content.summary.avgOEE}%</div>
        <div class="stat-label">OEE Trung bình</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${content.summary.avgAvailability}%</div>
        <div class="stat-label">Availability</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${content.summary.avgPerformance}%</div>
        <div class="stat-label">Performance</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${content.summary.avgQuality}%</div>
        <div class="stat-label">Quality</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${content.summary.totalMachines}</div>
        <div class="stat-label">Tổng số máy</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${content.summary.totalDowntime} phút</div>
        <div class="stat-label">Tổng Downtime</div>
      </div>
    </div>
  </div>
  
  ${content.machinesNeedingAttention.length > 0 ? `
  <h2>Máy cần chú ý (OEE < 80%)</h2>
  <table>
    <thead>
      <tr>
        <th>Máy</th>
        <th>OEE</th>
        <th>Availability</th>
        <th>Performance</th>
        <th>Quality</th>
      </tr>
    </thead>
    <tbody>
      ${content.machinesNeedingAttention.map(m => `
      <tr>
        <td>${m.machineCode}</td>
        <td class="${m.oee >= 70 ? 'oee-medium' : 'oee-low'}">${m.oee.toFixed(1)}%</td>
        <td>${m.availability.toFixed(1)}%</td>
        <td>${m.performance.toFixed(1)}%</td>
        <td>${m.quality.toFixed(1)}%</td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  ` : ''}
  
  <h2>Thống kê Downtime theo loại</h2>
  <table>
    <thead>
      <tr>
        <th>Loại</th>
        <th>Thời gian (phút)</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(content.downtimeByCategory).map(([category, duration]) => `
      <tr>
        <td>${category === 'planned' ? 'Kế hoạch' : 
             category === 'unplanned' ? 'Ngoài kế hoạch' :
             category === 'breakdown' ? 'Hỏng hóc' :
             category === 'changeover' ? 'Đổi sản phẩm' :
             category === 'maintenance' ? 'Bảo trì' : 'Khác'}</td>
        <td>${duration}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  
  <div class="footer">
    <p>${footerText}</p>
    <p>Thời gian tạo: ${content.generatedAt.toLocaleString('vi-VN')}</p>
  </div>
</body>
</html>
    `;
  }
  
  /**
   * Format Machine Health Report as HTML
   */
  async formatMachineHealthReportHtml(content: MachineHealthReportContent, templateConfig?: EmailTemplateConfig | null): Promise<string> {
    if (!templateConfig) {
      templateConfig = await db.getDefaultEmailTemplateConfig();
    }
    
    const primaryColor = templateConfig?.primaryColor || '#2563eb';
    const secondaryColor = templateConfig?.secondaryColor || '#1e40af';
    const backgroundColor = templateConfig?.backgroundColor || '#f0f9ff';
    const companyName = templateConfig?.companyName || 'AVI/AOI Factory Management System';
    const logoUrl = templateConfig?.logoUrl;
    const footerText = templateConfig?.footerText || 'Báo cáo được tạo tự động bởi hệ thống';
    
    const formatDate = (date: Date) => date.toLocaleDateString('vi-VN');
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid ${primaryColor}; }
    .logo { max-height: 60px; margin-bottom: 10px; }
    h1 { color: ${primaryColor}; }
    h2 { color: ${secondaryColor}; margin-top: 30px; }
    .summary { background: ${backgroundColor}; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
    .stat-card { background: white; padding: 15px; border-radius: 6px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 24px; font-weight: bold; }
    .stat-value.healthy { color: #16a34a; }
    .stat-value.warning { color: #ca8a04; }
    .stat-value.critical { color: #dc2626; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: ${backgroundColor}; font-weight: 600; color: ${secondaryColor}; }
    .status-healthy { color: #16a34a; font-weight: bold; }
    .status-warning { color: #ca8a04; font-weight: bold; }
    .status-critical { color: #dc2626; font-weight: bold; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" class="logo" />` : ''}
    <h1>${content.title}</h1>
    <p>Giai đoạn: ${formatDate(content.period.start)} - ${formatDate(content.period.end)}</p>
  </div>
  
  <h2>Tổng quan Sức khỏe Máy</h2>
  <div class="summary">
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-value">${content.summary.avgHealthScore}%</div>
        <div class="stat-label">Health Score TB</div>
      </div>
      <div class="stat-card">
        <div class="stat-value healthy">${content.summary.healthyCount}</div>
        <div class="stat-label">Khỏe mạnh</div>
      </div>
      <div class="stat-card">
        <div class="stat-value warning">${content.summary.warningCount}</div>
        <div class="stat-label">Cần chú ý</div>
      </div>
      <div class="stat-card">
        <div class="stat-value critical">${content.summary.criticalCount}</div>
        <div class="stat-label">Cần bảo trì</div>
      </div>
    </div>
  </div>
  
  ${content.machinesNeedingMaintenance.length > 0 ? `
  <h2>Máy cần bảo trì</h2>
  <table>
    <thead>
      <tr>
        <th>Máy</th>
        <th>Health Score</th>
        <th>OEE</th>
        <th>Trạng thái</th>
      </tr>
    </thead>
    <tbody>
      ${content.machinesNeedingMaintenance.map(m => `
      <tr>
        <td>${m.machineCode}</td>
        <td>${m.healthScore.toFixed(1)}%</td>
        <td>${m.oee.toFixed(1)}%</td>
        <td class="status-${m.status}">${m.status === 'healthy' ? 'Khỏe mạnh' : m.status === 'warning' ? 'Cần chú ý' : 'Cần bảo trì'}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  ` : `
  <p style="text-align: center; color: #16a34a; font-weight: bold;">Tất cả máy đều hoạt động tốt!</p>
  `}
  
  <div class="footer">
    <p>${footerText}</p>
    <p>Thời gian tạo: ${content.generatedAt.toLocaleString('vi-VN')}</p>
  </div>
</body>
</html>
    `;
  }
  
  private getReportPeriodLabel(frequency: ReportFrequency): string {
    const periodMap = {
      daily: 'Hàng ngày',
      weekly: 'Hàng tuần',
      monthly: 'Hàng tháng',
    };
    return periodMap[frequency];
  }

  /**
   * Preview report content without sending
   */
  async previewReport(params: {
    frequency: ReportFrequency;
    corporateCode?: string;
    factoryCode?: string;
  }): Promise<{ content: ReportContent; html: string }> {
    const report: ScheduledReport = {
      id: 0,
      name: 'Preview Report',
      type: 'statistics',
      frequency: params.frequency,
      recipients: [],
      corporateCode: params.corporateCode,
      factoryCode: params.factoryCode,
      isEnabled: true,
      createdBy: 0,
      createdAt: new Date(),
    };

    const content = await this.generateReportContent(report);
    const html = await this.formatReportHtml(content);

    return { content, html };
  }
}

// Singleton instance
export const scheduledReportService = new ScheduledReportService();

export default scheduledReportService;
