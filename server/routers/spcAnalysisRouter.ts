import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_QUALITY (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_QUALITY");
import * as db from "../db";
// Doc 31 OP2 (decision #4) — lifecycle gate for direct threshold edits.
import { assertThresholdEditAllowed } from "../services/thresholdGovernanceService";
import {
  generateControlChart,
  calculateCapabilityIndices,
  computeHistogramBins,
  computeSixSigmaMetrics,
  SPC_RULE_NAMES,
  type ChartType,
} from "../utils/spc";

// Statistical utility functions
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calculateStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

function linearRegression(data: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  
  const sumX = data.reduce((a, b) => a + b.x, 0);
  const sumY = data.reduce((a, b) => a + b.y, 0);
  const sumXY = data.reduce((a, b) => a + b.x * b.y, 0);
  const sumX2 = data.reduce((a, b) => a + b.x * b.x, 0);
  const sumY2 = data.reduce((a, b) => a + b.y * b.y, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // Calculate R-squared
  const meanY = sumY / n;
  const ssTotal = data.reduce((a, b) => a + Math.pow(b.y - meanY, 2), 0);
  const ssResidual = data.reduce((a, b) => a + Math.pow(b.y - (slope * b.x + intercept), 2), 0);
  const r2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;
  
  return { slope, intercept, r2 };
}

function movingAverage(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    result.push(calculateMean(slice));
  }
  return result;
}

export const spcAnalysisRouter = router({
  // Get top NG measurement points with Pareto analysis
  topNGPoints: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      machineId: z.number().optional(),
      factoryCode: z.string().optional(),
      productModelId: z.number().optional(),
      limit: z.number().default(10),
    }))
    .query(async ({ input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        factoryCode: input.factoryCode,
        productModelId: input.productModelId,
        limit: input.limit,
      };
      
      const data = await db.getTopNGMeasurementPointsEnhanced(filters);
      
      // Calculate cumulative percentage for Pareto chart
      const totalNG = data.reduce((sum, item) => sum + item.ngCount, 0);
      let cumulative = 0;
      
      return data.map(item => {
        cumulative += item.ngCount;
        return {
          ...item,
          percentage: totalNG > 0 ? ((item.ngCount / totalNG) * 100).toFixed(2) : '0.00',
          cumulativePercent: totalNG > 0 ? ((cumulative / totalNG) * 100).toFixed(2) : '0.00',
        };
      });
    }),

  // Get yield trend data with prediction
  yieldTrend: protectedProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      machineId: z.number().optional(),
      factoryCode: z.string().optional(),
      interval: z.enum(['hour', 'day', 'week', 'month']).default('day'),
      predictDays: z.number().default(7),
    }))
    .query(async ({ input }) => {
      const trendData = await db.getYieldTrendData({
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        machineId: input.machineId,
        factoryCode: input.factoryCode,
        interval: input.interval,
      });
      
      if (trendData.length < 2) {
        return {
          historical: trendData,
          prediction: [],
          trend: { slope: 0, intercept: 0, r2: 0, direction: 'stable' as const },
          movingAverage: [],
        };
      }
      
      // Prepare data for regression
      const yieldValues = trendData.map(d => d.yieldRate);
      const regressionData = trendData.map((d, i) => ({ x: i, y: d.yieldRate }));
      
      // Calculate linear regression
      const regression = linearRegression(regressionData);
      
      // Calculate moving average (5-point)
      const ma = movingAverage(yieldValues, 5);
      
      // Generate predictions
      const predictions: { timeInterval: string; predictedYield: number; confidence: number }[] = [];
      const lastIndex = trendData.length - 1;
      
      for (let i = 1; i <= input.predictDays; i++) {
        const predictedYield = regression.slope * (lastIndex + i) + regression.intercept;
        // Confidence decreases with distance from last data point
        const confidence = Math.max(0.5, regression.r2 * (1 - i * 0.05));
        
        predictions.push({
          timeInterval: `+${i}d`,
          predictedYield: Math.min(100, Math.max(0, predictedYield)),
          confidence,
        });
      }
      
      // Determine trend direction
      let direction: 'improving' | 'declining' | 'stable' = 'stable';
      if (regression.slope > 0.5) direction = 'improving';
      else if (regression.slope < -0.5) direction = 'declining';
      
      return {
        historical: trendData.map((d, i) => ({
          ...d,
          movingAverage: ma[i],
        })),
        prediction: predictions,
        trend: {
          slope: regression.slope,
          intercept: regression.intercept,
          r2: regression.r2,
          direction,
        },
        movingAverage: ma,
      };
    }),

  // Anomaly detection
  detectAnomalies: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      factoryCode: z.string().optional(),
      days: z.number().default(30),
      zScoreThreshold: z.number().default(2),
    }))
    .query(async ({ input }) => {
      const data = await db.getRecentYieldData({
        machineId: input.machineId,
        factoryCode: input.factoryCode,
        days: input.days,
      });
      
      if (data.length < 5) {
        return {
          data: data.map(d => ({ ...d, isAnomaly: false, zScore: 0 })),
          anomalies: [],
          statistics: { mean: 0, stdDev: 0, anomalyCount: 0 },
        };
      }
      
      const yieldValues = data.map(d => d.yieldRate);
      const mean = calculateMean(yieldValues);
      const stdDev = calculateStdDev(yieldValues, mean);
      
      const enrichedData = data.map(d => {
        const zScore = calculateZScore(d.yieldRate, mean, stdDev);
        const isAnomaly = Math.abs(zScore) > input.zScoreThreshold;
        return { ...d, zScore, isAnomaly };
      });
      
      const anomalies = enrichedData.filter(d => d.isAnomaly);
      
      return {
        data: enrichedData,
        anomalies,
        statistics: {
          mean,
          stdDev,
          anomalyCount: anomalies.length,
          upperBound: mean + input.zScoreThreshold * stdDev,
          lowerBound: mean - input.zScoreThreshold * stdDev,
        },
      };
    }),

  // Root cause analysis suggestions
  rootCauseSuggestions: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      machineId: z.number().optional(),
      factoryCode: z.string().optional(),
    }))
    .query(async ({ input }) => {
      // Get top NG points
      const topNG = await db.getTopNGMeasurementPointsEnhanced({
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        factoryCode: input.factoryCode,
        limit: 5,
      });
      
      // Get NG by workstation
      const workstationNG = await db.getNGByWorkstation({
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        factoryCode: input.factoryCode,
      });
      
      // Generate suggestions based on patterns
      const suggestions: {
        type: 'measurement_point' | 'workstation' | 'process' | 'general';
        severity: 'high' | 'medium' | 'low';
        title: string;
        description: string;
        recommendation: string;
      }[] = [];
      
      // Analyze top NG measurement points
      if (topNG.length > 0) {
        const topPoint = topNG[0];
        if (Number(topPoint.ngRate) > 10) {
          suggestions.push({
            type: 'measurement_point',
            severity: 'high',
            title: `High NG rate at ${topPoint.pointName}`,
            description: `Measurement point "${topPoint.pointCode}" has ${topPoint.ngRate}% NG rate with ${topPoint.ngCount} defects.`,
            recommendation: 'Review measurement specifications, check equipment calibration, and inspect process parameters at this point.',
          });
        }
        
        // Check if top 3 points account for >80% of defects
        if (topNG.length >= 3) {
          const top3Total = topNG.slice(0, 3).reduce((sum, p) => sum + p.ngCount, 0);
          const allTotal = topNG.reduce((sum, p) => sum + p.ngCount, 0);
          if (allTotal > 0 && (top3Total / allTotal) > 0.8) {
            suggestions.push({
              type: 'general',
              severity: 'medium',
              title: 'Concentrated defect sources',
              description: `Top 3 measurement points account for ${((top3Total / allTotal) * 100).toFixed(1)}% of all defects.`,
              recommendation: 'Focus improvement efforts on these specific points for maximum impact.',
            });
          }
        }
      }
      
      // Analyze workstation patterns
      if (workstationNG.length > 0) {
        const topWorkstation = workstationNG[0];
        if (topWorkstation.ngCount > 50) {
          suggestions.push({
            type: 'workstation',
            severity: 'high',
            title: `High defect rate at workstation ${topWorkstation.workstationName}`,
            description: `Workstation "${topWorkstation.workstationCode}" (${topWorkstation.processType}) has ${topWorkstation.ngCount} defects.`,
            recommendation: 'Investigate operator training, equipment condition, and process parameters at this workstation.',
          });
        }
      }
      
      // Add general recommendations if no specific issues found
      if (suggestions.length === 0) {
        suggestions.push({
          type: 'general',
          severity: 'low',
          title: 'No significant issues detected',
          description: 'Current defect patterns are within normal ranges.',
          recommendation: 'Continue monitoring and maintain current process controls.',
        });
      }
      
      return {
        suggestions,
        topNGPoints: topNG,
        workstationAnalysis: workstationNG,
      };
    }),

  // Workstation analysis
  workstationAnalysis: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      machineId: z.number().optional(),
      factoryCode: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const data = await db.getNGByWorkstation({
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        factoryCode: input.factoryCode,
      });
      
      // Calculate totals and percentages
      const totalNG = data.reduce((sum, item) => sum + item.ngCount, 0);
      
      return data.map(item => ({
        ...item,
        percentage: totalNG > 0 ? ((item.ngCount / totalNG) * 100).toFixed(2) : '0.00',
      }));
    }),

  // NG by workstation for charts
  ngByWorkstation: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      machineId: z.number().optional(),
      factoryCode: z.string().optional(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const data = await db.getNGByWorkstation({
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        factoryCode: input.factoryCode,
      });
      
      // Sort by NG count descending and limit
      const sorted = data
        .sort((a, b) => b.ngCount - a.ngCount)
        .slice(0, input.limit);
      
      // Calculate totals
      const totalNG = data.reduce((sum, item) => sum + item.ngCount, 0);
      const totalInspections = data.reduce((sum, item) => sum + item.totalCount, 0);
      
      return sorted.map(item => ({
        workstationId: item.workstationId,
        workstationCode: item.workstationCode || 'N/A',
        workstation: item.workstationName || item.workstationCode || 'Unknown',
        processType: item.processType || 'OTHER',
        ngCount: item.ngCount,
        totalCount: item.totalCount,
        ngRate: item.totalCount > 0 ? (item.ngCount / item.totalCount) * 100 : 0,
        percentage: totalNG > 0 ? (item.ngCount / totalNG) * 100 : 0,
        // Linked measurement points info
        linkedFromMeasurementPoints: true,
      }));
    }),

  /**
   * Unified SPC analysis for ONE measurement point — powers the consolidated
   * /spc-analysis screen with a single query. Returns:
   *   { kpi, chart, capability, violations, pareto, specLimits, pointDef }
   *
   * chartType: 'xbar_r' (X̄-R) | 'xbar_s' (X̄-S) | 'individual_mr' (I-MR).
   * Cpk uses WITHIN-subgroup sigma (R̄/d2, S̄/c4 or MR̄/1.128); Pp/Ppk use overall stdDev.
   * DPMO = defectRate × 1e6; sigmaLevel = Z(1 − defectRate) + 1.5σ shift.
   */
  fullAnalysis: protectedProcedure
    .input(z.object({
      measurementPointDefId: z.number(),
      productModelId: z.number().optional(),
      machineId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      subgroupSize: z.number().min(2).max(25).default(5),
      chartType: z.enum(['xbar_r', 'xbar_s', 'individual_mr']).default('xbar_r'),
      enabledRules: z.array(z.number().min(1).max(8)).default([1, 2, 3, 4, 5, 6, 7, 8]),
      uslOverride: z.number().nullable().optional(),
      lslOverride: z.number().nullable().optional(),
    }))
    .query(async ({ input }) => {
      const { values: rawValues, pointDef } = await db.getFullAnalysisData({
        measurementPointDefId: input.measurementPointDefId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        productModelId: input.productModelId,
        limit: 50000,
      });

      const usl = input.uslOverride !== undefined && input.uslOverride !== null
        ? input.uslOverride
        : (pointDef?.upperLimit != null ? Number(pointDef.upperLimit) : null);
      const lsl = input.lslOverride !== undefined && input.lslOverride !== null
        ? input.lslOverride
        : (pointDef?.lowerLimit != null ? Number(pointDef.lowerLimit) : null);
      const nominal = pointDef?.nominalValue != null ? Number(pointDef.nominalValue) : null;
      const specLimits = { usl, lsl, nominal };

      // Pareto (top NG measurement points) — same scope as filters
      const paretoRaw = await db.getTopNGMeasurementPointsEnhanced({
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        productModelId: input.productModelId,
        limit: 10,
      });
      const paretoTotal = paretoRaw.reduce((s, it) => s + it.ngCount, 0);
      let paretoCum = 0;
      const pareto = paretoRaw.map((it) => {
        paretoCum += it.ngCount;
        return {
          pointCode: it.pointCode,
          pointName: it.pointName,
          ngCount: it.ngCount,
          percent: paretoTotal > 0 ? Math.round((it.ngCount / paretoTotal) * 10000) / 100 : 0,
          cumulativePercent: paretoTotal > 0 ? Math.round((paretoCum / paretoTotal) * 10000) / 100 : 0,
        };
      });

      const minSamples = input.chartType === 'individual_mr' ? 2 : input.subgroupSize * 2;
      if (rawValues.length < minSamples) {
        return {
          insufficient: true,
          sampleCount: rawValues.length,
          kpi: null, chart: null, capability: null,
          violations: { summary: { total: 0, critical: 0, warning: 0, info: 0 }, items: [] },
          pareto, specLimits, pointDef,
        };
      }

      const chart = generateControlChart(
        rawValues.map(r => ({ value: r.value, inspectionTime: r.inspectionTime })),
        input.chartType as ChartType,
        input.subgroupSize,
        input.enabledRules,
      );

      if (!chart) {
        return {
          insufficient: true,
          sampleCount: rawValues.length,
          kpi: null, chart: null, capability: null,
          violations: { summary: { total: 0, critical: 0, warning: 0, info: 0 }, items: [] },
          pareto, specLimits, pointDef,
        };
      }

      // Capability (Cpk within-subgroup, Pp/Ppk overall)
      const allValues = rawValues.map(r => r.value);
      const cap = calculateCapabilityIndices(allValues, usl, lsl, chart.estimatedSigma);
      const histogram = computeHistogramBins(allValues, 20);
      const r2 = (v: number | null) => (v != null ? Math.round(v * 100) / 100 : null);
      const capability = {
        cp: r2(cap.cp), cpk: r2(cap.cpk), pp: r2(cap.pp), ppk: r2(cap.ppk),
        cpu: r2(cap.cpu), cpl: r2(cap.cpl),
        mean: Math.round(cap.mean * 10000) / 10000,
        stdDev: Math.round(cap.overallStdDev * 10000) / 10000,
        estimatedSigma: chart.estimatedSigma,
        histogram,
        specLimits,
      };

      // Violations table from primary-chart points
      const violationItems: {
        rule: number; ruleName: string; pointIndex: number;
        value: number; severity: 'info' | 'warning' | 'critical';
      }[] = [];
      for (const p of chart.primary.points) {
        for (const rule of p.violatedRules) {
          const severity: 'info' | 'warning' | 'critical' =
            rule === 1 ? 'critical' : (rule === 4 || rule === 7) ? 'info' : 'warning';
          violationItems.push({
            rule, ruleName: SPC_RULE_NAMES[rule] || `Rule ${rule}`,
            pointIndex: p.index, value: p.value, severity,
          });
        }
      }
      const violations = {
        summary: {
          total: violationItems.length,
          critical: violationItems.filter(v => v.severity === 'critical').length,
          warning: violationItems.filter(v => v.severity === 'warning').length,
          info: violationItems.filter(v => v.severity === 'info').length,
        },
        items: violationItems,
      };

      // KPI: DPMO / sigma level / yield from out-of-spec rate (fallback to NG flag)
      let defectCount: number;
      if (usl != null || lsl != null) {
        defectCount = allValues.filter(v => (usl != null && v > usl) || (lsl != null && v < lsl)).length;
      } else {
        defectCount = rawValues.filter(r => r.result === 'NG').length;
      }
      // Gap A8: DPMO needs opportunities. This analysis is scoped to ONE
      // measurement point, so each sample is exactly 1 evaluated
      // measurement point → opportunitiesPerUnit = 1 (explicit, not implied).
      // Board-level aggregations must pass the per-inspection point count.
      const six = computeSixSigmaMetrics(defectCount, allValues.length, 1);
      const oocCount = chart.primary.points.filter(p => p.outOfControl).length;
      const oocPercent = chart.primary.points.length > 0
        ? Math.round((oocCount / chart.primary.points.length) * 10000) / 100
        : 0;

      const kpi = {
        cpk: capability.cpk,
        ppk: capability.ppk,
        oocPercent,
        sigmaLevel: six.sigmaLevel,
        dpmo: six.dpmo,
        yield: six.yieldPercent,
        sampleCount: allValues.length,
      };

      return {
        insufficient: false,
        sampleCount: allValues.length,
        kpi, chart, capability, violations, pareto, specLimits, pointDef,
      };
    }),

  /**
   * Lightweight control-chart-only endpoint. Returns ONLY the parts that depend
   * on chartType / subgroupSize:
   *   { insufficient, sampleCount, chart, violations, oocPercent }
   * Used by /spc-analysis so that switching the chart type re-fetches ONLY the
   * control chart (query B) without touching capability / Pareto / spec-KPI
   * panels (query A = fullAnalysis). Reuses generateControlChart for parity.
   */
  controlChart: protectedProcedure
    .input(z.object({
      measurementPointDefId: z.number(),
      productModelId: z.number().optional(),
      machineId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      subgroupSize: z.number().min(2).max(25).default(5),
      chartType: z.enum(['xbar_r', 'xbar_s', 'individual_mr']).default('xbar_r'),
      enabledRules: z.array(z.number().min(1).max(8)).default([1, 2, 3, 4, 5, 6, 7, 8]),
    }))
    .query(async ({ input }) => {
      const { values: rawValues } = await db.getFullAnalysisData({
        measurementPointDefId: input.measurementPointDefId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        productModelId: input.productModelId,
        limit: 50000,
      });

      const empty = {
        insufficient: true as const,
        sampleCount: rawValues.length,
        chart: null,
        violations: { summary: { total: 0, critical: 0, warning: 0, info: 0 }, items: [] },
        oocPercent: 0,
      };

      const minSamples = input.chartType === 'individual_mr' ? 2 : input.subgroupSize * 2;
      if (rawValues.length < minSamples) return empty;

      const chart = generateControlChart(
        rawValues.map(r => ({ value: r.value, inspectionTime: r.inspectionTime })),
        input.chartType as ChartType,
        input.subgroupSize,
        input.enabledRules,
      );
      if (!chart) return empty;

      const violationItems: {
        rule: number; ruleName: string; pointIndex: number;
        value: number; severity: 'info' | 'warning' | 'critical';
      }[] = [];
      for (const p of chart.primary.points) {
        for (const rule of p.violatedRules) {
          const severity: 'info' | 'warning' | 'critical' =
            rule === 1 ? 'critical' : (rule === 4 || rule === 7) ? 'info' : 'warning';
          violationItems.push({
            rule, ruleName: SPC_RULE_NAMES[rule] || `Rule ${rule}`,
            pointIndex: p.index, value: p.value, severity,
          });
        }
      }
      const violations = {
        summary: {
          total: violationItems.length,
          critical: violationItems.filter(v => v.severity === 'critical').length,
          warning: violationItems.filter(v => v.severity === 'warning').length,
          info: violationItems.filter(v => v.severity === 'info').length,
        },
        items: violationItems,
      };

      const oocCount = chart.primary.points.filter(p => p.outOfControl).length;
      const oocPercent = chart.primary.points.length > 0
        ? Math.round((oocCount / chart.primary.points.length) * 10000) / 100
        : 0;

      return {
        insufficient: false as const,
        sampleCount: rawValues.length,
        chart,
        violations,
        oocPercent,
      };
    }),

  // Get NG details by measurement point for a specific workstation
  ngByMeasurementPointForWorkstation: protectedProcedure
    .input(z.object({
      workstationId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      machineId: z.number().optional(),
      factoryCode: z.string().optional(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const data = await db.getNGByMeasurementPointForWorkstation({
        workstationId: input.workstationId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        factoryCode: input.factoryCode,
      });
      
      return data.slice(0, input.limit).map(item => ({
        pointDefId: item.pointDefId,
        pointCode: item.pointCode,
        pointName: item.pointName,
        ngCount: item.ngCount,
        totalCount: item.totalCount,
        ngRate: item.totalCount > 0 ? (item.ngCount / item.totalCount) * 100 : 0,
      }));
    }),

  // Lưu spec (USL/LSL/Target) vào điểm đo → lần sau tự prefill cho mọi người.
  // Ghi vào measurement_point_defs (có versioning/audit qua updateMeasurementPointDef).
  saveSpecLimits: protectedProcedure
    .input(z.object({
      measurementPointDefId: z.number().int().positive(),
      usl: z.number().nullable(),
      lsl: z.number().nullable(),
      target: z.number().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Doc 31 OP2 (decision #4) — this endpoint only ever writes limits, so the
      // lifecycle gate always applies: allowed while the product is `development`
      // (no released program), otherwise blocked → approval queue. Throws FORBIDDEN.
      const gate = await assertThresholdEditAllowed(input.measurementPointDefId);

      const existing = await db.getMeasurementPointDefById(input.measurementPointDefId);
      const toStr = (n: number | null) => (n === null || Number.isNaN(n) ? null : String(n));
      const after = {
        upperLimit: toStr(input.usl),
        lowerLimit: toStr(input.lsl),
        nominalValue: toStr(input.target),
      };
      await db.updateMeasurementPointDef(
        input.measurementPointDefId,
        after,
        { changedBy: (ctx as any).user?.id ?? null, changeReason: "SPC: cập nhật spec USL/LSL/Target" },
      );
      // Doc 31 OP2 — audit the direct limit edit (before/after + gate decision).
      try {
        await db.createAuditLog({
          userId: (ctx as any).user?.id ?? null,
          userName: (ctx as any).user?.name ?? undefined,
          action: "threshold.directEdit",
          entityType: "measurement_point_def",
          entityId: input.measurementPointDefId,
          entityName: existing?.code ?? undefined,
          details: {
            source: "spcAnalysis.saveSpecLimits",
            productModelId: existing?.productModelId ?? null,
            lifecycleStatus: gate.lifecycleStatus,
            gateDecision: gate.decision,
            gateEnforced: gate.enforced,
            hasReleasedProgram: gate.hasReleasedProgram,
            before: {
              lowerLimit: existing?.lowerLimit ?? null,
              upperLimit: existing?.upperLimit ?? null,
              nominalValue: existing?.nominalValue ?? null,
            },
            after,
          },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (spc threshold.directEdit)", err);
      }
      return { ok: true };
    }),
});
