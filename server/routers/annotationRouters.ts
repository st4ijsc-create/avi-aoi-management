import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { invokeLLM } from "../_core/llm";

// ============ DRILL DOWN ROUTER ============

/**
 * W1 (sự thật số liệu): bucket sentinel cho inspection CHƯA GÁN tập đoàn
 * (corporateCode NULL/rỗng). Đây không phải mã tập đoàn thật — client hiển thị
 * "Chưa gán tập đoàn" và factoriesByCorporate hiểu sentinel này là "match NULL".
 */
const UNASSIGNED_CORPORATE_CODE = 'Unknown';

/** Shape 1 hàng của factoriesByCorporate (thêm optional isUnassigned — không đổi contract cũ). */
type FactoryDrillStat = {
  id: number;
  code: string;
  name: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  yieldRate: number;
  /** true = bucket "chưa gán nhà máy" (factoryCode không khớp master data) — client render KHÔNG drill được. */
  isUnassigned?: boolean;
};

export const drillDownRouter = router({
  // Get stats by corporate
  corporateStats: protectedProcedure
    .query(async ({ ctx }) => {
      // Get inspections grouped by corporate code
      const { data: inspections } = await db.getProductInspections({ 
        limit: 50000,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
      
      // Group by corporate code
      const corporateMap = new Map<string, { total: number; ok: number; ng: number; ntf: number }>();
      
      for (const inspection of inspections) {
        const corpCode = inspection.corporateCode || UNASSIGNED_CORPORATE_CODE;
        
        if (!corporateMap.has(corpCode)) {
          corporateMap.set(corpCode, { total: 0, ok: 0, ng: 0, ntf: 0 });
        }
        
        const stats = corporateMap.get(corpCode)!;
        stats.total++;
        if (inspection.overallResult === 'OK') stats.ok++;
        else if (inspection.overallResult === 'NG') stats.ng++;
        else if (inspection.overallResult === 'NTF') stats.ntf++;
      }
      
      return Array.from(corporateMap.entries()).map(([code, stats]) => ({
        code,
        name: code,
        total: stats.total,
        ok: stats.ok,
        ng: stats.ng,
        ntf: stats.ntf,
        yieldRate: stats.total > 0 ? (stats.ok / stats.total) * 100 : 0,
        // W1: đánh dấu bucket "chưa gán tập đoàn" để client đổi nhãn + xếp cuối
        // (hàng này VẪN drill được — factoriesByCorporate hiểu sentinel = NULL).
        isUnassigned: code === UNASSIGNED_CORPORATE_CODE ? (true as const) : undefined,
      })).sort((a, b) => b.total - a.total);
    }),

  // Get factories by corporate
  factoriesByCorporate: protectedProcedure
    .input(z.object({ corporateCode: z.string() }))
    .query(async ({ ctx, input }) => {
      const allFactories = await db.getFactories();
      // W1: 'Unknown' là sentinel "chưa gán tập đoàn" do corporateStats phát ra
      // (corporateCode NULL) — không phải mã thật nên KHÔNG thể lọc eq() ở DB
      // (trước đây trả rỗng → drill ngõ cụt). Lấy không lọc rồi giữ lại các
      // inspection có corporateCode NULL/rỗng trong bộ nhớ.
      const isUnassignedCorporate = input.corporateCode === UNASSIGNED_CORPORATE_CODE;
      const { data: fetchedInspections } = await db.getProductInspections({
        ...(isUnassignedCorporate ? {} : { corporateCode: input.corporateCode }),
        limit: 50000,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
      const inspections = isUnassignedCorporate
        ? fetchedInspections.filter(i => !i.corporateCode)
        : fetchedInspections;

      // Group inspections by factory code
      const factoryStatsMap = new Map<string, { total: number; ok: number; ng: number; ntf: number }>();

      for (const inspection of inspections) {
        const factoryCode = inspection.factoryCode || 'Unknown';
        
        if (!factoryStatsMap.has(factoryCode)) {
          factoryStatsMap.set(factoryCode, { total: 0, ok: 0, ng: 0, ntf: 0 });
        }
        
        const stats = factoryStatsMap.get(factoryCode)!;
        stats.total++;
        if (inspection.overallResult === 'OK') stats.ok++;
        else if (inspection.overallResult === 'NG') stats.ng++;
        else if (inspection.overallResult === 'NTF') stats.ntf++;
      }
      
      // Map to factories (khớp master data)
      const rows: FactoryDrillStat[] = allFactories
        .filter(f => factoryStatsMap.has(f.code))
        .map(factory => {
          const stats = factoryStatsMap.get(factory.code) || { total: 0, ok: 0, ng: 0, ntf: 0 };
          return {
            id: factory.id,
            code: factory.code,
            name: factory.name,
            total: stats.total,
            ok: stats.ok,
            ng: stats.ng,
            ntf: stats.ntf,
            yieldRate: stats.total > 0 ? (stats.ok / stats.total) * 100 : 0,
          };
        })
        .sort((a, b) => b.total - a.total);

      // W1 (tổng các tầng phải khớp): trước đây .filter(has) VỨT IM LẶNG các bucket
      // factoryCode không có trong master data (hoặc NULL) → tổng tầng Factory hụt so
      // với tầng Corporate. Gom phần dư thành 1 hàng "Chưa gán nhà máy" KHÔNG drill
      // được (isUnassigned: true) để chênh lệch được giải thích ngay trên UI.
      const masterFactoryCodes = new Set(allFactories.map(f => f.code));
      let unTotal = 0, unOk = 0, unNg = 0, unNtf = 0;
      for (const [code, stats] of factoryStatsMap) {
        if (masterFactoryCodes.has(code)) continue;
        unTotal += stats.total;
        unOk += stats.ok;
        unNg += stats.ng;
        unNtf += stats.ntf;
      }
      if (unTotal > 0) {
        rows.push({
          id: -1, // sentinel — client không dùng để drill (isUnassigned)
          code: 'UNASSIGNED',
          name: `Chưa gán nhà máy (${unTotal.toLocaleString('vi-VN')} kết quả)`,
          total: unTotal,
          ok: unOk,
          ng: unNg,
          ntf: unNtf,
          yieldRate: unTotal > 0 ? (unOk / unTotal) * 100 : 0,
          isUnassigned: true,
        });
      }

      return rows;
    }),

  // Get lines by factory
  linesByFactory: protectedProcedure
    .input(z.object({ factoryId: z.number() }))
    .query(async ({ ctx, input }) => {
      const allLines = await db.getProductionLines();
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) return [];
      
      // Get workshops for this factory
      const allWorkshops = await db.getWorkshops();
      const factoryWorkshops = allWorkshops.filter(w => w.factoryId === input.factoryId);
      const workshopIds = factoryWorkshops.map(w => w.id);
      
      const { data: inspections } = await db.getProductInspections({ 
        factoryCode: factory.code,
        limit: 50000,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
      
      // Get lines for this factory (via workshops)
      const factoryLines = allLines.filter(l => workshopIds.includes(l.workshopId));
      
      // Group inspections by machine, then map to lines
      const allMachines = await db.getMachines();
      const allStations = await db.getStations();
      
      return factoryLines.map(line => {
        // Get stations for this line
        const lineStations = allStations.filter(s => s.lineId === line.id);
        const stationIds = lineStations.map(s => s.id);
        
        // Get machines for these stations
        const lineMachineIds = allMachines.filter(m => stationIds.includes(m.stationId)).map(m => m.id);
        const lineInspections = inspections.filter(i => lineMachineIds.includes(i.machineId));
        
        const total = lineInspections.length;
        const ok = lineInspections.filter(i => i.overallResult === 'OK').length;
        const ng = lineInspections.filter(i => i.overallResult === 'NG').length;
        const ntf = lineInspections.filter(i => i.overallResult === 'NTF').length;
        
        return {
          id: line.id,
          code: line.code,
          name: line.name,
          total,
          ok,
          ng,
          ntf,
          yieldRate: total > 0 ? (ok / total) * 100 : 0,
        };
      }).sort((a, b) => b.total - a.total);
    }),

  // Get machines by line
  machinesByLine: protectedProcedure
    .input(z.object({ lineId: z.number() }))
    .query(async ({ ctx, input }) => {
      const allMachines = await db.getMachines();
      const allStations = await db.getStations();
      
      // Get stations for this line
      const lineStations = allStations.filter(s => s.lineId === input.lineId);
      const lineStationIds = lineStations.map(s => s.id);
      
      // Get machines for these stations
      const lineMachines = allMachines.filter(m => lineStationIds.includes(m.stationId));
      
      // Get inspections for these machines
      const machineIds = lineMachines.map(m => m.id);
      
      const results = await Promise.all(lineMachines.map(async (machine) => {
        const { data: machineInspections } = await db.getProductInspections({ 
          machineId: machine.id,
          limit: 10000,
          userId: ctx.user.id,
          userRole: ctx.user.role as 'admin' | 'user',
        });
        
        const total = machineInspections.length;
        const ok = machineInspections.filter(i => i.overallResult === 'OK').length;
        const ng = machineInspections.filter(i => i.overallResult === 'NG').length;
        const ntf = machineInspections.filter(i => i.overallResult === 'NTF').length;
        
        return {
          id: machine.id,
          code: machine.code,
          name: machine.name,
          total,
          ok,
          ng,
          ntf,
          yieldRate: total > 0 ? (ok / total) * 100 : 0,
        };
      }));
      
      return results.sort((a, b) => b.total - a.total);
    }),
});

// ============ ANNOTATION ROUTER ============
export const annotationRouter = router({
  // Save annotations for an image
  save: protectedProcedure
    .input(z.object({
      inspectionId: z.number().optional(),
      measurementResultId: z.number().optional(),
      imageUrl: z.string(),
      annotations: z.array(z.object({
        id: z.string(),
        type: z.enum(['rectangle', 'circle', 'arrow', 'freehand', 'text']),
        points: z.array(z.object({ x: z.number(), y: z.number() })),
        color: z.string(),
        lineWidth: z.number(),
        text: z.string().optional(),
        fontSize: z.number().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      // Check if annotation exists for this image
      const existing = await db.execute(
        sql`SELECT id FROM image_annotations WHERE "imageUrl" = ${input.imageUrl} AND "createdBy" = ${ctx.user.id} LIMIT 1`
      ) as any;
      
      if (existing.length > 0) {
        // Update existing
        await db.execute(
          sql`UPDATE image_annotations SET annotations = ${JSON.stringify(input.annotations)}, "updatedAt" = NOW() WHERE id = ${existing[0].id}`
        );
        return { success: true, id: existing[0].id };
      } else {
        // Create new
        const result = await db.execute(
          sql`INSERT INTO image_annotations ("inspectionId", "measurementResultId", "imageUrl", annotations, "createdBy") VALUES (${input.inspectionId || null}, ${input.measurementResultId || null}, ${input.imageUrl}, ${JSON.stringify(input.annotations)}, ${ctx.user.id}) RETURNING id`
        );
        return { success: true, id: (result as any)[0]?.id };
      }
    }),

  // Get annotations for an image
  getByImage: protectedProcedure
    .input(z.object({ imageUrl: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const result = await db.execute(
        sql`SELECT * FROM image_annotations WHERE "imageUrl" = ${input.imageUrl} ORDER BY "updatedAt" DESC LIMIT 1`
      ) as any;
      if (!result.length) return null;
      const row = result[0];
      return {
        id: row.id,
        inspectionId: row.inspectionId,
        measurementResultId: row.measurementResultId,
        imageUrl: row.imageUrl,
        annotations: typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),

  // Get all annotations for an inspection
  getByInspection: protectedProcedure
    .input(z.object({ inspectionId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      const result = await db.execute(
        sql`SELECT * FROM image_annotations WHERE "inspectionId" = ${input.inspectionId} ORDER BY "createdAt" DESC`
      ) as any;
      return (result || []).map((row: any) => ({
        id: row.id,
        inspectionId: row.inspectionId,
        measurementResultId: row.measurementResultId,
        imageUrl: row.imageUrl,
        annotations: typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    }),

  // Search annotations
  search: protectedProcedure
    .input(z.object({
      textQuery: z.string().optional(),
      types: z.array(z.string()).optional(),
      color: z.string().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Get all annotations and filter in memory for complex JSON queries
      const result = await db.execute(
        sql`SELECT * FROM image_annotations ORDER BY "createdAt" DESC LIMIT 500`
      ) as any;
      
      let annotations = (result || []).map((row: any) => {
        const parsedAnnotations = typeof row.annotations === 'string' 
          ? JSON.parse(row.annotations) 
          : row.annotations;
        return {
          id: row.id,
          imageId: row.imageUrl,
          imageUrl: row.imageUrl,
          inspectionId: row.inspectionId,
          measurementResultId: row.measurementResultId,
          annotations: parsedAnnotations,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
        };
      });
      
      // Flatten to individual annotation results
      const flatResults: any[] = [];
      for (const ann of annotations) {
        for (const item of ann.annotations || []) {
          flatResults.push({
            imageId: ann.imageId,
            imageUrl: ann.imageUrl,
            annotationId: ann.id,
            annotationType: item.type,
            annotationText: item.text || null,
            annotationColor: item.color,
            createdBy: ann.createdBy,
            createdAt: ann.createdAt,
            inspectionId: ann.inspectionId,
          });
        }
      }
      
      // Apply filters
      let filtered = flatResults;
      
      if (input?.textQuery) {
        const query = input.textQuery.toLowerCase();
        filtered = filtered.filter(r => 
          r.annotationText?.toLowerCase().includes(query)
        );
      }
      
      if (input?.types && input.types.length > 0) {
        filtered = filtered.filter(r => input.types!.includes(r.annotationType));
      }
      
      if (input?.color) {
        filtered = filtered.filter(r => r.annotationColor === input.color);
      }
      
      if (input?.dateFrom) {
        filtered = filtered.filter(r => new Date(r.createdAt) >= input.dateFrom!);
      }
      
      if (input?.dateTo) {
        filtered = filtered.filter(r => new Date(r.createdAt) <= input.dateTo!);
      }
      
      return filtered;
    }),

  // Get annotation statistics
  statistics: protectedProcedure
    .input(z.object({
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Get all annotations with inspection data
      let query = sql`
        SELECT 
          ia.id,
          ia.annotations,
          ia."createdAt",
          ia."inspectionId",
          i."machineId",
          i."productModelId",
          m.code as machine_code,
          m.name as machine_name,
          pm.code as product_code,
          pm.name as product_name
        FROM image_annotations ia
        LEFT JOIN product_inspections i ON ia."inspectionId" = i.id
        LEFT JOIN machines m ON i."machineId" = m.id
        LEFT JOIN product_models pm ON i."productModelId" = pm.id
        WHERE 1=1
      `;
      
      // Note: For simplicity, we'll filter in memory. In production, use proper SQL conditions.
      const result = await db.execute(query) as any;
      
      let rows = Array.isArray(result) ? [...result] : ((result as any)?.rows ?? []);
      
      // Apply date filters
      if (input?.dateFrom) {
        rows = rows.filter((r: any) => new Date(r.createdAt) >= input.dateFrom!);
      }
      if (input?.dateTo) {
        rows = rows.filter((r: any) => new Date(r.createdAt) <= input.dateTo!);
      }
      if (input?.machineId) {
        rows = rows.filter((r: any) => r.machineId === input.machineId);
      }
      if (input?.productModelId) {
        rows = rows.filter((r: any) => r.productModelId === input.productModelId);
      }
      
      // Calculate statistics
      const byType: Record<string, number> = {};
      const byColor: Record<string, number> = {};
      const byMachine: Record<string, { count: number; name: string }> = {};
      const byProduct: Record<string, { count: number; name: string }> = {};
      const byDate: Record<string, number> = {};
      let totalAnnotations = 0;
      
      for (const row of rows) {
        const annotations = typeof row.annotations === 'string' 
          ? JSON.parse(row.annotations) 
          : row.annotations;
        
        for (const ann of annotations || []) {
          totalAnnotations++;
          
          // By type
          byType[ann.type] = (byType[ann.type] || 0) + 1;
          
          // By color
          byColor[ann.color] = (byColor[ann.color] || 0) + 1;
          
          // By machine
          if (row.machine_code) {
            if (!byMachine[row.machine_code]) {
              byMachine[row.machine_code] = { count: 0, name: row.machine_name || row.machine_code };
            }
            byMachine[row.machine_code].count++;
          }
          
          // By product
          if (row.product_code) {
            if (!byProduct[row.product_code]) {
              byProduct[row.product_code] = { count: 0, name: row.product_name || row.product_code };
            }
            byProduct[row.product_code].count++;
          }
          
          // By date (daily)
          const dateKey = new Date(row.createdAt).toISOString().split('T')[0];
          byDate[dateKey] = (byDate[dateKey] || 0) + 1;
        }
      }
      
      return {
        totalAnnotations,
        totalImages: rows.length,
        byType: Object.entries(byType).map(([type, count]) => ({ type, count })),
        byColor: Object.entries(byColor).map(([color, count]) => ({ color, count })),
        byMachine: Object.entries(byMachine).map(([code, data]) => ({ code, ...data })),
        byProduct: Object.entries(byProduct).map(([code, data]) => ({ code, ...data })),
        byDate: Object.entries(byDate).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
      };
    }),

  // Bulk apply template to multiple images
  bulkApplyTemplate: protectedProcedure
    .input(z.object({
      templateId: z.number(),
      imageUrls: z.array(z.string()),
      inspectionIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Get template
      const templateResult = await db.execute(
        sql`SELECT annotations FROM annotation_templates WHERE id = ${input.templateId}`
      ) as any;
      if (!templateResult.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }
      const templateAnnotations = typeof templateResult[0].annotations === 'string'
        ? JSON.parse(templateResult[0].annotations)
        : templateResult[0].annotations;
      
      // Apply to each image
      let successCount = 0;
      for (let i = 0; i < input.imageUrls.length; i++) {
        const imageUrl = input.imageUrls[i];
        const inspectionId = input.inspectionIds?.[i] || null;
        
        // Check if annotation exists
        const existing = await db.execute(
          sql`SELECT id, annotations FROM image_annotations WHERE "imageUrl" = ${imageUrl} LIMIT 1`
        ) as any;
        
        if (existing.length > 0) {
          // Merge with existing annotations
          const existingAnnotations = typeof existing[0].annotations === 'string'
            ? JSON.parse(existing[0].annotations)
            : existing[0].annotations;
          const mergedAnnotations = [...existingAnnotations, ...templateAnnotations.map((a: any) => ({ ...a, id: nanoid() }))];
          await db.execute(
            sql`UPDATE image_annotations SET annotations = ${JSON.stringify(mergedAnnotations)}, "updatedAt" = NOW() WHERE id = ${existing[0].id}`
          );
        } else {
          // Create new
          await db.execute(
            sql`INSERT INTO image_annotations ("inspectionId", "imageUrl", annotations, "createdBy") VALUES (${inspectionId}, ${imageUrl}, ${JSON.stringify(templateAnnotations.map((a: any) => ({ ...a, id: nanoid() })))}, ${ctx.user.id})`
          );
        }
        successCount++;
      }
      
      return { success: true, appliedCount: successCount };
    }),

  // Bulk delete annotations from multiple images
  bulkDelete: protectedProcedure
    .input(z.object({
      imageUrls: z.array(z.string()),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      let deletedCount = 0;
      for (const imageUrl of input.imageUrls) {
        const result = await db.execute(
          sql`DELETE FROM image_annotations WHERE "imageUrl" = ${imageUrl} AND ("createdBy" = ${ctx.user.id} OR ${ctx.user.role} = 'admin')`
        ) as any;
        deletedCount += result.count || 0;
      }
      
      return { success: true, deletedCount };
    }),

  // Copy annotations from one image to others
  copyAnnotations: protectedProcedure
    .input(z.object({
      sourceImageUrl: z.string(),
      targetImageUrls: z.array(z.string()),
      targetInspectionIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Get source annotations
      const sourceResult = await db.execute(
        sql`SELECT annotations FROM image_annotations WHERE "imageUrl" = ${input.sourceImageUrl} ORDER BY "updatedAt" DESC LIMIT 1`
      ) as any;
      if (!sourceResult.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Source image has no annotations' });
      }
      const sourceAnnotations = typeof sourceResult[0].annotations === 'string'
        ? JSON.parse(sourceResult[0].annotations)
        : sourceResult[0].annotations;
      
      // Copy to each target
      let successCount = 0;
      for (let i = 0; i < input.targetImageUrls.length; i++) {
        const targetUrl = input.targetImageUrls[i];
        const inspectionId = input.targetInspectionIds?.[i] || null;
        
        // Check if annotation exists
        const existing = await db.execute(
          sql`SELECT id FROM image_annotations WHERE "imageUrl" = ${targetUrl} LIMIT 1`
        ) as any;
        
        const newAnnotations = sourceAnnotations.map((a: any) => ({ ...a, id: nanoid() }));
        
        if (existing.length > 0) {
          await db.execute(
            sql`UPDATE image_annotations SET annotations = ${JSON.stringify(newAnnotations)}, "updatedAt" = NOW() WHERE id = ${existing[0].id}`
          );
        } else {
          await db.execute(
            sql`INSERT INTO image_annotations ("inspectionId", "imageUrl", annotations, "createdBy") VALUES (${inspectionId}, ${targetUrl}, ${JSON.stringify(newAnnotations)}, ${ctx.user.id})`
          );
        }
        successCount++;
      }
      
      return { success: true, copiedCount: successCount };
    }),

  // AI-assisted annotation analysis
  analyzeImage: protectedProcedure
    .input(z.object({
      imageUrl: z.string(),
      context: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const response = await invokeLLM({
          messages: [
            {
              role: 'system',
              content: `You are an expert quality control inspector analyzing inspection images from AVI/AOI machines. 
Analyze the image and identify potential defects, anomalies, or areas that need attention.
For each finding, provide:
1. Type of annotation to use (rectangle, circle, arrow, or text)
2. Approximate position (as percentage from top-left, e.g., x: 30%, y: 50%)
3. Size (as percentage of image, e.g., width: 10%, height: 10%)
4. Description of the defect/finding
5. Severity (high, medium, low)
6. Confidence score (0-100)

Respond in JSON format with an array of findings.`
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Analyze this inspection image and identify any defects or areas needing annotation.${input.context ? ` Context: ${input.context}` : ''}`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: input.imageUrl,
                    detail: 'high'
                  }
                }
              ]
            }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'defect_analysis',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  findings: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['rectangle', 'circle', 'arrow', 'text'] },
                        x: { type: 'number', description: 'X position as percentage (0-100)' },
                        y: { type: 'number', description: 'Y position as percentage (0-100)' },
                        width: { type: 'number', description: 'Width as percentage (0-100)' },
                        height: { type: 'number', description: 'Height as percentage (0-100)' },
                        description: { type: 'string' },
                        severity: { type: 'string', enum: ['high', 'medium', 'low'] },
                        confidence: { type: 'number', description: 'Confidence score 0-100' },
                        suggestedColor: { type: 'string', description: 'Hex color code' }
                      },
                      required: ['type', 'x', 'y', 'description', 'severity', 'confidence'],
                      additionalProperties: false
                    }
                  },
                  summary: { type: 'string', description: 'Overall summary of the analysis' },
                  overallQuality: { type: 'string', enum: ['good', 'acceptable', 'needs_review', 'defective'] }
                },
                required: ['findings', 'summary', 'overallQuality'],
                additionalProperties: false
              }
            }
          }
        });
        
        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No response from AI');
        }
        
        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
        const analysis = JSON.parse(contentStr);
        
        // Convert findings to annotation format
        const suggestedAnnotations = analysis.findings.map((finding: any, index: number) => {
          const baseAnnotation = {
            id: `ai-${Date.now()}-${index}`,
            type: finding.type,
            color: finding.suggestedColor || (finding.severity === 'high' ? '#ef4444' : finding.severity === 'medium' ? '#f97316' : '#eab308'),
            lineWidth: 2,
            text: finding.description,
            confidence: finding.confidence,
            severity: finding.severity,
          };
          
          // Calculate points based on type
          const x = finding.x / 100;
          const y = finding.y / 100;
          const w = (finding.width || 10) / 100;
          const h = (finding.height || 10) / 100;
          
          if (finding.type === 'rectangle') {
            return {
              ...baseAnnotation,
              points: [
                { x, y },
                { x: x + w, y: y + h }
              ]
            };
          } else if (finding.type === 'circle') {
            return {
              ...baseAnnotation,
              points: [
                { x, y },
                { x: x + w/2, y: y + h/2 }
              ]
            };
          } else if (finding.type === 'arrow') {
            return {
              ...baseAnnotation,
              points: [
                { x: x - 0.05, y: y - 0.05 },
                { x, y }
              ]
            };
          } else {
            return {
              ...baseAnnotation,
              points: [{ x, y }],
              fontSize: 14
            };
          }
        });
        
        return {
          success: true,
          analysis: {
            summary: analysis.summary,
            overallQuality: analysis.overallQuality,
            findingsCount: analysis.findings.length,
          },
          suggestedAnnotations,
        };
      } catch (error: any) {
        console.error('AI analysis error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `AI analysis failed: ${error.message}`
        });
      }
    }),

  // Delete annotations
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      // Check ownership
      const existing = await db.execute(
        sql`SELECT "createdBy" FROM image_annotations WHERE id = ${input.id}`
      ) as any;
      if (!existing.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Annotation not found' });
      }
      if (existing[0].createdBy !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to delete this annotation' });
      }
      await db.execute(sql`DELETE FROM image_annotations WHERE id = ${input.id}`);
      return { success: true };
    }),

  // Get comparison data for same product across inspections
  comparison: protectedProcedure
    .input(z.object({
      serialNumber: z.string().optional(),
      productModelId: z.number().optional(),
      measurementPointId: z.number().optional(),
      machineId: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().default(10),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Build dynamic conditions using parameterized queries
      const conditions = [sql`mr."imageUrl" IS NOT NULL`];
      if (input.serialNumber) conditions.push(sql`i."serialNumber" = ${input.serialNumber}`);
      if (input.productModelId) conditions.push(sql`i."productModelId" = ${input.productModelId}`);
      if (input.measurementPointId) conditions.push(sql`mr."pointDefId" = ${input.measurementPointId}`);
      if (input.machineId) conditions.push(sql`i."machineId" = ${input.machineId}`);
      if (input.dateFrom) conditions.push(sql`i."inspectionTime" >= ${input.dateFrom}`);
      if (input.dateTo) conditions.push(sql`i."inspectionTime" <= ${input.dateTo}`);
      
      const combinedConditions = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
      const whereClause = sql`WHERE ${combinedConditions}`;
      
      const result = await db.execute(sql`
        SELECT 
          i.id as inspection_id,
          i."serialNumber",
          i."inspectionTime",
          i."overallResult",
          m.name as machine_name,
          m.id as machine_id,
          pm.name as product_model_name,
          pm.id as product_model_id,
          mr.id as measurement_result_id,
          mr."imageUrl",
          mr.result,
          mr."measuredValue" as value,
          mp.name as measurement_point_name,
          mp.id as measurement_point_id,
          ia.id as annotation_id,
          ia.annotations,
          ia."createdAt" as annotation_created_at
        FROM product_inspections i
        LEFT JOIN machines m ON i."machineId" = m.id
        LEFT JOIN product_models pm ON i."productModelId" = pm.id
        LEFT JOIN measurement_results mr ON mr."inspectionId" = i.id
        LEFT JOIN measurement_point_defs mp ON mr."pointDefId" = mp.id
        LEFT JOIN image_annotations ia ON ia."inspectionId" = i.id AND ia."imageUrl" = mr."imageUrl"
        ${whereClause}
        ORDER BY i."inspectionTime" DESC
        LIMIT ${input.limit}
      `) as any;
      
      // Group by measurement point for comparison
      const grouped: Record<string, any[]> = {};
      for (const row of result || []) {
        const key = `${row.measurement_point_id || 'unknown'}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          inspectionId: row.inspection_id,
          serialNumber: row.serialNumber,
          inspectionTime: row.inspectionTime,
          overallResult: row.overallResult,
          machineName: row.machine_name,
          machineId: row.machine_id,
          productModelName: row.product_model_name,
          productModelId: row.product_model_id,
          measurementResultId: row.measurement_result_id,
          imageUrl: row.imageUrl,
          result: row.result,
          value: row.value,
          measurementPointName: row.measurement_point_name,
          measurementPointId: row.measurement_point_id,
          annotationId: row.annotation_id,
          annotations: row.annotations ? (typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations) : [],
          annotationCreatedAt: row.annotation_created_at,
        });
      }
      
      return {
        groups: Object.entries(grouped).map(([pointId, items]) => ({
          measurementPointId: parseInt(pointId) || null,
          measurementPointName: items[0]?.measurementPointName || 'Unknown',
          inspections: items,
        })),
        totalInspections: result.length || 0,
      };
    }),

  // Get defect heatmap data
  heatmapData: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      annotationType: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Build dynamic conditions using parameterized queries
      const conditions = [sql`ia.annotations IS NOT NULL`];
      if (input.machineId) conditions.push(sql`i."machineId" = ${input.machineId}`);
      if (input.productModelId) conditions.push(sql`i."productModelId" = ${input.productModelId}`);
      if (input.dateFrom) conditions.push(sql`i."inspectionTime" >= ${input.dateFrom}`);
      if (input.dateTo) conditions.push(sql`i."inspectionTime" <= ${input.dateTo}`);
      
      const combinedConditions = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
      const whereClause = sql`WHERE ${combinedConditions}`;
      
      const result = await db.execute(sql`
        SELECT 
          ia.id,
          ia.annotations,
          ia."inspectionId",
          i."machineId",
          i."productModelId",
          i."inspectionTime",
          m.name as machine_name,
          m."layoutPositionX",
          m."layoutPositionY",
          pm.name as product_model_name,
          mr."pointDefId",
          mp.name as measurement_point_name
        FROM image_annotations ia
        JOIN product_inspections i ON ia."inspectionId" = i.id
        LEFT JOIN machines m ON i."machineId" = m.id
        LEFT JOIN product_models pm ON i."productModelId" = pm.id
        LEFT JOIN measurement_results mr ON mr."inspectionId" = i.id AND mr."imageUrl" = ia."imageUrl"
        LEFT JOIN measurement_point_defs mp ON mr."pointDefId" = mp.id
        ${whereClause}
      `) as any;
      
      // Aggregate defect positions by machine
      const machineDefects: Record<number, {
        machineId: number;
        machineName: string;
        positionX: number | null;
        positionY: number | null;
        defectCount: number;
        defectsByType: Record<string, number>;
        defectsByColor: Record<string, number>;
        recentDefects: any[];
      }> = {};
      
      // Aggregate defect positions for heatmap
      const heatmapPoints: Array<{
        x: number;
        y: number;
        intensity: number;
        machineId: number;
        machineName: string;
        annotationType: string;
        color: string;
      }> = [];
      
      for (const row of result || []) {
        const machineId = row.machineId ?? -1;
        if (!machineDefects[machineId]) {
          machineDefects[machineId] = {
            machineId,
            machineName: row.machine_name || 'Unknown',
            positionX: row.layoutPositionX,
            positionY: row.layoutPositionY,
            defectCount: 0,
            defectsByType: {},
            defectsByColor: {},
            recentDefects: [],
          };
        }
        
        const annotations = typeof row.annotations === 'string' 
          ? JSON.parse(row.annotations) 
          : row.annotations;
        
        for (const ann of annotations || []) {
          if (input.annotationType && ann.type !== input.annotationType) continue;
          
          machineDefects[machineId].defectCount++;
          machineDefects[machineId].defectsByType[ann.type] = 
            (machineDefects[machineId].defectsByType[ann.type] || 0) + 1;
          machineDefects[machineId].defectsByColor[ann.color] = 
            (machineDefects[machineId].defectsByColor[ann.color] || 0) + 1;
          
          // Add to heatmap points if machine has position
          if (row.layoutPositionX !== null && row.layoutPositionY !== null) {
            // Use annotation position within image + machine position
            const annX = ann.points?.[0]?.x || 0.5;
            const annY = ann.points?.[0]?.y || 0.5;
            heatmapPoints.push({
              x: row.layoutPositionX + (annX - 0.5) * 50, // Spread within 50px of machine center
              y: row.layoutPositionY + (annY - 0.5) * 50,
              intensity: 1,
              machineId,
              machineName: row.machine_name || 'Unknown',
              annotationType: ann.type,
              color: ann.color,
            });
          }
          
          // Keep recent defects
          if (machineDefects[machineId].recentDefects.length < 5) {
            machineDefects[machineId].recentDefects.push({
              type: ann.type,
              color: ann.color,
              text: ann.text,
              inspectionTime: row.inspectionTime,
              productModel: row.product_model_name,
              measurementPoint: row.measurement_point_name,
            });
          }
        }
      }
      
      // Calculate intensity based on density
      const maxCount = Math.max(...Object.values(machineDefects).map(m => m.defectCount), 1);
      
      return {
        machines: Object.values(machineDefects).map(m => ({
          ...m,
          intensity: m.defectCount / maxCount, // Normalized 0-1
        })),
        heatmapPoints,
        summary: {
          totalDefects: Object.values(machineDefects).reduce((sum, m) => sum + m.defectCount, 0),
          machinesWithDefects: Object.keys(machineDefects).length,
          topDefectTypes: Object.entries(
            Object.values(machineDefects).reduce((acc, m) => {
              for (const [type, count] of Object.entries(m.defectsByType)) {
                acc[type] = (acc[type] || 0) + count;
              }
              return acc;
            }, {} as Record<string, number>)
          ).sort((a, b) => b[1] - a[1]).slice(0, 5),
        },
      };
    }),

  // Defect trend prediction with AI
  trendPrediction: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      annotationType: z.string().optional(),
      days: z.number().default(30), // Historical days
      predictionDays: z.number().default(7), // Days to predict
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Build dynamic conditions using parameterized queries
      const conditions = [
        sql`ia.annotations IS NOT NULL`,
        sql`i."inspectionTime" >= NOW() - INTERVAL '1 day' * ${input.days}`,
      ];
      if (input.machineId) conditions.push(sql`i."machineId" = ${input.machineId}`);
      if (input.productModelId) conditions.push(sql`i."productModelId" = ${input.productModelId}`);
      
      const combinedConditions = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
      const whereClause = sql`WHERE ${combinedConditions}`;
      
      const result = await db.execute(sql`
        SELECT 
          CAST(i."inspectionTime" AS DATE) as date,
          COUNT(ia.id) as defect_count,
          i."machineId",
          m.name as machine_name,
          i."productModelId",
          pm.name as product_model_name
        FROM image_annotations ia
        JOIN product_inspections i ON ia."inspectionId" = i.id
        LEFT JOIN machines m ON i."machineId" = m.id
        LEFT JOIN product_models pm ON i."productModelId" = pm.id
        ${whereClause}
        GROUP BY CAST(i."inspectionTime" AS DATE), i."machineId", m.name, i."productModelId", pm.name
        ORDER BY date ASC
      `) as any;
      const historicalData = (result || []).map((row: any) => ({
        date: row.date,
        defectCount: Number(row.defect_count),
        machineId: row.machineId,
        machineName: row.machine_name,
        productModelId: row.productModelId,
        productModelName: row.product_model_name,
      }));
      
      // Calculate simple moving average and trend
      const aggregatedByDate: Record<string, number> = {};
      for (const item of historicalData) {
        const dateStr = new Date(item.date).toISOString().split('T')[0];
        aggregatedByDate[dateStr] = (aggregatedByDate[dateStr] || 0) + item.defectCount;
      }
      
      const sortedDates = Object.keys(aggregatedByDate).sort();
      const values = sortedDates.map(d => aggregatedByDate[d]);
      
      // Calculate trend using linear regression
      const n = values.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += values[i];
        sumXY += i * values[i];
        sumX2 += i * i;
      }
      
      const slope = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0;
      const intercept = n > 0 ? (sumY - slope * sumX) / n : 0;
      
      // Generate predictions
      const predictions: Array<{ date: string; predicted: number; lower: number; upper: number }> = [];
      const avgValue = n > 0 ? sumY / n : 0;
      const stdDev = n > 1 ? Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - avgValue, 2), 0) / (n - 1)) : 0;
      
      for (let i = 0; i < input.predictionDays; i++) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + i + 1);
        const dateStr = futureDate.toISOString().split('T')[0];
        const predicted = Math.max(0, Math.round(intercept + slope * (n + i)));
        const margin = stdDev * 1.96; // 95% confidence interval
        
        predictions.push({
          date: dateStr,
          predicted,
          lower: Math.max(0, Math.round(predicted - margin)),
          upper: Math.round(predicted + margin),
        });
      }
      
      // Calculate trend direction
      const trendDirection = slope > 0.5 ? 'increasing' : slope < -0.5 ? 'decreasing' : 'stable';
      const avgDaily = n > 0 ? Math.round(sumY / n) : 0;
      const maxDaily = n > 0 ? Math.max(...values) : 0;
      const minDaily = n > 0 ? Math.min(...values) : 0;
      
      return {
        historical: sortedDates.map(date => ({
          date,
          actual: aggregatedByDate[date],
        })),
        predictions,
        statistics: {
          totalDefects: sumY,
          avgDaily,
          maxDaily,
          minDaily,
          trendDirection,
          slope: Math.round(slope * 100) / 100,
          confidence: n >= 7 ? 'high' : n >= 3 ? 'medium' : 'low',
        },
        insights: [
          trendDirection === 'increasing' 
            ? `Xu hướng tăng: Dự kiến defects sẽ tăng ${Math.round(slope * input.predictionDays)} trong ${input.predictionDays} ngày tới`
            : trendDirection === 'decreasing'
            ? `Xu hướng giảm: Dự kiến defects sẽ giảm ${Math.abs(Math.round(slope * input.predictionDays))} trong ${input.predictionDays} ngày tới`
            : `Xu hướng ổn định: Defects duy trì ở mức trung bình ${avgDaily}/ngày`,
          maxDaily > avgDaily * 2 ? `Cảnh báo: Có ngày đạt đỉnh ${maxDaily} defects, cao hơn trung bình ${Math.round((maxDaily / avgDaily - 1) * 100)}%` : null,
          predictions[predictions.length - 1]?.predicted > avgDaily * 1.5 ? `Dự báo: Ngày ${predictions[predictions.length - 1]?.date} có thể đạt ${predictions[predictions.length - 1]?.predicted} defects` : null,
        ].filter(Boolean),
      };
    }),

  // Export annotations
  export: protectedProcedure
    .input(z.object({
      format: z.enum(['json', 'csv']),
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      annotationType: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Build dynamic conditions using parameterized queries
      const conditions = [sql`ia.annotations IS NOT NULL`];
      if (input.machineId) conditions.push(sql`i."machineId" = ${input.machineId}`);
      if (input.productModelId) conditions.push(sql`i."productModelId" = ${input.productModelId}`);
      if (input.dateFrom) conditions.push(sql`i."inspectionTime" >= ${input.dateFrom}`);
      if (input.dateTo) conditions.push(sql`i."inspectionTime" <= ${input.dateTo}`);
      
      const combinedConditions = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
      const whereClause = sql`WHERE ${combinedConditions}`;
      
      const result = await db.execute(sql`
        SELECT 
          ia.id,
          ia."imageUrl",
          ia.annotations,
          ia."inspectionId",
          i."serialNumber",
          i."inspectionTime",
          i."machineId",
          m.name as machine_name,
          i."productModelId",
          pm.name as product_model_name,
          mr."pointDefId",
          mp.name as measurement_point_name
        FROM image_annotations ia
        JOIN product_inspections i ON ia."inspectionId" = i.id
        LEFT JOIN machines m ON i."machineId" = m.id
        LEFT JOIN product_models pm ON i."productModelId" = pm.id
        LEFT JOIN measurement_results mr ON mr."inspectionId" = i.id AND mr."imageUrl" = ia."imageUrl"
        LEFT JOIN measurement_point_defs mp ON mr."pointDefId" = mp.id
        ${whereClause}
        ORDER BY i."inspectionTime" DESC
        LIMIT 10000
      `) as any;
      const rows = Array.isArray(result) ? [...result] : ((result as any)?.rows ?? []);
      
      if (input.format === 'json') {
        const exportData = rows.map((row: any) => {
          const annotations = typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations;
          return {
            id: row.id,
            imageUrl: row.imageUrl,
            inspectionId: row.inspectionId,
            serialNumber: row.serialNumber,
            inspectionTime: row.inspectionTime,
            machineId: row.machineId,
            machineName: row.machine_name,
            productModelId: row.productModelId,
            productModelName: row.product_model_name,
            measurementPointId: row.pointDefId,
            measurementPointName: row.measurement_point_name,
            annotations: annotations,
          };
        });
        
        return {
          format: 'json',
          data: JSON.stringify(exportData, null, 2),
          filename: `annotations_export_${new Date().toISOString().split('T')[0]}.json`,
          count: exportData.length,
        };
      } else {
        // CSV format
        const csvRows: string[] = [];
        csvRows.push('ID,Image URL,Inspection ID,Serial Number,Inspection Time,Machine ID,Machine Name,Product Model ID,Product Model Name,Measurement Point,Annotation Type,Annotation Color,Annotation Text,X,Y,Width,Height');
        
        for (const row of rows) {
          const annotations = typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations;
          for (const ann of annotations || []) {
            csvRows.push([
              row.id,
              `"${row.imageUrl || ''}"`,
              row.inspectionId,
              `"${row.serialNumber || ''}"`,
              row.inspectionTime,
              row.machineId || '',
              `"${row.machine_name || ''}"`,
              row.productModelId || '',
              `"${row.product_model_name || ''}"`,
              `"${row.measurement_point_name || ''}"`,
              ann.type || '',
              ann.color || '',
              `"${(ann.text || '').replace(/"/g, '""')}"`,
              ann.x || '',
              ann.y || '',
              ann.width || '',
              ann.height || '',
            ].join(','));
          }
        }
        
        return {
          format: 'csv',
          data: csvRows.join('\n'),
          filename: `annotations_export_${new Date().toISOString().split('T')[0]}.csv`,
          count: rows.length,
        };
      }
    }),

  // Import annotations
  import: protectedProcedure
    .input(z.object({
      data: z.string(),
      format: z.enum(['json']),
      mode: z.enum(['merge', 'replace']).default('merge'),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      try {
        const importData = JSON.parse(input.data);
        if (!Array.isArray(importData)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid import data format' });
        }
        
        let imported = 0;
        let skipped = 0;
        let errors: string[] = [];
        
        for (const item of importData) {
          try {
            if (!item.imageUrl || !item.annotations) {
              skipped++;
              continue;
            }
            
            // Check if annotation exists for this image
            const existing = await db.execute(
              sql`SELECT id FROM image_annotations WHERE "imageUrl" = ${item.imageUrl} LIMIT 1`
            ) as any;
            
            if (existing.length > 0) {
              if (input.mode === 'replace') {
                // Update existing
                await db.execute(
                  sql`UPDATE image_annotations SET annotations = ${JSON.stringify(item.annotations)}, "updatedAt" = NOW() WHERE "imageUrl" = ${item.imageUrl}`
                );
                imported++;
              } else {
                // Merge - append new annotations
                const existingRow = existing[0];
                const existingAnnotations = typeof existingRow.annotations === 'string' 
                  ? JSON.parse(existingRow.annotations) 
                  : existingRow.annotations;
                const mergedAnnotations = [...(existingAnnotations || []), ...(item.annotations || [])];
                await db.execute(
                  sql`UPDATE image_annotations SET annotations = ${JSON.stringify(mergedAnnotations)}, "updatedAt" = NOW() WHERE "imageUrl" = ${item.imageUrl}`
                );
                imported++;
              }
            } else {
              // Need inspectionId to create new annotation
              if (item.inspectionId) {
                await db.execute(
                  sql`INSERT INTO image_annotations ("imageUrl", "inspectionId", annotations, "createdBy") VALUES (${item.imageUrl}, ${item.inspectionId}, ${JSON.stringify(item.annotations)}, ${ctx.user.id})`
                );
                imported++;
              } else {
                skipped++;
              }
            }
          } catch (err: any) {
            errors.push(`Error importing ${item.imageUrl}: ${err.message}`);
          }
        }
        
        return {
          success: true,
          imported,
          skipped,
          errors: errors.slice(0, 10), // Limit errors shown
        };
      } catch (err: any) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Import failed: ${err.message}` });
      }
    }),
});

// ============ ANNOTATION TEMPLATE ROUTER ============
export const annotationTemplateRouter = router({
  // List templates
  list: protectedProcedure
    .input(z.object({
      category: z.enum(['defect_marker', 'measurement_guide', 'quality_stamp', 'custom']).optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Build dynamic query
      let result: any;
      if (input?.category && input?.search) {
        result = await db.execute(
          sql`SELECT * FROM annotation_templates WHERE category = ${input.category} AND (name LIKE ${`%${input.search}%`} OR description LIKE ${`%${input.search}%`}) ORDER BY "isSystem" DESC, name ASC`
        );
      } else if (input?.category) {
        result = await db.execute(
          sql`SELECT * FROM annotation_templates WHERE category = ${input.category} ORDER BY "isSystem" DESC, name ASC`
        );
      } else if (input?.search) {
        result = await db.execute(
          sql`SELECT * FROM annotation_templates WHERE name LIKE ${`%${input.search}%`} OR description LIKE ${`%${input.search}%`} ORDER BY "isSystem" DESC, name ASC`
        );
      } else {
        result = await db.execute(
          sql`SELECT * FROM annotation_templates ORDER BY "isSystem" DESC, name ASC`
        );
      }
      return (result || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        description: row.description,
        annotations: typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations,
        previewUrl: row.previewUrl,
        isSystem: Boolean(row.isSystem),
        createdBy: row.createdBy,
        createdAt: row.createdAt,
      }));
    }),

  // Create template
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      category: z.enum(['defect_marker', 'measurement_guide', 'quality_stamp', 'custom']),
      description: z.string().optional(),
      annotations: z.array(z.any()),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      await db.execute(
        sql`INSERT INTO annotation_templates (name, category, description, annotations, "createdBy") VALUES (${input.name}, ${input.category}, ${input.description || null}, ${JSON.stringify(input.annotations)}, ${ctx.user.id})`
      );
      return { success: true };
    }),

  // Delete template
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Check if system template
      const existing = await db.execute(
        sql`SELECT "isSystem", "createdBy" FROM annotation_templates WHERE id = ${input.id}`
      ) as any;
      if (!existing.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }
      if (existing[0].isSystem) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot delete system templates' });
      }
      if (existing[0].createdBy !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to delete this template' });
      }
      
      await db.execute(sql`DELETE FROM annotation_templates WHERE id = ${input.id}`);
      return { success: true };
    }),
});

// ============ ANNOTATION HISTORY ROUTER ============
export const annotationHistoryRouter = router({
  // List versions for an annotation
  list: protectedProcedure
    .input(z.object({
      annotationId: z.number().optional(),
      imageUrl: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      let query;
      if (input.annotationId) {
        query = sql`SELECT * FROM annotation_history WHERE "annotationId" = ${input.annotationId} ORDER BY "versionNumber" DESC LIMIT ${input.limit}`;
      } else if (input.imageUrl) {
        query = sql`SELECT * FROM annotation_history WHERE "imageUrl" = ${input.imageUrl} ORDER BY "versionNumber" DESC LIMIT ${input.limit}`;
      } else {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Either annotationId or imageUrl is required' });
      }
      
      const result = await db.execute(query) as any;
      return (result || []).map((row: any) => ({
        id: row.id,
        annotationId: row.annotationId,
        imageUrl: row.imageUrl,
        versionNumber: row.versionNumber,
        annotations: typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations,
        changeType: row.changeType,
        changeSummary: row.changeSummary,
        changedBy: row.changedBy,
        changedByName: row.changedByName,
        createdAt: row.createdAt,
      }));
    }),

  // Get specific version
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      const result = await db.execute(
        sql`SELECT * FROM annotation_history WHERE id = ${input.id}`
      ) as any;
      
      if (!result.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });
      }
      
      const row = result[0];
      return {
        id: row.id,
        annotationId: row.annotationId,
        imageUrl: row.imageUrl,
        versionNumber: row.versionNumber,
        annotations: typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations,
        changeType: row.changeType,
        changeSummary: row.changeSummary,
        changedBy: row.changedBy,
        changedByName: row.changedByName,
        createdAt: row.createdAt,
      };
    }),

  // Rollback to a specific version
  rollback: protectedProcedure
    .input(z.object({ historyId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Get the history record
      const historyResult = await db.execute(
        sql`SELECT * FROM annotation_history WHERE id = ${input.historyId}`
      ) as any;
      
      if (!historyResult.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });
      }
      
      const historyRow = historyResult[0];
      const annotations = typeof historyRow.annotations === 'string' 
        ? JSON.parse(historyRow.annotations) 
        : historyRow.annotations;
      
      // Update the current annotation
      await db.execute(
        sql`UPDATE image_annotations SET annotations = ${JSON.stringify(annotations)}, "updatedAt" = NOW() WHERE id = ${historyRow.annotationId}`
      );
      
      // Get current max version
      const maxVersionResult = await db.execute(
        sql`SELECT MAX("versionNumber") as "maxVersion" FROM annotation_history WHERE "annotationId" = ${historyRow.annotationId}`
      ) as any;
      const newVersion = (maxVersionResult[0]?.maxVersion || 0) + 1;
      
      // Create new history entry for rollback
      await db.execute(
        sql`INSERT INTO annotation_history ("annotationId", "imageUrl", "versionNumber", annotations, "changeType", "changeSummary", "changedBy", "changedByName")
          VALUES (${historyRow.annotationId}, ${historyRow.imageUrl}, ${newVersion}, ${JSON.stringify(annotations)}, 'ROLLBACK', ${`Rolled back to version ${historyRow.versionNumber}`}, ${ctx.user.id}, ${ctx.user.name || 'Unknown'})`
      );
      
      return { success: true, newVersion };
    }),

  // Compare two versions
  compare: protectedProcedure
    .input(z.object({
      versionId1: z.number(),
      versionId2: z.number(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      const result = await db.execute(
        sql`SELECT * FROM annotation_history WHERE id IN (${input.versionId1}, ${input.versionId2})`
      ) as any;
      
      if (result.length !== 2) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'One or both versions not found' });
      }
      
      const versions = result.map((row: any) => ({
        id: row.id,
        versionNumber: row.versionNumber,
        annotations: typeof row.annotations === 'string' ? JSON.parse(row.annotations) : row.annotations,
        changeType: row.changeType,
        changedByName: row.changedByName,
        createdAt: row.createdAt,
      }));
      
      // Calculate diff
      const v1 = versions.find((v: any) => v.id === input.versionId1);
      const v2 = versions.find((v: any) => v.id === input.versionId2);
      
      const v1Ids = new Set((v1?.annotations || []).map((a: any) => a.id));
      const v2Ids = new Set((v2?.annotations || []).map((a: any) => a.id));
      
      const added = (v2?.annotations || []).filter((a: any) => !v1Ids.has(a.id));
      const removed = (v1?.annotations || []).filter((a: any) => !v2Ids.has(a.id));
      const modified = (v2?.annotations || []).filter((a: any) => {
        if (!v1Ids.has(a.id)) return false;
        const v1Ann = (v1?.annotations || []).find((x: any) => x.id === a.id);
        return JSON.stringify(v1Ann) !== JSON.stringify(a);
      });
      
      return {
        version1: v1,
        version2: v2,
        diff: {
          added: added.length,
          removed: removed.length,
          modified: modified.length,
          addedItems: added,
          removedItems: removed,
          modifiedItems: modified,
        },
      };
    }),
});
