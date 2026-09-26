/**
 * Defect Heatmap Router - Heatmap overlay hiển thị vị trí defects
 *
 * Doc 27 gap A5 (W5-A): `generate` / `getBboxHeatmap` now aggregate the REAL
 * pixel bounding boxes (measurement_results.defectBboxX/Y/W/H, bbox center)
 * instead of the fabricated `pointDefId % gridWidth` layout. The legacy
 * layout survives only as the explicit `mode: "pointDef"` fallback, labeled
 * "logical positions" (realCoordinates:false). Coordinate-space rules are
 * documented in services/defectSpatialHeatmap.ts.
 *
 * ── PHẠM VI NHÀ MÁY (2026-08-17) ────────────────────────────────────────────
 * ⚠ MỌI thủ tục ở đây đọc dữ liệu của một tenant và PHẢI lọc theo phạm vi của người
 * gọi. Cơ chế là MỘT: `getUserAssignmentCodes` (`_core/accessControl`) — đúng cái
 * `/history` dùng — gói lại trong `services/defectSpatialHeatmap.ts`:
 *   • `resolveCallerScope` + `scopedConditions` → điều kiện trên `product_inspections`
 *     (dùng cho các thủ tục TÍNH TRỰC TIẾP);
 *   • `resolveSavedHeatmapScope`               → điều kiện trên `defect_heatmap_data`
 *     (dùng cho các thủ tục PHÁT LẠI heatmap đã lưu; cột phạm vi thêm ở mig 0324).
 *
 * FAIL-CLOSED VỚI HÀNG KHÔNG RÕ NGUỒN GỐC: `defect_heatmap_data.factoryCode` NULL nghĩa
 * là heatmap ấy gộp ≥2 nhà máy (hoặc 0 hàng) nên KHÔNG mã nào đúng. Hàng như vậy chỉ
 * admin đọc/xoá được. `generate` chỉ ghi mã khi tập hàng đóng góp có ĐÚNG MỘT cặp mã.
 *
 * CÂU "RỖNG" PHẢI TRUNG THỰC: khi người gọi không có gán nhà máy nào, mọi thủ tục trả
 * `scopeEmptyReason:"no_factory_assignment"` + `scopeMessage` nói rõ lý do. Giao diện
 * KHÔNG được trình bày trạng thái ấy như "không có dữ liệu"/"không có lỗi nào".
 *
 * ⚠ THAY ĐỔI HÌNH DẠNG TRẢ VỀ (cùng ngày): `list` → `{heatmaps,total,+3 ô phạm vi}`,
 * `getLatest`/`getById` → `{heatmap,+3 ô}`, `getRealTimeHotspots` → `{hotspots,+3 ô}`.
 * Ba ô phạm vi KHÔNG thể đi kèm một mảng trần hay một `null` trần, và một câu rỗng
 * không tới được người dùng thì bằng như không có. Người tiêu thụ thật lúc di trú:
 * chỉ `client/src/pages/ApiDocs.tsx` (đoạn mã ví dụ) — đã cập nhật.
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
import { eq, and, gte, lte, desc, sql, isNull, type SQL } from "drizzle-orm";
import { resolveFactoryDateWindow } from "../utils/kpi";
import {
  computeSpatialHeatmap,
  resolveCallerScope,
  resolveContributingScope,
  resolveSavedHeatmapScope,
  scopeLabels,
  scopedConditions,
} from "../services/defectSpatialHeatmap";

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
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const startTime = Date.now();
      // Date-only strings are factory-local calendar days (gap A2 at filter level).
      // The service filters with `lte`, so back an EXCLUSIVE upper bound off by 1ms.
      const window = resolveFactoryDateWindow(input.startDate, input.endDate);
      const endInclusive = window.endExclusive ? new Date(window.end.getTime() - 1) : window.end;

      const query = {
        startDate: window.start,
        endDate: endInclusive,
        machineId: input.machineId,
        productModelId: input.productModelId,
        defectCatalogId: input.defectCatalogId,
        gridWidth: input.gridWidth,
        gridHeight: input.gridHeight,
        mode: input.mode,
        weightBySeverity: input.weightBySeverity,
        // Phạm vi dữ liệu lấy từ PHIÊN THẬT (`ctx.user`, do `requireUser` bảo đảm),
        // không bao giờ từ `input` — client không được tự khai mình là ai.
        scope: { userId: ctx.user.id, userRole: String(ctx.user.role) },
      };
      const result = await computeSpatialHeatmap(db, query);
      // "Heatmap này thuộc nhà máy nào?" — ĐO trên đúng tập hàng vừa sinh ra con số, không
      // suy từ `input.machineId`. ≥2 nhà máy (hoặc 0 hàng) ⇒ NULL = KHÔNG RÕ NGUỒN GỐC, và
      // luật đọc fail-closed sẽ chỉ cho admin thấy hàng ấy. Xem `resolveContributingScope`.
      const contributing = await resolveContributingScope(db, query);

      // Persist (hotspot json keeps the legacy keys, with `defectTypes` now
      // carrying real defect-class codes instead of the useless constant 'NG').
      const [saved] = await db.insert(defectHeatmapData).values({
        machineId: input.machineId,
        productModelId: input.productModelId,
        corporateCode: contributing.corporateCode,
        factoryCode: contributing.factoryCode,
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
        // Phạm vi: một grid 0 lỗi của người CHƯA ĐƯỢC GÁN NHÀ MÁY không được
        // trình bày như "không có lỗi nào" (xem defectSpatialHeatmap.ts).
        scopeApplied: result.scopeApplied,
        scopeEmptyReason: result.scopeEmptyReason,
        scopeMessage: result.scopeMessage,
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
    .query(async ({ input, ctx }) => {
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
        // Xem `generate` ở trên: danh tính từ phiên, không từ input.
        scope: { userId: ctx.user.id, userRole: String(ctx.user.role) },
      });
    }),

  // ─── PHÁT LẠI heatmap ĐÃ LƯU (mig 0324 cho cột phạm vi) ───────────────────
  // Get heatmap data by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const scope = await resolveSavedHeatmapScope({ userId: ctx.user.id, userRole: String(ctx.user.role) });
      // KHÔNG có gán nhà máy nào: điều kiện này ĐỘC LẬP với `id` nên nói thẳng lý do KHÔNG
      // tạo ra oracle tồn tại — và một câu "Heatmap không tồn tại" ở đây sẽ là nói dối
      // (nó có thể đang tồn tại; chỉ là người này không được thấy gì cả).
      if (scope.noAssignment) return { heatmap: null, ...scopeLabels(scope) };

      const [heatmap] = await db
        .select()
        .from(defectHeatmapData)
        .where(and(eq(defectHeatmapData.id, input.id), ...(scope.filter ? [scope.filter] : [])));

      // Ngoài phạm vi và không tồn tại phải KHÔNG phân biệt được: nhánh này id-phụ-thuộc nên
      // mọi câu chi tiết hơn đều là một oracle "hàng #id có thật không".
      if (!heatmap) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "heatmap" }, "Heatmap không tồn tại");
      }

      return { heatmap, ...scopeLabels(scope) };
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
    .query(async ({ input, ctx }) => {
      const scope = await resolveSavedHeatmapScope({ userId: ctx.user.id, userRole: String(ctx.user.role) });
      const db = await getDb();
      if (!db) return { heatmaps: [], total: 0, ...scopeLabels(scope) };

      const conditions: SQL[] = [];
      if (input.machineId) conditions.push(eq(defectHeatmapData.machineId, input.machineId));
      if (input.productModelId) conditions.push(eq(defectHeatmapData.productModelId, input.productModelId));
      if (input.periodType) conditions.push(eq(defectHeatmapData.periodType, input.periodType));
      // ⑦ Phạm vi người gọi — trên CẢ hai truy vấn: một `total` không lọc là chính con số
      // rò rỉ ("bạn không thấy hàng nào nhưng hệ thống có 400 hàng ở nhà máy khác").
      if (scope.filter) conditions.push(scope.filter);

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
        ...scopeLabels(scope),
      };
    }),

  // Get latest heatmap for a scope
  getLatest: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      periodType: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const scope = await resolveSavedHeatmapScope({ userId: ctx.user.id, userRole: String(ctx.user.role) });
      const db = await getDb();
      if (!db) return { heatmap: null, ...scopeLabels(scope) };

      const conditions: SQL[] = [];
      if (input.machineId) conditions.push(eq(defectHeatmapData.machineId, input.machineId));
      if (input.productModelId) conditions.push(eq(defectHeatmapData.productModelId, input.productModelId));
      if (input.periodType) conditions.push(eq(defectHeatmapData.periodType, input.periodType));
      // ⑧ "Mới nhất" phải là mới nhất TRONG PHẠM VI — lọc SAU khi đã lấy 1 hàng sẽ biến một
      // hàng ngoài phạm vi thành một câu "không có gì" sai (hàng của bạn vẫn ở phía dưới).
      if (scope.filter) conditions.push(scope.filter);

      const [heatmap] = await db
        .select()
        .from(defectHeatmapData)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(defectHeatmapData.generatedAt))
        .limit(1);

      return { heatmap: heatmap ?? null, ...scopeLabels(scope) };
    }),

  // Delete heatmap
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      // ⑩ Cùng một cơ chế: xoá được heatmap của nhà máy khác là một lỗ GHI, nặng hơn lỗ đọc.
      // `.returning()` cho biết có thật sự xoá được hàng nào không ⇒ "thành công" không còn là
      // một lời khai vô điều kiện như trước.
      const scope = await resolveSavedHeatmapScope({ userId: ctx.user.id, userRole: String(ctx.user.role) });
      const deleted = scope.noAssignment
        ? []
        : await db
            .delete(defectHeatmapData)
            .where(and(eq(defectHeatmapData.id, input.id), ...(scope.filter ? [scope.filter] : [])))
            .returning({ id: defectHeatmapData.id });

      if (deleted.length === 0) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "heatmap" }, "Heatmap không tồn tại");
      }
      return { success: true };
    }),

  // Get machine overlay data
  getMachineOverlay: protectedProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const scope = await resolveCallerScope({ userId: ctx.user.id, userRole: String(ctx.user.role) });
      const db = await getDb();
      if (!db) return { machines: [], summary: { total: 0, byMachine: [] }, ...scopeLabels(scope) };

      const periodStart = new Date(input.startDate);
      const periodEnd = new Date(input.endDate);

      // ④ Đếm lỗi theo máy — phạm vi người gọi.
      // ⚠ Ghi rõ giới hạn: DANH SÁCH MÁY bên dưới KHÔNG bị lọc theo nhà máy (máy là dữ liệu
      // cấu hình, đọc được ở mọi màn khác của ứng dụng qua `machineRouter`); thứ được lọc ở
      // đây là SỐ LIỆU KIỂM. Người ngoài phạm vi vẫn thấy tên máy nhưng thấy 0 lỗi + lý do.
      const machineDefects = await db
        .select({
          machineId: productInspections.machineId,
          defectCount: sql<number>`COUNT(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 END)`,
          totalCount: sql<number>`COUNT(*)`,
        })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...scopedConditions([
          gte(productInspections.inspectionTime, periodStart),
          lte(productInspections.inspectionTime, periodEnd),
        ], scope)))
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
          total: machineDefects.reduce((sum, m) => sum + Number(m.defectCount || 0), 0),
          byMachine: machineDefects.map(m => ({
            machineId: m.machineId,
            count: m.defectCount || 0,
          })),
        },
        ...scopeLabels(scope),
      };
    }),

  // Get real-time defect hotspots
  getRealTimeHotspots: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      hours: z.number().min(1).max(24).default(1),
    }))
    .query(async ({ input, ctx }) => {
      const scope = await resolveCallerScope({ userId: ctx.user.id, userRole: String(ctx.user.role) });
      const db = await getDb();
      if (!db) return { hotspots: [], ...scopeLabels(scope) };

      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);

      const conditions: SQL[] = [
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
        // ⑤ Hotspot "thời gian thực" — phạm vi người gọi.
        .where(and(...scopedConditions(conditions, scope)))
        .groupBy(productInspections.machineId, measurementResults.pointDefId, measurementResults.result)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(20);

      return { hotspots: recentDefects, ...scopeLabels(scope) };
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
    .query(async ({ input, ctx }) => {
      const scope = await resolveCallerScope({ userId: ctx.user.id, userRole: String(ctx.user.role) });
      const db = await getDb();
      if (!db) {
        return { product: null, points: [], maxNg: 0, totalNg: 0, totalInspected: 0, ...scopeLabels(scope) };
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
        return { product: null, points: [], maxNg: 0, totalNg: 0, totalInspected: 0, ...scopeLabels(scope) };
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
      const conditions: SQL[] = [
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
        // ⑥ Mật độ lỗi theo điểm đo — phạm vi người gọi. (Định nghĩa điểm đo + ảnh mẫu là
        // dữ liệu MASTER của sản phẩm, không phải bản ghi kiểm, nên không nằm trên trục này.)
        .where(and(...scopedConditions(conditions, scope)))
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

      return { product, points, maxNg, totalNg, totalInspected, ...scopeLabels(scope) };
    }),
});

export type DefectHeatmapRouter = typeof defectHeatmapRouter;
