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
export type ReportType = 'statistics' | 'alerts' | 'comprehensive';

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
   * Get reports that are due to run
   */
  private async getDueReports(): Promise<ScheduledReport[]> {
    // In a real implementation, this would query the database
    // For now, return empty array - reports are configured via UI
    return [];
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

    // Also notify owner
    await notifyOwner({
      title: `Báo cáo tự động: ${report.name}`,
      content: `Đã gửi báo cáo ${report.frequency} đến ${report.recipients.length} người nhận.\nTổng kiểm tra: ${content.summary.totalInspections}\nYield Rate: ${content.summary.yieldRate}%`,
    });

    console.log(`[ScheduledReport] Report sent to ${report.recipients.length} recipients`);
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
