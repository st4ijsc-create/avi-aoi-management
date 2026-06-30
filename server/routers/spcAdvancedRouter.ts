/**
 * Advanced SPC Router
 * Features: Workstation-level SPC, Correlation Analysis, SPC Rule Violations,
 *           CPK Trend Over Time, Quality Gate Integration
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import {
  mean,
  stdDev,
  createSubgroups,
  computeControlLimits,
  checkWesternElectricRules,
  checkNelsonRules,
  type RuleViolation,
  calculateCapabilityIndices as sharedCalculateCapabilityIndices,
} from "../utils/spc";

// ═══════════════════════════════════════════════════════════════════════════════
// Correlation statistics (not control-chart SPC math; kept local to this router)
// ═══════════════════════════════════════════════════════════════════════════════

/** Pearson correlation coefficient */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx, yi = y[i] - my;
    num += xi * yi;
    dx += xi * xi;
    dy += yi * yi;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

/** T-statistic for correlation significance */
function correlationTStat(r: number, n: number): number {
  if (Math.abs(r) >= 1 || n <= 2) return Infinity;
  return r * Math.sqrt((n - 2) / (1 - r * r));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Capability Index Calculations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Capability indices using the CORRECT sigma convention:
 *   - Cp/Cpk use WITHIN-subgroup sigma estimate (σ̂ = R̄/d2), passed in as `estimatedSigma`.
 *   - Pp/Ppk use OVERALL sample stdDev.
 * Delegates to the shared `utils/spc.ts` implementation (Box-Cox aware) and
 * preserves the legacy return shape { cp, cpk, cpu, cpl, pp, ppk, mean, stdDev, sampleSize }.
 *
 * NOTE (re-baseline risk): previously Cp/Cpk were computed from the OVERALL stdDev
 * (effectively Pp/Ppk). New Cpk values will differ from historical cpkHistory rows.
 */
function calculateCapabilityIndices(
  values: number[],
  usl: number,
  lsl: number,
  estimatedSigma: number,
  _nominal?: number,
) {
  const n = values.length;
  if (n < 2 || usl <= lsl || !(estimatedSigma > 0)) return null;

  const result = sharedCalculateCapabilityIndices(values, usl, lsl, estimatedSigma);
  if (result.cp == null && result.cpk == null && result.pp == null) return null;

  return {
    cp: result.cp,
    cpk: result.cpk,
    cpu: result.cpu,
    cpl: result.cpl,
    pp: result.pp,
    ppk: result.ppk,
    mean: result.mean,
    stdDev: result.overallStdDev,
    sampleSize: n,
  };
}

/**
 * Estimate within-subgroup sigma (R̄/d2) from a flat ordered value array by
 * forming subgroups. Falls back to overall stdDev when too few subgroups exist
 * (e.g. ungrouped/individuals data) so capability is still computable.
 */
function estimateWithinSubgroupSigma(values: number[], subgroupSize = 5): number {
  if (values.length < subgroupSize * 2) {
    // Fall back to moving-range based estimate (I-MR) for ungrouped data
    if (values.length >= 2) {
      const mrs = values.slice(1).map((v, i) => Math.abs(v - values[i]));
      const mrBar = mrs.reduce((a, b) => a + b, 0) / mrs.length;
      if (mrBar > 0) return mrBar / 1.128;
    }
    const m = mean(values);
    return stdDev(values, m, true);
  }
  const subgroups = createSubgroups(values.map(v => ({ value: v, inspectionTime: new Date(0) })), subgroupSize);
  const limits = computeControlLimits(subgroups, subgroupSize);
  return limits.estimatedSigma > 0 ? limits.estimatedSigma : stdDev(values, mean(values), true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

// ─── SPC Configuration Router ───────────────────────────────────────────────
export const spcConfigRouter = router({
  list: protectedProcedure
    .input(z.object({
      workstationId: z.number().optional(),
      productModelId: z.number().optional(),
      measurementPointDefId: z.number().optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listSpcConfigurations(input ?? {});
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const config = await db.getSpcConfiguration(input.id);
      if (!config) throw new TRPCError({ code: 'NOT_FOUND', message: 'SPC configuration not found' });
      return config;
    }),

  create: protectedProcedure
    .input(z.object({
      measurementPointDefId: z.number().optional(),
      workstationId: z.number().optional(),
      productModelId: z.number().optional(),
      machineId: z.number().optional(),
      chartType: z.enum(['xbar_r', 'xbar_s', 'individual_mr', 'p_chart', 'np_chart', 'c_chart', 'u_chart']).default('xbar_r'),
      subgroupSize: z.number().min(2).max(25).default(5),
      controlLimitMethod: z.enum(['auto', 'manual']).default('auto'),
      manualUCL: z.number().optional(),
      manualLCL: z.number().optional(),
      manualCenterLine: z.number().optional(),
      movingRangeSpan: z.number().min(2).max(10).default(2),
    }))
    .mutation(async ({ input, ctx }) => {
      const data: any = { ...input, createdBy: ctx.user?.id };
      if (input.manualUCL !== undefined) data.manualUCL = String(input.manualUCL);
      if (input.manualLCL !== undefined) data.manualLCL = String(input.manualLCL);
      if (input.manualCenterLine !== undefined) data.manualCenterLine = String(input.manualCenterLine);
      return db.createSpcConfiguration(data);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      chartType: z.enum(['xbar_r', 'xbar_s', 'individual_mr', 'p_chart', 'np_chart', 'c_chart', 'u_chart']).optional(),
      subgroupSize: z.number().min(2).max(25).optional(),
      controlLimitMethod: z.enum(['auto', 'manual']).optional(),
      manualUCL: z.number().optional(),
      manualLCL: z.number().optional(),
      manualCenterLine: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const updateData: any = { ...data };
      if (data.manualUCL !== undefined) updateData.manualUCL = String(data.manualUCL);
      if (data.manualLCL !== undefined) updateData.manualLCL = String(data.manualLCL);
      if (data.manualCenterLine !== undefined) updateData.manualCenterLine = String(data.manualCenterLine);
      return db.updateSpcConfiguration(id, updateData);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteSpcConfiguration(input.id);
      return { success: true };
    }),
});

// ─── Workstation SPC Router ─────────────────────────────────────────────────
export const workstationSpcRouter = router({
  /** Get X-bar/R chart data for a specific measurement point */
  controlChart: protectedProcedure
    .input(z.object({
      measurementPointDefId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      machineId: z.number().optional(),
      subgroupSize: z.number().min(2).max(25).default(5),
    }))
    .query(async ({ input }) => {
      const rawData = await db.getMeasurementValuesForSPC({
        measurementPointDefId: input.measurementPointDefId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        limit: 5000,
      });

      if (rawData.length < input.subgroupSize * 2) {
        return { subgroups: [], controlLimits: null, insufficient: true, sampleCount: rawData.length };
      }

      const data = rawData.map(d => ({ value: Number(d.value), inspectionTime: new Date(d.inspectionTime) }));
      const subgroups = createSubgroups(data, input.subgroupSize);
      const limits = computeControlLimits(subgroups, input.subgroupSize);

      return {
        subgroups: subgroups.map(sg => ({
          index: sg.index,
          mean: sg.mean,
          range: sg.range,
          timestamp: sg.timestamp.toISOString(),
          values: sg.values,
        })),
        controlLimits: limits,
        insufficient: false,
        sampleCount: rawData.length,
        subgroupCount: subgroups.length,
      };
    }),

  /** Compare SPC metrics across workstations */
  comparison: protectedProcedure
    .input(z.object({
      productModelId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const data = await db.getWorkstationMeasurementComparison({
        productModelId: input.productModelId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      });

      return data.map((ws: any) => ({
        workstationId: ws.workstationId,
        workstationName: ws.workstationName || 'Unknown',
        workstationCode: ws.workstationCode || 'N/A',
        processType: ws.processType || 'OTHER',
        totalCount: Number(ws.totalCount || 0),
        ngCount: Number(ws.ngCount || 0),
        avgValue: ws.avgValue ? Number(ws.avgValue) : null,
        ngRate: ws.totalCount > 0 ? (Number(ws.ngCount || 0) / Number(ws.totalCount)) * 100 : 0,
      }));
    }),

  /** Calculate capability indices (Cp, Cpk, Pp, Ppk) for a measurement point */
  capability: protectedProcedure
    .input(z.object({
      measurementPointDefId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      machineId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      // Get spec limits from measurement point definition
      const pointDefs = await db.getLinkedMeasurementPointsForWorkstation(0); // we'll fetch directly
      // Actually, we need a direct point lookup - use getMeasurementValuesForSPC and get spec from schema
      const rawData = await db.getMeasurementValuesForSPC({
        measurementPointDefId: input.measurementPointDefId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        limit: 10000,
      });

      if (rawData.length < 30) {
        return { insufficient: true, sampleCount: rawData.length, indices: null };
      }

      // Get spec limits from the first result's metadata or query directly
      const { getDb } = await import('../db/connection');
      const database = await getDb();
      if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      const { measurementPointDefs } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const [pointDef] = await database.select().from(measurementPointDefs).where(eq(measurementPointDefs.id, input.measurementPointDefId));
      
      if (!pointDef || !pointDef.upperLimit || !pointDef.lowerLimit) {
        return { insufficient: false, sampleCount: rawData.length, indices: null, reason: 'No spec limits defined for this measurement point' };
      }

      const usl = Number(pointDef.upperLimit);
      const lsl = Number(pointDef.lowerLimit);
      const nominal = pointDef.nominalValue ? Number(pointDef.nominalValue) : undefined;
      const values = rawData.map(d => Number(d.value));

      // Cpk uses within-subgroup sigma (R̄/d2); Pp/Ppk use overall stdDev.
      const estimatedSigma = estimateWithinSubgroupSigma(values, 5);
      const indices = calculateCapabilityIndices(values, usl, lsl, estimatedSigma, nominal);

      return {
        insufficient: false,
        sampleCount: rawData.length,
        indices,
        specLimits: { usl, lsl, nominal },
        pointInfo: {
          id: pointDef.id,
          code: pointDef.code,
          name: pointDef.name,
          measurementType: pointDef.measurementType,
        },
      };
    }),
});

// ─── Correlation Analysis Router ────────────────────────────────────────────
export const correlationRouter = router({
  /** Run correlation analysis between selected measurement points */
  analyze: protectedProcedure
    .input(z.object({
      pointIds: z.array(z.number()).min(2).max(20),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      machineId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const rawPairs = await db.getMeasurementPairsForCorrelation({
        pointIds: input.pointIds,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
      });

      // Group values by inspectionId, then extract paired values
      const byInspection = new Map<number, Map<number, number>>();
      for (const row of rawPairs) {
        if (!byInspection.has(row.inspectionId)) byInspection.set(row.inspectionId, new Map());
        byInspection.get(row.inspectionId)!.set(row.pointDefId, Number(row.value));
      }

      // Only keep inspections that have ALL points
      const completeInspections = Array.from(byInspection.entries())
        .filter(([_, points]) => input.pointIds.every(pid => points.has(pid)));

      if (completeInspections.length < 10) {
        return { insufficient: true, sampleSize: completeInspections.length, matrix: null, strongCorrelations: [] };
      }

      // Build correlation matrix
      const pointCount = input.pointIds.length;
      const matrix: number[][] = Array.from({ length: pointCount }, () => Array(pointCount).fill(0));
      const strongCorrelations: { pointA: number; pointB: number; r: number; tStat: number; significant: boolean }[] = [];

      for (let i = 0; i < pointCount; i++) {
        matrix[i][i] = 1.0;
        for (let j = i + 1; j < pointCount; j++) {
          const xVals = completeInspections.map(([_, pts]) => pts.get(input.pointIds[i])!);
          const yVals = completeInspections.map(([_, pts]) => pts.get(input.pointIds[j])!);
          const r = pearsonCorrelation(xVals, yVals);
          matrix[i][j] = r;
          matrix[j][i] = r;

          const tStat = correlationTStat(r, completeInspections.length);
          const significant = Math.abs(tStat) > 2.0; // ~95% confidence for large n

          if (Math.abs(r) > 0.5) {
            strongCorrelations.push({
              pointA: input.pointIds[i], pointB: input.pointIds[j],
              r: Math.round(r * 1000) / 1000,
              tStat: Math.round(tStat * 100) / 100,
              significant,
            });
          }
        }
      }

      // Sort strong correlations by absolute r value
      strongCorrelations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

      return {
        insufficient: false,
        sampleSize: completeInspections.length,
        pointIds: input.pointIds,
        matrix: matrix.map(row => row.map(v => Math.round(v * 1000) / 1000)),
        strongCorrelations,
      };
    }),

  /** Save a correlation analysis result */
  save: protectedProcedure
    .input(z.object({
      productModelId: z.number().optional(),
      workstationId: z.number().optional(),
      machineId: z.number().optional(),
      pointIds: z.array(z.number()),
      correlationMatrix: z.any(),
      sampleSize: z.number(),
      strongCorrelations: z.any().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.saveCorrelationAnalysis({
        ...input,
        analysisDate: new Date(),
        createdBy: ctx.user?.id,
      });
    }),

  /** List saved correlation analyses */
  list: protectedProcedure
    .input(z.object({
      productModelId: z.number().optional(),
      workstationId: z.number().optional(),
      limit: z.number().default(20),
    }).optional())
    .query(async ({ input }) => {
      return db.listCorrelationAnalyses(input ?? {});
    }),
});

// ─── SPC Rule Violations Router ─────────────────────────────────────────────
export const spcRuleViolationRouter = router({
  /** Detect rule violations for a measurement point */
  detect: protectedProcedure
    .input(z.object({
      measurementPointDefId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      machineId: z.number().optional(),
      subgroupSize: z.number().min(2).max(25).default(5),
      rules: z.array(z.enum(['western_electric', 'nelson'])).default(['western_electric', 'nelson']),
    }))
    .query(async ({ input }) => {
      const rawData = await db.getMeasurementValuesForSPC({
        measurementPointDefId: input.measurementPointDefId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        machineId: input.machineId,
        limit: 5000,
      });

      if (rawData.length < input.subgroupSize * 3) {
        return { insufficient: true, violations: [], sampleCount: rawData.length };
      }

      const data = rawData.map(d => ({ value: Number(d.value), inspectionTime: new Date(d.inspectionTime) }));
      const subgroups = createSubgroups(data, input.subgroupSize);
      const limits = computeControlLimits(subgroups, input.subgroupSize);
      const xbarValues = subgroups.map(sg => sg.mean);

      let violations: RuleViolation[] = [];

      if (input.rules.includes('western_electric')) {
        violations = violations.concat(checkWesternElectricRules(xbarValues, limits.xBar.CL, limits.estimatedSigma));
      }
      if (input.rules.includes('nelson')) {
        violations = violations.concat(checkNelsonRules(xbarValues, limits.xBar.CL, limits.estimatedSigma));
      }

      // Deduplicate by rule type + overlapping indices
      const seen = new Set<string>();
      const deduplicated = violations.filter(v => {
        const key = `${v.ruleType}_${v.violatingIndices[0]}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return {
        insufficient: false,
        violations: deduplicated,
        sampleCount: rawData.length,
        subgroupCount: subgroups.length,
        controlLimits: limits,
        summary: {
          total: deduplicated.length,
          critical: deduplicated.filter(v => v.severity === 'critical').length,
          warning: deduplicated.filter(v => v.severity === 'warning').length,
          info: deduplicated.filter(v => v.severity === 'info').length,
        },
      };
    }),

  /** Save detected violations to database */
  saveViolations: protectedProcedure
    .input(z.object({
      measurementPointDefId: z.number(),
      workstationId: z.number().optional(),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      violations: z.array(z.object({
        ruleType: z.string(),
        ruleName: z.string(),
        ruleDescription: z.string(),
        severity: z.enum(['info', 'warning', 'critical']),
        violatingValues: z.array(z.number()),
        violatingIndices: z.array(z.number()),
      })),
      controlLimits: z.any().optional(),
    }))
    .mutation(async ({ input }) => {
      const results = [];
      for (const v of input.violations) {
        const result = await db.createSpcRuleViolation({
          measurementPointDefId: input.measurementPointDefId,
          workstationId: input.workstationId,
          machineId: input.machineId,
          productModelId: input.productModelId,
          ruleType: v.ruleType as any,
          ruleName: v.ruleName,
          ruleDescription: v.ruleDescription,
          severity: v.severity,
          violatingValues: v.violatingValues,
          subgroupIndices: v.violatingIndices,
          controlLimits: input.controlLimits,
        });
        results.push(result);
      }
      return { saved: results.length };
    }),

  /** List violation history */
  list: protectedProcedure
    .input(z.object({
      workstationId: z.number().optional(),
      productModelId: z.number().optional(),
      machineId: z.number().optional(),
      severity: z.enum(['info', 'warning', 'critical']).optional(),
      isActive: z.boolean().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().default(50),
    }).optional())
    .query(async ({ input }) => {
      return db.listSpcRuleViolations({
        ...input,
        startDate: input?.startDate ? new Date(input.startDate) : undefined,
        endDate: input?.endDate ? new Date(input.endDate) : undefined,
      });
    }),

  /** Acknowledge a violation */
  acknowledge: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) throw new TRPCError({ code: 'UNAUTHORIZED' });
      await db.acknowledgeSpcViolation(input.id, ctx.user.id);
      return { success: true };
    }),

  /** Resolve a violation */
  resolve: protectedProcedure
    .input(z.object({ id: z.number(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) throw new TRPCError({ code: 'UNAUTHORIZED' });
      await db.resolveSpcViolation(input.id, ctx.user.id, input.notes);
      return { success: true };
    }),

  /** Get count of active violations */
  activeCount: protectedProcedure
    .input(z.object({
      workstationId: z.number().optional(),
      productModelId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getActiveViolationCount(input ?? {});
    }),
});

// ─── CPK Trend Router ───────────────────────────────────────────────────────
export const cpkTrendRouter = router({
  /** Calculate and store CPK for a measurement point */
  calculate: protectedProcedure
    .input(z.object({
      measurementPointDefId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
      machineId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const rawData = await db.getMeasurementValuesForSPC({
        measurementPointDefId: input.measurementPointDefId,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        machineId: input.machineId,
        limit: 50000,
      });

      if (rawData.length < 30) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Insufficient data: ${rawData.length} samples (minimum 30 required)` });
      }

      // Get spec limits
      const { getDb } = await import('../db/connection');
      const database = await getDb();
      if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      
      const { measurementPointDefs } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const [pointDef] = await database.select().from(measurementPointDefs).where(eq(measurementPointDefs.id, input.measurementPointDefId));
      
      if (!pointDef?.upperLimit || !pointDef?.lowerLimit) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Measurement point has no spec limits defined' });
      }

      const values = rawData.map(d => Number(d.value));
      const usl = Number(pointDef.upperLimit);
      const lsl = Number(pointDef.lowerLimit);
      const nominal = pointDef.nominalValue ? Number(pointDef.nominalValue) : undefined;
      const estimatedSigma = estimateWithinSubgroupSigma(values, 5);
      const indices = calculateCapabilityIndices(values, usl, lsl, estimatedSigma, nominal);

      if (!indices) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unable to calculate capability indices (zero variance or invalid limits)' });
      }

      // Save to history
      await db.saveCpkHistory({
        measurementPointDefId: input.measurementPointDefId,
        workstationId: pointDef.workstationId,
        productModelId: pointDef.productModelId,
        machineId: input.machineId,
        periodStart: new Date(input.startDate),
        periodEnd: new Date(input.endDate),
        sampleSize: indices.sampleSize,
        mean: String(indices.mean),
        stdDev: String(indices.stdDev),
        cp: indices.cp != null ? String(indices.cp) : null,
        cpk: indices.cpk != null ? String(indices.cpk) : null,
        pp: indices.pp != null ? String(indices.pp) : null,
        ppk: indices.ppk != null ? String(indices.ppk) : null,
        cpl: indices.cpl != null ? String(indices.cpl) : null,
        cpu: indices.cpu != null ? String(indices.cpu) : null,
        usl: String(usl),
        lsl: String(lsl),
        nominal: nominal != null ? String(nominal) : null,
      });

      return { success: true, indices, specLimits: { usl, lsl, nominal } };
    }),

  /** Get CPK trend for a measurement point */
  trend: protectedProcedure
    .input(z.object({
      measurementPointDefId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      const data = await db.getCpkTrend({
        measurementPointDefId: input.measurementPointDefId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        limit: input.limit,
      });

      // Compute trend direction
      const cpkValues = data.map((d: any) => Number(d.cpk)).filter(v => !isNaN(v));
      let trendDirection: 'improving' | 'declining' | 'stable' = 'stable';
      if (cpkValues.length >= 3) {
        const recent = mean(cpkValues.slice(0, Math.ceil(cpkValues.length / 3)));
        const older = mean(cpkValues.slice(-Math.ceil(cpkValues.length / 3)));
        if (recent - older > 0.1) trendDirection = 'improving';
        else if (older - recent > 0.1) trendDirection = 'declining';
      }

      // Alert if latest CPK < 1.33
      const latestCpk = cpkValues.length > 0 ? cpkValues[0] : null;
      let alert: { level: 'ok' | 'warning' | 'critical'; message: string } | null = null;
      if (latestCpk != null) {
        if (latestCpk < 1.0) {
          alert = { level: 'critical', message: `CPK ${latestCpk.toFixed(2)} < 1.00 — Process is NOT capable` };
        } else if (latestCpk < 1.33) {
          alert = { level: 'warning', message: `CPK ${latestCpk.toFixed(2)} < 1.33 — Process capability marginal` };
        } else {
          alert = { level: 'ok', message: `CPK ${latestCpk.toFixed(2)} ≥ 1.33 — Process is capable` };
        }
      }

      return {
        data: data.map((d: any) => ({
          id: d.id,
          periodStart: d.periodStart,
          periodEnd: d.periodEnd,
          sampleSize: d.sampleSize,
          mean: Number(d.mean),
          stdDev: Number(d.stdDev),
          cp: d.cp ? Number(d.cp) : null,
          cpk: d.cpk ? Number(d.cpk) : null,
          pp: d.pp ? Number(d.pp) : null,
          ppk: d.ppk ? Number(d.ppk) : null,
          cpl: d.cpl ? Number(d.cpl) : null,
          cpu: d.cpu ? Number(d.cpu) : null,
        })),
        trendDirection,
        alert,
        latestCpk,
      };
    }),

  /** Get CPK summary grouped by workstation */
  summaryByWorkstation: protectedProcedure
    .input(z.object({
      productModelId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getCpkSummaryByWorkstation({
        productModelId: input?.productModelId,
        startDate: input?.startDate ? new Date(input.startDate) : undefined,
        endDate: input?.endDate ? new Date(input.endDate) : undefined,
      });
    }),
});

// ─── Quality Gate Router ────────────────────────────────────────────────────
export const qualityGateRouter = router({
  /** List quality gates */
  list: protectedProcedure
    .input(z.object({
      lineId: z.number().optional(),
      workstationId: z.number().optional(),
      productModelId: z.number().optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listQualityGates(input ?? {});
    }),

  /** Get single quality gate */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const gate = await db.getQualityGate(input.id);
      if (!gate) throw new TRPCError({ code: 'NOT_FOUND' });
      return gate;
    }),

  /** Create quality gate */
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      lineId: z.number().optional(),
      workstationId: z.number().optional(),
      productModelId: z.number().optional(),
      machineId: z.number().optional(),
      gateType: z.enum(['yield_rate', 'ng_count', 'ng_rate', 'cpk_threshold', 'consecutive_ng']),
      threshold: z.number(),
      comparisonOperator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq']).default('lt'),
      windowSize: z.number().min(10).max(10000).default(100),
      consecutiveCount: z.number().min(1).max(100).default(3),
      action: z.enum(['alert', 'pause', 'stop']).default('alert'),
      isActive: z.boolean().default(true),
      autoResumeAfterMinutes: z.number().optional(),
      notifyRoles: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.createQualityGate({
        ...input,
        threshold: String(input.threshold),
        createdBy: ctx.user?.id,
      });
    }),

  /** Update quality gate */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      gateType: z.enum(['yield_rate', 'ng_count', 'ng_rate', 'cpk_threshold', 'consecutive_ng']).optional(),
      threshold: z.number().optional(),
      comparisonOperator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq']).optional(),
      windowSize: z.number().optional(),
      consecutiveCount: z.number().optional(),
      action: z.enum(['alert', 'pause', 'stop']).optional(),
      isActive: z.boolean().optional(),
      autoResumeAfterMinutes: z.number().nullable().optional(),
      notifyRoles: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const updateData: any = { ...data };
      if (data.threshold != null) updateData.threshold = String(data.threshold);
      return db.updateQualityGate(id, updateData);
    }),

  /** Delete quality gate */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteQualityGate(input.id);
      return { success: true };
    }),

  /** Evaluate quality gate against current data */
  evaluate: protectedProcedure
    .input(z.object({
      qualityGateId: z.number(),
      machineId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const gate = await db.getQualityGate(input.qualityGateId);
      if (!gate) throw new TRPCError({ code: 'NOT_FOUND' });

      // Get recent inspection data for this gate's scope
      const { getDb } = await import('../db/connection');
      const database = await getDb();
      if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      
      const { productInspections } = await import('../../drizzle/schema');
      const { desc, and, eq, sql } = await import('drizzle-orm');

      const conditions: any[] = [];
      if (gate.machineId) conditions.push(eq(productInspections.machineId, gate.machineId));
      if (input.machineId) conditions.push(eq(productInspections.machineId, input.machineId));
      if (gate.productModelId) conditions.push(eq(productInspections.productModelId, gate.productModelId));

      const windowSize = gate.windowSize ?? 100;
      const recentInspections = await database.select().from(productInspections)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(productInspections.inspectionTime))
        .limit(windowSize);

      if (recentInspections.length === 0) {
        return { triggered: false, currentValue: null, threshold: Number(gate.threshold), gateType: gate.gateType, message: 'No inspection data available' };
      }

      const total = recentInspections.length;
      const ngCount = recentInspections.filter(i => i.overallResult === 'NG').length;
      const yieldRate = total > 0 ? ((total - ngCount) / total) * 100 : 100;
      const ngRate = total > 0 ? (ngCount / total) * 100 : 0;

      // Check consecutive NG
      let consecutiveNG = 0;
      for (const insp of recentInspections) {
        if (insp.overallResult === 'NG') consecutiveNG++;
        else break;
      }

      let currentValue: number;
      switch (gate.gateType) {
        case 'yield_rate': currentValue = yieldRate; break;
        case 'ng_count': currentValue = ngCount; break;
        case 'ng_rate': currentValue = ngRate; break;
        case 'consecutive_ng': currentValue = consecutiveNG; break;
        case 'cpk_threshold': currentValue = 0; break; // CPK requires separate calculation
        default: currentValue = 0;
      }

      const threshold = Number(gate.threshold);
      let triggered = false;
      switch (gate.comparisonOperator) {
        case 'lt': triggered = currentValue < threshold; break;
        case 'lte': triggered = currentValue <= threshold; break;
        case 'gt': triggered = currentValue > threshold; break;
        case 'gte': triggered = currentValue >= threshold; break;
        case 'eq': triggered = currentValue === threshold; break;
      }

      return {
        triggered,
        currentValue,
        threshold,
        gateType: gate.gateType,
        action: gate.action,
        windowSize: total,
        details: { total, ngCount, yieldRate, ngRate, consecutiveNG },
        message: triggered
          ? `Quality gate "${gate.name}" TRIGGERED: ${gate.gateType} = ${currentValue.toFixed(2)} ${gate.comparisonOperator} ${threshold}`
          : `Quality gate "${gate.name}" OK: ${gate.gateType} = ${currentValue.toFixed(2)}`,
      };
    }),

  /** List gate events */
  events: protectedProcedure
    .input(z.object({
      qualityGateId: z.number().optional(),
      status: z.enum(['active', 'acknowledged', 'resolved', 'auto_resolved']).optional(),
      machineId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().default(50),
    }).optional())
    .query(async ({ input }) => {
      return db.listQualityGateEvents({
        ...input,
        startDate: input?.startDate ? new Date(input.startDate) : undefined,
        endDate: input?.endDate ? new Date(input.endDate) : undefined,
      });
    }),

  /** Trigger a gate event manually */
  triggerEvent: protectedProcedure
    .input(z.object({
      qualityGateId: z.number(),
      triggerValue: z.number(),
      machineId: z.number().optional(),
      productionOrderId: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const gate = await db.getQualityGate(input.qualityGateId);
      if (!gate) throw new TRPCError({ code: 'NOT_FOUND' });

      return db.createQualityGateEvent({
        qualityGateId: input.qualityGateId,
        triggerValue: String(input.triggerValue),
        threshold: gate.threshold,
        action: gate.action,
        machineId: input.machineId,
        productionOrderId: input.productionOrderId,
        notes: input.notes,
      });
    }),

  /** Acknowledge gate event */
  acknowledgeEvent: protectedProcedure
    .input(z.object({ id: z.number(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) throw new TRPCError({ code: 'UNAUTHORIZED' });
      await db.acknowledgeQualityGateEvent(input.id, ctx.user.id, input.notes);
      return { success: true };
    }),

  /** Resolve gate event */
  resolveEvent: protectedProcedure
    .input(z.object({ id: z.number(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) throw new TRPCError({ code: 'UNAUTHORIZED' });
      await db.resolveQualityGateEvent(input.id, ctx.user.id, input.notes);
      return { success: true };
    }),

  /** Get active gate events for dashboard */
  activeEvents: protectedProcedure
    .query(async () => {
      return db.getActiveGateEvents();
    }),
});
