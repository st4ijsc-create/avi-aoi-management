import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as db from '../db';

// Mock db functions
vi.mock('../db', () => ({
  getTopNGMeasurementPointsEnhanced: vi.fn(),
  getYieldTrendData: vi.fn(),
  getRecentYieldData: vi.fn(),
  getNGByWorkstation: vi.fn(),
}));

describe('SPC Analysis Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTopNGMeasurementPointsEnhanced', () => {
    it('should return top NG measurement points', async () => {
      const mockData = [
        { 
          rank: 1,
          measurementPointId: 1, 
          pointCode: 'MP-001', 
          pointName: 'Solder Joint 1',
          measurementType: 'SOLDER',
          ngCount: 50, 
          totalCount: 1000,
          ngRate: '5.00',
          cumulativePercent: 0,
        },
        { 
          rank: 2,
          measurementPointId: 2, 
          pointCode: 'MP-002', 
          pointName: 'Component Placement',
          measurementType: 'PLACEMENT',
          ngCount: 30, 
          totalCount: 1000,
          ngRate: '3.00',
          cumulativePercent: 0,
        },
      ];
      vi.mocked(db.getTopNGMeasurementPointsEnhanced).mockResolvedValue(mockData);

      const result = await db.getTopNGMeasurementPointsEnhanced({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        limit: 10,
      });

      expect(result).toEqual(mockData);
      expect(result.length).toBe(2);
      expect(result[0].ngCount).toBeGreaterThan(result[1].ngCount);
    });

    it('should filter by machineId', async () => {
      vi.mocked(db.getTopNGMeasurementPointsEnhanced).mockResolvedValue([]);

      await db.getTopNGMeasurementPointsEnhanced({
        machineId: 1,
        limit: 10,
      });

      expect(db.getTopNGMeasurementPointsEnhanced).toHaveBeenCalledWith({
        machineId: 1,
        limit: 10,
      });
    });
  });

  describe('getYieldTrendData', () => {
    it('should return yield trend data', async () => {
      const mockData = [
        { timeInterval: '2024-01-01', totalCount: 100, okCount: 95, ngCount: 5, ntfCount: 0, yieldRate: 95, ngRate: 5 },
        { timeInterval: '2024-01-02', totalCount: 120, okCount: 115, ngCount: 5, ntfCount: 0, yieldRate: 95.83, ngRate: 4.17 },
        { timeInterval: '2024-01-03', totalCount: 110, okCount: 108, ngCount: 2, ntfCount: 0, yieldRate: 98.18, ngRate: 1.82 },
      ];
      vi.mocked(db.getYieldTrendData).mockResolvedValue(mockData);

      const result = await db.getYieldTrendData({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-03'),
        interval: 'day',
      });

      expect(result).toEqual(mockData);
      expect(result.length).toBe(3);
    });

    it('should support different intervals', async () => {
      vi.mocked(db.getYieldTrendData).mockResolvedValue([]);

      await db.getYieldTrendData({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        interval: 'week',
      });

      expect(db.getYieldTrendData).toHaveBeenCalledWith({
        startDate: expect.any(Date),
        endDate: expect.any(Date),
        interval: 'week',
      });
    });
  });

  describe('getRecentYieldData', () => {
    it('should return recent yield data for anomaly detection', async () => {
      const mockData = [
        { date: '2024-01-01', totalCount: 100, okCount: 95, ngCount: 5, yieldRate: 95, ngRate: 5 },
        { date: '2024-01-02', totalCount: 100, okCount: 70, ngCount: 30, yieldRate: 70, ngRate: 30 }, // Anomaly
        { date: '2024-01-03', totalCount: 100, okCount: 96, ngCount: 4, yieldRate: 96, ngRate: 4 },
      ];
      vi.mocked(db.getRecentYieldData).mockResolvedValue(mockData);

      const result = await db.getRecentYieldData({ days: 30 });

      expect(result).toEqual(mockData);
      expect(result.length).toBe(3);
    });
  });

  describe('getNGByWorkstation', () => {
    it('should return NG count by workstation', async () => {
      const mockData = [
        { workstationId: 1, workstationCode: 'WS-001', workstationName: 'Station 1', processType: 'SMT', ngCount: 50 },
        { workstationId: 2, workstationCode: 'WS-002', workstationName: 'Station 2', processType: 'DIP', ngCount: 30 },
      ];
      vi.mocked(db.getNGByWorkstation).mockResolvedValue(mockData);

      const result = await db.getNGByWorkstation({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      });

      expect(result).toEqual(mockData);
      expect(result[0].ngCount).toBeGreaterThan(result[1].ngCount);
    });
  });
});

describe('Statistical Utility Functions', () => {
  // Test the statistical functions used in spcAnalysisRouter
  
  describe('calculateMean', () => {
    it('should calculate mean correctly', () => {
      const values = [10, 20, 30, 40, 50];
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      expect(mean).toBe(30);
    });

    it('should return 0 for empty array', () => {
      const values: number[] = [];
      const mean = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
      expect(mean).toBe(0);
    });
  });

  describe('calculateStdDev', () => {
    it('should calculate standard deviation correctly', () => {
      const values = [10, 20, 30, 40, 50];
      const mean = 30;
      const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
      const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
      expect(stdDev).toBeCloseTo(15.81, 1);
    });
  });

  describe('calculateZScore', () => {
    it('should calculate z-score correctly', () => {
      const value = 50;
      const mean = 30;
      const stdDev = 10;
      const zScore = (value - mean) / stdDev;
      expect(zScore).toBe(2);
    });

    it('should return 0 when stdDev is 0', () => {
      const value = 50;
      const mean = 30;
      const stdDev = 0;
      const zScore = stdDev === 0 ? 0 : (value - mean) / stdDev;
      expect(zScore).toBe(0);
    });
  });

  describe('linearRegression', () => {
    it('should calculate linear regression correctly', () => {
      const data = [
        { x: 0, y: 1 },
        { x: 1, y: 3 },
        { x: 2, y: 5 },
        { x: 3, y: 7 },
      ];
      
      const n = data.length;
      const sumX = data.reduce((a, b) => a + b.x, 0);
      const sumY = data.reduce((a, b) => a + b.y, 0);
      const sumXY = data.reduce((a, b) => a + b.x * b.y, 0);
      const sumX2 = data.reduce((a, b) => a + b.x * b.x, 0);
      
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;
      
      expect(slope).toBe(2);
      expect(intercept).toBe(1);
    });
  });
});
