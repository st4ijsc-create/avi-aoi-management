import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { pearsonCorrelation, correlationPValue } from "../utils/statistics";
import { generateRCAInsights } from "../services/aiInsightsService";

// ============ ROOT CAUSE ANALYSIS ROUTER ============
export const rootCauseRouter = router({
  // Run root cause analysis
  analyze: protectedProcedure
    .input(z.object({
      analysisType: z.enum(['DEFECT_ANALYSIS', 'YIELD_ANALYSIS', 'QUALITY_ANALYSIS', 'MACHINE_ANALYSIS']),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      factoryId: z.number().optional(),
      startDate: z.date(),
      endDate: z.date(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      const startTime = Date.now();
      
      // Get inspection data for analysis
      let query = sql`
        SELECT 
          i.id, i."serialNumber", i."overallResult" as result, i."createdAt",
          m.id as machine_id, m.code as machine_code, m.name as machine_name,
          pm.id as product_model_id, pm.code as product_model_code,
          f.id as factory_id, f.code as factory_code,
          mr.result as measurement_result, mr."measuredValue" as "actualValue",
          mpd.name as measurement_point_name
        FROM product_inspections i
        LEFT JOIN machines m ON i."machineId" = m.id
        LEFT JOIN product_models pm ON i."productModelId" = pm.id
        LEFT JOIN stations st ON m."stationId" = st.id
        LEFT JOIN production_lines pl ON st."lineId" = pl.id
        LEFT JOIN workshops w ON pl."workshopId" = w.id
        LEFT JOIN factories f ON w."factoryId" = f.id
        LEFT JOIN measurement_results mr ON mr."inspectionId" = i.id
        LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
        WHERE i."createdAt" BETWEEN ${input.startDate} AND ${input.endDate}
      `;
      
      const conditions: string[] = [];
      if (input.machineId) conditions.push(`m.id = ${input.machineId}`);
      if (input.productModelId) conditions.push(`pm.id = ${input.productModelId}`);
      if (input.factoryId) conditions.push(`f.id = ${input.factoryId}`);
      
      if (conditions.length > 0) {
        query = sql`${query} AND ${sql.raw(conditions.join(' AND '))}`;
      }
      
      const result = await db.execute(query) as any;
      const rows = result.rows || [];
      
      // Calculate statistics
      const totalInspections = new Set(rows.map((r: any) => r.id)).size;
      const ngCount = rows.filter((r: any) => r.result === 'NG').length;
      const okCount = rows.filter((r: any) => r.result === 'OK').length;
      
      // Group by measurement point for defect analysis
      const defectsByPoint: Record<string, number> = {};
      const defectsByMachine: Record<string, number> = {};
      const defectsByProduct: Record<string, number> = {};
      
      for (const row of rows) {
        if (row.measurement_result === 'NG') {
          const pointName = row.measurement_point_name || 'Unknown';
          defectsByPoint[pointName] = (defectsByPoint[pointName] || 0) + 1;
          
          const machineCode = row.machine_code || 'Unknown';
          defectsByMachine[machineCode] = (defectsByMachine[machineCode] || 0) + 1;
          
          const productCode = row.product_model_code || 'Unknown';
          defectsByProduct[productCode] = (defectsByProduct[productCode] || 0) + 1;
        }
      }
      
      // Calculate top factors
      const totalDefects = Object.values(defectsByPoint).reduce((a, b) => a + b, 0);
      const topFactors = Object.entries(defectsByPoint)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([factor, count]) => ({
          factor,
          contribution: totalDefects > 0 ? Math.round((count / totalDefects) * 100) : 0,
          description: `${count} defects detected at ${factor}`,
          trend: 'stable' as const,
        }));
      
      // Calculate Pareto data
      let cumulative = 0;
      const paretoData = Object.entries(defectsByPoint)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => {
          cumulative += count;
          return {
            category,
            count,
            percentage: totalDefects > 0 ? Math.round((count / totalDefects) * 100) : 0,
            cumulativePercentage: totalDefects > 0 ? Math.round((cumulative / totalDefects) * 100) : 0,
          };
        });
      
      // Calculate correlation matrix (real Pearson coefficients aligned per inspection)
      const correlationMatrix = [];
      const factors = Object.keys(defectsByPoint).slice(0, 5);

      // Build a lookup: inspectionId → { measurementPointName → measuredValue }
      const valuesByInspection = new Map<number, Map<string, number>>();
      for (const row of rows) {
        if (row.actualValue == null || row.measurement_point_name == null) continue;
        const inspId = Number(row.id);
        if (!valuesByInspection.has(inspId)) valuesByInspection.set(inspId, new Map());
        valuesByInspection.get(inspId)!.set(row.measurement_point_name, Number(row.actualValue));
      }

      for (let i = 0; i < factors.length; i++) {
        for (let j = i + 1; j < factors.length; j++) {
          const seriesA: number[] = [];
          const seriesB: number[] = [];
          for (const pointMap of valuesByInspection.values()) {
            const a = pointMap.get(factors[i]);
            const b = pointMap.get(factors[j]);
            if (a !== undefined && b !== undefined) {
              seriesA.push(a);
              seriesB.push(b);
            }
          }
          const r = pearsonCorrelation(seriesA, seriesB);
          const pValue = correlationPValue(r, seriesA.length);
          correlationMatrix.push({
            factor1: factors[i],
            factor2: factors[j],
            correlation: r,
            significance: pValue,
            sampleSize: seriesA.length,
          });
        }
      }
      
      // Get machine and product info (before LLM so we can pass human-readable codes)
      let machineCode: string | null = null;
      let productModelCode: string | null = null;
      if (input.machineId) {
        const machineResult = await db.execute(sql`SELECT code FROM machines WHERE id = ${input.machineId}`) as any;
        machineCode = machineResult.rows?.[0]?.code ?? null;
      }
      if (input.productModelId) {
        const productResult = await db.execute(sql`SELECT code FROM product_models WHERE id = ${input.productModelId}`) as any;
        productModelCode = productResult.rows?.[0]?.code ?? null;
      }

      // Generate AI insights via LLM (falls back to rule-based if OPENAI_API_KEY not set)
      const aiInsights = await generateRCAInsights(topFactors, {
        totalInspections,
        ngCount,
        defectRate: totalInspections > 0 ? (ngCount / totalInspections) * 100 : 0,
        analysisType: input.analysisType,
        machineCode,
        productModelCode,
      });
      
      // Save analysis result
      const insertResult = await db.execute(
        sql`INSERT INTO root_cause_analysis 
          (analysisType, machineId, machineCode, productModelId, productModelCode, factoryId, startDate, endDate, dataPointsAnalyzed, correlationMatrix, topFactors, aiInsights, paretoData, status, requestedBy, requestedByName, processingTime)
          VALUES (${input.analysisType}, ${input.machineId || null}, ${machineCode}, ${input.productModelId || null}, ${productModelCode}, ${input.factoryId || null}, ${input.startDate}, ${input.endDate}, ${rows.length}, ${JSON.stringify(correlationMatrix)}, ${JSON.stringify(topFactors)}, ${JSON.stringify(aiInsights)}, ${JSON.stringify(paretoData)}, 'COMPLETED', ${ctx.user.id}, ${ctx.user.name || 'Unknown'}, ${Date.now() - startTime}) RETURNING id`
      ) as any;
      
      return {
        id: insertResult.rows?.[0]?.id,
        analysisType: input.analysisType,
        dataPointsAnalyzed: rows.length,
        topFactors,
        correlationMatrix,
        aiInsights,
        paretoData,
        processingTime: Date.now() - startTime,
      };
    }),

  // List analysis history
  list: protectedProcedure
    .input(z.object({
      analysisType: z.enum(['DEFECT_ANALYSIS', 'YIELD_ANALYSIS', 'QUALITY_ANALYSIS', 'MACHINE_ANALYSIS']).optional(),
      machineId: z.number().optional(),
      limit: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      let query = sql`SELECT * FROM root_cause_analysis WHERE 1=1`;
      if (input?.analysisType) {
        query = sql`${query} AND analysisType = ${input.analysisType}`;
      }
      if (input?.machineId) {
        query = sql`${query} AND machineId = ${input.machineId}`;
      }
      query = sql`${query} ORDER BY "createdAt" DESC LIMIT ${input?.limit || 20}`;
      
      const result = await db.execute(query) as any;
      return (result.rows || []).map((row: any) => ({
        id: row.id,
        analysisType: row.analysisType,
        machineId: row.machineId,
        machineCode: row.machineCode,
        productModelId: row.productModelId,
        productModelCode: row.productModelCode,
        factoryId: row.factoryId,
        startDate: row.startDate,
        endDate: row.endDate,
        dataPointsAnalyzed: row.dataPointsAnalyzed,
        topFactors: typeof row.topFactors === 'string' ? JSON.parse(row.topFactors) : row.topFactors,
        aiInsights: typeof row.aiInsights === 'string' ? JSON.parse(row.aiInsights) : row.aiInsights,
        paretoData: typeof row.paretoData === 'string' ? JSON.parse(row.paretoData) : row.paretoData,
        status: row.status,
        requestedByName: row.requestedByName,
        processingTime: row.processingTime,
        createdAt: row.createdAt,
      }));
    }),

  // Get single analysis
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      const result = await db.execute(
        sql`SELECT * FROM root_cause_analysis WHERE id = ${input.id}`
      ) as any;
      
      if (!result.rows?.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Analysis not found' });
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        analysisType: row.analysisType,
        machineId: row.machineId,
        machineCode: row.machineCode,
        productModelId: row.productModelId,
        productModelCode: row.productModelCode,
        factoryId: row.factoryId,
        startDate: row.startDate,
        endDate: row.endDate,
        dataPointsAnalyzed: row.dataPointsAnalyzed,
        correlationMatrix: typeof row.correlationMatrix === 'string' ? JSON.parse(row.correlationMatrix) : row.correlationMatrix,
        topFactors: typeof row.topFactors === 'string' ? JSON.parse(row.topFactors) : row.topFactors,
        aiInsights: typeof row.aiInsights === 'string' ? JSON.parse(row.aiInsights) : row.aiInsights,
        paretoData: typeof row.paretoData === 'string' ? JSON.parse(row.paretoData) : row.paretoData,
        status: row.status,
        requestedBy: row.requestedBy,
        requestedByName: row.requestedByName,
        processingTime: row.processingTime,
        createdAt: row.createdAt,
      };
    }),
});

