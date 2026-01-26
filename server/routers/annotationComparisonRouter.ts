/**
 * Annotation Comparison Router - So sánh annotations giữa các lần kiểm tra
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { 
  annotationComparisonSessions, 
  productInspections, 
  measurementResults,
  annotationHistory 
} from "../../drizzle/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";

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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

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
      });

      // Start comparison processing
      processComparison(result.insertId, input.inspectionIds);

      return { id: result.insertId };
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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

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
        firstSeen: string;
        lastSeen: string;
        recommendations: string[];
      };
      const patterns: PatternType[] = [];

      Array.from(pointStats.entries()).forEach(([pointId, stats]) => {
        const ngRate = stats.ng / stats.total;
        
        if (ngRate >= 0.8) {
          patterns.push({
            id: `recurring-${pointId}`,
            name: `Recurring defect at point ${pointId}`,
            type: "recurring",
            severity: "critical",
            description: `Point ${pointId} has ${(ngRate * 100).toFixed(1)}% NG rate across ${stats.total} inspections`,
            affectedArea: { x: 0, y: 0, width: 100, height: 100 },
            frequency: stats.ng,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            recommendations: ["Check measurement point calibration", "Review inspection criteria"],
          });
        } else if (ngRate >= 0.5) {
          patterns.push({
            id: `intermittent-${pointId}`,
            name: `Intermittent defect at point ${pointId}`,
            type: "intermittent",
            severity: "warning",
            description: `Point ${pointId} has ${(ngRate * 100).toFixed(1)}% NG rate`,
            affectedArea: { x: 0, y: 0, width: 100, height: 100 },
            frequency: stats.ng,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            recommendations: ["Monitor this point closely", "Check for environmental factors"],
          });
        }
      });

      // Update session with patterns
      await db
        .update(annotationComparisonSessions)
        .set({
          detectedPatterns: patterns,
          status: "COMPLETED",
        })
        .where(eq(annotationComparisonSessions.id, input.sessionId));

      return { patterns };
    }),

  // Xóa session
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      await db
        .delete(annotationComparisonSessions)
        .where(eq(annotationComparisonSessions.id, input.id));
      return { success: true };
    }),

  // Lấy inspections theo serial number để so sánh
  getInspectionsBySerial: protectedProcedure
    .input(z.object({
      serialNumber: z.string(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const inspections = await db
        .select()
        .from(productInspections)
        .where(eq(productInspections.serialNumber, input.serialNumber))
        .orderBy(desc(productInspections.inspectionTime))
        .limit(input.limit);

      return inspections;
    }),
});

// Background processing function
async function processComparison(sessionId: number, inspectionIds: number[]) {
  try {
    const db = await getDb();
    if (!db) return;

    await db
      .update(annotationComparisonSessions)
      .set({ status: "PROCESSING" })
      .where(eq(annotationComparisonSessions.id, sessionId));

    // Get all measurement results
    const results = await db
      .select()
      .from(measurementResults)
      .where(inArray(measurementResults.inspectionId, inspectionIds));

    // Group by inspection
    type ResultType = typeof results[0];
    const byInspection = new Map<number, ResultType[]>();
    for (const result of results) {
      const list = byInspection.get(result.inspectionId) || [];
      list.push(result);
      byInspection.set(result.inspectionId, list);
    }

    // Calculate comparison result
    const totalAnnotations = results.length;
    type TimelineType = {
      inspectionId: number;
      timestamp: string;
      annotationCount: number;
      changes: string[];
    };
    const timeline: TimelineType[] = [];

    Array.from(byInspection.entries()).forEach(([inspectionId, inspResults]) => {
      const ngCount = inspResults.filter(r => r.result === "NG").length;
      timeline.push({
        inspectionId,
        timestamp: new Date().toISOString(),
        annotationCount: inspResults.length,
        changes: [`${ngCount} NG points detected`],
      });
    });

    // Update session
    await db
      .update(annotationComparisonSessions)
      .set({
        comparisonResult: {
          totalAnnotations,
          matchingAnnotations: 0,
          newAnnotations: 0,
          removedAnnotations: 0,
          modifiedAnnotations: 0,
          matchPercentage: 0,
          patterns: [],
          timeline,
        },
        status: "COMPLETED",
      })
      .where(eq(annotationComparisonSessions.id, sessionId));

  } catch (error) {
    const db = await getDb();
    if (db) {
      await db
        .update(annotationComparisonSessions)
        .set({
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        })
        .where(eq(annotationComparisonSessions.id, sessionId));
    }
  }
}

export type AnnotationComparisonRouter = typeof annotationComparisonRouter;
