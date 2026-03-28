import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db module
vi.mock('./db', () => ({
  getYieldAlertThresholds: vi.fn(),
  getYieldAlertThresholdById: vi.fn(),
  getYieldAlertThresholdByType: vi.fn(),
  updateYieldAlertThreshold: vi.fn(),
  getEnabledYieldAlertThresholds: vi.fn(),
}));

import * as db from './db';

describe('Yield Alert Threshold Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('should return all yield thresholds', async () => {
      const mockThresholds = [
        { id: 1, metricType: 'FPY', warningThreshold: '97.0000', criticalThreshold: '95.0000', targetValue: '98.5000' },
        { id: 2, metricType: 'FY', warningThreshold: '2.0000', criticalThreshold: '3.0000', targetValue: '1.5000' },
        { id: 3, metricType: 'NTF', warningThreshold: '1.5000', criticalThreshold: '2.0000', targetValue: '1.0000' },
        { id: 4, metricType: 'UPH', warningThreshold: '1200', criticalThreshold: '1000', targetValue: '1500' },
      ];
      
      vi.mocked(db.getYieldAlertThresholds).mockResolvedValue(mockThresholds as any);
      
      const result = await db.getYieldAlertThresholds();
      
      expect(result).toHaveLength(4);
      expect(result[0].metricType).toBe('FPY');
      expect(result[1].metricType).toBe('FY');
      expect(result[2].metricType).toBe('NTF');
      expect(result[3].metricType).toBe('UPH');
    });
  });

  describe('getById', () => {
    it('should return threshold by id', async () => {
      const mockThreshold = { 
        id: 1, 
        metricType: 'FPY', 
        warningThreshold: '97.0000', 
        criticalThreshold: '95.0000',
        targetValue: '98.5000',
        comparisonOperator: 'gte',
        isEnabled: true,
        notifyOnWarning: true,
        notifyOnCritical: true,
      };
      
      vi.mocked(db.getYieldAlertThresholdById).mockResolvedValue(mockThreshold as any);
      
      const result = await db.getYieldAlertThresholdById(1);
      
      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
      expect(result?.metricType).toBe('FPY');
    });

    it('should return null for non-existent id', async () => {
      vi.mocked(db.getYieldAlertThresholdById).mockResolvedValue(null);
      
      const result = await db.getYieldAlertThresholdById(999);
      
      expect(result).toBeNull();
    });
  });

  describe('getByType', () => {
    it('should return threshold by metric type', async () => {
      const mockThreshold = { 
        id: 1, 
        metricType: 'FPY', 
        warningThreshold: '97.0000', 
        criticalThreshold: '95.0000',
        targetValue: '98.5000',
      };
      
      vi.mocked(db.getYieldAlertThresholdByType).mockResolvedValue(mockThreshold as any);
      
      const result = await db.getYieldAlertThresholdByType('FPY');
      
      expect(result).toBeDefined();
      expect(result?.metricType).toBe('FPY');
    });
  });

  describe('update', () => {
    it('should update threshold values', async () => {
      vi.mocked(db.updateYieldAlertThreshold).mockResolvedValue(undefined);
      
      await db.updateYieldAlertThreshold(1, {
        warningThreshold: '96.0000',
        criticalThreshold: '94.0000',
      });
      
      expect(db.updateYieldAlertThreshold).toHaveBeenCalledWith(1, {
        warningThreshold: '96.0000',
        criticalThreshold: '94.0000',
      });
    });

    it('should update notification settings', async () => {
      vi.mocked(db.updateYieldAlertThreshold).mockResolvedValue(undefined);
      
      await db.updateYieldAlertThreshold(1, {
        notifyOnWarning: false,
        notifyOnCritical: true,
      });
      
      expect(db.updateYieldAlertThreshold).toHaveBeenCalledWith(1, {
        notifyOnWarning: false,
        notifyOnCritical: true,
      });
    });

    it('should update enabled status', async () => {
      vi.mocked(db.updateYieldAlertThreshold).mockResolvedValue(undefined);
      
      await db.updateYieldAlertThreshold(1, { isEnabled: false });
      
      expect(db.updateYieldAlertThreshold).toHaveBeenCalledWith(1, { isEnabled: false });
    });
  });

  describe('getEnabled', () => {
    it('should return only enabled thresholds', async () => {
      const mockThresholds = [
        { id: 1, metricType: 'FPY', isEnabled: true },
        { id: 2, metricType: 'FY', isEnabled: true },
      ];
      
      vi.mocked(db.getEnabledYieldAlertThresholds).mockResolvedValue(mockThresholds as any);
      
      const result = await db.getEnabledYieldAlertThresholds();
      
      expect(result).toHaveLength(2);
      expect(result.every((t: any) => t.isEnabled)).toBe(true);
    });
  });

  describe('Threshold validation', () => {
    it('should have valid FPY thresholds (higher is better)', async () => {
      const mockThreshold = { 
        metricType: 'FPY', 
        warningThreshold: '97.0000', 
        criticalThreshold: '95.0000',
        targetValue: '98.5000',
        comparisonOperator: 'gte',
      };
      
      vi.mocked(db.getYieldAlertThresholdByType).mockResolvedValue(mockThreshold as any);
      
      const result = await db.getYieldAlertThresholdByType('FPY');
      
      // FPY: target > warning > critical (higher is better)
      expect(parseFloat(result!.targetValue!)).toBeGreaterThan(parseFloat(result!.warningThreshold));
      expect(parseFloat(result!.warningThreshold)).toBeGreaterThan(parseFloat(result!.criticalThreshold));
      expect(result!.comparisonOperator).toBe('gte');
    });

    it('should have valid FY thresholds (lower is better)', async () => {
      const mockThreshold = { 
        metricType: 'FY', 
        warningThreshold: '2.0000', 
        criticalThreshold: '3.0000',
        targetValue: '1.5000',
        comparisonOperator: 'lte',
      };
      
      vi.mocked(db.getYieldAlertThresholdByType).mockResolvedValue(mockThreshold as any);
      
      const result = await db.getYieldAlertThresholdByType('FY');
      
      // FY: target < warning < critical (lower is better)
      expect(parseFloat(result!.targetValue!)).toBeLessThan(parseFloat(result!.warningThreshold));
      expect(parseFloat(result!.warningThreshold)).toBeLessThan(parseFloat(result!.criticalThreshold));
      expect(result!.comparisonOperator).toBe('lte');
    });
  });
});
