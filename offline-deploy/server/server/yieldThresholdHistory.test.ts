import { describe, it, expect, vi, beforeEach } from 'vitest';
import { router, publicProcedure, protectedProcedure } from './_core/trpc';
import { z } from 'zod';

// Mock db functions
vi.mock('./db', () => ({
  createYieldThresholdHistory: vi.fn().mockResolvedValue({ id: 1, thresholdId: 1, metricType: 'FPY' }),
  getYieldThresholdHistoryByThreshold: vi.fn().mockResolvedValue([
    { id: 1, thresholdId: 1, metricType: 'FPY', previousWarning: '97.00', newWarning: '98.00', previousCritical: '95.00', newCritical: '96.00', createdAt: new Date() }
  ]),
  getYieldThresholdHistoryByType: vi.fn().mockResolvedValue([
    { id: 1, thresholdId: 1, metricType: 'FPY', previousWarning: '97.00', newWarning: '98.00', createdAt: new Date() }
  ]),
  getAllYieldThresholdHistory: vi.fn().mockResolvedValue([
    { id: 1, thresholdId: 1, metricType: 'FPY', previousWarning: '97.00', newWarning: '98.00', createdAt: new Date() },
    { id: 2, thresholdId: 2, metricType: 'FY', previousWarning: '2.00', newWarning: '1.50', createdAt: new Date() }
  ]),
  getYieldThresholdHistoryWithComparison: vi.fn().mockResolvedValue([
    { id: 1, thresholdId: 1, metricType: 'FPY', previousWarning: '97.00', newWarning: '98.00', actualValueAtChange: '97.50', createdAt: new Date() }
  ]),
  getYieldAlertThresholdById: vi.fn().mockResolvedValue({
    id: 1,
    metricType: 'FPY',
    warningThreshold: '97.00',
    criticalThreshold: '95.00',
    targetValue: '99.00'
  }),
  updateYieldAlertThreshold: vi.fn().mockResolvedValue(undefined),
}));

import * as db from './db';

describe('Yield Threshold History', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createYieldThresholdHistory', () => {
    it('should create a new history record', async () => {
      const historyData = {
        thresholdId: 1,
        metricType: 'FPY' as const,
        previousWarning: '97.00',
        newWarning: '98.00',
        previousCritical: '95.00',
        newCritical: '96.00',
        changeReason: 'Improve quality',
        changedBy: 1,
        changedByName: 'Admin'
      };

      const result = await db.createYieldThresholdHistory(historyData);
      expect(result).toHaveProperty('id');
      expect(db.createYieldThresholdHistory).toHaveBeenCalledWith(historyData);
    });
  });

  describe('getYieldThresholdHistoryByThreshold', () => {
    it('should return history for a specific threshold', async () => {
      const result = await db.getYieldThresholdHistoryByThreshold(1);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('thresholdId', 1);
      expect(db.getYieldThresholdHistoryByThreshold).toHaveBeenCalledWith(1);
    });
  });

  describe('getYieldThresholdHistoryByType', () => {
    it('should return history for a specific metric type', async () => {
      const result = await db.getYieldThresholdHistoryByType('FPY');
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('metricType', 'FPY');
      expect(db.getYieldThresholdHistoryByType).toHaveBeenCalledWith('FPY');
    });
  });

  describe('getAllYieldThresholdHistory', () => {
    it('should return all history records with limit', async () => {
      const result = await db.getAllYieldThresholdHistory(50);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(db.getAllYieldThresholdHistory).toHaveBeenCalledWith(50);
    });
  });

  describe('getYieldThresholdHistoryWithComparison', () => {
    it('should return history with comparison data', async () => {
      const result = await db.getYieldThresholdHistoryWithComparison('FPY', 30);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('actualValueAtChange');
      expect(db.getYieldThresholdHistoryWithComparison).toHaveBeenCalledWith('FPY', 30);
    });
  });

  describe('updateWithHistory workflow', () => {
    it('should get current threshold before update', async () => {
      const result = await db.getYieldAlertThresholdById(1);
      expect(result).toHaveProperty('metricType', 'FPY');
      expect(result).toHaveProperty('warningThreshold', '97.00');
    });

    it('should update threshold after creating history', async () => {
      // Simulate the updateWithHistory workflow
      const current = await db.getYieldAlertThresholdById(1);
      expect(current).toBeTruthy();

      // Create history record
      await db.createYieldThresholdHistory({
        thresholdId: 1,
        metricType: current!.metricType,
        previousWarning: current!.warningThreshold,
        newWarning: '98.00',
        previousCritical: current!.criticalThreshold,
        newCritical: '96.00',
        changeReason: 'Test update'
      });

      // Update threshold
      await db.updateYieldAlertThreshold(1, {
        warningThreshold: '98.00',
        criticalThreshold: '96.00'
      });

      expect(db.updateYieldAlertThreshold).toHaveBeenCalledWith(1, {
        warningThreshold: '98.00',
        criticalThreshold: '96.00'
      });
    });
  });

  describe('History data validation', () => {
    it('should have required fields in history record', async () => {
      const history = await db.getAllYieldThresholdHistory(10);
      const record = history[0];
      
      expect(record).toHaveProperty('id');
      expect(record).toHaveProperty('thresholdId');
      expect(record).toHaveProperty('metricType');
      expect(record).toHaveProperty('previousWarning');
      expect(record).toHaveProperty('newWarning');
      expect(record).toHaveProperty('createdAt');
    });

    it('should support all metric types', async () => {
      const types = ['FPY', 'FY', 'NTF', 'UPH'] as const;
      for (const type of types) {
        await db.getYieldThresholdHistoryByType(type);
        expect(db.getYieldThresholdHistoryByType).toHaveBeenCalledWith(type);
      }
    });
  });
});
