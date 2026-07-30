/**
 * Defect Heatmap Router - Heatmap overlay hiển thị vị trí defects
 *
 * Doc 27 gap A5 (W5-A): `generate` / `getBboxHeatmap` now aggregate the REAL
 * pixel bounding boxes (measurement_results.defectBboxX/Y/W/H, bbox center)
 * instead of the fabricated `pointDefId % gridWidth` layout. The legacy
 * layout survives only as the explicit `mode: "pointDef"` fallback, labeled
 * "logical positions" (realCoordinates:false). Coordinate-space rules are
 * documented in services/defectSpatialHeatmap.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { moduleProcedure, router } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_QUALITY (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_QUALITY");
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
import { resolveFactoryDateWindow } from "../utils/kpi";
import { computeSpatialHeatmap } from "../services/defectSpatialHeatmap";

const heatmapQueryInput = z.object({
  machineId: z.number().optional(),
  productModelId: z.number().optional(),
  /** Filter to one IPC defect class (measurement_results.defectCatalogId). */
  defectCatalogId: z.number().optional(),
  startDate: z.string(),
  endDate: z.string(),
  gridWidth: z.number().min(10).max(200).default(100),
  gridHeight: z.number().min(10).max(200).default(100),
  /**
   * "bbox" (default) = REAL spatial aggregation of defectBboxX/Y centers.
   * "pointDef" = legacy logical layout for datasets with no bbox at all —
   * positions are pointDefId-derived, NOT spatial.
   * "panelBoard" (W8-B, doc 29 §2.2) = fold every board of an N-up panel onto
   * the single-board mm space via the product's ACTIVE panel def + per-board
   * Pareto; honestly degrades to "bbox" (panelAware:false + reason) when no
   * usable panel def exists. Requires productModelId to be meaningful.
   */
  mode: z.enum(["bbox", "pointDef", "panelBoard"]).default("bbox"),
  /** Weight grid cells by defect severity (critical=4 … cosmetic=1). */
  weightBySeverity: z.boolean().default(false),
});

export const defectHeatmapRouter = router({
  // Generate + persist heatmap data (bbox-real by default; see module header)
  generate: protectedProcedure
    .input(heatmapQueryInput.extend({
      periodType: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).default("DAILY"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const startTime = Date.now();
      // Date-only strings are factory-local calendar days (gap A2 at filter level).
      // The service filters with `lte`, so back an EXCLUSIVE upper bound off by 1ms.
      const window = resolveFactoryDateWindow(input.startDate, input.endDate);
      const endInclusive = window.endExclusive ? new Date(window.end.getTime() - 1) : window.end;

      const result = await computeSpatialHeatmap(db, {
        startDate: window.start,
        endDate: endInclusive,
        machineId: input.machineId,
        productModelId: input.productModelId,
        defectCatalogId: input.defectCatalogId,
        gridWidth: input.gridWidth,
        gridHeight: input.gridHeight,
        mode: input.mode,
        weightBySeverity: input.weightBySeverity,
      });

      // Persist (schema unchanged — hotspot json keeps the legacy keys, with
      // `defectTypes` now carrying real defect-class codes instead of the
      // useless constant 'NG').
      const [saved] = await db.insert(defectHeatmapData).values({
        machineId: input.machineId,
        productModelId: input.productModelId,
        periodType: input.periodType,
        periodStart: window.start,
        periodEnd: window.end,
        gridWidth: input.gridWidth,
        gridHeight: input.gridHeight,
        heatmapGrid: result.grid,
        totalDefects: result.totalDefects,
        maxDefectsInCell: result.maxDefectsInCell,
        hotspots: result.hotspots.map(h => ({
          x: h.x,
          y: h.y,
          defectCount: h.defectCount,
          defectTypes: h.defectTypes,
          percentage: h.percentage,
        })),
        topLocations: result.hotspots.map(h => ({
          gridX: h.x,
          gridY: h.y,
          realX: h.realX,
          realY: h.realY,
          defectCount: h.defectCount,
          defectTypes: h.defectTypes.map(t => t.type),
          trend: "stable" as const,
        })),
        processingTimeMs: Date.now() - startTime,
      }).returning({ id: defectHeatmapData.id });

      // Legacy shape ({id, totalDefects, hotspots}) preserved + honest additions.
      return {
        id: saved.id,
        totalDefects: result.totalDefects,
        hotspots: result.hotspots,
        realCoordinates: result.realCoordinates,
        mode: result.mode,
        coordinateSpace: result.coordinateSpace,
        boardWidth: result.boardWidth,
        boardHeight: result.boardHeight,
        excludedNoBbox: result.excludedNoBbox,
        excludedNoBboxPct: result.excludedNoBboxPct,
        maxDefectsInCell: result.maxDefectsInCell,
        // W8-B panel-aware extras (undefined outside mode "panelBoard").
        panelAware: result.panelAware,
        panelDefId: result.panelDefId,
        panelFallbackReason: result.panelFallbackReason,
        perBoard: result.perBoard,
        unassigned: result.unassigned,
      };
    }),

  // Read-only compute (no persist) — used by the board-heatmap UI.
  getBboxHeatmap: protectedProcedure
    .input(heatmapQueryInput)
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const window = resolveFactoryDateWindow(input.startDate, input.endDate);
      const endInclusive = window.endExclusive ? new Date(window.end.getTime() - 1) : window.end;
      return computeSpatialHeatmap(db, {
        startDate: window.start,
        endDate: endInclusive,
        machineId: input.machineId,
        productModelId: input.productModelId,
        defectCatalogId: input.defectCatalogId,
        gridWidth: input.gridWidth,
        gridHeight: input.gridHeight,
        mode: input.mode,
        weightBySeverity: input.weightBySeverity,
      });
    }),

  // Get heatmap data by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const [heatmap] = await db
        .select()
        .from(defectHeatmapData)
        .where(eq(defectHeatmapData.id, input.id));

      if (!heatmap) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "heatmap" }, "Heatmap không tồn tại");
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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

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
