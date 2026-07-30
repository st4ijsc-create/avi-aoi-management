import { protectedProcedure, router } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { getDb } from "../db";
import { sql, eq } from "drizzle-orm";
import { predictiveAlerts, rootCauseAnalysis } from "../../drizzle/schema";
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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      
      const startTime = Date.now();
      
      // Build parameterized conditions  
      const conditions: ReturnType<typeof sql>[] = [
        sql`i."createdAt" BETWEEN ${input.startDate} AND ${input.endDate}`
      ];
      if (input.machineId) conditions.push(sql`m.id = ${input.machineId}`);
      if (input.productModelId) conditions.push(sql`pm.id = ${input.productModelId}`);
      if (input.factoryId) conditions.push(sql`f.id = ${input.factoryId}`);

      const whereClause = sql.join(conditions, sql` AND `);

      // Get inspection data for analysis with LIMIT to prevent unbounded load
      const query = sql`
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
        WHERE ${whereClause}
        LIMIT 500000
      `;
      
      // W0-1 fix (doc 69): the postgres-js driver used by this project's
      // drizzle connection returns query rows DIRECTLY (no `.rows` wrapper —
      // see the established `result.rows || result` pattern already used in
      // server/db/statistics.ts / server/db/inspection.ts / server/utils/kpi.ts).
      // `result.rows || []` always evaluated to `[]` here, so this aggregation
      // silently saw zero inspections regardless of the identifier-quoting fix.
      const result = await db.execute(query) as any;
      const rows = result.rows || result || [];

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
        machineCode = (machineResult.rows ?? machineResult)?.[0]?.code ?? null;
      }
      if (input.productModelId) {
        const productResult = await db.execute(sql`SELECT code FROM product_models WHERE id = ${input.productModelId}`) as any;
        productModelCode = (productResult.rows ?? productResult)?.[0]?.code ?? null;
      }

      // LEGACY (doc69 A2): topFactors above is a relabeled Pareto count (measurement-point
      // NG frequency), and generateRCAInsights below is the SHALLOW LLM-over-aggregate-counts
      // path — no SPC/anomaly/vision/causal-graph/quantitative-correlation evidence. The
      // evidence-rich engine is aiRcaCopilot.runRca, exposed as aiRcaCopilotRouter.diagnose
      // when AI_RCA_COPILOT_ENABLED is on. This endpoint is a distinct manual "Analyze" action
      // (RCA history UI) and is intentionally NOT flag-branched here — converging it onto the
      // copilot is a separate follow-up. Kept as-is (do not delete): still the only
      // DEFECT/YIELD/QUALITY/MACHINE_ANALYSIS entry point when the copilot flag is off.
      // Generate AI insights via LLM (falls back to rule-based if OPENAI_API_KEY not set)
      const aiInsights = await generateRCAInsights(topFactors, {
        totalInspections,
        ngCount,
        defectRate: totalInspections > 0 ? (ngCount / totalInspections) * 100 : 0,
        analysisType: input.analysisType,
        machineCode,
        productModelCode,
      });

      // doc69 Wave2 A3 — close the loop: map any recommendation that maps to a KNOWN
      // registered write-tool + valid args + an existing machine into a 1-tap
      // proposable action. RBAC-gated to the CALLING user (recomputed live, never
      // persisted) — a non-permitted user gets NO entries (advisory text only).
      // Additive: never throws, never changes aiInsights itself.
      const { suggestActionsForRecommendations } = await import("../services/ai/rcaActionSuggester");
      const suggestedActions = await suggestActionsForRecommendations(aiInsights, {
        machineId: input.machineId ?? null,
        user: { id: ctx.user.id, role: String(ctx.user.role), name: ctx.user.name ?? null },
        lang: "vi",
      });

      // Save analysis result — W0-1 fix (doc 69): was a raw INSERT with unquoted
      // camelCase column names (Postgres folds to lowercase → column does not
      // exist), so this write silently failed to persist. The drizzle builder
      // quotes identifiers correctly and matches the physical schema.
      const [insertResult] = await db.insert(rootCauseAnalysis).values({
        analysisType: input.analysisType,
        machineId: input.machineId ?? null,
        machineCode,
        productModelId: input.productModelId ?? null,
        productModelCode,
        factoryId: input.factoryId ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        dataPointsAnalyzed: rows.length,
        correlationMatrix,
        topFactors,
        aiInsights,
        paretoData,
        status: "COMPLETED",
        requestedBy: ctx.user.id,
        requestedByName: ctx.user.name || "Unknown",
        processingTime: Date.now() - startTime,
      }).returning({ id: rootCauseAnalysis.id });

      return {
        id: insertResult?.id,
        analysisType: input.analysisType,
        dataPointsAnalyzed: rows.length,
        topFactors,
        correlationMatrix,
        aiInsights,
        paretoData,
        processingTime: Date.now() - startTime,
        // doc69 Wave2 A3 — additive; [] when nothing maps (advisory text only).
        suggestedActions,
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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      
      let query = sql`SELECT * FROM root_cause_analysis WHERE 1=1`;
      if (input?.analysisType) {
        query = sql`${query} AND "analysisType" = ${input.analysisType}`;
      }
      if (input?.machineId) {
        query = sql`${query} AND "machineId" = ${input.machineId}`;
      }
      query = sql`${query} ORDER BY "createdAt" DESC LIMIT ${input?.limit || 20}`;
      
      const result = await db.execute(query) as any;
      // W0-1 fix (doc 69): see the comment on rootCauseRouter.analyze above —
      // db.execute() rows come back directly, not under `.rows`.
      return ((result.rows || result || []) as any[]).map((row: any) => ({
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
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      
      const result = await db.execute(
        sql`SELECT * FROM root_cause_analysis WHERE id = ${input.id}`
      ) as any;
      // W0-1 fix (doc 69): db.execute() rows come back directly, not under
      // `.rows` — `result.rows?.length` was always undefined → always NOT_FOUND.
      const resultRows = (result.rows ?? result ?? []) as any[];

      if (!resultRows.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Analysis not found' });
      }

      const row = resultRows[0];
      const aiInsightsParsed = typeof row.aiInsights === 'string' ? JSON.parse(row.aiInsights) : row.aiInsights;

      // doc69 Wave2 A3 — recomputed LIVE for the CURRENT viewer (never persisted,
      // never stale RBAC): [] when nothing maps or the viewer isn't permitted.
      const { suggestActionsForRecommendations } = await import("../services/ai/rcaActionSuggester");
      const suggestedActions = await suggestActionsForRecommendations(aiInsightsParsed ?? { recommendations: [] }, {
        machineId: row.machineId ?? null,
        user: { id: ctx.user.id, role: String(ctx.user.role), name: ctx.user.name ?? null },
        lang: "vi",
      });

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
        aiInsights: aiInsightsParsed,
        paretoData: typeof row.paretoData === 'string' ? JSON.parse(row.paretoData) : row.paretoData,
        status: row.status,
        requestedBy: row.requestedBy,
        requestedByName: row.requestedByName,
        processingTime: row.processingTime,
        createdAt: row.createdAt,
        suggestedActions,
      };
    }),

  // Update an analysis record — review/triage fields only.
  // status is a real column; confirmedCause/correctiveAction/notes are persisted
  // inside the existing aiInsights JSON column under a `review` sub-object (the
  // table has no dedicated columns and is owned by a migration-only wave).
  // RBAC: analytics_root_cause/canEdit. Fail-safe.
  update: protectedProcedure
    .use(requirePermission("analytics_root_cause", "canEdit"))
    .input(z.object({
      id: z.number(),
      status: z.enum(['COMPLETED', 'IN_PROGRESS', 'FAILED']).optional(),
      confirmedCause: z.string().max(2000).optional(),
      correctiveAction: z.string().max(2000).optional(),
      notes: z.string().max(4000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const existingResult = await db.execute(
        sql`SELECT id, "aiInsights" FROM root_cause_analysis WHERE id = ${input.id}`
      ) as any;
      // W0-1 fix (doc 69): db.execute() rows come back directly, not under
      // `.rows` — `existingResult.rows?.length` was always undefined, so this
      // pre-read ALWAYS threw NOT_FOUND and the write below never ran.
      const existingRows = (existingResult.rows ?? existingResult ?? []) as any[];
      if (!existingRows.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Analysis not found' });
      }

      const existingRow = existingRows[0];
      const aiInsights = typeof existingRow.aiInsights === 'string'
        ? JSON.parse(existingRow.aiInsights)
        : (existingRow.aiInsights ?? {});

      // Merge review fields into a dedicated, non-destructive sub-object.
      const prevReview = (aiInsights && typeof aiInsights === 'object' && aiInsights.review) || {};
      const review: Record<string, unknown> = { ...prevReview };
      if (input.confirmedCause !== undefined) review.confirmedCause = input.confirmedCause;
      if (input.correctiveAction !== undefined) review.correctiveAction = input.correctiveAction;
      if (input.notes !== undefined) review.notes = input.notes;
      review.reviewedBy = ctx.user.id;
      review.reviewedByName = ctx.user.name || 'Unknown';
      review.reviewedAt = new Date().toISOString();
      const nextInsights = { ...(aiInsights ?? {}), review };

      // W0-1 fix (doc 69): was a raw UPDATE with unquoted `aiInsights` (Postgres
      // folds to `aiinsights` → column does not exist), silently discarding the
      // review triage data. The drizzle builder quotes identifiers correctly.
      if (input.status !== undefined) {
        await db.update(rootCauseAnalysis)
          .set({ status: input.status, aiInsights: nextInsights })
          .where(eq(rootCauseAnalysis.id, input.id));
      } else {
        await db.update(rootCauseAnalysis)
          .set({ aiInsights: nextInsights })
          .where(eq(rootCauseAnalysis.id, input.id));
      }

      return { success: true, id: input.id, review };
    }),

  // Delete an analysis record. RBAC: analytics_root_cause/canDelete. Fail-safe.
  delete: protectedProcedure
    .use(requirePermission("analytics_root_cause", "canDelete"))
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const existingResult = await db.execute(
        sql`SELECT id FROM root_cause_analysis WHERE id = ${input.id}`
      ) as any;
      // W0-1 fix (doc 69): db.execute() rows come back directly, not under `.rows`.
      if (!((existingResult.rows ?? existingResult ?? []) as any[]).length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Analysis not found' });
      }

      await db.execute(sql`DELETE FROM root_cause_analysis WHERE id = ${input.id}`);
      return { success: true, id: input.id, deleted: true };
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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      
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
        // Wave 3 Task 7 fix — trước đây liệt kê tay thiếu 2 trường này nên
        // client nhận `undefined` VĨNH VIỄN dù migration 0308 đã chạy và DB
        // đã có occurrenceCount>1 thật. Không parseFloat/ép kiểu gì thêm —
        // occurrenceCount là integer NOT NULL default 1 nên luôn là number;
        // lastOccurredAt có thể null (chưa tái diễn lần nào).
        occurrenceCount: row.occurrenceCount,
        lastOccurredAt: row.lastOccurredAt,
        createdAt: row.createdAt,
        // Task 6 (Wave 4) — same class of bug as occurrenceCount/lastOccurredAt
        // above (Wave 3 Task 7): the `.map()` here re-lists columns by hand, so
        // anything not spelled out is `undefined` on the client FOREVER even
        // though the DB row has it. alertExpirySweeper.ts writes a human reason
        // into resolutionNotes when it auto-closes a no-longer-recurring alert
        // (status → EXPIRED) — without this field the reason is unreadable from
        // any client that calls `list` (the single-row `get` query below already
        // had it). resolutionNotes can be null (row closed some other way, or
        // still open) — client must treat null/empty as "no reason", never print
        // "undefined". updatedAt lets the UI order/label "recently closed" rows
        // by when they actually closed (EXPIRED rows have no resolvedAt set).
        resolutionNotes: row.resolutionNotes,
        updatedAt: row.updatedAt,
      }));
    }),

  // Get single alert
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      
      const result = await db.execute(
        sql`SELECT * FROM predictive_alerts WHERE id = ${input.id}`
      ) as any;
      // W0-1 fix (doc 69): db.execute() rows come back directly, not under
      // `.rows` — `result.rows?.length` was always undefined → always NOT_FOUND.
      const resultRows = (result.rows ?? result ?? []) as any[];

      if (!resultRows.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found' });
      }

      const row = resultRows[0];
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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // W0-1 fix (doc 69): was a raw UPDATE with unquoted `acknowledgedBy`/
      // `acknowledgedAt` (Postgres folds to lowercase → column does not exist),
      // silently discarding the acknowledgement. The drizzle builder quotes
      // identifiers correctly and the write now actually persists.
      await db.update(predictiveAlerts)
        .set({ status: 'ACKNOWLEDGED', acknowledgedBy: ctx.user.id, acknowledgedAt: new Date() })
        .where(eq(predictiveAlerts.id, input.id));

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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // W0-1 fix (doc 69): was a raw UPDATE with unquoted `resolvedBy`/
      // `resolvedAt`/`resolutionNotes` — same silent no-persist bug as above.
      await db.update(predictiveAlerts)
        .set({
          status: 'RESOLVED',
          resolvedBy: ctx.user.id,
          resolvedAt: new Date(),
          resolutionNotes: input.resolutionNotes || null,
        })
        .where(eq(predictiveAlerts.id, input.id));

      return { success: true };
    }),

  // Dismiss alert
  dismiss: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      
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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      
      const now = new Date();
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - (input?.daysToAnalyze || 30));

      // Get inspection data — W0-1 fix (doc 69): this SELECT had two distinct
      // bugs: (1) unquoted camelCase identifiers (i.machineId/productModelId,
      // Postgres folds to lowercase → column does not exist) and a reference to
      // a non-existent `i.result` (real column is `i."overallResult"`, see
      // drizzle/schema/inspection.ts); (2) `machines` has NO `factoryId` column
      // at all — factory is only reachable via the station → line → workshop →
      // factory chain (same chain rootCauseRouter.analyze already uses above).
      let query = sql`
        SELECT
          CAST(i."createdAt" AS DATE) as date,
          m.id as machine_id, m.code as machine_code,
          pm.id as product_model_id, pm.code as product_model_code,
          f.id as factory_id,
          COUNT(*) as total,
          SUM(CASE WHEN i."overallResult" = 'NG' THEN 1 ELSE 0 END) as ng_count
        FROM product_inspections i
        LEFT JOIN machines m ON i."machineId" = m.id
        LEFT JOIN product_models pm ON i."productModelId" = pm.id
        LEFT JOIN stations st ON m."stationId" = st.id
        LEFT JOIN production_lines pl ON st."lineId" = pl.id
        LEFT JOIN workshops w ON pl."workshopId" = w.id
        LEFT JOIN factories f ON w."factoryId" = f.id
        WHERE i."createdAt" >= ${daysAgo.toISOString()}
      `;
      
      if (input?.machineId) {
        query = sql`${query} AND m.id = ${input.machineId}`;
      }
      if (input?.factoryId) {
        query = sql`${query} AND f.id = ${input.factoryId}`;
      }
      
      query = sql`${query} GROUP BY CAST(i."createdAt" AS DATE), m.id, m.code, pm.id, pm.code, f.id ORDER BY date ASC`;
      
      const result = await db.execute(query) as any;
      // W0-1 fix (doc 69): db.execute() rows come back directly, not under
      // `.rows` — `result.rows || []` always evaluated to `[]`, so this endpoint
      // ALWAYS returned "not enough data" / created zero alerts.
      const rows = result.rows || result || [];

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

      // doc69 Wave 2 / A2 — REAL forecast signal (replaces the fake heuristic):
      // the previous inline 7-point OLS + hardcoded "predictedRate > 10%" gate +
      // hardcoded recommendation strings, mislabeled `modelUsed: 'Linear
      // Regression'`, are GONE. Per eligible machine, the actual predicted
      // defect-rate/severity/confidence/recommendations now come from the
      // yield-forecast engine (Holt-Winters/EWMA/Linear per data-length, real
      // confidence tied to forecast error) + the real defect Pareto (+ optional
      // quantitative upstream correlation when RCA_QUANTITATIVE_ENABLED).
      const { forecastYield, getDefectTrend, getDefectPareto } = await import("../services/aiInspectionAnalytics");
      const { deriveDefectSpikeSignal } = await import("../services/aiPredictiveAlertService");
      const { correlateStationDefect } = await import("../services/ai/defectCorrelationService");

      for (const [machineCode, data] of Object.entries(machineData)) {
        // Cheap pre-filter only (matches the old minimum-data bar) — the
        // AUTHORITATIVE eligibility/decision comes from deriveDefectSpikeSignal
        // below, fed by the real (factory-day-bucketed) trend/forecast.
        if (data.length < 7) continue;

        const lastRow = data[data.length - 1];
        const machineId: number | null = lastRow.machine_id ?? null;
        if (machineId == null) continue; // can't scope the real forecast engine without a machine — honest skip

        try {
          const period = { startDate: daysAgo, endDate: now, machineId };
          const [trend, forecast, pareto] = await Promise.all([
            getDefectTrend(period),
            forecastYield(period, 7),
            getDefectPareto(period),
          ]);

          // Optional additive evidence — flag-gated + fail-safe inside the
          // service itself (RCA_QUANTITATIVE_ENABLED, default OFF → ok:false).
          const correlation = await correlateStationDefect({ machineId });
          const correlationFactors = correlation.ok ? correlation.factors : [];

          const signal = deriveDefectSpikeSignal({ trend, forecast, pareto, correlationFactors });
          if (!signal) continue; // insufficient data / not a real rising trend — no fabricated alert

          // Wave 4 §5 — đi qua CÙNG MỘT CỬA với đường tự động (routeAlert): gộp
          // một-cảnh-báo-mở theo (machineId, alertType), đặt hạn dùng (expiresAt),
          // ghi nhật ký lần-tái-diễn (predictive_alert_occurrences). INSERT thẳng
          // (trước đây) bỏ qua cả ba — bấm nút vài lần dựng lại đúng đống cảnh báo
          // trùng lặp/không-hết-hạn mà Wave 3 vừa dọn, và bỏ sót lần-tái-diễn khỏi KPI.
          //
          // SmartAlertEvent.factoryId / .productModelId là `number | undefined`
          // (KHÔNG `| null`) — dùng `?? undefined` để giữ đúng kiểu, không ép `as any`.
          const { routeAlert } = await import("../services/aiSmartAlertRouter");
          await routeAlert({
            type: signal.alertType,
            machineId,
            factoryId: lastRow.factory_id ?? undefined,
            productModelId: lastRow.product_model_id ?? undefined,
            severity: signal.severity,
            message: `Analysis shows defect rate trending upward. Current rate: ${signal.currentValue.toFixed(1)}%, Predicted: ${signal.predictedValue.toFixed(1)}%`,
            data: {
              confidence: signal.confidenceScore,
              predictedTimeframe: signal.predictedTimeframe,
              currentValue: signal.currentValue,
              threshold: signal.alertThreshold,
              factors: signal.factors,
              recommendations: signal.recommendations,
              // routeAlert đọc event.data.dataPoints để lấp aiAnalysisPayload.dataPoints —
              // thiếu trường này thì cột luôn ghi 0 dù forecast thật có đủ điểm dữ liệu.
              dataPoints: signal.dataPoints,
            },
          });
          alertsCreated++;
        } catch (err) {
          // Fail-safe per machine — one machine's forecast failure never aborts the batch.
          console.error(`[predictiveAlertRouter.generatePredictions] forecast failed for machine ${machineCode}:`, err);
        }
      }

      return { success: true, alertsCreated };
    }),

  // Get alert statistics
  stats: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      
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
      
      // W0-1 fix (doc 69): db.execute() rows come back directly, not under
      // `.rows` — `result.rows || []` always evaluated to `[]`, so stats() had
      // always reported all-zero counts regardless of actual data.
      for (const row of (result.rows || result || []) as any[]) {
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
