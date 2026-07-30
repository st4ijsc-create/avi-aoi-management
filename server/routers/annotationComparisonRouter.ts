/**
 * Annotation Comparison Router - So sánh annotations giữa các lần kiểm tra
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { 
  annotationComparisonSessions, 
  productInspections, 
  measurementResults,
  annotationHistory,
  machines,
  productModels
} from "../../drizzle/schema";
import { eq, and, inArray, desc, sql, between } from "drizzle-orm";
import { renderReport, resolveBranding, type ReportLocale } from "../services/universalExportService";

// ── Pure comparison helpers (exported for unit tests) ────────────────────────

export interface ComparisonDetailRow {
  pointId: number;
  result1: string | null;
  result2: string | null;
  value1: string | null;
  value2: string | null;
  status: "matching" | "different" | "only1" | "only2";
}

export interface MeasurementComparison {
  matching: number;
  different: number;
  onlyIn1: number;
  onlyIn2: number;
  details: ComparisonDetailRow[];
}

interface MinimalResult {
  pointDefId: number;
  result: string | null;
  measuredValue: string | null;
}

/**
 * Diff two inspections' measurement results by point definition. PURE — the
 * substance behind the annotation "report" (unit-tested independently of the DB
 * and the PDF renderer).
 */
export function buildMeasurementComparison(
  results1: MinimalResult[],
  results2: MinimalResult[],
): MeasurementComparison {
  const out: MeasurementComparison = { matching: 0, different: 0, onlyIn1: 0, onlyIn2: 0, details: [] };
  const map2 = new Map<number, MinimalResult>();
  results2.forEach((r) => map2.set(r.pointDefId, r));

  for (const r1 of results1) {
    const r2 = map2.get(r1.pointDefId);
    if (r2) {
      if (r1.result === r2.result) {
        out.matching++;
        out.details.push({ pointId: r1.pointDefId, result1: r1.result, result2: r2.result, value1: r1.measuredValue, value2: r2.measuredValue, status: "matching" });
      } else {
        out.different++;
        out.details.push({ pointId: r1.pointDefId, result1: r1.result, result2: r2.result, value1: r1.measuredValue, value2: r2.measuredValue, status: "different" });
      }
      map2.delete(r1.pointDefId);
    } else {
      out.onlyIn1++;
      out.details.push({ pointId: r1.pointDefId, result1: r1.result, result2: null, value1: r1.measuredValue, value2: null, status: "only1" });
    }
  }
  map2.forEach((r2, pointId) => {
    out.onlyIn2++;
    out.details.push({ pointId, result1: null, result2: r2.result, value1: null, value2: r2.measuredValue, status: "only2" });
  });
  return out;
}

export interface ComparisonPattern {
  type: string;
  severity: string;
  description: string;
  frequency: number;
}

/** Recurring/intermittent defect patterns across both inspections. PURE. */
export function detectComparisonPatterns(results: Array<{ pointDefId: number; result: string | null }>): ComparisonPattern[] {
  const pointStats = new Map<number, { ng: number; total: number }>();
  for (const r of results) {
    const s = pointStats.get(r.pointDefId) || { ng: 0, total: 0 };
    s.total++;
    if (r.result === "NG") s.ng++;
    pointStats.set(r.pointDefId, s);
  }
  const patterns: ComparisonPattern[] = [];
  pointStats.forEach((s, pointId) => {
    const ngRate = s.total > 0 ? s.ng / s.total : 0;
    if (ngRate >= 0.8) {
      patterns.push({ type: "Recurring Defect", severity: "Critical", description: `Point ${pointId} có tỷ lệ NG ${(ngRate * 100).toFixed(1)}%`, frequency: s.ng });
    } else if (ngRate >= 0.3) {
      patterns.push({ type: "Intermittent Defect", severity: "Warning", description: `Point ${pointId} có tỷ lệ NG ${(ngRate * 100).toFixed(1)}%`, frequency: s.ng });
    }
  });
  return patterns;
}

