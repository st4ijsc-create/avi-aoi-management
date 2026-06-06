/**
 * Enhanced Scheduled Report Service
 * 
 * Extends the existing scheduled report system with:
 * - Quality Report (with PDF template)
 * - Comparison Report (period-over-period)
 * - PowerPoint format attachment
 * - Advanced scheduling with cron expressions
 * - Report batching (send multiple reports in one email)
 */

import * as db from '../db';
import { getDb } from '../db/connection';
import { sql } from 'drizzle-orm';
import { sendEmail } from '../_core/email';
import { generateQualityReportPDF, type QualityReportData } from './pdfTemplateService';
import { generateComparison, type ComparisonRequest } from './dataComparisonService';
import { exportQualityReportToPowerPoint, exportComparisonToPowerPoint } from './powerpointService';

// ─── Types ──────────────────────────────────────────────────────────────────

export type EnhancedReportType = 
  | 'quality_summary'     // Tổng hợp chất lượng với PDF đẹp
  | 'comparison'          // So sánh giữa các kỳ
  | 'custom_builder'      // Report từ Custom Report Builder
  | 'combined';           // Kết hợp nhiều loại

export type AttachmentFormat = 'pdf' | 'excel' | 'pptx' | 'html';

export interface EnhancedScheduleConfig {
  reportId?: number;
  name: string;
  type: EnhancedReportType;
  frequency: 'daily' | 'weekly' | 'monthly';
  scheduleTime: string; // HH:mm
  scheduleDayOfWeek?: number; // 0-6
  scheduleDayOfMonth?: number; // 1-31
  recipients: string[];
  
  // Filters
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  
  // Report-specific config
  comparisonType?: 'week' | 'month' | 'quarter';
  customReportId?: number; // ID from report builder
  
  // Output format
  attachmentFormats: AttachmentFormat[];
  includeInlineHtml: boolean;
  
  // Styling
  companyName?: string;
  logoUrl?: string;
  primaryColor?: string;
}

