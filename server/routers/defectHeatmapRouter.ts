/**
 * Defect Heatmap Router - Heatmap overlay hiển thị vị trí defects
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  defectHeatmapData,
  measurementResults,
  productInspections,
  machines,
  measurementPointDefs,
  productModels
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc, sql, isNull } from "drizzle-orm";

export const defectHeatmapRouter = router({
  // Generate heatmap data
  generate: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      periodType: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).default("DAILY"),
      startDate: z.string(),
      endDate: z.string(),
      gridWidth: z.number().min(10).max(200).default(100),
      gridHeight: z.number().min(10).max(200).default(100),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const startTime = Date.now();
      const periodStart = new Date(input.startDate);
      const periodEnd = new Date(input.endDate);

      // Build query conditions
      const conditions = [
        gte(productInspections.inspectionTime, periodStart),
        lte(productInspections.inspectionTime, periodEnd),
        eq(measurementResults.result, "NG"),
      ];

      if (input.machineId) {
        conditions.push(eq(productInspections.machineId, input.machineId));
      }
      if (input.productModelId) {
        conditions.push(eq(productInspections.productModelId, input.productModelId));
      }

      // Get NG measurement results (bounded to prevent OOM on large date ranges)
      const ngResults = await db
        .select({
          id: measurementResults.id,
          inspectionId: measurementResults.inspectionId,
          pointDefId: measurementResults.pointDefId,
          result: measurementResults.result,
        })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...conditions))
        .limit(500000);

      // Initialize heatmap grid
      const heatmapGrid: number[][] = [];
      for (let i = 0; i < input.gridHeight; i++) {
        heatmapGrid.push(new Array(input.gridWidth).fill(0));
      }

      // Aggregate defects by location
      const locationStats = new Map<string, { count: number; types: Map<string, number> }>();
      
      for (const result of ngResults) {
        // Map pointDefId to grid coordinates
        const gridX = result.pointDefId % input.gridWidth;
        const gridY = Math.floor(result.pointDefId / input.gridWidth) % input.gridHeight;
        
        heatmapGrid[gridY][gridX]++;
        
        const key = `${gridX},${gridY}`;
        const stats = locationStats.get(key) || { count: 0, types: new Map() };
        stats.count++;
        stats.types.set(result.result || 'UNKNOWN', (stats.types.get(result.result || 'UNKNOWN') || 0) + 1);
        locationStats.set(key, stats);
      }

      // Find hotspots (top 10 locations with most defects)
      const hotspots: Array<{
        x: number;
        y: number;
        defectCount: number;
        defectTypes: Array<{ type: string; count: number }>;
        percentage: number;
      }> = [];

      const totalDefects = ngResults.length;
      const sortedLocations = Array.from(locationStats.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10);

      for (const [key, stats] of sortedLocations) {
        const [x, y] = key.split(",").map(Number);
        hotspots.push({
          x,
          y,
          defectCount: stats.count,
          defectTypes: Array.from(stats.types.entries()).map(([type, count]) => ({ type, count })),
          percentage: totalDefects > 0 ? (stats.count / totalDefects) * 100 : 0,
        });
      }

      // Find max defects in any cell
      let maxDefectsInCell = 0;
      for (const row of heatmapGrid) {
        for (const cell of row) {
          if (cell > maxDefectsInCell) maxDefectsInCell = cell;
        }
      }

      // Save heatmap data
      const [result] = await db.insert(defectHeatmapData).values({
        machineId: input.machineId,
        productModelId: input.productModelId,
        periodType: input.periodType,
        periodStart,
        periodEnd,
        gridWidth: input.gridWidth,
        gridHeight: input.gridHeight,
        heatmapGrid,
        totalDefects,
        maxDefectsInCell,
        hotspots,
        topLocations: hotspots.map(h => ({
          gridX: h.x,
          gridY: h.y,
          realX: h.x * 10,
          realY: h.y * 10,
          defectCount: h.defectCount,
          defectTypes: h.defectTypes.map(t => t.type),
          trend: "stable" as const,
        })),
        processingTimeMs: Date.now() - startTime,
      }).returning({ id: defectHeatmapData.id });

      return { id: result.id, totalDefects, hotspots };
    }),

  // Get heatmap data by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [heatmap] = await db
        .select()
        .from(defectHeatmapData)
        .where(eq(defectHeatmapData.id, input.id));

      if (!heatmap) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Heatmap không tồn tại" });
      }

      return heatmap;
    }),

  // List heatmaps
  list: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      periodType: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { heatmaps: [], total: 0 };

      const conditions = [];
      if (input.machineId) conditions.push(eq(defectHeatmapData.machineId, input.machineId));
      if (input.productModelId) conditions.push(eq(defectHeatmapData.productModelId, input.productModelId));
      if (input.periodType) conditions.push(eq(defectHeatmapData.periodType, input.periodType));

      const heatmaps = await db
        .select()
        .from(defectHeatmapData)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(defectHeatmapData.generatedAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(defectHeatmapData)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return {
        heatmaps,
        total: countResult?.count || 0,
      };
    }),

  // Get latest heatmap for a scope
  getLatest: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      periodType: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const conditions = [];
      if (input.machineId) conditions.push(eq(defectHeatmapData.machineId, input.machineId));
      if (input.productModelId) conditions.push(eq(defectHeatmapData.productModelId, input.productModelId));
      if (input.periodType) conditions.push(eq(defectHeatmapData.periodType, input.periodType));

      const [heatmap] = await db
        .select()
        .from(defectHeatmapData)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(defectHeatmapData.generatedAt))
        .limit(1);

      return heatmap || null;
    }),

  // Delete heatmap
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      await db.delete(defectHeatmapData).where(eq(defectHeatmapData.id, input.id));
      return { success: true };
    }),

  // Get machine overlay data
  getMachineOverlay: protectedProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { machines: [], summary: { total: 0, byMachine: [] } };

      const periodStart = new Date(input.startDate);
      const periodEnd = new Date(input.endDate);

      // Get defect counts by machine
      const machineDefects = await db
        .select({
          machineId: productInspections.machineId,
          defectCount: sql<number>`COUNT(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 END)`,
          totalCount: sql<number>`COUNT(*)`,
        })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(
          gte(productInspections.inspectionTime, periodStart),
          lte(productInspections.inspectionTime, periodEnd),
        ))
        .groupBy(productInspections.machineId);

      // Get machine list
      const machineList = await db
        .select()
        .from(machines)
        .where(eq(machines.isActive, true));

      // Combine data
      const machineOverlay = machineList.map(machine => {
        const defectData = machineDefects.find(d => d.machineId === machine.id);
        return {
          id: machine.id,
          code: machine.code,
          name: machine.name,
          defectCount: defectData?.defectCount || 0,
          totalCount: defectData?.totalCount || 0,
          defectRate: defectData && defectData.totalCount > 0 
            ? (defectData.defectCount / defectData.totalCount) * 100 
            : 0,
          severity: defectData && defectData.defectCount > 100 ? "critical" 
            : defectData && defectData.defectCount > 50 ? "warning" 
            : "normal",
        };
      });

      return {
        machines: machineOverlay,
        summary: {
          total: machineDefects.reduce((sum, m) => sum + (m.defectCount || 0), 0),
          byMachine: machineDefects.map(m => ({
            machineId: m.machineId,
            count: m.defectCount || 0,
          })),
        },
      };
    }),

  // Get real-time defect hotspots
  getRealTimeHotspots: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      hours: z.number().min(1).max(24).default(1),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);
      
      const conditions = [
        gte(productInspections.inspectionTime, since),
        eq(measurementResults.result, "NG"),
      ];
      
      if (input.machineId) conditions.push(eq(productInspections.machineId, input.machineId));

      const recentDefects = await db
        .select({
          machineId: productInspections.machineId,
          pointDefId: measurementResults.pointDefId,
          result: measurementResults.result,
          count: sql<number>`COUNT(*)`,
        })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...conditions))
        .groupBy(productInspections.machineId, measurementResults.pointDefId, measurementResults.result)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(20);

      return recentDefects;
    }),

  // ─── Quality Cockpit: product defect overlay ──────────────────────────────
  // Returns defect density per measurement point at the point's REAL position
  // (measurement_point_defs.positionX/Y + normalizedX/Y) so the client can
  // overlay bubbles on the product reference image — NOT the meaningless
  // pointDefId % grid pseudo-coordinate the legacy heatmap used.
  getProductDefectOverlay: protectedProcedure
    .input(z.object({
      productModelId: z.number(),
      machineId: z.number().optional(),
      startDate: z.string(),
      endDate: z.string(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return { product: null, points: [], maxNg: 0, totalNg: 0, totalInspected: 0 };
      }

      const periodStart = new Date(input.startDate);
      const periodEnd = new Date(input.endDate);

      // Product reference image + native pixel dimensions (overlay canvas bounds).
      const [product] = await db
        .select({
          id: productModels.id,
          code: productModels.code,
          name: productModels.name,
          referenceImageUrl: productModels.referenceImageUrl,
          imageWidth: productModels.imageWidth,
          imageHeight: productModels.imageHeight,
          imageDisplayMode: productModels.imageDisplayMode,
        })
        .from(productModels)
        .where(eq(productModels.id, input.productModelId));

      if (!product) {
        return { product: null, points: [], maxNg: 0, totalNg: 0, totalInspected: 0 };
      }

      // The measurement-point definitions carry the REAL anchor positions.
      const pointDefs = await db
        .select({
          id: measurementPointDefs.id,
          code: measurementPointDefs.code,
          name: measurementPointDefs.name,
          positionX: measurementPointDefs.positionX,
          positionY: measurementPointDefs.positionY,
          normalizedX: measurementPointDefs.normalizedX,
          normalizedY: measurementPointDefs.normalizedY,
          radius: measurementPointDefs.radius,
        })
        .from(measurementPointDefs)
        .where(and(
          eq(measurementPointDefs.productModelId, input.productModelId),
          eq(measurementPointDefs.isActive, true),
          isNull(measurementPointDefs.deletedAt),
        ));

      // Aggregate measurement results per point in the window (NG + total).
      const conditions = [
        gte(productInspections.inspectionTime, periodStart),
        lte(productInspections.inspectionTime, periodEnd),
        eq(productInspections.productModelId, input.productModelId),
      ];
      if (input.machineId) {
        conditions.push(eq(productInspections.machineId, input.machineId));
      }

      const perPoint = await db
        .select({
          pointDefId: measurementResults.pointDefId,
          ngCount: sql<number>`COUNT(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 END)`,
          totalCount: sql<number>`COUNT(*)`,
        })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...conditions))
        .groupBy(measurementResults.pointDefId);

      const statsByPoint = new Map<number, { ngCount: number; totalCount: number }>();
      for (const row of perPoint) {
        if (row.pointDefId == null) continue;
        statsByPoint.set(row.pointDefId, {
          ngCount: Number(row.ngCount) || 0,
          totalCount: Number(row.totalCount) || 0,
        });
      }

      let maxNg = 0;
      let totalNg = 0;
      let totalInspected = 0;

      const points = pointDefs.map((p) => {
        const stats = statsByPoint.get(p.id) ?? { ngCount: 0, totalCount: 0 };
        if (stats.ngCount > maxNg) maxNg = stats.ngCount;
        totalNg += stats.ngCount;
        totalInspected += stats.totalCount;
        return {
          pointDefId: p.id,
          code: p.code,
          name: p.name,
          positionX: p.positionX,
          positionY: p.positionY,
          // 0..1 normalized anchor. Prefer stored normalized values; fall back
          // to positionX/Y over the product native image dimensions.
          normalizedX: p.normalizedX != null
            ? Number(p.normalizedX)
            : (product.imageWidth ? p.positionX / product.imageWidth : null),
          normalizedY: p.normalizedY != null
            ? Number(p.normalizedY)
            : (product.imageHeight ? p.positionY / product.imageHeight : null),
          radius: p.radius ?? null,
          ngCount: stats.ngCount,
          totalCount: stats.totalCount,
          ngRate: stats.totalCount > 0 ? (stats.ngCount / stats.totalCount) * 100 : 0,
        };
      });

      return { product, points, maxNg, totalNg, totalInspected };
    }),
});

export type DefectHeatmapRouter = typeof defectHeatmapRouter;
