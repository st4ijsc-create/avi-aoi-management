/**
 * Unit Tests - Export Service
 */

import { exportService } from '../../src/services/exportService';
import { Alert } from '../../src/types';

const mockAlerts: Alert[] = [
  {
    id: '1',
    alertId: 'ALT-2026-000001',
    timestamp: '2026-01-17T14:00:00Z',
    receivedAt: '2026-01-17T14:00:01Z',
    station: { id: 'ST-001', name: 'Wire Cutting A1', line: 'Line A', area: 'Area 1' },
    product: { id: 'PRD-001', name: 'Wire Harness X', customer: 'Customer A' },
    error: { code: 'E-CUT-001', type: 'Cutting Error', description: 'Wire length mismatch' },
    severity: 'high',
    status: 'pending',
  },
  {
    id: '2',
    alertId: 'ALT-2026-000002',
    timestamp: '2026-01-17T15:00:00Z',
    receivedAt: '2026-01-17T15:00:01Z',
    station: { id: 'ST-002', name: 'Assembly B1', line: 'Line B', area: 'Area 2' },
    product: { id: 'PRD-002', name: 'Cable Assembly Y', customer: 'Customer B' },
    error: { code: 'E-ASM-001', type: 'Assembly Error', description: 'Component mismatch' },
    severity: 'critical',
    status: 'acknowledged',
    acknowledgedAt: '2026-01-17T15:05:00Z',
  },
  {
    id: '3',
    alertId: 'ALT-2026-000003',
    timestamp: '2026-01-17T16:00:00Z',
    receivedAt: '2026-01-17T16:00:01Z',
    station: { id: 'ST-003', name: 'Packaging C1', line: 'Line C', area: 'Area 3' },
    product: { id: 'PRD-003', name: 'Connector Z', customer: 'Customer C' },
    error: { code: 'E-PKG-001', type: 'Packaging Error', description: 'Label missing' },
    severity: 'low',
    status: 'resolved',
    acknowledgedAt: '2026-01-17T16:02:00Z',
    resolvedAt: '2026-01-17T16:10:00Z',
  },
];

describe('Export Service', () => {
  describe('exportAlerts - JSON format', () => {
    it('should export alerts to valid JSON', async () => {
      // includeResolved: resolved alerts are excluded by default (W6-B: test
      // aligned with actual exportService behaviour — mock #3 is 'resolved')
      const result = await exportService.exportAlerts(mockAlerts, { format: 'json', includeResolved: true });

      expect(() => JSON.parse(result)).not.toThrow();

      const parsed = JSON.parse(result);
      expect(parsed.totalAlerts).toBe(3);
      expect(parsed.alerts).toHaveLength(3);
    });

    it('should include export date', async () => {
      const result = await exportService.exportAlerts(mockAlerts, { format: 'json' });
      const parsed = JSON.parse(result);
      
      expect(parsed.exportDate).toBeDefined();
    });

    it('should include all alert fields', async () => {
      const result = await exportService.exportAlerts(mockAlerts, { format: 'json' });
      const parsed = JSON.parse(result);
      const alert = parsed.alerts[0];
      
      expect(alert.alertId).toBeDefined();
      expect(alert.timestamp).toBeDefined();
      expect(alert.severity).toBeDefined();
      expect(alert.status).toBeDefined();
      expect(alert.station).toBeDefined();
      expect(alert.product).toBeDefined();
      expect(alert.error).toBeDefined();
    });
  });

  describe('exportAlerts - CSV format', () => {
    it('should export alerts to CSV with headers', async () => {
      const result = await exportService.exportAlerts(mockAlerts, { format: 'csv' });
      const lines = result.split('\n');
      
      expect(lines[0]).toContain('Alert ID');
      expect(lines[0]).toContain('Timestamp');
      expect(lines[0]).toContain('Severity');
    });

    it('should have correct number of rows', async () => {
      const result = await exportService.exportAlerts(mockAlerts, { format: 'csv', includeResolved: true });
      const lines = result.split('\n').filter(l => l.trim());

      // 1 header + 3 data rows
      expect(lines).toHaveLength(4);
    });

    it('should escape commas in descriptions', async () => {
      const alertWithComma: Alert[] = [{
        ...mockAlerts[0],
        error: { ...mockAlerts[0].error, description: 'Error with, comma' },
      }];
      
      const result = await exportService.exportAlerts(alertWithComma, { format: 'csv' });
      
      // Description should be quoted
      expect(result).toContain('"Error with, comma"');
    });
  });

  describe('exportAlerts - TXT format', () => {
    it('should export alerts to readable text', async () => {
      const result = await exportService.exportAlerts(mockAlerts, { format: 'txt', includeResolved: true });

      expect(result).toContain('FACTORY ALERT SYSTEM');
      expect(result).toContain('EXPORT REPORT');
      expect(result).toContain('Total Alerts: 3');
    });

    it('should include summary by severity', async () => {
      const result = await exportService.exportAlerts(mockAlerts, { format: 'txt' });
      
      expect(result).toContain('SUMMARY BY SEVERITY');
      expect(result).toContain('Critical:');
      expect(result).toContain('High:');
    });

    it('should include alert details', async () => {
      const result = await exportService.exportAlerts(mockAlerts, { format: 'txt' });
      
      expect(result).toContain('ALT-2026-000001');
      expect(result).toContain('Wire Cutting A1');
      expect(result).toContain('Cutting Error');
    });
  });

  describe('exportAlerts - filtering', () => {
    it('should exclude resolved alerts when includeResolved is false', async () => {
      const result = await exportService.exportAlerts(mockAlerts, {
        format: 'json',
        includeResolved: false,
      });
      
      const parsed = JSON.parse(result);
      expect(parsed.totalAlerts).toBe(2);
      expect(parsed.alerts.every((a: any) => a.status !== 'resolved')).toBe(true);
    });

    it('should include resolved alerts when includeResolved is true', async () => {
      const result = await exportService.exportAlerts(mockAlerts, {
        format: 'json',
        includeResolved: true,
      });
      
      const parsed = JSON.parse(result);
      expect(parsed.totalAlerts).toBe(3);
    });

    it('should filter by date range', async () => {
      const result = await exportService.exportAlerts(mockAlerts, {
        format: 'json',
        dateRange: {
          from: new Date('2026-01-17T14:30:00Z'),
          to: new Date('2026-01-17T15:30:00Z'),
        },
      });
      
      const parsed = JSON.parse(result);
      expect(parsed.totalAlerts).toBe(1);
      expect(parsed.alerts[0].alertId).toBe('ALT-2026-000002');
    });
  });

  describe('generateSummary', () => {
    it('should generate summary with counts', () => {
      const summary = exportService.generateSummary(mockAlerts);
      
      expect(summary).toContain('Total: 3 alerts');
      expect(summary).toContain('Pending: 1');
      expect(summary).toContain('Acknowledged: 1');
      expect(summary).toContain('Resolved: 1');
    });

    it('should include severity breakdown', () => {
      const summary = exportService.generateSummary(mockAlerts);
      
      expect(summary).toContain('Critical: 1');
      expect(summary).toContain('High: 1');
      expect(summary).toContain('Low: 1');
    });

    it('should identify most problematic station', () => {
      const summary = exportService.generateSummary(mockAlerts);
      
      expect(summary).toContain('Most Alerts:');
    });
  });
});