export const annotationComparisonRouter = router({
  // Tạo phiên so sánh mới
  createSession: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      productModelId: z.number().optional(),
      serialNumber: z.string().optional(),
      machineId: z.number().optional(),
      inspectionIds: z.array(z.number()).min(2).max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Verify all inspections exist
      const inspections = await db
        .select()
        .from(productInspections)
        .where(inArray(productInspections.id, input.inspectionIds));
      
      if (inspections.length !== input.inspectionIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Một hoặc nhiều inspection không tồn tại",
        });
      }

      const [result] = await db.insert(annotationComparisonSessions).values({
        name: input.name,
        description: input.description,
        productModelId: input.productModelId,
        serialNumber: input.serialNumber,
        machineId: input.machineId,
        inspectionIds: input.inspectionIds,
        status: "PENDING",
        createdBy: ctx.user.id,
        createdByName: ctx.user.name || ctx.user.username,
      }).returning({ id: annotationComparisonSessions.id });

      // Start comparison processing
      processComparison(result.id, input.inspectionIds);

      return { id: result.id };
    }),

  // Lấy danh sách sessions
  list: protectedProcedure
    .input(z.object({
      productModelId: z.number().optional(),
      serialNumber: z.string().optional(),
      machineId: z.number().optional(),
      status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { sessions: [], total: 0 };

      const conditions = [];
      
      if (input.productModelId) {
        conditions.push(eq(annotationComparisonSessions.productModelId, input.productModelId));
      }
      if (input.serialNumber) {
        conditions.push(eq(annotationComparisonSessions.serialNumber, input.serialNumber));
      }
      if (input.machineId) {
        conditions.push(eq(annotationComparisonSessions.machineId, input.machineId));
      }
      if (input.status) {
        conditions.push(eq(annotationComparisonSessions.status, input.status));
      }

      const sessions = await db
        .select()
        .from(annotationComparisonSessions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(annotationComparisonSessions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(annotationComparisonSessions)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return {
        sessions,
        total: countResult?.count || 0,
      };
    }),

  // Lấy chi tiết session
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const [session] = await db
        .select()
        .from(annotationComparisonSessions)
        .where(eq(annotationComparisonSessions.id, input.id));

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session không tồn tại",
        });
      }

      // Get inspection details
      const inspections = await db
        .select()
        .from(productInspections)
        .where(inArray(productInspections.id, session.inspectionIds as number[]));

      return {
        ...session,
        inspections,
      };
    }),

  // So sánh annotations giữa 2 inspections
  compareTwo: protectedProcedure
    .input(z.object({
      inspectionId1: z.number(),
      inspectionId2: z.number(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const [results1, results2] = await Promise.all([
        db.select().from(measurementResults)
          .where(eq(measurementResults.inspectionId, input.inspectionId1)),
        db.select().from(measurementResults)
          .where(eq(measurementResults.inspectionId, input.inspectionId2)),
      ]);

      // Compare by point definition
      const comparison = {
        matching: [] as Array<{ point: number; result: string | null }>,
        different: [] as Array<{ point: number; result1: string | null; result2: string | null; value1: string | null; value2: string | null }>,
        onlyIn1: [] as Array<{ point: number; result: string | null }>,
        onlyIn2: [] as Array<{ point: number; result: string | null }>,
      };

      type MeasurementResultType = typeof results1[0];
      const results2Map = new Map<number, MeasurementResultType>();
      results2.forEach(r => results2Map.set(r.pointDefId, r));

      for (const r1 of results1) {
        const r2 = results2Map.get(r1.pointDefId);
        if (r2) {
          if (r1.result === r2.result) {
            comparison.matching.push({ point: r1.pointDefId, result: r1.result });
          } else {
            comparison.different.push({
              point: r1.pointDefId,
              result1: r1.result,
              result2: r2.result,
              value1: r1.measuredValue,
              value2: r2.measuredValue,
            });
          }
          results2Map.delete(r1.pointDefId);
        } else {
          comparison.onlyIn1.push({ point: r1.pointDefId, result: r1.result });
        }
      }

      results2Map.forEach((r2, pointId) => {
        comparison.onlyIn2.push({ point: pointId, result: r2.result });
      });

      return {
        inspection1: { id: input.inspectionId1, totalPoints: results1.length },
        inspection2: { id: input.inspectionId2, totalPoints: results2.length },
        comparison,
        matchPercentage: results1.length > 0 
          ? (comparison.matching.length / results1.length) * 100 
          : 0,
      };
    }),

  // Phát hiện defect patterns
  detectPatterns: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const [session] = await db
        .select()
        .from(annotationComparisonSessions)
        .where(eq(annotationComparisonSessions.id, input.sessionId));

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session không tồn tại",
        });
      }

      // Get all measurement results for inspections
      const results = await db
        .select()
        .from(measurementResults)
        .where(inArray(measurementResults.inspectionId, session.inspectionIds as number[]));

      // Analyze patterns
      const pointStats = new Map<number, { ng: number; ok: number; total: number }>();
      
      for (const result of results) {
        const stats = pointStats.get(result.pointDefId) || { ng: 0, ok: 0, total: 0 };
        stats.total++;
        if (result.result === "NG") stats.ng++;
        else if (result.result === "OK") stats.ok++;
        pointStats.set(result.pointDefId, stats);
      }

      // Identify patterns
      type PatternType = {
        id: string;
        name: string;
        type: "recurring" | "intermittent" | "progressive" | "new";
        severity: "critical" | "warning" | "info";
        description: string;
        affectedArea: { x: number; y: number; width: number; height: number };
        frequency: number;
        confidence: number;
        firstSeen: string;
        lastSeen: string;
        recommendations: string[];
      };

      const patterns: PatternType[] = [];
      
      pointStats.forEach((stats, pointId) => {
        const ngRate = stats.ng / stats.total;
        
        if (ngRate >= 0.8) {
          patterns.push({
            id: `recurring-${pointId}`,
            name: `Recurring Defect at Point ${pointId}`,
            type: "recurring",
            severity: "critical",
            description: `Point ${pointId} có tỷ lệ NG ${(ngRate * 100).toFixed(1)}% trong ${stats.total} lần kiểm tra`,
            affectedArea: { x: 0, y: 0, width: 100, height: 100 },
            frequency: stats.ng,
            confidence: ngRate,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            recommendations: [
              'Kiểm tra thiết bị kiểm tra tại điểm này',
              'Đánh giá lại tiêu chuẩn kiểm tra',
              'Xem xét quy trình sản xuất liên quan',
            ],
          });
        } else if (ngRate >= 0.3 && ngRate < 0.8) {
          patterns.push({
            id: `intermittent-${pointId}`,
            name: `Intermittent Defect at Point ${pointId}`,
            type: "intermittent",
            severity: "warning",
            description: `Point ${pointId} có tỷ lệ NG ${(ngRate * 100).toFixed(1)}% - cần theo dõi`,
            affectedArea: { x: 0, y: 0, width: 100, height: 100 },
            frequency: stats.ng,
            confidence: ngRate,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            recommendations: [
              'Theo dõi xu hướng trong các lần kiểm tra tiếp theo',
              'Ghi nhận điều kiện môi trường khi xảy ra lỗi',
            ],
          });
        }
      });

      // Update session with patterns
      await db.update(annotationComparisonSessions)
        .set({
          comparisonResult: {
            totalAnnotations: results.length,
            matchingAnnotations: 0,
            newAnnotations: 0,
            removedAnnotations: 0,
            modifiedAnnotations: 0,
            matchPercentage: 0,
            patterns: patterns.map(p => ({
              type: p.type,
              description: p.description,
              affectedPoints: [parseInt(p.id.split('-')[1]) || 0],
            })),
            timeline: [],
          },
          detectedPatterns: patterns,
          status: "COMPLETED",
        })
        .where(eq(annotationComparisonSessions.id, input.sessionId));

      return { patterns };
    }),

  // Generate a REAL PDF report for an annotation comparison (doc 32 §2 item 20).
  // Historically this returned JSON despite the "Pdf" name; it now renders an
  // actual branded, VN-font PDF through the canonical renderReport engine (R2-A)
  // and returns it as base64 alongside the structured summary.
  generatePdfReport: protectedProcedure
    .input(z.object({
      inspectionId1: z.number(),
      inspectionId2: z.number(),
      includeImages: z.boolean().default(true),
      includePatterns: z.boolean().default(true),
      locale: z.enum(["vi", "en", "zh"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // Get inspection details
      const [inspection1, inspection2] = await Promise.all([
        db.select({
          inspection: productInspections,
          machine: machines,
          productModel: productModels,
        })
          .from(productInspections)
          .leftJoin(machines, eq(productInspections.machineId, machines.id))
          .leftJoin(productModels, eq(productInspections.productModelId, productModels.id))
          .where(eq(productInspections.id, input.inspectionId1))
          .then(r => r[0]),
        db.select({
          inspection: productInspections,
          machine: machines,
          productModel: productModels,
        })
          .from(productInspections)
          .leftJoin(machines, eq(productInspections.machineId, machines.id))
          .leftJoin(productModels, eq(productInspections.productModelId, productModels.id))
          .where(eq(productInspections.id, input.inspectionId2))
          .then(r => r[0]),
      ]);

      if (!inspection1 || !inspection2) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Inspection không tồn tại",
        });
      }

      // Get measurement results
      const [results1, results2] = await Promise.all([
        db.select().from(measurementResults)
          .where(eq(measurementResults.inspectionId, input.inspectionId1)),
        db.select().from(measurementResults)
          .where(eq(measurementResults.inspectionId, input.inspectionId2)),
      ]);

      // Calculate comparison stats (pure helper — unit-tested).
      const comparison = buildMeasurementComparison(results1, results2);

      const patterns: ComparisonPattern[] = input.includePatterns
        ? detectComparisonPatterns([...results1, ...results2])
        : [];

      // Structured summary (kept for the caller / audit).
      const reportData = {
        title: "Báo cáo so sánh Annotation",
        generatedAt: new Date().toISOString(),
        generatedBy: ctx.user.name || ctx.user.username,
        inspection1: {
          id: inspection1.inspection.id,
          serialNumber: inspection1.inspection.serialNumber,
          inspectionTime: inspection1.inspection.inspectionTime,
          overallResult: inspection1.inspection.overallResult,
          machineName: inspection1.machine?.name || 'N/A',
          productModel: inspection1.productModel?.name || 'N/A',
          totalPoints: results1.length,
          okCount: results1.filter(r => r.result === 'OK').length,
          ngCount: results1.filter(r => r.result === 'NG').length,
        },
        inspection2: {
          id: inspection2.inspection.id,
          serialNumber: inspection2.inspection.serialNumber,
          inspectionTime: inspection2.inspection.inspectionTime,
          overallResult: inspection2.inspection.overallResult,
          machineName: inspection2.machine?.name || 'N/A',
          productModel: inspection2.productModel?.name || 'N/A',
          totalPoints: results2.length,
          okCount: results2.filter(r => r.result === 'OK').length,
          ngCount: results2.filter(r => r.result === 'NG').length,
        },
        comparison: {
          matchingCount: comparison.matching,
          differentCount: comparison.different,
          onlyIn1Count: comparison.onlyIn1,
          onlyIn2Count: comparison.onlyIn2,
          matchPercentage: results1.length > 0
            ? ((comparison.matching / results1.length) * 100).toFixed(1)
            : '0',
          details: comparison.details,
        },
        patterns,
      };

      // ── Render a REAL PDF through the canonical engine (R2-A) ──────────────
      const locale = (input.locale ?? "vi") as ReportLocale;
      const branding = await resolveBranding().catch(() => ({}));
      const statusLabel: Record<ComparisonDetailRow["status"], string> = {
        matching: "Trùng khớp",
        different: "Khác biệt",
        only1: "Chỉ có ở #1",
        only2: "Chỉ có ở #2",
      };
      const rendered = await renderReport({
        type: "annotation_comparison",
        title: reportData.title,
        subtitle: `#${reportData.inspection1.id} (${reportData.inspection1.serialNumber ?? "?"}) ↔ #${reportData.inspection2.id} (${reportData.inspection2.serialNumber ?? "?"}) · khớp ${reportData.comparison.matchPercentage}%`,
        format: "pdf",
        locale,
        branding,
        fileName: `comparison-${reportData.inspection1.serialNumber ?? reportData.inspection1.id}-${reportData.inspection2.serialNumber ?? reportData.inspection2.id}`,
        columns: [
          { key: "pointId", header: "Điểm", format: "number" },
          { key: "result1", header: "KQ #1" },
          { key: "value1", header: "Giá trị #1" },
          { key: "result2", header: "KQ #2" },
          { key: "value2", header: "Giá trị #2" },
          { key: "statusLabel", header: "Trạng thái" },
        ],
        data: comparison.details.map((d) => ({
          pointId: d.pointId,
          result1: d.result1 ?? "",
          value1: d.value1 ?? "",
          result2: d.result2 ?? "",
          value2: d.value2 ?? "",
          statusLabel: statusLabel[d.status],
        })),
      });

      return {
        ...reportData,
        // The actual rendered PDF — the caller downloads this instead of JSON.
        pdfBase64: rendered.buffer.toString("base64"),
        pdfFileName: rendered.filename,
        pdfMimeType: rendered.mimeType,
      };
    }),

  // Get trend data for defects over time
  getTrendData: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      groupBy: z.enum(["day", "week", "month"]).default("day"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { trends: [], summary: { totalInspections: 0, totalDefects: 0, avgDefectRate: 0 } };

      const conditions = [];
      
      if (input.machineId) {
        conditions.push(eq(productInspections.machineId, input.machineId));
      }
      if (input.productModelId) {
        conditions.push(eq(productInspections.productModelId, input.productModelId));
      }
      if (input.dateFrom && input.dateTo) {
        conditions.push(
          between(
            productInspections.inspectionTime, 
            new Date(input.dateFrom), 
            new Date(input.dateTo)
          )
        );
      }

      // Get date format based on groupBy - PostgreSQL TO_CHAR format
      let dateFormat: string;
      switch (input.groupBy) {
        case "week":
          dateFormat = "IYYY-IW"; // Year-Week (ISO week)
          break;
        case "month":
          dateFormat = "YYYY-MM"; // Year-Month
          break;
        default:
          dateFormat = "YYYY-MM-DD"; // Year-Month-Day
      }

      const trendData = await db
        .select({
          period: sql<string>`TO_CHAR(${productInspections.inspectionTime}, ${sql.raw(`'${dateFormat}'`)})`,
          totalInspections: sql<number>`COUNT(*)`,
          okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
          ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
          ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
        })
        .from(productInspections)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(sql`TO_CHAR(${productInspections.inspectionTime}, ${sql.raw(`'${dateFormat}'`)})`)
        .orderBy(sql`TO_CHAR(${productInspections.inspectionTime}, ${sql.raw(`'${dateFormat}'`)})`);

      // Calculate summary
      const summary = trendData.reduce((acc, item) => {
        acc.totalInspections += item.totalInspections;
        acc.totalDefects += item.ngCount;
        return acc;
      }, { totalInspections: 0, totalDefects: 0, avgDefectRate: 0 });

      summary.avgDefectRate = summary.totalInspections > 0 
        ? (summary.totalDefects / summary.totalInspections) * 100 
        : 0;

      return {
        trends: trendData.map(item => ({
          period: item.period,
          totalInspections: item.totalInspections,
          okCount: item.okCount,
          ngCount: item.ngCount,
          ntfCount: item.ntfCount,
          defectRate: item.totalInspections > 0 
            ? ((item.ngCount / item.totalInspections) * 100).toFixed(2) 
            : '0',
          yieldRate: item.totalInspections > 0 
            ? (((item.okCount + item.ntfCount) / item.totalInspections) * 100).toFixed(2) 
            : '0',
        })),
        summary,
      };
    }),
});