export interface ScheduledReportResult {
  success: boolean;
  reportName: string;
  recipientCount: number;
  attachments: string[];
  error?: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * Generate and send an enhanced scheduled report
 */
export async function executeEnhancedReport(
  config: EnhancedScheduleConfig
): Promise<ScheduledReportResult> {
  try {
    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
    let htmlBody = '';

    const dateStr = new Date().toISOString().split('T')[0];
    const { start, end } = getReportPeriod(config.frequency);

    switch (config.type) {
      case 'quality_summary':
        const qualityResult = await generateQualitySummary(config, start, end);
        htmlBody = qualityResult.html;
        if (config.attachmentFormats.includes('pdf')) {
          attachments.push({
            filename: `Quality_Report_${dateStr}.pdf`,
            content: qualityResult.pdfBuffer,
            contentType: 'application/pdf',
          });
        }
        if (config.attachmentFormats.includes('pptx')) {
          attachments.push({
            filename: `Quality_Report_${dateStr}.pptx`,
            content: qualityResult.pptxBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          });
        }
        break;

      case 'comparison':
        const compResult = await generateComparisonReport(config, start, end);
        htmlBody = compResult.html;
        if (config.attachmentFormats.includes('pdf')) {
          attachments.push({
            filename: `Comparison_Report_${dateStr}.pdf`,
            content: compResult.pdfBuffer,
            contentType: 'application/pdf',
          });
        }
        if (config.attachmentFormats.includes('pptx')) {
          attachments.push({
            filename: `Comparison_Report_${dateStr}.pptx`,
            content: compResult.pptxBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          });
        }
        break;

      case 'custom_builder':
        const customResult = await generateCustomBuilderReport(config, start, end);
        htmlBody = customResult.html;
        break;

      case 'combined':
        const combinedResult = await generateCombinedReport(config, start, end);
        htmlBody = combinedResult.html;
        attachments.push(...combinedResult.attachments);
        break;
    }

    // Send email
    const smtpConfig = await db.getSmtpConfig();
    if (!smtpConfig) {
      return {
        success: false,
        reportName: config.name,
        recipientCount: 0,
        attachments: [],
        error: 'SMTP not configured',
      };
    }

    const { createTransporterFromConfig } = await import('../_core/email');
    const transporter = createTransporterFromConfig(smtpConfig);

    for (const email of config.recipients) {
      await transporter.sendMail({
        from: `${smtpConfig.fromName} <${smtpConfig.fromEmail}>`,
        to: email,
        subject: `[AVI/AOI] ${config.name} - ${dateStr}`,
        html: config.includeInlineHtml ? htmlBody : getMinimalHtml(config.name, attachments.length),
        attachments: attachments.map(a => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
    }

    return {
      success: true,
      reportName: config.name,
      recipientCount: config.recipients.length,
      attachments: attachments.map(a => a.filename),
    };
  } catch (error: any) {
    return {
      success: false,
      reportName: config.name,
      recipientCount: 0,
      attachments: [],
      error: error.message,
    };
  }
}

// ─── Report Generators ──────────────────────────────────────────────────────

async function generateQualitySummary(
  config: EnhancedScheduleConfig,
  start: Date,
  end: Date
): Promise<{ html: string; pdfBuffer: Buffer; pptxBuffer: Buffer }> {
  // Gather data
  const [stats, ngTrend, topNG, machines] = await Promise.all([
    db.getDashboardStats({
      startDate: start,
      endDate: end,
      factoryId: config.factoryId,
      workshopId: config.workshopId,
    }),
    db.getNGTrendByDay({ startDate: start, endDate: end }),
    db.getTopNGMeasurementPoints({ startDate: start, endDate: end, limit: 10 }),
    db.getTopBottomMachines({
      startDate: start,
      endDate: end,
      factoryId: config.factoryId,
      workshopId: config.workshopId,
    } as any),
  ]);

  const s = stats as any;
  const qualityData: QualityReportData = {
    period: { start, end },
    summary: {
      totalInspections: s.totalInspections || 0,
      okCount: s.okCount || 0,
      ngCount: s.ngCount || 0,
      ntfCount: s.ntfCount || 0,
      yieldRate: s.yieldRate || 0,
      ngRate: s.ngRate || (s.totalInspections ? (s.ngCount / s.totalInspections) * 100 : 0),
    },
    byMachine: ((machines as any)?.topMachines || (machines as any)?.top || []).map((m: any) => ({
      machineName: m.machineName || m.machineCode,
      machineCode: m.machineCode || '',
      totalInspections: m.totalInspections || 0,
      okCount: m.okCount || 0,
      ngCount: m.ngCount || 0,
      yieldRate: m.yieldRate || 0,
    })),
    topNGPoints: (topNG as any[]).map((p: any) => ({
      pointName: p.pointName || p.measurementPointName,
      ngCount: p.ngCount || p.count,
      percentage: p.percentage || 0,
    })),
    dailyTrend: (ngTrend as any[]).map((d: any) => ({
      date: d.date,
      totalInspections: d.total || d.totalInspections || 0,
      okCount: d.okCount || 0,
      ngCount: d.ngCount || 0,
      yieldRate: d.yieldRate || 0,
    })),
  };

  // Generate PDF
  const pdfBuffer = await generateQualityReportPDF(qualityData, {
    title: 'Báo cáo Chất lượng',
    companyName: config.companyName || 'AVI/AOI Management',
    primaryColor: config.primaryColor || '#2563eb',
    logoUrl: config.logoUrl,
  });

  // Generate PPTX
  const pptxBuffer = await exportQualityReportToPowerPoint(qualityData, {
    title: 'Báo cáo Chất lượng',
    companyName: config.companyName || 'AVI/AOI Management',
    primaryColor: config.primaryColor || '#2563eb',
  });

  // Generate inline HTML summary
  const html = generateQualityHtmlEmail(qualityData, config);

  return { html, pdfBuffer, pptxBuffer };
}

async function generateComparisonReport(
  config: EnhancedScheduleConfig,
  start: Date,
  end: Date
): Promise<{ html: string; pdfBuffer: Buffer; pptxBuffer: Buffer }> {
  const comparisonType = config.comparisonType || 'week';
  
  const comparison = await generateComparison({
    periodType: comparisonType,
    currentStart: start,
    currentEnd: end,
    factoryId: config.factoryId,
    workshopId: config.workshopId,
    lineId: config.lineId,
  });

  // Generate PDF using PDFKit
  // @ts-ignore - pdfkit has no bundled type declarations
  const PDFDocument = (await import('pdfkit')).default;
  const pdfBuffer = await new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    // Title
    doc.fontSize(18).fillColor('#2563eb').text(`Báo cáo So sánh ${comparisonType === 'week' ? 'Tuần' : comparisonType === 'month' ? 'Tháng' : 'Quý'}`, { align: 'center' });
    doc.moveDown();

    // Current period
    doc.fontSize(12).fillColor('#333');
    const cs = comparison.currentPeriod.summary;
    doc.text(`Kỳ hiện tại: ${cs.totalInspections.toLocaleString('vi-VN')} kiểm tra, Yield: ${cs.yieldRate.toFixed(2)}%`);
    
    // Previous period
    const ps = comparison.previousPeriod.summary;
    doc.text(`Kỳ trước: ${ps.totalInspections.toLocaleString('vi-VN')} kiểm tra, Yield: ${ps.yieldRate.toFixed(2)}%`);
    doc.moveDown();

    // Changes
    const changes = comparison.changes;
    doc.fontSize(14).fillColor('#1e40af').text('Thay đổi:');
    doc.fontSize(11).fillColor('#333');
    doc.text(`  Tổng kiểm tra: ${changes.totalInspections.percent > 0 ? '+' : ''}${changes.totalInspections.percent.toFixed(1)}%`);
    doc.text(`  Yield Rate: ${changes.yieldRate.value > 0 ? '+' : ''}${changes.yieldRate.value.toFixed(2)}pp`);
    doc.text(`  NG Count: ${changes.ngCount.percent > 0 ? '+' : ''}${changes.ngCount.percent.toFixed(1)}%`);

    doc.end();
  });

  // Generate PPTX
  const pptxBuffer = await exportComparisonToPowerPoint(comparison, {
    title: 'Báo cáo So sánh',
    companyName: config.companyName || 'AVI/AOI Management',
    primaryColor: config.primaryColor || '#2563eb',
  });

  // HTML email
  const html = generateComparisonHtmlEmail(comparison, config);

  return { html, pdfBuffer, pptxBuffer };
}

async function generateCustomBuilderReport(
  config: EnhancedScheduleConfig,
  start: Date,
  end: Date
): Promise<{ html: string }> {
  if (!config.customReportId) {
    return { html: '<p>No custom report configured</p>' };
  }

  const conn = await getDb();
  if (!conn) return { html: '<p>Database unavailable</p>' };

  const result: any = await conn.execute(sql`
    SELECT * FROM report_templates WHERE id = ${config.customReportId}
  `);
  const rows = result.rows || result;
  const template = rows[0];

  if (!template) {
    return { html: '<p>Custom report template not found</p>' };
  }

  const sections = template.sections as any;
  const widgets = sections?.widgets || [];

  // Generate data for each widget
  const widgetDataMap: Record<string, any> = {};
  for (const widget of widgets) {
    try {
      switch (widget.type) {
        case 'kpi_card': {
          const stats = await db.getDashboardStats({ startDate: start, endDate: end, factoryId: config.factoryId });
          widgetDataMap[widget.id] = stats;
          break;
        }
        case 'yield_trend':
        case 'line_chart': {
          const trend = await db.getNGTrendByDay({ startDate: start, endDate: end });
          widgetDataMap[widget.id] = trend;
          break;
        }
        case 'ng_analysis':
        case 'bar_chart': {
          const ng = await db.getTopNGMeasurementPoints({ startDate: start, endDate: end, limit: 10 });
          widgetDataMap[widget.id] = ng;
          break;
        }
        case 'machine_comparison': {
          const machines = await db.getTopBottomMachines({ startDate: start, endDate: end, factoryId: config.factoryId } as any);
          widgetDataMap[widget.id] = machines;
          break;
        }
      }
    } catch {
      widgetDataMap[widget.id] = null;
    }
  }

  // Generate HTML from widgets
  const html = generateCustomReportHtml(template.name, widgets, widgetDataMap, config);
  return { html };
}

async function generateCombinedReport(
  config: EnhancedScheduleConfig,
  start: Date,
  end: Date
): Promise<{ html: string; attachments: Array<{ filename: string; content: Buffer; contentType: string }> }> {
  const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  const dateStr = new Date().toISOString().split('T')[0];
  const htmlParts: string[] = [];

  // Quality summary
  try {
    const quality = await generateQualitySummary(config, start, end);
    htmlParts.push('<h2>Tổng hợp Chất lượng</h2>');
    htmlParts.push(quality.html);
    if (config.attachmentFormats.includes('pdf')) {
      attachments.push({
        filename: `Quality_Summary_${dateStr}.pdf`,
        content: quality.pdfBuffer,
        contentType: 'application/pdf',
      });
    }
  } catch { /* skip */ }

  // Comparison
  try {
    const comparison = await generateComparisonReport(config, start, end);
    htmlParts.push('<h2>So sánh với Kỳ trước</h2>');
    htmlParts.push(comparison.html);
    if (config.attachmentFormats.includes('pdf')) {
      attachments.push({
        filename: `Comparison_Report_${dateStr}.pdf`,
        content: comparison.pdfBuffer,
        contentType: 'application/pdf',
      });
    }
  } catch { /* skip */ }

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><style>
      body { font-family: Arial; max-width: 800px; margin: auto; padding: 20px; }
      h1 { color: ${config.primaryColor || '#2563eb'}; }
    </style></head>
    <body>
      <h1>Báo cáo Tổng hợp - ${config.name}</h1>
      ${htmlParts.join('\n<hr/>\n')}
    </body>
    </html>
  `;

  return { html, attachments };
}

// ─── HTML Email Generators ──────────────────────────────────────────────────

function generateQualityHtmlEmail(data: QualityReportData, config: EnhancedScheduleConfig): string {
  const pc = config.primaryColor || '#2563eb';
  const formatNum = (n: number) => n.toLocaleString('vi-VN');

  return `
    <div style="font-family:Arial;max-width:700px;margin:auto;">
      <div style="background:${pc};color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
        <h2 style="margin:0;">Báo cáo Chất lượng</h2>
        <p style="margin:5px 0 0;">${data.period.start.toLocaleDateString('vi-VN')} - ${data.period.end.toLocaleDateString('vi-VN')}</p>
      </div>
      <div style="background:#f8fafc;padding:20px;border-radius:0 0 8px 8px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">
          <div style="flex:1;min-width:120px;background:white;padding:15px;border-radius:6px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <div style="font-size:24px;font-weight:bold;color:${pc};">${formatNum(data.summary.totalInspections)}</div>
            <div style="font-size:11px;color:#666;">Tổng kiểm tra</div>
          </div>
          <div style="flex:1;min-width:120px;background:white;padding:15px;border-radius:6px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <div style="font-size:24px;font-weight:bold;color:${data.summary.yieldRate >= 95 ? '#16a34a' : data.summary.yieldRate >= 85 ? '#ca8a04' : '#dc2626'};">${data.summary.yieldRate.toFixed(2)}%</div>
            <div style="font-size:11px;color:#666;">Yield Rate</div>
          </div>
          <div style="flex:1;min-width:120px;background:white;padding:15px;border-radius:6px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <div style="font-size:24px;font-weight:bold;color:#16a34a;">${formatNum(data.summary.okCount)}</div>
            <div style="font-size:11px;color:#666;">OK</div>
          </div>
          <div style="flex:1;min-width:120px;background:white;padding:15px;border-radius:6px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <div style="font-size:24px;font-weight:bold;color:#dc2626;">${formatNum(data.summary.ngCount)}</div>
            <div style="font-size:11px;color:#666;">NG</div>
          </div>
        </div>

        ${data.topNGPoints.length > 0 ? `
        <h3 style="color:${pc};">Top NG Points</h3>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:6px;overflow:hidden;">
          <thead><tr style="background:${pc};color:white;">
            <th style="padding:8px;text-align:left;">#</th>
            <th style="padding:8px;text-align:left;">Điểm đo</th>
            <th style="padding:8px;text-align:right;">Số NG</th>
          </tr></thead>
          <tbody>
            ${data.topNGPoints.slice(0, 5).map((p, i) => `
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:8px;">${i + 1}</td>
              <td style="padding:8px;">${p.pointName}</td>
              <td style="padding:8px;text-align:right;color:#dc2626;">${formatNum(p.ngCount)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        ` : ''}

        <p style="font-size:11px;color:#999;text-align:center;margin-top:20px;">
          Báo cáo tự động từ ${config.companyName || 'AVI/AOI Management System'}
        </p>
      </div>
    </div>
  `;
}

function generateComparisonHtmlEmail(comparison: any, config: EnhancedScheduleConfig): string {
  const pc = config.primaryColor || '#2563eb';
  const changes = comparison.changes;
  const arrow = (val: number) => val > 0 ? '↑' : val < 0 ? '↓' : '→';
  const color = (val: number, inverse = false) => {
    if (val === 0) return '#666';
    return (inverse ? val < 0 : val > 0) ? '#16a34a' : '#dc2626';
  };

  return `
    <div style="font-family:Arial;max-width:700px;margin:auto;">
      <div style="background:${pc};color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
        <h2 style="margin:0;">Báo cáo So sánh</h2>
      </div>
      <div style="background:#f8fafc;padding:20px;border-radius:0 0 8px 8px;">
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:6px;">
          <thead><tr style="background:#f1f5f9;">
            <th style="padding:10px;text-align:left;">Chỉ số</th>
            <th style="padding:10px;text-align:right;">Kỳ trước</th>
            <th style="padding:10px;text-align:right;">Kỳ này</th>
            <th style="padding:10px;text-align:right;">Thay đổi</th>
          </tr></thead>
          <tbody>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:10px;">Tổng kiểm tra</td>
              <td style="padding:10px;text-align:right;">${comparison.previous.totalInspections.toLocaleString('vi-VN')}</td>
              <td style="padding:10px;text-align:right;">${comparison.current.totalInspections.toLocaleString('vi-VN')}</td>
              <td style="padding:10px;text-align:right;color:${color(changes.totalInspectionsChange)};">
                ${arrow(changes.totalInspectionsChange)} ${Math.abs(changes.totalInspectionsChange).toFixed(1)}%
              </td>
            </tr>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:10px;">Yield Rate</td>
              <td style="padding:10px;text-align:right;">${comparison.previous.yieldRate.toFixed(2)}%</td>
              <td style="padding:10px;text-align:right;">${comparison.current.yieldRate.toFixed(2)}%</td>
              <td style="padding:10px;text-align:right;color:${color(changes.yieldRateChange)};">
                ${arrow(changes.yieldRateChange)} ${Math.abs(changes.yieldRateChange).toFixed(2)}pp
              </td>
            </tr>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:10px;">Số NG</td>
              <td style="padding:10px;text-align:right;">${comparison.previous.ngCount.toLocaleString('vi-VN')}</td>
              <td style="padding:10px;text-align:right;">${comparison.current.ngCount.toLocaleString('vi-VN')}</td>
              <td style="padding:10px;text-align:right;color:${color(changes.ngCountChange, true)};">
                ${arrow(changes.ngCountChange)} ${Math.abs(changes.ngCountChange).toFixed(1)}%
              </td>
            </tr>
          </tbody>
        </table>
        <p style="font-size:11px;color:#999;text-align:center;margin-top:20px;">
          Báo cáo từ ${config.companyName || 'AVI/AOI Management System'}
        </p>
      </div>
    </div>
  `;
}

function generateCustomReportHtml(
  name: string,
  widgets: any[],
  dataMap: Record<string, any>,
  config: EnhancedScheduleConfig
): string {
  const pc = config.primaryColor || '#2563eb';
  
  const widgetHtmlParts = widgets.map(w => {
    const data = dataMap[w.id];
    if (!data) return `<div style="padding:10px;color:#999;">Widget: ${w.title} - No data</div>`;

    switch (w.type) {
      case 'kpi_card':
        return `
          <div style="background:white;padding:15px;border-radius:6px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);min-width:120px;">
            <div style="font-size:20px;font-weight:bold;color:${pc};">${typeof data === 'object' ? JSON.stringify(data[w.config?.metric] || '-') : data}</div>
            <div style="font-size:11px;color:#666;">${w.title}</div>
          </div>`;
      case 'text_block':
        return `<div style="padding:10px;">${w.config?.content || w.title}</div>`;
      case 'divider':
        return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:10px 0;"/>`;
      default:
        return `<div style="padding:10px;background:white;border-radius:6px;margin:5px 0;">
          <strong>${w.title}</strong>
          <p style="font-size:12px;color:#666;">${Array.isArray(data) ? `${data.length} items` : 'Data available'} (xem chi tiết trong file đính kèm)</p>
        </div>`;
    }
  });

  return `
    <div style="font-family:Arial;max-width:700px;margin:auto;">
      <div style="background:${pc};color:white;padding:15px;border-radius:8px 8px 0 0;text-align:center;">
        <h2 style="margin:0;">${name}</h2>
      </div>
      <div style="background:#f8fafc;padding:15px;border-radius:0 0 8px 8px;display:flex;flex-wrap:wrap;gap:10px;">
        ${widgetHtmlParts.join('\n')}
      </div>
    </div>
  `;
}

function getMinimalHtml(reportName: string, attachmentCount: number): string {
  return `
    <div style="font-family:Arial;max-width:500px;margin:auto;text-align:center;padding:40px;">
      <h2>📊 ${reportName}</h2>
      <p>Báo cáo đã được đính kèm trong email (${attachmentCount} file).</p>
      <p style="font-size:12px;color:#666;">Vui lòng tải file đính kèm để xem chi tiết.</p>
    </div>
  `;
}

// ─── Utility ────────────────────────────────────────────────────────────────

function getReportPeriod(frequency: 'daily' | 'weekly' | 'monthly'): { start: Date; end: Date } {
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
 * Register enhanced report types in the scheduled report system
 * This extends the existing scheduledReportRouter with new report types
 */
export async function executeScheduledEnhancedReport(reportId: number): Promise<ScheduledReportResult> {
  const conn = await getDb();
  if (!conn) {
    return { success: false, reportName: '', recipientCount: 0, attachments: [], error: 'DB unavailable' };
  }

  try {
    const result: any = await conn.execute(sql`
      SELECT * FROM scheduled_reports WHERE id = ${reportId}
    `);
    const rows = result.rows || result;
    const report = rows[0];
    if (!report) {
      return { success: false, reportName: '', recipientCount: 0, attachments: [], error: 'Report not found' };
    }

    // Map DB report type to enhanced config
    const typeMap: Record<string, EnhancedReportType> = {
      'QUALITY_SUMMARY': 'quality_summary',
      'COMPARISON': 'comparison',
      'CUSTOM': 'custom_builder',
      'COMBINED': 'combined',
    };

    const config: EnhancedScheduleConfig = {
      reportId: report.id,
      name: report.name,
      type: typeMap[report.reportType] || 'quality_summary',
      frequency: (report.schedule || 'DAILY').toLowerCase() as any,
      scheduleTime: report.scheduleTime || '08:00',
      recipients: report.recipients || [],
      factoryId: report.factoryId ?? undefined,
      workshopId: report.workshopId ?? undefined,
      lineId: report.lineId ?? undefined,
      attachmentFormats: ['pdf'],
      includeInlineHtml: true,
      primaryColor: (report as any).primaryColor,
      logoUrl: (report as any).logoUrl,
      companyName: (report as any).companyName,
    };

    return executeEnhancedReport(config);
  } catch (error: any) {
    return { success: false, reportName: '', recipientCount: 0, attachments: [], error: error.message };
  }
}
