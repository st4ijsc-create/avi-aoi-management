/**
 * Factory Alert System - Export Service
 * Xuất dữ liệu alerts ra file
 */

import { Platform, Share, PermissionsAndroid } from 'react-native';
import { Alert } from '../types';
import { formatDateTime, getSeverityLabel } from '../utils/helpers';

// Export formats
export type ExportFormat = 'json' | 'csv' | 'txt';

interface ExportOptions {
  format: ExportFormat;
  includeResolved?: boolean;
  dateRange?: {
    from: Date;
    to: Date;
  };
}

class ExportService {
  private static instance: ExportService;

  private constructor() {}

  static getInstance(): ExportService {
    if (!ExportService.instance) {
      ExportService.instance = new ExportService();
    }
    return ExportService.instance;
  }

  /**
   * Export alerts to specified format
   */
  async exportAlerts(alerts: Alert[], options: ExportOptions): Promise<string> {
    let filteredAlerts = [...alerts];

    // Filter by resolved status
    if (!options.includeResolved) {
      filteredAlerts = filteredAlerts.filter(a => a.status !== 'resolved');
    }

    // Filter by date range
    if (options.dateRange) {
      filteredAlerts = filteredAlerts.filter(a => {
        const alertDate = new Date(a.timestamp);
        return alertDate >= options.dateRange!.from && alertDate <= options.dateRange!.to;
      });
    }

    // Generate content based on format
    let content: string;
    let filename: string;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    switch (options.format) {
      case 'json':
        content = this.toJSON(filteredAlerts);
        filename = `factory_alerts_${timestamp}.json`;
        break;
      case 'csv':
        content = this.toCSV(filteredAlerts);
        filename = `factory_alerts_${timestamp}.csv`;
        break;
      case 'txt':
      default:
        content = this.toTXT(filteredAlerts);
        filename = `factory_alerts_${timestamp}.txt`;
        break;
    }

    return content;
  }

  /**
   * Share exported data
   */
  async shareExport(alerts: Alert[], options: ExportOptions): Promise<void> {
    try {
      const content = await this.exportAlerts(alerts, options);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      await Share.share({
        message: content,
        title: `Factory Alerts Export - ${timestamp}`,
      });
    } catch (error) {
      console.error('[ExportService] Share error:', error);
      throw error;
    }
  }

  /**
   * Convert alerts to JSON string
   */
  private toJSON(alerts: Alert[]): string {
    const exportData = {
      exportDate: new Date().toISOString(),
      totalAlerts: alerts.length,
      alerts: alerts.map(a => ({
        alertId: a.alertId,
        timestamp: a.timestamp,
        severity: a.severity,
        status: a.status,
        station: {
          id: a.station.id,
          name: a.station.name,
          line: a.station.line,
        },
        product: {
          id: a.product.id,
          name: a.product.name,
        },
        error: {
          code: a.error.code,
          type: a.error.type,
          description: a.error.description,
        },
      })),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Convert alerts to CSV string
   */
  private toCSV(alerts: Alert[]): string {
    const headers = [
      'Alert ID',
      'Timestamp',
      'Severity',
      'Status',
      'Station ID',
      'Station Name',
      'Line',
      'Product ID',
      'Product Name',
      'Error Code',
      'Error Type',
      'Error Description',
    ];

    const rows = alerts.map(a => [
      a.alertId,
      a.timestamp,
      a.severity.toUpperCase(),
      a.status,
      a.station.id,
      `"${a.station.name}"`,
      a.station.line,
      a.product.id,
      `"${a.product.name}"`,
      a.error.code,
      `"${a.error.type}"`,
      `"${a.error.description.replace(/"/g, '""')}"`,
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  /**
   * Convert alerts to readable TXT format
   */
  private toTXT(alerts: Alert[]): string {
    const lines: string[] = [];
    
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('           FACTORY ALERT SYSTEM - EXPORT REPORT');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push(`Export Date: ${formatDateTime(new Date().toISOString())}`);
    lines.push(`Total Alerts: ${alerts.length}`);
    lines.push('');

    // Summary by severity
    const bySeverity = {
      critical: alerts.filter(a => a.severity === 'critical').length,
      high: alerts.filter(a => a.severity === 'high').length,
      medium: alerts.filter(a => a.severity === 'medium').length,
      low: alerts.filter(a => a.severity === 'low').length,
      info: alerts.filter(a => a.severity === 'info').length,
    };

    lines.push('SUMMARY BY SEVERITY:');
    lines.push(`  • Critical: ${bySeverity.critical}`);
    lines.push(`  • High: ${bySeverity.high}`);
    lines.push(`  • Medium: ${bySeverity.medium}`);
    lines.push(`  • Low: ${bySeverity.low}`);
    lines.push(`  • Info: ${bySeverity.info}`);
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('                        ALERT DETAILS');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');

    alerts.forEach((alert, index) => {
      lines.push(`--- Alert ${index + 1} of ${alerts.length} ---`);
      lines.push(`ID: ${alert.alertId}`);
      lines.push(`Time: ${formatDateTime(alert.timestamp)}`);
      lines.push(`Severity: ${alert.severity.toUpperCase()}`);
      lines.push(`Status: ${alert.status}`);
      lines.push('');
      lines.push(`Station: ${alert.station.name} (${alert.station.id})`);
      lines.push(`Line: ${alert.station.line}`);
      lines.push('');
      lines.push(`Product: ${alert.product.name} (${alert.product.id})`);
      lines.push('');
      lines.push(`Error Code: ${alert.error.code}`);
      lines.push(`Error Type: ${alert.error.type}`);
      lines.push(`Description: ${alert.error.description}`);
      lines.push('');
      lines.push('───────────────────────────────────────────────────────────────');
      lines.push('');
    });

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('                      END OF REPORT');
    lines.push('═══════════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Generate summary report
   */
  generateSummary(alerts: Alert[]): string {
    const total = alerts.length;
    const pending = alerts.filter(a => a.status === 'pending').length;
    const acknowledged = alerts.filter(a => a.status === 'acknowledged').length;
    const resolved = alerts.filter(a => a.status === 'resolved').length;

    const bySeverity = {
      critical: alerts.filter(a => a.severity === 'critical').length,
      high: alerts.filter(a => a.severity === 'high').length,
      medium: alerts.filter(a => a.severity === 'medium').length,
      low: alerts.filter(a => a.severity === 'low').length,
      info: alerts.filter(a => a.severity === 'info').length,
    };

    // Group by station
    const byStation: Record<string, number> = {};
    alerts.forEach(a => {
      byStation[a.station.id] = (byStation[a.station.id] || 0) + 1;
    });

    // Find most problematic station
    let maxStation = { id: '', count: 0 };
    Object.entries(byStation).forEach(([id, count]) => {
      if (count > maxStation.count) {
        maxStation = { id, count };
      }
    });

    return `
📊 ALERT SUMMARY
────────────────
Total: ${total} alerts
• Pending: ${pending}
• Acknowledged: ${acknowledged}
• Resolved: ${resolved}

By Severity:
🔴 Critical: ${bySeverity.critical}
🟠 High: ${bySeverity.high}
🟡 Medium: ${bySeverity.medium}
🔵 Low: ${bySeverity.low}
⚫ Info: ${bySeverity.info}

Most Alerts: ${maxStation.id} (${maxStation.count} alerts)
    `.trim();
  }
}

export const exportService = ExportService.getInstance();
export default exportService;