// Helper function to process comparison asynchronously
async function processComparison(sessionId: number, inspectionIds: number[]) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.update(annotationComparisonSessions)
      .set({ status: "PROCESSING" })
      .where(eq(annotationComparisonSessions.id, sessionId));

    // Get all measurement results
    const results = await db
      .select()
      .from(measurementResults)
      .where(inArray(measurementResults.inspectionId, inspectionIds));

    // Group by point and analyze
    const pointAnalysis = new Map<number, Array<{ inspectionId: number; result: string | null; value: string | null }>>();
    
    for (const result of results) {
      const existing = pointAnalysis.get(result.pointDefId) || [];
      existing.push({
        inspectionId: result.inspectionId,
        result: result.result,
        value: result.measuredValue,
      });
      pointAnalysis.set(result.pointDefId, existing);
    }

    // Calculate comparison results
    const comparisonResults = {
      totalPoints: pointAnalysis.size,
      consistentPoints: 0,
      inconsistentPoints: 0,
      pointDetails: [] as Array<{
        pointId: number;
        results: Array<{ inspectionId: number; result: string | null }>;
        isConsistent: boolean;
      }>,
    };

    pointAnalysis.forEach((pointResults, pointId) => {
      const uniqueResults = new Set(pointResults.map(r => r.result));
      const isConsistent = uniqueResults.size === 1;
      
      if (isConsistent) {
        comparisonResults.consistentPoints++;
      } else {
        comparisonResults.inconsistentPoints++;
      }

      comparisonResults.pointDetails.push({
        pointId,
        results: pointResults,
        isConsistent,
      });
    });

    await db.update(annotationComparisonSessions)
      .set({
        status: "COMPLETED",
        comparisonResult: {
          totalAnnotations: comparisonResults.totalPoints,
          matchingAnnotations: comparisonResults.consistentPoints,
          newAnnotations: 0,
          removedAnnotations: 0,
          modifiedAnnotations: comparisonResults.inconsistentPoints,
          matchPercentage: comparisonResults.totalPoints > 0 
            ? (comparisonResults.consistentPoints / comparisonResults.totalPoints) * 100 
            : 0,
          patterns: [],
          timeline: comparisonResults.pointDetails.map((detail, idx) => ({
            inspectionId: detail.results[0]?.inspectionId || 0,
            timestamp: new Date().toISOString(),
            annotationCount: detail.results.length,
            changes: detail.isConsistent ? [] : ['Result changed'],
          })),
        },
      })
      .where(eq(annotationComparisonSessions.id, sessionId));
  } catch (error) {
    await db.update(annotationComparisonSessions)
      .set({ status: "FAILED" })
      .where(eq(annotationComparisonSessions.id, sessionId));
  }
}