// ============ PREDICTIVE ALERT ROUTER ============
export const predictiveAlertRouter = router({
  // List alerts
  list: protectedProcedure
    .input(z.object({
      status: z.enum(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', 'EXPIRED']).optional(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      alertType: z.enum(['DEFECT_SPIKE', 'YIELD_DROP', 'MACHINE_FAILURE', 'QUALITY_DEGRADATION', 'PATTERN_ANOMALY']).optional(),
      machineId: z.number().optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      const { predictiveAlerts } = await import('../../drizzle/schema');
      const { desc, eq, and } = await import('drizzle-orm');
      
      const conditions: any[] = [];
      if (input?.status) conditions.push(eq(predictiveAlerts.status, input.status));
      if (input?.severity) conditions.push(eq(predictiveAlerts.severity, input.severity));
      if (input?.alertType) conditions.push(eq(predictiveAlerts.alertType, input.alertType));
      if (input?.machineId) conditions.push(eq(predictiveAlerts.machineId, input.machineId));
      
      const result = await db.select()
        .from(predictiveAlerts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(predictiveAlerts.createdAt))
        .limit(input?.limit || 50);
      
      return (result || []).map((row: any) => ({
        id: row.id,
        alertType: row.alertType,
        severity: row.severity,
        title: row.title,
        description: row.description,
        predictedValue: row.predictedValue ? parseFloat(row.predictedValue) : null,
        currentValue: row.currentValue ? parseFloat(row.currentValue) : null,
        threshold: row.threshold ? parseFloat(row.threshold) : null,
        confidenceScore: row.confidenceScore ? parseFloat(row.confidenceScore) : null,
        predictedTimeframe: row.predictedTimeframe,
        machineId: row.machineId,
        machineCode: row.machineCode,
        productModelId: row.productModelId,
        productModelCode: row.productModelCode,
        factoryId: row.factoryId,
        aiAnalysis: typeof row.aiAnalysis === 'string' ? JSON.parse(row.aiAnalysis) : row.aiAnalysis,
        status: row.status,
        acknowledgedBy: row.acknowledgedBy,
        acknowledgedAt: row.acknowledgedAt,
        createdAt: row.createdAt,
      }));
    }),

  // Get single alert
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      const result = await db.execute(
        sql`SELECT * FROM predictive_alerts WHERE id = ${input.id}`
      ) as any;
      
      if (!result.rows?.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found' });
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        alertType: row.alertType,
        severity: row.severity,
        title: row.title,
        description: row.description,
        predictedValue: row.predictedValue ? parseFloat(row.predictedValue) : null,
        currentValue: row.currentValue ? parseFloat(row.currentValue) : null,
        threshold: row.threshold ? parseFloat(row.threshold) : null,
        confidenceScore: row.confidenceScore ? parseFloat(row.confidenceScore) : null,
        predictedTimeframe: row.predictedTimeframe,
        machineId: row.machineId,
        machineCode: row.machineCode,
        productModelId: row.productModelId,
        productModelCode: row.productModelCode,
        factoryId: row.factoryId,
        aiAnalysis: typeof row.aiAnalysis === 'string' ? JSON.parse(row.aiAnalysis) : row.aiAnalysis,
        status: row.status,
        acknowledgedBy: row.acknowledgedBy,
        acknowledgedAt: row.acknowledgedAt,
        resolvedBy: row.resolvedBy,
        resolvedAt: row.resolvedAt,
        resolutionNotes: row.resolutionNotes,
        createdAt: row.createdAt,
      };
    }),

  // Acknowledge alert
  acknowledge: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      await db.execute(
        sql`UPDATE predictive_alerts SET status = 'ACKNOWLEDGED', acknowledgedBy = ${ctx.user.id}, acknowledgedAt = NOW() WHERE id = ${input.id}`
      );
      
      return { success: true };
    }),

  // Resolve alert
  resolve: protectedProcedure
    .input(z.object({
      id: z.number(),
      resolutionNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      await db.execute(
        sql`UPDATE predictive_alerts SET status = 'RESOLVED', resolvedBy = ${ctx.user.id}, resolvedAt = NOW(), resolutionNotes = ${input.resolutionNotes || null} WHERE id = ${input.id}`
      );
      
      return { success: true };
    }),

  // Dismiss alert
  dismiss: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      await db.execute(
        sql`UPDATE predictive_alerts SET status = 'DISMISSED' WHERE id = ${input.id}`
      );
      
      return { success: true };
    }),

  // Generate predictions (run analysis and create alerts)
  generatePredictions: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      factoryId: z.number().optional(),
      daysToAnalyze: z.number().min(7).max(90).default(30),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - (input?.daysToAnalyze || 30));
      
      // Get inspection data
      let query = sql`
        SELECT 
          CAST(i."createdAt" AS DATE) as date,
          m.id as machine_id, m.code as machine_code,
          pm.id as product_model_id, pm.code as product_model_code,
          f.id as factory_id,
          COUNT(*) as total,
          SUM(CASE WHEN i.result = 'NG' THEN 1 ELSE 0 END) as ng_count
        FROM product_inspections i
        LEFT JOIN machines m ON i.machineId = m.id
        LEFT JOIN product_models pm ON i.productModelId = pm.id
        LEFT JOIN factories f ON m.factoryId = f.id
        WHERE i."createdAt" >= ${daysAgo}
      `;
      
      if (input?.machineId) {
        query = sql`${query} AND m.id = ${input.machineId}`;
      }
      if (input?.factoryId) {
        query = sql`${query} AND f.id = ${input.factoryId}`;
      }
      
      query = sql`${query} GROUP BY CAST(i."createdAt" AS DATE), m.id, m.code, pm.id, pm.code, f.id ORDER BY date ASC`;
      
      const result = await db.execute(query) as any;
      const rows = result.rows || [];
      
      if (rows.length < 7) {
        return { success: true, alertsCreated: 0, message: 'Not enough data for prediction' };
      }
      
      // Group by machine
      const machineData: Record<string, any[]> = {};
      for (const row of rows) {
        const key = row.machine_code || 'unknown';
        if (!machineData[key]) machineData[key] = [];
        machineData[key].push(row);
      }
      
      let alertsCreated = 0;
      
      for (const [machineCode, data] of Object.entries(machineData)) {
        if (data.length < 7) continue;
        
        // Calculate trend using simple linear regression
        const defectRates = data.map((d: any) => d.total > 0 ? (d.ng_count / d.total) * 100 : 0);
        const n = defectRates.length;
        const sumX = (n * (n - 1)) / 2;
        const sumY = defectRates.reduce((a: number, b: number) => a + b, 0);
        const sumXY = defectRates.reduce((sum: number, y: number, i: number) => sum + i * y, 0);
        const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const avgRate = sumY / n;
        const predictedRate = avgRate + slope * 7; // Predict 7 days ahead
        
        // Check if prediction exceeds threshold
        const threshold = 10; // 10% defect rate threshold
        
        if (predictedRate > threshold && slope > 0.5) {
          const lastRow = data[data.length - 1];
          
          // Create alert
          await db.execute(
            sql`INSERT INTO predictive_alerts 
              (alertType, severity, title, description, predictedValue, currentValue, threshold, confidenceScore, predictedTimeframe, machineId, machineCode, productModelId, productModelCode, factoryId, aiAnalysis, status)
              VALUES (
                'DEFECT_SPIKE',
                ${predictedRate > 20 ? 'CRITICAL' : predictedRate > 15 ? 'HIGH' : 'MEDIUM'},
                ${`Predicted defect spike for ${machineCode}`},
                ${`Analysis shows defect rate trending upward. Current rate: ${avgRate.toFixed(1)}%, Predicted: ${predictedRate.toFixed(1)}%`},
                ${predictedRate},
                ${avgRate},
                ${threshold},
                ${Math.min(85, 60 + n)},
                'next 7 days',
                ${lastRow.machine_id},
                ${machineCode},
                ${lastRow.product_model_id},
                ${lastRow.product_model_code},
                ${lastRow.factory_id},
                ${JSON.stringify({
                  factors: [{ name: 'Trend', contribution: 80, description: `Slope: ${slope.toFixed(2)}%/day` }],
                  recommendations: ['Review machine calibration', 'Check material quality', 'Inspect tooling wear'],
                  dataPoints: n,
                  modelUsed: 'Linear Regression',
                })},
                'ACTIVE'
              )`
          );
          alertsCreated++;
        }
      }
      
      return { success: true, alertsCreated };
    }),

  // Get alert statistics
  stats: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      const result = await db.execute(sql`
        SELECT 
          status,
          severity,
          COUNT(*) as count
        FROM predictive_alerts
        GROUP BY status, severity
      `) as any;
      
      const stats = {
        total: 0,
        byStatus: {} as Record<string, number>,
        bySeverity: {} as Record<string, number>,
        active: 0,
        critical: 0,
      };
      
      for (const row of result.rows || []) {
        const count = parseInt(row.count);
        stats.total += count;
        stats.byStatus[row.status] = (stats.byStatus[row.status] || 0) + count;
        stats.bySeverity[row.severity] = (stats.bySeverity[row.severity] || 0) + count;
        
        if (row.status === 'ACTIVE') stats.active += count;
        if (row.severity === 'CRITICAL' && row.status === 'ACTIVE') stats.critical += count;
      }
      
      return stats;
    }),
});
